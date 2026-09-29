/**
 * 项目领域服务：建档编排（模板实例化→切分→清单生成→多表事务写）。
 * 业务规则的唯一住所——组件/store 只做参数搬运，不含规则。
 */

import { createId } from '../../lib/id';
import { toIsoDate } from '../../lib/date';
import {
  MAX_STAGE_COUNT,
  MIN_STAGE_COUNT,
  previewSplit,
  stageColorIndex,
} from '../template/split';
import {
  findStageLibraryItem,
  getPreset,
  getPresetItems,
  getStageLibraryItems,
  getStageLibraryVersion,
  getUsableDomains,
} from '../template/stage-library';
import {
  CUSTOM_STAGE_PRESET_KEY,
  DEFAULT_PROJECT_DOMAIN,
  INTERIOR_FULL_PRESET_KEY,
} from '../template/stage-fallback';
import type { StageDraft, StageSelectionItem, StageTemplateItem, StageTemplateDomain } from '../types/dto';
import type {
  ConfirmedContractPayload,
  CreateProjectCmd,
} from '../types/dto';
import { ChangxiaError, ChangxiaErrorCode, StageLogType, StageStatus, TaskStatus } from '../types/enums';
import { normalizeStageName } from '../lib/task-no';
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
        // v0.8：自定义阶段的草稿 key 不是模板库 key ⇒ 落 null（禁止伪造 key，N4）
        templateKey: normalizeDraftTemplateKey(d.templateKey),
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
            itineraryDate: null,
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
          runId: null, // v0.8.2：建档默认任务的溯源批次为空（人类路径）
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

      // 5. 旅游项目按计划日期补齐每日行程。仅补缺失行，后续项目改期也绝不自动删除旧行。
      if (project.domain === 'travel') {
        await this.deps.bundle.itineraries.ensureProjectDays(
          project.id,
          project.plannedStartAt.slice(0, 10),
          project.plannedEndAt.slice(0, 10),
        );
      }

      // 6. 回链合同存证
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
   *
   * v0.8 追加：**同项目内阶段名不可重复**（A9）。理由不是洁癖——Agent 通道按名定位阶段
   * （`?stageName=`），重名会让落点歧义。UI 侧已有行内提示 + 禁用提交，
   * 这里是**落库前的第二道闸门**（绕过 UI 的调用方同样受约束）。
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
    const duplicated = findDuplicateStageNames(drafts.map((d) => d.name));
    if (duplicated.length > 0) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `阶段名不能重复：${duplicated.join('、')}。`,
      );
    }
  }

  /* ══════════════════════ v0.8 · Agent 看板建板（设计 §6.1 / §7.6；T04-B） ══════════════════════
   *
   * ── 这个方法只做一件事：在 **Agent 工作区**里建一块看板（项目主体 ＋ 阶段骨架）──
   *
   * 它与 `createProjectFromContract` / `createManualProject` 是**并列**的第 3 条建档路径，
   * 但归属侧不同：本方法恒落 `kind = 'agent'`（人类两条路径不传 kind，由 repo 落默认 human）。
   * 于是"人类项目里一字不改"这条铁律在**类型层**就成立——本方法根本没有参数能改人类项目。
   *
   * ── 三处**绝不猜测**（PRD B9 / TS-08）──
   *   ① `name` / `plannedStartAt` / `plannedEndAt` 三者**全必填**，缺任一即抛 Validation。
   *      **不提供默认日期**——"猜一个起止日期"会让 Agent 拿到的排期与真实意图不符，
   *      而错误的日期会一路传染到阶段切分、甘特、打印稿，且**不报错**。
   *   ② `presetKey` 与 `stageNames` **至少一个非空**——空集合会让阶段数 = 0，
   *      而 0 段的项目在完成度/当前阶段/时间轴上全部无定义（split.ts 的 MIN_STAGE_COUNT 同因）。
   *   ③ 阶段骨架**只用 `stage-library.ts` 这一份库**：套餐项经 `getPresetItems`，
   *      声明名按**库里的 name** 反查。库里没有的名字 ⇒ 建为自定义阶段（`templateKey=null`）。
   *      ★ 这里**绝不**再抄一份骨架/字段口径 —— 本仓已有过教训：
   *        "抄一份映射就是第二份字段口径，漏一个 `?? null` 即静默 undefined 泄漏"。
   *
   * ── 边界铁律（PRD B10）──
   *   本方法**只在建板这一次**建阶段；后续 payload 导入的落点不在声明集合内时**不建**、
   *   按既有规则回落（那条路径在 `payload.apply.ts`，与本方法无关）。
   *   本方法也**不放宽任何既有通道**——人类项目走的仍是原来的校验链。
   *
   * ── 为什么不建"默认职责清单"（与合同建档的差别）──
   *   设计 §6.1 的时序图里，建板只有 `insert` ＋ `stages.bulkInsert` 两步，**没有任务生成**。
   *   Agent 看板的任务来自 WorkBuddy 的 payload 导入（另一条通道）。
   *   多建一批"库里的默认任务"会让 Agent 侧出现**用户没要求过**的任务，
   *   且它们没有 externalId ⇒ 无法被后续导入幂等更新/回收。故不建（有意）。
   *
   * @returns 新看板的 project id
   */
  public async createAgentBoard(cmd: CreateAgentBoardCmd): Promise<string> {
    const name = typeof cmd.name === 'string' ? cmd.name.trim() : '';
    if (!name) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '请填写看板名称。');
    }
    // 必填且**不给默认值**：缺日期就说缺日期（TS-08 保持"必须显式给"）
    const plannedStartAt = typeof cmd.plannedStartAt === 'string' ? cmd.plannedStartAt.trim() : '';
    const plannedEndAt = typeof cmd.plannedEndAt === 'string' ? cmd.plannedEndAt.trim() : '';
    if (!plannedStartAt || !plannedEndAt) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        '请提供看板的开始日期与结束日期（不会自动填充默认日期）。',
      );
    }
    const presetKey = typeof cmd.presetKey === 'string' && cmd.presetKey.trim() !== ''
      ? cmd.presetKey.trim()
      : null;
    // 同一次请求内**按名去重**（保序、trim、丢空串）：重名会让 orderIndex 语义歧义
    const declaredNames = dedupeAgentStageNames(cmd.stageNames ?? []);
    if (!presetKey && declaredNames.length === 0) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        '请至少指定一个阶段套餐，或显式声明阶段名。',
      );
    }

    const stageItems = resolveAgentStageItems(presetKey, declaredNames);
    // 切分复用**唯一一份**实现（previewSplit）：不自己写日期分配，
    // 否则"子集内占比归一化 + 残差吸收 + 工作日口径"会立刻出现第二份口径。
    // ★ 2026-09-28 雯丞拍板（走查 #4）：**阶段起止统一为项目基线**，不按占比
    //   切分。previewSplit 只用来分配 orderIndex/colorIndex/name/ratioPercent；
    //   日期一律取项目 plannedStartAt/plannedEndAt——「凭空切分属于猜测」，
    //   与服务端口径逐字一致（同一请求两通道同一份排期）。
    const drafts = previewSplit({
      startAt: plannedStartAt,
      endAt: plannedEndAt,
      stageItems,
      scheduleBasis: DEFAULT_SCHEDULE_BASIS,
    }).map((d) => ({ ...d, startAt: plannedStartAt, endAt: plannedEndAt }));
    // 复用同类的落库前闸门：上限 20 ＋ orderIndex 连续 ＋ 阶段名不重复（A9/A10）
    this.assertDraftsValid(drafts);

    const projectCmd: CreateProjectCmd = {
      name,
      // 归属侧恒为 agent（本方法**没有**参数能改它——这正是"人类项目一字不改"的保证）
      kind: 'agent',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt,
      plannedEndAt,
      coverColor: null,
      stagePresetKey: declaredNames.length > 0 ? CUSTOM_STAGE_PRESET_KEY : presetKey,
      stageTemplateVersion: getStageLibraryVersion(),
      scheduleBasis: DEFAULT_SCHEDULE_BASIS,
      // 主板块：**有套餐才推导**（套餐自带 domain）；纯 stageNames 建板 ⇒ null（不猜板块，
      // 读时回落链照旧兜住）。与"绝不猜测"一致：声明里没有的信息，导出成 null 而不是编一个。
      domain: presetKey ? (getPreset(presetKey)?.domain ?? null) : null,
    };

    const exec = async (): Promise<string> => {
      const project = await this.deps.projects.insert(projectCmd);

      // 键序铁律：与 createProjectFromContract 的 stageRows 字面量**逐字段同序**
      // （entities.Stage / backup stageSchema / 本文件另一处 / stage-fallback 四处同步）。
      const stageRows: Stage[] = drafts.map((d) => ({
        id: createId('stg'),
        projectId: project.id,
        orderIndex: d.orderIndex,
        templateKey: normalizeDraftTemplateKey(d.templateKey),
        colorIndex: d.colorIndex,
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

      // 阶段流水（与合同建档同款）：让每条阶段都有"创建"这一点历史，
      // 否则 Agent 看板的阶段在流水视图里凭空出现、无从追溯。
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

      return project.id;
    };

    return this.deps.tx ? this.deps.tx.run(exec) : exec();
  }

  /* ═════════════════ v0.8 · TBD-10：存量 custom 项目的「板块」确认（设计 §3.2.1） ═════════════════
   *
   * ── 这个方法解决什么 ──
   * `stagePresetKey === 'custom'` 的**存量**项目（v0.8 之前建的），`getPreset('custom')` 返回
   * `null` ⇒ 回落链最终落到 `'indoor'` ⇒ 用户看到它们被塞进首页「室内」列。用户看到的是
   * **错的板块**，但我们**不能猜**（无依据）。裁决是「只提示、不自动写」，提示由
   * `visibility.ts::needsDomainConfirm(p)` 判定，用户点「确认」后**只走这一条写路径**。
   *
   * ── 为什么必须是"只写 domain 一个字段"（本方法存在的全部理由）──
   * `repo.update` 走的是 `pickDefined(cmd)` **浅合并**（`local.projects.repo.ts`）：
   * 只要入参字面量里只有 `{ domain }`，落库 diff 就只有 `domain` 一行（＋仓储自动 bump 的
   * `revision` / `updatedAt`）。**任何"顺手多带一个字段"都会静默改写用户数据** ——
   * 而验收 9 正是拿 backup diff 当断言（"只有 `domain` 一个字段变化"）。
   * 所以这里刻意不接收 `cmd` 对象、不拼第二个键：入参就是裸的 `domain`。
   *
   * ── 为什么校验要用 `getUsableDomains()` 而不是 `Object.values(StageTemplateDomain)` ──
   * `exhibition`（展陈）在模板库里**没有阶段项**，`getUsableDomains()` 已经把它排除
   * （设计 §2.3 的"空域"）。若放它进来，用户"确认"成展陈 ⇒ 该项目的阶段池为空、
   * 看板列退化成兜底列 —— 一个**看起来成功、实际把项目改坏**的写入。
   * 白名单只有一处（本行的调用），将来 JSON 新增板块时自动跟随，不会漂移。
   *
   * ── 这个方法**不**做的事（刻意，别补）──
   *   · 不碰阶段：`domain` 是**分类**，与"这个项目有哪些阶段"无关。重排/补阶段是另一条路径。
   *   · 不刷新 store：store 是 React 层的关切，由页面 action（`createProjectActions`）负责，
   *     此处只做"领域规则 ＋ 落库"，与 `createProjectFromContract` 同一分层纪律。
   */
  public async confirmProjectDomain(
    id: string,
    domain: StageTemplateDomain,
  ): Promise<Project> {
    const usable = getUsableDomains();
    if (!usable.includes(domain)) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `「${String(domain)}」不是可用的主板块。`,
      );
    }
    // ★ 唯一写点：入参字面量**只有** domain（见方法头注释，验收 9 拿它当断言）
    return this.deps.projects.update(id, { domain });
  }
}

