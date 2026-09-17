/**
 * Agent payload 落库编排（v0.6 · 设计文档 T09 / §4.1；v0.7 T02 增阶段落点解析）。
 *
 * 两个出口：
 *   - `previewAgentPayload()`：只算不写（差异预览：created / updated / rejected）；
 *   - `applyAgentPayload()`：真正写库。二者共用内部 `resolve()`，保证「所见即所写」。
 *
 * resolve 顺序**严格照 §4.1**：
 *   ① 取既有 tasks 建 `externalId → id` 映射
 *   ② `dependsOnExternal` 解引用（历史 externalId → 既有 id；本批 externalId → 批内引用）
 *   ③ `detectCycles`（Kahn 迭代，统一图 = 既有任务 + 本批伪任务）
 *   ④ 未解引用者 `rejected(dep_unresolved)`，其余正常写入
 *
 * 纪律：
 *   - **环命中 → 整批拒绝**（created=0 / updated=0，全部条目进 rejected，code:'cycle'），
 *     库内零写入（T06 的事务语义兜底）；
 *   - **宽松状态通道**：payload 给定 status 直落，不走 `TASK_STATUS_TRANSITIONS`
 *     ——上游 Agent 是事实源，它对任务生命周期的裁断不服从 App 内白名单
 *     （设计文档 T09 要点 9 明文要求，勿"修复"成严格通道）；
 *   - **写库唯一出口**：行写入只经 `repo.upsertByExternalId()`（PRD §0.4-4）。
 *     批内依赖（A 依赖同批的 B）需要 B 的真实 id，而 id 由仓储在 upsert 时生成——
 *     故采用**两段式 upsert**：第一段落所有行（批内依赖暂剥除）→ 回读建全量映射 →
 *     第二段仅对含批内依赖的行重写完整 dependsOn（幂等：命中 externalId 即合并）。
 *     这样既不改 TaskUpsertRow 的形状，也不绕开唯一写入出口。
 *   - `ensureAgentMember` **必须幂等**：按 (actorKind='agent', agentKind, name) 查找，
 *     命中复用——否则重复导入每次吃掉一个免费 3 席位（PRD 附录 C）。
 *   - `stageId` 缺省 → 落该项目 orderIndex 最大的**可见** Stage；项目无 Stage →
 *     `rejected('stage_limit')`。
 *     ★ 绝不静默自动建 Stage；仅当导入请求显式声明落点阶段名、且该项目无同名阶段时才创建。
 *     未声明 → 行为与 v0.6 逐字节一致（无可用阶段 → `stage_limit`，不建），项目仍绝不自动建。
 *     显式声明的载体为 query `?stageName=`（见 §4.2）。
 *     （用户 2026-09-09 拍板 / §10-R3；MAX_STAGE_COUNT 只在建档时校验、DB 层无约束，
 *     自动建会让反复导入静默造出 20+ 批次拉垮 Timeline）
 *     ⚠️ 上面这段「铁律措辞」是**唯一有效版本**（§4.1 标准措辞），三处必须逐字一致；
 *     旧措辞（只写「绝不自动新建 Stage」、不提 `?stageName=`）会在本文件与 §4.2 之间
 *     留下「文档说可以声明、注释说绝不建」的自相矛盾，下一位工程师读到旧注释会
 *     把这个功能当 bug 删掉。
 */

import {
  ChangxiaError,
  ChangxiaErrorCode,
  MemberActorKind,
  MemberRoleKind,
  TaskStatus,
} from '../types/enums';
import type { Stage, Task, TaskArtifact } from '../types/entities';
import type {
  AgentPayloadV1,
  ApplyResult,
  ApplyRejection,
  ApplyStageResolution,
} from '../types/agent-payload';
import type { IRepositoryBundle, TaskUpsertRow } from '../repositories/interfaces';
import { buildDependencyGraph, topoLayers } from './dag';
// v0.7 T02：落点阶段的**按名解析 / 新建 / 连带效应**全部收口在 stage-resolve（纯函数）
import { buildCreatedStage, planImpact, resolveStageByName } from './stage-resolve';

