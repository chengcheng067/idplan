/**
 * 项目领域服务：建档编排（模板实例化→切分→清单生成→多表事务写）。
 * 业务规则的唯一住所——组件/store 只做参数搬运，不含规则。
 */

import { createId } from '../../lib/id';
import { toIsoDate } from '../../lib/date';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT, previewSplit } from '../template/split';
import { getStageLibraryVersion } from '../template/stage-library';
import {
  CUSTOM_STAGE_PRESET_KEY,
  INTERIOR_FULL_PRESET_KEY,
} from '../template/stage-fallback';
import type { StageDraft } from '../types/dto';
import type {
  ConfirmedContractPayload,
  CreateProjectCmd,
} from '../types/dto';
import { ChangxiaError, ChangxiaErrorCode, ProjectType, StageLogType, StageStatus, TaskStatus } from '../types/enums';
import {
  DEFAULT_REST_POLICY,
  DEFAULT_SCHEDULE_BASIS,
  type Project,
  type RestPolicyConfig,
  type Stage,
  type Task,
} from '../types/entities';
import type { IProjectsRepository } from '../repositories/interfaces';
import type { LocalProjectsRepository } from '../repositories/local/local.projects.repo';

/** 事务执行器：local=Dexie transaction；remote=服务端受理（接口同签名） */
export interface TxRunner {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** ProjectService 构造依赖（全部来自 IRepositoryBundle + 可选事务执行器） */
export interface ProjectServiceDeps {
  projects: IProjectsRepository;
  /** stages/tasks/logs/contracts 需要事务语义：接口同签名由 bundle 提供 */
  bundle: import('../repositories/interfaces').IRepositoryBundle;
  /** local 适配器可注入 Dexie db 构造的事务 runner；remote 可不传（服务端兜底） */
  tx?: TxRunner;
}

export class ProjectService {
  public constructor(private readonly deps: ProjectServiceDeps) {}

