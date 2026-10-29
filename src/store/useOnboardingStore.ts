import { create } from 'zustand';

import { isOnboardingMode, type OnboardingMode } from '../core/onboarding/keys';

/**
 * 新手引导（onboarding）状态 —— settings KV 的**内存镜像 + 会话级浮层开关**。
 *
 * ── 与 settings 表的分工（与 restPolicy 同一范式）──
 * 持久化只有一份：settings KV（`onboarding.done` / `onboarding.mode`，键名出处
 * `src/core/onboarding/keys.ts`）。**本 store 不落 localStorage、不建新表**：
 *   · 读：`bootstrapAllStores`（useRepos.ts）从 settings 全量行里解析后注入
 *     （`hydrateFromSettings`）；
 *   · 写：组件（OnboardingOverlay）经 `repos.settings.set(...)` 落库后调用本 store
 *     的镜像 action —— 与 RestPolicyDialog 的「先落库再同步镜像」完全同构。
 *
 * ── done 的三态（自动弹出的唯一判据，详见 core/onboarding/keys.ts）──
 *   `true`  ⇒ 看完/跳过，不再自动弹（设置 → 关于 可手动重看）；
 *   `false` ⇒ **全新数据库**的显式标记（建区/首次确立管理员时播种）⇒ 身份选定后自动弹；
 *   `null`  ⇒ 尚未 hydrate，或老库无记录（= 视为已看过，**不弹**——设计稿 §二拍板）。
 *
 * ⚠️ 初始值刻意取 `null` 而不是 `false`：bootstrap 前的任何 Effect 都可能跑，
 *    初始 false 会让闸门在装载完成前误判「新库」而提前弹出。
 *
 * ── overlayOpen（会话级，不持久化）──
 * 打开方有两个：`useOnboardingGate`（自动：hydrated ∧ 已进身份 ∧ done===false）
 * 与设置 → 关于 的「重新查看新手引导」（手动）。关闭即整体卸载浮层。
 */
export interface OnboardingState {
  /** settings `onboarding.done` 的镜像；语义见文件头三态 */
  done: boolean | null;
  /** settings `onboarding.mode` 的镜像：用户上次选的线（重看时直接进那条线） */
  mode: OnboardingMode | null;
  /** 引导覆盖层是否打开（全屏覆盖层，非弹窗） */
  overlayOpen: boolean;

  /** bootstrap 装载：把 settings 表里解析出的两键注入镜像（脏值静默回落 null） */
  hydrateFromSettings(done: boolean | null, mode: OnboardingMode | null): void;
  /** 新库播种的内存侧配套：IdentityDialog 首次确立管理员时与落库 `false` 成对调用 */
  markEligible(): void;
  /** 看完/跳过：镜像置 true（落库由组件经 repos.settings.set 先行） */
  markDone(): void;
  /** 选线：镜像更新（落库由组件先行） */
  setMode(mode: OnboardingMode): void;
  openOverlay(): void;
  closeOverlay(): void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  done: null,
  mode: null,
  overlayOpen: false,

  hydrateFromSettings: (done, mode) =>
    set({
      done,
      // 脏值防御：settings 里 mode 万一不是合法字面量，按「没选过」处理
      mode: isOnboardingMode(mode) ? mode : null,
    }),

  markEligible: () => set({ done: false }),

  markDone: () => set({ done: true }),

  setMode: (mode) => set({ mode }),

  openOverlay: () => set({ overlayOpen: true }),

  closeOverlay: () => set({ overlayOpen: false }),
}));
