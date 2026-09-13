/**
 * Agent 导入通道契约注册表（v0.7 · 设计文档 §2.5）。
 *
 * ── 为什么单独成文件 ──
 * 「接入配置面板」（T03）与「本机 loopback / NAS HTTP 实现」（T05）都要消费同一份
 * 通道契约。放在这里，两边 import 同一处，**不碰同一个文件**，也不会各写一份导致漂移。
 *
 * ── 本文件的边界 ──
 *   1. 只承载**跨批共享的传输层契约**（类型 + 注册表 + R5/R6 判据）；
 *   2. 唯一实现是默认注册的 `local-dexie` 通道（转调既有 preview/apply，= 现状行为）；
 *      `desktop-loopback` / `nas-http` 由 **T05** 覆盖注册；
 *   3. **不含** `stageName` 判重 / 按名解析 / 新建分支 —— 那是 **T02**。
 *
 * ── 依赖方向（单向，不得成环）──
 *   本文件 → `payload.apply.ts` / `types/agent-payload.ts`。
 *   `payload.apply.ts` **不得**反向 import 本文件。
 *
 * 纪律：零 IO、零 browser API，可被 `server/tsconfig.json` 的 `../src/core/**` 覆盖。
 */

import { ChangxiaError, ChangxiaErrorCode } from '../types/enums';
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
 * ============================================================================================ */

/** 懒开本地数据源：避免本文件被 import 时就触发 Dexie 建库。 */
async function defaultLocalBundle(): Promise<IRepositoryBundle> {
  const { createRepositories } = await import('../repositories/index');
  return createRepositories({ dataSource: 'local' });
}

/**
 * 构造 `local-dexie` 通道。
 * @param getBundle 仓储来源，默认懒开本地数据源（测试/自定义宿主可注入）。
 */
export function createLocalDexieChannel(
  getBundle: () => Promise<IRepositoryBundle> = defaultLocalBundle,
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
      // ★ 不静默降级：落点名解析属 T02，本通道尚未接入。
      //   静默忽略会让调用方以为任务落到了指定阶段，实则落到了默认批次。
      if (opts.stageName) {
        throw new ChangxiaError(
          ChangxiaErrorCode.Validation,
          'local-dexie 通道尚未接入 ?stageName= 落点解析（T02），请先改用 stageId 或指定既有批次。',
        );
      }
      const repos = await getBundle();
      const validated = validateAgentPayload(payload);
      const applyOpts = { projectId: opts.projectId };
      if (opts.dryRun) return previewAgentPayload(repos, validated, applyOpts);
      return applyAgentPayload(repos, validated, applyOpts);
    },
  };
}

registerAgentImportChannel(createLocalDexieChannel());
