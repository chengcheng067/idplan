/**
 * 服务端用户面文案的**载荷中文表** + 错误体构造器（英文补齐批 · server 片）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这份文件是什么（以及为什么服务端要自己持有一张中文表）
 * ══════════════════════════════════════════════════════════════════════
 * 服务端**没有「当前语言」的概念**（HTTP 请求不带应用语言；浏览器自带的
 * `Accept-Language` 是**浏览器界面语言**，不是「设置 → 外观 → 语言」的设置值，
 * 拿它当语言源会在「中文浏览器 + 英文界面」这个**目标组合**上静默给错语言）。
 * 所以本片采取与 `src/core/types/core-error-text.ts` 同族的范式（下称**甲案**）：
 *
 *   服务端只回 **机器码（messageKey）+ 参数（params）**，渲染层取词；
 *   `userMessage` **逐字节不动** —— 它是回给**外部 Agent** 的协议字段
 *   （`src/core/agent/transport.http.ts` 钉着「服务端权威 userMessage 原样透传」），
 *   改一个字节都是契约变更。
 *
 * 于是同一个句子有两个物理位置，与 core 片**同构**：
 *   · 本表 = **载荷口径**（`userMessage` 的渲染输入；逐字节等于改动前源码里的字面量）；
 *   · `src/i18n/messages/**` = **界面口径**（英文在这里，唯一出处）。
 *   两侧键集/取值的相等由 `tests/server-error-i18n.spec.ts` 断言（与
 *   `tests/core-error-i18n.spec.ts` 同款纪律）—— 改任一侧都会红。
 *
 * ⚠️ **为什么英文不在本文件里**（这不是遗漏，是刻意的）：
 *   服务端养一份英文表 = 英文的**第二个出处**，与 `src/i18n` 必然漂移
 *   （本仓判据：同一个事实不许有两个出处）。且 `src/core/**` 不许 import i18n
 *   （`lang.ts` 引用 `document` ⇒ 服务端 tsc 报 TS2584）—— 服务端**取不到**界面词，
 *   也不该取。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 契约变更是**纯增量**（老客户端不受影响）
 * ══════════════════════════════════════════════════════════════════════
 * REST 错误体从 `{error:{code,userMessage}}` 扩为
 * `{error:{code,userMessage,messageKey?,params?}}`。两个新字段**可选**：
 *   · 老客户端（含当前前端 `rest.client.ts`）按形状只读 `code`/`userMessage` ⇒ 行为零变化；
 *   · 外部 Agent 只读 `userMessage` ⇒ 协议字段逐字节不动；
 *   · 新前端（待 team-lead 放行 `src/**` 小改）见 `messageKey` 即走
 *     `coreError(mappedCode, messageKey, params)` ⇒ `resolveErrorText` 取英文。
 * ⇒ **在本批 `src/**` 改动落地前，本文件的全部产出对界面是 inert 的**（安全垫）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 键名约定
 * ══════════════════════════════════════════════════════════════════════
 * `serverErr.<面>.<做什么>`。与 `coreErr.*`（`CORE_ERROR_TEXT`）**分工**：
 *   · 句子与 core 表**逐字节相同** ⇒ **复用 coreErr.* 键**（不建新键；
 *     判据同 core 片「同一个词只建一个键」——按**取值** grep 全表后再建）；
 *   · 服务端自有句子（路由层的字段校验文案等）⇒ `serverErr.*`。
 * 两族键在 `errorBody()` 里统一承接：`coreErr.*` 转发 `coreErrorText()`，
 * `serverErr.*` 查本表。前端 `t()` 对两族一视同仁（键集进同一张消息表）。
 */

import { ChangxiaError, ChangxiaErrorCode, coreError } from '../../src/core/types/enums';
import {
  coreErrorText,
  isCoreErrorKey,
  type CoreErrorKey,
  type CoreErrorParams,
} from '../../src/core/types/core-error-text';

/* ══════════════════════════════ 载荷表 ══════════════════════════════ */

/**
 * 键 → 中文模板。取值纪律与 `CORE_ERROR_TEXT` **一字不差**：
 * **逐字节等于改动前源码里那句字面量**（含标点、含全角括号、含句子里的 `**` 强调）。
 * 原本是模板串 / 多段相加的，在这里写成 `{name}` 占位，渲染结果与原文一字不差
 * （基准值手抄在 `tests/server-error-i18n.spec.ts` 的 BASELINE 表里，不是运行时重算）。
 */
