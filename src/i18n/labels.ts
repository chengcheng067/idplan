/**
 * 枚举值 → 文案键的映射表 + 取词小函数。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么不把值直接搬进 messages、把 enums 的表改成 key（本批的取舍）
 * ══════════════════════════════════════════════════════════════════════
 * `src/core/types/enums.ts` 那五张标签表**本批保留中文值**，改成在 React 层
 * 用本文件的键表取词。三条硬约束决定了这个形态：
 *   ① 消费方里有 `src/print/**`（7 个文件，打印是**后批**）与共享内核
 *      `src/core/services/task.service.ts`、`src/lib/restPolicyRecalc.ts`；
 *   ② `tests/workdays.rest-policy.spec.ts:447-449 / :479-480` 直接断言那五张表的
 *      中文值，`tests/print-selector-modules.spec.tsx:1133` 断言经典模板名含「经」
 *      ——把值换成 key 会当场撞红三条**不属本批**的 spec；
 *   ③ `enums.ts` 在 `tests/arch-boundary.spec.ts` 的共享内核约束面内
 *      （`src/core/types/**` 禁 window / document / localStorage）
 *      ⇒ 它不可能自己读语言状态，也不该 import 渲染层。
 * ⇒ 中文一致性改由 `tests/i18n.spec.ts` 逐键对照 `enums.ts` 锁死（防漂移）。
 *
 * ⚠️ 用法纪律：这些函数**不是** React hook，不订阅语言变化。
 *    渲染期调用它们的组件**必须**同时调 `useLang()`（订阅 + 拿 `t`），
 *    否则切语言时该组件不会重渲染。见 `src/i18n/useLang.ts` 的纪律 ②。
 */
