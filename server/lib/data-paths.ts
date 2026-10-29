/**
 * 数据目录解析（多工作区 NAS 版 · 批 1 地基）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这个文件为什么单独存在（而不是写进 workspace-registry.ts）
 * ══════════════════════════════════════════════════════════════════════
 * `db.ts` 需要它（`openDb()` 的默认路径），`workspace-registry.ts` 也需要它
 * （算注册表/默认库/新区库的落点）。若把它写在 registry 里，`db.ts → registry`
 * 与 `registry → db.ts`（registry 要用 `createDb()`）就构成**ESM 循环依赖**。
 * 循环在本仓虽然靠函数声明提升能跑通，但它是「今天能跑、明天加一行模块级代码就炸」
 * 的那类隐患 —— 拆出本文件后依赖方向是单向的：
 *
 *     workspace-registry.ts ──→ db.ts ──→ lib/data-paths.ts
 *              └──────────────────────────→ lib/data-paths.ts
 *
 * `workspace-registry.ts` 再导出 `resolveDataDir`，对外**仍然只有一个入口**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * `CHANGXIA_DB` 的语义：从「一个文件」扩成「文件路径 or 目录」
 * ══════════════════════════════════════════════════════════════════════
 * 多工作区方案是「每区一个独立 SQLite 文件 + 一张注册表库」，于是环境变量必须同时
 * 说清两件事：**注册表放哪** 和 **默认区（ws-default）的业务库是哪个文件**。
 * 今天的部署（`ugn as/docker-compose.yaml`、`ugn as/Dockerfile.backend`）把它钉成
 * `CHANGXIA_DB=/data/changxia.db` —— 一个**文件路径**。所以判定规则必须做到：
 * 「老部署什么都不改，起来之后数据还在原来的那个文件里，一个字节都不搬」。
 *
 * 判定规则（**按序命中即返回**，四条）：
 *
 *   ① **未设置**（`undefined` / 空串 / 纯空白）
 *      → 数据目录 = `server/` 源码目录（今天 `openDb()` 的默认落点）
 *        默认业务库 = `<server>/changxia.db`（**与今天逐字相同**）
 *        注册表库   = `<server>/workspaces.db`
 *
 *   ② env 路径**以路径分隔符结尾**（`/data/` 这种写法意在目录，尽管它可能还没建）
 *      → 数据目录 = 该路径
 *        默认业务库 = `<env>/changxia.db`
 *        注册表库   = `<env>/workspaces.db`
 *
 *   ③ env 路径**存在且是目录**（NAS 上把 `CHANGXIA_DB=/data` 这么配）
 *      → 同上（数据目录 = 该路径）
 *
 *   ④ 其余全部情形 —— **存在且是文件**（老 NAS 升级）**或不存在**（首发）
 *      → 默认业务库 = env 路径**原样**（不复制、不搬移、不改名）
 *        数据目录   = `dirname(env 路径)`
 *        注册表库   = `<数据目录>/workspaces.db`
 *
 * ── 为什么 ④ 把「不存在」也当**文件路径**（而不是当目录）──
 * 首发场景 `CHANGXIA_DB=/data/changxia.db` 指向的文件一定还没被创建。若把「不存在」
 * 当目录，数据目录就会变成 `/data/changxia.db`，默认业务库落到
 * `/data/changxia.db/changxia.db` —— 这会同时破三件事：
 *   · `docker-compose.yaml` / `Dockerfile.backend` 注释里承诺的「备份就是复制
 *     `/data/changxia.db`」变成一句谎（它成了一个目录）；
 *   · 批 1 的「零行为变化」不成立（库路径变了）；
 *   · 用户在 NAS 上已经放好的 `/data` 权限/挂载口径全部要重算。
 * 而 env 的名字本来就叫 `CHANGXIA_DB`（一个**文件**），历史语义只有文件。所以：
 * **路径存在且是目录**才认作目录（这是本次新增的能力），其余一律保持文件语义。
 *
 * ── 业务表探测为什么不做 ──
 * 曾考虑「文件里有没有 projects/members 表」来判它是不是业务库。结论是**不需要**：
 * 规则 ④ 之下，「env 指向的已存在文件」**无条件**就是默认区的业务库 —— 无论它是
 * 老库（有业务表）还是空文件（`createDb()` 会补齐全量 schema）。多一次探测只会多一条
 * 「探测失败时走哪个分支」的隐藏路径。
 *
 * ── 绝对路径口径 ──
 * 三个返回值一律 `path.resolve()` 成**绝对路径**，注册表 `workspaces.db_file` 列也存
 * 绝对路径（`resolveDataDir()` 的输出即是唯一来源）。理由：`db_file` 必须能从注册表
 * 行**单独还原**出可用路径，不依赖「当时的 cwd 是什么」。代价是数据目录整体搬家后
 * 老行会指向旧位置 —— 该场景（整机迁移）由备份通道处理，不在本批范围。
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `server/` 源码目录（规则 ① 的落点） */
const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** 默认区业务库的文件名（今天 NAS 上的 `changxia.db`） */
export const DEFAULT_DB_FILENAME = 'changxia.db';

