/**
 * 备份往返对 `settings` 表的保真 —— 特别是**宿主策略类键** `plugin.enabled.*`
 * （fake-indexeddb 环境，走真 `BackupService.exportAll` / `importAndReplace`）。
 *
 * ── 为什么单独开一个 spec ──
 * `tests/backup.roundtrip.spec.ts` 的**四个夹具的 `settings` 段全是 `[]`**；全仓唯一
 * 非空 settings 夹具（`tests/task-no.roundtrip.spec.ts`）只为 `TASK_NO_SEQ_KEY` 服务。
 * ⇒ 「导出 → 导入 → 再导出逐表全等」这条铁律**对 settings 表是空覆盖**：今天没有任何
 * spec 守着「一次备份往返不丢 `plugin.enabled.*`」。本文件把这个空洞填上。
 *
 * ── 锁的是什么语义 ──
 * 「全量备份 = 完整快照，恢复即还原」：导出侧 `settings` 是**整表**（`dumpTable('settings')`
 * / `settings.all()`），故包内**带** `plugin.enabled.*`，往返后必须仍在；反过来，
 * 包内**没有**某键 ⇒ 该键被清掉（**不是**「保留本机」）。两条一起锁，防止将来有人
 * 再给 `settings` 开「不参与替换的例外」——那会破坏逐表全等这条根基。
 *
 * 判别力（本 spec 的自证）：①②③ 的夹具都**显式带** `plugin.enabled.agent-board = false`
 * 且包内**不带** `plugin.enabled.weekly-report`，用「在场/缺席」两个方向夹住语义；
 * 值取 `false` 而非 `true`，因为 `false` 与 `manifest.defaultEnabled` 的回落表现相同，
 * 若断言写成「还原成默认值」会恒过 —— 这里断言的是**行本身在不在**与**逐字节等值**。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService } from '../src/core/services/backup.service';
import { pluginEnabledKey } from '../src/core/plugin/types';
import { buildDemoBackup, withHostPolicySettings } from '../src/core/demo/demoDataFactory';
import { emptyPackage } from './helpers/backup-fixture';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  // 与 backup.roundtrip.spec 同款隔离：vitest singleThread 下 fake-indexeddb 是
  // module 级单例，先跑的 spec 会残留行 ⇒ 每个用例先空包清库。
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/** 本 spec 的主角：宿主策略键之一。false 是刻意选的（见文件头「判别力」） */
const AGENT_BOARD = pluginEnabledKey('agent-board');
/** 对照组：**不**写进包的插件键，用来验「缺席即清掉」 */
const WEEKLY_REPORT = pluginEnabledKey('weekly-report');
/** 普通用户设置行（对照组：必须随包替换） */
const REST_POLICY = 'restPolicy';

const svc = (): BackupService => new BackupService(bundle);

const rowOf = (pkg: { data: { settings: Array<{ key: string; valueJson: string }> } }, key: string) =>
  pkg.data.settings.find((s) => s.key === key);

