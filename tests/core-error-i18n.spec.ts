// @vitest-environment jsdom
/**
 * core 片 · 用户面错误文案的**语言契约**（英文补齐批）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这条链长什么样（三段，缺一段就是假绿）
 * ══════════════════════════════════════════════════════════════════════
 *   ① core 抛错：`coreError(code, 'coreErr.x.y', params, cause)`
 *      ⇒ `userMessage` 由 `CORE_ERROR_TEXT` 渲染（**载荷口径**，逐字不变）
 *      ⇒ 同时在错误上挂 `messageKey` / `params`（机器可读）
 *   ② core 解析：`resolveErrorText(err, t, fallback)` —— **core 不 import i18n**，
 *      `t` 由渲染层注入（core 引 i18n 会把 `document` 拖进服务端 program）
 *   ③ 渲染层：把 30 处 `err.userMessage` 换成 `resolveErrorText(err, t, t('…'))`
 *      ⚠️ **③ 不在本批 core 片的改动面内**（落在 components/store/hooks/pages/di）——
 *      本条链的界面效果由它决定；本 spec 只能证明 ①② 真的把英文取到手。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 本文件守的四条（每条都对应一个会真实发生的坏结果）
 * ══════════════════════════════════════════════════════════════════════
 *   ① **三表不漂**：`CORE_ERROR_TEXT`（载荷）/ 分片 zh（界面）/ 分片 en 的键集
 *      **两两相等**，且两侧 zh **取值逐字相等**。
 *      坏结果：改了一处忘了另一处 ⇒ 同一句话两个口径（本仓称「同套名字两份真相」）。
 *   ② **载荷逐字节不变**：每个键的 `userMessage` / `message` 等于**改动前源码里
 *      那句字面量**（基准值**抄在下面的表里**，不是运行时重算 —— 重算只能证明
 *      "自己等于自己"）。坏结果：`userMessage` 是回给**外部 Agent** 的协议字段，
 *      动一个字节就是契约变更。
 *   ③ **英文真能取到**：`resolveErrorText(err, t)` 在 en 下给出英文、在 zh 下给出
 *      与 `userMessage` 逐字相同的中文。坏结果：机制对但没人能取到 ⇒ 假绿。
 *   ④ **三支口径与团队判据一字不差**：有码→本地化；无码有真因→**原样透传**；
 *      都没有→`fallback`。
 *      坏结果：拿兜底句盖掉数据层真因（「用通用文案把事实盖住」）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { setLang, t } from '../src/i18n';
import {
  CORE_ERROR_TEXT,
  coreErrorText,
  type CoreErrorKey,
} from '../src/core/types/core-error-text';
import { en as coreEn, zh as coreZh } from '../src/i18n/messages/parts/core';
import {
  ChangxiaError,
  ChangxiaErrorCode,
  coreError,
  resolveErrorText,
} from '../src/core/types/enums';
import { LocalStagesRepository } from '../src/core/repositories/local/local.stages.repo';
import { LocalMembersRepository } from '../src/core/repositories/local/local.members.repo';
import { StageService } from '../src/core/services/stage.service';
import { resolveAgentProjectId } from '../src/core/agent/payload.apply';
import {
  assertAttemptTransition,
  assertExecutionConfirmed,
  assertStatusTransition,
  assertTransition,
} from '../src/core/execution/execution-state';
import { importTasks, mapHttpError } from '../src/core/agent/transport.http';
import { runRescheduleStages, validateAgentCommand } from '../src/core/agent/commands';
import { createRemoteRepositories } from '../src/core/repositories/remote/rest.client';

/**
 * 本片**已交付**的键全集。
 *
 * 刻意**不手抄一份名单**：手抄名单只会变成「加了键忘了加名单」的第二个真相源，
 * 而 `CORE_ERROR_TEXT` 与分片 zh 的键集相等已由 ① 断言钉住。
 * 真正必须手写的是下面的 `BASELINE`（载荷基准值），那才是本文件的判别力所在。
 */
const KEYS: readonly CoreErrorKey[] = Object.keys(CORE_ERROR_TEXT) as CoreErrorKey[];

/**
 * ★ 载荷基准表 —— **手抄自 `9ca1395`（改动前）的源码字面量**，不是运行时重算。
 * 键 → [错误码, 改动前那句原文]。渲染结果必须与它逐字节相等。
 */
