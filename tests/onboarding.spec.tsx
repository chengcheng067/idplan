// @vitest-environment jsdom
/**
 * 新手引导（onboarding）竖切样板第一批 · 行为钉。
 *
 * 覆盖（设计稿 onboarding-design-2026-10-30.md §二/§三/§四/§五/§七）：
 *   ① 自动闸门：全新数据库（done=false 显式标记）+ 已进身份 → 自动弹；
 *      老库无记录（done=null）→ 绝不自动弹（§二拍板）；
 *   ② 第一屏选模式：两卡对等 + 选线写 onboarding.mode；
 *   ③ 简单介绍线：6 卡 + 开始使用写 done；
 *   ④ 分步线：壳（步骤条/上下步/跳过）+ 8 步全部真实内容（第二批：每步插画
 *      与 3 条亮点，无占位残留）；跳过写 done；
 *   ⑤ 完成页：管理员双出口 / 成员单出口，都写 done；「新建第一个项目」拉起建档；
 *   ⑥ 重看直进：记忆 mode 后不再回第一屏（§三「选中即记住」）；
 *   ⑦ 播种字面量守卫：服务端 / 桌面建库两处的 'onboarding.done' 与 keys.ts 一致；
 *   ⑧ demo 载入保住 onboarding.*（宿主策略族，覆盖式导入不抹进度）。
 *
 * 定位一律 data-* 钩子（本仓铁律：不按中文文案定位）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import type { ReactNode } from 'react';

const settingsSetSpy = vi.fn(async (_key: string, _value: unknown): Promise<void> => undefined);
vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => ({ settings: { set: settingsSetSpy } }),
}));

const roleState = { isAdmin: true };
vi.mock('../src/hooks/useRoleGuard', () => ({
  useRoleGuard: () => ({ ...roleState, isMember: !roleState.isAdmin, hasAdmin: true }),
}));

import { OnboardingOverlay } from '../src/components/onboarding/OnboardingOverlay';
import { useOnboardingGate } from '../src/hooks/useOnboardingGate';
import { useOnboardingStore } from '../src/store/useOnboardingStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { setLang } from '../src/i18n';
import { withHostPolicySettings } from '../src/core/demo/demoDataFactory';
import { ONBOARDING_DONE_KEY, ONBOARDING_MODE_KEY } from '../src/core/onboarding/keys';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/**
 * 挂载助手（**先卸后挂**）。
 *
 * 为什么要卸旧根：上一条用例 `document.body.innerHTML = ''` 只是把容器**摘出文档**，
 * 那个 React root 并未 unmount，仍然订阅着 store —— 下一条用例改 store 时它会
 * 在 act 之外重渲染，刷一屏 `not wrapped in act(...)` 警告（这类噪声会掩盖真实错误，
 * 是本仓既有教训）。故每次挂载前显式卸掉上一个根。
 */
let mountedRoot: Awaited<ReturnType<typeof import('react-dom/client').createRoot>> | null = null;

async function renderInto(el: HTMLElement, node: ReactNode): Promise<void> {
  if (mountedRoot !== null) {
    const stale = mountedRoot;
    mountedRoot = null;
    await act(async () => {
      stale.unmount();
    });
  }
  await act(async () => {
    const { createRoot } = await import('react-dom/client');
    mountedRoot = createRoot(el);
    mountedRoot.render(node);
  });
}

/** 闸门探针：只挂 hook，行为读 store */
function GateProbe(): JSX.Element {
  useOnboardingGate();
  return <div data-gate-probe="" />;
}

function resetStores(): void {
  useSettingsStore.setState({ hydrated: true, currentMemberId: 'm-spec' });
  useOnboardingStore.setState({ done: null, mode: null, overlayOpen: false });
  useUiStore.setState({ manualFormOpen: false });
  settingsSetSpy.mockClear();
}

/**
 * 清场（每条用例**先跑**）：卸掉上一条用例挂的 React root。
 * 顺序很重要 —— 必须先卸再 `resetStores()`：还挂着的组件订阅着 store，
 * 在 act 外改 store 就会刷 `not wrapped in act(...)` 警告（噪声会掩盖真实错误）。
 */