export const SERVER_ERROR_TEXT = {
  /* ── 全局错误处理器 ── */
  'serverErr.internal': '服务器内部错误',

  /* ── Agent 导入通道（routes/agent.routes.ts · import 段） ── */
  'serverErr.agent.tooLarge': '导入内容过大，请拆分后分批同步。',
  'serverErr.agent.stageNameBlank':
    'query 参数 stageName 出现但值为空/仅空白；显式声明落点阶段名时不能给空名称（系统不会把它当作「未声明」）。',
  'serverErr.agent.createStageIfMissingBlank':
    'query 参数 createStageIfMissing 出现但值为空/仅空白；显式声明落点阶段名时不能给空名称（系统不会把它当作「未声明」）。',
  'serverErr.agent.stageNameAliasMismatch':
    'query 参数 stageName 与 createStageIfMissing 同传但取值不同：两者是同义别名，取值必须一致。',
  'serverErr.agent.stageNameStageIdExclusive':
    '落点阶段名与 stageId 互斥（{where} 与落点名同传）：语义重叠说明调用方对落点不确定，系统报错而不是猜测。',
  'serverErr.agent.projectNameNotFound': '未找到名为「{name}」的项目，请先在 ID Plan 中确认项目名称。',
  'serverErr.agent.projectUnspecified':
    '未指定目标项目（body.projectId / ?projectId / ?projectName 均为空），无法导入。',

  /* ── 自然语言通道（routes/agent.routes.ts · nl-execute 段 + lib/nl-llm.ts） ── */
  'serverErr.agent.nlNotConfigured':
    '自然语言通道未配置（fail-closed）：请在服务端设置 IDPLAN_NL_LLM_BASE_URL / ' +
    'IDPLAN_NL_LLM_API_KEY / IDPLAN_NL_LLM_MODEL 三个环境变量（OpenAI 兼容端点，' +
    '可指向你自己的 Ollama），重启后生效。未配置时本通道不可用——这是安全设计，不是故障。',
  'serverErr.agent.nlTextRequired': '请提供自然语言文本（body.text，非空）。',
  'serverErr.agent.nlTextTooLong':
    '自然语言文本超长（> {max} 字）：请只说这一条排期调整，别把整份合同粘进来。',
  'serverErr.agent.nlParseFailed': 'LLM 解析失败（未进入执行链）。',
  'serverErr.agent.nlShapeUnknown': 'LLM 输出形状不符',
  // ⚠️ `{detail}` 是 `validateAgentCommand` 透出的真因（core 内部中文，同
  //    `coreErr.command.validationFailed` 的 `{detail}` 支）—— 英文渲染时它仍为中文，
  //    与 core 片 `completeRejected` 的 `{reason}` 同族，**登记在案**（见 spec 的豁免推导）。
  'serverErr.agent.nlShapeRejected': '{detail}（原始输出：{raw}）',
  'serverErr.agent.nlProjectUnresolved':
    '没能从这句话里解析出目标项目：请带上项目名或项目 id（Agent 看板）再说一次。',
  'serverErr.nl.llmHttp': 'LLM 服务返回 {status}',
  'serverErr.nl.badJson': 'LLM 输出不是合法 JSON（已被拒绝，未进入执行链）',

  /* ── Agent 看板读取 / 建板（routes/agent.routes.ts） ── */
  'serverErr.agent.projectNotAgentBoard': '目标项目（id={projectId}）不是 Agent 看板，Agent 通道读不到它的任务。',
  'serverErr.agent.taskListReadFailed': '读取任务清单失败（HTTP {status}）：{body}',
  'serverErr.agent.boardNoTargetParams':
    '建板通道**只新建**看板，不接受 projectId / projectName（那是导入通道的落点解析参数）。' +
    '要往已有项目写任务，请用 POST /api/agent/import。',
  'serverErr.agent.boardNameRequired':
    '建板必须显式声明看板名称（body.name 缺失 / 为空 / 仅空白）：系统不会替你取一个默认名字。',
  'serverErr.agent.boardStartRequired':
    '建板必须显式声明计划开始日期（body.plannedStartAt 缺失 / 为空 / 仅空白）。' +
    '系统**不会替你猜一个日期**：默认日期会静默造出一条错误的排期，' +
    '而错误的排期比一条明确的报错危险得多。',
  'serverErr.agent.boardEndRequired':
    '建板必须显式声明计划结束日期（body.plannedEndAt 缺失 / 为空 / 仅空白）。' +
    '系统**不会替你猜一个日期**（同 plannedStartAt）。',
  'serverErr.agent.boardPresetKeyBlank':
    'body.presetKey 出现但值为空/仅空白；不指定套餐时请**完全不要传**该参数' +
    '（系统不会把它当作「没给」，因为那会把调用方的 bug 掩盖成「用了另一个阶段来源」）。',
  'serverErr.agent.boardStageNamesNotArray': 'body.stageNames 必须是字符串数组（显式声明的阶段名列表）。',
  'serverErr.agent.boardStageNamesBlankEntry':
    'body.stageNames 里出现空/仅空白/非字符串的条目：显式声明阶段名时不能给空名称' +
    '（系统不会把它当作「没声明过这个阶段」）。',
  'serverErr.agent.boardStagesRequired':
    '建板必须显式声明阶段集合：body.presetKey（内置套餐）或 body.stageNames（阶段名数组）' +
    '至少要给一个（两者可以同时给：先展开套餐骨架，再追加声明的名字）。',
  'serverErr.agent.boardPresetNotFound':
    '未找到 key 为「{presetKey}」的阶段套餐（阶段库只认 templates/stage-library.json 里的套餐 key）。',
  'serverErr.agent.boardNoStages': '建板请求展开后没有任何阶段：阶段集合不能是空的。',
  'serverErr.agent.boardTooManyStages': '单次建板最多 {max} 个阶段，本次展开后为 {actual} 个。',
  'serverErr.agent.boardCreateFailed': '建板失败：创建项目时被既有端点拒绝（HTTP {status}）：{body}',

  /* ── 服务端 bundle（adapters/sqlite.bundle.ts） ── */
  'serverErr.bundle.notImplemented':
    '[not-implemented] sqlite.bundle 未实现 {what}：本适配器只覆盖 payload.apply 调用到的方法（§3.7）。',
  // ⚠️ `{body}` 是被委托端点的响应原文（可能又带一层中文 userMessage）——同族登记豁免。
  'serverErr.bundle.delegateFailed': '[sqlite.bundle] 委托 {method} {url} 失败（HTTP {statusCode}）：{body}',
  'serverErr.bundle.stageIdRequired':
    '[sqlite.bundle] stages.bulkInsert 的行必须自带非空 id（自动建阶段侧用 crypto.randomUUID() 生成）。',
  'serverErr.exec.dataWriteFailed': '执行域数据写入失败。',

  /* ── 鉴权（lib/agent-auth.ts 两条 401） ── */
  'serverErr.auth.backupTokenRequired':
    '备份通道需要鉴权：请在服务端配置 IDPLAN_AGENT_TOKEN，并在请求头携带 X-Agent-Token。',
  'serverErr.auth.agentTokenRequired':
    'Agent 通道需要鉴权：请在服务端配置 {env}，并在请求头携带 X-Agent-Token（或 Authorization: Bearer）。',

  /* ── 主板块值域门（lib/project-domain.ts + routes/meta.routes.ts 备份导入） ── */
  // ⚠️ `{prefix}` 现存调用方全传空串（备份导入那条不走本函数、走 backup.domainRejected）；
  //    保留它是为了不动 `projectDomainRejection()` 的既有签名（零回归）。
  'serverErr.project.domainRejected':
    '{prefix}主板块 domain 只接受 {allowed}（共 {count} 个），或显式 null（= 清除，回到读时回落）；收到「{value}」。',
  // ⚠️ `{offenders}` = `describeDomainOffenders()` 的输出（中文定位串：第几条 / id / 值），
  //    与 core 表 `coreErr.backup.domainRejected` 的 `{offenders}` 完全同族 —— 那一侧
  //    早已登记为「实参自带汉字」的豁免（见 core-error-i18n.spec.ts ③ 的推导）。
  'serverErr.backup.domainRejected':
    '备份导入被拒绝（库未做任何改动）。{offenders}。主板块 domain 只接受 {allowed}（共 {count} 个），或显式 null（= 清除，回到读时回落）。',

  /* ── 项目（routes/projects.routes.ts） ── */
  'serverErr.project.notFound': '项目不存在',
  'serverErr.project.notFoundOrDeleted': '项目不存在或已删除',
  'serverErr.project.nameRequired': '项目名称不能为空',
  'serverErr.project.badKindCreate':
    '归属侧 kind 只接受 \'human\' / \'agent\' 两个取值，收到「{value}」。（归属侧是隔离谓词的判据，脏值会让前端与服务端对同一条项目判断不一致：前端按人类侧显示它，服务端候选清单却把它排除。）',
  'serverErr.project.badKindPatch':
    '归属侧 kind 只接受 \'human\' / \'agent\' 两个取值，收到「{value}」。（现状是原样透传，会把脏值写进库 —— 归属侧是隔离谓词的判据，脏值等于把数据放进一个谁也看不见的桶。）',
  'serverErr.project.takeoverRequired':
    '变更项目归属侧（kind）属于「接管」动作，必须显式声明接管意图（body.takeover === true）。' +
    '本服务端当前**没有角色模型**，因此这道门校验的是「显式意图」而不是「请求者身份」——' +
    '它能挡住误操作（顺手带上 kind 的字段级更新），但挡不住本来就拥有本机文件访问权的调用方。',
  'serverErr.project.startAfterEnd': '项目计划开始日期不能晚于结束日期。',

  /* ── 阶段（routes/stages.routes.ts） ── */
  'serverErr.stage.notFound': '阶段不存在',
  'serverErr.stage.endBeforeStart': '截止日早于开始日，已拒绝保存',

  /* ── 任务（routes/tasks.routes.ts） ── */
  'serverErr.task.rowProjectIdRequired': '任务行缺少 projectId，无法确定幂等键的项目作用域。',
  'serverErr.task.notFound': '任务不存在',
  'serverErr.task.titleRequired': '任务标题不能为空',

  /* ── 成员（routes/members.routes.ts） ── */
  'serverErr.member.notFound': '成员不存在',
  'serverErr.member.nameRequired': '成员姓名不能为空',
  'serverErr.member.badPassword': '密码错误',

  /* ── 每日行程（routes/itineraries.routes.ts） ── */
  'serverErr.itinerary.badDate': '每日行程日期必须是 YYYY-MM-DD。',
  'serverErr.itinerary.badAmount': '预算和实际金额必须是有效数字或空值。',
  'serverErr.itinerary.duplicateDate': '该日期已有每日行程卡。',

  /* ── 合同（routes/meta.routes.ts） ── */
  'serverErr.contract.notFound': '合同记录不存在',

  /* ── 执行域入参形状（routes/executions.routes.ts · ShapeError 族） ── */
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

/** 本表的插值参数（与 `CoreErrorParams` 同形） */
export type ServerErrorParams = Record<string, string | number>;

/** 服务端自有文案键 */
export type ServerErrorKey = keyof typeof SERVER_ERROR_TEXT;

/**
 * 错误体可携带的取词键 = 两族之和。
 * `coreErr.*`（复用 core 载荷表的句子）与 `serverErr.*`（本表）在前端同一张消息表里。
 */
export type ServerMessageKey = ServerErrorKey | CoreErrorKey;

/* ══════════════════════════════ 渲染器 ══════════════════════════════ */

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * 模板渲染：缺变量时**原样保留** `{name}`（与 `coreErrorText()` / `t()` 同口径 ——
 * 漏传变量要一眼看得见，而不是渲染成 `undefined` 混进协议字段）。
 */
function render(template: string, params?: ServerErrorParams): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** 渲染**载荷中文**（= 改动前源码里那句字面量） */
export function serverErrorText(key: ServerErrorKey, params?: ServerErrorParams): string {
  return render(SERVER_ERROR_TEXT[key], params);
}

/** 两族键统一取词（`errorBody` 内部用；调用方一般不需要） */
export function serverMessageText(key: ServerMessageKey, params?: ServerErrorParams): string {
  return isCoreErrorKey(key)
    ? coreErrorText(key, params as CoreErrorParams | undefined)
    : serverErrorText(key, params);
}

/* ══════════════════════════════ 错误体构造器 ══════════════════════════════ */

/** REST 错误体（`{error:{code,userMessage}}` + 两个可选增量字段） */
export interface ServerErrorBody {
  error: {
    code: string;
    userMessage: string;
    messageKey?: ServerMessageKey;
    params?: ServerErrorParams;
  };
}

/**
 * 机器码 + 载荷中文 + 取词键，**三件一套**出错误体。
 *
 * `userMessage` 由**表**渲染（不是调用点手抄字面量）⇒ 不存在「两处各抄一遍」的漂移面；
 * 逐字节不变由 `tests/server-error-i18n.spec.ts` 的 BASELINE 表钉着。
 */
export function errorBody(
  code: string,
  key: ServerMessageKey,
  params?: ServerErrorParams,
): ServerErrorBody {
  return {
    error: {
      code,
      userMessage: serverMessageText(key, params),
      messageKey: key,
      ...(params !== undefined ? { params } : {}),
    },
  };
}

/* ══════════════════════════════ 抛出侧携带者 ══════════════════════════════ */

/**
 * 服务端自有文案的**抛出携带者**。
 *
 * 为什么需要它：`ChangxiaError.messageKey` 的类型是 `CoreErrorKey`（core 载荷表的键），
 * **装不下** `serverErr.*`。而为四句服务端自有抛出错（bundle 的 not-implemented /
 * 委托失败 / 阶段 id 缺失 / 执行域写入失败）去改 `enums.ts` 属于 `src/**` 改动
 * （本批不放行）⇒ 用继承：`userMessage` 仍由本表渲染（逐字节不变），键挂在
 * `serverKey` 上，由 `messageKeyFieldsOf()` 统一取出。
 *
 * 它**是** `ChangxiaError`（extends）⇒ 所有 `instanceof ChangxiaError` 检查照旧成立。
 */
export class ServerTextError extends ChangxiaError {
  public readonly serverKey: ServerErrorKey;
  public readonly serverParams?: ServerErrorParams;

  public constructor(
    code: ChangxiaErrorCode,
    key: ServerErrorKey,
    params?: ServerErrorParams,
    cause?: unknown,
  ) {
    super(code, serverErrorText(key, params), cause);
    this.serverKey = key;
    this.serverParams = params;
  }
}

/**
 * 从任意抛出处取「取词键 + 参数」；**没有键 ⇒ undefined**（真因透传，不建键）。
 *
 * 两族来源都认：`ChangxiaError`（core 侧 `coreError()` 挂了 `messageKey`）与
 * `ServerTextError`（本文件的 `serverKey`）。
 */
export function messageKeyFieldsOf(
  err: unknown,
): { messageKey: ServerMessageKey; params?: ServerErrorParams } | undefined {
  if (err instanceof ServerTextError) {
    return {
      messageKey: err.serverKey,
      ...(err.serverParams !== undefined ? { params: err.serverParams } : {}),
    };
  }
  const e = err as { messageKey?: ServerMessageKey; params?: ServerErrorParams } | null;
  if (e !== null && e !== undefined && e.messageKey !== undefined) {
    return {
      messageKey: e.messageKey,
      ...(e.params !== undefined ? { params: e.params } : {}),
    };
  }
  return undefined;
}

/* ══════════════════════════════ 错误处理器三支口径 ══════════════════════════════ */

/**
 * 全局 / scope 错误处理器的错误体。三支口径与 core 的 `resolveErrorText` **同构**：
 *   ① 抛出处带了取词键 ⇒ `userMessage` + `messageKey` + `params` 三件齐出（前端可本地化）；
 *   ② 没键但有 `userMessage` ⇒ **原样透传**（真因支，不建键 —— 拿兜底句盖住真因
 *      是本仓明令禁止的，见 `core-error-i18n.spec.ts` ④）；
 *   ③ 都没有 ⇒ 兜底句，**只有这一支建键**（`fallbackKey`）。
 *
 * `withMessageFallback`：`agent.routes.ts` 的 scope 处理器历史行为是 ② 之后再退
 * `err.message`（委托失败的真因只有那里看得到），`index.ts` 不退。两个处理器各按
 * 原样走，**不做「统一」**（统一 = 改行为）。
 */
export function errorBodyFrom(
  err: unknown,
  fallbackKey: ServerErrorKey,
  withMessageFallback = false,
): ServerErrorBody {
  const e = err as { code?: string; userMessage?: string; message?: string };
  const code = String(e?.code ?? 'internal');
  if (e?.userMessage !== undefined) {
    return { error: { code, userMessage: e.userMessage, ...messageKeyFieldsOf(err) } };
  }
  if (withMessageFallback && e?.message) {
    return { error: { code, userMessage: e.message } };
  }
  return errorBody(code, fallbackKey);
}

/* ══════════════════════════════ 再导出（少一个 import 面） ══════════════════════════════ */

/**
 * `coreError` 再导出：bundle 的 18 处「句子与 core 表逐字节相同」的抛出错改用
 * `coreError(code, 'coreErr.*', params, cause)`（键挂上去、载荷不变），调用点
 * 不必同时 import 两个模块。
 */
export { coreError, ChangxiaErrorCode };
