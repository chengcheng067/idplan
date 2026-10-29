// @vitest-environment node
/**
 * 多工作区 · NAS 版 · **批 1 地基**（服务端注册表 + 分库）的语言无关契约。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 本文件守什么（每条都对应一个会真实丢数据/串味的坏结果）
 * ══════════════════════════════════════════════════════════════════════
 *   ① **空目录首发**：注册表建出来、ws-default 播种成功、`db_file` 指向
 *      `changxia.db`。坏结果：NAS 首次安装后没有任何工作区，首屏空白。
 *   ② **幂等**：连续调两次 `seedDefaultWorkspace()` 不产生第二行、不报错。
 *      坏结果：每次重启撞主键 → 启动即崩（或有人「修」成 OR REPLACE 后
 *      把用户改过的工作区名悄悄重置）。
 *   ③ **`user_version` 不变**：调注册表/开业务库前后的 `user_version` 逐字节相同。
 *      坏结果：抢置单调计数器 ⇒ `done=1 → status='done'` 的历史归一被静默跳过
 *      （界面不报错，只是历史完成任务全部退回 draft）。见 `server/db.ts` 文件头。
 *   ④ **兼容模式**：`CHANGXIA_DB` 指向一个**已存在的业务库文件** ⇒ ws-default 的
 *      `db_file` 就是那个文件、**不复制不搬移**。坏结果：老 NAS 升级后数据「消失」
 *      （其实在另一个新文件里），或原文件被清空。
 *   ⑤ **createWorkspace 成功**：注册表多一行、`ws-<id>.db` 存在、该库 members 里有
 *      一条 `role_kind='admin'` 的 Owner、`password_hash` 能验过、`owner_member_id` /
 *      `gate_password_hash` 已回填。坏结果：建了区但进不去（无 Owner / 验密不过）。
 *   ⑥ **createWorkspace 失败**：注册表无残留行、无残留文件。坏结果：磁盘上留下
 *      「半个工作区」—— 文件在、注册表没登记（成孤儿）或反过来（行在、库打不开）。
 *   ⑦ **resolveWorkspaceFromRequest**：带 header 命中 / 带不存在 id ⇒ 404 /
 *      不带 header ⇒ ws-default。坏结果：不存在的 id 静默落到默认区 ⇒ A 公司的
 *      请求写进 B 公司的库（串味），且用户看不到任何报错。
 *
 * ── 变异自证（本文件的两条红是真的）──
 *   M1：把「不存在 id ⇒ 抛 WorkspaceNotFoundError」改成「回落 ws-default」⇒ ⑦-2 红。
 *   M2：注掉 `seedDefaultWorkspace` 的「已存在就跳过」判断 ⇒ ② 红（主键冲突）。
 *   两条的实测输出记在交付报告里。
 *
 * ── 隔离口径 ──
 * 每个 describe 用 `mkdtempSync` 造**独立临时数据目录**，并把 `CHANGXIA_DB` 指过去；
 * `afterEach` 关掉全部缓存句柄再删目录。注册表句柄缓存按**文件路径**做键（见
 * `workspace-registry.ts` 的注释），因此不同临时目录天然不串味。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDb, openDb, sectionOf } from '../server/db';
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  WORKSPACE_HEADER,
  WorkspaceCreateError,
  WorkspaceNotFoundError,
  closeAllWorkspaceDbs,
  createWorkspace,
  findWorkspace,
  listWorkspaces,
  openRegistry,
  openWorkspaceDb,
  readGateHash,
  resolveDataDir,
  resolveWorkspaceFromRequest,
  seedDefaultWorkspace,
  verifyGatePassword,
} from '../server/workspace-registry';
import { verifyPassword } from '../server/lib/password-hash';

/** 每个用例独立的临时数据目录 */
let dataDir: string;
/** 用例前的 `CHANGXIA_DB`（afterEach 还原，避免污染同进程的其他 spec） */
let savedEnv: string | undefined;

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'changxia-ws-'));
  return dir;
}