async function resetStage(): Promise<void> {
  if (mountedRoot !== null) {
    const stale = mountedRoot;
    mountedRoot = null;
    await act(async () => {
      stale.unmount();
    });
  }
  localStorage.clear();
  document.body.innerHTML = '';
}

describe('新手引导 · 自动闸门（useOnboardingGate）', () => {
  let container: HTMLElement;
  beforeEach(async () => {
    await resetStage();
    container = document.createElement('div');
    document.body.appendChild(container);
    resetStores();
  });

  it('① 全新数据库（done=false）+ 已进身份 → 自动弹（§二拍板）', async () => {
    useOnboardingStore.setState({ done: false });
    await renderInto(container, <GateProbe />);
    expect(useOnboardingStore.getState().overlayOpen).toBe(true);
  });

  it('② 老库无记录（done=null）→ 不弹（升级用户视为已看过）', async () => {
    await renderInto(container, <GateProbe />);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
  });

  it('③ 已看完（done=true）→ 不弹', async () => {
    useOnboardingStore.setState({ done: true });
    await renderInto(container, <GateProbe />);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
  });

  it('④ 未进身份 → 不弹（§二：身份选定之后才引导）', async () => {
    useSettingsStore.setState({ currentMemberId: null });
    useOnboardingStore.setState({ done: false });
    await renderInto(container, <GateProbe />);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
  });

  it('⑤ 未装载（hydrated=false）→ 不弹（done 镜像尚未就绪，防提前误判）', async () => {
    useSettingsStore.setState({ hydrated: false });
    useOnboardingStore.setState({ done: false });
    await renderInto(container, <GateProbe />);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
  });
});

describe('新手引导 · 第一屏（选模式）', () => {
  let container: HTMLElement;
  beforeEach(async () => {
    await resetStage();
    container = document.createElement('div');
    document.body.appendChild(container);
    resetStores();
    useOnboardingStore.setState({ done: false, overlayOpen: true });
  });

  it('① 两张模式卡对等在场，选「快速了解」写 onboarding.mode 并进入简单线', async () => {
    await renderInto(container, <OnboardingOverlay />);
    expect(document.querySelector('[data-onboarding-mode-quick]')).toBeTruthy();
    expect(document.querySelector('[data-onboarding-mode-steps]')).toBeTruthy();
    await act(async () => {
      (document.querySelector('[data-onboarding-mode-quick]') as HTMLButtonElement).click();
    });
    expect(settingsSetSpy).toHaveBeenCalledWith(ONBOARDING_MODE_KEY, 'quick');
    expect(document.querySelector('[data-onboarding-screen="quick"]')).toBeTruthy();
  });

  it('② 选「分步引导」直接进入步骤 1（看板）', async () => {
    await renderInto(container, <OnboardingOverlay />);
    await act(async () => {
      (document.querySelector('[data-onboarding-mode-steps]') as HTMLButtonElement).click();
    });
    expect(settingsSetSpy).toHaveBeenCalledWith(ONBOARDING_MODE_KEY, 'steps');
    expect(document.querySelector('[data-onboarding-screen="steps"]')).toBeTruthy();
    expect(document.querySelector('[data-onboarding-step-content="board"]')).toBeTruthy();
  });
});

