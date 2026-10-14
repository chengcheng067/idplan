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
} as const;