/** Agent 成员落库时的默认头像色（与既有 member 行同款 hex 格式；UI 语义色仍走 token） */
const AGENT_MEMBER_AVATAR = '#6B5B8C';

/** 批内伪任务节点前缀：把 externalId 提升为图节点 id 时防与真实 Task.id 撞名 */
const BATCH_NODE_PREFIX = 'ext::';

/** 应用选项：payload.projectId 为 null 时由调用方（UI）显式指定目标项目 */
export interface ApplyOptions {
  /** 目标项目（payload.projectId 为空时使用） */
  projectId?: string;
  /**
   * v0.7 T02 · **显式声明的落点阶段名**（query `?stageName=` / 其同义别名）。
   *
   * 语义（§4.2 决策树 / §4.5 解析失败矩阵）：
   *   - `undefined` / `null` → **未声明**：行为与 v0.6 逐字节一致（缺省落最后一个可见批次；
   *     无可见批次 → `stage_limit`，**绝不自动建**）；
   *   - 非空字符串 → 项目存在**同名可见**阶段则复用（`mode:'existing'`），
   *     否则计划新建（预览 `mode:'planned'` / 实写 `mode:'created'`）；
   *   - 空串 / 仅空白 → 抛 `ChangxiaError(Validation)`，**绝不静默降级为「未声明」**（C7）。
   */
  stageName?: string | null;
}

/** resolve 的中间产物（preview 与 apply 共用） */
interface ResolvedPlan {
  projectId: string;
  stageId: string | null;
  /**
   * v0.7 恒定字段：本批的落点阶段（R1 四键恒定）。
   *   - 命中已有批次 → `existing`（id 非空）；
   *   - 声明了名字但无同名阶段 → `planned`（`id:null` + `impact` 必出现，R4/R5）；
   *   - 无落点（项目无可见批次且**未**声明名字）→ `none`
   *     （`{mode:'none', id:null, name:'', orderIndex:-1}` 哨兵，§10.2 裁定 A / 样例 C）。
   */
  stage: ApplyStageResolution;
  /**
   * `mode === 'planned'` 时**待创建**的阶段整行（含已生成的 id）；其余为 null。
   *
   * ★ 为什么把它放在 plan 里而不是只留 `stage.name`：id 在 `resolve()` 内就生成，
   *   于是**行的 `stageId` 从一开始就是真 id**，不存在「先写空 stageId、建完再补」的窗口
   *   —— 那个窗口正是 §4.6 点名的「本功能最容易出的一个致命 bug」（C1：行落到
   *   `stage_id=''` → DB 层外键/查询全崩）。`applyAgentPayload` 仍会再重写一次
   *   （幂等，见该函数注释），使「建阶段 → 行落点」之间没有第二种可能。
   */
  plannedStage: Stage | null;
  /** 待写入行（已被拒绝的条目不在其中） */
  rows: TaskUpsertRow[];
  /** 每行的 payload externalId（与 rows 同序，供两段式 upsert 回查） */
  rowExternalIds: string[];
  /** 每行的批内依赖 externalId 列表（与 rows 同序；空数组 = 无批内依赖） */
  rowBatchDeps: string[][];
  rejected: ApplyRejection[];
  /** 预览计数（apply 以真实 upsert 返回为准） */
  created: number;
  updated: number;
}

/**
 * 读取**显式声明**的落点阶段名（§4.5 最后两行的解析失败矩阵）。
 *
 * - `undefined` / `null` → `null`：**未声明**（走 v0.6 既有行为）；
 * - 空串 / 仅空白 → 抛 `ChangxiaError(Validation)`：显式声明却无名称 = 调用方 bug，
 *   静默当「未声明」会把它掩盖成「任务落到别的批次」（C7）；
 * - 其余 → `trim()` 后的名字（后续归一由 `resolveStageByName` 负责）。
 */
function readDeclaredStageName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      'stageName 不能为空；未声明落点阶段名时请完全不要传该参数。',
    );
  }
  return trimmed;
}

/**
 * 落库编排的共享核心。零写库（成员创建除外——由 apply 在 resolve 后显式调用）。
 */