describe('备份往返：settings 表的宿主策略键保真', () => {
  it('① 导出侧带 plugin.enabled.<id>=false ⇒ 往返后该行仍在且仍为 false', async () => {
    await bundle.settings.set(AGENT_BOARD, false);
    await bundle.settings.set(REST_POLICY, { kind: 'double_off', anchorWeek: null });

    const exp1 = await svc().exportAll();
    // 前提断言：导出侧**必须**带这一行（这是「全量备份 = 完整快照」的前提；
    // 若将来有人把 settings 改成白名单导出，这一条会先红）
    expect(rowOf(exp1, AGENT_BOARD)?.valueJson, '导出包必须带 plugin.enabled.<id> 行').toBe('false');

    await svc().importAndReplace(exp1);

    expect(await bundle.settings.get(AGENT_BOARD), '往返后插件键丢了或值变了').toBe(false);
    expect(rowOf(await svc().exportAll(), AGENT_BOARD)?.valueJson, '再导出时该行必须还在').toBe('false');
  });

  it('② 反向对照：包内被改写过的**非插件** settings 行确实按包内内容替换', async () => {
    // 这条是 ① 的对照组：证明「插件键仍在」不是因为导入没做替换
    await bundle.settings.set(AGENT_BOARD, false);
    await bundle.settings.set(REST_POLICY, { kind: 'double_off', anchorWeek: null });

    const mutated = await svc().exportAll();
    mutated.data.settings = mutated.data.settings.map((s) =>
      s.key === REST_POLICY
        ? { key: s.key, valueJson: JSON.stringify({ kind: 'single_off', anchorWeek: 3 }), updatedAt: s.updatedAt }
        : s,
    );
    // 加固：先证明「变异确实生效」，否则下面那条断言可能因夹具写错而恒过
    expect(rowOf(mutated, REST_POLICY)?.valueJson).toContain('single_off');

    await svc().importAndReplace(mutated);

    expect(await bundle.settings.get(REST_POLICY), '非插件行没被包内内容替换').toEqual({
      kind: 'single_off',
      anchorWeek: 3,
    });
    expect(await bundle.settings.get(AGENT_BOARD), '同一次导入里插件键被连带弄丢').toBe(false);
  });

  it('③ 契约锁：包内**缺**某个插件键 ⇒ 该键被清掉（不是「保留本机」）', async () => {
    // 锁住「恢复即还原」：全量包就是完整快照，包内缺席 = 显式清空。
    // 有这条在，将来谁再想给 settings 开「不参与替换的例外」会当场撞红。
    await bundle.settings.set(AGENT_BOARD, false);
    await bundle.settings.set(WEEKLY_REPORT, true);

    const stripped = await svc().exportAll();
    stripped.data.settings = stripped.data.settings.filter((s) => s.key !== WEEKLY_REPORT);
    expect(rowOf(stripped, WEEKLY_REPORT), '夹具没剥干净').toBeUndefined();

    await svc().importAndReplace(stripped);

    expect(await bundle.settings.get(WEEKLY_REPORT), '包内缺席的键应当被清掉').toBeNull();
    expect(await bundle.settings.get(AGENT_BOARD), '在场的那行不该被连带弄丢').toBe(false);
  });

  /**
   * demo 包的身份键漂移锁。
   *
   * 为什么值得单钉：demo 包是**覆盖式整库替换**，它会连 members 一起换成 demo 自己的
   * 成员集；包里的 `settings.currentMemberId` 必须命中**这张新成员表**里的 active 成员，
   * 否则「本浏览器从未选过身份」的那一档（`useRepos.ts` 的 `localStorage ?? settings`
   * 兜底）会落到一个查无此人的 id 上 —— 而 `useFirstRunGate` 只在
   * `currentMemberId === null` 时才弹引导，悬挂 id 既进不去身份、也不会有人提示重选。
   * 今天实测自洽（`demo_admin` 在包里且是 admin），这条锁的是**将来改成员 id 或改这行
   * KV 值时的漂移**。
   */
  it('④ demo 包自洽：currentMemberId 必须命中包内 members 里的 active 成员', () => {
    const pkg = buildDemoBackup();
    const row = pkg.data.settings.find((s) => s.key === 'currentMemberId');
    expect(row, 'demo 包必须带 currentMemberId（否则首启身份没有兜底）').toBeTruthy();
    const id = JSON.parse(row!.valueJson) as string;
    expect(id, 'currentMemberId 必须是非空字符串').toBeTruthy();
    const hit = pkg.data.members.find((m) => m.id === id);
    expect(hit, `demo 包的 currentMemberId=${id} 在包内 members 里查无此人`).toBeTruthy();
    expect(hit!.active, 'currentMemberId 指向的成员必须是 active').toBe(true);
  });

  /**
   * **载入示例数据**这条具体路径（team-lead 清单第 4 条的服务级一半）。
   *
   * 真实链路：`useBackupIo.loadDemo` → `withHostPolicySettings(buildDemoBackup(), await repos.settings.all())`
   * → `validateBackupJson` → 二次确认 → `BackupService.importAndReplace` → 覆盖式整库替换。
   * 本用例从 `withHostPolicySettings` 起跑，覆盖「拼接对不对」+「导入后插件键在不在」；
   * 「应用真的走到这行拼接」由下面第 ⑥ 条的入口源码守门兜住。
   */
  it('⑤ 载入示例数据后：本机 plugin.enabled.* 仍在，且 demo 自己的 settings 行确实落库', async () => {
    // 本机现状（刻意与 demo 包取值**不同**，让「替换」可观测）：
    await bundle.settings.set(AGENT_BOARD, false);
    await bundle.settings.set(WEEKLY_REPORT, true);
    await bundle.settings.set(REST_POLICY, { kind: 'single_off', anchorWeek: 7 });

    const demo = withHostPolicySettings(buildDemoBackup(), await bundle.settings.all());
    // 前提断言：拼接确实把本机两个插件键都带进包了（否则下面两条会因夹具问题假绿）
    expect(demo.data.settings.filter((s) => s.key.startsWith(pluginEnabledKey(''))).map((s) => s.key).sort())
      .toEqual([AGENT_BOARD, WEEKLY_REPORT]);

    await svc().importAndReplace(demo);

    // 核心断言：整族开关仍在，且值逐字节未变（false 与 defaultEnabled 回落表现相同 ⇒ 看「行 + 值」）
    expect(await bundle.settings.get(AGENT_BOARD), '载入示例数据把插件键抹了').toBe(false);
    expect(await bundle.settings.get(WEEKLY_REPORT), '载入示例数据把插件键抹了').toBe(true);

    // 反向对照：demo 包自己的 settings 行确实覆盖了本机值 ⇒ 证明这次导入真做了整表替换，
    // 上面两条不是「导入没生效」换来的
    expect(await bundle.settings.get(REST_POLICY), 'demo 包的 settings 行没落库').toEqual({
      kind: 'double_off',
      anchorWeek: null,
    });
  });

  /**
   * 入口源码守门（第 4 条的「链路真的走到」一半，服务级）
   *
   * 为什么用源码断言而不是渲染组件：三条 demo 入口（Sidebar / MobileMoreMenu /
   * FirstRunGuide，加上新增的 SampleProjectsSettings）**全部收敛到同一个 `loadDemo` 函数体**，
   * 所以只需要钉住这一处；渲染四个入口的重型浏览器用例留给出厂前的真机闸。
   */
  it('⑥ 入口守门：loadDemo 必须用 withHostPolicySettings 包住工厂，且只包一次', () => {
    const src = readFileSync(
      resolve(__dirname, '..', 'src/components/layout/useBackupIo.tsx'),
      'utf8',
    );
    expect(src, '载入示例数据没走宿主策略合并').toContain('withHostPolicySettings(buildDemoBackup()');
    expect(src, '没读本机 settings，合并拿不到现有 plugin.enabled.*').toContain('repos.settings.all()');

    // 只扫**代码行**（注释里会出现 `buildDemoBackup()` 这个字面，按全文件计数会误判）。
    const codeLines = src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      });
    const wrapped = codeLines.filter((l) => l.includes('withHostPolicySettings(buildDemoBackup()'));
    const bare = codeLines.filter((l) => /=\s*buildDemoBackup\(\)/.test(l));
    expect(wrapped.length, 'loadDemo 里的合并调用不见了').toBe(1);
    // 防回潮：再冒出一处绕过合并的裸调用，这条会红
    expect(bare.length, '出现了绕过 withHostPolicySettings 的裸 buildDemoBackup() 赋值').toBe(0);
  });
});