describe('新手引导 · 简单介绍线（单屏 6 卡）', () => {
  let container: HTMLElement;
  beforeEach(async () => {
    await resetStage();
    container = document.createElement('div');
    document.body.appendChild(container);
    resetStores();
    useOnboardingStore.setState({ done: false, mode: 'quick', overlayOpen: true });
  });

  it('① 重看直进简单线（不再回第一屏），6 张功能卡齐', async () => {
    await renderInto(container, <OnboardingOverlay />);
    expect(document.querySelector('[data-onboarding-screen="welcome"]')).toBeNull();
    expect(document.querySelector('[data-onboarding-screen="quick"]')).toBeTruthy();
    for (const hook of ['board', 'calendar', 'print', 'members', 'backup', 'agent']) {
      expect(document.querySelector(`[data-onboarding-feature="${hook}"]`)).toBeTruthy();
    }
  });

  it('② 「开始使用」写 onboarding.done 并关闭覆盖层', async () => {
    await renderInto(container, <OnboardingOverlay />);
    await act(async () => {
      (document.querySelector('[data-onboarding-quick-start]') as HTMLButtonElement).click();
    });
    expect(settingsSetSpy).toHaveBeenCalledWith(ONBOARDING_DONE_KEY, true);
    expect(useOnboardingStore.getState().done).toBe(true);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
  });

  it('③ 「改看详细引导」切线不丢进度（同会话换屏）', async () => {
    await renderInto(container, <OnboardingOverlay />);
    await act(async () => {
      (document.querySelector('[data-onboarding-quick-switch]') as HTMLButtonElement).click();
    });
    expect(document.querySelector('[data-onboarding-screen="steps"]')).toBeTruthy();
    expect(useOnboardingStore.getState().mode).toBe('quick');
  });
});

