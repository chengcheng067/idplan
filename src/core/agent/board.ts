/**
 * 人话看板四组判定（v0.7 · 阶段 B · T05 / 设计文档 §2.3）。
 *
 * ── 这是什么 ──
 * `humanGroupOf(task, depsDone)` 把 7 值状态机（`draft / ready / claimed /
 * in_progress / blocked / review / done`）**按自上而下优先级**映射到人话四组
 * + 一个隐藏组，**每条任务精确落入唯一一组**（互斥且完备）。
 *
 * ── 为什么独立 `board.ts` 而不扩展 `dag.ts` ──
 * `dag.ts` 已承担两件重活：DAG 建图 + Kahn 迭代分层 + 环检测，以及 Ready 队列
 * 计算与排序。再塞进「人话分组」会让该文件同时背负「图算法」与「UI 语义映射」
 * 两种职责，且两者的测试关注点完全不同（前者测不栈溢出，后者测互斥完备）。
 * 故拆为独立文件——**只依赖 `dag.ts` 的类型与 `taskIsDone`，不反向被 dag 依赖**。
 *
 * ── 共享内核纪律（`tests/arch-boundary.spec.ts` 的 T17 守卫会红）──
 * 本文件位于 `src/core/agent/**`，属**共享内核**，同一份源码前端（Vite/浏览器）
 * 与后端（tsx/Node）都要跑，因此：
 *   · 零 IO、零 React、零 repo import、零状态；
 *   · 禁 `window` / `document` / `localStorage` / `sessionStorage`；
 *   · 禁 `node:fs` / `node:path` 等 Node 专属模块；
 *   · 只允许 import 相对路径与 `zod`（本文件连 zod 都不需要）。
 * 一旦泄漏任一端的专属 API，**只在另一端运行时崩**（`window is not defined`），
 * 本地 vite dev + vitest 全绿也发现不了，故由守卫测试在提交期拦截。
 *
 * ── 为什么不在这里写四组标题 ──
 * 设计文档 `:459` 明确：「四组标题写死在 BOARD 组件（非 `AGENT_TERMS` key）」。
 * 且共享内核里出现中文 UI 文案会污染内核纯度（服务端也要 import 本文件）。
 * 故本文件只导出**组 key**（`confirm` / `ready` / `doing` / `done` / `hidden`）
 * 与显示顺序，标题字符串由 T06 的 BOARD 组件持有。
 */

import type { Task } from '../types/entities';
import { taskIsDone } from '../types/entities';
import type { TaskStatus } from '../types/enums';

/**
 * 人话看板组 key（**非** UI 文案）。
 *
 *   · `confirm` —— 待我确认：`review ∪ blocked`，等人拍板/解阻塞
 *   · `ready`   —— 可开工：`ready ∪ (draft ∧ 依赖全 done)`
 *   · `doing`   —— 进行中：`in_progress ∪ claimed`，有人在干、无人工决策 pending
 *   · `done`    —— 已完成：`done`
 *   · `hidden`  —— 隐藏（**不进四组主列表**）：`draft ∧ 存在未满足依赖`，
 *                 即「Agent 上游还在跑」的内部态，human 不需要看
 */
export type HumanBoardGroup = 'confirm' | 'ready' | 'doing' | 'done' | 'hidden';

/**
 * 可见四组的**显示顺序**（PRD §4.1.2 口径：待我确认 / 可开工 / 进行中 / 已完成）。
 *
 * 顺序是有语义的：待决事项排最前（人要先动），已完成的放最后（仅备查）。
 * `hidden` **刻意不在本数组内**——它不是「第五组」，而是「不属于任何可见组」。
 * 任何渲染层都应遍历本数组而非 `Object.keys(groups)`，否则隐藏组会漏出来。
 */
export const HUMAN_BOARD_GROUP_ORDER: readonly HumanBoardGroup[] = [
  'confirm',
  'ready',
  'doing',
  'done',
];

/** 该组是否进入四组主列表（`hidden` 为 false） */
export function isVisibleGroup(group: HumanBoardGroup): boolean {
  return group !== 'hidden';
}

/**
 * 构造 `depsDone` 判定闭包——`byId` 与 `computeReadyTasks` **同源**（同一份
 * 已按项目过滤的任务集），保证「可开工」组与既有 Ready 计算不会各算一套。
 *
 * ⚠️ **缺失引用的口径**：依赖指向的任务不在本批集合内 → 返回 `true`（视为已满足）。
 * 这与 `dag.ts:146` 的注释「缺失引用不算阻塞」严格一致：跨项目 / 已删除的
 * `dependsOn` 引用不应把任务按在隐藏组里永远出不来。若在此处返回 `false`，
 * 一条指向已删除任务的手工任务会**永久隐藏**，且界面上没有任何解释入口。
 *
 * @param tasks 已按项目过滤的任务集（与传给 `computeReadyTasks` 的应是同一批）
 * @returns `(depId) => 该前驱是否已完成`；未知 id 一律 true
 */