import {
  MemberActorKind,
  MemberRoleKind,
  RestPolicyKind,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../core/types/enums';
import type { ProjectCalendarStatus } from '../core/types/enums';
/*
 * Agent 术语表的**类型**仍出自 `constants/agentTerms.ts`（那里是这套术语的规格出处）。
 * ⚠️ 必须是 `import type`：类型导入会被擦除 ⇒ 运行期 i18n 不依赖 constants，
 *    而 constants 侧**一个 i18n 字符都不出现**（它进服务端 tsconfig 的 include 白名单，
 *    而那份配置无 DOM —— 理由见下方 Agent 术语表区块）。
 */
import type { AgentTermKey, AgentTermMode } from '../constants/agentTerms';
/*
 * 行业库错误的**结构化位置**与**机器码**（分界表 裁 3 / 裁 4）从 core 取。
 * 方向是 `i18n → core`：**反向禁止**（`src/core/**` 不许 import i18n —— 会把 `lang.ts` 的
 * `document` 拖进无 DOM 的服务端 program），故人话只能在**这里**拼，core 只交结构。
 */
import {
  customLibraryPathLocation,
  type CustomLibraryListKind,
  type CustomLibraryPathLocation,
} from '../core/template/custom-library.prompt';
import type {
  CustomLibraryIssue,
  CustomLibraryIssueCode,
} from '../core/template/custom-library.schema';
import { t, type InterpolationVars } from './translate';
import type { Lang } from './lang';
import type { MessageKey } from './messages/zh';

/* ──────────────────────── 休息制度（REST_POLICY_LABELS） ──────────────────────── */

export const REST_POLICY_KEYS: Record<RestPolicyKind, MessageKey> = {
  [RestPolicyKind.DoubleOff]: 'restPolicy.doubleOff',
  [RestPolicyKind.SingleOff]: 'restPolicy.singleOff',
  [RestPolicyKind.BigSmallWeek]: 'restPolicy.bigSmallWeek',
};

export function restPolicyLabel(kind: RestPolicyKind): string {
  return t(REST_POLICY_KEYS[kind]);
}

/* ─────────────────────── 排期基准（SCHEDULE_BASIS_LABELS） ─────────────────────── */

export const SCHEDULE_BASIS_KEYS: Record<ScheduleBasis, MessageKey> = {
  [ScheduleBasis.Calendar]: 'scheduleBasis.calendar',
  [ScheduleBasis.Workday]: 'scheduleBasis.workday',
};

export function scheduleBasisLabel(basis: ScheduleBasis): string {
  return t(SCHEDULE_BASIS_KEYS[basis]);
}

/* ─────────────────────── 成员角色（MEMBER_ROLE_LABELS） ─────────────────────── */

export const MEMBER_ROLE_KEYS: Record<MemberRoleKind, MessageKey> = {
  [MemberRoleKind.Admin]: 'memberRole.admin',
  [MemberRoleKind.Member]: 'memberRole.member',
};

export function memberRoleLabel(role: MemberRoleKind): string {
  return t(MEMBER_ROLE_KEYS[role]);
}

/* ──────────────────── 行为体种类（MEMBER_ACTOR_KIND_LABELS） ──────────────────── */

export const MEMBER_ACTOR_KIND_KEYS: Record<MemberActorKind, MessageKey> = {
  [MemberActorKind.Human]: 'memberActorKind.human',
  [MemberActorKind.Agent]: 'memberActorKind.agent',
};

export function memberActorKindLabel(kind: MemberActorKind): string {
  return t(MEMBER_ACTOR_KIND_KEYS[kind]);
}

/* ────────────────────────── 任务七态（TASK_STATUS_LABELS） ────────────────────────── */

export const TASK_STATUS_KEYS: Record<TaskStatus, MessageKey> = {
  [TaskStatus.Draft]: 'taskStatus.draft',
  [TaskStatus.Ready]: 'taskStatus.ready',
  [TaskStatus.Claimed]: 'taskStatus.claimed',
  [TaskStatus.InProgress]: 'taskStatus.inProgress',
  [TaskStatus.Blocked]: 'taskStatus.blocked',
  [TaskStatus.Review]: 'taskStatus.review',
  [TaskStatus.Done]: 'taskStatus.done',
};

export function taskStatusLabel(status: TaskStatus): string {
  return t(TASK_STATUS_KEYS[status]);
}

/* ─────────────────────── 阶段四态（重算弹窗的 STATUS_LABELS） ─────────────────────── */

export const STAGE_STATUS_KEYS: Record<StageStatus, MessageKey> = {
  [StageStatus.NotStarted]: 'stageStatus.notStarted',
  [StageStatus.InProgress]: 'stageStatus.inProgress',
  [StageStatus.Completed]: 'stageStatus.completed',
  [StageStatus.Delayed]: 'stageStatus.delayed',
};

export function stageStatusLabel(status: StageStatus): string {
  return t(STAGE_STATUS_KEYS[status]);
}

/* ─────────────────── 月历筛选四态（calendarMath 的 STATUS_LABELS） ─────────────────── */

export const CALENDAR_STATUS_KEYS: Record<ProjectCalendarStatus, MessageKey> = {
  in_progress: 'calendarStatus.inProgress',
  completed: 'calendarStatus.completed',
  overdue: 'calendarStatus.overdue',
  not_started: 'calendarStatus.notStarted',
};

export function calendarStatusLabel(status: ProjectCalendarStatus): string {
  return t(CALENDAR_STATUS_KEYS[status]);
}

/* ═══════════ 中国法定节假日名（内置表 cn-20xx.json 的 8 个去重取值） ═══════════
 *
 * ── 为什么是一张**表**而不是把键写进 JSON ──
 * 节日名住在 `src/core/holidays/cn-2025.json` / `cn-2026.json` 的 `name` 字段里，
 * 那份数据同时被**两个消费面**读：
 *   · **纸面**（`CalendarPrintPage`）⇒ 打印稿恒中文，直接显示 `name`（本批不动）；
 *   · **屏幕**（月历日期格小字）⇒ 必须跟随界面语言。
 * ⇒ 与 `src/core/types/enums.ts` 那五张标签表**逐条同形**：数据侧保留中文原值，
 *    React 层用一张「值 → 文案键」的表取词。理由也同款（见本文件头）：
 *    数据文件在共享内核面内，不该 import 渲染层，也不该自己读语言状态。
 *
 * ── 键**故意**以中文原值为键（不是索引、不是日期）──
 * 合并节（2025 的 `国庆节·中秋节`）与单节共用同一形态；将来新增年份若带来新节名，
 * `tests/calendar-month-cell-i18n.spec.tsx` 的**覆盖率锁**会当场红（它遍历两个 JSON
 * 的全部去重 `name`，逐个要求本表有条目），逼出「新增一条键」而不是静默漏翻。
 * 未知值回落原文（与 `writebackStatusLabel` 同一口径：宁可显示中文，也不显示空）。
 */
export const CN_HOLIDAY_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
  元旦: 'holiday.cn.newYear',
  春节: 'holiday.cn.springFestival',
  清明节: 'holiday.cn.qingming',
  劳动节: 'holiday.cn.laborDay',
  端午节: 'holiday.cn.dragonBoat',
  中秋节: 'holiday.cn.midAutumn',
  国庆节: 'holiday.cn.nationalDay',
  '国庆节·中秋节': 'holiday.cn.nationalDayMidAutumn',
};

/**
 * 节日名取词（**屏幕侧唯一入口**）。未知值原样回显。
 * ⚠️ 同本文件其余取词函数：不是 hook、不订阅语言变化 ⇒ 调用它的组件必须调 `useLang()`。
 */
export function cnHolidayNameLabel(name: string): string {
  const key = CN_HOLIDAY_NAME_KEYS[name];
  return key === undefined ? name : t(key);
}