/**
 * 草稿 key → 落库 key。
 *
 * 自定义阶段在选中列表里的 key 是 `cst.<id>`（`custom-stage.service` 生成），**不是**
 * 模板库 key。而 `Stage.templateKey` 的语义是「模板溯源」，只允许两种取值：
 * 模板库真 key 或 `null`（N4 明文：禁止伪造 key —— `getStageLibraryItem(未知key)` **抛错**，
 * 伪造 key 会让看板落列、打印分组在读取时炸）。
 *
 * 因此这里做一次**收口**：非模板库 key 一律落 `null`，下游按 `orderIndex` 均分落列
 * （`stage-resolve` 已核该路径不崩）。
 */
export function normalizeDraftTemplateKey(templateKey: string | null): string | null {
  if (!templateKey) return null;
  return findStageLibraryItem(templateKey) ? templateKey : null;
}

/** 同项目内重复的阶段名（trim 后同名；保序去重）。与 StageSelectPanel 的口径一致。 */
export function findDuplicateStageNames(names: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const raw of names) {
    const name = raw.trim();
    if (name === '') continue;
    count.set(name, (count.get(name) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [name, n] of count) {
    if (n > 1) out.push(name);
  }
  return out;
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

/* ══════════════════════════════ Agent 建板：命令与阶段解析（T04-B） ══════════════════════════════
 *
 * 下面这些都是 `ProjectService.createAgentBoard` 的**输入契约**与**纯函数**。
 * 拆成纯函数是为了让"套餐 → 阶段项 → 自定义阶段"这条映射可以**不经仓储**直接单测
 * （建板这条链上的错误全部是静默的：少一段、多一段、key 伪造，都不会抛错）。
 */

/**
 * Agent 看板建板命令（设计 §6.1 的 `cmd`；PRD B7–B10 / TS-08）。
 *
 * 三个必填字段是**接口层**就写死的"不猜"：调用方没有"省略日期"的写法，
 * 缺字段只能传 `undefined`/空串 → 由 `createAgentBoard` 明确拒绝。
 */
export interface CreateAgentBoardCmd {
  /** 看板名称（必填，trim 后不可为空） */
  name: string;
  /** 计划开始日（必填，`YYYY-MM-DD`；**不提供默认值**） */
  plannedStartAt: string;
  /** 计划结束日（必填，同上） */
  plannedEndAt: string;
  /**
   * 阶段套餐 key（如 `indoor_full`）。与 `stageNames` **至少一个非空**。
   * 给出时：套餐的阶段项就是骨架的全部内容（例：`indoor_full` ⇒ 9 段）。
   */
  presetKey?: string;
  /**
   * 显式声明的阶段名（例：`['提案','消防报审']` ⇒ 2 段）。
   * 名字在库里 ⇒ 用库项的占比/色号/默认任务；不在库 ⇒ 建为自定义阶段（`templateKey = null`）。
   */
  stageNames?: string[];
}

/**
 * 声明阶段名的归一：trim → 丢空串 → **按名去重（保序）**。
 *
 * 为什么去重放在这里而不是让调用方保证：重名阶段会让"按名选点"（Stage.name 的落点语义）
 * 变成歧义，而**后一段会被静默忽略或重复落库**——两种结果都不报错。
 */
export function dedupeAgentStageNames(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen: string[] = [];
  for (const raw of names) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name === '') continue;
    // 判重键归一、入库保留 trim 原值（2026-09-28 走查 #6）
    const key = normalizeStageName(name);
    if (seen.includes(key)) continue;
    seen.push(key);
    out.push(name);
  }
  return out;
}

