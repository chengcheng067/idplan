/**
 * Agent 结构化命令（v0.8.5 · 方案 3：结构化意图 API 的第一命令）。
 *
 * ── 它是什么 ──
 * 雯丞 2026-10-01 拍板「AI/agent 用自然语言建档、调期」。安全官比选后落地
 * **方案 3（结构化意图 API，零 LLM）**：AI 方自己把自然语言解析成**结构化
 * 命令**调我们；ID Plan 永不解析自然语言、永不调 LLM。
 *
 * 本文件是命令层的唯一契约 + 执行器。当前实现一个命令：
 *
 *   `reschedule_stages`（调期）——「把某 Agent 看板的未完成阶段整体平移 N 天」
 *   例：AI 解析「XX 项目往后推两周」→ { command:'reschedule_stages',
 *       projectId:'proj_x', shiftDays:14, dryRun:true }
 *
 * ── 为什么「建档」没有新命令 ──
 * 安全官审计结论：NL 建档 90% 需求已被现有 `POST /api/agent/boards` 覆盖
 * （AI 建 Agent 看板即建档）。真实缺口只有调期——故本文件只此一个命令，
 * 不预支不存在的需求。
 *
 * ── 隔离铁律（复用而非新开） ──
 * 落点判定复用 `payload.apply` 的共享门 `assertAgentWritableProject`：
 * 目标必须是 **kind=agent 的看板**，人类项目一律拒绝（ProjectUnresolved）。
 * 命令通道与导入通道同 token、同门、同 dryRun 范式——不自己查项目表。
 *
 * ── 已知边界（记账，勿静默扩大） ──
 * ① reschedule 是**非幂等**命令（重放=二次平移）。防重放靠：dryRun 先行
 *   确认 + 接入文档向写入方明示「须自行保证不重放」。完备幂等（operationId
 *   去重表）排 0.8.6——与 NAS 写端点鉴权同批（去重记录要先有安全落点）。
 * ② **completed 阶段不平移**（历史不篡改：施工完的段日期变了=改账）；
 *   任务 dueDate 随所在阶段连带平移（未完成任务的排期语义）。
 */

import { z } from 'zod';

import { ChangxiaError, ChangxiaErrorCode, StageStatus } from '../types/enums';
import type { IRepositoryBundle } from '../repositories/interfaces';
import type { Stage } from '../types/entities';
import { assertAgentWritableProject } from './payload.apply';
import { isIsoDate } from '../../lib/date';

/** 命令 schema id（接入文件/指令块向写入方承诺的契约号） */
export const AGENT_COMMAND_SCHEMA_ID = 'idplan-agent-command/v1' as const;

/* ------------------------------- schema ------------------------------- */

export const rescheduleStagesCommandSchema = z.object({
  command: z.literal('reschedule_stages'),
  /**
   * 目标看板（必须 kind=agent；人类项目被门拒绝）。
   * ★ 空串**合法过 schema**（v0.8.5 方案 2 修正）：自然语言解析不出项目时模型
   *   按系统提示输出空串——若 schema 用 min(1)，它会被判成「形状不符」，
   *   用户看到的是 zod 报错而不是「没提项目」的人话。空值拒绝在路由层。
   */
  projectId: z.string().default(''),
  /**
   * 平移天数：正=整体推后，负=整体提前。±365 封顶（超过即疑似笔误，
   * 如把 14 写成 1400——拒绝并提示，不替用户猜）。
   */
  shiftDays: z.number().int().min(-365).max(365),
  /**
   * 可选：只平移这些阶段（按 `templateKey` 匹配；未知 key 不报错、不参与，
   * 由 dryRun 预览的 `unmatchedKeys` 反馈给写入方）。缺省=全部可见且未完成的段。
   */
  stageKeys: z.array(z.string().min(1)).max(50).optional(),
  /** 改期原因（写入留痕日志的 reason；非必填，但建议 AI 带上人类可读理由） */
  reason: z.string().max(200).nullable().default(null),
});

export type RescheduleStagesCommand = z.infer<typeof rescheduleStagesCommandSchema>;
/** 命令的**输入**类型（zod default 前的形状：reason/stageKeys 可选；契约的调用方面） */
export type RescheduleStagesCommandInput = z.input<typeof rescheduleStagesCommandSchema>;

/** dryRun 预览的单段条目 */
export interface ReschedulePreviewItem {
  stageId: string;
  name: string;
  from: { startAt: string; endAt: string };
  to: { startAt: string; endAt: string };
}

export interface RescheduleDryRun {
  mode: 'dry_run';
  projectId: string;
  shiftDays: number;
  wouldShift: ReschedulePreviewItem[];
  /** 因 completed 被跳过的段数（告知写入方「有段没动，为什么」） */
  skippedCompleted: number;
  /** stageKeys 里没匹配上任何可见段的 key（防写入方拼错静默无操作） */
  unmatchedKeys: string[];
}

