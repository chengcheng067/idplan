/**
 * 核心层用户面错误文案的**载荷中文唯一出处**（英文补齐批 · core 片）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么核心层要自己持有一份中文表，而不直接调 `t('…')`
 * ══════════════════════════════════════════════════════════════════════
 * `src/core/**` **全目录不许 import i18n**：`src/i18n/lang.ts` 会引用 `document`，
 * 一旦被 core 引入就会把它拖进 `server/tsconfig.json` 那份**无 DOM** 的 program，
 * `npm run typecheck:server` 当场报 TS2584（`lib/date.ts`、`constants/agentTerms.ts`
 * 都栽过这条）。守卫是 `tests/custom-library-path-i18n.spec.ts` 的「豁免集**恰好**等于
 * 命中集」（唯一豁免 `src/core/plugin/PluginSandboxFrame.tsx`，它是渲染组件）。
 *
 * 所以取词**不在 core 发生**。本文件只做两件事：
 *   ① 持有**载荷口径**的中文模板（`ChangxiaError.userMessage` 的渲染输入）；
 *   ② 把模板键挂到错误对象上，供**渲染层**取词。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 两边不漂 = 可执行断言，不是注释
 * ══════════════════════════════════════════════════════════════════════
 * 同一个词因此有两个物理位置（本表 = 载荷口径；`src/i18n/messages/parts/core.ts`
 * = 界面口径）。这三张表的**键集必须两两相等、取值必须逐字相等**，由
 * `tests/core-error-i18n.spec.ts` 直接读三份并断言 —— 改任一侧都会红。
 * 本形态与已批准的 `customLibrary` 裁 3 / 裁 4、以及 `electron/plugin-install.cjs`
 * 的「**主进程不持有界面语言 ⇒ 返回机器码，渲染层映射**」同款。
 *
 * ⚠️ 判据（别把这条表当成"界面文案表"来改）：
 *   · 这里的取值**逐字节等于改动前源码里那句字面量** —— `userMessage` 是
 *     `agent-loopback` 回给**外部 Agent** 的协议字段（读者是对方的程序），
 *     改一个字节都是契约变更；
 *   · 界面英文走 `t(messageKey)`，**不从这里取**。
 */

/** 插值参数（与 `src/i18n` 的 `InterpolationVars` 同形；core 不许 import 它） */
export type CoreErrorParams = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * 键 → 中文模板。键名一律 `coreErr.<名词>.<做什么>`，与消息表里的键**逐字同名**。
 *
 * 取值纪律：**与改动前源码里的字面量逐字节一致**（含标点，含全角括号）。
 * 原本是模板串的（如 `` `「${name}」起止日期倒置。` ``）在这里写成 `{name}` 占位，
 * 渲染结果与原文一字不差。
 */