/* ═══════════ 主进程安装失败码 → 文案键（笔 4-b） ═══════════
 *
 * ── 为什么码住在主进程、键住在渲染层 ──
 * `electron/plugin-install.cjs` 有自己的失败文案（20 条），但**主进程不该持有界面语言**
 * （它没有语言状态，也不该有）。故那侧只产出**稳定机器码 + 插值参数**，文案在渲染层取词。
 *
 * ── 两个硬要求的落点 ──
 * ① **「码 ↔ 键」集合必须双向相等**（K12 列举完备性 + K14 消费锁）：
 *    码表 ⟺ 本表 ⟺ `zh` 表里 `plugin.fail.*` 的键集，三处**两两相等**，不一致即红
 *    （少一个码 = 英文态会露中文；多一个键 = 死词条）。判据在
 *    `tests/plugin-failure-codes.spec.ts`（码集**从主进程源码反推**，不是手抄清单）。
 * ② **真因不许被码吃掉**：参数里的 `detail` 是来自 fs / JSON.parse 的**原始错误串**，
 *    取词时**原样插进去**（`t()` 只做 `{detail}` 替换，不改写内容）。
 *
 * ⚠️ 未知码**原样回显码本身**（与 `writebackStatusLabel` / `termFor` 同口径）：
 *    绝不在取词器里写死一句中文兜底 —— 那正是本笔要消灭的形态。
 */

/** 主进程返回的失败体（`electron/plugin-install.cjs` 的 `failure()` 形状） */
export interface PluginFailure {
  code: string;
  params?: Record<string, string | number>;
}

/** 码 → 文案键（键名与码 1:1：`plugin.fail.<code>`，便于双向集合相等的断言） */
export const PLUGIN_FAILURE_KEYS: Readonly<Record<string, MessageKey>> = {
  'manifest.notObject': 'plugin.fail.manifest.notObject',
  'manifest.badId': 'plugin.fail.manifest.badId',
  'manifest.badName': 'plugin.fail.manifest.badName',
  'manifest.badVersion': 'plugin.fail.manifest.badVersion',
  'manifest.badEntry': 'plugin.fail.manifest.badEntry',
  'manifest.badInstallVersion': 'plugin.fail.manifest.badInstallVersion',
  'manifest.badMinHostVersion': 'plugin.fail.manifest.badMinHostVersion',
  'install.badPath': 'plugin.fail.install.badPath',
  'install.readFailed': 'plugin.fail.install.readFailed',
  'install.badId': 'plugin.fail.install.badId',
  'install.sourceIsInstalled': 'plugin.fail.install.sourceIsInstalled',
  'install.entryMissing': 'plugin.fail.install.entryMissing',
  'install.tooLarge': 'plugin.fail.install.tooLarge',
  'install.writeFailed': 'plugin.fail.install.writeFailed',
  'install.copyVerifyFailed': 'plugin.fail.install.copyVerifyFailed',
  'uninstall.badId': 'plugin.fail.uninstall.badId',
  'uninstall.removeFailed': 'plugin.fail.uninstall.removeFailed',
  'scan.dirIdMismatch': 'plugin.fail.scan.dirIdMismatch',
  'scan.hostTooLow': 'plugin.fail.scan.hostTooLow',
  'scan.readFailed': 'plugin.fail.scan.readFailed',
};

/**
 * 失败体 → 人话（**渲染侧唯一入口**）。
 * 未知码原样回显码（可见即错 ⇒ 便于发现遗漏），**不写中文兜底**。
 * ⚠️ 同本文件其余取词函数：不是 hook、不订阅语言变化 ⇒ 调用它的组件必须调 `useLang()`。
 */
export function pluginFailureText(failure: PluginFailure): string {
  const key = PLUGIN_FAILURE_KEYS[failure.code];
  if (key === undefined) return failure.code;
  return t(key, failure.params);
}

/* ═══════════ 行业库失败预告卡（笔·分界表 裁 2）：`id` → 文案键 ═══════════
 *
 * ── 为什么是「码 → 键」而不是把文案写进 core ──
 * `CUSTOM_LIBRARY_ERROR_HINTS` 在 `src/core/template/**`，**不许 import i18n**
 * （会把 `lang.ts` 的 `document` 拖进无 DOM 的服务端 program ⇒ `typecheck:server` 红 TS2584）。
 * 那三张卡各有现成的 `id` ⇒ 直接拿它当键（键命名空间 `customLibrary.hint.<id>.title` / `.fix`），
 * core 只留结构。
 *
 * ── 双向集合相等（K12 列举完备性 + K14 消费锁）──
 * spec（`tests/custom-library-hints-i18n.spec.ts`）断三处集合两两相等：
 *   `HINTS 的 id 集 ⟺ 本表的键集 ⟺ zh 表里 customLibrary.hint.* 反解出的 id 集`。
 *   少一个 id ⇒ 那张卡渲染成码；多一个键 ⇒ 死词条。
 *
 * ⚠️ **硬线**：6 条 zh 取值与改动前 `title` / `fix` 的中文**逐字相同**
 *    （spec 里存的是**改前抄下的原值**做基准，不是改后重算 —— 那只能证明「自己等于自己」）。
 */
