import { create } from 'zustand';

import { DEFAULT_REST_POLICY } from '../core/types/entities';
import type { RestPolicyConfig } from '../core/types/entities';
import { withCnHolidays } from '../core/holidays/policy';

/**
 * 本机设置与身份。
 * currentMemberId = 「我的任务」身份（MVP 无账号体系，本机选择 + localStorage 持久化；
 * Docker 化后升级为登录会话映射，接口形状不变）。
 *
 * restPolicy = 公司休息制度（决定全系统排期的工作日口径）。体例同其他字段：
 * 不落 localStorage，由 bootstrapAllStores 从 settings 表（key='restPolicy'）读入后注入；
 * 缺失或数据损坏时静默回落 DEFAULT_REST_POLICY。
 *
 * effectiveRestPolicy = **生效口径**（排期/月历消费方一律用它）：setRestPolicy 时
 * 在 hydrate 边界派生——restPolicy.skipHolidays 开 ⇒ 内置法定节假日表合并进
 * extraHolidays/extraWorkdays（用户手填优先，见 core/holidays/policy.ts）；
 * 关 ⇒ 与 restPolicy 同一引用。restPolicy 本身恒为用户手填的原始值
 * （设置弹窗编辑与落库的都是它，内置表不持久化）。
 *
 * v0.2 增量：身份进入状态机（不持久化，每次启动由 currentMemberId 恢复已进入态）：
 *   closed        未在身份流程中
 *   admin_prompt  first-run 引导「你是管理员吗？」
 *   name_input    姓名输入（adminIntent=true 为管理员确立，false 为成员进入）
 *   mismatch      未命中提示（停留，不进入）
 * firstRunDismissed 会话级开关：无管理员时普通成员选「我不是管理员」后不再自动弹引导
 * （防死循环：若不置位，闸门条件仍满足会立刻重新弹出 admin_prompt）。
 */

const LS_KEY = 'changxia.currentMemberId';

export type IdentityFlowState = 'closed' | 'admin_prompt' | 'name_input' | 'mismatch' | 'password_input';

export interface SettingsState {
  currentMemberId: string | null;
  /**
   * 首屏数据是否已装载（bootstrap 完成信号）。
   *
   * ★ 三态判据（唯一事实源，消费方一律经 `useDataReadiness()` / `<DataGate>` 读，
   *   不要自己拼 `hydrated` 与 `hydrateError`）：
   *     `hydrateError !== null` → 失败（hydrated 恒为 false）
   *     `!hydrated`             → 装载中
   *     `hydrated`              → 已装载 —— **只有这一档才允许渲染「空态」**
   *   缺陷背景（审计 F1-①）：装载失败时各页只看项目/任务数为 0 就断言
   *   「还没有进行中的项目」「目前没有分配给你的待办」——把「没读进来」说成
   *   「本来就没有」，用户据此可能去拿旧备份覆盖真实数据。
   */
  hydrated: boolean;
  /**
   * 首屏装载失败原因（null = 未失败；非 null 即失败态，且 hydrated 保持 false）。
   * 为什么与 hydrated 同居一处：拆成两个 store 就会出现「hydrated=false 且
   * error 在别处」的中间态被误读成「装载中」，那正是这次要消灭的含糊。
   */
  hydrateError: string | null;
  /**
   * 重试装载的请求计数：+1 触发 `useProjectsBootstrap` 重跑 bootstrap
   * （**不是**刷新页面——本应用是 Electron 壳，用户没有地址栏）。
   */
  bootstrapAttempt: number;
  identityFlow: IdentityFlowState;
  /** name_input 是否处于「管理员确立」意图（首次引导路径） */
  adminIntent: boolean;
  /** 会话级：无管理员时普通成员已被告知联系管理员，不再自动弹引导 */
  firstRunDismissed: boolean;
  /** 公司休息制度（出厂默认双休；由 bootstrap 从 settings 表注入，不落 localStorage） */
  restPolicy: RestPolicyConfig;
  /**
   * 生效口径（排期/月历唯一消费值）：skipHolidays 开时已合并内置法定节假日表。
   * 与 restPolicy 的差别只有这一个开关；关时两者同一引用。
   */
  effectiveRestPolicy: RestPolicyConfig;
  /**
   * v0.6 密码系统：name_input 命中「设置了密码的成员」后，进入 password_input 前暂存该成员 id，
   * 供密码表单校验通过后 setCurrentMember。关闭/取消时清空。
   */
  pendingMemberId: string | null;

  hydrate(currentMemberId: string | null): void;
  /** 装载失败：记下原因，hydrated 保持 false（失败态由此参与判据） */
  failHydrate(detail: string): void;
  /** 重试装载：请求计数 +1 并清失败态（回到「装载中」），由 bootstrap hook 重跑 */
  requestBootstrapRetry(): void;
  setRestPolicy(next: RestPolicyConfig): void;
  setCurrentMember(memberId: string | null): void;
  setPendingMember(memberId: string | null): void;
  openIdentityFlow(state: IdentityFlowState, adminIntent?: boolean): void;
  setIdentityFlow(state: IdentityFlowState): void;
  closeIdentityFlow(): void;
  dismissFirstRunNotice(): void;
}

function readLocalStorageId(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  currentMemberId: readLocalStorageId(),
  hydrated: false,
  hydrateError: null,
  bootstrapAttempt: 0,
  identityFlow: 'closed',
  adminIntent: false,
  firstRunDismissed: false,
  restPolicy: DEFAULT_REST_POLICY,
  effectiveRestPolicy: DEFAULT_REST_POLICY,
  pendingMemberId: null,

  setRestPolicy: (next) =>
    set({
      restPolicy: next,
      // hydrate 边界派生：内置节假日表只在这里进入系统（默认关 ⇒ 同一引用）
      effectiveRestPolicy: withCnHolidays(next),
    }),

  hydrate: (currentMemberId) =>
    set({
      // 设置表值优先；无则回落 localStorage；再次无则空（未选身份）
      currentMemberId: currentMemberId ?? readLocalStorageId(),
      hydrated: true,
      // 装载成功即清失败态（重试成功后错误面必须消失）
      hydrateError: null,
    }),

  failHydrate: (detail) => set({ hydrateError: detail, hydrated: false }),

  requestBootstrapRetry: () =>
    set((st) => ({
      bootstrapAttempt: st.bootstrapAttempt + 1,
      // 回到「装载中」：错误面让位给占位，重跑失败会再写回失败态
      hydrateError: null,
    })),

  setCurrentMember: (memberId) => {
    try {
      if (memberId === null) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, memberId);
    } catch {
      /* 隐私模式下静默降级为内存态 */
    }
    set({ currentMemberId: memberId });
  },

  setPendingMember: (memberId) => set({ pendingMemberId: memberId }),

  openIdentityFlow: (state, adminIntent = false) =>
    set({ identityFlow: state, adminIntent }),

  setIdentityFlow: (state) => set({ identityFlow: state }),

  closeIdentityFlow: () => set({ identityFlow: 'closed', adminIntent: false, pendingMemberId: null }),

  dismissFirstRunNotice: () => set({ firstRunDismissed: true }),
}));