export function buildDepsDone(tasks: readonly Task[]): (id: string) => boolean {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  return (id: string): boolean => {
    const dep = byId.get(id);
    if (!dep) return true; // 缺失引用：与 dag.ts 同口径，不算阻塞
    return taskIsDone(dep);
  };
}

/**
 * 单任务 → 人话组（设计文档 §2.3.3 伪代码的忠实实现）。
 *
 * 优先级链（**先命中先归组，顺序不可调换**）：
 *   1. `done`                          → `'done'`
 *   2. `review ∪ blocked`              → `'confirm'`
 *   3. `in_progress ∪ claimed`         → `'doing'`
 *   4. `ready`，或 `draft ∧ 依赖全 done` → `'ready'`
 *   5. `draft ∧ 存在未满足依赖`          → `'hidden'`
 *
 * **关键裁决（设计文档 §2.3.2）**：`review` / `blocked` 一律**只进「待我确认」**，
 * 绝不进「进行中」。理由：human 视角下「等验收 / 等解阻塞」才是**挂在人头上**
 * 的事；「进行中」只放「机器/人在干」的条。若不按此顺序（例如先判进行中），
 * `blocked` 会同时落入两组，破坏互斥性。
 *
 * `taskIsDone` 而非裸 `status === 'done'`：前者额外覆盖老数据的
 * `done === true ∧ status !== 'done'` 派生态（`entities.ts:107` 为唯一出处）。
 *
 * @param task 任务（只需 status / done / dependsOn）
 * @param depsDone 前驱完成判定；欲按项目过滤，用 `buildDepsDone(tasks)` 构造
 * @returns 该任务唯一所属的人话组
 */
export function humanGroupOf(
  task: Task,
  depsDone: (id: string) => boolean,
): HumanBoardGroup {
  // 优先级 1：已完成
  if (taskIsDone(task)) return 'done';

  const status: TaskStatus = task.status;

  // 优先级 2：待我确认（人工待决）。review/blocked 只在此处出口。
  if (status === 'review' || status === 'blocked') return 'confirm';

  // 优先级 3：进行中（已被认领 / 执行中，无人工决策 pending）
  if (status === 'in_progress' || status === 'claimed') return 'doing';

  // 优先级 4上：ready 直接可开工
  if (status === 'ready') return 'ready';

  // 优先级 4下 / 5：draft 看依赖。
  // 注：`dependsOn` 为空时 `.every()` 返回 `true`（空集真值）→ 无依赖的 draft
  // 视为可开工，这是正确语义（没有任何东西挡着它开工）。
  if (status === 'draft') {
    return (task.dependsOn ?? []).every(depsDone) ? 'ready' : 'hidden';
  }

  // 走到这里说明 `status` 在类型层已是 `'done'`（被上方 `taskIsDone` 提前拦截），
  // 即**对合法数据不可达**。但对**非法/未来数据**（老版本写坏的 status 字符串
  // 绕过校验进入内存）这是唯一兜底点：返回 `'hidden'` 而非 `'done'`——
  // 宁可让脏数据显示不出来（不影响任何计数与操作），也绝不谎称它已完成
  // （谎称已完成会让真实工作被静默埋掉，是更坏的失败方向）。
  return 'hidden';
}

/** `groupTasksForHuman` 的输出：五组桶 + 反查表 + 隐藏计数 */
export interface HumanBoardView {
  /** 组 → 任务列表（**保持输入相对顺序**；排序是渲染层的事，本函数不排序） */
  groups: Record<HumanBoardGroup, Task[]>;
  /** 任务 id → 所属组（供卡片取自身归属，避免调用方二次遍历） */
  groupById: Map<string, HumanBoardGroup>;
  /** 被隐藏的条数（`draft ∧ 依赖未满足`；供「查看全部」/tech 模式的提示文案用） */
  hiddenCount: number;
}

/**
 * 批量分组：一次遍历产出五组桶 + 反查表。
 *
 * **调用方纪律**：`tasks` 应是**同一个项目**的任务（与 `computeReadyTasks` 同口径）。
 * 跨项目混传会让 `buildDepsDone` 把「另一项目的同名 id」当成依赖来源，
 * 虽然 id 全局唯一（`tsk_xxx`）不会真撞，但语义上不该这么用。
 *
 * 互斥完备由 `humanGroupOf` 的优先级链保证（每条任务恰好 return 一次），
 * 本函数不做二次去重——单测里用「集合两两求交为空」直接验证该不变量。
 */
export function groupTasksForHuman(tasks: readonly Task[]): HumanBoardView {
  const groups: Record<HumanBoardGroup, Task[]> = {
    confirm: [],
    ready: [],
    doing: [],
    done: [],
    hidden: [],
  };
  const groupById = new Map<string, HumanBoardGroup>();
  const depsDone = buildDepsDone(tasks);

  for (const task of tasks) {
    const group = humanGroupOf(task, depsDone);
    groups[group].push(task);
    groupById.set(task.id, group);
  }

  return { groups, groupById, hiddenCount: groups.hidden.length };
}