const BASELINE: ReadonlyArray<readonly [CoreErrorKey, ChangxiaErrorCode, string]> = [
  ['coreErr.stage.listReadFailed', ChangxiaErrorCode.Storage, '阶段列表读取失败。'],
  ['coreErr.stage.readFailed', ChangxiaErrorCode.Storage, '阶段读取失败。'],
  ['coreErr.stage.draftIncomplete', ChangxiaErrorCode.Validation, '阶段草稿字段不完整，无法入库。'],
  // 原本是模板串 `` `「${r.name}」起止日期倒置。` ``（取值逐字节相同）
  ['coreErr.stage.rangeReversed', ChangxiaErrorCode.Validation, '「S1」起止日期倒置。'],
  ['coreErr.stage.bulkWriteFailed', ChangxiaErrorCode.Storage, '阶段批量写入失败。'],
  ['coreErr.stage.notFound', ChangxiaErrorCode.NotFound, '未找到该阶段。'],
  ['coreErr.stage.badDate', ChangxiaErrorCode.Validation, '日期格式无效。'],
  ['coreErr.stage.endBeforeStart', ChangxiaErrorCode.Validation, '新截止日早于开始日，已拒绝保存。'],
  ['coreErr.stage.newRangeInvalid', ChangxiaErrorCode.Validation, '新起止日期无效。'],
  ['coreErr.stage.newEndBeforeStart', ChangxiaErrorCode.Validation, '新的截止日早于开始日。'],
  [
    'coreErr.stage.postponeReasonRequired',
    ChangxiaErrorCode.Validation,
    '截止日后移必须填写延期原因（PRD 硬规则），否则不予保存。',
  ],
  [
    'coreErr.stage.completedOnlyReopenInProgress',
    ChangxiaErrorCode.Conflict,
    '已完成阶段仅允许重新开启为「进行中」。',
  ],
  ['coreErr.member.listReadFailed', ChangxiaErrorCode.Storage, '成员列表读取失败。'],
  ['coreErr.member.readFailed', ChangxiaErrorCode.Storage, '成员读取失败。'],
  ['coreErr.member.nameRequired', ChangxiaErrorCode.Validation, '成员姓名不能为空。'],
  ['coreErr.member.createFailed', ChangxiaErrorCode.Storage, '成员创建失败。'],
  ['coreErr.member.notFound', ChangxiaErrorCode.NotFound, '未找到该成员。'],

  /* ── 第 2 批（本地仓储余下 4 文件 / 31 键）：基准值同样**取自改动前的 `HEAD:` 源码** ── */
  ['coreErr.itinerary.createFailed', ChangxiaErrorCode.Storage, '每日行程创建失败。'],
  ['coreErr.itinerary.deleteFailed', ChangxiaErrorCode.Storage, '每日行程删除失败。'],
  ['coreErr.itinerary.generateFailed', ChangxiaErrorCode.Storage, '每日行程生成失败。'],
  ['coreErr.itinerary.listReadFailed', ChangxiaErrorCode.Storage, '每日行程读取失败。'],
  ['coreErr.itinerary.missingProjectOrDate', ChangxiaErrorCode.Validation, '每日行程缺少有效项目或日期。'],
  ['coreErr.itinerary.notFound', ChangxiaErrorCode.NotFound, '未找到该每日行程。'],
  ['coreErr.itinerary.rangeInvalid', ChangxiaErrorCode.Validation, '旅游项目的起止日期无效，无法生成每日行程。'],
  ['coreErr.itinerary.updateFailed', ChangxiaErrorCode.Storage, '每日行程更新失败。'],
  ['coreErr.log.assignmentAppendFailed', ChangxiaErrorCode.Storage, '指派流水写入失败。'],
  ['coreErr.log.assignmentReadFailed', ChangxiaErrorCode.Storage, '指派流水读取失败。'],
  ['coreErr.log.projectReadFailed', ChangxiaErrorCode.Storage, '项目流水读取失败。'],
  ['coreErr.log.stageAppendFailed', ChangxiaErrorCode.Storage, '阶段流水写入失败。'],
  ['coreErr.log.stageReadFailed', ChangxiaErrorCode.Storage, '阶段流水读取失败。'],
  // 原本是模板串「设置项 + 变量 + 读取失败。」（基准值 = key 取 theme 时的渲染结果）
  ['coreErr.setting.readFailed', ChangxiaErrorCode.Storage, '设置项 theme 读取失败。'],
  ['coreErr.setting.tableReadFailed', ChangxiaErrorCode.Storage, '设置表读取失败。'],
  ['coreErr.setting.tableRebuildFailed', ChangxiaErrorCode.Storage, '设置表重建失败。'],
  ['coreErr.setting.writeFailed', ChangxiaErrorCode.Storage, '设置项 theme 写入失败。'],
  ['coreErr.task.assigneeRequired', ChangxiaErrorCode.Validation, '认领人不能为空。'],
  ['coreErr.task.bulkWriteFailed', ChangxiaErrorCode.Storage, '任务批量写入失败。'],
  ['coreErr.task.claimFailed', ChangxiaErrorCode.Storage, '任务认领失败。'],
  ['coreErr.task.deleteFailed', ChangxiaErrorCode.Storage, '任务删除失败。'],
  ['coreErr.task.draftIncomplete', ChangxiaErrorCode.Validation, '任务草稿字段不完整，无法入库。'],
  ['coreErr.task.externalIdRequired', ChangxiaErrorCode.Validation, '幂等键 externalId 不能为空。'],
  ['coreErr.task.fieldsIncomplete', ChangxiaErrorCode.Validation, '任务字段不完整，无法写入。'],
  ['coreErr.task.idempotencyConflict', ChangxiaErrorCode.Conflict, '任务幂等键冲突，请重试导入。'],
  ['coreErr.task.idempotentWriteFailed', ChangxiaErrorCode.Storage, '任务幂等写入失败。'],
  ['coreErr.task.listReadFailed', ChangxiaErrorCode.Storage, '任务列表读取失败。'],
  ['coreErr.task.notClaimable', ChangxiaErrorCode.Conflict, '该任务已被认领或不处于就绪状态。'],
  ['coreErr.task.notFound', ChangxiaErrorCode.NotFound, '未找到该任务。'],
  ['coreErr.task.readFailed', ChangxiaErrorCode.Storage, '任务读取失败。'],
  ['coreErr.task.titleRequired', ChangxiaErrorCode.Validation, '任务标题不能为空。'],

  /* ── 段 3（执行域仓储）· 基准值同样取自改动前的 `HEAD:` 源码；参数化那条 = 表里 PARAMS 渲染后的结果 ── */
  ['coreErr.exec.projectNotFound', ChangxiaErrorCode.NotFound, '未找到项目 p1，不能为它创建执行域数据。'],
  ['coreErr.exec.notAgentBoard', ChangxiaErrorCode.Validation, '执行域只属于 Agent 看板：项目 p1 的 kind="human"，不是 agent。 人工项目的排期不经由 Agent 执行通道。'],
  ['coreErr.exec.badSource', ChangxiaErrorCode.Validation, '字段 source 非法：bogus；合法值为 project-task / natural-language / external / template。'],
  ['coreErr.exec.createFailed', ChangxiaErrorCode.Storage, '执行单创建失败。'],
  ['coreErr.exec.readFailed', ChangxiaErrorCode.Storage, '执行单读取失败。'],
  ['coreErr.exec.listReadFailed', ChangxiaErrorCode.Storage, '执行单列表读取失败。'],
  ['coreErr.exec.notFound', ChangxiaErrorCode.NotFound, '未找到该执行单。'],
  ['coreErr.exec.statusUpdateFailed', ChangxiaErrorCode.Storage, '执行单状态更新失败。'],
  ['coreErr.exec.eventTargetMissing', ChangxiaErrorCode.NotFound, '未找到执行单 ex1，不能追加事件。'],
  ['coreErr.exec.eventSeqInvalid', ChangxiaErrorCode.Validation, '执行事件 seq 非法：调用方传入 3，期望 2（execution=ex1）。'],
  ['coreErr.exec.eventWriteFailed', ChangxiaErrorCode.Storage, '执行事件写入失败。'],
  ['coreErr.exec.eventListReadFailed', ChangxiaErrorCode.Storage, '执行事件列表读取失败。'],
  ['coreErr.attempt.badStatus', ChangxiaErrorCode.Validation, 'attempt status 非法：bogus；合法值为 queued / running / succeeded / failed / cancelled / interrupted。'],
  ['coreErr.attempt.executionMissing', ChangxiaErrorCode.NotFound, '未找到执行单 ex1，不能为其新建 attempt。'],
  ['coreErr.attempt.openAttemptExists', ChangxiaErrorCode.Conflict, '执行单 ex1 已存在非终态 attempt，不能新开 attempt。'],
  ['coreErr.attempt.noInvalid', ChangxiaErrorCode.Validation, 'attemptNo 非法：调用方传入 3，期望 2（execution=ex1）。'],
  ['coreErr.attempt.createFailed', ChangxiaErrorCode.Storage, '执行尝试创建失败。'],
  ['coreErr.attempt.notFound', ChangxiaErrorCode.NotFound, '未找到该执行尝试。'],
  ['coreErr.attempt.updateFailed', ChangxiaErrorCode.Storage, '执行尝试更新失败。'],
  ['coreErr.attempt.listReadFailed', ChangxiaErrorCode.Storage, '执行尝试列表读取失败。'],
  ['coreErr.writeback.badStatus', ChangxiaErrorCode.Validation, '写回提案 status 非法：ghost；合法值为 draft / proposed / applied / rejected / conflict。'],
  ['coreErr.writeback.createAsSettled', ChangxiaErrorCode.Validation, '写回提案不允许直接创建为 applied：提案须先创建（draft / proposed）再经由审批落定。'],
  ['coreErr.writeback.executionMissing', ChangxiaErrorCode.NotFound, '未找到执行单 ex1，不能为其创建写回提案。'],
  ['coreErr.writeback.createFailed', ChangxiaErrorCode.Storage, '写回提案创建失败。'],
  ['coreErr.writeback.notFound', ChangxiaErrorCode.NotFound, '未找到该写回提案。'],
  ['coreErr.writeback.alreadySettled', ChangxiaErrorCode.Conflict, '写回提案已落定为 applied，不可再变更（execution=ex1）。'],
  ['coreErr.writeback.decidedByRequired', ChangxiaErrorCode.Validation, '写回提案落定为 applied 必须由人工决策：decidedBy 必填（execution=ex1）。'],
  ['coreErr.writeback.updateFailed', ChangxiaErrorCode.Storage, '写回提案更新失败。'],
  ['coreErr.writeback.listReadFailed', ChangxiaErrorCode.Storage, '写回提案列表读取失败。'],

  /* ── 段 3 之二（项目/合同/管理/数据库/数据源）：基准值同样取自改动前的 `HEAD:` 源码 ── */
  ['coreErr.project.listReadFailed', ChangxiaErrorCode.Storage, '项目列表读取失败。'],
  ['coreErr.project.detailReadFailed', ChangxiaErrorCode.Storage, '项目详情读取失败。'],
  ['coreErr.project.nameRequired', ChangxiaErrorCode.Validation, '项目名称不能为空。'],
  ['coreErr.project.datesRequired', ChangxiaErrorCode.Validation, '项目计划起止日期不能为空。'],
  ['coreErr.project.createFailed', ChangxiaErrorCode.Storage, '项目创建失败。'],
  ['coreErr.project.notFound', ChangxiaErrorCode.NotFound, '未找到该项目，可能已被删除。'],
  ['coreErr.project.deleteFailedRolledBack', ChangxiaErrorCode.Storage, '项目删除失败，数据已回滚。'],
  ['coreErr.contract.recognitionWriteFailed', ChangxiaErrorCode.Storage, '合同识别记录写入失败。'],
  ['coreErr.contract.recognitionReadFailed', ChangxiaErrorCode.Storage, '合同识别记录读取失败。'],
  ['coreErr.contract.listReadFailed', ChangxiaErrorCode.Storage, '合同记录列表读取失败。'],
  ['coreErr.admin.exportFailed', ChangxiaErrorCode.Storage, '全量导出失败。'],
  ['coreErr.admin.importFailedRolledBack', ChangxiaErrorCode.Storage, '备份导入失败：已整体回滚，本地数据未受影响。'],
  ['coreErr.db.openFailed', ChangxiaErrorCode.Storage, '本地数据库打开失败，请检查浏览器隐私模式或存储空间。'],
  ['coreErr.db.preMigrationBackupReadFailed', ChangxiaErrorCode.Storage, '迁移前备份读取失败。'],
  ['coreErr.datasource.initFailed', ChangxiaErrorCode.Storage, '本地数据源初始化失败。'],

  /* ── 段 4 之一（切分/任务流转/提案字段/payload 校验）：参数化那几条 = PARAMS 渲染后的结果 ── */
  ['coreErr.split.totalTooShort', ChangxiaErrorCode.Validation, '总工期过短，无法按所选 3 个阶段切分（各阶段至少 1 天）。请检查起止日期。'],
  ['coreErr.split.internalSumMismatch', ChangxiaErrorCode.Validation, '切分内部错误：阶段总天数 7 ≠ 总工期 9'],
  ['coreErr.split.anchorOutOfRange', ChangxiaErrorCode.Conflict, '锚点开始日期超出项目工期范围（阶段 2）。'],
  ['coreErr.split.anchorUnsatisfiable', ChangxiaErrorCode.Conflict, '锚点钉住后无法满足总工期约束：请核对锚点日期是否落在工期内且互不矛盾。'],
  ['coreErr.split.anchorRunTooShort', ChangxiaErrorCode.Conflict, '锚点重切后空间不足（阶段 2 起的连续段落至少各需 1 天）。请调整锚点或总工期。'],
  ['coreErr.split.selectAtLeastOneStage', ChangxiaErrorCode.Validation, '请至少选择 1 个阶段。'],
  ['coreErr.split.tooManyStages', ChangxiaErrorCode.Validation, '单次项目最多 9 个阶段，当前已选 10 个。'],
  ['coreErr.split.projectRangeInvalid', ChangxiaErrorCode.Validation, '项目起止日期无效。'],
  ['coreErr.split.endBeforeStart', ChangxiaErrorCode.Validation, '截止日期早于开始日期。'],
  ['coreErr.split.noWorkdayInRange', ChangxiaErrorCode.Validation, '该工期范围内没有任何工作日，无法按工作日排期。请调整起止日期或休息制度。'],
  ['coreErr.split.ratioSumZero', ChangxiaErrorCode.Validation, '阶段占比合计必须大于 0。'],
  ['coreErr.split.startDateInvalid', ChangxiaErrorCode.Validation, '开始日期无效。'],
  ['coreErr.task.transitionNotAllowed', ChangxiaErrorCode.Validation, '不允许从「草稿」流转到「已完成」。'],
  ['coreErr.proposal.reasonNotString', ChangxiaErrorCode.Validation, '提案 reason 必须是字符串。'],
  ['coreErr.proposal.reasonTooLong', ChangxiaErrorCode.Validation, '提案 reason 超长（201 > 200 字）：请压缩后再提交。'],
  ['coreErr.proposal.confidenceInvalid', ChangxiaErrorCode.Validation, '提案 confidence 必须是 0..1 的有限数（不夹取：越界值说明调用方算错了）。'],
  ['coreErr.payload.validationFailed', ChangxiaErrorCode.Validation, 'payload 校验失败：projects.0 不是合法的主板块'],

  /* ── 段 4 之二（接管搬运 / 建板与阶段草稿校验）：参数化那几条 = PARAMS 渲染后的结果 ── */
  ['coreErr.takeover.boardNotFound', ChangxiaErrorCode.NotFound, '未找到该 Agent 看板，可能已被删除。'],
  ['coreErr.takeover.notAgentBoard', ChangxiaErrorCode.Validation, '只能接管 Agent 看板：该项目已经是人类工作区的项目。'],
  ['coreErr.takeover.sourceMustBeAgentBoard', ChangxiaErrorCode.Validation, '只能从 Agent 看板搬运任务。'],
  ['coreErr.takeover.targetNotFound', ChangxiaErrorCode.NotFound, '未找到目标项目，可能已被删除。'],
  ['coreErr.takeover.targetMustBeHuman', ChangxiaErrorCode.Validation, '目标必须是人类工作区的项目：把任务搬进另一块 Agent 看板没有意义。'],
  ['coreErr.takeover.stageNotInTarget', ChangxiaErrorCode.Validation, '落点阶段必须属于目标项目（请先在目标项目里选一个阶段）。'],
  ['coreErr.takeover.noTasksSelected', ChangxiaErrorCode.Validation, '请至少选择一条要搬运的任务。'],
  ['coreErr.takeover.taskNotInBoard', ChangxiaErrorCode.NotFound, '有任务不在该看板下（可能已被删除），请刷新后重试。'],
  ['coreErr.takeover.writeVerifyFailed', ChangxiaErrorCode.Storage, '任务「任务甲」写入目标项目后验证失败，已中止（源看板数据未动）。'],
  ['coreErr.takeover.stageVerifyFailed', ChangxiaErrorCode.Storage, '任务「任务甲」落点阶段验证失败，已中止（源看板数据未动）。'],
  ['coreErr.project.tooFewStages', ChangxiaErrorCode.Validation, '请至少选择 1 个阶段。'],
  ['coreErr.project.tooManyStages', ChangxiaErrorCode.Validation, '单次项目最多 20 个阶段，当前 21 个。'],
  ['coreErr.project.stageOrderGap', ChangxiaErrorCode.Validation, '阶段序号必须为 1..9 连续无空缺。'],
  ['coreErr.project.duplicateStageNames', ChangxiaErrorCode.Validation, '阶段名不能重复：方案、深化。'],
  ['coreErr.project.boardNameRequired', ChangxiaErrorCode.Validation, '请填写看板名称。'],
  ['coreErr.project.boardDatesRequired', ChangxiaErrorCode.Validation, '请提供看板的开始日期与结束日期（不会自动填充默认日期）。'],
  ['coreErr.project.presetOrNamesRequired', ChangxiaErrorCode.Validation, '请至少指定一个阶段套餐，或显式声明阶段名。'],
  ['coreErr.project.domainNotUsable', ChangxiaErrorCode.Validation, '「unknown」不是可用的主板块。'],
  ['coreErr.project.presetNotFound', ChangxiaErrorCode.Validation, '未找到阶段套餐（presetKey=x_full）：套餐名不存在，请核对 stage-library 的 21 个套餐。'],

  /* ── 段 5 第 1 批（备份校验 / 数据源）：基准值取自改动前的 `HEAD:` 源码 ── */
  ['coreErr.backup.domainOffender', ChangxiaErrorCode.Validation, '第 2 条项目（id=p2）的行业值「xyz」不合法'],
  ['coreErr.backup.domainRejected', ChangxiaErrorCode.Validation, '第 2 条项目（id=p2）的行业值「xyz」不合法。主板块 domain 只接受 indoor / landscape（共 2 个），或显式 null（= 清除，回到读时回落）。本包已被拒绝，库未做任何改动。'],
  ['coreErr.backup.schemaInvalid', ChangxiaErrorCode.Validation, '备份文件结构校验失败：data.projects Unexpected token'],
  ['coreErr.backup.importUnsupported', ChangxiaErrorCode.Storage, '当前数据源不支持备份导入。'],

  /* ── 段 4 之三（payload 落点 / 执行状态机 / Agent 通道 / remote 客户端 / 命令校验）·
        基准值逐条取自改动前的 `HEAD:` 源码字面量 ── */
  ['coreErr.payloadApply.stageNameRequired', ChangxiaErrorCode.Validation, 'stageName 不能为空；未声明落点阶段名时请完全不要传该参数。'],
  // 改动前是**两段字符串相加**（`query 与 payload 的 projectId 不一致（外部指定=${e} / payload=${p}），` + '系统拒绝猜测落点，未写入任何数据。'）
  // ⇒ 并入单条模板后取值必须逐字节相同（下面这条基准按拼接后的结果手抄）
  ['coreErr.payloadApply.projectIdMismatch', ChangxiaErrorCode.Validation, 'query 与 payload 的 projectId 不一致（外部指定=q1 / payload=p1），系统拒绝猜测落点，未写入任何数据。'],
  ['coreErr.payloadApply.targetMissing', ChangxiaErrorCode.ProjectUnresolved, '目标项目（id=p1）不存在，可能已被删除，请重新选择。'],
  // ⚠️ 同样是两段相加，但**第二段以空格开头**（`' 人类项目只能由…'`）——
  //    并入模板时该空格**必须保留**（看「任务。」与「人类」之间那一个空格），这是本条基准最容易被改错的地方
  ['coreErr.payloadApply.targetNotAgent', ChangxiaErrorCode.ProjectUnresolved, '目标项目（id=p1）不是 Agent 看板，Agent 通道不能往里写任务。 人类项目只能由你主动发起（界面手动粘贴 / 显式接管），Agent token 无法触碰。'],
  ['coreErr.payloadApply.projectRequired', ChangxiaErrorCode.Validation, 'payload 未指定目标项目，请先选择项目后再导入。'],
  ['coreErr.execution.badTransition', ChangxiaErrorCode.Validation, '非法的执行状态转移：running → completed'],
  ['coreErr.execution.badAttemptTransition', ChangxiaErrorCode.Validation, '非法的执行尝试状态转移：queued → succeeded'],
  /*
   * ⚠️ 登记在案的中文残留（与 `coreErr.task.transitionNotAllowed` 同族，**同一种成因**）：
   * `{reason}` 的实参来自本文件 `canComplete()` 的 `reason` 字面量（core 内部中文），
   * 它同时被界面直接消费，故**不翻**；整句的中文化要等 `src/i18n/labels.ts` 那一批做合成（core 外）。
   * ⇒ 下面 ③ 的「英文渲染结果不得含汉字」对这条**推导为豁免**（实参自带汉字），不是白名单。
   */
  ['coreErr.execution.completeRejected', ChangxiaErrorCode.Validation, '非法的执行状态转移：running → completed（完成要求存在由人工决策（decidedBy 非空）的 applied 写回提案（执行成功不等于业务完成））'],
  ['coreErr.execution.confirmOnlyAtGrantPoint', ChangxiaErrorCode.Validation, '确认凭据只能在授予点（awaiting_review）写入；当前状态为 running，不允许写入确认（execution=ex1）。'],
  ['coreErr.execution.confirmationIncomplete', ChangxiaErrorCode.Validation, '未确认的执行单不得进入 completed 态：要求 confirmation.confirmedAt / confirmedBy / planHash 均非空（execution=ex1）'],
  ['coreErr.execution.planHashMismatch', ChangxiaErrorCode.Validation, '进入 completed 态被拒：确认绑定的计划（planHash=h-bound）与当前执行单的计划（planHash=h-actual）不一致，确认已失效；离开授予点后无法重新确认，此执行单只能取消或失败后新建（execution=ex1）。'],
  ['coreErr.agent.fetchUnavailable', ChangxiaErrorCode.Network, '当前运行环境不提供 fetch，无法访问 Agent 通道。'],
  ['coreErr.agent.timeout', ChangxiaErrorCode.Network, '连接超时（30s）：请检查地址是否可达、服务是否已启动。'],
  ['coreErr.agent.connectFailed', ChangxiaErrorCode.Network, '无法连接到该地址：请检查地址、网络与服务是否已启动。'],
  ['coreErr.agent.baseUrlRequired', ChangxiaErrorCode.Validation, '请先填写 Agent 服务地址。'],
  ['coreErr.agent.badJson', ChangxiaErrorCode.ParseFailed, '服务端返回的不是合法 JSON，无法确认导入结果。'],
  /*
   * ⚠️ 本条是「**兜底句才建键**」的判例：改动前那句 fallback 为
   *   `Agent 通道请求失败（HTTP ${status}${serverCode ? ` · ${serverCode}` : ''}）。`
   * 它同时出现在 5 个状态码分支里（401/400/404/409/其余），而**服务端给了权威 `userMessage` 时不走它**
   * ——那一支按「真因原样透传」处理（不建键、不翻）。故 5 处调用点共用本键，基准取 status=500 + 带码后缀的形态。
   */
  ['coreErr.agent.channelRequestFailed', ChangxiaErrorCode.Storage, 'Agent 通道请求失败（HTTP 500 · server_error）。'],
  ['coreErr.remote.connectFailed', ChangxiaErrorCode.Network, '无法连接到服务器，请检查局域网地址配置。'],
  // 改动前：`let userMessage = \`服务端错误（HTTP ${res.status}）\``；服务端给了 userMessage 时被覆盖（那一支不建键）
  ['coreErr.remote.httpError', ChangxiaErrorCode.Network, '服务端错误（HTTP 500）'],
  ['coreErr.remote.baseUrlRequired', ChangxiaErrorCode.Network, '启用 remote 数据源时必须配置 VITE_API_BASE_URL。'],
  // 两个调用点共用同一键：① `runRescheduleStages` 原文**没有** `.trim()` ② `validateAgentCommand` 原文**有** `.trim()`
  //    ⇒ 两边都把「先拼好的那一截」当 `{detail}` 交进来（判据见 ⑤ 的调用点断言）
  ['coreErr.command.validationFailed', ChangxiaErrorCode.Validation, 'command 校验失败：stages.0 阶段名不能为空'],
];

