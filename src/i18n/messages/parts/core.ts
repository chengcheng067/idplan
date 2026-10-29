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

  /* ── 段 5 之二：色板派生警告（8 条）——
        载荷句柄是**键**不是 `code`：`DeriveWarningCode` 四码冻结，且一个码覆盖最多 3 条不同文案 ── */
  'colorWarn.badMainHex': '主色 {raw} 不是合法颜色（期望 #RRGGBB），已按 {ink} 兜底；请重新取色。',
  'colorWarn.mainChromaTooLow': '主色彩度过低（C*={chroma} < {min}）：派生的阶段色与界面中性色（墨色/边框/灰底）属同一视觉层级，时间轴与月历上难以识别；建议换一个有色相的色。',
  'colorWarn.mainInvisibleOnLight': '主色在亮色底上不可见（对比度 {ratio} < {min}）；建议同色相加深。',
  'colorWarn.solidInvisibleOnDark': '派生出的实心块（暗色主题用 lightBar）在暗色底上不可见（对比度 {ratio} < {min}）；建议同色相变浅或加深。',
  'colorWarn.lightBandTextLow': '亮色色带上的文字对比度不足（{ratio} < {min}），即使走完 R2 的全部叠白档位仍无解；建议换主色。',
  'colorWarn.darkBandTextLow': '暗色色带上的文字对比度不足（{ratio} < {min}），E1 回退搜索亦无解；请换主色（不建议落库半成品）。',
  'colorWarn.forcedBandShift': '暗色色带偏离了 R5 原生规则（改用比例 {ratios} 中的另一档）以满足文字对比度 ≥ {min}。',
  'colorWarn.unresolvableTriple': '该主色无法派生出「亮/暗两套都达标」的三层令牌；请改用其它主色。',

  /*
   * ── 段 5 之三/之四：插件名的界面显示 + 兜底句 + 宿主装配失败 ──
   * ⚠️ 为什么 `plugin.*` 这一族键住在本分片（core 片）：
   *    分片是**按承接批次分的**，不是按键前缀分的（另三片是 ui / print-ui / misc）。
   *    本批的插件条目由本片承接（`src/core/plugin/**` 是这批的改动面），
   *    而 `plugin.*` 的其余键住在主表 `messages/{zh,en}.ts` 里（那不是本片的改动面）。
   *    主表与分片会在 `zh.ts` 里 spread 合并，**同键两处会撞**（有守卫），故加键前已核过不撞。
   * 键 → 用途见 `src/i18n/labels.ts` 的 `PLUGIN_NAME_KEYS` / `PLUGIN_SUMMARY_KEYS` 一段。
   */
  'plugin.builtin.sampleProjects.name': '示例项目',
  'plugin.builtin.sampleProjects.summary': '一键灌入 5 个行业的示例项目与任务，用来熟悉看板/月历/甘特',
  /* ⚠️ 值与 core 侧改动前那句兜底**逐字相同**（`installed.ts` 原先写死的那句）——「默认中文」零变化 */
  'plugin.noSummary': '（作者未提供说明）',

  /* 段 5 之四：宿主装配缺失（无 Provider）——载荷表与本表逐字相等（有 spec 钉） */
  'coreErr.plugin.registryUnavailable': '插件注册表不可用（无 Provider），无法保存开关',

  /* 段 6：工作区闸密码写入失败（多工作区抽象层 · 批 4）——载荷表与本表逐字相等 */
  'coreErr.workspace.gateWriteFailed':
    '工作区密码没能存进本地数据库，请重试（或检查浏览器存储是否可用）。',
  'coreErr.workspace.registryUnavailable':
    '工作区列表不可用（装配时缺少注册表回调），请检查启动配置。',

  /*
   * ── 段 5 之五：行业板块显示名（10 个 id）──
   * ⚠️ 值与 core 的 `DOMAIN_LABELS`（`src/core/template/stage-library.ts`）**逐字相同** ——
   *    那张表**一字不动**（core 不许 import i18n），它继续当载荷口径的中文出处；
   *    本表是屏幕口径。「默认中文」零变化的机器保证在 `tests/domain-label-i18n.spec.ts`。
   *    键表见 `src/i18n/labels.ts` 的 `DOMAIN_LABEL_KEYS`（类型是 `Record<StageTemplateDomain, …>`
   *    ⇒ 将来 `dto.ts` 的联合多一个成员，那里**编译不过**，不会静默漏翻）。
   */
  'domain.indoor': '室内',
  'domain.landscape': '景观',
  'domain.architecture': '建筑',
  'domain.exhibition': '展陈',
  'domain.software': '软件',
  'domain.marketing': '活动',
  'domain.film': '影视',
  'domain.wedding': '婚礼',
  'domain.consulting': '咨询',
  'domain.travel': '旅游',

  /* ── 行业**大类**显示名（`templates/stage-library.json` 的 7 个 `industryGroups[].name`）──
   * 与上一段 `domain.*` 是两层不同的东西：`domain.*` 是第 2 层「主板块」，
   * 本段是第 1 层「行业大类」（伞形的「建筑设计行业」+ 6 个一级平铺板块）。
   * ⚠️ zh 取值与那份 JSON 的 `name` **逐字节相同**（默认中文零变化，由
   *    `tests/industry-group-i18n.spec.ts` 的覆盖锁遍历 JSON 逐条比对）。 */
  'industryGroup.space': '建筑设计行业',
  'industryGroup.software': '软件开发',
  'industryGroup.marketing': '市场活动',
  'industryGroup.film': '影视制作',
  'industryGroup.wedding': '婚礼策划',
  'industryGroup.consulting': '咨询交付',
  'industryGroup.travel': '旅游出行',

  /* ── 阶段名 / 快捷套餐名（`templates/stage-library.json` 的 `items[].name` / `presets[].name`）──
   * 这一族是**随包数据名**：用户在向导里选中后，阶段名会作为 `stage.name` **落库**（进备份、进纸面）。
   * 口径与 `operator_name` / `Member.role` 同族：**落库钉死中文原值 + 屏幕侧取词**
   * （`labels.ts` 的 `STAGE_NAME_KEYS` / `stageNameLabel()`、`PRESET_NAME_KEYS` / `presetNameLabel()`）。
   * ⚠️ zh 取值与 JSON 的 `name` **逐字节相同**；`tests/stage-name-i18n.spec.tsx` 遍历 JSON 逐条比对。
   * ⚠️ 纸面（`src/print/**`）**不取词**：打印稿恒中文。 */
  'stageName.indoor.proposal': '提案',
  'stageName.indoor.measure': '测量',
  'stageName.indoor.concept_plan': '平面方案',
  'stageName.indoor.su_model': 'SU 建模',
  'stageName.indoor.rendering': '效果图',
  'stageName.indoor.construction_drawing': '施工图深化',
  'stageName.indoor.material_list': '材料表',
  'stageName.indoor.handover': '交付',
  'stageName.indoor.photography': '实景',
  'stageName.landscape.survey': '场地踏勘与测绘',
  'stageName.landscape.concept': '概念方案',
  'stageName.landscape.schematic': '方案深化（总平与竖向）',
  'stageName.landscape.planting': '种植设计',
  'stageName.landscape.mep_lighting': '水电与照明设计',
  'stageName.landscape.construction_drawing': '施工图（硬质与节点大样）',
  'stageName.landscape.site_service': '现场服务与竣工验收',
  'stageName.architecture.schematic': '方案设计',
  'stageName.architecture.development': '初步设计（扩初）',
  'stageName.architecture.construction_doc': '施工图设计',
  'stageName.architecture.permit_support': '报规报建配合',
  'stageName.architecture.site_service': '施工配合与竣工验收',
  'stageName.software.discovery': '需求调研',
  'stageName.software.prd': '产品方案',
  'stageName.software.uidesign': 'UI 设计',
  'stageName.software.dev': '开发实现',
  'stageName.software.qa': '测试修复',
  'stageName.software.launch': '验收上线',
  'stageName.software.handover': '运维交接',
  'stageName.marketing.brief': '需求立项',
  'stageName.marketing.strategy': '策略创意',
  'stageName.marketing.asset': '物料设计',
  'stageName.marketing.vendor': '供应商与场地',
  'stageName.marketing.promo': '预热推广',
  'stageName.marketing.onsite': '现场执行',
  'stageName.marketing.review': '复盘结案',
  'stageName.film.script': '剧本与分镜',
  'stageName.film.casting': '勘景选角',
  'stageName.film.prep': '前期筹备',
  'stageName.film.shoot': '拍摄',
  'stageName.film.edit1': '初剪',
  'stageName.film.edit2': '精剪调色',
  'stageName.film.deliver': '混音交付',
  'stageName.wedding.brief': '需求与场地',
  'stageName.wedding.concept': '主题方案',
  'stageName.wedding.vendor': '供应商确认',
  'stageName.wedding.asset': '物料制作',
  'stageName.wedding.rehearsal': '流程彩排',
  'stageName.wedding.deliver': '影像交付',
  'stageName.consulting.kickoff': '立项启动',
  'stageName.consulting.research': '现状诊断',
  'stageName.consulting.review': '评审修订',
  'stageName.consulting.landing': '落地辅导',
  'stageName.consulting.close': '结项复盘',
  'stageName.travel.plan': '需求规划',
  'stageName.travel.itinerary': '行程设计',
  'stageName.travel.booking': '资源预订',
  'stageName.travel.confirm': '行前确认',
  'stageName.travel.execution': '行程执行',
  'stageName.travel.settle': '费用结算',
  'stageName.travel.review': '复盘归档',
  'stageName.software.outsource_scope': '外包范围与报价',
  'stageName.software.api_integration': '第三方对接',
  'stageName.software.mobile_adapt': '移动端适配',
  'stageName.marketing.launch_run': '发布会执行',
  'stageName.marketing.expo_design': '展位设计',
  'stageName.marketing.media_plan': '媒介投放计划',
  'stageName.film.storyboard_anim': '动态分镜',
  'stageName.film.series_script': '系列选题与脚本',
  'stageName.wedding.destination_plan': '目的地统筹',
  'stageName.wedding.guest_manage': '宾客统筹',
  'stageName.consulting.train': '培训赋能',

  /* 快捷套餐名（29 个，按 preset key 建键；只在向导里出现、不落库） */
  'presetName.indoor_full': '室内·全流程',
  'presetName.indoor_concept': '室内·方案止（含效果图）',
  'presetName.indoor_ff': '室内·软装与陈设',
  'presetName.indoor_deepen_only': '室内·仅深化（外包承接）',
  'presetName.landscape_full': '景观·全流程',
  'presetName.landscape_concept': '景观·方案止（含竖向）',
  'presetName.architecture_full': '建筑·全流程',
  'presetName.architecture_cd': '建筑·施工图与报规',
  'presetName.software_full': '软件·全流程',
  'presetName.software_design_only': '软件·方案与设计止',
  'presetName.marketing_full': '活动·全流程',
  'presetName.marketing_creative_only': '活动·创意与物料止',
  'presetName.film_full': '影视·全流程',
  'presetName.film_post_only': '影视·仅后期',
  'presetName.wedding_full': '婚礼·全流程',
  'presetName.wedding_design_only': '婚礼·策划设计止',
  'presetName.consulting_full': '咨询·全流程',
  'presetName.consulting_diagnosis_only': '咨询·仅诊断',
  'presetName.travel_fit': '旅游·自由行',
  'presetName.travel_group': '旅游·跟团',
  'presetName.travel_business': '旅游·商务考察',
  'presetName.software_outsource_full': '软件外包·全交付',
  'presetName.software_mobile_full': '移动应用·专项',
  'presetName.marketing_launch_full': '发布会·全流程',
  'presetName.marketing_expo_full': '展会快闪·全流程',
  'presetName.film_promo_full': '宣传片·全流程',
  'presetName.film_series_full': '短视频系列',
  'presetName.wedding_destination_full': '目的地婚礼',
  'presetName.consulting_resident_full': '咨询·驻场陪跑',

  /*
   * ── 段 5 之六：两条「参数本身是 core 中文」的错误 —— `reason` 的中文句入表 ──
   * ⚠️ 值与 core `canComplete()` 里那两句**逐字节相同**（有断言钉：zh 下合成结果 === `resolveErrorText`）。
   * 键表与合成入口见 `src/i18n/labels.ts` 的 `COMPLETE_REASON_PATTERNS` / `resolveErrorTextForUi()`。
   */
  'execution.reason.notAwaitingReview': '完成要求 execution 处于 awaiting_review 态（当前为 {status}）',
  'execution.reason.noAppliedProposal': '完成要求存在由人工决策（decidedBy 非空）的 applied 写回提案（执行成功不等于业务完成）',

  /* ── 服务端错误文案（serverErr.* · 英文收尾批 · server 片）──
   * 载荷口径的唯一出处是 `server/lib/server-error-text.ts`，本表是**界面口径**（en 见下）。
   * zh 与载荷表逐字节相等，由 `tests/server-error-i18n.spec.ts` 的跨表断言钉着；
   * 与 `coreErr.*` 同文的 22 处**不建新键**（bundle 转换自证见该 spec ⑦）。
   * 口径：错误提示用句首大写 + 句点；片段句（作 {detail} 前缀用的）不带句点。 */
  'serverErr.internal': '服务器内部错误',
  'serverErr.agent.tooLarge': '导入内容过大，请拆分后分批同步。',
  'serverErr.agent.stageNameBlank': 'query 参数 stageName 出现但值为空/仅空白；显式声明落点阶段名时不能给空名称（系统不会把它当作「未声明」）。',
  'serverErr.agent.createStageIfMissingBlank': 'query 参数 createStageIfMissing 出现但值为空/仅空白；显式声明落点阶段名时不能给空名称（系统不会把它当作「未声明」）。',
  'serverErr.agent.stageNameAliasMismatch': 'query 参数 stageName 与 createStageIfMissing 同传但取值不同：两者是同义别名，取值必须一致。',
  'serverErr.agent.stageNameStageIdExclusive': '落点阶段名与 stageId 互斥（{where} 与落点名同传）：语义重叠说明调用方对落点不确定，系统报错而不是猜测。',
  'serverErr.agent.projectNameNotFound': '未找到名为「{name}」的项目，请先在 ID Plan 中确认项目名称。',
  'serverErr.agent.projectUnspecified': '未指定目标项目（body.projectId / ?projectId / ?projectName 均为空），无法导入。',
  'serverErr.agent.nlNotConfigured': '自然语言通道未配置（fail-closed）：请在服务端设置 IDPLAN_NL_LLM_BASE_URL / IDPLAN_NL_LLM_API_KEY / IDPLAN_NL_LLM_MODEL 三个环境变量（OpenAI 兼容端点，可指向你自己的 Ollama），重启后生效。未配置时本通道不可用——这是安全设计，不是故障。',
  'serverErr.agent.nlTextRequired': '请提供自然语言文本（body.text，非空）。',
  'serverErr.agent.nlTextTooLong': '自然语言文本超长（> {max} 字）：请只说这一条排期调整，别把整份合同粘进来。',
  'serverErr.agent.nlParseFailed': 'LLM 解析失败（未进入执行链）。',
  'serverErr.agent.nlShapeUnknown': 'LLM 输出形状不符',
  'serverErr.agent.nlShapeRejected': '{detail}（原始输出：{raw}）',
  'serverErr.agent.nlProjectUnresolved': '没能从这句话里解析出目标项目：请带上项目名或项目 id（Agent 看板）再说一次。',
  'serverErr.nl.llmHttp': 'LLM 服务返回 {status}',
  'serverErr.nl.badJson': 'LLM 输出不是合法 JSON（已被拒绝，未进入执行链）',
  'serverErr.agent.projectNotAgentBoard': '目标项目（id={projectId}）不是 Agent 看板，Agent 通道读不到它的任务。',
  'serverErr.agent.taskListReadFailed': '读取任务清单失败（HTTP {status}）：{body}',
  'serverErr.agent.boardNoTargetParams': '建板通道**只新建**看板，不接受 projectId / projectName（那是导入通道的落点解析参数）。要往已有项目写任务，请用 POST /api/agent/import。',
  'serverErr.agent.boardNameRequired': '建板必须显式声明看板名称（body.name 缺失 / 为空 / 仅空白）：系统不会替你取一个默认名字。',
  'serverErr.agent.boardStartRequired': '建板必须显式声明计划开始日期（body.plannedStartAt 缺失 / 为空 / 仅空白）。系统**不会替你猜一个日期**：默认日期会静默造出一条错误的排期，而错误的排期比一条明确的报错危险得多。',
  'serverErr.agent.boardEndRequired': '建板必须显式声明计划结束日期（body.plannedEndAt 缺失 / 为空 / 仅空白）。系统**不会替你猜一个日期**（同 plannedStartAt）。',
  'serverErr.agent.boardPresetKeyBlank': 'body.presetKey 出现但值为空/仅空白；不指定套餐时请**完全不要传**该参数（系统不会把它当作「没给」，因为那会把调用方的 bug 掩盖成「用了另一个阶段来源」）。',
  'serverErr.agent.boardStageNamesNotArray': 'body.stageNames 必须是字符串数组（显式声明的阶段名列表）。',
  'serverErr.agent.boardStageNamesBlankEntry': 'body.stageNames 里出现空/仅空白/非字符串的条目：显式声明阶段名时不能给空名称（系统不会把它当作「没声明过这个阶段」）。',
  'serverErr.agent.boardStagesRequired': '建板必须显式声明阶段集合：body.presetKey（内置套餐）或 body.stageNames（阶段名数组）至少要给一个（两者可以同时给：先展开套餐骨架，再追加声明的名字）。',
  'serverErr.agent.boardPresetNotFound': '未找到 key 为「{presetKey}」的阶段套餐（阶段库只认 templates/stage-library.json 里的套餐 key）。',
  'serverErr.agent.boardNoStages': '建板请求展开后没有任何阶段：阶段集合不能是空的。',
  'serverErr.agent.boardTooManyStages': '单次建板最多 {max} 个阶段，本次展开后为 {actual} 个。',
  'serverErr.agent.boardCreateFailed': '建板失败：创建项目时被既有端点拒绝（HTTP {status}）：{body}',
  'serverErr.bundle.notImplemented': '[not-implemented] sqlite.bundle 未实现 {what}：本适配器只覆盖 payload.apply 调用到的方法（§3.7）。',
  'serverErr.bundle.delegateFailed': '[sqlite.bundle] 委托 {method} {url} 失败（HTTP {statusCode}）：{body}',
  'serverErr.bundle.stageIdRequired': '[sqlite.bundle] stages.bulkInsert 的行必须自带非空 id（自动建阶段侧用 crypto.randomUUID() 生成）。',
  'serverErr.exec.dataWriteFailed': '执行域数据写入失败。',
  'serverErr.auth.backupTokenRequired': '备份通道需要鉴权：请在服务端配置 IDPLAN_AGENT_TOKEN，并在请求头携带 X-Agent-Token。',
  'serverErr.auth.agentTokenRequired': 'Agent 通道需要鉴权：请在服务端配置 {env}，并在请求头携带 X-Agent-Token（或 Authorization: Bearer）。',
  'serverErr.project.domainRejected': '{prefix}主板块 domain 只接受 {allowed}（共 {count} 个），或显式 null（= 清除，回到读时回落）；收到「{value}」。',
  'serverErr.backup.domainRejected': '备份导入被拒绝（库未做任何改动）。{offenders}。主板块 domain 只接受 {allowed}（共 {count} 个），或显式 null（= 清除，回到读时回落）。',
  'serverErr.project.notFound': '项目不存在',
  'serverErr.project.notFoundOrDeleted': '项目不存在或已删除',
  'serverErr.project.nameRequired': '项目名称不能为空',
  'serverErr.project.badKindCreate': '归属侧 kind 只接受 \'human\' / \'agent\' 两个取值，收到「{value}」。（归属侧是隔离谓词的判据，脏值会让前端与服务端对同一条项目判断不一致：前端按人类侧显示它，服务端候选清单却把它排除。）',
  'serverErr.project.badKindPatch': '归属侧 kind 只接受 \'human\' / \'agent\' 两个取值，收到「{value}」。（现状是原样透传，会把脏值写进库 —— 归属侧是隔离谓词的判据，脏值等于把数据放进一个谁也看不见的桶。）',
  'serverErr.project.takeoverRequired': '变更项目归属侧（kind）属于「接管」动作，必须显式声明接管意图（body.takeover === true）。本服务端当前**没有角色模型**，因此这道门校验的是「显式意图」而不是「请求者身份」——它能挡住误操作（顺手带上 kind 的字段级更新），但挡不住本来就拥有本机文件访问权的调用方。',
  'serverErr.project.startAfterEnd': '项目计划开始日期不能晚于结束日期。',
  'serverErr.stage.notFound': '阶段不存在',
  'serverErr.stage.endBeforeStart': '截止日早于开始日，已拒绝保存',
  'serverErr.task.rowProjectIdRequired': '任务行缺少 projectId，无法确定幂等键的项目作用域。',
  'serverErr.task.notFound': '任务不存在',
  'serverErr.task.titleRequired': '任务标题不能为空',
  'serverErr.member.notFound': '成员不存在',
  'serverErr.member.nameRequired': '成员姓名不能为空',
  'serverErr.member.badPassword': '密码错误',
  'serverErr.itinerary.badDate': '每日行程日期必须是 YYYY-MM-DD。',
  'serverErr.itinerary.badAmount': '预算和实际金额必须是有效数字或空值。',
  'serverErr.itinerary.duplicateDate': '该日期已有每日行程卡。',
  'serverErr.contract.notFound': '合同记录不存在',
  'serverErr.exec.fieldRequiredNonEmpty': '字段 {field} 必填且必须是非空字符串。',
  'serverErr.exec.fieldStringOrNull': '字段 {field} 必须是字符串或 null。',
  'serverErr.exec.fieldFiniteNumber': '字段 {field} 必须是有限数字。',
  'serverErr.exec.fieldNonEmptyString': '字段 {field} 必须是非空字符串。',
  'serverErr.exec.fieldNotAllowed': '字段 {field} 非法：{value}；合法值为 {allowed}。',
  'serverErr.exec.fieldInvalid': '字段 {field} 非法：{value}。',
  'serverErr.exec.seqRequired': '字段 seq 必填：seq 由调用方经 nextSeq 计算并传入（仓储拒绝乱序/跳号）。',
  'serverErr.exec.operationsRequired': '字段 operations 必填且必须是数组（WritebackOperation[]）。',
  'serverErr.exec.operationsNotArray': '字段 operations 必须是数组（WritebackOperation[]）。',
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

  /* ── 段 4 之三：payload 落点 / 执行状态机 / Agent 通道 / remote 客户端 / 命令校验 ── */
  'coreErr.payloadApply.stageNameRequired': 'stageName cannot be empty; if you are not declaring a destination stage name, do not pass this parameter at all.',
  'coreErr.payloadApply.projectIdMismatch': 'The projectId in the query and in the payload do not match (external={external} / payload={payload}); the system refuses to guess the destination and wrote no data.',
  'coreErr.payloadApply.targetMissing': 'Target project (id={projectId}) does not exist; it may have been deleted. Please choose again.',
  'coreErr.payloadApply.targetNotAgent': 'Target project (id={projectId}) is not an Agent board; the Agent channel cannot write tasks into it. Human projects can only be started by you (manual paste in the UI, or explicit takeover); an Agent token cannot touch them.',
  'coreErr.payloadApply.projectRequired': 'The payload does not specify a target project; pick a project before importing.',
  'coreErr.execution.badTransition': 'Illegal execution status transition: {from} → {to}',
  'coreErr.execution.badAttemptTransition': 'Illegal attempt status transition: {from} → {to}',
  'coreErr.execution.completeRejected': 'Illegal execution status transition: {from} → {to} ({reason})',
  'coreErr.execution.confirmOnlyAtGrantPoint': 'Confirmation credentials can only be written at the grant point ({grantPoint}); the current status is {current}, so writing a confirmation is not allowed (execution={executionId}).',
  'coreErr.execution.confirmationIncomplete': 'An unconfirmed execution cannot enter the {next} state: confirmation.confirmedAt / confirmedBy / planHash must all be non-empty (execution={executionId})',
  'coreErr.execution.planHashMismatch': 'Entering the {next} state was rejected: the plan bound to the confirmation (planHash={boundHash}) does not match the current plan of this execution (planHash={actualHash}); the confirmation is no longer valid, cannot be re-confirmed after leaving the grant point, and this execution can only be cancelled or failed and recreated (execution={executionId}).',
  'coreErr.agent.fetchUnavailable': 'The current runtime does not provide fetch, so the Agent channel is unreachable.',
  'coreErr.agent.timeout': 'Connection timed out ({seconds}s): check that the address is reachable and the service is running.',
  'coreErr.agent.connectFailed': 'Cannot connect to that address: check the address, the network, and whether the service is running.',
  'coreErr.agent.baseUrlRequired': 'Enter the Agent service address first.',
  'coreErr.agent.badJson': 'The server did not return valid JSON, so the import result cannot be confirmed.',
  'coreErr.agent.channelRequestFailed': 'Agent channel request failed (HTTP {status}{suffix}).',
  'coreErr.remote.connectFailed': 'Cannot connect to the server; check the LAN address configuration.',
  'coreErr.remote.httpError': 'Server error (HTTP {status})',
  'coreErr.remote.baseUrlRequired': 'VITE_API_BASE_URL must be configured when the remote data source is enabled.',
  'coreErr.command.validationFailed': 'Command validation failed: {detail}',

  /* ── 段 5 之二：色板派生警告（8 条） ── */
  'colorWarn.badMainHex': 'The main color {raw} is not a valid color (expected #RRGGBB); fell back to {ink}. Pick the color again.',
  'colorWarn.mainChromaTooLow': 'The main color has too little chroma (C*={chroma} < {min}): the derived stage colors sit at the same visual level as the neutral interface colors (ink / borders / gray surfaces), so they are hard to tell apart on the timeline and month calendar. Pick a color with a hue.',
  'colorWarn.mainInvisibleOnLight': 'The main color is invisible on the light background (contrast {ratio} < {min}); deepen it within the same hue.',
  'colorWarn.solidInvisibleOnDark': 'The derived solid block (the dark theme uses lightBar) is invisible on the dark background (contrast {ratio} < {min}); lighten or deepen it within the same hue.',
  'colorWarn.lightBandTextLow': 'Text on the light band has insufficient contrast ({ratio} < {min}); even after exhausting all of the R2 white-overlay steps there is no solution. Choose a different main color.',
  'colorWarn.darkBandTextLow': 'Text on the dark band has insufficient contrast ({ratio} < {min}); the E1 fallback search found no solution either. Change the main color (do not persist a half-finished result).',
  'colorWarn.forcedBandShift': 'The dark band deviates from the native R5 rule (it uses another step from the ratios {ratios}) to reach a text contrast of at least {min}.',
  'colorWarn.unresolvableTriple': 'This main color cannot derive a three-layer token set where both the light and dark variants pass; use a different main color.',

  /* ── 段 5 之三/之四：插件名的界面显示 + 兜底句 ── */
  'plugin.builtin.sampleProjects.name': 'Sample projects',
  'plugin.builtin.sampleProjects.summary': 'Load sample projects and tasks from 5 industries in one click, to get familiar with the board, calendar and Gantt',
  'plugin.noSummary': '(no description provided by the author)',

  /* 段 5 之四：宿主装配缺失（无 Provider） */
  'coreErr.plugin.registryUnavailable':
    'The plugin registry is unavailable (no Provider), so this switch cannot be saved.',

  /* 段 6：工作区闸密码写入失败（多工作区抽象层 · 批 4） */
  'coreErr.workspace.gateWriteFailed':
    'The workspace password could not be saved to the local database. Please try again (and check that browser storage is available).',
  'coreErr.workspace.registryUnavailable':
    'The workspace list is unavailable (the registry callback was not wired up at startup); please check the boot configuration.',

  /* ── 段 5 之五：行业板块显示名（10 个 id）—— 译名由 team-lead 给出 ── */
  'domain.indoor': 'Interiors',
  'domain.landscape': 'Landscape',
  'domain.architecture': 'Architecture',
  'domain.exhibition': 'Exhibition',
  'domain.software': 'Software',
  'domain.marketing': 'Events',
  'domain.film': 'Film',
  'domain.wedding': 'Wedding',
  'domain.consulting': 'Consulting',
  'domain.travel': 'Travel',

  /*
   * 行业**大类**（第 1 层）译名。刻意与 `domain.*`（第 2 层主板块）**选词不同**：
   * 大类是「行业/生意」，不是单一专业。`space` 覆盖 建筑/景观/室内 ⇒ 用
   * Built Environment（业内标准说法），译成 "Architecture" 会与第 2 层的
   * Architecture 撞名 —— 同一个下拉里出现两个同名词，用户分不清哪个是伞。
   */
  'industryGroup.space': 'Built Environment',
  'industryGroup.software': 'Software Development',
  'industryGroup.marketing': 'Marketing & Events',
  'industryGroup.film': 'Film & Video',
  'industryGroup.wedding': 'Wedding Planning',
  'industryGroup.consulting': 'Consulting & Delivery',
  'industryGroup.travel': 'Travel',

  /* Stage / preset names (ship-with-build data names; rationale on the zh side).
   * The stored value stays the Chinese original; only the screen is localised. */
  'stageName.indoor.proposal': 'Proposal',
  'stageName.indoor.measure': 'Site Measurement',
  'stageName.indoor.concept_plan': 'Floor Plan Concept',
  'stageName.indoor.su_model': '3D Modelling (SU)',
  'stageName.indoor.rendering': 'Visualisation',
  'stageName.indoor.construction_drawing': 'Construction Drawings',
  'stageName.indoor.material_list': 'Material Schedule',
  'stageName.indoor.handover': 'Handover',
  'stageName.indoor.photography': 'Photo Shoot',
  'stageName.landscape.survey': 'Site Survey',
  'stageName.landscape.concept': 'Concept Design',
  'stageName.landscape.schematic': 'Scheme Development (plan & levels)',
  'stageName.landscape.planting': 'Planting Design',
  'stageName.landscape.mep_lighting': 'MEP & Lighting Design',
  'stageName.landscape.construction_drawing': 'Construction Drawings (hardscape & details)',
  'stageName.landscape.site_service': 'Site Service & Handover',
  'stageName.architecture.schematic': 'Scheme Design',
  'stageName.architecture.development': 'Design Development',
  'stageName.architecture.construction_doc': 'Construction Documents',
  'stageName.architecture.permit_support': 'Permit & Approval Support',
  'stageName.architecture.site_service': 'Construction Support & Handover',
  'stageName.software.discovery': 'Discovery',
  'stageName.software.prd': 'Product Spec',
  'stageName.software.uidesign': 'UI Design',
  'stageName.software.dev': 'Development',
  'stageName.software.qa': 'QA & Fixes',
  'stageName.software.launch': 'Launch',
  'stageName.software.handover': 'Ops Handover',
  'stageName.marketing.brief': 'Brief',
  'stageName.marketing.strategy': 'Strategy & Creative',
  'stageName.marketing.asset': 'Collateral Design',
  'stageName.marketing.vendor': 'Vendors & Venue',
  'stageName.marketing.promo': 'Teaser Campaign',
  'stageName.marketing.onsite': 'On-site Execution',
  'stageName.marketing.review': 'Retrospective',
  'stageName.film.script': 'Script & Storyboard',
  'stageName.film.casting': 'Location Scouting & Casting',
  'stageName.film.prep': 'Pre-production',
  'stageName.film.shoot': 'Shoot',
  'stageName.film.edit1': 'Rough Cut',
  'stageName.film.edit2': 'Fine Cut & Grading',
  'stageName.film.deliver': 'Audio Mix & Delivery',
  'stageName.wedding.brief': 'Brief & Venue',
  'stageName.wedding.concept': 'Theme Concept',
  'stageName.wedding.vendor': 'Vendor Confirmation',
  'stageName.wedding.asset': 'Props & Collateral',
  'stageName.wedding.rehearsal': 'Rehearsal',
  'stageName.wedding.deliver': 'Photo & Film Delivery',
  'stageName.consulting.kickoff': 'Kick-off',
  'stageName.consulting.research': 'Diagnosis',
  'stageName.consulting.review': 'Review & Revision',
  'stageName.consulting.landing': 'Implementation Coaching',
  'stageName.consulting.close': 'Closure & Retrospective',
  'stageName.travel.plan': 'Trip Planning',
  'stageName.travel.itinerary': 'Itinerary Design',
  'stageName.travel.booking': 'Booking',
  'stageName.travel.confirm': 'Pre-trip Confirmation',
  'stageName.travel.execution': 'Trip Execution',
  'stageName.travel.settle': 'Expense Settlement',
  'stageName.travel.review': 'Post-trip Review',
  'stageName.software.outsource_scope': 'Outsourcing Scope & Quote',
  'stageName.software.api_integration': 'Third-party Integration',
  'stageName.software.mobile_adapt': 'Mobile Adaptation',
  'stageName.marketing.launch_run': 'Launch Event Execution',
  'stageName.marketing.expo_design': 'Booth Design',
  'stageName.marketing.media_plan': 'Media Plan',
  'stageName.film.storyboard_anim': 'Animatic',
  'stageName.film.series_script': 'Series Topics & Scripts',
  'stageName.wedding.destination_plan': 'Destination Coordination',
  'stageName.wedding.guest_manage': 'Guest Coordination',
  'stageName.consulting.train': 'Training & Enablement',

  /* Quick presets (29) */
  'presetName.indoor_full': 'Interior · Full Scope',
  'presetName.indoor_concept': 'Interior · To Concept (with visuals)',
  'presetName.indoor_ff': 'Interior · FF&E',
  'presetName.indoor_deepen_only': 'Interior · Drawings Only (outsourced)',
  'presetName.landscape_full': 'Landscape · Full Scope',
  'presetName.landscape_concept': 'Landscape · To Concept (with levels)',
  'presetName.architecture_full': 'Architecture · Full Scope',
  'presetName.architecture_cd': 'Architecture · CDs & Permits',
  'presetName.software_full': 'Software · Full Scope',
  'presetName.software_design_only': 'Software · To Design',
  'presetName.marketing_full': 'Event · Full Scope',
  'presetName.marketing_creative_only': 'Event · To Creative & Collateral',
  'presetName.film_full': 'Film · Full Scope',
  'presetName.film_post_only': 'Film · Post Only',
  'presetName.wedding_full': 'Wedding · Full Scope',
  'presetName.wedding_design_only': 'Wedding · To Design',
  'presetName.consulting_full': 'Consulting · Full Scope',
  'presetName.consulting_diagnosis_only': 'Consulting · Diagnosis Only',
  'presetName.travel_fit': 'Travel · Independent',
  'presetName.travel_group': 'Travel · Group Tour',
  'presetName.travel_business': 'Travel · Business Visit',
  'presetName.software_outsource_full': 'Outsourced Software · Full Delivery',
  'presetName.software_mobile_full': 'Mobile App · Dedicated',
  'presetName.marketing_launch_full': 'Launch Event · Full Scope',
  'presetName.marketing_expo_full': 'Expo & Pop-up · Full Scope',
  'presetName.film_promo_full': 'Promo Film · Full Scope',
  'presetName.film_series_full': 'Short-video Series',
  'presetName.wedding_destination_full': 'Destination Wedding',
  'presetName.consulting_resident_full': 'Consulting · On-site Residency',

  /* ── 段 5 之六：两条「参数本身是 core 中文」的错误 —— `reason` 的英文句 ── */
  'execution.reason.notAwaitingReview':
    'Completing requires the execution to be in "awaiting_review" (currently {status})',
  'execution.reason.noAppliedProposal':
    'Completing requires an applied write-back proposal decided by a human (decidedBy non-empty); a successful run is not the same as completed work',

  /* ── 服务端错误文案（serverErr.*）── 界面口径；载荷口径在 server/lib/server-error-text.ts ── */
  'serverErr.internal': 'Internal server error.',
  'serverErr.agent.tooLarge': 'The import payload is too large; please split it into smaller batches.',
  'serverErr.agent.stageNameBlank': 'The query parameter stageName is present but empty or blank; when declaring a target stage name explicitly it cannot be blank (the system will not treat it as "not declared").',
  'serverErr.agent.createStageIfMissingBlank': 'The query parameter createStageIfMissing is present but empty or blank; when declaring a target stage name explicitly it cannot be blank (the system will not treat it as "not declared").',
  'serverErr.agent.stageNameAliasMismatch': 'The query parameters stageName and createStageIfMissing were both sent with different values; they are synonyms and must match.',
  'serverErr.agent.stageNameStageIdExclusive': 'A target stage name and stageId are mutually exclusive ({where} was sent together with the stage name): the overlapping semantics mean the caller is unsure about the target, so the system reports an error instead of guessing.',
  'serverErr.agent.projectNameNotFound': 'No project named "{name}" was found; please confirm the project name in ID Plan first.',
  'serverErr.agent.projectUnspecified': 'No target project was specified (body.projectId / ?projectId / ?projectName are all empty); cannot import.',
  'serverErr.agent.nlNotConfigured': 'The natural-language channel is not configured (fail-closed): set the IDPLAN_NL_LLM_BASE_URL / IDPLAN_NL_LLM_API_KEY / IDPLAN_NL_LLM_MODEL environment variables on the server (any OpenAI-compatible endpoint, including your own Ollama), then restart. While unconfigured this channel is unavailable — this is a security design, not a fault.',
  'serverErr.agent.nlTextRequired': 'Please provide the natural-language text (body.text, non-empty).',
  'serverErr.agent.nlTextTooLong': 'The natural-language text is too long (> {max} characters): please describe only this one reschedule request; do not paste the whole contract.',
  'serverErr.agent.nlParseFailed': 'LLM parsing failed (the execution chain was not entered).',
  'serverErr.agent.nlShapeUnknown': 'The LLM output shape is invalid',
  'serverErr.agent.nlShapeRejected': '{detail} (raw output: {raw})',
  'serverErr.agent.nlProjectUnresolved': 'No target project could be resolved from this sentence; please include the project name or project id (Agent board) and try again.',
  'serverErr.nl.llmHttp': 'The LLM service returned {status}',
  'serverErr.nl.badJson': 'The LLM output is not valid JSON (rejected; the execution chain was not entered)',
  'serverErr.agent.projectNotAgentBoard': 'The target project (id={projectId}) is not an Agent board; the Agent channel cannot read its tasks.',
  'serverErr.agent.taskListReadFailed': 'Failed to read the task list (HTTP {status}): {body}',
  'serverErr.agent.boardNoTargetParams': 'The board-creation channel only creates new boards; it does not accept projectId / projectName (those are the target-resolution parameters of the import channel). To write tasks to an existing project, use POST /api/agent/import.',
  'serverErr.agent.boardNameRequired': 'The board name must be declared explicitly (body.name is missing / empty / blank): the system will not pick a default name for you.',
  'serverErr.agent.boardStartRequired': 'The planned start date must be declared explicitly (body.plannedStartAt is missing / empty / blank). The system will not guess a date for you: a default date would silently create a wrong schedule, and a wrong schedule is far more dangerous than a clear error.',
  'serverErr.agent.boardEndRequired': 'The planned end date must be declared explicitly (body.plannedEndAt is missing / empty / blank). The system will not guess a date for you (same as plannedStartAt).',
  'serverErr.agent.boardPresetKeyBlank': 'body.presetKey is present but empty or blank; when not specifying a preset, do not send this parameter at all (the system will not treat it as "not given", because that would disguise the caller\'s bug as "another stage source was used").',
  'serverErr.agent.boardStageNamesNotArray': 'body.stageNames must be an array of strings (the explicitly declared stage-name list).',
  'serverErr.agent.boardStageNamesBlankEntry': 'body.stageNames contains an empty / blank / non-string entry: when declaring stage names explicitly, blank names are not allowed (the system will not treat it as "this stage was never declared").',
  'serverErr.agent.boardStagesRequired': 'The stage set must be declared explicitly: body.presetKey (built-in preset) or body.stageNames (array of stage names) — at least one is required (both may be given: the preset skeleton is expanded first, then the declared names are appended).',
  'serverErr.agent.boardPresetNotFound': 'No stage preset with key "{presetKey}" was found (the stage library only accepts preset keys from templates/stage-library.json).',
  'serverErr.agent.boardNoStages': 'The board request expanded to no stages: the stage set cannot be empty.',
  'serverErr.agent.boardTooManyStages': 'A single board allows at most {max} stages; this request expanded to {actual}.',
  'serverErr.agent.boardCreateFailed': 'Board creation failed: the existing endpoint rejected the project creation (HTTP {status}): {body}',
  'serverErr.bundle.notImplemented': '[not-implemented] sqlite.bundle does not implement {what}: this adapter only covers the methods called by payload.apply (§3.7).',
  'serverErr.bundle.delegateFailed': '[sqlite.bundle] delegated {method} {url} failed (HTTP {statusCode}): {body}',
  'serverErr.bundle.stageIdRequired': '[sqlite.bundle] rows for stages.bulkInsert must carry a non-empty id (the auto-create-stage side generates it with crypto.randomUUID()).',
  'serverErr.exec.dataWriteFailed': 'Failed to write execution-domain data.',
  'serverErr.auth.backupTokenRequired': 'The backup channel requires authentication: configure IDPLAN_AGENT_TOKEN on the server and send the X-Agent-Token header.',
  'serverErr.auth.agentTokenRequired': 'The Agent channel requires authentication: configure {env} on the server and send the X-Agent-Token header (or Authorization: Bearer).',
  'serverErr.project.domainRejected': '{prefix}Domain only accepts {allowed} ({count} in total), or explicit null (= clear, fall back to read-time resolution); received "{value}".',
  'serverErr.backup.domainRejected': 'Backup import rejected (no changes were made to the database). {offenders}. Domain only accepts {allowed} ({count} in total), or explicit null (= clear, fall back to read-time resolution).',
  'serverErr.project.notFound': 'Project not found',
  'serverErr.project.notFoundOrDeleted': 'Project not found or already deleted',
  'serverErr.project.nameRequired': 'Project name cannot be empty',
  'serverErr.project.badKindCreate': 'Ownership kind accepts only \'human\' / \'agent\'; received "{value}". (Ownership is the isolation predicate: a dirty value would make the frontend and the server disagree about the same project — the frontend shows it on the human side while the server excludes it from the candidate list.)',
  'serverErr.project.badKindPatch': 'Ownership kind accepts only \'human\' / \'agent\'; received "{value}". (Today the value is passed through as-is, which would write the dirty value into the database — ownership is the isolation predicate, and a dirty value puts the data in a bucket nobody can see.)',
  'serverErr.project.takeoverRequired': 'Changing a project\'s ownership (kind) is a "takeover" action and must declare the takeover intent explicitly (body.takeover === true). This server currently has no role model, so this gate validates "explicit intent" rather than "requester identity" — it blocks accidental changes (a field-level update that happens to carry kind), but not a caller who already has local file access.',
  'serverErr.project.startAfterEnd': 'The planned start date cannot be later than the end date.',
  'serverErr.stage.notFound': 'Stage not found',
  'serverErr.stage.endBeforeStart': 'The end date is before the start date; the change was rejected',
  'serverErr.task.rowProjectIdRequired': 'The task row is missing projectId, so the project scope of the idempotency key cannot be determined.',
  'serverErr.task.notFound': 'Task not found',
  'serverErr.task.titleRequired': 'Task title cannot be empty',
  'serverErr.member.notFound': 'Member not found',
  'serverErr.member.nameRequired': 'Member name cannot be empty',
  'serverErr.member.badPassword': 'Incorrect password',
  'serverErr.itinerary.badDate': 'The itinerary date must be YYYY-MM-DD.',
  'serverErr.itinerary.badAmount': 'Budget and actual amounts must be valid numbers or empty.',
  'serverErr.itinerary.duplicateDate': 'An itinerary card already exists for this date.',
  'serverErr.contract.notFound': 'Contract record not found',
  'serverErr.exec.fieldRequiredNonEmpty': 'Field {field} is required and must be a non-empty string.',
  'serverErr.exec.fieldStringOrNull': 'Field {field} must be a string or null.',
  'serverErr.exec.fieldFiniteNumber': 'Field {field} must be a finite number.',
  'serverErr.exec.fieldNonEmptyString': 'Field {field} must be a non-empty string.',
  'serverErr.exec.fieldNotAllowed': 'Field {field} is invalid: {value}; allowed values are {allowed}.',
  'serverErr.exec.fieldInvalid': 'Field {field} is invalid: {value}.',
  'serverErr.exec.seqRequired': 'Field seq is required: the caller computes it via nextSeq and passes it in (the repository rejects out-of-order or skipped numbers).',
  'serverErr.exec.operationsRequired': 'Field operations is required and must be an array (WritebackOperation[]).',
  'serverErr.exec.operationsNotArray': 'Field operations must be an array (WritebackOperation[]).',
} as const;