  /**
   * 合同建档主流程：
   *   contracts.insert(存证) → projects.insert → stages.bulkInsert(N)
   *   → tasks.bulkInsert(职责清单) → contracts.linkProject
   * 有 tx 则整体包裹；无 tx 时逐条顺序写（remote 模式由服务端受理保证）。
   */
  public async createProjectFromContract(
    confirmed: ConfirmedContractPayload,
    drafts: StageDraft[],
    contractRecordId?: string,
  ): Promise<Project> {
    this.assertDraftsValid(drafts);

    const projectCmd: CreateProjectCmd = {
      name: confirmed.projectName,
      type: confirmed.projectType,
      address: confirmed.address,
      clientName: confirmed.clientName,
      contractAmount: confirmed.contractAmount,
      signedAt: confirmed.signedAt,
      plannedStartAt: toIsoDate(confirmed.startAt) ?? confirmed.startAt,
      plannedEndAt: toIsoDate(confirmed.endAt) ?? confirmed.endAt,
      coverColor: null,
      // 阶段溯源自段（键序铁律：插在 coverColor 之后、status 之前的三处同步之一）
      stagePresetKey: confirmed.stagePresetKey ?? null,
      stageTemplateVersion: confirmed.stageTemplateVersion ?? getStageLibraryVersion(),
      scheduleBasis: confirmed.scheduleBasis ?? DEFAULT_SCHEDULE_BASIS,
      // v0.8 主板块：向导第 2 层的选择结果，直接透传（不传 → null → 读时回落）。
      // 这是 Project.domain 的**唯一人类写入点**（T04 的 confirmProjectDomain 是另一处）。
      domain: confirmed.domain ?? null,
      // v0.8 归属侧：向导恒为人类建档 ⇒ 不传 kind，由 repo 落 DEFAULT_PROJECT_KIND。
      // Agent 通道建板走的是另一条路径（T04），不经过本方法。
    };

    const exec = async (): Promise<Project> => {
      // 1. 存证解析结果（新建或回链已有记录）
      let contractId = contractRecordId;
      if (!contractId) {
        const record = await this.deps.bundle.contracts.insert({
          projectId: null,
          fileName: confirmed.sourceFileName,
          rawTextDigest: confirmed.rawTextDigest,
          parsedResultJson: confirmed.parsedResultJsonSnapshot,
          confirmedPayloadJson: JSON.stringify(confirmed),
          createdByManual: confirmed.createdByManual,
        });
        contractId = record.id;
      }

      // 2. 项目主体
      const project = await (this.deps.projects as LocalProjectsRepository).insert(projectCmd);

      // 3. 所选阶段实例化（N 段，orderIndex 1..N 连续）
      const stageRows: Stage[] = drafts.map((d) => ({
        id: createId('stg'),
        projectId: project.id,
        orderIndex: d.orderIndex,
        // 键序铁律：templateKey/colorIndex/customColor 插在 orderIndex 之后、name 之前
        // （与 entities.Stage / backup.service stageSchema 三处同步，漏一处 roundtrip 就挂）
        templateKey: d.templateKey,
        colorIndex: d.colorIndex,
        // v0.8 用户自定义主色：草稿里已归一为 `string | null`，直接透传。
        // StageDraft.customColor 是**必填**字段 ⇒ 这里不可能读到 undefined（漏给色会编译失败）。
        customColor: d.customColor,
        name: d.name,
        ratioPercent: d.ratioPercent,
        startAt: d.startAt,
        endAt: d.endAt,
        status: StageStatus.NotStarted,
        ownerId: d.ownerId,
        visible: d.visible,
        resourcePath: d.resourcePath,
        revision: 1,
        updatedAt: new Date().toISOString(),
      }));
      await this.deps.bundle.stages.bulkInsert(stageRows);

      // 首段状态流水
      for (const s of stageRows) {
        await this.deps.bundle.logs.appendStageLog({
          stageId: s.id,
          projectId: project.id,
          type: StageLogType.Created,
          fromStatus: null,
          toStatus: StageStatus.NotStarted,
          oldStartAt: null,
          newStartAt: s.startAt,
          oldEndAt: null,
          newEndAt: s.endAt,
          reason: null,
          operatorName: 'system',
        });
      }

      // 4. 默认职责清单生成
      const taskRows: Task[] = [];
      for (const draft of drafts) {
        const stageRow = stageRows.find((s) => s.orderIndex === draft.orderIndex);
        if (!stageRow) continue;
        draft.defaultTasks.forEach((title, idx) => {
          taskRows.push({
            id: createId('tsk'),
            // ★ v0.7 键序铁律第 5 处：taskNo 紧接 id 之后。
            // 这里**显式占位 null**（而不是省略键）：① 让「五处同序」在人工 review 时
            // 可逐行对齐；② 避免 bulkInsert 的「已带号则保留」分支把它当成已编号行。
            // 真正的号由 bulkInsert 在事务内分配（null ≠ 已编号）；
            // null 也不属于 TaskUpsertRow 通道（该类型已 Omit taskNo）。
            taskNo: null,
            projectId: project.id,
            stageId: stageRow.id,
            title,
            done: false,
            assigneeId: null,
            // 键序铁律：assigneeIds 插在 assigneeId 之后、dueDate 之前（与 taskSchema/repo insert 三处同步）
            // 漏补此字段 → 首次导出键序 ≠ 导入归一后键序 → backup.roundtrip 直接失败
            assigneeIds: [],
            dueDate: stageRow.endAt.slice(0, 10),
            // v0.6 Agent 字段（键序铁律第 4 处）：按 §3.1 序 9–17 插在 dueDate 后、
            // orderIndex 前，与 entities.Task / backup.taskSchema / repo insert 四处同序。
            // 建档任务恒为人工来源；externalId 不写键（undefined）——人工任务无幂等键。
            source: 'human',
            externalId: undefined,
            agentId: null,
            status: TaskStatus.Draft,
            description: null,
            dependsOn: [],
            artifacts: [],
            startAt: null,
            claimedAt: null,
            orderIndex: idx + 1,
            revision: 1,
            updatedAt: new Date().toISOString(),
            // externalId 刻意不写键（undefined）：人工任务无幂等键，且 null 不是合法 IDB key。
            // undefined 不在 Task.externalId 的声明类型内，需经 unknown 断言。
          } as unknown as Task);
        });
      }
      if (taskRows.length > 0) {
        await this.deps.bundle.tasks.bulkInsert(taskRows);
      }

      // 5. 回链合同存证
      if (contractId) {
        await this.deps.bundle.contracts.linkProject(contractId, project.id);
      }

      return project;
    };

    return this.deps.tx ? this.deps.tx.run(exec) : exec();
  }

