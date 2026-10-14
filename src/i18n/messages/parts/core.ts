/**
 * 消息表分片 · `core`（英文补齐批的并行写入口）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 注册协议（**每个分片 worker 只做两件事**）
 * ══════════════════════════════════════════════════════════════════════
 *   ① 只改**本文件**（在下面的 `zh` / `en` 里加键）+ **你自己目录下的调用点**
 *      （把硬编码中文换成 `t('键')`）；
 *   ② **绝不**碰 `zh.ts` / `en.ts` / `index.ts` / 别人的分片文件 ——
 *      撞公共文件就等于把「4 个人能同时写」这件事作废。
 *
 * 本分片负责：`src/core/**`
 *
 * ══════════════════════════════════════════════════════════════════════
 * 硬约束（与主表一字不差地生效）
 * ══════════════════════════════════════════════════════════════════════
 *   · **中文取值逐字不变**：新增键的 zh 必须与改动前源码里那句字面量**逐字节一致**
 *     （默认语言是中文 ⇒ 行为零变化是回归前提）；
 *   · **同一个词只建一个键**：新建键前先按**取值** grep 全表（不只看键名）；
 *   · **两列都得给**：本文件 zh 有、en 没有 ⇒ `tsc` 当场报缺键（这是机器保障，不是约定）；
 *   · 缩进 **2 空格**、`'键': '取值',` **一行一对**，键所在行必须以**两个空格**开头
 *     （`tests/i18n-messages-parts.spec.ts` 的重复键守卫按这个形状扫；取值折行时
 *      续行用 4 空格，守卫不会把它当成键）；
 *   · ⚠️ **不要**给导出加类型注解（尤其 `Record<string, string>`）：
 *     那会让 `keyof typeof zhMessages` 退化成 `string`，把「漏一个 en 键 = 编译错」
 *     这条全批安全网**打掉**。一律写成 `export const zh = { … } as const;`。
 *     （有编译期断言钉着这件事：`src/i18n/messages/zh.ts` 末尾的 `_KeyofNotString`。）
 */

/*
 * ══════════════════════════════════════════════════════════════════════
 * 键名约定（core 片）
 * ══════════════════════════════════════════════════════════════════════
 * `coreErr.<名词>.<做什么>` —— 与 `src/core/types/core-error-text.ts` 的键
 * **逐字同名**（那张表是**载荷口径**的唯一出处，这里是**界面口径**）。
 * 三张表（core 表 / 本片 zh / 本片 en）的键集两两相等 + zh 取值逐字相等，
 * 由 `tests/core-error-i18n.spec.ts` 直接读三份断言 —— 改任一侧都会红。
 *
 * ⚠️ zh 取值**逐字节等于改动前源码里那句字面量**（含标点与全角括号）；
 *    原本是模板串的写成 `{name}` 占位，渲染结果与原文一字不差。
 *    理由：`ChangxiaError.userMessage` 同时是回给**外部 Agent** 的协议字段。
 */

