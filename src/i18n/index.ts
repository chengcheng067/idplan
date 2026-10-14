/**
 * `src/i18n` 的**唯一公开出口**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 全仓纪律：只准从这里 import
 * ══════════════════════════════════════════════════════════════════════
 *   ✅ `import { useLang } from '../../i18n'`
 *   ✅ `import { t, weekdayShortLabel } from '../../i18n'`
 *   ✅ `import type { Lang } from '../../i18n'`
 *   ❌ `import { zhMessages } from '../../i18n/messages/zh'`   ← 违规
 *   ❌ `import { t } from '../../i18n/translate'`              ← 违规
 *   ❌ `import { getLang } from '../../i18n/lang'`             ← 违规
 *
 * 为什么这条纪律是硬线：它是「**可替换性**」的全部实现。产品若最终决定引
 * 第三方 i18n 库（本批已按现状排除，理由见 `lang.ts` 文件头），改的只有
 * `src/i18n/` 这一层——消费方一行不动。若消费方四散直接 import 内部模块，
 * 换库就变成全仓改，那才是真正的技术债。
 * 守卫：`tests/i18n.spec.ts` 的「单一出口」源码扫描（扫 `src/**`，`src/i18n/**`
 * 自身豁免）。
 *
 * 文件布局：
 *   `lang.ts`       语言状态源（模块级 store + 持久化 + `<html lang>` 落 DOM）
 *   `translate.ts`  `t()` 查表与 `{name}` 插值
 *   `useLang.ts`    `useLang()`（订阅 + 切语言 + 取词）
 *   `labels.ts`     枚举值 → 文案键的键表与取词小函数
 *   `messages/zh.ts` 中文文案（键名的唯一出处）
 *   `messages/en.ts` 英文文案（`Record<MessageKey, string>` ⇒ 缺键编译错）
 */

export {
  ALL_LANGS,
  DEFAULT_LANG,
  getLang,
  initLang,
  setLang,
  type Lang,
} from './lang';

export { t, isMessageKey, MESSAGE_KEYS, catalogOf, type InterpolationVars } from './translate';

export { useLang, type UseLangResult } from './useLang';

export type { MessageKey } from './messages/zh';

/*
 * ★ #354：Agent 术语表（原 `constants/agentTerms.ts` 的 `AGENT_TERMS` / `termFor`）落在本层。
 * 为什么不能留在 `constants/` —— 那份文件在 `server/tsconfig.json` 的 include 白名单里
 * （`lib: ["ES2020"]`，无 DOM），一 import i18n 就把 `lang.ts`（引用 `document`）拖进服务端
 * program，`typecheck:server` 连红两条 TS2584（实测）；**重导出同样不行**（重导出 = import）。
 * 键表与取词函数的形状、以及「两模式取值必须不同」那条不变量的收窄，见 `./labels.ts`。
 */
export {
  AGENT_TERM_KEYS,
  CALENDAR_STATUS_KEYS,
  CUSTOM_LIBRARY_HINT_KEYS,
  customLibraryHintLabel,
  CUSTOM_LIBRARY_FIELD_KEYS,
  CUSTOM_LIBRARY_ISSUE_KEYS,
  CUSTOM_LIBRARY_KIND_KEYS,
  CUSTOM_LIBRARY_ROOT_KEYS,
  customLibraryIssueText,
  customLibraryPathText,
  CN_HOLIDAY_NAME_KEYS,
  calendarStatusLabel,
  cnHolidayNameLabel,
  INGRESS_MODE_KEYS,
  MEMBER_ACTOR_KIND_KEYS,
  MEMBER_ROLE_KEYS,
  PLUGIN_FAILURE_KEYS,
  PLUGIN_NAME_KEYS,
  PLUGIN_SUMMARY_KEYS,
  pluginDisplayName,
  pluginDisplaySummary,
  pluginFailureText,
  MODE_COLLAPSED_KEYS,
  memberActorKindLabel,
  memberRoleLabel,
  REST_POLICY_KEYS,
  restPolicyLabel,
  SCHEDULE_BASIS_KEYS,
  STAGE_STATUS_KEYS,
  scheduleBasisLabel,
  stageStatusLabel,
  TASK_STATUS_KEYS,
  taskStatusLabel,
  termFor,
  WEEKDAY_FULL_KEYS,
  WEEKDAY_SHORT_KEYS,
  weekdayFullLabel,
  weekdayShortLabel,
  WRITEBACK_STATUS_KEYS,
  writebackStatusLabel,
} from './labels';

/*
 * 日期格式化的两条出口（⑤e）。⚠️ 必须**从这里**转出：`tests/i18n.spec.tsx` 的
 * 「单一取词出口」守卫要求 `src/**` 里任何 import i18n 的路径都落在 `src/i18n` 上 ——
 * 本批第一版直接 `import ... from '../i18n/date'`，**正是被那条守卫当场拦下的**
 * （它就该这样）。故消费方一律 `import { … } from '../i18n'`。
 * 纸面/屏幕两条出口的结构性理由见 `./date.ts` 文件头。
 */
export {
  formatDayMonthLocalized,
  formatMonthPart,
  formatMonthPartLocalized,
  formatMonthYear,
  formatMonthYearLocalized,
  formatSelectedDateLocalized,
} from './date';

/*
 * `index.html` 的 meta description 运行时同步（笔 4-c）。
 * ⚠️ 它**独立成文件**、不放进 `lang.ts`：`translate.ts` → `lang.ts` 是单向的，
 *    反向 import 会**成环**（理由见 `./meta.ts` 文件头）。
 */
export { applyMetaDescription, initMetaDescription } from './meta';
