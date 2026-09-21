/**
 * 执行单「计划」指纹（stale approval 收紧切片的核心绑定载体）。
 *
 * ── 这一刀解决什么 ──
 * 规格文档（feature-dev-agent-board-2026-09-18.md §224）把「stale approval 收紧」列为
 * 第一验收项：确认后的 `planHash` 目前可在合法迁移中被覆盖（如 `paused → running`
 * 时带上一份新的确认快照），导致「批准的是不是这一版计划」这个问题从未被回答。
 *
 * 本模块给出**单一出处**的「计划字段集合」与「确定性指纹」，让确认快照真正绑定到
 * 这一版计划内容，而不是只满足「planHash 字段非空」这种形状校验。
 *
 * ── `EXECUTION_PLAN_FIELDS`：单一出处 ──
 * 哪些字段算「计划」？原则：**排除一切生命周期 / 审计字段**，只保留描述「这一版执行
 * 要做成什么」的字段。被排除的字段一旦纳入，状态机就会自相矛盾——
 * 例如 `status` 一变 hash 就变，`awaiting_confirmation → queued` 这一步必然自相矛盾
 * （刚确认完，hash 立刻对不上）。
 *
 * ── 指纹算法性质（务必看清）──
 * 用的是 **FNV-1a（两轮不同 seed 拼成一个 16 位 hex）**，一个短小、确定、零依赖的
 * 纯 TS 摘要。**它不是密码学控制**：调用方（API 客户端）同样能算出完全相同的 hash。
 * 它的定位是**陈旧检测器（staleness detector）**——只能挡住「计划变了却复用旧确认」
 * 这类**意外陈旧**，挡不住「恶意 API 调用方自己算了个匹配 hash 塞进来」。这与本切片的
 * 目标（「绑定的是内容一致性」）相符，不要把它吹成安全边界。
 *
 * 因此 `src/core/**` 严禁引入 `node:crypto` / `crypto.subtle`：本文件必须同时被前端
 * 与 server 两套 tsconfig 编译，且保持零 DOM / 零 Node 专属 API。
 */

import type { Execution } from '../types/entities';

/**
 * 计划字段集合（**单一出处**）。
 *
 * 每条都标注了「为何纳入」——凡是描述「这一版执行要做什么」的字段都纳入；
 * 凡是「生命周期 / 审计 / 凭据自身」的字段都排除（见下方排除清单）。
 *
 * 纳入：
 *   - `projectId`     归属项目——在哪个项目内执行，是计划的上下文锚点；
 *   - `taskId`        关联任务——计划绑定到哪条业务任务；
 *   - `source`        入口来源——决定计划的形态（四类入口之一）；
 *   - `objective`     **核心计划**：自然语言目标，计划的主体内容；
 *   - `agentMemberId` 由哪个 Agent 执行，计划的人/角色要素；
 *   - `channelKind`   走哪条通道执行（loopback / nas / http），计划要素；
 *   - `inputSnapshotHash` 输入快照哈希，计划的输入契约；
 *   - `idempotencyKey`   由计划派生的去重键（创建后不可变），是计划的稳定指纹附庸。
 *
 * 排除（绝不可纳入，否则状态机自相矛盾或自我绑定）：
 *   - `id`            实体标识，不是计划内容；
 *   - `status`        生命周期状态——一变 hash 就变，会让 `awaiting_confirmation → queued` 自相矛盾；
 *   - `confirmation`  凭据自身——不能拿自己绑自己；
 *   - `currentAttemptNo` 运行时计数，生命周期字段；
 *   - `createdAt` / `updatedAt` / `startedAt` / `finishedAt` 时间戳，审计字段；
 *   - `terminalReason` / `blockedReason`               语义原因，审计字段。
 *
 * 测试必须从本常量**展开遍历**（不要手抄字段名），这样将来加字段会自动纳入护栏。
 */
export const EXECUTION_PLAN_FIELDS: readonly (keyof Execution)[] = [
  'projectId',
  'taskId',
  'source',
  'objective',
  'agentMemberId',
  'channelKind',
  'inputSnapshotHash',
  'idempotencyKey',
];

/** 单轮 FNV-1a（32-bit，返回 8 位 hex） */
function fnv1a32(str: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    // Math.imul 做 32 位整数乘法，避免 JS 数字乘法溢出丢失低位
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 计算执行单的「计划指纹」。
 *
 * 序列化**按字段名排序**后 `JSON.stringify`，避免对象键序影响结果（不同调用方 /
 * 不同 JS 引擎 / 不同传输层可能改变对象键序，但语义必须一致）。
 * 纳入的字段全部是基本类型（string 或 null），序列化稳定。
 *
 * 返回 16 位 hex（两轮 FNV-1a 拼接），性质见文件头：这是陈旧检测器，不是密码学控制。
 */
export function computePlanHash(execution: Pick<Execution, (typeof EXECUTION_PLAN_FIELDS)[number]>): string {
  const pairs: Array<[string, unknown]> = EXECUTION_PLAN_FIELDS.map((f) => [
    f as string,
    (execution as Record<string, unknown>)[f as string],
  ]);
  // 按字段名排序，得到与键序无关的规范序列化
  pairs.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  const canonical = JSON.stringify(pairs);
  // 两轮不同 seed：① FNV-1a 标准偏移基；② FNV-1a 标准质数本身，制造第二个独立指纹
  return fnv1a32(canonical, 0x811c9dc5) + fnv1a32(canonical, 0x01000193);
}