  /**
   * 手动建档（先建空项目后补录合同的微调诉求）：同样走切分。
   * 不传 stageItems → 回落全量九段模板（行为与改造前完全一致）。
   */
  public async createManualProject(cmd: CreateProjectCmd): Promise<Project> {
    // 公司休息制度从 settings 读（公司级，非项目级）；损坏/缺失回落双休
    const restPolicy =
      (await this.deps.bundle.settings.get<RestPolicyConfig>('restPolicy')) ?? DEFAULT_REST_POLICY;
    const drafts = previewSplit({
      startAt: cmd.plannedStartAt,
      endAt: cmd.plannedEndAt,
      stageItems: cmd.stageItems,
      scheduleBasis: cmd.scheduleBasis ?? DEFAULT_SCHEDULE_BASIS,
      restPolicy,
    });
    const payload: ConfirmedContractPayload = {
      projectName: cmd.name,
      projectType: cmd.type ?? ProjectType.Dining,
      address: cmd.address,
      clientName: cmd.clientName,
      contractAmount: cmd.contractAmount,
      signedAt: cmd.signedAt,
      startAt: cmd.plannedStartAt,
      endAt: cmd.plannedEndAt,
      stageOverrides: {},
      // 未指定阶段集合 → 默认室内·全流程九段；指定了 → 视为自定义组合
      stagePresetKey:
        cmd.stagePresetKey ??
        (cmd.stageItems?.length ? CUSTOM_STAGE_PRESET_KEY : INTERIOR_FULL_PRESET_KEY),
      stageTemplateVersion: cmd.stageTemplateVersion,
      scheduleBasis: cmd.scheduleBasis,
      // v0.8 主板块：手动兜底表单与向导共用同一字段（两条建档路径都写 domain）
      domain: cmd.domain ?? null,
      createdByManual: true,
      sourceFileName: null,
      rawTextDigest: digestOf(''),
      parsedResultJsonSnapshot: JSON.stringify({ manual: true }),
    };
    return this.createProjectFromContract(payload, drafts);
  }

  /**
   * 阶段数由「固定 9」放宽为「所选 N ∈ [1, 20]」（v0.8：上限 12 → 20）；
   * orderIndex 必须仍是 1..N 连续无空缺——stage.service 的 orderIndex+1 取下一段、
   * TimelineView 的 orderIndex> 取后继段都依赖这个连续性。
   */
  private assertDraftsValid(drafts: StageDraft[]): void {
    if (drafts.length < MIN_STAGE_COUNT) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `请至少选择 ${MIN_STAGE_COUNT} 个阶段。`,
      );
    }
    if (drafts.length > MAX_STAGE_COUNT) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `单次项目最多 ${MAX_STAGE_COUNT} 个阶段，当前 ${drafts.length} 个。`,
      );
    }
    for (let i = 0; i < drafts.length; i += 1) {
      if (drafts[i].orderIndex !== i + 1) {
        throw new ChangxiaError(
          ChangxiaErrorCode.Validation,
          `阶段序号必须为 1..${drafts.length} 连续无空缺。`,
        );
      }
    }
  }
}

/** 原文摘要：sha256 前 16 位（webcrypto 异步则退化为简单 hash —— 存证用弱一致性即可） */
export function digestOf(text: string): string {
  if (text.length === 0) return '';
  // 简单 FNV-1a 32bit ×4 轮做轻量指纹；正文 diff 场景足够
  let h1 = 0x811c9dc5;
  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < text.length; i += 1) {
      h1 ^= text.charCodeAt(i) + round;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
  }
  return h1.toString(16).padStart(8, '0') + text.length.toString(16).padStart(8, '0');
}