async function resolve(
  repos: IRepositoryBundle,
  payload: AgentPayloadV1,
  opts?: ApplyOptions,
): Promise<ResolvedPlan> {
  const projectId = payload.projectId ?? opts?.projectId ?? null;
  if (!projectId) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      'payload 未指定目标项目，请先选择项目后再导入。',
    );
  }
  const project = await repos.projects.get(projectId);
  if (!project) {
    throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到目标项目，无法导入 payload。');
  }

  const rejected: ApplyRejection[] = [];

  /* ---- 批次策略（§4.2 决策树 / §10-R3 铁律 / §4.1 ②）----
   * 本段判序：
   *   ① `payload.stageId` 命中**可见**批次 → `existing`；给了但查不到 → 无落点（不建）；
   *   ② 未给 stageId 且**声明了**落点阶段名 → 同名可见阶段复用（`existing`）；
   *      无同名 → 计划新建（`planned`，实写在 apply 里升级为 `created`）；
   *   ③ 未给且**未声明** → 落 orderIndex 最大的可见批次（现状行为，`existing`）；
   *   ④ 未给、未声明且**无可见批次** → 整批 `stage_limit`、零写入、`stage:'none'`。
   *
   * ★ 此分支**先**检查 `stageName`，未声明才走 `stage_limit`（§4.1 ② 明文要求）。
   * ★ 绝不静默自动建 Stage；仅当导入请求显式声明落点阶段名、且该项目无同名阶段时才创建。
   */
  const allStages = await repos.stages.listByProject(projectId);
  // 合法落点只能是**可见**阶段（隐藏阶段的 orderIndex 仍参与新阶段序号计算，见下）
  const visibleStages = allStages
    .filter((s) => s.visible)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  let stageId: string | null = null;
  /** 命中的批次**对象**（不只留 id —— `stage` 需要 name / orderIndex 回填） */
  let stageHit: Stage | null = null;
  /** 计划新建的批次整行（`mode:'planned'` 时非空；id 已生成，见 ResolvedPlan 注释） */
  let plannedStage: Stage | null = null;

  const declaredName = readDeclaredStageName(opts?.stageName);

  if (payload.stageId) {
    const hit = visibleStages.find((s) => s.id === payload.stageId);
    if (hit) {
      stageId = hit.id;
      stageHit = hit;
    }
    // 未命中 → 无落点：由下方 `!stageId` 分支逐条 `stage_limit` 拒绝，**绝不自动建**
  } else if (declaredName !== null) {
    // ★ **按名选点**：声明了名字就必须按名字命中，哪怕项目里还有别的可见批次。
    //   只做「缺则建」而不做「按名选点」，用户的显式声明会被静默忽略（§4.4 / C2）。
    //   传入的是**全部**阶段：同名只看可见，而新阶段序号要含隐藏阶段取 max（C4/C5）。
    const resolution = resolveStageByName(declaredName, allStages);
    if (resolution.hit) {
      stageHit = resolution.hit;
      stageId = resolution.hit.id;
    } else {
      plannedStage = buildCreatedStage({
        id: `stg_${crypto.randomUUID()}`,
        project,
        declaredName,
        orderIndex: resolution.orderIndex,
      });
      stageId = plannedStage.id;
    }
  } else if (visibleStages.length > 0) {
    stageHit = visibleStages[visibleStages.length - 1]!; // orderIndex 最大的可见批次
    stageId = stageHit.id;
  }
  // else：无落点 → 下方 `!stageId` 分支逐条 stage_limit（铁律：不建）

  /**
   * 落点解析结果（R1 四键恒定 / R4 四态表 / R5 正向白名单）：
   *   命中已有批次 → `existing`（id 非空，**无 `impact` 键**）；
   *   无同名阶段的显式声明 → `planned`（`id:null` + `name` + 预计 `orderIndex` + `impact`）；
   *   无落点 → `none`（`id:null` + `name:''` + `orderIndex:-1`，**无 `impact` 键**）。
   */
  const stage: ApplyStageResolution = stageHit
    ? {
        mode: 'existing',
        id: stageHit.id,
        name: stageHit.name,
        orderIndex: stageHit.orderIndex,
      }
    : plannedStage
      ? {
          mode: 'planned',
          id: null, // R4：planned 恒为 null（阶段尚未落库）
          name: plannedStage.name,
          orderIndex: plannedStage.orderIndex,
          // ★ R5 **正向白名单**：impact 出现 ⟺ mode ∈ {'planned','created'}。
          //   绝不写 `mode !== 'existing'` —— 枚举一扩张（本轮新增 'none'）就会把
          //   一次零写入的批次也卷进来，吐出「将新建阶段『』，完成度 62%→56%」的
          //   错误回执（C15/C16）。
          impact: planImpact(project, allStages),
        }
      : { mode: 'none', id: null, name: '', orderIndex: -1 };

  if (!stageId) {
    // 批次不可用 → 全部条目按批次级拒绝返回（保持 ApplyResult 形状恒定，C11）。
    // 注意：这里是 `stage_limit` 的**唯一**出口，逐条给出 reason（样例 C 的形状），
    // 故本函数内不再另推一条批次级 `(batch)` 条目 —— 那一条会被这里整体覆盖（死代码）。
    return {
      projectId,
      stageId: null,
      stage,
      plannedStage: null,
      rows: [],
      rowExternalIds: [],
      rowBatchDeps: [],
      rejected: payload.tasks.map((t) => ({
        externalId: t.externalId,
        code: 'stage_limit' as const,
        reason: '批次不可用（项目无批次或指定批次不存在），本条未写入。',
      })),
      created: 0,
      updated: 0,
    };
  }
  // 窄化一次并复用：本批所有行的落点恒为它（`planned` 时即「待建阶段的 id」）
  const effectiveStageId: string = stageId;

  /* ---- ① 既有任务 externalId → id 映射（仅本项目） ---- */
  const existingTasks = await repos.tasks.listByProject(projectId);
  const extMap = new Map<string, Task>();
  for (const t of existingTasks) {
    if (t.externalId) extMap.set(t.externalId, t);
  }

  /* ---- ② dependsOnExternal 解引用（含批内引用的传递闭包） ----
   * 批内引用指向的条目自身也可能 dep_unresolved → 用不动点迭代传播，
   * 保证「被拒绝条目的下游」也被拒绝而不是写进库里指向悬空。 */
  interface BatchEntry {
    task: AgentPayloadV1['tasks'][number];
    resolved: string[]; // 已解析为 Task.id 的依赖
    batchRefs: string[]; // 尚待两段式第二段解析的批内引用（externalId）
    ok: boolean;
  }
  const entries: BatchEntry[] = payload.tasks.map((t) => ({
    task: t,
    resolved: [],
    batchRefs: [],
    ok: true,
  }));
  const entryByExternalId = new Map(entries.map((e) => [e.task.externalId, e] as const));

  /* ---- ①b 批内重复 externalId 预检（QA 返工 🟠-1）----
   * 同 externalId 在本批出现 ≥2 次 → 仅保留首到者，后到者逐条 rejected('conflict')。
   * 绝不允许静默合并：upsertByExternalId 的「后到覆盖前到」会让 preview 计数与
   * 实际写入不一致（违反「所见即所写」PRD 附录 A 规则 4 与 AUS-4 逐条 reason）。
   * 预检在解引用之前完成：dup 条目 ok=false，下游引用它的条目由不动点迭代
   * 传播为 dep_unresolved，行为与其它被拒条目一致。 */
  {
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.task.externalId)) {
        e.ok = false;
        rejected.push({
          externalId: e.task.externalId,
          code: 'conflict',
          reason: '批内存在相同 externalId 的条目，仅保留首次出现的条目，本条未写入。',
        });
      } else {
        seen.add(e.task.externalId);
      }
    }
  }

  const resolveOnce = (): boolean => {
    let changed = false;
    for (const e of entries) {
      if (!e.ok) continue;
      const resolved: string[] = [];
      const batchRefs: string[] = [];
      let ok = true;
      for (const dep of e.task.dependsOnExternal) {
        const historical = extMap.get(dep);
        if (historical) {
          resolved.push(historical.id);
          continue;
        }
        const batchTarget = entryByExternalId.get(dep);
        if (batchTarget && batchTarget.ok) {
          batchRefs.push(dep);
          continue;
        }
        // 未知 key，或指向本批内已被拒绝的条目 → 本条也拒绝
        ok = false;
        rejected.push({
          externalId: e.task.externalId,
          code: 'dep_unresolved',
          reason: `依赖的 externalId「${dep}」不存在于本项目或本批次，本条未写入。`,
        });
        break;
      }
      if (!ok) {
        e.ok = false;
        changed = true;
        continue;
      }
      if (
        resolved.length !== e.resolved.length ||
        batchRefs.length !== e.batchRefs.length ||
        resolved.some((x, i) => x !== e.resolved[i]) ||
        batchRefs.some((x, i) => x !== e.batchRefs[i])
      ) {
        e.resolved = resolved;
        e.batchRefs = batchRefs;
        changed = true;
      }
    }
    return changed;
  };
  // 首轮 + 不动点（批内被拒条目向下传播；收敛上界 = 条目数 + 2 轮，绝无死循环）
  for (let round = 0; round <= entries.length + 2; round += 1) {
    if (!resolveOnce()) break;
  }

  /* ---- ③ 环检测：统一图 = 既有任务 + 本批（已解析条目伪任务），Kahn 迭代 ----
   * 已完成前驱不构成约束（buildDependencyGraph 内建）；任何环（含仅既有数据自环）
   * 都判整批拒绝——导入侧本就拒绝环，库内出现环说明数据已被手改，宁可拦下。 */
  const pseudoTasks: Task[] = entries
    .filter((e) => e.ok)
    .map((e) => {
      const status = e.task.status;
      return {
        id: `${BATCH_NODE_PREFIX}${e.task.externalId}`,
        projectId,
        stageId: effectiveStageId,
        title: e.task.title,
        done: status === TaskStatus.Done,
        assigneeId: null,
        assigneeIds: [],
        dueDate: e.task.dueDate,
        source: 'agent',
        externalId: e.task.externalId,
        agentId: null,
        status,
        description: e.task.description,
        dependsOn: [
          ...e.resolved,
          ...e.batchRefs.map((d) => `${BATCH_NODE_PREFIX}${d}`),
        ],
        artifacts: [],
        startAt: e.task.startAt,
        claimedAt: null,
        orderIndex: 0,
        revision: 0,
        updatedAt: '',
      } as unknown as Task;
    });
  const unifiedGraph = buildDependencyGraph([...existingTasks, ...pseudoTasks]);
  const { cyclicIds } = topoLayers(unifiedGraph);
  const batchCycleHit = entries.some((e) => e.ok && cyclicIds.has(`${BATCH_NODE_PREFIX}${e.task.externalId}`));
  if (batchCycleHit || cyclicIds.size > 0) {
    // 环命中 → 整批拒绝（created=0 / updated=0，全部条目进 rejected，库零写入）
    return {
      projectId,
      stageId: effectiveStageId,
      stage,
      plannedStage,
      rows: [],
      rowExternalIds: [],
      rowBatchDeps: [],
      rejected: payload.tasks.map((t) => ({
        externalId: t.externalId,
        code: 'cycle' as const,
        reason: '检测到依赖环（dependsOn 相互引用），整批拒绝，未写入任何数据。',
      })),
      created: 0,
      updated: 0,
    };
  }

  /* ---- ④ 组装 upsert 行（宽松状态通道 + done 恒由 status 派生） ---- */
  const rows: TaskUpsertRow[] = [];
  const rowExternalIds: string[] = [];
  const rowBatchDeps: string[][] = [];
  let created = 0;
  let updated = 0;
  // 新建行的 orderIndex 基准 = 目标批次内既有最大值（更新路径不会覆写既有排序，
  // 见 local.tasks.repo / tasks.routes upsert 的「orderIndex 仅新建语义」注释）
  const stageBaseOrder = existingTasks
    .filter((t) => t.stageId === effectiveStageId)
    .reduce((max, t) => Math.max(max, t.orderIndex), 0);
  for (const e of entries) {
    if (!e.ok) continue;
    const t = e.task;
    // 指派解析：assigneeHuman（人类成员名，精确匹配）优先于 assigneeAgentKind；
    // 无匹配时留空指派（不因指派未命中而拒任务——任务本身是有效事实）
    let assigneeId: string | null = null;
    if (t.assigneeHuman) {
      const human = (await repos.members.list(true)).find(
        (m) => m.actorKind === MemberActorKind.Human && m.name === t.assigneeHuman,
      );
      assigneeId = human?.id ?? null;
    } else if (t.assigneeAgentKind) {
      const agent = (await repos.members.list(true)).find(
        (m) => m.actorKind === MemberActorKind.Agent && m.agentKind === t.assigneeAgentKind,
      );
      assigneeId = agent?.id ?? null;
    }
    const artifacts: TaskArtifact[] = t.artifacts.map((a) => ({
      id: `art_${crypto.randomUUID()}`,
      kind: a.kind,
      title: a.title,
      path: a.path,
      url: a.url,
      note: a.note,
    }));
    // created/updated 预览计数：按 externalId 是否已有历史行判定
    if (extMap.has(t.externalId)) updated += 1;
    else created += 1;
    rows.push({
      projectId,
      stageId: effectiveStageId,
      title: t.title,
      assigneeId,
      assigneeIds: assigneeId ? [assigneeId] : [],
      dueDate: t.dueDate,
      itineraryDate: null,
      source: 'agent',
      externalId: t.externalId,
      agentId: null, // apply 阶段由 ensureAgentMember 补齐
      status: t.status, // 宽松通道：直落 Agent 给定 status
      description: t.description,
      dependsOn: [...e.resolved], // 批内依赖两段式第二段补齐
      artifacts,
      startAt: t.startAt,
      claimedAt: null,
      orderIndex: stageBaseOrder + rows.length + 1,
    });
    rowExternalIds.push(t.externalId);
    rowBatchDeps.push([...e.batchRefs]);
  }

  return {
    projectId,
    stageId: effectiveStageId,
    stage,
    plannedStage,
    rows,
    rowExternalIds,
    rowBatchDeps,
    rejected,
    created,
    updated,
  };
}

