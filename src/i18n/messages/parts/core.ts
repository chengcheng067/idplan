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
} as const;