export const CUSTOM_LIBRARY_HINT_KEYS: Readonly<
  Record<string, { title: MessageKey; fix: MessageKey }>
> = {
  'json-only': {
    title: 'customLibrary.hint.json-only.title',
    fix: 'customLibrary.hint.json-only.fix',
  },
  'key-prefix': {
    title: 'customLibrary.hint.key-prefix.title',
    fix: 'customLibrary.hint.key-prefix.fix',
  },
  'dangling-reference': {
    title: 'customLibrary.hint.dangling-reference.title',
    fix: 'customLibrary.hint.dangling-reference.fix',
  },
};

/**
 * 预告卡取词（**屏幕侧唯一入口**）：`part` 决定取 `title` 还是 `fix`。
 * 未知 id 原样回显 id（可见即错，**不写中文兜底**）。
 * ⚠️ 同本文件其余取词函数：不是 hook、不订阅语言变化 ⇒ 调用它的组件必须调 `useLang()`。
 */
export function customLibraryHintLabel(
  id: string,
  part: 'title' | 'fix',
  vars?: InterpolationVars,
): string {
  const keys = CUSTOM_LIBRARY_HINT_KEYS[id];
  if (keys === undefined) return id;
  return t(keys[part], vars);
}

/* ═══════════ 行业库错误位置 / 原因（笔·分界表 裁 3 / 裁 4）：码 → 文案键 ═══════════
 *
 * ── 形态：与上面 `CUSTOM_LIBRARY_HINT_KEYS` 逐条同形 ──
 * core（`custom-library.prompt.ts` / `custom-library.schema.ts`）只产出**结构化位置**
 * （`{ kind: 'entry', list: 'items', n: 3, who: '选址' }`）与**机器码**
 * （`code: 'itemKeyPrefix'`），人话在**这里**拼 —— 理由：`src/core/**` 不许 import i18n
 * （`lang.ts` 的 `document` 会进无 DOM 的服务端 program ⇒ TS2584）。
 *
 * ── ⚠️ 交换条件：为什么同一个词会有两个物理位置 ──
 * 载荷（复制给 Agent 的修正单）**必须恒中文**（指令契约），而它不能引 i18n ⇒
 * core 侧 `CUSTOM_LIBRARY_FIELD_LABELS` / `CUSTOM_LIBRARY_ROOT_LABELS` / `ISSUE_TEXT`
 * **保留中文原值**，本文件的 zh 取值**由 spec 断言与它们逐字相等**。team-lead 明确
 * 接受这个代价（载荷侧没有第二个选择），但要求「两边不漂」是**可执行断言**，
 * 落在 `tests/custom-library-path-i18n.spec.ts`：
 *   · **一条 spec 同时读两份**：同一组位置，`describeCustomLibraryLocation(...)` 与
 *     本文件的 `customLibraryPathText(...)` 在 zh 下**逐字相等**；任一侧改动即红；
 *   · **双向集合相等**（K12 + K14）：`CUSTOM_LIBRARY_FIELD_LABELS` 的键集 ⟺
 *     `CUSTOM_LIBRARY_FIELD_KEYS` 的键集（ROOT / ISSUE 码同理）。少一个 ⇒ 英文态露中文；
 *     多一个 ⇒ 死词条；
 *   · **改前基准**（改前抄下的载荷输出原文，**不是改后重算**）钉住载荷零变化。
 */

/** 条目字段名 → 文案键（与载荷表 `CUSTOM_LIBRARY_FIELD_LABELS` 的键集**双向相等**） */
export const CUSTOM_LIBRARY_FIELD_KEYS: Readonly<Record<string, MessageKey>> = {
  key: 'customLibrary.label.key',
  name: 'customLibrary.label.name',
  domain: 'customLibrary.label.domain',
  schema: 'customLibrary.label.schema',
  ratioPercent: 'customLibrary.label.ratioPercent',
  colorIndex: 'customLibrary.label.colorIndex',
  kanbanColumn: 'customLibrary.label.kanbanColumn',
  defaultResponsibility: 'customLibrary.label.defaultResponsibility',
  defaultTasks: 'customLibrary.label.defaultTasks',
  customColor: 'customLibrary.label.customColor',
  description: 'customLibrary.label.description',
  itemKeys: 'customLibrary.label.itemKeys',
  items: 'customLibrary.label.items',
  presets: 'customLibrary.label.presets',
};

/**
 * 根级字段名 → 文案键（与载荷表 `CUSTOM_LIBRARY_ROOT_LABELS` 的键集**双向相等**）。
 * ⚠️ 根上的 `name` 是「包名」、条目里的 `name` 是「名称」⇒ **两个键、两个取值**；
 *    `domain` / `schema` / `items` / `presets` 两表取值相同 ⇒ **共用同一个键**
 *    （K10：同一个词只建一个键，物理位置不同不构成第二份）。
 */
