/**
 * Agent 导入通道契约注册表（v0.7 · 设计文档 §2.5）。
 *
 * ── 为什么单独成文件 ──
 * 「接入配置面板」（T03）与「本机 loopback / NAS HTTP 实现」（T05）都要消费同一份
 * 通道契约。放在这里，两边 import 同一处，**不碰同一个文件**，也不会各写一份导致漂移。
 *
 * ── 本文件的边界 ──
 *   1. 只承载**跨批共享的传输层契约**（类型 + 注册表 + R5/R6 判据）；
 *   2. 提供 `local-dexie` 通道的**构造器**（转调既有 preview/apply，= 现状行为）；
 *      但**不含**「默认接线」—— 仓储由宿主注入，默认接线在
 *      `src/di/agent-channel.ts`（组合根）。`desktop-loopback` / `nas-http`
 *      由 **T05** 覆盖注册；
 *   3. **不含** `stageName` 判重 / 按名解析 / 新建分支 —— 那是 **T02** 的
 *      `payload.apply.ts` + `stage-resolve.ts`。本文件的 `local-dexie` 实现把
 *      `opts.stageName` **原样转发**给它，**永不自行判定**（详见该实现内的注释）。
 *
 * ── 依赖方向（单向，不得成环）──
 *   本文件 → `payload.apply.ts` / `types/agent-payload.ts` / `repositories/interfaces`（**仅类型**）。
 *   `payload.apply.ts` **不得**反向 import 本文件。
 *
 * ── ⚠️ 为什么本文件不再自带默认接线（2026-09-14 修的真实缺陷，后人勿改回去）──
 *   本文件被 `server/tsconfig.json` 的 `include` 通配
 *   `../src/core/agent/` 全目录（`**` + `*.ts`）纳入服务端编译单元
 *   （`lib` 仅 ES2020、无 DOM），即**服务端也要能编译它**。因此本文件**不得触到实现层**：
 *     ✗ 不得 import（含 `await import()`）`../repositories/index` 及其下游
 *       —— 那会拖进 Dexie、`remote/rest.client`、`services/backup.service`、
 *       `config/env`，并经 `local.tasks.repo → hooks/useRoleGuard → store/use*Store`
 *       反向缠上 Zustand store 层（实测连带 **27 个文件**、9 条 `typecheck:server` 报错）；
 *     ✓ 只允许依赖 `repositories/interfaces` 的**接口类型**（纯类型、零运行期代码）。
 *   **「取仓储」是宿主的事**，不是共享内核的事 —— 默认接线已搬到
 *   `src/di/agent-channel.ts`。搬回去 = 原样复现上面那 27 个文件与 9 条报错。
 *
 * 纪律：零 IO、零 browser API，可被 `server/tsconfig.json` 的 `../src/core/` 覆盖。
 *
 * ⚠️ 注：`ChangxiaError` / `ChangxiaErrorCode` 曾用于 `local-dexie` 通道里那段
 *    「`stageName` 未接入」的抛错（T01 占位，T02 已解除）。占位去掉后本文件不再需要
 *    它们，但**刻意保留 import 会变成未使用导入（`noUnusedLocals` 未开，故不报错）**——
 *    故此处如实删除，避免留下误导下一位读者的死导入。
 */

import type {
  AgentImportQuery,
  ApplyResult,
  ApplyStageImpact,
  ApplyStageMode,
  ApplyStageResolution,
} from '../types/agent-payload';
import { validateAgentPayload } from '../types/agent-payload';
import type { IRepositoryBundle } from '../repositories/interfaces';
import { applyAgentPayload, previewAgentPayload } from './payload.apply';

/* ============================================================================================
 * 一、阶段落点契约的**传输层**出口
 *
 * 刻意做成 domain 类型的**别名再导出**，而不是把四个类型再抄一遍：
 *   · 「避免各写一份」是本文件存在的理由 —— 抄一份就等于制造了漂移源；
 *   · T02 / T03-B 一律从本文件 import，不需要知道 `types/agent-payload.ts`；
 *   · 将来若 wire 形状真要与 domain 分叉，届时再改成独立声明（一次性收口）。
 * ============================================================================================ */
export type {
  AgentImportQuery,
  ApplyStageImpact,
  ApplyStageMode,
  ApplyStageResolution,
};

/** 四种落点模式的**运行时**列表（类型侧见 `ApplyStageMode`） */
export const APPLY_STAGE_MODES: readonly ApplyStageMode[] = [
  'existing',
  'planned',
  'created',
  'none',
];

/**
 * **R6 · 前向兼容**：消费方遇到**未知 `mode`** 必须降级 —— 只显示
 * `rejected[].reason`，**不得崩溃、不得据此推断「写入了什么」**。
 *
 * 判据：枚举扩张不可避免。契约的可扩展性必须靠**消费方的降级行为**兜，
 * 而不是靠「枚举永不扩张」的假设。
 */
export function isKnownApplyStageMode(value: string): value is ApplyStageMode {
  return (APPLY_STAGE_MODES as readonly string[]).includes(value);
}

/**
 * **R5 · `impact` 出现判据**：`mode === 'planned' || mode === 'created'`。
 *
 * ★ 正向白名单，**不得**写成 `mode !== 'existing'` —— 枚举一扩张就会把新取值
 *   误卷进来（新增 `'none'` 时已踩过：一次零写入的批次吐出了 `impact`）。
 */
export function shouldShowImpact(mode: ApplyStageMode): boolean {
  return mode === 'planned' || mode === 'created';
}

