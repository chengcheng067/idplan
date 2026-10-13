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

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService } from '../src/core/services/backup.service';
import { pluginEnabledKey } from '../src/core/plugin/types';
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
});