export const CUSTOM_LIBRARY_ROOT_KEYS: Readonly<Record<string, MessageKey>> = {
  name: 'customLibrary.label.rootName',
  domain: 'customLibrary.label.domain',
  schema: 'customLibrary.label.schema',
  items: 'customLibrary.label.items',
  presets: 'customLibrary.label.presets',
};

/** 两个列表的**名词**（`第 4 个{阶段|套餐}`；与 `…列表` 是两个词，别合并） */
export const CUSTOM_LIBRARY_KIND_KEYS: Readonly<Record<CustomLibraryListKind, MessageKey>> = {
  items: 'customLibrary.noun.items',
  presets: 'customLibrary.noun.presets',
};

/** 失败码 → 文案键（键名与码 1:1：`customLibrary.issue.<code>`，便于双向集合相等的断言） */
export const CUSTOM_LIBRARY_ISSUE_KEYS: Readonly<Record<CustomLibraryIssueCode, MessageKey>> = {
  tooLarge: 'customLibrary.issue.tooLarge',
  customColorHex: 'customLibrary.issue.customColorHex',
  itemKeyPrefix: 'customLibrary.issue.itemKeyPrefix',
  presetKeyPrefix: 'customLibrary.issue.presetKeyPrefix',
  danglingItemKey: 'customLibrary.issue.danglingItemKey',
  duplicateItemKey: 'customLibrary.issue.duplicateItemKey',
  duplicatePresetKey: 'customLibrary.issue.duplicatePresetKey',
};

/**
 * `第 N 个阶段（谁）` —— 与载荷口径 `payloadEntryBase` 同形。
 * 两侧在 zh 下逐字相等由 spec 锁（改任一侧即红）。
 */
function pathEntryBase(loc: { list: CustomLibraryListKind; n: number; who: string | null }): string {
  const kind = t(CUSTOM_LIBRARY_KIND_KEYS[loc.list]);
  return loc.who
    ? t('customLibrary.path.entryNamed', { n: loc.n + 1, kind, who: loc.who })
    : t('customLibrary.path.entry', { n: loc.n + 1, kind });
}

/** 字段名 → 人话；未知字段名回落字段名本身（与载荷 `labelOf` 同口径：宁可露字段名，不许吞位置） */
function customLibraryFieldLabel(field: string): string {
  const key: MessageKey | undefined = CUSTOM_LIBRARY_FIELD_KEYS[field];
  return key === undefined ? field : t(key);
}

/**
 * 根级字段名 → 人话；不在根表但在字段表里 ⇒ 用字段表那张（与载荷
 * `ROOT_LABELS[f] ?? (labelOf(f) !== f ? labelOf(f) : f)` **同口径**）；
 * 两处都没有 ⇒ 回落字段名本身。
 */
function customLibraryRootLabel(field: string): string {
  const rootKey: MessageKey | undefined = CUSTOM_LIBRARY_ROOT_KEYS[field];
  if (rootKey !== undefined) return t(rootKey);
  return customLibraryFieldLabel(field);
}

/**
 * 结构化位置 → 人话（**屏幕侧唯一入口**）。
 * ⚠️ 同本文件其余取词函数：不是 hook、不订阅语言变化 ⇒ 调用它的组件必须调 `useLang()`。
 */
export function customLibraryPathText(loc: CustomLibraryPathLocation): string {
  switch (loc.kind) {
    case 'wholeFile':
      return t('customLibrary.path.wholeFile');
    case 'selfExplained':
      return '';
    case 'listField':
      return t(CUSTOM_LIBRARY_FIELD_KEYS[loc.list]);
    case 'entry':
      return pathEntryBase(loc);
    case 'entryField':
      return t('customLibrary.path.fieldOf', {
        base: pathEntryBase(loc),
        field: customLibraryFieldLabel(loc.field),
      });
    case 'entryTask':
      return t('customLibrary.path.taskOf', { base: pathEntryBase(loc), n: loc.taskN + 1 });
    case 'entryItemKey':
      return t('customLibrary.path.itemKeyOf', { base: pathEntryBase(loc), n: loc.keyN + 1 });
    case 'rootField':
      return customLibraryRootLabel(loc.field);
    case 'rawPath':
      return loc.path;
  }
}

/**
 * 一条 issue → 人话（**屏幕侧唯一入口**）：位置（按语言）+ 原因（按码取词）。
 *
 * 无码的 issue（zod 默认消息，本来就是英文，如 `Required`）**原样透传 `message`** ——
 * 与改造前一致，**不留新的兜底语言**（K22：兜底句可翻、真因不许被码吃掉）。
 * ⚠️ 同本文件其余取词函数：不是 hook、不订阅语言变化 ⇒ 调用它的组件必须调 `useLang()`。
 */
