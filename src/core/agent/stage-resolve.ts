/**
 * 阶段落点解析（v0.7 · T02 · 设计文档 §4.3 / §4.4 / §4.7）。
 *
 * ── 本文件解决什么 ──
 * 「导入请求显式声明了落点阶段名」这件事需要两类函数，**分居两处**：
 *   · **判重算式**（`normalizeStageName` / `resolveStageByName`）→ `src/core/lib/task-no.ts`。
 *     它们是「纯字符串运算 + 一次过滤」，与 taskNo 同属「必须前后端逐字一致的幂等键算式」，
 *     且放在那个文件能白拿 `npm run typecheck:server` 的「零浏览器依赖」守卫（§2.3 ⑨）。
 *     本文件从那里 **import**（不重写一份 —— 两份实现即两份真相）。
 *   · **领域构造**（本文件）：
 *       ① `buildCreatedStage` —— 「自动建出的阶段」**属性表**（§4.3 逐字段定死）；
 *       ② `planImpact`        —— 新建阶段的**连带效应**（§4.7 完成度稀释 + 翻回进行中）。
 *     它们要 Project / StageStatus / `lib/progress` 等**领域**依赖，故不属「零依赖」库。
 *
 * ── 为什么「按名选点」不能省（§4.4 唯一加粗警告）──
 * 若只做「缺则建」而不做「按名选点」，用户显式声明了 `Agent 排期`，任务却被落到
 * 「orderIndex 最大的那个可见阶段」—— **显式声明被静默忽略**，这正是本 PRD 一贯
 * 批判的「静默」毛病。命中分支的实现见 `resolveStageByName`（`task-no.ts`）。
 *
 * ── 纪律 ──
 * 零 IO、零 repo import、零 browser/Node API（`crypto.randomUUID()` 由调用方
 * `payload.apply.ts` 生成 id 后传入，本文件不自己造 id）——
 * 这是 `npm run typecheck:server` 的边界守卫（§2.15 ⑨ / §7.3.2 I-6）。
 */

import { ProjectCalendarStatus, StageStatus } from '../types/enums';
import type { Project, Stage, Task } from '../types/entities';
import type { ApplyStageImpact } from '../types/agent-payload';
// ★ 判重算式**只有一份实现**：本文件从 task-no.ts import（不重写），并**再出口**给调用方
import { normalizeStageName, resolveStageByName } from '../lib/task-no';
// 项目完成度 / 项目状态**复用既有唯一口径**（src/lib/progress.ts）：
// 各写一份 `done / visible.length` 的算式，就是又一处会漂移的「两份真相」。
// 该文件零 DOM、零 Node（只 import 类型 + taskIsDone），可被服务端 typecheck 跟随
// （v0.7 起已在 server/tsconfig.json 的 include 中**显式**列出）。
import { computeProjectPercent, computeProjectStatus } from '../../lib/progress';

/** 判重相关导出的**再出口**：调用方（`payload.apply`）只 import 本文件即可 */
export { normalizeStageName, resolveStageByName };
export type { StageNameResolution } from '../lib/task-no';

/** 新建阶段的色号上下限：与 `stage-fallback` 既有口径一致（`clamp(orderIndex, 1, 9)`） */
const STAGE_COLOR_MIN = 1;
const STAGE_COLOR_MAX = 9;

/** `planImpact` 合成「待建阶段探针」用的占位 id —— **永不落库**（预览路径零写入，C3） */
const PLANNED_STAGE_PROBE_ID = 'stg_planned_probe';

/** `buildCreatedStage` 入参 */
export interface BuildCreatedStageInput {
  /** 阶段 id，由调用方用 `crypto.randomUUID()` 生成（与本文件「零 API」纪律一致） */
  id: string;
  /** 目标项目（阶段起止日取项目基线，故需要它） */
  project: Project;
  /** **声明名**：写入时取 `trim()` 后的原样文本，不写归一值（§4.3） */
  declaredName: string;
  /** 由 `resolveStageByName` 给出的落点序号（含隐藏阶段的 max + 1） */
  orderIndex: number;
  /** 落库时刻（缺省取当前时刻；纯函数范式下允许注入，便于断言） */
  nowIso?: string;
}