/** 需要插值的键 → 参数（取值与上面基准表一致；未列出的键一律不传参） */
const PARAMS: Partial<Record<CoreErrorKey, Record<string, string | number>>> = {
  'coreErr.stage.rangeReversed': { name: 'S1' },
  'coreErr.setting.readFailed': { key: 'theme' },
  'coreErr.setting.writeFailed': { key: 'theme' },
  'coreErr.exec.projectNotFound': { projectId: 'p1' },
  'coreErr.exec.notAgentBoard': { projectId: 'p1', kind: 'human' },
  'coreErr.exec.badSource': { source: 'bogus', allowed: 'project-task / natural-language / external / template' },
  'coreErr.exec.eventTargetMissing': { executionId: 'ex1' },
  'coreErr.exec.eventSeqInvalid': { actual: 3, expected: 2, executionId: 'ex1' },
  'coreErr.attempt.badStatus': { status: 'bogus', allowed: 'queued / running / succeeded / failed / cancelled / interrupted' },
  'coreErr.attempt.executionMissing': { executionId: 'ex1' },
  'coreErr.attempt.openAttemptExists': { executionId: 'ex1' },
  'coreErr.attempt.noInvalid': { actual: 3, expected: 2, executionId: 'ex1' },
  'coreErr.writeback.badStatus': { status: 'ghost', allowed: 'draft / proposed / applied / rejected / conflict' },
  'coreErr.writeback.createAsSettled': { status: 'applied' },
  'coreErr.writeback.executionMissing': { executionId: 'ex1' },
  'coreErr.writeback.alreadySettled': { status: 'applied', executionId: 'ex1' },
  'coreErr.writeback.decidedByRequired': { status: 'applied', executionId: 'ex1' },
  'coreErr.split.totalTooShort': { count: 3 },
  'coreErr.split.internalSumMismatch': { sum: 7, totalDays: 9 },
  'coreErr.split.anchorOutOfRange': { orderIndex: 2 },
  'coreErr.split.anchorRunTooShort': { orderIndex: 2 },
  'coreErr.split.tooManyStages': { max: 9, selected: 10 },
  'coreErr.task.transitionNotAllowed': { from: '草稿', to: '已完成' },
  'coreErr.proposal.reasonTooLong': { length: 201 },
  'coreErr.payload.validationFailed': { detail: 'projects.0 不是合法的主板块' },
  'coreErr.takeover.writeVerifyFailed': { title: '任务甲' },
  'coreErr.takeover.stageVerifyFailed': { title: '任务甲' },
  'coreErr.project.tooFewStages': { count: 1 },
  'coreErr.project.tooManyStages': { max: 20, count: 21 },
  'coreErr.project.stageOrderGap': { count: 9 },
  'coreErr.project.duplicateStageNames': { names: '方案、深化' },
  'coreErr.project.domainNotUsable': { domain: 'unknown' },
  'coreErr.project.presetNotFound': { presetKey: 'x_full' },
  'coreErr.backup.domainOffender': { n: 2, id: 'p2', value: 'xyz' },
  'coreErr.backup.domainRejected': { offenders: '第 2 条项目（id=p2）的行业值「xyz」不合法', allowed: 'indoor / landscape', count: 2 },
  'coreErr.backup.schemaInvalid': { detail: 'data.projects Unexpected token' },

  /* ── 段 4 之三：取值必须与上面基准表逐条对应 ── */
  'coreErr.payloadApply.projectIdMismatch': { external: 'q1', payload: 'p1' },
  'coreErr.payloadApply.targetMissing': { projectId: 'p1' },
  'coreErr.payloadApply.targetNotAgent': { projectId: 'p1' },
  'coreErr.execution.badTransition': { from: 'running', to: 'completed' },
  'coreErr.execution.badAttemptTransition': { from: 'queued', to: 'succeeded' },
  // 实参取自本文件 `canComplete()` 的 reason（core 内部中文，登记为待合成项）
  'coreErr.execution.completeRejected': {
    from: 'running',
    to: 'completed',
    reason: '完成要求存在由人工决策（decidedBy 非空）的 applied 写回提案（执行成功不等于业务完成）',
  },
  'coreErr.execution.confirmOnlyAtGrantPoint': {
    grantPoint: 'awaiting_review',
    current: 'running',
    executionId: 'ex1',
  },
  'coreErr.execution.confirmationIncomplete': { next: 'completed', executionId: 'ex1' },
  'coreErr.execution.planHashMismatch': {
    next: 'completed',
    boundHash: 'h-bound',
    actualHash: 'h-actual',
    executionId: 'ex1',
  },
  // `AGENT_HTTP_TIMEOUT_MS / 1000` 是个 number ⇒ 走 `String()` 插值（与 `s` 拼接结果一致）
  'coreErr.agent.timeout': { seconds: 30 },
  'coreErr.agent.channelRequestFailed': { status: 500, suffix: ' · server_error' },
  'coreErr.remote.httpError': { status: 500 },
  'coreErr.command.validationFailed': { detail: 'stages.0 阶段名不能为空' },
};