/**
 * ensureAgentMember（幂等）：按 (actorKind='agent', agentKind, name) 三元组查找，
 * 命中复用；未命中才 insert。重复导入同一 payload 不会新增 Member（免费 3 席位安全）。
 */
export async function ensureAgentMember(
  repos: IRepositoryBundle,
  producedBy: AgentPayloadV1['producedBy'],
): Promise<string> {
  const members = await repos.members.list(true);
  const hit = members.find(
    (m) =>
      m.actorKind === MemberActorKind.Agent &&
      m.agentKind === producedBy.agentKind &&
      m.name === producedBy.agentName,
  );
  if (hit) return hit.id;
  const created = await repos.members.insert({
    name: producedBy.agentName,
    role: 'Agent',
    contact: null,
    avatarColor: AGENT_MEMBER_AVATAR,
    roleKind: MemberRoleKind.Member,
    actorKind: MemberActorKind.Agent,
    agentKind: producedBy.agentKind,
  });
  return created.id;
}

/**
 * 差异预览：只算不写。
 *
 * ★ **永不创建阶段**（C3）：`resolve()` 只返回计划（`mode:'planned'` + `id:null`），
 * 本函数原样转发 `plan.stage`。若预览就建了阶段，用户取消后会留下一个空阶段。
 */
