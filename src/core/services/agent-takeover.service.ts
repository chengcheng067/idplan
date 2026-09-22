/**
 * Agent 看板「接管」领域服务（v0.8 · T04-B；PRD B11 / B12 / D5 / TS-09）。
 *
 * ══════════════════════════ 这个文件做两件事，一件都不能少 ══════════════════════════
 *
 * ① **转为正式项目（convert）**：把一块 Agent 看板整体翻成人类项目
 *    （`kind: 'agent' → 'human'`）。阶段与任务**原样保留**、`taskNo` 不变。
 * ② **搬运任务（move）**：把选中的任务搬进一个**已有**的人类项目，
 *    落点阶段由用户**显式选择**（不提供"自动建阶段"）。
 *
 * ══════════════════════ 为什么规则全部住在这里，而不是组件/store ══════════════════════
 * 项目.service 的铁律同样适用：业务规则的唯一住所是 service，组件/store 只做参数搬运。
 * 接管是**跨工作区的写**（Agent → 人类），其不变式（见下）比普通字段更新硬得多，
 * 散在 UI 里必然漂移。
 *
 * ══════════════════════ 三条硬性不变式（PRD B12，逐条有测试） ══════════════════════
 *
 * ① **`taskNo` 绝不重编号**。N8：号来自全局单计数器，跨项目不撞号；重新编号会让
 *    外部（Agent / Skill / 用户笔记里抄的 T-1007）指向别的东西。故 create 路径
 *    一律走 `tasks.bulkInsert` 且**原样携带源行 taskNo**（该仓储对"已带号的行"
 *    明确不碰计数器，见 local.tasks.repo.bulkInsert 注释——跨库搬运正是它列举的
 *    合法场景之一）。
 * ② **悬空依赖绝不静默留**。`dag.ts` 把"解不到的依赖"当作**已满足** ⇒ 一条被悄悄
 *    留空的 dependsOn 会让任务**静默变成可开工**。故：目标侧（搬进去的任务依赖了
 *    没搬走的前驱）与本批源侧（留下的任务依赖了被搬走的前驱）**两侧都显式剔除，
 *    并逐条报告**（预览里看得到，不是事后日志）。
 * ③ **源看板不留副本**（＝两份真相）。目标行落定并**读回验证**之后，源行才删除；
 *    同 externalId 命中目标项目既有行时走**更新**（项目内幂等，与 v3
 *    `upsertByExternalId` 同语义），而不是新建一条重复任务。
 *
 * ══════════════════════ 档位边界（remote 为什么不做） ══════════════════════
 * move 依赖 `PATCH /api/tasks/:id` 支持 `project_id / stage_id` 与"保留 taskNo 的
 * 批量新建"——服务端 tasks 路由的 merged 白名单**没有**这些字段（传了会被静默
 * 丢弃 ⇒ 任务留在源项目，若调用方接着删源行就是**数据丢失**）。故本服务只服务
 * local（Dexie）档；remote 档由 store action 层直接拒发（见 useProjectsStore 的
 * 档位门），**不在这个文件里猜环境**——service 保持纯领域层。
 *
 * ══════════════════════ 部分失败时的状态（如实记录） ══════════════════════
 * 执行序：create/update 全部落库 → **读回逐条验证** → 才删源行 → 最后源侧重接线。
 * 若在中途抛错：目标侧可能已多出任务（最坏=重复，看得见），源行**一條都没删**
 * （不丢数据）。取"最坏是重复、绝不是丢失"这个方向，是因为重复可清理、
 * 丢失不可逆；第二次重试时 externalId 命中会转为 update，自动收敛。
 */

import { createId } from '../../lib/id';
import { visibleProjectsFor } from '../project/visibility';
import type { IRepositoryBundle } from '../repositories/interfaces';
import type { Project, Task } from '../types/entities';
import { ChangxiaError, ChangxiaErrorCode, type ProjectKind } from '../types/enums';
import type { UpdateTaskCmd } from '../types/dto';

/* ══════════════════════════════ 计划（纯函数，可测） ══════════════════════════════ */

/** 单条任务的落点判定：create=目标项目无同 externalId 行；update=命中既有行（项目内幂等） */
export type MoveDisposition = 'create' | 'update';