/**
 * 按**库里的 name** 反查阶段项。
 *
 * 阶段库没有"按名索引"（访问器只有 key 版），故这里经**唯一出口** `getStageLibraryItems()`
 * 线性查找，而不是另接一份 JSON——**不新建第二份阶段口径**。
 * 同名（不同行业可以有同名阶段）时取 JSON 声明顺序里的第一个：顺序口径与 `getStageLibraryItems` 一致。
 */
function findLibraryStageItemByName(name: string): StageTemplateItem | null {
  // 归一键比对（2026-09-28 走查 #6；与服务端口径一致）：调用方声明「提案。」
  // 应命中库里的「提案」，而不是另建一段自定义阶段。
  const key = normalizeStageName(name);
  return getStageLibraryItems().find((item) => normalizeStageName(item.name) === key) ?? null;
}

/**
 * 自定义阶段的**临时 key 前缀**（`cst.agent.<序号>`）。
 *
 * 刻意与 `custom-stage.service` 的 `cst.<id>` 同族但**不同命名空间**：它是"这次请求里
 * 不是库项的那一段"的占位，会经 `normalizeDraftTemplateKey` 落库为 `null`
 * ⇒ **不可能**伪造出一个库 key（N4：`getStageLibraryItem(未知key)` 会抛错）。
 */