export const CORE_ERROR_TEXT = {
  /* ── 阶段仓储 / 阶段服务 ── */
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

  /* ── 成员仓储 ── */
  'coreErr.member.listReadFailed': '成员列表读取失败。',
  'coreErr.member.readFailed': '成员读取失败。',
  'coreErr.member.nameRequired': '成员姓名不能为空。',
  'coreErr.member.createFailed': '成员创建失败。',
  'coreErr.member.notFound': '未找到该成员。',

  /* ── 任务仓储 ── */
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

  /* ── 每日行程仓储 ── */
  'coreErr.itinerary.listReadFailed': '每日行程读取失败。',
  'coreErr.itinerary.rangeInvalid': '旅游项目的起止日期无效，无法生成每日行程。',
  'coreErr.itinerary.generateFailed': '每日行程生成失败。',
  'coreErr.itinerary.missingProjectOrDate': '每日行程缺少有效项目或日期。',
  'coreErr.itinerary.createFailed': '每日行程创建失败。',
  'coreErr.itinerary.notFound': '未找到该每日行程。',
  'coreErr.itinerary.updateFailed': '每日行程更新失败。',
  'coreErr.itinerary.deleteFailed': '每日行程删除失败。',

  /* ── 流水仓储 ── */
  'coreErr.log.stageAppendFailed': '阶段流水写入失败。',
  'coreErr.log.stageReadFailed': '阶段流水读取失败。',
  'coreErr.log.projectReadFailed': '项目流水读取失败。',
  'coreErr.log.assignmentAppendFailed': '指派流水写入失败。',
  'coreErr.log.assignmentReadFailed': '指派流水读取失败。',

  /* ── 设置仓储 ── */
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

  /* ── 段 4 之三：payload 落点 / 执行状态机 / Agent 通道 / remote 客户端 / 命令校验 ── */
  'coreErr.payloadApply.stageNameRequired': 'stageName 不能为空；未声明落点阶段名时请完全不要传该参数。',
  'coreErr.payloadApply.projectIdMismatch': 'query 与 payload 的 projectId 不一致（外部指定={external} / payload={payload}），系统拒绝猜测落点，未写入任何数据。',
  'coreErr.payloadApply.targetMissing': '目标项目（id={projectId}）不存在，可能已被删除，请重新选择。',
  'coreErr.payloadApply.targetNotAgent': '目标项目（id={projectId}）不是 Agent 看板，Agent 通道不能往里写任务。 人类项目只能由你主动发起（界面手动粘贴 / 显式接管），Agent token 无法触碰。',
  'coreErr.payloadApply.projectRequired': 'payload 未指定目标项目，请先选择项目后再导入。',
  'coreErr.execution.badTransition': '非法的执行状态转移：{from} → {to}',
  'coreErr.execution.badAttemptTransition': '非法的执行尝试状态转移：{from} → {to}',
  'coreErr.execution.completeRejected': '非法的执行状态转移：{from} → {to}（{reason}）',
  'coreErr.execution.confirmOnlyAtGrantPoint': '确认凭据只能在授予点（{grantPoint}）写入；当前状态为 {current}，不允许写入确认（execution={executionId}）。',
  'coreErr.execution.confirmationIncomplete': '未确认的执行单不得进入 {next} 态：要求 confirmation.confirmedAt / confirmedBy / planHash 均非空（execution={executionId}）',
  'coreErr.execution.planHashMismatch': '进入 {next} 态被拒：确认绑定的计划（planHash={boundHash}）与当前执行单的计划（planHash={actualHash}）不一致，确认已失效；离开授予点后无法重新确认，此执行单只能取消或失败后新建（execution={executionId}）。',
  'coreErr.agent.fetchUnavailable': '当前运行环境不提供 fetch，无法访问 Agent 通道。',
  'coreErr.agent.timeout': '连接超时（{seconds}s）：请检查地址是否可达、服务是否已启动。',
  'coreErr.agent.connectFailed': '无法连接到该地址：请检查地址、网络与服务是否已启动。',
  'coreErr.agent.baseUrlRequired': '请先填写 Agent 服务地址。',
  'coreErr.agent.badJson': '服务端返回的不是合法 JSON，无法确认导入结果。',
  'coreErr.agent.channelRequestFailed': 'Agent 通道请求失败（HTTP {status}{suffix}）。',
  'coreErr.remote.connectFailed': '无法连接到服务器，请检查局域网地址配置。',
  'coreErr.remote.httpError': '服务端错误（HTTP {status}）',
  'coreErr.remote.baseUrlRequired': '启用 remote 数据源时必须配置 VITE_API_BASE_URL。',
  'coreErr.command.validationFailed': 'command 校验失败：{detail}',
} as const;

/** 机器可读的载荷文案键（= 上表的键；渲染层用 `t(messageKey)` 取界面口径） */
export type CoreErrorKey = keyof typeof CORE_ERROR_TEXT;

/** 该串是不是本表的键（供 `coreError()` 以外的调用方自检；正常路径不需要） */
export function isCoreErrorKey(key: string): key is CoreErrorKey {
  return Object.prototype.hasOwnProperty.call(CORE_ERROR_TEXT, key);
}

/**
 * 渲染**载荷中文**（= 改动前源码里那句字面量）。
 *
 * 占位符缺变量时**原样保留** `{name}` —— 与 `src/i18n/translate.ts` 的 `t()` 同口径：
 * 漏传变量要一眼看得见，而不是渲染成 `undefined` 混进协议字段。
 */
export function coreErrorText(key: CoreErrorKey, params?: CoreErrorParams): string {
  const raw: string = CORE_ERROR_TEXT[key];
  if (params === undefined) return raw;
  return raw.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
