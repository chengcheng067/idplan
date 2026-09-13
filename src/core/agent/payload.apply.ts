/**
 * Agent payload 落库编排（v0.6 · 设计文档 T09 / §4.1）。
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
 *     （用户 2026-09-09 拍板 / §10-R3；MAX_STAGE_COUNT 只在建档时校验、DB 层无约束，
 *     自动建会让反复导入静默造出 20+ 批次拉垮 Timeline）
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

/** Agent 成员落库时的默认头像色（与既有 member 行同款 hex 格式；UI 语义色仍走 token） */
const AGENT_MEMBER_AVATAR = '#6B5B8C';

/** 批内伪任务节点前缀：把 externalId 提升为图节点 id 时防与真实 Task.id 撞名 */
const BATCH_NODE_PREFIX = 'ext::';

/** 应用选项：payload.projectId 为 null 时由调用方（UI）显式指定目标项目 */
export interface ApplyOptions {
  projectId?: string;
}

/** resolve 的中间产物（preview 与 apply 共用） */
interface ResolvedPlan {
  projectId: string;
  stageId: string | null;
  /**
   * v0.7 **恒定字段**：本批的落点阶段。
   * 命中已有批次 → `mode:'existing'`；无落点（项目无可见批次 / 指定批次不存在）
   * → `mode:'none'` + `id:null` + `name:''` + `orderIndex:-1`。
   * ★ 本批不产出 `planned` / `created`（依赖按名新建，属 T02）。
   */
  stage: ApplyStageResolution;
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

  /* ---- 批次策略（§10-R3）：指定 → 校验存在；缺省 → 最后一个可见批次；无 → 拒绝 ---- */
  const stages = (await repos.stages.listByProject(projectId))
    .filter((s) => s.visible)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  let stageId: string | null = null;
  /** 命中的批次**对象**（不只留 id —— `stage` 需要 name / orderIndex 回填） */
  let stageHit: Stage | null = null;
  if (payload.stageId) {
    const hit = stages.find((s) => s.id === payload.stageId);
    if (!hit) {
      rejected.push({
        externalId: '(batch)',
        code: 'stage_limit',
        reason: '指定的批次不存在，请检查 stageId。',
      });
    } else {
      stageId = hit.id;
      stageHit = hit;
    }
  } else if (stages.length > 0) {
    stageHit = stages[stages.length - 1]!; // orderIndex 最大的可见批次
    stageId = stageHit.id;
  } else {
    // 不自动新建 Stage：MAX_STAGE_COUNT 只在建档时校验、DB 层无约束，
    // 自动建会让反复导入静默造出 20+ 批次拉垮 Timeline（§10-R3）
    rejected.push({
      externalId: '(batch)',
      code: 'stage_limit',
      reason: '该项目暂无批次，请先建立批次后再导入。',
    });
  }
  /**
   * 落点解析结果（R1 四键恒定 / R4 四态表）：
   *   命中已有批次 → `existing`（id 非空）；
   *   无落点      → `none`（`id:null` + `name:''` + `orderIndex:-1` 哨兵）。
   */
  const stage: ApplyStageResolution = stageHit
    ? {
        mode: 'existing',
        id: stageHit.id,
        name: stageHit.name,
        orderIndex: stageHit.orderIndex,
      }
    : { mode: 'none', id: null, name: '', orderIndex: -1 };
  if (!stageId) {
    // 批次不可用 → 全部条目按批次级拒绝返回（保持 ApplyResult 形状恒定）
    return {
      projectId,
      stageId: null,
      stage,
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
        stageId,
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
      stageId,
      stage,
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
    .filter((t) => t.stageId === stageId)
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
      stageId,
      title: t.title,
      assigneeId,
      assigneeIds: assigneeId ? [assigneeId] : [],
      dueDate: t.dueDate,
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

  return { projectId, stageId, stage, rows, rowExternalIds, rowBatchDeps, rejected, created, updated };
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

/** 差异预览：只算不写（preview 不建 Agent 成员、不触任何仓储写路径） */
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
    return { created: 0, updated: 0, rejected: plan.rejected, stage: plan.stage };
  }

  // Agent 身份 Member（幂等）→ 补 agentId / source
  const agentMemberId = await ensureAgentMember(repos, payload.producedBy);
  const rows = plan.rows.map((r) => ({ ...r, agentId: agentMemberId }));

  // 第一段：全部行落库（批内依赖暂剥除——此时目标行的真实 id 尚未产生）
  const first = await repos.tasks.upsertByExternalId(rows);

  // 回读建全量 externalId → id 映射（含本段新建行）
  const allTasks = await repos.tasks.listByProject(plan.projectId);
  const extToId = new Map<string, string>();
  for (const t of allTasks) {
    if (t.externalId) extToId.set(t.externalId, t.id);
  }

  // 第二段：仅对含批内依赖的行重写完整 dependsOn（幂等命中 → 计入 updated）
  const fixRows: TaskUpsertRow[] = [];
  plan.rows.forEach((row, i) => {
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
    stage: plan.stage,
  };
}