export interface RescheduleApplied {
  mode: 'applied';
  projectId: string;
  shiftDays: number;
  shifted: number;
  skippedCompleted: number;
  unmatchedKeys: string[];
}

export type RescheduleResult = RescheduleDryRun | RescheduleApplied;

/* ------------------------------- 执行器 ------------------------------- */

/** ISO 日期（YYYY-MM-DD）平移 n 天（UTC 算术，无时区漂移） */
function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface RescheduleDeps {
  repos: IRepositoryBundle;
  /** 单段改期 service（既有实现：写流水 + 连带任务 dueDate + 状态校验） */
  rescheduleStage: (
    stageId: string,
    cmd: { newStartAt: string; newEndAt: string; reason: string | null; operatorName: string },
  ) => Promise<unknown>;
  /** 留痕操作人名（Agent 通道固定口径） */
  operatorName?: string;
}

/**
 * 执行 / 预览 reschedule_stages 命令。
 *
 * 判序（与 import 通道同门）：
 *   ① schema 校验（调用方已做，这里 assert 一遍防直接调用）；
 *   ② `assertAgentWritableProject`：项目存在且 kind=agent，否则 ProjectUnresolved；
 *   ③ 可见（visible!==false）且**未完成**的阶段进候选；
 *   ④ dryRun → 只返回预览（零写入）；否则逐段走既有 reschedule service（留痕）。
 */
export async function runRescheduleStages(
  deps: RescheduleDeps,
  cmd: RescheduleStagesCommandInput,
  opts?: { dryRun?: boolean },
): Promise<RescheduleResult> {
  // ① schema 复验（防绕过 validateAgentCommand 的直接调用）
  const parsed = rescheduleStagesCommandSchema.safeParse(cmd);
  if (!parsed.success) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `command 校验失败：${parsed.error.issues[0]?.path.join('.') || '(root)'} ${parsed.error.issues[0]?.message ?? ''}`,
      parsed.error,
    );
  }
  const c = parsed.data;

  // ② 归属门（共享：与 payload.apply 同源，人类项目/不存在一律 ProjectUnresolved）
  await assertAgentWritableProject(deps.repos, c.projectId);

  // ③ 候选段：可见 + 未完成（completed 是历史，不平移）
  const stages = await deps.repos.stages.listByProject(c.projectId);
  const visible = stages.filter((s) => s.visible !== false);
  const matched: Stage[] = [];
  let skippedCompleted = 0;
  for (const s of visible) {
    if (s.status === StageStatus.Completed) {
      skippedCompleted += 1;
      continue;
    }
    matched.push(s);
  }
  // stageKeys 过滤（按 templateKey；未知 key 进 unmatchedKeys 反馈，不静默）
  let unmatchedKeys: string[] = [];
  let selected = matched;
  if (c.stageKeys && c.stageKeys.length > 0) {
    const keySet = new Set(c.stageKeys);
    selected = matched.filter((s) => s.templateKey !== null && keySet.has(s.templateKey));
    const matchedKeySet = new Set(
      matched.map((s) => s.templateKey).filter((k): k is string => typeof k === 'string'),
    );
    unmatchedKeys = c.stageKeys.filter((k) => !matchedKeySet.has(k));
  }

  const preview: ReschedulePreviewItem[] = selected.map((s) => {
    const fromStart = (s.startAt ?? '').slice(0, 10);
    const fromEnd = (s.endAt ?? '').slice(0, 10);
    return {
      stageId: s.id,
      name: s.name,
      from: { startAt: fromStart, endAt: fromEnd },
      to: {
        startAt: isIsoDate(fromStart) ? shiftIsoDate(fromStart, c.shiftDays) : fromStart,
        endAt: isIsoDate(fromEnd) ? shiftIsoDate(fromEnd, c.shiftDays) : fromEnd,
      },
    };
  });

  // ④ dryRun：零写入
  if (opts?.dryRun) {
    return { mode: 'dry_run', projectId: c.projectId, shiftDays: c.shiftDays, wouldShift: preview, skippedCompleted, unmatchedKeys };
  }

  for (const item of preview) {
    await deps.rescheduleStage(item.stageId, {
      newStartAt: item.to.startAt,
      newEndAt: item.to.endAt,
      reason: c.reason,
      operatorName: deps.operatorName ?? 'Agent 通道',
    });
  }
  return {
    mode: 'applied',
    projectId: c.projectId,
    shiftDays: c.shiftDays,
    shifted: preview.length,
    skippedCompleted,
    unmatchedKeys,
  };
}

/** 命令校验入口（UI/路由共用；错误文案口径与 validateAgentPayload 对齐） */
export function validateAgentCommand(json: unknown): RescheduleStagesCommand {
  const parsed = rescheduleStagesCommandSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `command 校验失败：${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
      parsed.error,
    );
  }
  return parsed.data;
}