export interface PlannedMove {
  /** 源看板里的任务 id */
  sourceId: string;
  title: string;
  /** 落点比对键；人工任务为 null（无幂等语义，恒定走 create） */
  externalId?: string | null;
  disposition: MoveDisposition;
  /** create → 新生成的 id；update → 目标项目**既有行**的 id */
  finalId: string;
  /** 改写后的 dependsOn：同批搬走的前驱已映射到 finalId，未搬走的已剔除 */
  nextDependsOn: string[];
  /** 因前驱未随本批搬走而被剔除的依赖（目标侧悬空，dag 下会"被满足"故必须显式剔除） */
  droppedDeps: Array<{ depId: string; depTitle: string }>;
}

/** 源看板里**留下**的任务：依赖了被搬走的前驱 ⇒ 剥掉该边（否则 dag 同样静默放行） */
export interface SourceRewire {
  taskId: string;
  title: string;
  /** 被剥掉的已搬走前驱 id */
  removedDepIds: string[];
  nextDependsOn: string[];
}

export interface MovePlan {
  targetProjectId: string;
  stageId: string;
  moves: PlannedMove[];
  sourceRewires: SourceRewire[];
}

/**
 * 纯规划：给定源任务 / 目标任务 / 勾选集 / 落点阶段，算出完整搬运计划。
 *
 * 预览与执行**共用本函数**——预览的数字若与执行不符，只能是输入变了，
 * 不可能是两套算法漂移（那正是"预览说搬 3 条、实际搬 5 条"这类缺陷的根因）。
 */
export function planTaskMove(input: {
  sourceTasks: readonly Task[];
  targetTasks: readonly Task[];
  taskIds: readonly string[];
  stageId: string;
  targetProjectId: string;
}): MovePlan {
  const selectedIds = new Set(input.taskIds);
  const byId = new Map(input.sourceTasks.map((t) => [t.id, t] as const));
  const selected = input.sourceTasks.filter((t) => selectedIds.has(t.id));

  // 目标项目里按 externalId 建索引（undefined / null 不进索引——它们没有幂等语义）
  const targetByExternal = new Map<string, Task>();
  for (const t of input.targetTasks) {
    if (t.externalId && !targetByExternal.has(t.externalId)) {
      targetByExternal.set(t.externalId, t);
    }
  }

  // 第一遍：定 disposition 与 finalId（update 用目标既有行 id，create 用新 id）
  const finalIdBySource = new Map<string, string>();
  const moves: PlannedMove[] = selected.map((src) => {
    const hit = src.externalId ? targetByExternal.get(src.externalId) : undefined;
    const disposition: MoveDisposition = hit ? 'update' : 'create';
    const finalId = hit ? hit.id : createId('tsk');
    finalIdBySource.set(src.id, finalId);
    return {
      sourceId: src.id,
      title: src.title,
      externalId: src.externalId,
      disposition,
      finalId,
      nextDependsOn: [],
      droppedDeps: [],
    };
  });

  // 第二遍：依赖改写（同批搬走 → 映射 finalId；未搬走 → 剔除并记录）
  for (const m of moves) {
    const src = byId.get(m.sourceId)!;
    for (const depId of src.dependsOn) {
      const mapped = finalIdBySource.get(depId);
      if (mapped !== undefined) {
        m.nextDependsOn.push(mapped);
        continue;
      }
      const dep = byId.get(depId);
      m.droppedDeps.push({ depId, depTitle: dep?.title ?? depId });
    }
  }

  // 第三遍：源看板留下的任务，剥掉指向"已搬走任务"的边
  const sourceRewires: SourceRewire[] = [];
  for (const t of input.sourceTasks) {
    if (selectedIds.has(t.id)) continue;
    const removedDepIds = t.dependsOn.filter((d) => selectedIds.has(d));
    if (removedDepIds.length === 0) continue;
    sourceRewires.push({
      taskId: t.id,
      title: t.title,
      removedDepIds,
      nextDependsOn: t.dependsOn.filter((d) => !selectedIds.has(d)),
    });
  }

  return { targetProjectId: input.targetProjectId, stageId: input.stageId, moves, sourceRewires };
}