const CJK = /[㐀-䶿一-鿿]/;

const zhTable = coreZh as Record<string, string>;
const enTable = coreEn as Record<string, string>;

function resetLang(): void {
  setLang('zh');
  try {
    localStorage?.removeItem?.('idplan-lang');
  } catch {
    /* 忽略 */
  }
}

beforeEach(resetLang);
afterEach(resetLang);

/* ══════════════════ ① 三表不漂（键集两两相等 + zh 取值逐字相等） ══════════════════ */

describe('① 三表不漂：载荷表 / 分片 zh / 分片 en', () => {
  it('★ 键集两两相等（载荷表 ⟺ 分片 zh ⟺ 本 spec 的点名表）', () => {
    expect(Object.keys(CORE_ERROR_TEXT).sort(), '载荷表与分片 zh 键集不一致').toEqual(
      Object.keys(zhTable).sort(),
    );
    expect(
      BASELINE.map(([k]) => k).sort(),
      'BASELINE（载荷基准表）漏了键 —— 加了键就必须补一条**改动前的原文**，不许只加键不记基准',
    ).toEqual(Object.keys(CORE_ERROR_TEXT).sort());
  });

  it('★ 分片 zh 键集 === 分片 en 键集（漏一个英文 = 编译错，这里再钉一次运行期）', () => {
    expect(Object.keys(enTable).sort()).toEqual(Object.keys(zhTable).sort());
  });

  it('★ zh 取值逐字相等：载荷表 === 分片 zh', () => {
    for (const key of KEYS) {
      expect(zhTable[key], `${key} 的两处中文不一致`).toBe(CORE_ERROR_TEXT[key]);
    }
  });

  it('★ en 取值非空且不含汉字（英文界面不许漏中文）', () => {
    for (const key of KEYS) {
      expect(enTable[key]?.length ?? 0, `${key} 的英文为空`).toBeGreaterThan(0);
      expect(enTable[key], `${key} 的英文里还有汉字`).not.toMatch(/[\u3400-\u4dbf\u4e00-\u9fff]/);
    }
  });

  it('★ 占位符两侧一致（载荷表有 `{name}` ⇒ 英文也得有，否则插值只生效一半）', () => {
    for (const key of KEYS) {
      const holders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
      expect(holders(enTable[key] ?? ''), `${key} 的占位符两侧不一致`).toEqual(
        holders(CORE_ERROR_TEXT[key]),
      );
    }
  });
});