/**
 * 构造「自动建出的阶段」整行（§4.3 属性表，逐字段定死）。
 *
 * | 属性 | 取值 | 理由 |
 * | --- | --- | --- |
 * | `name` | 声明名 `trim()` 后的**原样文本** | 用户看到的名字应与声明一致 |
 * | `orderIndex` | 入参（= 全部阶段 max + 1，含隐藏） | 只按可见取 max 会与隐藏阶段撞号 |
 * | `colorIndex` | `clamp(orderIndex, 1, 9)` | 与 `stage-fallback` 既有口径一致 |
 * | `templateKey` | `null` | 副作用已核：`getItemKanbanColumn(null)` → `null` → 落列按 `orderIndex` 均分，不崩 |
 * | `ratioPercent` | `0` | `computeProjectPercent` 用 `done / visible.length`，不读本字段 → 无除零风险 |
 * | `visible` | **`true`** | 新建即不可见 = 落点变黑洞 |
 * | `status` | `StageStatus.NotStarted` | 新阶段客观未开始，不继承项目当前阶段的进行中状态 |
 * | `startAt` / `endAt` | 项目基线 `plannedStartAt` / `plannedEndAt` | 阶段必须有起止日（时间轴/月历依赖）；取项目基线是**确定值**，不引入猜测 |
 * | `ownerId` / `resourcePath` | `null` | 未指派 |
 * | `revision` / `updatedAt` | `1` / 落库时刻 | 与既有新建行一致 |
 * | **变更流水** | **不写 `StageLog`** | 新建不是「流转/延期」事件，写流水会污染 append-only 的延期档案（C9） |
 */
export function buildCreatedStage(input: BuildCreatedStageInput): Stage {
  const { id, project, declaredName, orderIndex, nowIso } = input;
  return {
    id,
    projectId: project.id,
    orderIndex,
    templateKey: null,
    colorIndex: Math.min(STAGE_COLOR_MAX, Math.max(STAGE_COLOR_MIN, orderIndex)),
    name: declaredName.trim(),
    ratioPercent: 0,
    startAt: project.plannedStartAt,
    endAt: project.plannedEndAt,
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: nowIso ?? new Date().toISOString(),
  };
}

/**
 * 新建阶段的**连带效应**（§4.7）—— 供预览渲染「完成度 62% → 56%」与
 * 「该项目当前已完成，新建阶段会使其回到进行中」。
 *
 * 两半效应都由**既有派生层**算出，绝不另写一份算式：
 *   ① 完成度：`computeProjectPercent` = `done / visible.length` → 可见阶段 +1 → **下降**；
 *   ② 项目状态：`computeProjectStatus` → 新增一个 `not_started` 可见阶段 → 全完成的项目
 *      回到 `in_progress` / `overdue`。
 *
 * `_tasks` 参数：§4.7 的签名含 `tasks`，但两条效应的**既有口径都不读任务**
 * （完成度按可见阶段计数，与任务无关）。此处保留形参以避免签名漂移，并显式标注未使用；
 * 若将来完成度口径改为「按任务聚合」，改这一处即可。
 *
 * @param todayIso 项目状态的「今天」口径（缺省取当前日期；注入便于单测断言）。
 */
export function planImpact(
  project: Project,
  stages: readonly Stage[],
  _tasks: readonly Task[] = [],
  todayIso: string = new Date().toISOString().slice(0, 10),
): ApplyStageImpact {
  // 探针阶段：只用它「占一个可见且未完成的位」，故只取 buildCreatedStage 的形状，
  // 名字与序号不参与 percent/status 计算（id 是占位串，永不落库）。
  const probe = buildCreatedStage({
    id: PLANNED_STAGE_PROBE_ID,
    project,
    declaredName: '',
    orderIndex: stages.reduce((max, s) => Math.max(max, s.orderIndex), -1) + 1,
    nowIso: `${todayIso}T00:00:00.000Z`,
  });

  const before: Stage[] = [...stages];
  const after: Stage[] = [...stages, probe];

  return {
    // 取整到整数百分比：契约样例（62% → 56%）与 UI 文案都是整数，小数会让
    // 「所见即所写」的比对变脆（同一算式不同浮点尾差渲染出两个数）。
    percentBefore: Math.round(computeProjectPercent(before)),
    percentAfter: Math.round(computeProjectPercent(after)),
    // ★ v0.7 契约修订 R1 已把 `ApplyStageImpact.statusBefore/After` 更正为
    //   **`ProjectCalendarStatus`**（四值日历态），与这里的产出**类型完全对应** ——
    //   故不再需要任何窄化断言。契约即真相，实现即契约。
    statusBefore: computeProjectStatus(project, before, todayIso),
    statusAfter: computeProjectStatus(project, after, todayIso),
  };
}