beforeEach(() => {
  savedEnv = process.env.CHANGXIA_DB;
  dataDir = freshDir();
  process.env.CHANGXIA_DB = dataDir; // 存在的目录 ⇒ 数据目录（判定规则 ③）
  closeAllWorkspaceDbs();
});

afterEach(() => {
  closeAllWorkspaceDbs();
  if (savedEnv === undefined) delete process.env.CHANGXIA_DB;
  else process.env.CHANGXIA_DB = savedEnv;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows 上偶发占用：留着不影响后续用例（各自用新目录） */
  }
});

/* ══════════════════════ 0 · resolveDataDir 四条判定规则 ══════════════════════ */

describe('0 · resolveDataDir：CHANGXIA_DB 的四条判定规则（升级不丢数据的硬前提）', () => {
  /** 临时清掉 env 跑一段（`resolveDataDir()` 的默认值是 `process.env.CHANGXIA_DB`） */
  function withEnvUnset<T>(fn: () => T): T {
    const saved = process.env.CHANGXIA_DB;
    delete process.env.CHANGXIA_DB;
    try {
      return fn();
    } finally {
      process.env.CHANGXIA_DB = saved;
    }
  }

  it('① 未设置 ⇒ 与今天 openDb() 逐字相同（<server>/changxia.db）', () => {
    const p = withEnvUnset(() => resolveDataDir());
    expect(p.defaultDbFile.endsWith(join('server', 'changxia.db'))).toBe(true);
    expect(p.registryFile).toBe(join(p.dataDir, 'workspaces.db'));
    // 未设置时数据目录 = server 源码目录 ⇒ 注册表就落在 server/workspaces.db
    expect(p.registryFile.endsWith(join('server', 'workspaces.db'))).toBe(true);
  });

  it('①b 空串 / 纯空白与「未设置」同义（不造出空路径）', () => {
    const baseline = withEnvUnset(() => resolveDataDir());
    expect(resolveDataDir('').defaultDbFile).toBe(baseline.defaultDbFile);
    expect(resolveDataDir('   ').defaultDbFile).toBe(baseline.defaultDbFile);
  });

  it('③ env 指向已存在的目录 ⇒ 数据目录；默认库 = <dir>/changxia.db', () => {
    const p = resolveDataDir(dataDir);
    expect(p.dataDir).toBe(dataDir);
    expect(p.defaultDbFile).toBe(join(dataDir, 'changxia.db'));
    expect(p.registryFile).toBe(join(dataDir, 'workspaces.db'));
  });

  it('② 以分隔符结尾 ⇒ 意在目录（即便该目录还不存在；尾部斜杠被规范化掉）', () => {
    const missing = join(dataDir, 'not-yet');
    const p = resolveDataDir(`${missing}/`);
    expect(p.dataDir).toBe(missing);
    expect(p.defaultDbFile).toBe(join(missing, 'changxia.db'));
    // ★ /data 与 /data/ 必须解析成**同一个**目录（否则注册表句柄缓存会用两个键）
    expect(resolveDataDir(`${dataDir}/`).dataDir).toBe(resolveDataDir(dataDir).dataDir);
  });

  it('④ env 指向已存在的**文件** ⇒ 那个文件就是默认业务库（不搬不复制）', () => {
    const file = join(dataDir, 'legacy.db');
    writeFileSync(file, '');
    const p = resolveDataDir(file);
    expect(p.defaultDbFile).toBe(file);
    // 注册表另存同目录 —— 老部署只多一个 workspaces.db
    expect(p.registryFile).toBe(join(dataDir, 'workspaces.db'));
    expect(p.dataDir).toBe(dataDir);
  });

  it('④b env 指向**不存在**的路径 ⇒ 仍按文件理解（NAS 首发：/data/changxia.db 不是目录）', () => {
    const file = join(dataDir, 'changxia.db');
    const p = resolveDataDir(file);
    expect(p.defaultDbFile).toBe(file);
    expect(p.dataDir).toBe(dataDir);
    // 关键反证：数据目录**不是**那个还不存在的文件名本身
    expect(p.dataDir).not.toBe(file);
  });

  /**
   * ★ team-lead 指定的**四格判定表**（升级路径走错 = 数据「消失」，所以四种情形各一条，
   *   不只测首发）。这四条是「`CHANGXIA_DB` 兼容语义」的完整判据：
   *
   *   | 情形                          | defaultDbFile      | dataDir          |
   *   |-------------------------------|--------------------|------------------|
   *   | (a) 已存在且是**业务库文件**   | 该文件原样         | dirname(该文件)  |
   *   | (b) 已存在且是**目录**         | <dir>/changxia.db  | 该目录           |
   *   | (c) **不存在**                 | 该路径原样         | dirname(该路径)  |
   *   | (d) 已存在且是**空库文件**     | 该文件原样         | dirname(该文件)  |
   *
   *   (a) 与 (d) 必须给出**同一个**答案 —— 判据是「存在且是文件」而不是「里面有没有表」（见
   *   data-paths.ts 文件头「业务表探测为什么不做」）。(d) 单独立一条是因为它是**最容易
   *   被误判成目录**的形态：零业务表的 SQLite 文件看起来「什么都不是」，而它恰是
   *   一个刚被 `new Database()` 建出来、还没跑 `createDb()` 的合法业务库。
   */
  describe('★ 四格判定表（team-lead 验收依据，四情形各一条）', () => {
    it('(a) 已存在且是业务库文件（有表有数据）⇒ 那个文件就是默认库，不搬不复制', () => {
      const file = join(dataDir, 'has-data.db');
      const seeded = openDb(file);
      createDb(seeded);
      seeded
        .prepare(
          `INSERT INTO projects (id, name, type, address, client_name, contract_amount, signed_at,
             planned_start_at, planned_end_at, cover_color, revision, updated_at)
           VALUES ('p1','真项目','x','','',NULL,NULL,'2026-01-01','2026-02-01',NULL,1,'2026-01-01T00:00:00.000Z')`,
        )
        .run();
      seeded.close();
      const before = readdirSync(dataDir).filter((n) => n.endsWith('.db')).sort();

      const p = resolveDataDir(file);
      expect(p.defaultDbFile).toBe(file);
      expect(p.dataDir).toBe(dataDir);
      // 判定过程**不产生**任何新文件（纯读）
      expect(readdirSync(dataDir).filter((n) => n.endsWith('.db')).sort()).toEqual(before);
    });

    it('(b) 已存在且是目录 ⇒ 默认库是该目录下的 changxia.db', () => {
      const dir = join(dataDir, 'as-dir');
      mkdirSync(dir, { recursive: true });
      const p = resolveDataDir(dir);
      expect(p.dataDir).toBe(dir);
      expect(p.defaultDbFile).toBe(join(dir, 'changxia.db'));
      expect(p.registryFile).toBe(join(dir, 'workspaces.db'));
    });

    it('(c) 不存在 ⇒ 按文件路径理解（父目录为数据目录，默认库仍是同名文件）', () => {
      const file = join(dataDir, 'not-yet-created.db');
      expect(existsSync(file)).toBe(false);
      const p = resolveDataDir(file);
      expect(p.defaultDbFile).toBe(file);
      expect(p.dataDir).toBe(dataDir);
      expect(p.registryFile).toBe(join(dataDir, 'workspaces.db'));
    });

    it('(d) 已存在但是**空库文件**（零业务表）⇒ 与 (a) 同一答案，且开库后自动补齐全量 schema', () => {
      const file = join(dataDir, 'empty-lib.db');
      // 只建文件、不跑 createDb()：模拟「刚被 new Database() 建出来、还没建表」
      const empty = new Database(file);
      expect(
        (empty.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n,
      ).toBe(0);
      empty.close();

      const p = resolveDataDir(file);
      // ★ 与 (a) 逐项相同 —— 判据是「存在且是文件」，不是「里面有没有表」
      expect(p.defaultDbFile).toBe(file);
      expect(p.dataDir).toBe(dataDir);

      // 走完整流程：把 env 指向这个空库（真实升级/首发形态），播种 + 开库
      // ⇒ 空库被 createDb() 补齐成 13 表，且它就是 ws-default（不被另建一个 changxia.db）
      process.env.CHANGXIA_DB = file;
      closeAllWorkspaceDbs();
      const registry = openRegistry();
      seedDefaultWorkspace(registry);
      expect(findWorkspace(DEFAULT_WORKSPACE_ID, registry)!.db_file).toBe(file);
      const biz = openWorkspaceDb(DEFAULT_WORKSPACE_ID, registry);
      expect(
        (biz.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n,
      ).toBeGreaterThanOrEqual(13);
      // 反证：没有在旁边另建一个 changxia.db（那会是最难发现的「数据凭空消失」形态）
      expect(readdirSync(dataDir).filter((n) => n.endsWith('.db')).sort()).toEqual([
        'empty-lib.db',
        'workspaces.db',
      ]);
    });
  });
});

/* ══════════════════════ ① 空目录首发：注册表 + 播种 ══════════════════════ */

describe('① 空目录首发 ⇒ 注册表建出、ws-default 播种、db_file 指向 changxia.db', () => {
  it('★ 首发：注册表文件出现、listWorkspaces 恰一行、db_file = <dataDir>/changxia.db', () => {
    const registry = openRegistry();
    expect(existsSync(join(dataDir, 'workspaces.db'))).toBe(true);

    const first = seedDefaultWorkspace(registry);
    expect(first, '首次播种必须真的插入（否则「已经播过」与「没播」分不清）').toBe(true);

    const list = listWorkspaces(registry);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(list[0]!.name).toBe(DEFAULT_WORKSPACE_NAME);
    expect(list[0]!.dbFile).toBe(join(dataDir, 'changxia.db'));
    expect(list[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('★ 注册表库里**只有** workspaces 一张表（没长出 13 张业务表）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const tables = (
      registry.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toEqual(['workspaces']);
  });

  it('★ 播种行的 owner_member_id / gate_password_hash 均为 NULL（老区尚未解析 Owner）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const row = findWorkspace(DEFAULT_WORKSPACE_ID, registry)!;
    expect(row.owner_member_id).toBeNull();
    expect(row.gate_password_hash).toBeNull();
  });
});

/* ══════════════════════ ② 幂等 ══════════════════════ */

describe('② 幂等：连续播种不产生第二行、不报错', () => {
  it('★ 连调两次 ⇒ 第二次返回 false、仍只有一行、不抛错', () => {
    const registry = openRegistry();
    expect(seedDefaultWorkspace(registry)).toBe(true);
    // 第二次：既不抛错，也不写第二行
    expect(() => seedDefaultWorkspace(registry)).not.toThrow();
    expect(seedDefaultWorkspace(registry)).toBe(false);
    expect(listWorkspaces(registry)).toHaveLength(1);
  });

  it('★ 幂等路径不刷新 created_at / updated_at（审计价值不被启动次数稀释）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const before = findWorkspace(DEFAULT_WORKSPACE_ID, registry)!;
    seedDefaultWorkspace(registry);
    seedDefaultWorkspace(registry);
    const after = findWorkspace(DEFAULT_WORKSPACE_ID, registry)!;
    expect(after.created_at).toBe(before.created_at);
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('★ 用户改过工作区名后，重启播种不把名字重置回默认名', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    registry.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run('甲公司', DEFAULT_WORKSPACE_ID);
    seedDefaultWorkspace(registry);
    expect(findWorkspace(DEFAULT_WORKSPACE_ID, registry)!.name).toBe('甲公司');
  });
});

/* ══════════════════════ ③ user_version 不变 ══════════════════════ */

describe('③ user_version 不变（铁律：单一单调计数器不许被抢置）', () => {
  it('★ 注册表库的 user_version 恒为 0（只跑 REGISTRY 段，不跑 createDb）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    expect(registry.pragma('user_version', { simple: true })).toBe(0);
  });

  it('★ 播种 + 打开业务库前后，业务库 user_version 逐字节相同', () => {
    // 先把默认业务库按「今天的方式」建出来，记下 createDb 之后的值
    const bizFile = join(dataDir, 'changxia.db');
    const biz = openDb(bizFile);
    createDb(biz);
    const before = biz.pragma('user_version', { simple: true }) as number;
    expect(before).toBeGreaterThanOrEqual(3); // createDb 自己推到了 3/4 档
    biz.close();

    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const opened = openWorkspaceDb(DEFAULT_WORKSPACE_ID, registry);
    expect(opened.pragma('user_version', { simple: true })).toBe(before);
  });

  it('★ 老库（表结构全、v1 数据）经播种 + 打开后，done=1 仍被归一成 status=done', () => {
    // 造一个「v1 老库」：先按今天的方式建全表、按外键链条造一项目一阶段一任务，
    // 再把 user_version 归零模拟「③ done→status 还没跑」。
    const bizFile = join(dataDir, 'changxia.db');
    const legacy = new Database(bizFile);
    legacy.pragma('foreign_keys = ON'); // 与 openDb() 同口径，外键链条必须真实成立
    createDb(legacy);
    const ts = '2026-01-01T00:00:00.000Z';
    legacy
      .prepare(
        `INSERT INTO projects (id, name, type, address, client_name, contract_amount, signed_at,
           planned_start_at, planned_end_at, cover_color, revision, updated_at)
         VALUES ('p1','老项目','x','','',NULL,NULL,'2026-01-01','2026-02-01',NULL,1,?)`,
      )
      .run(ts);
    legacy
      .prepare(
        `INSERT INTO stages (id, project_id, order_index, name, ratio_percent, start_at, end_at,
           status, visible, revision, updated_at)
         VALUES ('s1','p1',1,'阶段一',100,'2026-01-01','2026-02-01','pending',1,1,?)`,
      )
      .run(ts);
    legacy
      .prepare(
        `INSERT INTO tasks (id, project_id, stage_id, title, done, order_index, revision, updated_at, status)
         VALUES ('t1','p1','s1','历史任务',1,0,1,?,'draft')`,
      )
      .run(ts);
    legacy.pragma('user_version = 0'); // 模拟「未跑过 ③ done→status」
    legacy.close();

    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const opened = openWorkspaceDb(DEFAULT_WORKSPACE_ID, registry);
    const row = opened.prepare('SELECT status FROM tasks WHERE id = ?').get('t1') as { status: string };
    expect(row.status, 'done=1 的归一被跳过 ⇒ 历史完成任务退回 draft').toBe('done');
  });
});

/* ══════════════════════ ④ 兼容模式：老库就是 ws-default ══════════════════════ */

describe('④ 兼容模式：CHANGXIA_DB 指向已存在的业务库 ⇒ ws-default 就是那个文件', () => {
  it('★ db_file 逐字节等于老文件路径，且老文件**未被复制**（目录里没有第二个业务库）', () => {
    // 造老库：先把它建出来、写一条数据
    const legacyFile = join(dataDir, 'legacy-changxia.db');
    const legacy = openDb(legacyFile);
    createDb(legacy);
    legacy
      .prepare(
        `INSERT INTO projects (id, name, type, address, client_name, contract_amount, signed_at,
           planned_start_at, planned_end_at, cover_color, revision, updated_at)
         VALUES ('p1','老项目','x','','',NULL,NULL,'2026-01-01','2026-02-01',NULL,1,'2026-01-01T00:00:00.000Z')`,
      )
      .run();
    legacy.close();

    // 换成兼容模式的 env（指向已存在的文件）
    process.env.CHANGXIA_DB = legacyFile;
    closeAllWorkspaceDbs();
    const paths = resolveDataDir();
    expect(paths.defaultDbFile).toBe(legacyFile);

    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const row = findWorkspace(DEFAULT_WORKSPACE_ID, registry)!;
    expect(row.db_file).toBe(legacyFile);

    // 打开它：老数据还在（零迁移）
    const opened = openWorkspaceDb(DEFAULT_WORKSPACE_ID, registry);
    const p = opened.prepare('SELECT name FROM projects WHERE id = ?').get('p1') as { name: string };
    expect(p.name).toBe('老项目');

    // 目录里没有「复制出来」的第二份业务库（只有老文件 + 注册表）
    const dbFiles = readdirSync(dataDir).filter((n) => n.endsWith('.db'));
    expect(dbFiles.sort()).toEqual(['legacy-changxia.db', 'workspaces.db']);
  });

  it('★ 不带 X-Workspace-Id 的老请求照常工作（回落 ws-default = 老库）', () => {
    const legacyFile = join(dataDir, 'legacy-changxia.db');
    const legacy = openDb(legacyFile);
    createDb(legacy);
    legacy.close();
    process.env.CHANGXIA_DB = legacyFile;
    closeAllWorkspaceDbs();

    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const resolved = resolveWorkspaceFromRequest({ headers: {} }, registry);
    expect(resolved.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(resolved.info.dbFile).toBe(legacyFile);
  });
});

/* ══════════════════════ ⑤ createWorkspace 成功路径 ══════════════════════ */

describe('⑤ createWorkspace 成功 ⇒ 注册表一行 + 库文件 + Owner + 回填两列', () => {
  it('★ 全链：ws-<id>.db 存在、members 有 admin Owner、scrypt 能验过、两列已回填', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);

    const created = createWorkspace(
      { name: '乙公司', ownerName: '乙负责人', password: 'sekret-1234' },
      registry,
      dataDir,
    );

    // ① 注册表多一行
    const list = listWorkspaces(registry);
    expect(list).toHaveLength(2);
    const row = findWorkspace(created.id, registry)!;
    expect(row.name).toBe('乙公司');
    expect(row.db_file).toBe(join(dataDir, `${created.id}.db`));
    expect(created.dbFile).toBe(row.db_file);

    // ② 库文件存在
    expect(existsSync(row.db_file)).toBe(true);
    expect(created.id.startsWith('ws-')).toBe(true);

    // ③ 该库 members 里有一条 role_kind='admin' 的 Owner
    const biz = openWorkspaceDb(created.id, registry);
    const owner = biz.prepare('SELECT * FROM members WHERE id = ?').get(created.ownerMemberId) as {
      name: string;
      role: string;
      role_kind: string;
      password_hash: string | null;
      active: number;
      actor_kind: string;
    };
    expect(owner.name).toBe('乙负责人');
    expect(owner.role_kind).toBe('admin');
    expect(owner.role).toBe('负责人');
    expect(owner.active).toBe(1);
    expect(owner.actor_kind).toBe('human');
    expect(owner.password_hash).not.toBeNull();

    // ④ password_hash 能被 scrypt 比对通过（错密码必须不过）
    expect(verifyPassword('sekret-1234', owner.password_hash)).toBe(true);
    expect(verifyPassword('sekret-12345', owner.password_hash)).toBe(false);

    // ⑤ 两列已回填，且 gate hash = Owner 的 hash（**同一个密码只存一份哈希**）
    expect(row.owner_member_id).toBe(created.ownerMemberId);
    expect(row.gate_password_hash).not.toBeNull();
    expect(row.gate_password_hash).toBe(owner.password_hash);

    // ⑥ 区闸密码可独立校验
    expect(readGateHash(created.id, registry)).toBe(owner.password_hash);
    expect(verifyGatePassword(created.id, 'sekret-1234', registry)).toBe(true);
    expect(verifyGatePassword(created.id, 'wrong', registry)).toBe(false);
    // 未登记的区：不抛、恒 false（存在性不从这里泄漏）
    expect(verifyGatePassword('ws-nope', 'sekret-1234', registry)).toBe(false);
  });

  it('★ 新区的库结构与老库逐字相同（同一个 createDb）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const created = createWorkspace({ name: '丙', ownerName: '丙', password: 'pw-0001' }, registry, dataDir);

    const biz = openWorkspaceDb(created.id, registry);
    const cols = (t: string): string[] =>
      (biz.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

    // 抽查三张表的关键列（含 v0.6/v0.8 后加的列 —— 证明走的是全量 createDb，不是手搓子集）
    expect(cols('members')).toEqual(
      expect.arrayContaining(['id', 'role_kind', 'password_hash', 'actor_kind', 'agent_kind']),
    );
    expect(cols('tasks')).toEqual(
      expect.arrayContaining(['external_id', 'status', 'run_id', 'task_no', 'itinerary_date']),
    );
    expect(cols('projects')).toEqual(
      expect.arrayContaining(['domain', 'kind', 'short_label', 'stage_preset_key']),
    );
    // 新区是**空白**的（不复制任何业务数据）
    expect((biz.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n).toBe(0);
  });

  it('★ 两个新区的数据互相隔离（各自的库文件、各自的成员）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const a = createWorkspace({ name: 'A', ownerName: '甲', password: 'pw-aaaa' }, registry, dataDir);
    const b = createWorkspace({ name: 'B', ownerName: '乙', password: 'pw-bbbb' }, registry, dataDir);
    expect(a.dbFile).not.toBe(b.dbFile);

    const dbA = openWorkspaceDb(a.id, registry);
    const dbB = openWorkspaceDb(b.id, registry);
    const namesA = (dbA.prepare('SELECT name FROM members').all() as Array<{ name: string }>).map((r) => r.name);
    const namesB = (dbB.prepare('SELECT name FROM members').all() as Array<{ name: string }>).map((r) => r.name);
    expect(namesA).toEqual(['甲']);
    expect(namesB).toEqual(['乙']);
  });
});

/* ══════════════════════ ⑥ createWorkspace 失败回滚 ══════════════════════ */

describe('⑥ createWorkspace 失败 ⇒ 注册表无残留行、无残留文件', () => {
  it('★ 入参非法（ownerName 空）⇒ 抛错、零残留', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const before = readdirSync(dataDir).sort();

    expect(() => createWorkspace({ name: '丁', ownerName: '   ', password: 'x' }, registry, dataDir)).toThrow(
      WorkspaceCreateError,
    );

    expect(listWorkspaces(registry)).toHaveLength(1); // 只有 ws-default
    expect(readdirSync(dataDir).sort()).toEqual(before);
  });

  it('★ 注册表写入失败（约束注入）⇒ 已建好的库文件被删、无残留行', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    // 注入一个必然失败的触发器：③④ 已完成（库文件 + Owner 已落盘），⑤ 才炸
    registry.exec(
      `CREATE TRIGGER inject_ws_fail BEFORE INSERT ON workspaces
       WHEN NEW.id <> 'ws-default'
       BEGIN SELECT RAISE(ABORT, 'injected registry failure'); END;`,
    );
    const before = readdirSync(dataDir).filter((n) => n.startsWith('ws-')).sort();

    let caught: unknown;
    try {
      createWorkspace({ name: '戊', ownerName: '戊', password: 'pw-1234' }, registry, dataDir);
    } catch (e) {
      caught = e;
    }
    registry.exec('DROP TRIGGER inject_ws_fail');

    expect(caught).toBeInstanceOf(WorkspaceCreateError);
    expect((caught as WorkspaceCreateError).field).toBe('storage');

    // 注册表无残留行
    expect(listWorkspaces(registry)).toHaveLength(1);
    // 无残留文件（含 -wal / -shm）
    expect(readdirSync(dataDir).filter((n) => n.startsWith('ws-')).sort()).toEqual(before);
  });

  it('★ 目标库文件已被占用 ⇒ 拒绝覆盖（不静默复用别人的库）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const uuid = '11111111-2222-4333-8444-555555555555';
    const occupied = join(dataDir, `ws-${uuid}.db`);
    writeFileSync(occupied, 'not-a-real-db-but-occupied');

    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(uuid as never);
    try {
      expect(() =>
        createWorkspace({ name: '己', ownerName: '己', password: 'pw-1234' }, registry, dataDir),
      ).toThrow(WorkspaceCreateError);
    } finally {
      spy.mockRestore();
    }
    // 占位文件没被覆盖，注册表也没多行
    expect(readdirSync(dataDir)).toContain(`ws-${uuid}.db`);
    expect(listWorkspaces(registry)).toHaveLength(1);
  });
});