/* ══════════════════ ② 载荷逐字节不变（基准表，不是重算） ══════════════════ */

describe('② 载荷口径逐字节不变（`userMessage` / `message`）', () => {
  it.each(BASELINE)('★ %s：userMessage 与改动前那句字面量逐字节相等', (key, code, before) => {
    const err = coreError(code, key, PARAMS[key]);
    expect(err.userMessage).toBe(before);
    expect(err.message).toBe(`[changxia:${code}] ${before}`);
    expect(err.code).toBe(code);
    expect(err.messageKey).toBe(key);
  });

  it('★ 不传 params 时占位符**原样保留**（与 `t()` 同口径：漏传变量要看得见）', () => {
    expect(coreErrorText('coreErr.stage.rangeReversed')).toBe('「{name}」起止日期倒置。');
  });

  it('★ 手写 `new ChangxiaError(...)` 仍合法（真因不定型那一支留在 B）', () => {
    const err = new ChangxiaError(ChangxiaErrorCode.ParseFailed, '任意真因。');
    expect(err.userMessage).toBe('任意真因。');
    expect(err.messageKey).toBeUndefined();
    expect(err.params).toBeUndefined();
  });
});

/* ══════════════════ ③ 英文真能取到（这条是防假绿的关键） ══════════════════ */