/** core 分片 · 中文（新键写在这里；取值必须与改动前源码逐字一致） */
export const zh = {
  /* ── 阶段仓储 / 阶段服务（coreErr.stage.*） ── */
  'coreErr.stage.listReadFailed': '阶段列表读取失败。',
  'coreErr.stage.readFailed': '阶段读取失败。',
  'coreErr.stage.draftIncomplete': '阶段草稿字段不完整，无法入库。',
  'coreErr.stage.rangeReversed': '「{name}」起止日期倒置。',
  'coreErr.stage.bulkWriteFailed': '阶段批量写入失败。',
  'coreErr.stage.notFound': '未找到该阶段。',
  'coreErr.stage.badDate': '日期格式无效。',
  'coreErr.stage.endBeforeStart': '新截止日早于开始日，已拒绝保存。',
  'coreErr.stage.newRangeInvalid': '新起止日期无效。',
  'coreErr.stage.newEndBeforeStart': '新的截止日早于开始日。',
  'coreErr.stage.postponeReasonRequired': '截止日后移必须填写延期原因（PRD 硬规则），否则不予保存。',
  'coreErr.stage.completedOnlyReopenInProgress': '已完成阶段仅允许重新开启为「进行中」。',

  /* ── 成员仓储（coreErr.member.*） ── */
  'coreErr.member.listReadFailed': '成员列表读取失败。',
  'coreErr.member.readFailed': '成员读取失败。',
  'coreErr.member.nameRequired': '成员姓名不能为空。',
  'coreErr.member.createFailed': '成员创建失败。',
  'coreErr.member.notFound': '未找到该成员。',

  /* ── 任务仓储（coreErr.task.*） ── */
  'coreErr.task.listReadFailed': '任务列表读取失败。',
  'coreErr.task.readFailed': '任务读取失败。',
  'coreErr.task.draftIncomplete': '任务草稿字段不完整，无法入库。',
  'coreErr.task.bulkWriteFailed': '任务批量写入失败。',
  'coreErr.task.titleRequired': '任务标题不能为空。',
  'coreErr.task.notFound': '未找到该任务。',
  'coreErr.task.externalIdRequired': '幂等键 externalId 不能为空。',
  'coreErr.task.fieldsIncomplete': '任务字段不完整，无法写入。',
  'coreErr.task.idempotencyConflict': '任务幂等键冲突，请重试导入。',
  'coreErr.task.idempotentWriteFailed': '任务幂等写入失败。',
  'coreErr.task.assigneeRequired': '认领人不能为空。',
  'coreErr.task.notClaimable': '该任务已被认领或不处于就绪状态。',
  'coreErr.task.claimFailed': '任务认领失败。',
  'coreErr.task.deleteFailed': '任务删除失败。',

  /* ── 每日行程仓储（coreErr.itinerary.*） ── */
  'coreErr.itinerary.listReadFailed': '每日行程读取失败。',
  'coreErr.itinerary.rangeInvalid': '旅游项目的起止日期无效，无法生成每日行程。',
  'coreErr.itinerary.generateFailed': '每日行程生成失败。',
  'coreErr.itinerary.missingProjectOrDate': '每日行程缺少有效项目或日期。',
  'coreErr.itinerary.createFailed': '每日行程创建失败。',
  'coreErr.itinerary.notFound': '未找到该每日行程。',
  'coreErr.itinerary.updateFailed': '每日行程更新失败。',
  'coreErr.itinerary.deleteFailed': '每日行程删除失败。',

  /* ── 流水仓储（coreErr.log.*） ── */
  'coreErr.log.stageAppendFailed': '阶段流水写入失败。',
  'coreErr.log.stageReadFailed': '阶段流水读取失败。',
  'coreErr.log.projectReadFailed': '项目流水读取失败。',
  'coreErr.log.assignmentAppendFailed': '指派流水写入失败。',
  'coreErr.log.assignmentReadFailed': '指派流水读取失败。',

  /* ── 设置仓储（coreErr.setting.*） ── */
  'coreErr.setting.readFailed': '设置项 {key} 读取失败。',
  'coreErr.setting.writeFailed': '设置项 {key} 写入失败。',
  'coreErr.setting.tableReadFailed': '设置表读取失败。',
  'coreErr.setting.tableRebuildFailed': '设置表重建失败。',

  /* ── 执行域仓储（coreErr.exec.* / attempt.* / writeback.*）── */
  'coreErr.exec.projectNotFound': '未找到项目 {projectId}，不能为它创建执行域数据。',
  'coreErr.exec.notAgentBoard': '执行域只属于 Agent 看板：项目 {projectId} 的 kind="{kind}"，不是 agent。 人工项目的排期不经由 Agent 执行通道。',
  'coreErr.exec.badSource': '字段 source 非法：{source}；合法值为 {allowed}。',
  'coreErr.exec.createFailed': '执行单创建失败。',
  'coreErr.exec.readFailed': '执行单读取失败。',
  'coreErr.exec.listReadFailed': '执行单列表读取失败。',
  'coreErr.exec.notFound': '未找到该执行单。',
  'coreErr.exec.statusUpdateFailed': '执行单状态更新失败。',
  'coreErr.exec.eventTargetMissing': '未找到执行单 {executionId}，不能追加事件。',
  'coreErr.exec.eventSeqInvalid': '执行事件 seq 非法：调用方传入 {actual}，期望 {expected}（execution={executionId}）。',
  'coreErr.exec.eventWriteFailed': '执行事件写入失败。',
  'coreErr.exec.eventListReadFailed': '执行事件列表读取失败。',
  'coreErr.attempt.badStatus': 'attempt status 非法：{status}；合法值为 {allowed}。',
  'coreErr.attempt.executionMissing': '未找到执行单 {executionId}，不能为其新建 attempt。',
  'coreErr.attempt.openAttemptExists': '执行单 {executionId} 已存在非终态 attempt，不能新开 attempt。',
  'coreErr.attempt.noInvalid': 'attemptNo 非法：调用方传入 {actual}，期望 {expected}（execution={executionId}）。',
  'coreErr.attempt.createFailed': '执行尝试创建失败。',
  'coreErr.attempt.notFound': '未找到该执行尝试。',
  'coreErr.attempt.updateFailed': '执行尝试更新失败。',
  'coreErr.attempt.listReadFailed': '执行尝试列表读取失败。',
  'coreErr.writeback.badStatus': '写回提案 status 非法：{status}；合法值为 {allowed}。',
  'coreErr.writeback.createAsSettled': '写回提案不允许直接创建为 {status}：提案须先创建（draft / proposed）再经由审批落定。',
  'coreErr.writeback.executionMissing': '未找到执行单 {executionId}，不能为其创建写回提案。',
  'coreErr.writeback.createFailed': '写回提案创建失败。',
  'coreErr.writeback.notFound': '未找到该写回提案。',
  'coreErr.writeback.alreadySettled': '写回提案已落定为 {status}，不可再变更（execution={executionId}）。',
  'coreErr.writeback.decidedByRequired': '写回提案落定为 {status} 必须由人工决策：decidedBy 必填（execution={executionId}）。',
  'coreErr.writeback.updateFailed': '写回提案更新失败。',
  'coreErr.writeback.listReadFailed': '写回提案列表读取失败。',

  /* ── 项目 / 合同 / 管理 / 数据库 / 数据源（段 3 之二）── */
  'coreErr.project.listReadFailed': '项目列表读取失败。',
  'coreErr.project.detailReadFailed': '项目详情读取失败。',
  'coreErr.project.nameRequired': '项目名称不能为空。',
  'coreErr.project.datesRequired': '项目计划起止日期不能为空。',
  'coreErr.project.createFailed': '项目创建失败。',
  'coreErr.project.notFound': '未找到该项目，可能已被删除。',
  'coreErr.project.deleteFailedRolledBack': '项目删除失败，数据已回滚。',
  'coreErr.contract.recognitionWriteFailed': '合同识别记录写入失败。',
  'coreErr.contract.recognitionReadFailed': '合同识别记录读取失败。',
  'coreErr.contract.listReadFailed': '合同记录列表读取失败。',
  'coreErr.admin.exportFailed': '全量导出失败。',
  'coreErr.admin.importFailedRolledBack': '备份导入失败：已整体回滚，本地数据未受影响。',
  'coreErr.db.openFailed': '本地数据库打开失败，请检查浏览器隐私模式或存储空间。',
  'coreErr.db.preMigrationBackupReadFailed': '迁移前备份读取失败。',
  'coreErr.datasource.initFailed': '本地数据源初始化失败。',

  /* ── 段 4 之一：切分 / 任务流转 / 写回提案字段 / payload 校验 ── */
  'coreErr.split.totalTooShort': '总工期过短，无法按所选 {count} 个阶段切分（各阶段至少 1 天）。请检查起止日期。',
  'coreErr.split.internalSumMismatch': '切分内部错误：阶段总天数 {sum} ≠ 总工期 {totalDays}',
  'coreErr.split.anchorOutOfRange': '锚点开始日期超出项目工期范围（阶段 {orderIndex}）。',
  'coreErr.split.anchorUnsatisfiable': '锚点钉住后无法满足总工期约束：请核对锚点日期是否落在工期内且互不矛盾。',
  'coreErr.split.anchorRunTooShort': '锚点重切后空间不足（阶段 {orderIndex} 起的连续段落至少各需 1 天）。请调整锚点或总工期。',
  'coreErr.split.selectAtLeastOneStage': '请至少选择 1 个阶段。',
  'coreErr.split.tooManyStages': '单次项目最多 {max} 个阶段，当前已选 {selected} 个。',
  'coreErr.split.projectRangeInvalid': '项目起止日期无效。',
  'coreErr.split.endBeforeStart': '截止日期早于开始日期。',
  'coreErr.split.noWorkdayInRange': '该工期范围内没有任何工作日，无法按工作日排期。请调整起止日期或休息制度。',
  'coreErr.split.ratioSumZero': '阶段占比合计必须大于 0。',
  'coreErr.split.startDateInvalid': '开始日期无效。',
  'coreErr.task.transitionNotAllowed': '不允许从「{from}」流转到「{to}」。',
  'coreErr.proposal.reasonNotString': '提案 reason 必须是字符串。',
  'coreErr.proposal.reasonTooLong': '提案 reason 超长（{length} > 200 字）：请压缩后再提交。',
  'coreErr.proposal.confidenceInvalid': '提案 confidence 必须是 0..1 的有限数（不夹取：越界值说明调用方算错了）。',
  'coreErr.payload.validationFailed': 'payload 校验失败：{detail}',

  /* ── 段 4 之二：接管搬运（takeover.*）/ 建板与阶段草稿校验（project.*）── */
  'coreErr.takeover.boardNotFound': '未找到该 Agent 看板，可能已被删除。',
  'coreErr.takeover.notAgentBoard': '只能接管 Agent 看板：该项目已经是人类工作区的项目。',
  'coreErr.takeover.sourceMustBeAgentBoard': '只能从 Agent 看板搬运任务。',
  'coreErr.takeover.targetNotFound': '未找到目标项目，可能已被删除。',
  'coreErr.takeover.targetMustBeHuman': '目标必须是人类工作区的项目：把任务搬进另一块 Agent 看板没有意义。',
  'coreErr.takeover.stageNotInTarget': '落点阶段必须属于目标项目（请先在目标项目里选一个阶段）。',
  'coreErr.takeover.noTasksSelected': '请至少选择一条要搬运的任务。',
  'coreErr.takeover.taskNotInBoard': '有任务不在该看板下（可能已被删除），请刷新后重试。',
  'coreErr.takeover.writeVerifyFailed': '任务「{title}」写入目标项目后验证失败，已中止（源看板数据未动）。',
  'coreErr.takeover.stageVerifyFailed': '任务「{title}」落点阶段验证失败，已中止（源看板数据未动）。',
  'coreErr.project.tooFewStages': '请至少选择 {count} 个阶段。',
  'coreErr.project.tooManyStages': '单次项目最多 {max} 个阶段，当前 {count} 个。',
  'coreErr.project.stageOrderGap': '阶段序号必须为 1..{count} 连续无空缺。',
  'coreErr.project.duplicateStageNames': '阶段名不能重复：{names}。',
  'coreErr.project.boardNameRequired': '请填写看板名称。',
  'coreErr.project.boardDatesRequired': '请提供看板的开始日期与结束日期（不会自动填充默认日期）。',
  'coreErr.project.presetOrNamesRequired': '请至少指定一个阶段套餐，或显式声明阶段名。',
  'coreErr.project.domainNotUsable': '「{domain}」不是可用的主板块。',
  'coreErr.project.presetNotFound': '未找到阶段套餐（presetKey={presetKey}）：套餐名不存在，请核对 stage-library 的 21 个套餐。',

  /* ── 备份校验 / 数据源（段 5）── */
  'coreErr.backup.domainOffender': '第 {n} 条项目（id={id}）的行业值「{value}」不合法',
  'coreErr.backup.domainRejected': '{offenders}。主板块 domain 只接受 {allowed}（共 {count} 个），或显式 null（= 清除，回到读时回落）。本包已被拒绝，库未做任何改动。',
  'coreErr.backup.schemaInvalid': '备份文件结构校验失败：{detail}',
  'coreErr.backup.importUnsupported': '当前数据源不支持备份导入。',
} as const;