/** 预览摘要（UI 直接渲染；与 execute 的结果同源，见 planTaskMove 注释） */
export interface MovePreview {
  createCount: number;
  updateCount: number;
  /** 目标侧悬空依赖总条数（搬进去的任务被剥掉的边） */
  droppedDependencyCount: number;
  /** 源侧悬空依赖总条数（留下的任务被剥掉的边） */
  sourceDroppedDependencyCount: number;
  moves: PlannedMove[];
  sourceRewires: SourceRewire[];
}

export function previewMove(plan: MovePlan): MovePreview {
  return {
    createCount: plan.moves.filter((m) => m.disposition === 'create').length,
    updateCount: plan.moves.filter((m) => m.disposition === 'update').length,
    droppedDependencyCount: plan.moves.reduce((n, m) => n + m.droppedDeps.length, 0),
    sourceDroppedDependencyCount: plan.sourceRewires.reduce((n, r) => n + r.removedDepIds.length, 0),
    moves: plan.moves,
    sourceRewires: plan.sourceRewires,
  };
}

/* ══════════════════════════════ 执行（带 IO，经仓储） ══════════════════════════════ */

export interface MoveOutcome {
  created: number;
  updated: number;
  droppedDependencies: number;
  sourceDroppedDependencies: number;
}

export class AgentTakeoverService {
  public constructor(private readonly deps: { bundle: IRepositoryBundle }) {}