describe('③ `resolveErrorText` 在两种语言下都给出正确取值', () => {
  it.each(BASELINE)('★ %s：zh 取到与 userMessage 逐字相同的中文；en 取到英文', (key, code, before) => {
    const err = coreError(code, key, PARAMS[key]);

    setLang('zh');
    expect(resolveErrorText(err, t), `${key} 的 zh 取值必须等于 userMessage`).toBe(before);

    setLang('en');
    const english = resolveErrorText(err, t);
    expect(english.length).toBeGreaterThan(0);
    const vars = PARAMS[key];

    /*
     * ★ 渲染结果「不含汉字」这条**只在实参本身不含汉字时**才成立 —— 且判据是**推导出来的**，不是豁免名单。
     *
     * 为什么不能一律断言「渲染结果无汉字」：有两条键的**实参**天生是中文，且**不该**被翻译：
     *   · `coreErr.task.transitionNotAllowed` —— 实参取自 `TASK_STATUS_LABELS`
     *     （core 的中文状态名，同时是打印族 D 的唯一中文出处）；
     *   · `coreErr.payload.validationFailed` —— 实参是 zod 的 `issue.message`（真因）。
     * ⇒ 正解分别是「在 `src/i18n/labels.ts` 侧用 `taskStatusLabel()` 合成整句」（core 外，本片不做）
     *   与「真因原样透传」（**不该翻**）。两者都**登记在案**，见交付文档 §3.4 / §6。
     *
     * 「英文模板本身无汉字」这条**不放松**：由 ①「en 取值非空且不含汉字」逐键钉着（判的是模板）。
     */
    const varsHaveCjk = (vars ?? {}) && Object.values(vars ?? {}).some((v) => CJK.test(String(v)));
    if (!varsHaveCjk) {
      expect(english, `${key} 在英文下仍给中文`).not.toMatch(CJK);
    }
    if (vars === undefined) {
      expect(english).toBe(enTable[key]);
    } else {
      // 有插值：英文取值必须**已被替换**（占位符原样端出去 = 界面露出 `{name}`），
      // 且每个实参都得真的出现在英文里（只断言「没有 {}」会漏掉「传错变量」）
      expect(english, `${key} 的英文里还留着占位符`).not.toMatch(/\{\w+\}/);
      for (const [name, value] of Object.entries(vars)) {
        expect(english, `${key} 的英文里没出现参数 ${name}`).toContain(String(value));
      }
    }
  });

  it('★ 插值参数在英文里真的被替换（不是把 `{name}` 原样端出去）', () => {
    const err = coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.rangeReversed', { name: 'S9' });
    setLang('en');
    expect(resolveErrorText(err, t)).toContain('S9');
    expect(resolveErrorText(err, t)).not.toContain('{name}');
  });
});