/** core 分片 · 英文（每个 zh 键都必须有对应英文，漏一个 = 编译错） */
export const en = {
  /* ── 阶段仓储 / 阶段服务（coreErr.stage.*） ── */
  'coreErr.stage.listReadFailed': 'Failed to read the stage list.',
  'coreErr.stage.readFailed': 'Failed to read the stage.',
  'coreErr.stage.draftIncomplete': 'The stage draft is incomplete and cannot be saved.',
  'coreErr.stage.rangeReversed': '"{name}": the start date is after the end date.',
  'coreErr.stage.bulkWriteFailed': 'Failed to write the stages.',
  'coreErr.stage.notFound': 'Stage not found.',
  'coreErr.stage.badDate': 'Invalid date format.',
  'coreErr.stage.endBeforeStart': 'The new end date is before the start date; the change was rejected.',
  'coreErr.stage.newRangeInvalid': 'The new start or end date is invalid.',
  'coreErr.stage.newEndBeforeStart': 'The new end date is before the start date.',
  'coreErr.stage.postponeReasonRequired': 'A reason is required when moving the end date later (PRD hard rule); nothing was saved.',
  'coreErr.stage.completedOnlyReopenInProgress': 'A completed stage can only be reopened as "In progress".',

  /* ── 成员仓储（coreErr.member.*） ── */
  'coreErr.member.listReadFailed': 'Failed to read the member list.',
  'coreErr.member.readFailed': 'Failed to read the member.',
  'coreErr.member.nameRequired': 'Member name cannot be empty.',
  'coreErr.member.createFailed': 'Failed to create the member.',
  'coreErr.member.notFound': 'Member not found.',

  /* ── 任务仓储（coreErr.task.*） ── */
  'coreErr.task.listReadFailed': 'Failed to read the task list.',
  'coreErr.task.readFailed': 'Failed to read the task.',
  'coreErr.task.draftIncomplete': 'The task draft is incomplete and cannot be saved.',
  'coreErr.task.bulkWriteFailed': 'Failed to write the tasks.',
  'coreErr.task.titleRequired': 'Task title cannot be empty.',
  'coreErr.task.notFound': 'Task not found.',
  'coreErr.task.externalIdRequired': 'The idempotency key externalId cannot be empty.',
  'coreErr.task.fieldsIncomplete': 'The task data is incomplete and cannot be written.',
  'coreErr.task.idempotencyConflict': 'Task idempotency key conflict; please retry the import.',
  'coreErr.task.idempotentWriteFailed': 'Failed to write the task idempotently.',
  'coreErr.task.assigneeRequired': 'Assignee cannot be empty.',
  'coreErr.task.notClaimable': 'This task is already claimed or is not in the ready state.',
  'coreErr.task.claimFailed': 'Failed to claim the task.',
  'coreErr.task.deleteFailed': 'Failed to delete the task.',

  /* ── 每日行程仓储（coreErr.itinerary.*） ── */
  'coreErr.itinerary.listReadFailed': 'Failed to read the daily itinerary.',
  'coreErr.itinerary.rangeInvalid': 'The travel project start/end dates are invalid; a daily itinerary cannot be generated.',
  'coreErr.itinerary.generateFailed': 'Failed to generate the daily itinerary.',
  'coreErr.itinerary.missingProjectOrDate': 'The daily itinerary is missing a valid project or date.',
  'coreErr.itinerary.createFailed': 'Failed to create the daily itinerary.',
  'coreErr.itinerary.notFound': 'Daily itinerary not found.',
  'coreErr.itinerary.updateFailed': 'Failed to update the daily itinerary.',
  'coreErr.itinerary.deleteFailed': 'Failed to delete the daily itinerary.',

  /* ── 流水仓储（coreErr.log.*） ── */
  'coreErr.log.stageAppendFailed': 'Failed to write the stage log.',
  'coreErr.log.stageReadFailed': 'Failed to read the stage log.',
  'coreErr.log.projectReadFailed': 'Failed to read the project log.',
  'coreErr.log.assignmentAppendFailed': 'Failed to write the assignment log.',
  'coreErr.log.assignmentReadFailed': 'Failed to read the assignment log.',

  /* ── 设置仓储（coreErr.setting.*） ── */
  'coreErr.setting.readFailed': 'Failed to read the setting {key}.',
  'coreErr.setting.writeFailed': 'Failed to write the setting {key}.',
  'coreErr.setting.tableReadFailed': 'Failed to read the settings table.',
  'coreErr.setting.tableRebuildFailed': 'Failed to rebuild the settings table.',

  /* ── 执行域仓储（coreErr.exec.* / attempt.* / writeback.*）── */
  'coreErr.exec.projectNotFound': 'Project {projectId} not found; cannot create execution-domain data for it.',
  'coreErr.exec.notAgentBoard': 'The execution domain only exists on Agent boards: project {projectId} has kind="{kind}", not agent. Human project schedules do not go through the Agent execution channel.',
  'coreErr.exec.badSource': 'Invalid field source: {source}; allowed values are {allowed}.',
  'coreErr.exec.createFailed': 'Failed to create the execution.',
  'coreErr.exec.readFailed': 'Failed to read the execution.',
  'coreErr.exec.listReadFailed': 'Failed to read the execution list.',
  'coreErr.exec.notFound': 'Execution not found.',
  'coreErr.exec.statusUpdateFailed': 'Failed to update the execution status.',
  'coreErr.exec.eventTargetMissing': 'Execution {executionId} not found; cannot append an event.',
  'coreErr.exec.eventSeqInvalid': 'Invalid event seq: caller passed {actual}, expected {expected} (execution={executionId}).',
  'coreErr.exec.eventWriteFailed': 'Failed to write the execution event.',
  'coreErr.exec.eventListReadFailed': 'Failed to read the execution event list.',
  'coreErr.attempt.badStatus': 'Invalid attempt status: {status}; allowed values are {allowed}.',
  'coreErr.attempt.executionMissing': 'Execution {executionId} not found; cannot create an attempt for it.',
  'coreErr.attempt.openAttemptExists': 'Execution {executionId} already has a non-terminal attempt; a new attempt cannot be opened.',
  'coreErr.attempt.noInvalid': 'Invalid attemptNo: caller passed {actual}, expected {expected} (execution={executionId}).',
  'coreErr.attempt.createFailed': 'Failed to create the attempt.',
  'coreErr.attempt.notFound': 'Attempt not found.',
  'coreErr.attempt.updateFailed': 'Failed to update the attempt.',
  'coreErr.attempt.listReadFailed': 'Failed to read the attempt list.',
  'coreErr.writeback.badStatus': 'Invalid write-back proposal status: {status}; allowed values are {allowed}.',
  'coreErr.writeback.createAsSettled': 'A write-back proposal cannot be created directly as {status}: it must first be created (draft / proposed) and then settled through approval.',
  'coreErr.writeback.executionMissing': 'Execution {executionId} not found; cannot create a write-back proposal for it.',
  'coreErr.writeback.createFailed': 'Failed to create the write-back proposal.',
  'coreErr.writeback.notFound': 'Write-back proposal not found.',
  'coreErr.writeback.alreadySettled': 'The write-back proposal is already settled as {status} and can no longer change (execution={executionId}).',
  'coreErr.writeback.decidedByRequired': 'Settling the write-back proposal as {status} requires a human decision: decidedBy is required (execution={executionId}).',
  'coreErr.writeback.updateFailed': 'Failed to update the write-back proposal.',
  'coreErr.writeback.listReadFailed': 'Failed to read the write-back proposal list.',

  /* ── 项目 / 合同 / 管理 / 数据库 / 数据源（段 3 之二）── */
  'coreErr.project.listReadFailed': 'Failed to read the project list.',
  'coreErr.project.detailReadFailed': 'Failed to read the project details.',
  'coreErr.project.nameRequired': 'Project name cannot be empty.',
  'coreErr.project.datesRequired': 'The project planned start and end dates cannot be empty.',
  'coreErr.project.createFailed': 'Failed to create the project.',
  'coreErr.project.notFound': 'Project not found; it may have been deleted.',
  'coreErr.project.deleteFailedRolledBack': 'Failed to delete the project; the data has been rolled back.',
  'coreErr.contract.recognitionWriteFailed': 'Failed to write the contract recognition record.',
  'coreErr.contract.recognitionReadFailed': 'Failed to read the contract recognition record.',
  'coreErr.contract.listReadFailed': 'Failed to read the contract record list.',
  'coreErr.admin.exportFailed': 'Full export failed.',
  'coreErr.admin.importFailedRolledBack': 'Backup import failed: everything was rolled back; local data is unaffected.',
  'coreErr.db.openFailed': 'Failed to open the local database; check private browsing mode or available storage.',
  'coreErr.db.preMigrationBackupReadFailed': 'Failed to read the pre-migration backup.',
  'coreErr.datasource.initFailed': 'Failed to initialize the local data source.',

  /* ── 段 4 之一：切分 / 任务流转 / 写回提案字段 / payload 校验 ── */
  'coreErr.split.totalTooShort': 'The total duration is too short to split into the selected {count} stages (each stage needs at least 1 day). Please check the start and end dates.',
  'coreErr.split.internalSumMismatch': 'Internal split error: total stage days {sum} ≠ total duration {totalDays}',
  'coreErr.split.anchorOutOfRange': 'The anchor start date falls outside the project duration (stage {orderIndex}).',
  'coreErr.split.anchorUnsatisfiable': 'The total-duration constraint cannot be satisfied with these pinned anchors: check that the anchor dates fall inside the project duration and do not contradict each other.',
  'coreErr.split.anchorRunTooShort': 'Not enough room after re-splitting around the anchors (the consecutive segments from stage {orderIndex} each need at least 1 day). Adjust the anchors or the total duration.',
  'coreErr.split.selectAtLeastOneStage': 'Select at least one stage.',
  'coreErr.split.tooManyStages': 'A project can have at most {max} stages; {selected} are currently selected.',
  'coreErr.split.projectRangeInvalid': 'The project start and end dates are invalid.',
  'coreErr.split.endBeforeStart': 'The end date is earlier than the start date.',
  'coreErr.split.noWorkdayInRange': 'There are no workdays inside this date range, so workday-based scheduling is not possible. Adjust the dates or the rest policy.',
  'coreErr.split.ratioSumZero': 'The sum of the stage ratios must be greater than 0.',
  'coreErr.split.startDateInvalid': 'The start date is invalid.',
  'coreErr.task.transitionNotAllowed': 'Cannot move from "{from}" to "{to}".',
  'coreErr.proposal.reasonNotString': 'The proposal reason must be a string.',
  'coreErr.proposal.reasonTooLong': 'The proposal reason is too long ({length} > 200 characters); please shorten it and submit again.',
  'coreErr.proposal.confidenceInvalid': 'The proposal confidence must be a finite number between 0 and 1 (no clamping: an out-of-range value means the caller computed it wrong).',
  'coreErr.payload.validationFailed': 'Payload validation failed: {detail}',

  /* ── 段 4 之二：接管搬运（takeover.*）/ 建板与阶段草稿校验（project.*）── */
  'coreErr.takeover.boardNotFound': 'Agent board not found; it may have been deleted.',
  'coreErr.takeover.notAgentBoard': 'Only Agent boards can be taken over: this project is already a human-workspace project.',
  'coreErr.takeover.sourceMustBeAgentBoard': 'Tasks can only be moved out of an Agent board.',
  'coreErr.takeover.targetNotFound': 'Target project not found; it may have been deleted.',
  'coreErr.takeover.targetMustBeHuman': 'The target must be a human-workspace project: moving tasks into another Agent board is meaningless.',
  'coreErr.takeover.stageNotInTarget': 'The destination stage must belong to the target project (pick a stage in the target project first).',
  'coreErr.takeover.noTasksSelected': 'Select at least one task to move.',
  'coreErr.takeover.taskNotInBoard': 'Some tasks are not under this board (they may have been deleted); please refresh and try again.',
  'coreErr.takeover.writeVerifyFailed': 'Verification failed after writing task "{title}" into the target project; the operation was aborted (source board data untouched).',
  'coreErr.takeover.stageVerifyFailed': 'Verification of the destination stage for task "{title}" failed; the operation was aborted (source board data untouched).',
  'coreErr.project.tooFewStages': 'Select at least {count} stages.',
  'coreErr.project.tooManyStages': 'A project can have at most {max} stages; there are currently {count}.',
  'coreErr.project.stageOrderGap': 'Stage order indexes must run 1..{count} with no gaps.',
  'coreErr.project.duplicateStageNames': 'Stage names must be unique: {names}.',
  'coreErr.project.boardNameRequired': 'Enter a board name.',
  'coreErr.project.boardDatesRequired': 'Provide the board start and end dates (no default dates are filled in).',
  'coreErr.project.presetOrNamesRequired': 'Specify at least one stage preset, or declare the stage names explicitly.',
  'coreErr.project.domainNotUsable': '"{domain}" is not an available domain.',
  'coreErr.project.presetNotFound': 'Stage preset not found (presetKey={presetKey}): the preset name does not exist; check the 21 presets in stage-library.',

  /* ── 备份校验 / 数据源（段 5）── */
  'coreErr.backup.domainOffender': 'Item {n} (id={id}) has an invalid industry value "{value}"',
  'coreErr.backup.domainRejected': '{offenders}. The main-board domain only accepts {allowed} ({count} total), or an explicit null (= clear, falls back at read time). This package was rejected; the database was not modified.',
  'coreErr.backup.schemaInvalid': 'Backup file structure validation failed: {detail}',
  'coreErr.backup.importUnsupported': 'The current data source does not support backup import.',
} as const;