const AGENT_CUSTOM_STAGE_KEY_PREFIX = 'cst.agent.';

/**
 * 造一个"库里没有"的阶段项。
 *
 * 字段只填**切分真正会读**的那几个（name/ratioPercent/colorIndex + 空的 defaultTasks）：
 *   · `domain` —— 只为满足类型；`Stage` 实体不存 domain（板块归属在项目上）⇒ 不参与落库；
 *   · `kanbanColumn` —— 只服务人类首页的看板分列，且读时经 `templateKey` 反查
 *     （自定义阶段 templateKey=null ⇒ 落到"按 orderIndex 均分"那条既有路径）。
 *     给空串 = 明确"无列归属"，**不编造列名**；
 *   · `defaultResponsibility` / `defaultTasks` —— `Stage` 实体没有这两个字段；
 *     建板也不生成任务（见 `createAgentBoard` 注释）⇒ 恒空。
 */
function makeCustomAgentStageItem(
  name: string,
  orderIndex: number,
  domain: StageTemplateDomain,
  ratioPercent: number,
): StageSelectionItem {
  return {
    key: `${AGENT_CUSTOM_STAGE_KEY_PREFIX}${orderIndex}`,
    name,
    domain,
    ratioPercent,
    // 色号复用 split.ts 的唯一口径（clamp(orderIndex, 1, 9)），不另写一套取色规则
    colorIndex: stageColorIndex(orderIndex),
    kanbanColumn: '',
    defaultResponsibility: '',
    defaultTasks: [],
  };
}