/** 注册表库的文件名 */
export const REGISTRY_DB_FILENAME = 'workspaces.db';

/** 数据目录解析结果（三个路径都是**绝对路径**） */
export interface ResolvedDataPaths {
  /** 注册表库与各区库所在的目录（新区库落在这里） */
  dataDir: string;
  /** 注册表库文件（只放 workspaces 表） */
  registryFile: string;
  /** ws-default 的业务库文件（= 今天 `openDb()` 打开的那个文件） */
  defaultDbFile: string;
}

/** env 取值是否算「未设置」（空串 / 纯空白与 undefined 同义，避免造出 `''` 路径） */
function isUnset(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

/** 路径是否「意在目录」：以分隔符结尾（两种分隔符都认，兼容 Windows 写法） */
function looksLikeDir(p: string): boolean {
  return p.endsWith(sep) || p.endsWith('/') || p.endsWith('\\');
}

/** 存在且是目录（不存在的路径在这里返回 false，交给规则 ④） */
function isExistingDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 解析数据目录（判定规则见文件头四条；纯函数，但会读文件系统判「存在且是目录」）。
 *
 * @param envValue `CHANGXIA_DB` 的取值；默认从 `process.env` 读（测试可显式传入）
 */
export function resolveDataDir(envValue: string | undefined = process.env.CHANGXIA_DB): ResolvedDataPaths {
  const raw = envValue;
  if (isUnset(raw)) {
    // ① 未设置：与今天 openDb() 的默认值逐字相同
    return {
      dataDir: SERVER_DIR,
      registryFile: join(SERVER_DIR, REGISTRY_DB_FILENAME),
      defaultDbFile: join(SERVER_DIR, DEFAULT_DB_FILENAME),
    };
  }
  const trimmed = raw!.trim();
  // 统一 resolve：相对路径按 cwd 解析（与 better-sqlite3 的既有行为一致），
  // 绝对路径顺带抹掉尾部分隔符与 `..` 段 —— 保证返回值在做键（注册表句柄缓存）
  // 与写 `db_file` 列时是**规范形**，不会因 `/data/` 与 `/data` 两种写法被当成两个目录。
  const asPath = resolve(trimmed);

  // ② 以分隔符结尾 ⇒ 意在目录（即便它还不存在）
  // ③ 存在且是目录 ⇒ 目录
  if (looksLikeDir(trimmed) || isExistingDir(asPath)) {
    const dataDir = asPath;
    return {
      dataDir,
      registryFile: join(dataDir, REGISTRY_DB_FILENAME),
      defaultDbFile: join(dataDir, DEFAULT_DB_FILENAME),
    };
  }

  // ④ 存在且是文件（老 NAS 升级）或不存在（首发）：env 路径原样就是默认业务库
  const dataDir = dirname(asPath);
  return {
    dataDir,
    registryFile: join(dataDir, REGISTRY_DB_FILENAME),
    defaultDbFile: asPath,
  };
}