export function customLibraryIssueText(issue: CustomLibraryIssue, raw?: unknown): string {
  const where = customLibraryPathText(customLibraryPathLocation(issue.path, raw));
  const { code, params } = issue;
  const detail = code === undefined ? issue.message : t(CUSTOM_LIBRARY_ISSUE_KEYS[code], params);
  return where ? t('customLibrary.path.withDetail', { where, message: detail }) : detail;
}

/* ─────────────────── Agent 写回状态五态（AgentActivityStream） ─────────────────── */

export const WRITEBACK_STATUS_KEYS: Record<string, MessageKey> = {
  draft: 'agent.writeback.draft',
  proposed: 'agent.writeback.proposed',
  applied: 'agent.writeback.applied',
  rejected: 'agent.writeback.rejected',
  conflict: 'agent.writeback.conflict',
};

/** 未知状态（上游新增枚举值）原样回显，不吞成空白——与改造前 `?? p.status` 同口径 */
export function writebackStatusLabel(status: string): string {
  const key = WRITEBACK_STATUS_KEYS[status];
  return key === undefined ? status : t(key);
}

/* ─────────────────── Agent 接入档位（AgentIngressPanel 的 MODE_LABELS） ─────────────────── */

export const INGRESS_MODE_KEYS: Record<'local' | 'nas', MessageKey> = {
  local: 'agent.ingress.local',
  nas: 'agent.ingress.nas',
};

/* ──────────────────────── 星期：短名 / 全名（各 7 项） ──────────────────────── */

/** 索引 0..6 = 周一..周日（与全仓「周一行首」口径一致） */
export const WEEKDAY_SHORT_KEYS: readonly MessageKey[] = [
  'weekday.short.mon',
  'weekday.short.tue',
  'weekday.short.wed',
  'weekday.short.thu',
  'weekday.short.fri',
  'weekday.short.sat',
  'weekday.short.sun',
];

/** 索引 0..6 = 周一..周日；全名（「周一」/「Monday」），供休息制度编辑器使用 */
export const WEEKDAY_FULL_KEYS: readonly MessageKey[] = [
  'weekday.full.mon',
  'weekday.full.tue',
  'weekday.full.wed',
  'weekday.full.thu',
  'weekday.full.fri',
  'weekday.full.sat',
  'weekday.full.sun',
];

/**
 * 星期短名（索引 0..6 = 周一..周日）。
 * 越界索引回落周一——改造前是 `as const` 数组，越界取到 `undefined` 会渲染空串；
 * 这里保持"不抛错"，但给一个确定值（工作日索引由 lib/workdays 提供，恒 0..6）。
 */
export function weekdayShortLabel(index: number): string {
  return t(WEEKDAY_SHORT_KEYS[index] ?? WEEKDAY_SHORT_KEYS[0]!);
}

/** 星期全名（索引 0..6 = 周一..周日） */
export function weekdayFullLabel(index: number): string {
  return t(WEEKDAY_FULL_KEYS[index] ?? WEEKDAY_FULL_KEYS[0]!);
}

/* ═══════════════════ Agent 术语表（AGENT_TERMS → 文案键 · #354）═══════════════════
 *
 * ── 形状：与上面六张表**逐条同形**（枚举 → 文案键 → 取词小函数）──
 * `AGENT_TERM_KEYS[termKey][mode] → MessageKey`，`termFor(key, mode)` 内部 `t()`。
 * 这不是新设计，是把 `constants/agentTerms.ts` 里那张手写多轴表**收进本仓已有做法**；
 * `useLang.ts` 头注释的原话是「用法（全仓统一，**不许有第二种**）」。
 *
 * ── 为什么表必须搬来**这里**，不能留在 `src/constants/`（实测约束，不是偏好）──
 * `src/constants/agentTerms.ts` 在 `server/tsconfig.json` 的 include 白名单里（:75），
 * 服务端 `routes/agent.routes.ts:54` 真的 import 它的 `AGENT_SEAT_LIMIT`；那份配置
 * `lib: ["ES2020"]`（**无 DOM**）。⇒ 该文件只要出现 `import … from '../i18n'`，
 * 就会把引用 `document.documentElement` 的 `lang.ts` 拖进服务端 program，
 * `npm run typecheck:server` 当场 2 条 TS2584（2026-08-27 实测：同款缺陷在
 * `src/lib/date.ts` 上真的发生过一次，见该文件「月刻度生成」区块）。
 * ⚠️ 因此 `agentTerms.ts` **也不能重导出 `termFor`** —— 重导出同样是 import，
 *    后果一模一样。消费方一律从这里（经 `src/i18n`）取词。
 *
 * ── 收益（不是记账口径）──
 * 取值进了 message 表 ⇒ `en.ts` 是 `Record<MessageKey, string>` ⇒ **漏翻是编译错**，
 * 不是「不太会发生」。这是选「键表 + 文案表」而不是「4 列 mode × lang」的理由。
 * 27 → **19 处活代码调用点**（另 11 处是注释）**一字未改**：签名与语义都不变。
 * ----------------------------------------------------------------------------- */