/**
 * 套餐 ＋ 显式声明名 → 阶段项列表（**建板骨架的唯一解析处**）。
 *
 * 顺序即落库的 `orderIndex` 1..N：先套餐项（保持套餐声明顺序），再声明名中**未被套餐覆盖**的。
 * 覆盖判定按 `name`：套餐里已有同名阶段时不重复添加（PRD B8 的"同一次请求内阶段名去重"）。
 *
 * 自定义阶段的占比取**等分**（`100 / 本请求阶段总数`）：库项自带占比不受影响，
 * 两者混排后由 `previewSplit` 在子集内归一化——这里**不做第二份归一化**。
 */
export function resolveAgentStageItems(
  presetKey: string | null,
  declaredNames: readonly string[],
): StageSelectionItem[] {
  const items: StageSelectionItem[] = [];
  if (presetKey) {
    // ★ 2026-09-28 走查 #5：presetKey 查无即抛（服务端口径 400 invalid_field）。
    //   旧版 getPresetItems 查无返回 []、若同传 stageNames 仍走完建板流程——
    //   调用方写错套餐名时「静默丢掉整个套餐骨架」比报错危险得多。
    if (!getPreset(presetKey)) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `未找到阶段套餐（presetKey=${presetKey}）：套餐名不存在，请核对 stage-library 的 21 个套餐。`,
      );
    }
    items.push(...getPresetItems(presetKey));
  }
  if (declaredNames.length === 0) return items;

  const fallbackDomain: StageTemplateDomain =
    (presetKey ? getPreset(presetKey)?.domain : null) ?? DEFAULT_PROJECT_DOMAIN;
  const each = 100 / (items.length + declaredNames.length);

  for (const name of declaredNames) {
    // ★ 判重键 = normalizeStageName（2026-09-28 走查 #6；与服务端/导入通道「按名选点」
    //   同一份算式）。旧版精确比较 ⇒「提案。」与「提案」可建成两段，之后导入按名
    //   落点随即歧义。归一值只做判定键，不入库（task-no.ts:305 注释同纪律）。
    if (items.some((it) => normalizeStageName(it.name) === normalizeStageName(name))) continue;
    const libraryItem = findLibraryStageItemByName(name);
    // 库里有的名字 → 原样用库项（占比/色号/默认任务都来自库，不另填）
    if (libraryItem) {
      items.push(libraryItem);
      continue;
    }
    // 库里没有 → 自定义阶段（落库时 templateKey 会被归一为 null）
    items.push(makeCustomAgentStageItem(name, items.length + 1, fallbackDomain, each));
  }
  return items;
}