describe('新手引导 · 分步线（壳 + 步骤 1 看板）', () => {
  let container: HTMLElement;
  const click = (sel: string): Promise<void> =>
    act(async () => {
      (document.querySelector(sel) as HTMLButtonElement | null)?.click();
    });

  beforeEach(async () => {
    await resetStage();
    container = document.createElement('div');
    document.body.appendChild(container);
    resetStores();
    useOnboardingStore.setState({ done: false, mode: 'steps', overlayOpen: true });
  });

  it('① 步骤 1：看板内容在场，8 段步骤条 + 「第 1 步，共 8 步」，上一步禁用', async () => {
    await renderInto(container, <OnboardingOverlay />);
    expect(document.querySelector('[data-onboarding-step-content="board"]')).toBeTruthy();
    expect(document.querySelector('[data-onboarding-step-art="board"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-onboarding-step-dot]').length).toBe(8);
    expect(
      (document.querySelector('[data-onboarding-prev]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain('第 1 步，共 8 步');
  });

  it('② 下一步到第 2 步：月历真实内容（插画 + 亮点 ≥2 条），上一步可用', async () => {
    await renderInto(container, <OnboardingOverlay />);
    await click('[data-onboarding-next]');
    expect(document.querySelector('[data-onboarding-step-content="calendar"]')).toBeTruthy();
    expect(document.querySelector('[data-onboarding-step-art="calendar"]')).toBeTruthy();
    expect(
      document.querySelectorAll('[data-onboarding-step-highlights="calendar"] li').length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (document.querySelector('[data-onboarding-prev]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('③ 上一步回到第 1 步', async () => {
    await renderInto(container, <OnboardingOverlay />);
    await click('[data-onboarding-next]');
    await click('[data-onboarding-prev]');
    expect(document.querySelector('[data-onboarding-step-content="board"]')).toBeTruthy();
  });

  it('③b ★ 8 步全部是真实内容：逐步走完，每步 content+art 钩子齐、亮点 3 条、无占位残留', async () => {
    const ids = ['board', 'calendar', 'timeline', 'print', 'members', 'backup', 'agent', 'plugins'];
    await renderInto(container, <OnboardingOverlay />);
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!;
      expect(
        document.querySelector(`[data-onboarding-step-content="${id}"]`),
        `步骤 ${i + 1}（${id}）内容锚缺失`,
      ).toBeTruthy();
      expect(
        document.querySelector(`[data-onboarding-step-art="${id}"]`),
        `步骤 ${i + 1}（${id}）插画缺失`,
      ).toBeTruthy();
      expect(
        document.querySelectorAll(`[data-onboarding-step-highlights="${id}"] li`).length,
        `步骤 ${i + 1}（${id}）亮点条数`,
      ).toBe(3);
      if (i < ids.length - 1) await click('[data-onboarding-next]');
    }
    // 占位已清干净：不存在 placeholder 插画与占位文案键的消费点
    expect(document.querySelector('[data-onboarding-step-art="placeholder"]')).toBeNull();
  });

  it('③c ★ 每步插画带 2~4 个 i18n 文字标签（data-art-label 计数，语言无关）', async () => {
    const ids = ['board', 'calendar', 'timeline', 'print', 'members', 'backup', 'agent', 'plugins'];
    await renderInto(container, <OnboardingOverlay />);
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!;
      const labels = Array.from(
        document.querySelectorAll(`[data-onboarding-step-art="${id}"] [data-art-label]`),
      );
      expect(labels.length, `步骤 ${i + 1}（${id}）插画标签数应在 2~4`).toBeGreaterThanOrEqual(2);
      expect(labels.length, `步骤 ${i + 1}（${id}）插画标签数应在 2~4`).toBeLessThanOrEqual(4);
      // 标签必须有实际文本（键取到了值，不是空串/键名）
      for (const el of labels) {
        expect((el.textContent ?? '').trim(), `步骤 ${i + 1} 有标签是空串`).not.toBe('');
      }
      if (i < ids.length - 1) await click('[data-onboarding-next]');
    }
  });

  it('④ 第 8 步「下一步」进完成页；成员身份只有「先随便看看」一个出口，写 done', async () => {
    await renderInto(container, <OnboardingOverlay />);
    for (let i = 0; i < 8; i += 1) {
      await click('[data-onboarding-next]');
    }
    expect(document.querySelector('[data-onboarding-screen="finish"]')).toBeTruthy();
    // 切到成员身份重挂：建档 CTA 不渲染（2026-10-27 收口口径），只剩一条出路
    roleState.isAdmin = false;
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    await renderInto(container, <OnboardingOverlay />);
    for (let i = 0; i < 8; i += 1) {
      await click('[data-onboarding-next]');
    }
    expect(document.querySelector('[data-onboarding-finish-new-project]')).toBeNull();
    await click('[data-onboarding-finish-look-around]');
    expect(settingsSetSpy).toHaveBeenCalledWith(ONBOARDING_DONE_KEY, true);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
    roleState.isAdmin = true;
  });

  it('⑤ 管理员完成页：双出口都在；「新建第一个项目」写 done 并拉起建档向导', async () => {
    await renderInto(container, <OnboardingOverlay />);
    for (let i = 0; i < 8; i += 1) {
      await click('[data-onboarding-next]');
    }
    expect(document.querySelector('[data-onboarding-finish-new-project]')).toBeTruthy();
    await click('[data-onboarding-finish-new-project]');
    expect(settingsSetSpy).toHaveBeenCalledWith(ONBOARDING_DONE_KEY, true);
    expect(useUiStore.getState().manualFormOpen).toBe(true);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
  });

  it('⑥ 跳过（分步线头部）写 done 并关闭', async () => {
    await renderInto(container, <OnboardingOverlay />);
    await click('[data-onboarding-skip]');
    expect(settingsSetSpy).toHaveBeenCalledWith(ONBOARDING_DONE_KEY, true);
    expect(useOnboardingStore.getState().overlayOpen).toBe(false);
  });
});

describe('新手引导 · 插画标签的双语来源（不写死中文）', () => {
  let container: HTMLElement;
  beforeEach(async () => {
    await resetStage();
    container = document.createElement('div');
    document.body.appendChild(container);
    resetStores();
  });

  it('① 中文模式：看板标签 = 项目名 / 阶段 / 成员 / 进度（四枚）', async () => {
    useOnboardingStore.setState({ done: false, mode: 'steps', overlayOpen: true });
    await renderInto(container, <OnboardingOverlay />);
    // 排序后比较：标签在 DOM 里的先后由 SVG 绘制顺序决定（不是文案顺序），
    // 断言的是"这四枚都在"，不锁位置
    const textOf = (): string[] =>
      Array.from(document.querySelectorAll('[data-onboarding-step-art="board"] [data-art-label]'))
        .map((el) => (el.textContent ?? '').trim())
        .sort();
    expect(textOf()).toEqual(['成员', '进度', '项目名', '阶段'].sort());
  });

  it('② ★ 英文模式：同一批标签切成英文，且不含任何中文（键来源而非字面量）', async () => {
    // 包 act：setLang 会触发已挂载组件重渲染（React 会警告 update not wrapped in act）
    await act(async () => {
      setLang('en');
    });
    useOnboardingStore.setState({ done: false, mode: 'steps', overlayOpen: true });
    await renderInto(container, <OnboardingOverlay />);
    const labels = Array.from(
      document.querySelectorAll('[data-onboarding-step-art="board"] [data-art-label]'),
    );
    expect(labels.length).toBe(4);
    const text = labels.map((el) => (el.textContent ?? '')).join(' ');
    expect(text, `英文态标签里出现中文：${text}`).not.toMatch(/[一-鿿]/);
    expect(
      labels.map((el) => (el.textContent ?? '').trim()).sort(),
    ).toEqual(['Member', 'Progress', 'Project', 'Stage']);
    await act(async () => {
      setLang('zh'); // 还原，别把语言状态漏给后续用例
    });
  });

  it('③ 看板插画是 4 条轨道（我们是 4 列看板，不是 3 列）', async () => {
    useOnboardingStore.setState({ done: false, mode: 'steps', overlayOpen: true });
    await renderInto(container, <OnboardingOverlay />);
    const art = document.querySelector('[data-onboarding-step-art="board"]') as SVGElement;
    // 轨道 = 高 240 的纸面轨道 rect（任务卡/胶囊/进度条都更矮，不会误命中）
    const tracks = Array.from(art.querySelectorAll('rect')).filter(
      (r) => r.getAttribute('height') === '240',
    );
    expect(tracks.length, '看板插画轨道数').toBe(4);
  });
});

describe('新手引导 · 播种与保活（字面量 / 宿主策略族）', () => {
  it("① 桌面建库 / 服务端建库 / keys.ts 三处 'onboarding.done' 字面量一致", () => {
    expect(read('src/core/onboarding/keys.ts')).toContain("ONBOARDING_DONE_KEY = 'onboarding.done'");
    expect(read('src/core/repositories/local/workspace.db.ts')).toContain('ONBOARDING_DONE_KEY');
    // 服务端不跨包 import（独立 tsconfig），字面量旁注释指回 keys.ts，由本条锁住一致
    expect(read('server/workspace-registry.ts')).toContain("'onboarding.done'");
  });

  it('② demo 载入保住 onboarding.*（宿主策略族，覆盖式导入不抹进度）', () => {
    const pkg = {
      meta: { app: 'changxia', schemaVersion: 3, exportedAt: 't' },
      data: {
        projects: [],
        stages: [],
        tasks: [],
        members: [],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [
          { key: 'currentMemberId', valueJson: '"demo_admin"', updatedAt: 't' },
          { key: 'restPolicy', valueJson: '{}', updatedAt: 't' },
        ],
      },
    } as unknown as Parameters<typeof withHostPolicySettings>[0];
    const merged = withHostPolicySettings(pkg, [
      { key: ONBOARDING_DONE_KEY, valueJson: 'false', updatedAt: 't' },
      { key: ONBOARDING_MODE_KEY, valueJson: '"steps"', updatedAt: 't' },
      { key: 'plugin.enabled.demo', valueJson: 'true', updatedAt: 't' },
      { key: 'restPolicy', valueJson: '{}', updatedAt: 't' },
    ]);
    const keys = merged.data.settings.map((s) => s.key);
    expect(keys).toContain(ONBOARDING_DONE_KEY);
    expect(keys).toContain(ONBOARDING_MODE_KEY);
    expect(keys).toContain('plugin.enabled.demo');
  });

  it('③ 设置 → 关于 有重看入口（data 钩子 + 打开动作接 store）', () => {
    const src = read('src/components/layout/SettingsDialog.tsx');
    expect(src).toContain('data-onboarding-replay');
    expect(src).toContain('useOnboardingStore.getState().openOverlay()');
  });
});
