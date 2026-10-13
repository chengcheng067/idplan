/**
 * 英文文案表。
 *
 * ⚠️ 类型声明为 `Record<MessageKey, string>`（`MessageKey` 由 `zh.ts` 推导）
 * ⇒ **少写任何一个键都编译不过**（`npx tsc --noEmit` 直接报缺键），
 * 多写一个不存在的键同样报错。这是「中英两列都得给」的机器保障，
 * 不靠人记、不靠 review。
 *
 * 翻译口径：
 *   ① 学术/工程术语优先（Stage / Task / Baseline / Artifact），不造词；
 *   ② 按钮与标签用**句首大写**（Sentence case），导航项用 Title Case；
 *   ③ 界面宽度敏感处（设置六区导航、打印选择器）宁短勿长——英文比中文平均长约
 *      2.2 倍，`tests/settings-zones.spec.ts:508-510` 的 767px 同屏判据是硬线；
 *   ④ 插值占位符名（`{name}` / `{count}` …）必须与 `zh.ts` 一致。
 */
import type { MessageKey } from './zh';

export const enMessages: Record<MessageKey, string> = {
  /* ──────────────────────────── Common ──────────────────────────── */
  'common.unknown': 'Unknown',
  'common.untitledProject': 'Project',
  'common.loading': 'Loading…',
  'common.plugins': 'Plugins',

  /* ─────────────────────── Settings drawer shell ─────────────────────── */
  'settings.title': 'Settings',
  'settings.betaBadge': 'Beta',
  'settings.betaTitle': 'Beta build',
  'settings.closeAria': 'Close settings',
  'settings.navAria': 'Settings sections',
  'settings.drawerAria': 'Settings',

  /* ────────────────────── Settings · six top-level zones ────────────────────── */
  'settings.zone.appearance': 'Appearance',
  'settings.zone.schedule': 'Schedule',
  'settings.zone.data': 'Data & Backup',
  'settings.zone.plugins': 'Plugins',
  'settings.zone.industry': 'Industry & Templates',
  'settings.zone.about': 'About',

  /* ───────────────── Settings · plugin zone two sub-tabs ───────────────── */
  'settings.pluginsSub.plugins': 'Plugins',
  'settings.pluginsSub.agent': 'Agent & Automation',

  /* ─────────────────────── Settings · section titles ─────────────────────── */
  'settings.section.theme': 'Theme',
  'settings.section.restPolicy': 'Work week',
  'settings.section.scheduleBasis': 'Schedule basis',
  'settings.section.dataLocation': 'Where data lives',
  'settings.section.backup': 'Backup',
  'settings.section.frontendLog': 'Frontend log',
  'settings.section.update': 'Update',
  'settings.section.agentSeats': 'Agent & local library',
  'settings.section.naturalLanguage': 'Natural-language channel',
  'settings.section.agentBoard': 'Agent board',
  'settings.section.about': 'About',
  'settings.section.support': 'Support & feedback',

  /* ─────────────────────── Appearance · theme & language ─────────────────────── */
  'appearance.theme.light': 'Light',
  'appearance.theme.dark': 'Dark',
  'appearance.theme.system': 'Follow system',
  'appearance.themeHint':
    'With “Follow system”, the app tracks your OS light/dark setting in real time.',
  'appearance.lang': 'Language',
  'appearance.lang.zh': '中文',
  'appearance.lang.en': 'English',
  'appearance.langHint': 'Applies immediately — no restart needed.',

  /* ─────────────────────────── Sidebar navigation ─────────────────────────── */
  'nav.mainAria': 'Main navigation',
  'nav.projects': 'Projects',
  'nav.board': 'Board',
  'nav.myTasks': 'My Tasks',
  'nav.agent': 'Agent',
  'nav.agentAreaAria': 'Agent workspace',
  'nav.agentWorkspace': 'Workspace',
  'nav.agentExecutions': 'Executions',
  'nav.pluginBadge': 'Plugin',

  /* ─────────────────────────────── Top bar ─────────────────────────────── */
  'topbar.page.home': 'My Projects',
  'topbar.page.memberBoard': 'Member Board',
  'topbar.page.myTasks': 'My Tasks',
  'topbar.page.agent': 'Agent Board',
  'topbar.breadcrumb.project': 'Project',
  'topbar.breadcrumb.projectDetail': 'Project details',
  'topbar.breadcrumb.myProjects': 'My Projects',
  'topbar.breadcrumb.schedule': 'Schedule',
  'topbar.breadcrumb.calendar': 'Calendar',
  'topbar.searchPlaceholder': 'Search projects, tasks or clients…',
  'topbar.searchAria': 'Search projects, tasks or clients',
  'topbar.searchClearAria': 'Clear and close search',
  'topbar.backAria': 'Go back',

  /* ───────────────────── Weekdays (short + full) ───────────────────── */
  'weekday.short.mon': 'Mon',
  'weekday.short.tue': 'Tue',
  'weekday.short.wed': 'Wed',
  'weekday.short.thu': 'Thu',
  'weekday.short.fri': 'Fri',
  'weekday.short.sat': 'Sat',
  'weekday.short.sun': 'Sun',
  'weekday.full.mon': 'Monday',
  'weekday.full.tue': 'Tuesday',
  'weekday.full.wed': 'Wednesday',
  'weekday.full.thu': 'Thursday',
  'weekday.full.fri': 'Friday',
  'weekday.full.sat': 'Saturday',
  'weekday.full.sun': 'Sunday',

  /* ────────────────── Enum label mirrors (values = enums.ts) ────────────────── */
  'restPolicy.doubleOff': 'Two days off',
  'restPolicy.singleOff': 'One day off',
  'restPolicy.bigSmallWeek': 'Alternating weeks',
  'scheduleBasis.calendar': 'Calendar days',
  'scheduleBasis.workday': 'Working days',
  'memberRole.admin': 'Admin',
  'memberRole.member': 'Member',
  'memberActorKind.human': 'Human',
  'memberActorKind.agent': 'Agent',
  'taskStatus.draft': 'Draft',
  'taskStatus.ready': 'Ready',
  'taskStatus.claimed': 'Claimed',
  'taskStatus.inProgress': 'In progress',
  'taskStatus.blocked': 'Blocked',
  'taskStatus.review': 'In review',
  'taskStatus.done': 'Done',
  'stageStatus.notStarted': 'Not started',
  'stageStatus.inProgress': 'In progress',
  'stageStatus.completed': 'Completed',
  'stageStatus.delayed': 'Delayed',

  /* ────────────────────── Calendar status filter / legend ────────────────────── */
  'calendarStatus.inProgress': 'In progress',
  'calendarStatus.completed': 'Completed',
  'calendarStatus.overdue': 'Overdue',
  'calendarStatus.notStarted': 'Not started',

  /* ────────────────────── Agent · write-back proposal status ────────────────────── */
  'agent.writeback.draft': 'Draft',
  'agent.writeback.proposed': 'In review',
  'agent.writeback.applied': 'Applied',
  'agent.writeback.rejected': 'Rejected',
  'agent.writeback.conflict': 'Conflict',

  /* ────────────────────── Agent · ingress channel modes ────────────────────── */
  'agent.ingress.local': 'Local',
  'agent.ingress.nas': 'NAS',

  /* ────────────── New-project form · industry-neutral placeholder ────────────── */
  'project.namePlaceholder': 'e.g. “Project X · Phase 1”',

  /* ──────────────────── Toasts (store layer, batch 1) ──────────────────── */
  'toast.projectCreated': '“{name}” created',
  'toast.projectCreatedManual': '“{name}” created manually',
  'toast.projectCreateFailed': 'Could not create the project. Please try again.',
  'toast.projectUpdated': 'Project updated',
  'toast.updateFailed': 'Update failed',
  'toast.projectDomainConfirmed': 'Project domain confirmed',
  'toast.projectDomainConfirmFailed': 'Could not confirm the domain. Please try again.',
  'toast.boardCreated': 'Board for “{name}” created',
  'toast.boardCreateFailed': 'Could not create the board. Please try again.',
  'toast.boardReadBackFailed': 'Board created, but reading it back failed. Refresh to view it.',
  'toast.archived': 'Archived',
  'toast.restored': 'Restored',
  'toast.restoredToActive': 'Restored to active',
  'toast.actionFailed': 'Action failed',
  'toast.projectDeleted': '“{name}” deleted',
  'toast.deleteFailed': 'Delete failed',
  'toast.takeoverFailed': 'Takeover failed. Please try again.',
  'toast.takeoverNotSupportedOnNas':
    'Takeover works on local data only — the NAS server has no cross-project move endpoint yet.',
  'toast.projectPromoted': '“{name}” is now a formal project under “My Projects”',
  'toast.tasksMoved': 'Moved {count} task(s)',
  'toast.tasksMovedDropped': 'Moved {count} task(s) (stripped {dropped} dangling link(s))',
  'toast.tasksMoveFailed': 'Move failed. Please try again.',
  'toast.rescheduled': 'Rescheduled and logged',
  'toast.rescheduleFailed': 'Reschedule failed',
  'toast.statusUpdated': 'Status updated',
  'toast.statusTransitionFailed': 'Status transition failed',
  'toast.saveFailed': 'Save failed',
  'toast.taskStatusSaveFailedRolledBack': 'Could not save the task status — rolled back.',
  'toast.taskSaved': 'Task saved',
  'toast.taskSaveFailed': 'Could not save the task',
  'toast.entryAdded': 'Entry added',
  'toast.entryAddFailed': 'Could not add the entry',
  'toast.entryDeleted': 'Entry deleted',
  'toast.entryDeleteFailedReverted': 'Delete failed — the entry was restored.',
  'toast.memberAdded': 'Member “{name}” added',
  'toast.memberAddFailed': 'Could not add the member',
  'toast.memberUpdated': 'Member updated',
  'toast.payloadPreviewFailed': 'Payload preview failed.',
  'toast.payloadWriteFailed': 'Payload write failed.',
  'toast.payloadWriteDone': 'Write complete: {created} created / {updated} updated',
  'toast.payloadWriteDoneRejected':
    'Write complete: {created} created / {updated} updated / {rejected} rejected',
  'toast.handoffFailed': 'Could not generate the handoff bundle.',
  'toast.claimed': 'Claimed — starting now',
  'toast.claimFailed': 'Could not claim the task.',
  'toast.payloadInvalid': 'Payload validation failed: {path} {message}',
  'toast.payloadMoreIssues': '…{count} more structural issue(s) not shown.',
};