/* ══════════════════ ④ 三支口径（团队判据一字不差） ══════════════════ */

describe('④ 三支口径：有码 / 有真因 / 都没有', () => {
  it('① 有机器码 ⇒ 取本地化文案', () => {
    setLang('en');
    expect(resolveErrorText(coreError(ChangxiaErrorCode.NotFound, 'coreErr.member.notFound'), t)).toBe(
      'Member not found.',
    );
  });

  it('② 无机器码但有 userMessage ⇒ **原样透传**（不许拿兜底句盖掉真因）', () => {
    const real = new ChangxiaError(ChangxiaErrorCode.Storage, 'zod: 第 3 条项目行业值不合法');
    expect(resolveErrorText(real, t, '备份导入失败。')).toBe('zod: 第 3 条项目行业值不合法');
  });

  it('③ 都不是 ⇒ 只用 fallback（兜底句只属于「没有真因」的那一支）', () => {
    expect(resolveErrorText(new Error('boom'), t, '兜底句')).toBe('兜底句');
    expect(resolveErrorText(undefined, t, '兜底句')).toBe('兜底句');
    expect(resolveErrorText(new Error('boom'), t)).toBe('');
  });
});

/* ══════════════════ ⑤ 真实调用点确实走了 `coreError`（不是只改了常量） ══════════════════ */

describe('⑤ 真实调用点的 userMessage 与 messageKey（防「机制在、没人用」）', () => {
  /** 只提供被测路径需要的两个方法，其余一律抛（用到即说明测试写错了） */
  function stubDb(over: Record<string, unknown>): unknown {
    return new Proxy(over, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        throw new Error(`stub 未提供 db.${String(prop)}`);
      },
    });
  }

  it('★ LocalStagesRepository.listByProject：读取失败 → 载荷中文不变 + 有机器码', async () => {
    const db = stubDb({
      stages: {
        where: () => ({
          equals: () => ({ toArray: async () => Promise.reject(new Error('boom')) }),
        }),
      },
    });
    const repo = new LocalStagesRepository(db as never);
    await expect(repo.listByProject('p1')).rejects.toMatchObject({
      userMessage: '阶段列表读取失败。',
      messageKey: 'coreErr.stage.listReadFailed',
      code: 'storage',
    });
  });

  it('★ LocalStagesRepository.bulkInsert：起止倒置 → 插值结果与改动前逐字相同', async () => {
    const repo = new LocalStagesRepository(stubDb({}) as never);
    await expect(
      repo.bulkInsert([
        {
          id: 's1',
          projectId: 'p1',
          name: '方案深化',
          startAt: '2026-03-10T00:00:00.000Z',
          endAt: '2026-03-01T00:00:00.000Z',
          orderIndex: 0,
        } as never,
      ]),
    ).rejects.toMatchObject({
      userMessage: '「方案深化」起止日期倒置。',
      messageKey: 'coreErr.stage.rangeReversed',
      params: { name: '方案深化' },
    });
  });

  it('★ LocalStagesRepository.update：未找到 → 复用同一键（同一个词只建一个键）', async () => {
    const repo = new LocalStagesRepository(stubDb({ stages: { get: async () => undefined } }) as never);
    await expect(repo.update('gone', {})).rejects.toMatchObject({
      userMessage: '未找到该阶段。',
      messageKey: 'coreErr.stage.notFound',
    });
  });

  it('★ LocalMembersRepository.insert：姓名为空 → 载荷中文不变 + 有机器码', async () => {
    const repo = new LocalMembersRepository(stubDb({}) as never);
    await expect(repo.insert({ name: '   ' } as never)).rejects.toMatchObject({
      userMessage: '成员姓名不能为空。',
      messageKey: 'coreErr.member.nameRequired',
    });
  });

  it('★ StageService.reschedule：阶段不存在 → 与仓储**共用同一个键**（未找到该阶段。）', async () => {
    const svc = new StageService({
      stages: { get: async () => null },
      logs: {},
    } as never);
    await expect(
      svc.reschedule('gone', { newStartAt: '2026-03-01', newEndAt: '2026-03-02' } as never),
    ).rejects.toMatchObject({
      userMessage: '未找到该阶段。',
      messageKey: 'coreErr.stage.notFound',
    });
  });
});

/* ══════════════════ ⑥ 段 4 之三的真实调用点 ══════════════════ */