/** 术语 key × 模式 → 文案键（13 × 2 = 26 键；键名 `agentTerm.<key>.<mode>`） */
export const AGENT_TERM_KEYS: Readonly<
  Record<AgentTermKey, Readonly<Record<AgentTermMode, MessageKey>>>
> = {
  stage: { human: 'agentTerm.stage.human', tech: 'agentTerm.stage.tech' },
  stageShort: { human: 'agentTerm.stageShort.human', tech: 'agentTerm.stageShort.tech' },
  applyPayload: { human: 'agentTerm.applyPayload.human', tech: 'agentTerm.applyPayload.tech' },
  ready: { human: 'agentTerm.ready.human', tech: 'agentTerm.ready.tech' },
  handoff: { human: 'agentTerm.handoff.human', tech: 'agentTerm.handoff.tech' },
  artifacts: { human: 'agentTerm.artifacts.human', tech: 'agentTerm.artifacts.tech' },
  deps: { human: 'agentTerm.deps.human', tech: 'agentTerm.deps.tech' },
  timeline: { human: 'agentTerm.timeline.human', tech: 'agentTerm.timeline.tech' },
  client: { human: 'agentTerm.client.human', tech: 'agentTerm.client.tech' },
  onsite: { human: 'agentTerm.onsite.human', tech: 'agentTerm.onsite.tech' },
  /*
   * `board.human` 的取值是「Agent 看板」（v0.8 · TBD-7 拍板：页面标题就叫「Agent 看板」，
   * 与 V1-9「人话模式不显示**来源标签**」不冲突 —— V1-9 管任务卡上的来源角标，
   * 这里管**整个工作区的名字**；侧栏一级项同步是「工作区」，于是「工作区（侧栏）→
   * 里面的 Agent 看板（页面标题）」成为两级语义）。
   * 表是文案的**唯一出处**，故标题走本词条，不在页面里硬编码（否则本词条退化成
   * 「零组件消费」的孤儿 —— 正是本仓连续在防的那类「两份真相 / 死词条」）。
   */
  board: { human: 'agentTerm.board.human', tech: 'agentTerm.board.tech' },
  claimedBy: { human: 'agentTerm.claimedBy.human', tech: 'agentTerm.claimedBy.tech' },
  blockedBy: { human: 'agentTerm.blockedBy.human', tech: 'agentTerm.blockedBy.tech' },
};

/**
 * 取词唯一入口：`termFor('stage', 'tech')` → 「批次（Batch）」。
 *
 * `mode` **必填**（v0.7 T04 根因修复核心）：无缺省值，漏传即编译失败 ——
 * 旧版带缺省值 `= 'agent'` 时，全站调用点一律省略，于是 human 一列**从未生效过**，
 * 术语表的一半是死代码。
 * 未知 key 回落 key 本身（开发期兜底：新术语未登记时不至于白屏，且渲染出的 key 名
 * 在界面上一眼可辨，便于发现遗漏）。
 *
 * ⚠️ **不是 React hook，不订阅语言变化**（同本文件其余取词函数，见文件头用法纪律）：
 *    调用它的组件**必须同时调 `useLang()`**，否则切语言后该组件不重渲染。
 *    守卫：`tests/i18n-agent-terms.spec.tsx`（凡出现 `termFor(` 的 `src/**` 文件
 *    必须同时出现 `useLang(`；`src/constants/**` 与 `src/i18n/**` 自身豁免）。
 */
export function termFor(key: AgentTermKey, mode: AgentTermMode): string {
  const keyOf = AGENT_TERM_KEYS[key]?.[mode];
  return keyOf === undefined ? key : t(keyOf);
}

/**
 * 「两类读者取值必须不同」这条不变量的**显式登记表**（按语言分列）。
 *
 * ── 不变量的**意图**，以及为什么它必须收窄 ──
 * 原判据（`tests/agent-ui-terms.spec.ts`）是「human 与 tech 取值必须不同」，用来防
 * 「改了列名但值一样」的假双模式。但它的意图是「**在这门语言下**，两类读者确实拿到
 * **不同措辞**」—— 这是个**逐语言**成立的事实，不是全语言公理：
 *   · 英文里 `timeline` 对两类读者就是同一个词 `Timeline`。硬要它们不同，只会逼出
 *     **人为制造的差异**（tech 写成 `Timeline view`），那比重合更坏。
 *   · 中文里 `onsite` 两列都是「现场」，**自 v0.7 起就是事实**（旧 spec 的双模式断言
 *     刻意只列了 9 个 key，`onsite` 从来不在其中 —— 那条断言一直是「宽」的）。
 *   ⇒ 正确做法不是「放宽」，是**把不变量收窄到它真正成立的语言上**，并给重合留一条
 *     **显式登记**的出口（每次要登记都得写一行理由，不是默默放行）。
 *
 * ── 判据 ──
 * 两份取值 `trim()` + 转小写后**完全相等**即算重合。只差大小写不算「不同措辞」
 * （`Blocked by` / `blocked by` 是同一句话的两种排版，不是两类读者的两种说法）。
 *
 * ── 防「登记表腐化成万能豁免」──
 * `tests/i18n-agent-terms.spec.tsx` 带一条**反例自证**：在登记表之外故意造一个重合，
 * 扫描必须变红；且正常的 zh/en 两表必须零违规（「会报 + 不误报」两条都要过）。
 */