/* ══════════════════════ ⑦ resolveWorkspaceFromRequest ══════════════════════ */

describe('⑦ resolveWorkspaceFromRequest：header 命中 / 不存在 ⇒ 404 / 无 header ⇒ 默认区', () => {
  it('⑦-1 带 header 命中 ⇒ 返回该区与其库句柄', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const created = createWorkspace({ name: '庚', ownerName: '庚', password: 'pw-1234' }, registry, dataDir);

    const resolved = resolveWorkspaceFromRequest(
      { headers: { [WORKSPACE_HEADER]: created.id } },
      registry,
    );
    expect(resolved.id).toBe(created.id);
    expect(resolved.info.name).toBe('庚');
    expect(resolved.db).toBe(openWorkspaceDb(created.id, registry)); // 同一个缓存句柄
  });

  it('⑦-2 带不存在的 id ⇒ 必须抛 WorkspaceNotFoundError（**绝不回落默认区**）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);

    let caught: unknown;
    try {
      resolveWorkspaceFromRequest({ headers: { [WORKSPACE_HEADER]: 'ws-does-not-exist' } }, registry);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WorkspaceNotFoundError);
    expect((caught as WorkspaceNotFoundError).workspaceId).toBe('ws-does-not-exist');
  });

  it('⑦-3 不带 header ⇒ ws-default（老客户端零改动）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    const resolved = resolveWorkspaceFromRequest({ headers: {} }, registry);
    expect(resolved.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(resolved.info.dbFile).toBe(join(dataDir, 'changxia.db'));
  });

  it('⑦-4 header 为空串 / 纯空白 / 数组形态 ⇒ 都按「没带」处理', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    expect(resolveWorkspaceFromRequest({ headers: { [WORKSPACE_HEADER]: '' } }, registry).id).toBe(
      DEFAULT_WORKSPACE_ID,
    );
    expect(resolveWorkspaceFromRequest({ headers: { [WORKSPACE_HEADER]: '   ' } }, registry).id).toBe(
      DEFAULT_WORKSPACE_ID,
    );
    expect(resolveWorkspaceFromRequest({ headers: { [WORKSPACE_HEADER]: [''] } }, registry).id).toBe(
      DEFAULT_WORKSPACE_ID,
    );
  });

  it('⑦-5 openWorkspaceDb 对未登记 id 同样抛错（不是返回默认库）', () => {
    const registry = openRegistry();
    seedDefaultWorkspace(registry);
    expect(() => openWorkspaceDb('ws-nope', registry)).toThrow(WorkspaceNotFoundError);
  });
});

/* ══════════════════════ 附：注册表不进备份清单的前提 ══════════════════════ */

describe('附 · 注册表是机器级元数据：不参与 /api/backup 的表映射', () => {
  it('★ schema.sql 的 REGISTRY 段与 TABLES / INDEXES 段互不包含', () => {
    // 反证「workspaces 不在业务库的 TABLES 段里」——否则每个业务库都会长出一张注册表
    // 表，而 /api/backup 的 dump 清单虽不含它，语义也已经错了。
    const ddl = readFileSync(join(__dirname, '..', 'server', 'schema.sql'), 'utf-8');
    expect(sectionOf(ddl, 'TABLES')).not.toContain('workspaces');
    expect(sectionOf(ddl, 'INDEXES')).not.toContain('workspaces');
    expect(sectionOf(ddl, 'REGISTRY')).toContain('CREATE TABLE IF NOT EXISTS workspaces');
  });

  it('★ 业务库跑完 createDb() 后**没有** workspaces 表', () => {
    const bizFile = join(dataDir, 'biz.db');
    mkdirSync(dataDir, { recursive: true });
    const biz = openDb(bizFile);
    createDb(biz);
    const tables = (
      biz.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).not.toContain('workspaces');
    biz.close();
  });
});