  /**
   * 接管（a）：Agent 看板 → 人类项目（PRD B11）。
   *
   * 只翻 `kind` 一个字段：阶段、任务、`taskNo` 原样保留（它们本就挂在 projectId 上，
   * 不需要任何搬运）。调用方（store action）负责刷新镜像；本方法只保证落库正确。
   */
  public async convertBoardToHuman(boardId: string): Promise<Project> {
    const bundle = this.deps.bundle;
    const board = await bundle.projects.get(boardId);
    if (!board) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该 Agent 看板，可能已被删除。');
    }
    // 只认字面量 'agent'（与 visibility.projectKindOf 同口径：老库/脏值按 human）
    if (board.kind !== 'agent') {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        '只能接管 Agent 看板：该项目已经是人类工作区的项目。',
      );
    }
    return bundle.projects.update(boardId, { kind: 'human' satisfies ProjectKind });
  }

  /**
   * 接管（b）：把选中任务搬进人类项目（PRD B12）。
   *
   * 校验序（fail fast，任一不过零写入）：
   *   ① 源看板存在且是 Agent 看板；
   *   ② 目标项目存在且是**人类**项目（把任务搬进另一块 Agent 看板是无意义搬运）；
   *   ③ 落点阶段存在且**属于目标项目**（不提供"自动建阶段"，落点必须显式）；
   *   ④ 勾选非空，且每条都确实属于源看板。
   */
  public async moveTasksToHumanProject(input: {
    boardId: string;
    targetProjectId: string;
    stageId: string;
    taskIds: readonly string[];
  }): Promise<MoveOutcome> {
    const bundle = this.deps.bundle;
    const { boardId, targetProjectId, stageId, taskIds } = input;

    const board = await bundle.projects.get(boardId);
    if (!board) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该 Agent 看板，可能已被删除。');
    }
    if (board.kind !== 'agent') {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '只能从 Agent 看板搬运任务。');
    }
    const target = await bundle.projects.get(targetProjectId);
    if (!target) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到目标项目，可能已被删除。');
    }
    if (target.kind === 'agent') {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        '目标必须是人类工作区的项目：把任务搬进另一块 Agent 看板没有意义。',
      );
    }
    const targetStages = await bundle.stages.listByProject(targetProjectId);
    if (!targetStages.some((s) => s.id === stageId)) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        '落点阶段必须属于目标项目（请先在目标项目里选一个阶段）。',
      );
    }
    if (taskIds.length === 0) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '请至少选择一条要搬运的任务。');
    }

    const [sourceTasks, targetTasks] = await Promise.all([
      bundle.tasks.listByProject(boardId),
      bundle.tasks.listByProject(targetProjectId),
    ]);
    const selectedIds = new Set(taskIds);
    const selected = sourceTasks.filter((t) => selectedIds.has(t.id));
    if (selected.length !== taskIds.length) {
      throw new ChangxiaError(
        ChangxiaErrorCode.NotFound,
        '有任务不在该看板下（可能已被删除），请刷新后重试。',
      );
    }

    const plan = planTaskMove({ sourceTasks, targetTasks, taskIds, stageId, targetProjectId });
    const preview = previewMove(plan);

    /* ── 写 1/2：目标侧（create 走 bulkInsert 原样带号；update 命中行原地合并） ── */
    const nowIso = new Date().toISOString();
    const stageSiblings = targetTasks
      .filter((t) => t.stageId === stageId)
      .reduce((max, t) => Math.max(max, t.orderIndex), 0);
    let nextOrder = stageSiblings;

    const createRows: Task[] = [];
    const updateCmds: Array<{ id: string; cmd: UpdateTaskCmd }> = [];
    for (const m of plan.moves) {
      const src = sourceTasks.find((t) => t.id === m.sourceId)!;
      if (m.disposition === 'create') {
        nextOrder += 1;
        createRows.push({
          ...src,
          id: m.finalId,
          // ★ taskNo 原样保留（不重编号）；bulkInsert 对"已带号的行"不碰计数器
          taskNo: src.taskNo,
          projectId: targetProjectId,
          stageId,
          orderIndex: nextOrder,
          dependsOn: m.nextDependsOn,
          revision: 1,
          updatedAt: nowIso,
        });
      } else {
        updateCmds.push({
          id: m.finalId,
          cmd: {
            // 目标行已在目标项目里，这里不传 projectId；落点阶段按用户显式选择覆写
            stageId,
            title: src.title,
            // 状态双写由仓储按 status 派生（done 不直接传）
            status: src.status,
            assigneeId: src.assigneeId,
            assigneeIds: src.assigneeIds,
            dueDate: src.dueDate,
            itineraryDate: src.itineraryDate,
            description: src.description,
            dependsOn: m.nextDependsOn,
            artifacts: src.artifacts,
            startAt: src.startAt,
            claimedAt: src.claimedAt,
            source: src.source,
            agentId: src.agentId,
          },
        });
      }
    }
    if (createRows.length > 0) await bundle.tasks.bulkInsert(createRows);
    for (const u of updateCmds) await bundle.tasks.update(u.id, u.cmd);

    /* ── 验证：读回逐条核对后才允许删源行（最坏留重复，绝不留丢失） ── */
    const written = await bundle.tasks.listByProject(targetProjectId);
    const writtenById = new Map(written.map((t) => [t.id, t] as const));
    for (const m of plan.moves) {
      const row = writtenById.get(m.finalId);
      if (!row || row.projectId !== targetProjectId) {
        throw new ChangxiaError(
          ChangxiaErrorCode.Storage,
          `任务「${m.title}」写入目标项目后验证失败，已中止（源看板数据未动）。`,
        );
      }
      if (m.disposition === 'create' && row.stageId !== stageId) {
        throw new ChangxiaError(
          ChangxiaErrorCode.Storage,
          `任务「${m.title}」落点阶段验证失败，已中止（源看板数据未动）。`,
        );
      }
    }

    /* ── 写 2/2：删源行（此时目标侧已确认落定）＋ 源看板剩余任务剥掉悬空边 ── */
    for (const m of plan.moves) {
      await bundle.tasks.remove(m.sourceId);
    }
    for (const r of plan.sourceRewires) {
      await bundle.tasks.update(r.taskId, { dependsOn: r.nextDependsOn });
    }

    return {
      created: preview.createCount,
      updated: preview.updateCount,
      droppedDependencies: preview.droppedDependencyCount,
      sourceDroppedDependencies: preview.sourceDroppedDependencyCount,
    };
  }
}

/* ══════════════════════════ 小工具（调用方漏斗，不重复判 kind） ══════════════════════ */

/**
 * 给接管弹窗筛目标候选：**只剩人类项目**。
 * 直接复用 visibility 的单一谓词出口，不在这里写第二份 kind 判定。
 */
export function humanTakeoverCandidates(all: readonly Project[]): Project[] {
  return visibleProjectsFor('human', all);
}
