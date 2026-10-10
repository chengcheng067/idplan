// @vitest-environment jsdom
/**
 * 打印偏好 store · roundtrip 回归闸（2026-10-10 补）
 *
 * 背景（verify-naming-debt 独立验证发现）：期二以来旧读路径对 pages 键无条件跑
 * migrateLegacyPages，而落库的已是 PrintModuleId——PAGE_TO_MODULE 键表里没有
 * stage-list / task-list / agent-execution / artifact-list 这 4 个模块 id，凡勾选
 * 含其一 ⇒ 整组返回 null ⇒ **刷新即静默丢勾选**。46 例 L1 测试全绿却没抓住它，
 * 因为只断言了「落库形状」，没有「落库 → rehydrate → 读回」的 roundtrip 用例。
 * 8111181（store 字段 pages→modules，读 modules 键走 normalizeModules）顺带修复。
 *
 * 本文件钉三件事：
 *   1. roundtrip 保真——含旧 bug 会丢的勾选组（回归闸）
 *   2. 双写镜像——pages 与 modules 同值落库（任何只认 pages 的读者零变化）
 *   3. 脏 modules 夹具——modules 键存在但值脏 ⇒ 该模板回落默认、不崩溃、
 *      不连坐其他模板；**不**回落 pages（设计语义：modules 键存在即正主）。
 *      正常流程双键同源原子写，此坑仅外部改坏 localStorage 可触发，失败形态
 *      是回落默认勾选，不是数据结构损坏。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  PRINT_PREFS_STORAGE_KEY,
  usePrintPrefsStore,
} from '../src/store/usePrintPrefsStore';

import type { PrintModuleId } from '../src/components/print/print-templates';

/** 排空 zustand persist 的 thenable 写链（异步一拍） */
async function flushPersist(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** persist.rehydrate()——模拟「刷新后重新读 localStorage」的路径 */
async function rehydrate(): Promise<void> {
  const persistApi = (usePrintPrefsStore as unknown as {
    persist: { rehydrate: () => Promise<void> };
  }).persist;
  await persistApi.rehydrate();
}

/** 每例从干净默认起手（含排空起手时的异步写） */
beforeEach(async () => {
  localStorage.clear();
  usePrintPrefsStore.setState({
    blocks: { header: true, timeline: true, projectInfo: true, stageTable: true, footer: true },
    template: 'classic',
    modules: {},
    palette: {},
  });
  await flushPersist();
});

describe('打印偏好 · roundtrip 回归闸（落库 → rehydrate → 读回）', () => {
  it('A 版勾选含 stage-list/task-list：roundtrip 保真（旧版此处刷新即丢，回归闸）', async () => {
    // 旧 bug 夹具：这三个 id 里 stage-list / task-list 不在 PAGE_TO_MODULE 键表
    // ⇒ 旧读路径整组 migrate 失败返回 null ⇒ rehydrate 后 undefined（丢勾选）
    usePrintPrefsStore.setState({
      template: 'swiss-schedule',
      modules: { 'swiss-schedule': ['stage-list', 'task-list', 'member-roster'] },
    });
    await flushPersist();

    await rehydrate();

    expect(usePrintPrefsStore.getState().modules['swiss-schedule']).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
    ]);
  });

  it('H 版勾通用模块 stage-list：roundtrip 保真（旧版同理丢）', async () => {
    usePrintPrefsStore.setState({
      template: 'agent-poster',
      modules: { 'agent-poster': ['agent-execution', 'stage-list'] },
    });
    await flushPersist();

    await rehydrate();

    // normalizeModules 按 PRINT_MODULE_IDS 注册序收编（M1→M11）⇒ stage-list 在前
    expect(usePrintPrefsStore.getState().modules['agent-poster']).toEqual([
      'stage-list',
      'agent-execution',
    ]);
  });

  it('双写镜像落库：pages 与 modules 同值（只认 pages 的旧读者零变化）', async () => {
    usePrintPrefsStore.setState({
      template: 'swiss-schedule',
      modules: { 'swiss-schedule': ['stage-list', 'task-list', 'member-roster'] },
    });
    await flushPersist();

    const raw = localStorage.getItem(PRINT_PREFS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      state: { pages: Record<string, PrintModuleId[]>; modules: Record<string, PrintModuleId[]> };
    };
    expect(parsed.state.modules['swiss-schedule']).toEqual(['stage-list', 'task-list', 'member-roster']);
    expect(parsed.state.pages['swiss-schedule']).toEqual(parsed.state.modules['swiss-schedule']);
  });

  it('脏 modules 夹具：值脏 ⇒ 该模板回落默认（不崩溃、不连坐其他模板）', async () => {
    // modules 键存在但 swiss-schedule 槽位是脏值；data-editorial 槽位是好数据。
    // 预期：脏槽位不收（undefined ⇒ 消费侧走默认原生签名页），好槽位保住。
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: {
          template: 'swiss-schedule',
          pages: { 'swiss-schedule': ['stage-list', 'task-list'] },
          modules: {
            'swiss-schedule': 'not-an-array',
            'data-editorial': ['progress-matrix', 'milestone-acceptance'],
          } as unknown as Record<string, PrintModuleId[]>,
        },
        version: 0,
      }),
    );

    await rehydrate();

    const state = usePrintPrefsStore.getState();
    expect(state.modules['swiss-schedule'], '脏槽位不收 ⇒ 缺键走默认原生集').toBeUndefined();
    expect(state.modules['data-editorial'], '同键其他模板的好数据不连坐').toEqual([
      'progress-matrix',
      'milestone-acceptance',
    ]);
  });

  it('脏 modules + 好旧 pages：不回落 pages（modules 键存在即正主——钉住语义防漂移）', async () => {
    // 极端组合（正常双写不可分叉，仅手改 localStorage 可造）：modules 脏、
    // pages 里有旧版好数据。当前设计：modules 存在就不回落 pages，脏槽位
    // 直接回落默认。钉住这个语义——若未来想改成「脏则回落 pages」，改这里。
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: {
          template: 'swiss-schedule',
          pages: { 'swiss-schedule': ['stage-list', 'task-list'] },
          modules: { 'swiss-schedule': 42 } as unknown as Record<string, PrintModuleId[]>,
        },
        version: 0,
      }),
    );

    await rehydrate();

    const state = usePrintPrefsStore.getState();
    expect(state.modules['swiss-schedule'], '不回落 pages，回落默认（缺键）').toBeUndefined();
  });

  it('modules 整键为脏标量：全部模板回落默认，不崩溃', async () => {
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: { template: 'swiss-schedule', modules: 'garbage' } as unknown as object,
        version: 0,
      }),
    );

    await rehydrate();

    const state = usePrintPrefsStore.getState();
    expect(state.modules['swiss-schedule']).toBeUndefined();
    expect(state.template, 'template 合法值照常收').toBe('swiss-schedule');
  });
});