/* ============================================================================================
 * 二、通道契约（§2.5）
 * ============================================================================================ */

export type AgentChannelKind = 'local-dexie' | 'desktop-loopback' | 'nas-http' | 'none';

export interface AgentChannelStatus {
  kind: AgentChannelKind;
  /** 探活结果 */
  reachable: boolean;
  /** 如 http://127.0.0.1:17788 / http://nas:7788；local-dexie 为 null */
  baseUrl: string | null;
  /** 是否已配置 token —— ★ 绝不回传 token 原文 */
  hasToken: boolean;
  /** 最近同步时刻（ISO） */
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
}

export interface AgentImportChannel {
  status(): Promise<AgentChannelStatus>;
  probe(): Promise<AgentChannelStatus>;
  import(
    payload: unknown,
    opts: { dryRun: boolean; projectId?: string; stageName?: string },
  ): Promise<ApplyResult>;
}

/* ============================================================================================
 * 三、注册表
 * ============================================================================================ */

let registered: AgentImportChannel | null = null;

/** 覆盖注册（T05 用它把默认通道换成 loopback / nas-http）。 */
export function registerAgentImportChannel(c: AgentImportChannel): void {
  registered = c;
}

/** 取当前通道；未注册返回 `null`（调用方须自行降级，不可假设恒有）。 */
export function getAgentImportChannel(): AgentImportChannel | null {
  return registered;
}

/* ============================================================================================
 * 四、默认实现：`local-dexie`
 *
 * 直接跑 `previewAgentPayload` / `applyAgentPayload`，行为与 v0.6 现状逐字节一致。
 *
 * ⚠️ 本段**刻意不含「从哪里取仓储」**：仓储由宿主注入（`getBundle` 参数）。
 *    理由见文件头「为什么本文件不再自带默认接线」——`IRepositoryBundle` 是**接口**，
 *    而取它的**实现**（`repositories/index` → Dexie → hooks/store）不是共享内核该知道的事。
 *    默认接线搬到了 `src/di/agent-channel.ts`（组合根），本文件对它零引用。
 * ============================================================================================ */

/**
 * 构造 `local-dexie` 通道。
 *
 * @param getBundle 仓储来源，**必填** —— 由宿主注入（组合根 / 测试夹具）。
 *                  此处**刻意不提供默认值**：任何默认值都要求本文件知道
 *                  `repositories/index` 的存在，而那正是被切断的那条边
 *                  （历史缺陷与后果见文件头）。类型仍是 `IRepositoryBundle`
 *                  **接口**——不引入任何实现层依赖。
 */
export function createLocalDexieChannel(
  getBundle: () => Promise<IRepositoryBundle>,
): AgentImportChannel {
  const status = (): AgentChannelStatus => ({
    kind: 'local-dexie',
    reachable: true,
    baseUrl: null,
    hasToken: false,
    lastSyncAt: null,
    lastSyncSummary: null,
  });

  return {
    status: async () => status(),
    probe: async () => status(),
    async import(payload, opts) {
      const repos = await getBundle();
      const validated = validateAgentPayload(payload);
      // ★ v0.7（T02）：`opts.stageName` **原样转发**进落点解析 —— 与
      //   `POST /api/agent/import` 的 `?stageName=` 是同一条链路（同一份
      //   `payload.apply.resolve()`），因此本地手动通道也能跑通 V1-19 的
      //   「预览将新建阶段『X』」与 V1-17 的「自动落进 Agent 排期」。
      //
      //   ⚠️ 此处**绝不**自己判一次 `stageName`（例如「本地没有就静默忽略」）：
      //      形式判定（空值 → 报错 / 有同名则复用 / 无同名才建）全部由
      //      `payload.apply` 内的 `resolve()` 定死。在这里再判一次就会出现
      //      「同一份 payload 在本机与 NAS 得到不同答案」—— 那正是 §6.2 写锁
      //      矩阵要防的「两份真相」。契约层只负责**转发**，不负责**判定**。
      const applyOpts = { projectId: opts.projectId, stageName: opts.stageName ?? null };
      if (opts.dryRun) return previewAgentPayload(repos, validated, applyOpts);
      return applyAgentPayload(repos, validated, applyOpts);
    },
  };
}

/**
 * ⚠️ 这里**曾经**有一句 `registerAgentImportChannel(createLocalDexieChannel());`
 *    —— 即「只要 import 本文件就自动注册默认通道」。
 *
 * 它已被**搬到组合根** `src/di/agent-channel.ts`。为什么必须搬走：
 * 那句的默认实现要取仓储，于是本文件必须 `await import('../repositories/index')`；
 * 而 `server/tsconfig.json` 把 `../src/core/agent/**` 整个纳入服务端编译单元
 * （其 `lib` 只有 ES2020、无 DOM），这条 import 会把 `repositories/index` 的**整个
 * 实现图**拖进来——实测连带 **27 个文件**（Dexie 适配器、`remote/rest.client`、
 * `services/backup.service`、`config/env`、以及经
 * `local.tasks.repo → hooks/useRoleGuard → store/use*Store`
 * 反向缠上的**整个 Zustand store 层**）→ `npm run typecheck:server` 9 条红。
 *
 * 注册时机**没有变**：仍是「组合根被加载时注册一次」。生产侧本来就没有读取者
 * （`AgentBoardPage` 的通道信息走 `transport.http` 的 props，不读本注册表），
 * 故搬走对运行期行为**零影响**；唯一消费方是
 * `tests/v07-t01-contract.spec.ts`，它改为显式 import 组合根。
 */
