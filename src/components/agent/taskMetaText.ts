/**
 * 技术模式元信息「短号 · 来源」文本 —— **单一出处**（v0.7 · T03 · P0-15 / V1-10）。
 *
 * ── 为什么单独成文件 ──
 * 同一个串要在**两处**渲染：技术卡（`AgentTaskCard` tech 分支第二行）与 Ready 卡
 * （`ReadyQueue` 的一行三格）。设计 §T03 明说两处是「同款替换」，而验收 V1-14 的
 * 断言 ① 是**同一条正则**（`/^T-\d{4,} · (agent|human)$/`）同时匹配两处 —— 即
 * 「两处必须逐字符一致」是被明文要求的事实。两处各写一遍拼串，就是本项目反复
 * 在防的「两份真相」；故提为纯函数，两端 import 同一份。
 *
 * 本模块**不**放进 `AgentTaskCard.tsx`：`ReadyQueue` 文件头明确写了它刻意
 * **不复用** `AgentTaskCard`（画板的 Ready 卡是一行三格编排条，而技术卡是三行
 * 高密度卡，复用会得到「井中井」）。让 ReadyQueue 反向 import 那个组件只为拿一个
 * 拼串函数，会把这条「不耦合」的纪律悄悄破掉。故独立成零依赖模块。
 *
 * ── 号本身：唯一出口是 `formatTaskNo`（不得在此重写补零）──
 * 补零/进位规则**只有一处**（`src/core/lib/task-no.ts`）。本函数只负责把
 * 「号」与「来源」拼成一行，**绝不**自己 `'T-' + n`。
 *
 * ── ★ 已登记的规格内部矛盾（实现按「通过验收断言」的一侧，见下）──
 * 设计 §T03 源文件行给出的是：
 *     `formatTaskNo(task.taskNo) + ' · ' + (task.source === 'agent' ? agentKind : 'human')`
 * 而同文档验收 V1-14 ① 断言的是：
 *     `/^T-\d{4,} · (agent|human)$/`
 * 二者**不可能同时成立**：`agentKind` 是**开放字符串**（`workbuddy`/`deepseek`/
 * 自研……，`agentTerms.ts` 明令禁止封闭化），而正则只认字面量 `agent` 或 `human`。
 * 若按前者，`T-1042 · workbuddy` 必然**不匹配**正则 → V1-14 ① 红。
 *
 * 取舍依据：**验收断言是可执行的契约，示例代码行不是**。故此处取字面量
 * `agent`/`human`（品牌级来源仍由技术卡右侧的 `SourceBadge` 承载 `agentKind`，
 * 信息不丢失）。该矛盾已上报 team-lead 裁定；若裁定改为「显示 agentKind」，
 * 只需改本函数与 V1-14 ① 的正则，**不涉及任何调用点**。
 *
 * ── 老数据（`taskNo === null`）的展示 ──
 * 一律交给 `formatTaskNo` 归一为 `—`（设计 :172 / :195、`entities.ts` 的
 * `taskNo` 字段注释、`task-no.ts` 函数注释三处一致口径），故老数据渲染为
 * `— · agent`，**不含 `T-` 前缀**，满足 V1-14 ③「老任务显示 `—`，不出现 `T-` 前缀」。
 * 绝不出现 `T-null` / `T-undefined`（`formatTaskNo` 在 null/undefined 分支直接早退）。
 */

import { formatTaskNo } from '../../core/lib/task-no';
import type { Task } from '../../core/types/entities';

/** 本函数只需要这三个字段，故收窄入参（便于单测直接喂字面量，不必造完整 Task） */
export type TaskMetaTextInput = Pick<Task, 'taskNo' | 'source'>;

/**
 * 技术模式元信息串：`T-1042 · agent` / `T-10000 · human` / `— · agent`（老数据）。
 *
 * 入参刻意收窄到 `{ taskNo, source }`：这样「元信息长什么样」这件事
 * **不依赖** Task 的其余 18 个字段，将来 Task 增删字段不会波及本串的判定。
 */
export function taskMetaText(task: TaskMetaTextInput): string {
  const sourceWord = task.source === 'agent' ? 'agent' : 'human';
  return `${formatTaskNo(task.taskNo)} · ${sourceWord}`;
}