export const MODE_COLLAPSED_KEYS: Readonly<Record<Lang, readonly AgentTermKey[]>> = {
  zh: ['onsite'],
  en: [
    'timeline', // 两类读者在英文里都叫 Timeline（tech 列写 `Timeline view` 是人为差异）
    'client', // 英文「委托方」只有 Client 一个词；中文才有「委托方 / 客户」两种称法
    'onsite', // 英文只有 On-site 一个词（中文侧同样重合，见上）
    'board', // 工作区**专有名词**：两类读者看到的是同一个名字，不因读者改写
    'blockedBy', // 人话列 `Blocked by`（界面标签式大写）／技术列 `blocked by`（字段名原样小写）
  ],
};

/* ═══════════════════ 内置插件名/说明（`id` → 文案键）═══════════════════
 *
 * ── 为什么映射在**渲染层**、而不是把 core 的 manifest 中文翻掉（判 B 的理由，别改回去）──
 * `PluginManifest.name` / `.summary` 是**同一个字段的两种来源**：
 *   · 内置插件 —— 编译期 manifest（`src/core/plugin/builtin/*.manifest.ts`，中文写死）；
 *   · 成员自装 —— **磁盘 manifest**（`userData/plugins/<id>/manifest.json`，作者自己写的任何语言）。
 * 若只把内置那份翻成英文，同一个字段就**一半英文一半中文**：
 * 自装插件的名字永远是作者原文（可能是"我的插件"），内置变成英文 —— 同一列里两种语言并排，
 * 读者无法判断哪一种才是"正常形态"。⇒ **core 侧一个字不动**，由渲染层按 `id` 映射：
 *   命中内置 id ⇒ 取消息表；未命中 ⇒ **原样**显示作者写的 `name` / `summary`。
 *
 * ── 与「码 → 键」那一族的同一个手法 ──
 * 与 `PLUGIN_FAILURE_KEYS`（主进程只传码）、`CUSTOM_LIBRARY_HINT_KEYS`（`id` 当键）同款：
 * **core 不许 import i18n**（会把 `lang.ts` 的 `document` 拖进无 DOM 的服务端 program ⇒
 * `typecheck:server` TS2584）⇒ 一切"人话"都由本层按机器句柄取。
 *
 * ── 三条口径 ──
 *   ① 未知 id（第三方 / 未来新增内置但忘了登记）**回落原文**，不写死中文兜底
 *      （与 `pluginFailureText` 的「未知码原样回显码」同一条纪律：可见即错，便于发现遗漏）；
 *   ② `summary` 为空串 ⇒ `t('plugin.noSummary')`：这一支是**本层补的**，
 *      因为 core 的 `mergeInstalledManifests` 对「作者没写说明」只落 `''`
 *      （它不许持有界面语言，也就不能自己写「（作者未提供说明）」这种中文）；
 *   ③ 同本文件其余取词函数：**不是 hook、不订阅语言变化** ⇒ 调用它的组件必须调 `useLang()`。
 */

/** 内置插件的显示名（`id` → 消息键）。加内置插件时**必须同步加一行**，否则它在英文界面上是中文。 */
export const PLUGIN_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
  'sample-projects': 'plugin.builtin.sampleProjects.name',
};

/** 内置插件的说明（`id` → 消息键）；与 `PLUGIN_NAME_KEYS` 同 id 集合（有 spec 钉这条） */
export const PLUGIN_SUMMARY_KEYS: Readonly<Record<string, MessageKey>> = {
  'sample-projects': 'plugin.builtin.sampleProjects.summary',
};

/** 插件 manifest → **界面显示名**。内置走消息表；自装原样；两者都没有才回落 `id`。 */
export function pluginDisplayName(manifest: { id: string; name: string }): string {
  const key = PLUGIN_NAME_KEYS[manifest.id];
  if (key !== undefined) return t(key);
  return manifest.name || manifest.id;
}

/**
 * 插件 manifest → **界面显示说明**。
 * ⚠️ 空串 ⇒ `t('plugin.noSummary')`：core 侧对「作者没写说明」落的是 `''`（见口径②）。
 */
export function pluginDisplaySummary(manifest: { id: string; summary: string }): string {
  const key = PLUGIN_SUMMARY_KEYS[manifest.id];
  if (key !== undefined) return t(key);
  return manifest.summary || t('plugin.noSummary');
}