describe('⑥ 段 4 之三：五个调用点家族真的走了 `coreError`（不是只加了键）', () => {
  it('★ payload.apply.resolveAgentProjectId：query 与 payload 不一致 → 插值结果逐字不变', () => {
    let caught: unknown;
    try {
      resolveAgentProjectId({ payloadProjectId: 'p1', externalProjectId: 'q1' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({
      userMessage: 'query 与 payload 的 projectId 不一致（外部指定=q1 / payload=p1），系统拒绝猜测落点，未写入任何数据。',
      messageKey: 'coreErr.payloadApply.projectIdMismatch',
      params: { external: 'q1', payload: 'p1' },
      code: 'validation',
    });
  });

  it('★ execution-state：邻接表拒绝 → 两种转移各用自己的键（措辞不同 ⇒ 不许合并成一个键）', () => {
    let caught: unknown;
    try {
      assertTransition('completed' as never, 'running' as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({
      userMessage: '非法的执行状态转移：completed → running',
      messageKey: 'coreErr.execution.badTransition',
    });

    let caught2: unknown;
    try {
      assertAttemptTransition('succeeded' as never, 'queued' as never);
    } catch (e) {
      caught2 = e;
    }
    expect(caught2).toMatchObject({
      userMessage: '非法的执行尝试状态转移：succeeded → queued',
      messageKey: 'coreErr.execution.badAttemptTransition',
    });
  });

  it('★ execution-state.assertStatusTransition：completed 缺 applied 提案 → 带上 canComplete 的真因', () => {
    let caught: unknown;
    try {
      assertStatusTransition({ id: 'ex1', status: 'awaiting_review' as never }, 'completed' as never, []);
    } catch (e) {
      caught = e;
    }
    const err = caught as ChangxiaError;
    expect(err.messageKey).toBe('coreErr.execution.completeRejected');
    expect(err.params).toMatchObject({ from: 'awaiting_review', to: 'completed' });
    // ⚠️ `reason` 是 core 内部中文（登记为待 `labels.ts` 合成的残留项）——这句故意透传
    expect(String((err.params as { reason: string }).reason)).toContain('写回提案');
    expect(err.userMessage).toBe(`非法的执行状态转移：awaiting_review → completed（${(err.params as { reason: string }).reason}）`);
  });

  it('★ execution-state.assertExecutionConfirmed：三处门槛各自的键（授予点 / 字段非空 / 计划绑定）', () => {
    const at = (fn: () => void): ChangxiaError => {
      try {
        fn();
      } catch (e) {
        return e as ChangxiaError;
      }
      throw new Error('本该抛错却没有抛');
    };

    // ① 授予点之外写入确认对象
    const a = at(() =>
      assertExecutionConfirmed(
        { id: 'ex1', status: 'running' } as never,
        'queued' as never,
        { confirmationWrittenByCaller: true },
      ),
    );
    expect(a).toMatchObject({
      messageKey: 'coreErr.execution.confirmOnlyAtGrantPoint',
      params: { grantPoint: 'awaiting_confirmation', current: 'running', executionId: 'ex1' },
    });
    expect(a.userMessage).toBe(
      '确认凭据只能在授予点（awaiting_confirmation）写入；当前状态为 running，不允许写入确认（execution=ex1）。',
    );

    // ② 字段非空（无 confirmation）
    const b = at(() =>
      assertExecutionConfirmed(
        { id: 'ex1', status: 'awaiting_confirmation' } as never,
        'queued' as never,
        { confirmationWrittenByCaller: false },
      ),
    );
    expect(b).toMatchObject({
      messageKey: 'coreErr.execution.confirmationIncomplete',
      params: { next: 'queued', executionId: 'ex1' },
    });

    // ③ 计划绑定：planHash 对不上（`actualHash` 由本函数重算，故只钉「两值不同且都出现在句子里」）
    const c = at(() =>
      assertExecutionConfirmed(
        {
          id: 'ex1',
          status: 'awaiting_confirmation',
          confirmation: { confirmedAt: '2026-03-01T00:00:00.000Z', confirmedBy: 'alice', planHash: 'h-bound' },
        } as never,
        'queued' as never,
        { confirmationWrittenByCaller: false },
      ),
    );
    const cp = c.params as { boundHash: string; actualHash: string };
    expect(c.messageKey).toBe('coreErr.execution.planHashMismatch');
    expect(cp.boundHash).toBe('h-bound');
    expect(cp.actualHash).not.toBe('h-bound');
    expect(c.userMessage).toContain('planHash=h-bound');
    expect(c.userMessage).toContain(`planHash=${cp.actualHash}`);
  });

  it('★ transport.mapHttpError：**兜底句才建键**，服务端 authoritative userMessage 原样透传（不建键）', () => {
    // ① 服务端没给 userMessage ⇒ 走本仓兜底句（有机器码，会随语言切换）
    expect(mapHttpError(500, null)).toMatchObject({
      userMessage: 'Agent 通道请求失败（HTTP 500）。',
      messageKey: 'coreErr.agent.channelRequestFailed',
      params: { status: 500, suffix: '' },
      code: 'storage',
    });
    expect(mapHttpError(401, null)).toMatchObject({
      userMessage: 'Agent 通道请求失败（HTTP 401）。',
      code: 'validation',
    });
    // 带服务端 `code` ⇒ 后缀进插值（` · <code>`）
    expect(mapHttpError(409, { error: { code: 'conflict' } })).toMatchObject({
      userMessage: 'Agent 通道请求失败（HTTP 409 · conflict）。',
      params: { status: 409, suffix: ' · conflict' },
      code: 'conflict',
    });

    // ② 服务端给了权威 userMessage ⇒ **原样透传**，且**不许**挂机器码
    //    （挂了就意味着这句话会被翻译，而它是对方的程序写的真因）
    expect(mapHttpError(500, { error: { code: 'network', userMessage: '服务端说的真因' } })).toMatchObject({
      userMessage: '服务端说的真因',
      code: 'storage',
    });
    expect(mapHttpError(500, { error: { userMessage: '服务端说的真因' } }).messageKey).toBeUndefined();
  });

  it('★ transport.importTasks 前置校验：地址为空 → 有机器码（不发请求）', async () => {
    await expect(importTasks('', 'tk', { tasks: [] })).rejects.toMatchObject({
      userMessage: '请先填写 Agent 服务地址。',
      messageKey: 'coreErr.agent.baseUrlRequired',
      code: 'validation',
    });
  });

  it('★ commands：两个校验点共用同一个键，`{detail}` = 改动前那句 `${path} ${message}`', async () => {
    /*
     * ⚠️ 两处调用点在源码上**不同**：`runRescheduleStages` 原文没有 `.trim()`，
     * `validateAgentCommand` 原文有 `.trim()`。但本 schema 能触达的 zod 报错里
     * `issue.message` 恒非空、`path` 不带空白 ⇒ 两种写法**渲染结果不可区分**，
     * 故这里只能钉「文案与参数」，trim 差异靠源码逐字保留（不是靠测试）。
     */
    const expectDetail = 'shiftDays Required';
    expect(() => validateAgentCommand({ command: 'reschedule_stages' })).toThrowError(
      expect.objectContaining({
        userMessage: `command 校验失败：${expectDetail}`,
        messageKey: 'coreErr.command.validationFailed',
        params: { detail: expectDetail },
        code: 'validation',
      }),
    );
    // ① 直接调用执行器（绕过 validateAgentCommand 的那道复验）走的是同一键
    await expect(
      runRescheduleStages({} as never, { command: 'reschedule_stages' } as never),
    ).rejects.toMatchObject({
      userMessage: `command 校验失败：${expectDetail}`,
      messageKey: 'coreErr.command.validationFailed',
      params: { detail: expectDetail },
    });
  });

  it('★ rest.client.createRemoteRepositories：未配 baseUrl → 有机器码 + 载荷中文不变', () => {
    expect(() => createRemoteRepositories('')).toThrowError(
      expect.objectContaining({
        userMessage: '启用 remote 数据源时必须配置 VITE_API_BASE_URL。',
        messageKey: 'coreErr.remote.baseUrlRequired',
        code: 'network',
      }),
    );
  });
});