export async function previewAgentPayload(
  repos: IRepositoryBundle,
  payload: AgentPayloadV1,
  opts?: ApplyOptions,
): Promise<ApplyResult> {
  const plan = await resolve(repos, payload, opts);
  return {
    created: plan.created,
    updated: plan.updated,
    rejected: plan.rejected,
    stage: plan.stage,
  };
}

/** 真正落库（两段式 upsert，见文件头「批内依赖」说明） */
export async function applyAgentPayload(
  repos: IRepositoryBundle,
  payload: AgentPayloadV1,
  opts?: ApplyOptions,
): Promise<ApplyResult> {
  const plan = await resolve(repos, payload, opts);

  if (plan.rows.length === 0) {
    // ★ 零写入分支**原样转发** `plan.stage`，绝不在这里改写 `mode`。
    //   写成 `{...plan.stage, mode:'planned'}` 会把样例 C 的 `'none'` 篡改成
    //   「将要新建阶段」—— 一次零写入的操作被描述成会改阶段、还会让完成度倒退的
    //   操作，等于把回执变成错误信息（C15）。此处的形状由 §10.2 裁定 A 定死。
    return { created: 0, updated: 0, rejected: plan.rejected, stage: plan.stage };
  }

  /* ---- ★ 创建时机（§4.6）：resolve() 完成之后、第一段 upsert 之前，且仅当 `rows.length > 0` ----
   * 若在 `resolve()` 内（或零写入时）建阶段：依赖成环 / 全部 dep_unresolved → `rows` 为空 →
   * 用户会看到一个**空的、永远不用的**阶段被凭空创建，而整批任务一条没进 ——
   * 这既违反「库内零写入」铁律，也正是「静默造脏数据」。
   * 只为「本次批量新建的第一条」建**一个**阶段（而不是每行建一个）。 */
  let stage: ApplyStageResolution = plan.stage;
  let rows = plan.rows;
  if (plan.plannedStage) {
    const planned = plan.plannedStage;
    // 复用既有底层能力（远端 = POST /api/stages/bulk），不新增任何建阶段能力（§4.3）
    await repos.stages.bulkInsert([planned]);
    // planned → created：id 换成刚落库的真实 id（R4：created 的 id 非空）
    stage = { ...stage, mode: 'created', id: planned.id };
    // ★ C1：**必须**重写行的 stageId。`resolve()` 已用「预生成 id」填过（更好：没有
    //   空 stageId 的窗口），这里再重写一次是**幂等**的，作用是让「建阶段 → 行落点」
    //   之间不存在第二种可能。漏这一步的后果：所有行插到 `stage_id=''` →
    //   DB 层外键/查询全崩，且看板看不到、时间轴崩。
    rows = rows.map((r) => ({ ...r, stageId: planned.id }));
  }

  // Agent 身份 Member（幂等）→ 补 agentId / source
  const agentMemberId = await ensureAgentMember(repos, payload.producedBy);
  const rowsWithAgent = rows.map((r) => ({ ...r, agentId: agentMemberId }));

  // 第一段：全部行落库（批内依赖暂剥除——此时目标行的真实 id 尚未产生）
  const first = await repos.tasks.upsertByExternalId(rowsWithAgent);

  // 回读建全量 externalId → id 映射（含本段新建行）
  const allTasks = await repos.tasks.listByProject(plan.projectId);
  const extToId = new Map<string, string>();
  for (const t of allTasks) {
    if (t.externalId) extToId.set(t.externalId, t.id);
  }

  // 第二段：仅对含批内依赖的行重写完整 dependsOn（幂等命中 → 计入 updated）
  const fixRows: TaskUpsertRow[] = [];
  rows.forEach((row, i) => {
    const batchDeps = plan.rowBatchDeps[i] ?? [];
    if (batchDeps.length === 0) return;
    const resolvedBatchDeps = batchDeps
      .map((d) => extToId.get(d))
      .filter((x): x is string => !!x);
    const historicalDeps = row.dependsOn;
    fixRows.push({
      ...row,
      agentId: agentMemberId,
      dependsOn: [...historicalDeps, ...resolvedBatchDeps],
    });
  });
  let second = { created: 0, updated: 0 };
  if (fixRows.length > 0) {
    second = await repos.tasks.upsertByExternalId(fixRows);
  }

  return {
    created: first.created,
    updated: first.updated + second.updated,
    rejected: plan.rejected,
    stage,
  };
}
