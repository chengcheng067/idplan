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
 *   ⑤ **一句拆成多段时，段间的空格归英文取值**。JSX 里
 *      `{t('x')}<strong>{t('y')}</strong>{t('z')}` 这些**相邻表达式容器之间
 *      JSX 不产生任何空白**（只有同一 JSXText 内部的换行才被折成一个空格——
 *      实测见 `tests/i18n-jsx-space.spec.ts`）。中文不需要这种空格，所以只能写进
 *      英文取值里，惯例是**段尾空格**：
 *        `'agent.stanceBefore': 'The Agent board currently '`
 *      （例外：**左段是 JSX 里的硬编码字面量**时必须放右段的**前导空格** ——
 *        因为字面量的尾空格改不动，例：`'ingress.explain.writers': ' file — …'`，
 *        它接在 `<code>agent-ingress.json</code>` 之后，而中文态那里不能有空格。）
 *      句间空格则用 `{' '}` 显式写出来（中英都要，不能省）。
 *      守卫：`tests/i18n-jsx-space.spec.ts`。
 */
import type { MessageKey } from './zh';

export const enMessages: Record<MessageKey, string> = {
  /* ──────────────────────────── Common ──────────────────────────── */
  'common.unknown': 'Unknown',
  'common.untitledProject': 'Project',
  'common.loading': 'Loading…',
  'common.updateAvailableAria': 'Update available',
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
  'settings.zone.schedule': 'Scheduling',
  'settings.zone.data': 'Data & Backup',
  'settings.zone.plugins': 'Plugins',
  'settings.zone.industry': 'Industry & Templates',
  'settings.zone.about': 'About',

  /* ───────────────── Settings · plugin zone two sub-tabs ───────────────── */
  'settings.pluginsSub.plugins': 'Plugins',
  'settings.pluginsSub.agent': 'Agent & Automation',

  /* ─────────────────────── Settings · section titles ─────────────────────── */
  'settings.section.theme': 'Theme',
  'settings.section.restPolicy': 'Rest policy',
  'settings.section.scheduleBasis': 'Scheduling basis',
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
  'nav.agentExecutions': 'Execution records',
  'nav.homeAria': 'ID Plan home',
  'nav.sidebarAria': 'Main navigation sidebar',
  /* The <xl sidebar drawer's own overlay label (a different surface from the aside above) */
  'nav.drawerAria': 'Navigation menu',
  'sidebar.agentBoards': 'Agent boards',
  'sidebar.noIdentityHint':
    'No identity yet. Pick a member from the identity row at the bottom of the sidebar and the projects you can see and change will show up here.',
  'nav.pluginBadge': 'Plugin',

  /* ─────────────── Sidebar footer / mobile “more” menu (shared copy) ─────────────── */
  'sidebar.settingsTitle': 'Settings (export / clear log)',
  'sidebar.loadDemo': 'Load sample projects',
  'sidebar.loadDemoTitle':
    'Load 5 demo projects (replaces all current data) — the fastest way to see what the product does',
  'sidebar.saveBackup': 'Save backup',
  'sidebar.saveBackupTitle': 'Save backup (exports a local JSON file)',
  'sidebar.loadBackup': 'Load backup',
  'sidebar.loadBackupTitle':
    'Load backup (restores from a local JSON file; replaces all current data)',
  'sidebar.newProject': 'New Project',
  'sidebar.viewAllProjectsTitle': 'View all projects',
  'sidebar.viewAll': 'View all',
  'sidebar.expandAllProjects': 'Show all {count} projects',
  'sidebar.remainingProjects': '{count} more project(s)…',
  /* Mobile “more” menu (<md: the only navigation entry) */
  'mobile.moreAria': 'More actions',

  /* ─────────────────────── First-run guide card ─────────────────────── */
  'guide.aria': 'First-run guide',
  'guide.title': 'Welcome to ID Plan',
  'guide.dismissAria': 'Look around',
  'guide.lead.before': 'It turns a project contract into a ',
  'guide.lead.strong': 'stage timeline you can actually read',
  'guide.lead.after': ' — board, calendar, gantt and print: four readings of one dataset.',
  'guide.privacy': 'Your data stays on your own machine, works offline, and is never uploaded.',
  'guide.pickDomain': 'Which industry would you like to see first?',
  'guide.card.software': 'Software',
  'guide.line.software':
    "Picking it brings that industry's stages and board columns — five phases from planning to release on one board",
  'guide.card.travel': 'Travel',
  'guide.line.travel':
    "It brings that industry's stages and board columns — from itinerary planning to final billing, nothing gets lost",
  'guide.card.indoor': 'Interiors',
  'guide.line.indoor':
    "It brings that industry's stages and board columns — one chart shows where you are",
  'guide.demoNotReady': 'Demo in progress',
  'guide.adminOnlyTitle': 'Only an admin can load the sample projects',
  'guide.lookAround': 'Look around (skip the sample)',
  'guide.canReturn': 'You can reopen it any time from “Load sample projects” in the sidebar',

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
  /* Hamburger (<xl sidebar drawer trigger — NOT the <md MobileMoreMenu ⋮) */
  'topbar.navMenuAria': 'Open navigation menu',
  /* Tablet (768–1279) search icon button */
  'topbar.searchOpenAria': 'Open search',
  'topbar.searchOpenTitle': 'Search (⌘K)',
  /* Electron self-drawn window controls (Windows only; macOS keeps the native traffic lights) */
  'topbar.windowControlsAria': 'Window controls',
  'topbar.windowMinimize': 'Minimize',
  'topbar.windowMaximize': 'Maximize',
  'topbar.windowRestore': 'Restore',

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
  'toast.agentStatusTransitionFailed': 'Status transition failed.',
  'toast.payloadInvalid': 'Payload validation failed: {path} {message}',
  'toast.payloadMoreIssues': '…{count} more structural issue(s) not shown.',

  'common.close': 'Close',

  /* ────────────────── Agent ingress panel ────────────────── */
  'ingress.title': 'Connect an external writer',
  'ingress.explain.before': 'On Windows desktop, in ',
  'ingress.explain.localMode': 'local mode',
  'ingress.explain.afterA': ', click “Generate ingress info” below:',
  'ingress.explain.afterB':
    ' the access token is created automatically and everything a writer needs (address / token / endpoints / payload schema) is written to a fixed-path ',
  'ingress.explain.writers': ' file — WorkBuddy and other writers',
  'ingress.explain.readFile': ' just read that file and they are connected.',
  'ingress.explain.nasNote':
    ' NAS mode currently supports connectivity probing only; remote automatic write is not enabled yet.',
  'ingress.addressTitle': 'Service address',
  'ingress.modeTablistAria': 'Channel mode',
  'ingress.addressAria': 'Service address',
  'ingress.localAddressHint':
    'Local mode listens on 127.0.0.1 only and is not exposed; once you generate the ingress info it can receive automatic imports.',
  'ingress.nasAddressHint':
    'NAS mode currently supports connectivity probing of the address and token only; remote automatic write is not enabled yet.',
  'ingress.fileTitle': 'Ingress info',
  'ingress.tokenGenerated': 'Token generated',
  'ingress.tokenNotGenerated': 'Not generated',
  'ingress.generate': 'Generate ingress info',
  'ingress.regenerate': 'Regenerate',
  'ingress.regenerateTitle': 'Generate a new token and rewrite the ingress file (the old token dies immediately)',
  'ingress.copyPath': 'Copy file path',
  'ingress.copyInstruction': 'Copy setup instruction',
  'ingress.copyInstructionTitle': 'Copy the full setup instruction (a fallback for writers that cannot read files)',
  'ingress.fileNotReady':
    'Not generated yet. After you click “Generate ingress info”, give the file path to your writer (or let it read that fixed path directly).',
  'ingress.tokenAutoNote':
    'The token is generated on this machine — no manual setup. After a rotation, the newest version of the ingress file is authoritative.',
  'ingress.tokenTitle': 'Access token',
  'ingress.tokenConfigured': 'Configured',
  'ingress.tokenUnconfigured': 'Not configured',
  'ingress.tokenAria': 'Access token',
  'ingress.tokenReplacePlaceholder': 'Type a new token to replace the current one',
  'ingress.tokenPastePlaceholder': 'Paste the access token configured on the NAS server',
  'ingress.save': 'Save',
  'ingress.copyTokenAria': 'Copy token',
  'ingress.copy': 'Copy',
  'ingress.nasTokenNote':
    'On NAS the token comes from the server environment (keep it in sync with the NAS setting); after saving it is never echoed back.',
  'ingress.statusTitle': 'Service status',
  'ingress.probe': 'Probe now',
  'ingress.probeOk': 'Reachable',
  'ingress.probeFail': 'Unreachable',
  'ingress.dataLayerReady': 'Data layer ready',
  'ingress.dataLayerUnavailable': 'Data layer unavailable',
  'ingress.appNotRunning':
    'ID Plan is not running (or its data layer is not ready) — open the app and try again.',
  'ingress.projectCount': '{count} project(s)',
  'ingress.seatUsage': 'Seats {used} / {limit}',
  'ingress.probeEmpty': 'Not probed yet. Click “Probe now” to check whether the service is reachable.',
  'ingress.syncTitle': 'Recent syncs',
  'ingress.syncAt': 'Last sync',
  'ingress.syncResult': 'Result',
  'ingress.syncEmptyLocal': 'No automatic write from this machine yet.',
  'ingress.syncEmptyNas': 'Remote automatic write is not enabled on NAS, so there are no syncs.',
  'ingress.openManual': 'Switch to pasting a schedule file manually',

  /* ──────────────── Agent activity stream ──────────────── */
  'agent.activity.aria': 'Agent activity stream',
  'agent.activity.title': 'Agent activity',
  'agent.activity.changes': '{count} change(s)',
  'agent.activity.pendingProposals': 'Proposals await review — handle them in bulk on the “Write-back” tab',
  /* ───────────────────── Home page ───────────────────── */
  'home.subtitle': '{active} in progress · {due} due this week · {overdue} overdue',
  'home.column.todo': 'Not started',
  'home.stat.active': 'Active projects',
  'home.stat.dueThisWeek': 'Tasks due this week',
  'home.stat.overdue': 'Overdue risk',
  'home.stat.doneThisMonth': 'Completed this month',
  'home.viewSwitchAria': 'Home view switch',
  'home.noSearchMatch': 'No project matches “{query}”',
  'home.clearSearch': 'Clear search',
  'home.memberHitsAria': 'Member search results',
  'home.memberHitsTitle': 'Members found',
  'home.memberHitsHint': "Click to open that member's task board",
  'home.archivedToggle': 'Archived ({count})',
  'empty.noActiveProjects': 'No project in progress yet',
  'home.empty.body':
    'Create a project and get its stage schedule running. The name and completion date are required; everything else can be filled in later.',
  'home.empty.privacy':
    'Your data is saved automatically in this browser and survives closing it. To move machines or keep an archive, use “Save backup” at the bottom of the sidebar — you can restore it any time.',
  'home.openManual': 'Create a project manually',
  /* ───────────────────── My Tasks ───────────────────── */
  'myTasks.subtitle': 'Only what concerns you',
  'myTasks.groupAria': 'Task grouping',
  'myTasks.byProject': 'By project',
  'myTasks.byTime': 'By time',
  'myTasks.showDoneOn': 'Completed included',
  'myTasks.showDoneOff': 'Show completed',
  'myTasks.stat.today': 'Due today',
  'myTasks.stat.undone': 'Total open',
  'myTasks.group.overdue': 'Overdue',
  'myTasks.group.today': 'Today',
  'myTasks.group.week': 'Within 7 days',
  'myTasks.group.later': 'Later',
  'myTasks.noIdentity': 'Go to the bottom of the left-hand navigation to pick your identity and type your name;',
  'myTasks.noIdentityNoAdmin':
    'If the system has no admin yet, ask them to finish first-time setup before you continue.',
  'myTasks.empty.mine': '{name}, nothing is assigned to you right now 🎉',
  'myTasks.empty.notFound': 'That identity was not found.',
  'myTasks.unknownProject': '(Unknown project)',
  'myTasks.overdueCount': '{count} overdue',
  'myTasks.markDone': 'Mark as done',
  'myTasks.markNotDone': 'Mark as not done',
  'myTasks.dueOverdue': '{days}d overdue',
  'myTasks.dueInDays': '{days} d',
  /* ───── Member board page (MemberBoardPage, ⑤b) · reuses topbar.backAria /
     nav.board / topbar.breadcrumb.calendar / home.stat.* / myTasks.group.overdue ───── */
  'member.board.title': 'Project board',
  'member.board.titleOf': '{name}’s project board',
  'member.board.scopeAdmin': 'Admin view · only projects and tasks related to “{name}”',
  'member.board.scopeSelf': 'Only projects related to me',
  'member.board.viewSwitchAria': 'Member board view switch',
  'member.board.missingTitle': 'Member not found',
  'member.board.missingBody':
    'The member this board link points to no longer exists (they may have been deleted). Go back to the member board to see your own projects.',
  'member.board.missingBack': 'Back to member board',
  'member.board.emptyTitle': 'No projects related to you yet',
  'member.board.emptyBody':
    'Once an admin assigns you as a stage owner or adds you to a task, the related projects show up here.',
  'member.board.columnEmpty': 'No projects',
  'member.board.unknownProject': 'Unknown project',
  'member.board.openProjectTitle': 'Open project: {name}',
  /* Task triage blocks (the overdue label reuses myTasks.group.overdue) */
  'member.triage.ongoing': 'In progress',
  'member.triage.recentDone': 'Recently completed',
  'member.triage.emptyOverdue': 'No overdue tasks',
  'member.triage.emptyOngoing': 'No tasks in progress',
  'member.triage.emptyRecentDone': 'Nothing completed recently',
  'member.triage.moreDone': '{count} more completed earlier',
  /* ───── Agent board page (AgentBoardPage, ⑤b-②) ───── */
  'agentBoard.group.confirm': 'Awaiting confirmation',
  'agentBoard.group.ready': 'Ready to start',
  'agentBoard.group.doing': 'In progress',
  'agentBoard.group.done': 'Completed',
  'agentBoard.group.hidden': 'Hidden',
  'agentBoard.mode.human': 'Plain',
  'agentBoard.mode.tech': 'Technical',
  'agentBoard.modeTabsAria': 'Board mode switch',
  'agentBoard.dueOverdue': '{days} d overdue',
  'agentBoard.dueRemaining': '{days} d left',
  /* Ingress-channel toasts (10) */
  'agentBoard.tokenSaved': 'Access token saved on this machine.',
  'agentBoard.tokenNotConfigured': 'No access token configured yet.',
  'agentBoard.tokenCopied': 'Access token copied.',
  'agentBoard.copyFailed': 'Copy failed. Please try again.',
  'agentBoard.ingressEnvUnsupported':
    'This environment cannot write the ingress file (Windows desktop builds only).',
  'agentBoard.ingressWriteFailed': 'Failed to write the ingress file: {reason}',
  'agentBoard.unknownReason': 'unknown reason',
  'agentBoard.ingressGeneratedCopied': 'Ingress info generated; path copied: {path}',
  'agentBoard.ingressGenerated': 'Ingress info generated: {path}',
  'agentBoard.ingressNotGenerated':
    'Ingress info not generated yet — click “Generate ingress info” first.',
  'agentBoard.pathCopied': 'File path copied.',
  'agentBoard.tokenNotGenerated': 'No access token yet — generate the ingress info first.',
  'agentBoard.ingressFileAbsent':
    '(No ingress file yet — click “Generate ingress info” in the panel first.)',
  'agentBoard.ingressInstructionCopied': 'Ingress instruction copied — paste it to the writer.',
  /* Writeback proposal toasts */
  'agentBoard.proposalsApproved': '{count} proposals approved',
  'agentBoard.proposalsRejected': '{count} proposals rejected',
  'agentBoard.proposalsFailed':
    '{count} proposals could not be decided (someone else may have handled them).',
  /* Toolbar */
  'agentBoard.backToProjects': '← Projects',
  'agentBoard.boardSelectAria': 'Choose an Agent board',
  'agentBoard.noBoards': '(No Agent boards yet)',
  'agentBoard.deleteTitle': 'Permanently delete the current Agent board',
  'agentBoard.deleteDisabledTitle': 'Select an Agent board first',
  'agentBoard.deleteButton': 'Delete board',
  /* “What to do now” pinned section */
  'agentBoard.nowTitle': 'What to do now',
  'agentBoard.startNow': 'Start working',
  'agentBoard.claimHint': 'Claim it and you can start — all upstream dependencies are ready.',
  'agentBoard.nowEmpty':
    'Nothing ready to start right now. Import new tasks or unblock existing ones and they show up here.',
  'agentBoard.cyclicWarning':
    '{count} tasks form a dependency cycle and were moved out of the main list. Fix the dependencies and refresh.',
  /* Footnote under the pinned section（数字是加粗 span ⇒ 拆键；段尾空格是载荷） */
  'agentBoard.sameGroupPre': 'Same group as “{group}”: ',
  'agentBoard.unitItems': ' in total',
  'agentBoard.overdueInline': '· Overdue: ',
  /* Hidden hint line（句子中间夹一个按钮 ⇒ 空格落在英文取值尾部） */
  'agentBoard.hiddenHintPre': '{count} more are still being prepared upstream — ',
  'agentBoard.hiddenHintSwitch': 'switch to “{mode}” ',
  'agentBoard.hiddenHintPost': 'to see them all',
  /* Planning wizard / ingress modal / delete confirmation */
  'agentBoard.planningWizard': 'Plan a board with AI',
  'agentBoard.ingressModalAria': 'Connect an external writer',
  'agentBoard.deleteDialogTitle': 'Delete Agent board',
  'agentBoard.deleteConfirmText': 'Delete permanently',
  'agentBoard.deleteBodyPre':
    'Delete “{name}”? Every stage and task on this board will be permanently deleted,',
  'agentBoard.deleteBodyStrong': 'with no way back',
  'agentBoard.deleteBodyPost':
    ', and it will not go to “Archived”.  If you only want to keep it among your projects, use “Take over · convert to a regular project” on the detail page instead.',
  /* ───── Components rendered by the board page (⑤b-③) ───── */
  'agentCard.actionClaim': 'Start working',
  'agentCard.actionApprove': 'Accept',
  'agentCard.actionUnblock': 'Unblock',
  'agentCard.actionProgress': 'View progress',
  'agentCard.actionReuse': 'View / reuse',
  'agentCard.actionOpen': 'View',
  'agentCard.metaOwner': 'Owner: {name}',
  'agentCard.unclaimed': 'Unclaimed',
  'agentCard.metaBlocked': '{who} · blocked by {titles}',
  'agentCard.titleSep': ', ',
  'agentCard.blockedTitle': '{term}: {titles}',
  'agentCard.blockedTag': '(blocked)',
  'agentQueue.title': '⚡ {term} — what to do next',
  'agentQueue.cyclicWarning':
    '{count} tasks form a dependency cycle (deps referencing each other) and were excluded from the Ready queue. Fix the deps in the task detail and refresh.',
  'agentQueue.empty':
    'No Ready tasks to work on right now. Import via “{term}”, or move a task to ready and it shows up here.',
  'agentQueue.claim': 'Claim',
  'agentQueue.blockedTitle': 'Leave these alone for now (blocked: {count})',
  'agentQueue.blockedByQuote': '“{title}”',
  'agentQueue.blockedBySep': ', ',
  'agentSource.empty':
    'No agent-sourced tasks yet (after importing a payload, this groups by agentKind)',
  'agentSource.seatsPre': 'Agent seats used: ',
  'agentSource.seatsPost': '/{limit}',
  'agentSource.seatsOver': '(over the free allowance — informational only)',
  'agentProposal.notProvided': 'Not provided',
  'agentProposal.emptyValue': '(empty)',
  'agentProposal.reviewAria': 'Writeback proposal review',
  'agentProposal.pendingTitle': 'Pending proposals ({count})',
  'agentProposal.picked': '{count} selected',
  'agentProposal.approveAll': 'Approve selected',
  'agentProposal.rejectAll': 'Reject selected',
  'agentProposal.selectAria': 'Select proposal {id}',
  'agentProposal.noReason': '(no reason given)',
  'agentProposal.confidence': 'Confidence {value}',
  'agentProposal.expandAria': 'Expand change details',
  'agentProposal.collapseAria': 'Collapse change details',
  'agentProposal.approveAria': 'Approve proposal {id}',
  'agentProposal.rejectAria': 'Reject proposal {id}',
  /* ───── Execution console page (AgentExecutionConsolePage, ⑤b-④) ───── */
  'agentConsole.contradiction.live':
    'Data contradiction: the execution has finished, yet an attempt still shows “running”',
  'agentConsole.contradiction.pending':
    'Data contradiction: the execution has finished, yet an attempt is still “queued”',
  'agentConsole.contradictionHint':
    'These records are unfinished attempts left on a terminal execution (usually the process was killed, or a backup restore bypassed the status checks). The state machine has no legal transition to close them, so they are kept as-is and only flagged for recognition.',
  'agentConsole.execStatus.draft': 'Draft',
  'agentConsole.execStatus.awaitingConfirmation': 'Awaiting confirmation',
  'agentConsole.execStatus.queued': 'Queued',
  'agentConsole.execStatus.running': 'Running',
  'agentConsole.execStatus.paused': 'Paused',
  'agentConsole.execStatus.needsAttention': 'Needs attention',
  'agentConsole.execStatus.awaitingReview': 'Awaiting review',
  'agentConsole.execStatus.completed': 'Completed',
  'agentConsole.execStatus.failed': 'Failed',
  'agentConsole.execStatus.cancelled': 'Cancelled',
  'agentConsole.attemptStatus.queued': 'Queued',
  'agentConsole.attemptStatus.running': 'Running',
  'agentConsole.attemptStatus.succeeded': 'Succeeded',
  'agentConsole.attemptStatus.failed': 'Failed',
  'agentConsole.attemptStatus.cancelled': 'Cancelled',
  'agentConsole.attemptStatus.interrupted': 'Interrupted',
  'agentConsole.proposalStatus.draft': 'Draft',
  'agentConsole.proposalStatus.proposed': 'Ready to apply',
  'agentConsole.proposalStatus.applied': 'Applied',
  'agentConsole.proposalStatus.rejected': 'Rejected',
  'agentConsole.proposalStatus.conflict': 'Conflict',
  'agentConsole.actor.user': 'Human',
  'agentConsole.actor.agent': 'Agent',
  'agentConsole.actor.system': 'System',
  'agentConsole.actor.external': 'External',
  'agentConsole.source.projectTask': 'Project task',
  'agentConsole.source.memberBoard': 'Member board',
  'agentConsole.source.manual': 'Manual',
  'agentConsole.attemptNoSuffix': ' (attempt #{n})',
  'agentConsole.attemptNo': 'Attempt #{n}',
  'agentConsole.minutes': '{mins} min',
  'agentConsole.terminalReason': 'Ended because: {reason}',
  'agentConsole.reason': 'Reason: {reason}',
  'agentConsole.blockedReason': 'Blocked: {reason}',
  'agentConsole.decidedBy': 'Decided by {name}',
  'agentConsole.noDecision': 'Not decided yet',
  'agentConsole.loadingDetail': 'Loading execution detail…',
  'agentConsole.loadingList': 'Loading execution records…',
  'agentConsole.listLoadFailed': 'Failed to load execution records.',
  'agentConsole.listFailedTitle': 'Failed to load execution records',
  'agentConsole.detailGone':
    'This execution no longer exists (it may have been deleted). The detail data that is still available is shown below.',
  'agentConsole.detailLoadFailed': 'Failed to load execution detail.',
  'agentConsole.retry': 'Retry',
  'agentConsole.refresh': 'Refresh',
  'agentConsole.section.attempts': 'Attempts',
  'agentConsole.section.events': 'Event log',
  'agentConsole.section.proposals': 'Writeback proposals',
  'agentConsole.empty.attempts': 'No attempts yet.',
  'agentConsole.empty.events': 'No events yet.',
  'agentConsole.empty.proposals': 'No writeback proposals yet.',
  'agentConsole.field.created': 'Created',
  'agentConsole.field.started': 'Started',
  'agentConsole.field.finished': 'Finished',
  'agentConsole.field.duration': 'Duration',
  'agentConsole.title': 'Execution console',
  'agentConsole.subtitle': 'Read-only · {count} execution records',
  'agentConsole.hiddenCount': ' · {count} contradictory records hidden',
  'agentConsole.attentionCount': ' · {count} need attention',
  'agentConsole.showContradictions': 'Show contradictory data',
  'agentConsole.recordsCount': '{count} records',
  'agentConsole.emptyVisibleTitle': 'No execution records can be shown right now',
  'agentConsole.emptyAllHidden':
    'The library has {count} execution records; all of them were judged contradictory and are hidden by your setting.',
  'agentConsole.emptyAllHiddenHint':
    'Turn on the “Show contradictory data” switch in the top-right corner to see them.',
  'agentConsole.emptyNoneTitle': 'No execution records yet',
  'agentConsole.emptyNoneBody1':
    'When an agent or a person starts an execution from a project or member board, the execution appears here.',
  'agentConsole.emptyNoneBody2': 'You are seeing an empty view, which means no execution has been created yet.',
  /* ───────────────────── Project details ───────────────────── */
  'project.notFound': 'Project not found (it may have been archived or deleted).',
  'project.backToList': '← Back to project list',
  'project.noRelatedStages': 'None of this project\'s stages concern you.',
  'project.needIdentity': 'Go to the bottom of the left-hand navigation to pick your identity, then view the project.',
  'project.backToMyTasks': 'Back to My Tasks',
  'project.backToHome': 'Back to home',
  'project.printPreviewTitle': 'Print preview (in-app panel)',
  'project.schedule': 'Schedule',
  'project.openInAgentTitle': 'Open in that Agent workspace',
  'project.takeoverTitle': 'Turn it into a formal project, or move its tasks into a human project',
  'project.takeover': 'Take over',
  'project.archived': 'Archived',
  'project.archiveHint': 'Archiving hides it from the home list',
  'project.archive': 'Archive',
  'project.client': 'Client: {name}',
  'project.totalDays': '· {days} days total',
  'project.currentStage': 'Now: ',
  'project.itineraryHint':
    'The client itinerary lists transport, lodging, plans and costs day by day — send it to the client or print it directly.',
  'project.itineraryTitle': 'Open the client itinerary (new window, read-only export)',
  'project.itinerary': 'Client itinerary',

  /* ───────────── Agent board · status note box (data-agent-stance) ───────────── */
  'agent.stanceBefore': 'The Agent board currently ',
  'agent.stanceStrong': 'only carries schedules from external writers ',
  'agent.stanceNl':
    '(local auto-import is available; NAS remote write is not enabled yet). This area is being redefined based on your feedback.',
  /* ───────────── Calendar empty states (E1–E4) ───────────── */
  'calendar.empty.body': 'Create a project and get its stage schedule running',
  'calendar.empty.monthNoActive': '{month} — nothing in progress',
  'calendar.empty.tryAdjacent': 'Try switching to an adjacent month',
  'calendar.empty.stageNo': 'Stage {n}',
  'calendar.empty.noFilterMatch': 'No project matches the current filters',
  'calendar.empty.clearFilter': 'Clear filters',
  'calendar.empty.stageTimeline': 'Stage timeline',
  'calendar.empty.clientPrefix': 'Client: ',
  'calendar.empty.period': '· Period',
  'calendar.empty.noRelated': "None of this project's stages concern you",
  'calendar.empty.noRelatedBody': 'You can view the project overview, or contact the project owner',

  /* ───────────────────── Agent board list empty state ───────────────────── */
  'agentList.emptyAria': 'Agent boards (none)',
  'agentList.emptyTitle': 'No Agent boards yet',
  'agentList.scopeLine':
    'Only schedules from external writers (such as WorkBuddy) live here — never mixed with “My Projects”. ',
  'agentList.canCreate':
    'You can create a board yourself, or connect an external writer and let it create one for you.',
  'agentList.writerOnly':
    'Once an external writer is connected, it creates boards and writes tasks here directly.',
  'agentList.statusLine':
    'Status: local auto-import (Windows desktop) works; NAS remote write is not enabled yet. ',
  'agentList.redefineLine':
    'This area is being redefined based on your feedback and may change substantially.',
  'agentList.createButton': 'New Agent board',
  'agentList.listAria': 'Agent board list',

  /* ───────────── Payload import panel · prompt guidance (ApplyPayloadPanel A2) ───────────── */
  'agentPayload.promptAsk': "Not sure what to have WorkBuddy / Codex produce? Copy this prompt to it",
  'agentPayload.promptSend':
    'Send it to the external agent together with your requirements — it will produce JSON in ID Plan’s import format; ',
  'agentPayload.promptPaste':
    'paste that JSON into the input area below (pasting previews it — no separate “validate” click).',
  /* Hint box, three sentences (`:238-240`). 段尾空格是**载荷**，见文件头 ⑤ */
  'agentPayload.hintPastePre': 'You can now ',
  'agentPayload.hintPasteStrong': 'paste or drop in ',
  'agentPayload.hintPastePost': 'a schedule file (the input area below is ready).',
  'agentPayload.hintDesktopPre': 'On the Windows desktop build, ',
  'agentPayload.hintDesktopStrong': 'local automatic import ',
  'agentPayload.hintDesktopPost': 'can be configured under “Import tasks”;',
  'agentPayload.hintNas':
    'remote automatic write over NAS is not enabled yet — do not treat connectivity probing as an import-ready state.',
  /* Copy button, two states (`:279`) */
  'agentPayload.copyPrompt': 'Copy prompt',
  'agentPayload.copyPromptDone': 'Prompt copied',
  /* Token note (`:301-302`, two strongs). 段尾空格是**载荷**，见文件头 ⑤ */
  'agentPayload.tokenPre': 'The prompt does ',
  'agentPayload.tokenStrongA': 'not contain the access token',
  'agentPayload.tokenMid': ': the token is used only by the ',
  'agentPayload.tokenStrongB': 'automatic write ',
  'agentPayload.tokenTail':
    'channel (set and copy it there) — do not paste it into the agent chat window.',
  /* Input area (`:323` placeholder with `{schema}`; `:333/339/341` are flex items) */
  'agentPayload.pastePlaceholder': 'Paste payload JSON, or drop in a .json / .md file…\n({schema})',
  'agentPayload.dropOr': 'Drop a file, or',
  'agentPayload.chooseFile': 'choose a file',
  'agentPayload.afterPaste': 'A diff preview appears automatically once you paste.',
  /* Validation failure block (`:359` / `:367` with `{count}`) */
  'agentPayload.invalidTitle': 'Payload validation failed (nothing was written)',
  'agentPayload.moreErrors': '…and {count} more errors not shown.',
  'agentPayload.parseFailed': 'Parse failed',
  'agentPayload.dropUnsupported':
    'Only plain-text .json / .md files are supported (have the agent convert pdf/docx to a payload first).',
  /* State 3 buttons (`:425` / `:433`) */
  'agentPayload.editAgain': 'Edit again',
  'agentPayload.writing': 'Writing…',
  'agentPayload.confirmWrite': 'Confirm write',
  /* ───────────────────── Backup / restore toasts (useBackupIo) ───────────────────── */
  'backup.toast.saved': 'Backup package saved',
  'backup.toast.exportFailed': 'Backup export failed.',
  'backup.toast.demoFailed': 'Failed to load the sample data — nothing was changed.',
  'backup.toast.verifyFailed': 'Backup file failed validation — nothing was changed.',
  'backup.toast.restoreFailed': 'Restore failed — your local data is unaffected.',
  /* ───────────── Backup / restore confirm dialog ───────────── */
  'backup.dialog.loadDemoTitle': 'Load the sample projects',
  'backup.dialog.restoreTitle': 'Restore from backup',
  'backup.dialog.confirmLoad': 'Confirm load',
  'backup.dialog.confirmRestore': 'Confirm restore',
  'backup.dialog.demo1': 'This will load ',
  'backup.dialog.demoStrong': '5 demo projects',
  'backup.dialog.demo2': ' (replacing everything), ',
  'backup.dialog.replaceStrong': 'replacing all current data with no undo',
  'backup.dialog.demo3':
    '. A library with no real data is safe to load; if you have real data, save a backup first.',
  'backup.dialog.restore1': 'Restoring means ',
  'backup.dialog.restore2':
    '. Save a backup first, then confirm the restore.',
  'backup.dialog.filePrefix': 'File: ',
  'backup.dialog.noPasswordHash':
    '⚠ This backup contains no password hashes ({count} members have a password) — they will need to reset it after import.',
  /* ───────────────────── Members section ───────────────────── */
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'member.sectionTitle': 'Members',
  'member.showAgents': 'Show Agents ({count}/3)',
  'member.addMember': 'Add member',
  'member.typeLabel': 'Type',
  'member.typeHuman': '👤 Human',
  'member.seatHint': 'Agent seats used {count}/3 (over the limit is a warning only, not a block)',
  'member.namePlaceholder': 'Name *',
  'member.rolePlaceholder': 'Role (e.g. lead)',
  'member.contactPlaceholder': 'Contact',
  'member.agentKindPlaceholder': 'agentKind (e.g. workbuddy / codex)',
  'member.add': 'Add',
  'member.empty':
    'No members yet. Once added, you can assign tasks in the stage list; go to the bottom of the left-hand navigation to pick your identity and see “My Tasks”.',
  'member.demoteTitle': 'Revoke admin',
  'member.demoteConfirm': 'Confirm revoke',
  'member.demoteBodyBefore': 'Revoke ',
  'member.demoteBodyAfter':
    ' to a regular member: they lose admin rights immediately and will only see what is assigned to them.',
  'member.toastLastAdmin': 'The system needs at least one admin — cannot revoke',
  'member.toastDemoted': 'Admin rights revoked',
  'member.toastDemoteFailed': 'Revoke failed, please retry.',
  'member.pwTitle': 'Set password',
  'member.pwChangeTitle': 'Change password for “{name}”',
  'member.pwSetTitle': 'Set password for “{name}”',
  'member.pwHintChange':
    'Entering a new password resets it; leave it empty and click “Clear password” and this member can enter without one.',
  'member.pwHintSet':
    'After you set a password, this member signs in with it after entering their name. Leave it empty and click “Clear password” to require none.',
  'member.pwPlaceholder': 'New password (leave empty to keep)',
  'member.pwClear': 'Clear password',
  'member.pwSaveNew': 'Save new password',
  'member.toastPwEmpty': 'Enter a new password first, or use “Clear password”.',
  'member.toastPwSet': 'Login password set for “{name}”',
  'member.toastPwCleared': 'Password cleared for this member',
  'member.rowNamePlaceholder': 'Name',
  'member.hasPassword': 'Has password',
  'member.noPassword': 'No password',
  'member.adminBadge': 'Admin',
  'member.openBoardTitle': 'View this member’s board',
  'member.promote': 'Make admin',
  'member.lastAdminTitle': 'The system needs at least one admin',
  'member.demote': 'Revoke admin',
  'member.pwActionTitleChange': 'Change / clear password',
  'member.password': 'Password',
  'member.rename': 'Rename',
  'member.deactivateTitle': 'Deactivate member',
  'member.reactivateTitle': 'Reactivate',
  'member.deactivate': 'Deactivate',
  'member.reactivate': 'Reactivate',
  /* ─────────────────── Timeline toolbar ─────────────────── */
  'timeline.hint': 'Tip: drag a bar edge to reschedule; ←/→ pan the timeline (hold Shift to speed up)',
  'timeline.zoom.month': 'Month',
  'timeline.zoom.halfMonth': 'Fortnight',
  'timeline.aria': 'Nine-stage timeline',

  /* ─────────────────── Calendar toolbar ─────────────────── */
  'calendar.density.month': 'Month',
  'calendar.density.week': 'Week',
  'calendar.density.agenda': 'Agenda',
  'calendar.prevMonth': 'Previous month',
  'calendar.nextMonth': 'Next month',
  'calendar.today': 'Today',
  'calendar.densityAria': 'Calendar density',
  'calendar.thisWeek': 'this week (Mon ~ Sun)',
  'calendar.view': 'View',
  'calendar.lunarPlaceholder': 'Lunar calendar (placeholder)',

  /* ───────── Agent terms（agentTerm.* · 13 keys × 2 modes · #354）─────────
   * human = for designers / PMs（「Stage」「Import task」）;
   * tech  = for Agents / engineers（「Batch」「Apply payload」）.
   * ⚠️ 英文侧有几处两列**故意重合**（`timeline` / `client` / `onsite` / `board` /
   *    `blockedBy`）—— 英文里这两类读者本来就该看到同一个词，硬造差异更坏。
   *    逐键理由见 `src/i18n/labels.ts` 的 `MODE_COLLAPSED_KEYS`（登记 + 反例自证）。
   * ─────────────────────────────────────────────────────────────────────── */
  'agentTerm.stage.human': 'Stage',
  'agentTerm.stage.tech': 'Batch',
  'agentTerm.stageShort.human': 'Stage',
  'agentTerm.stageShort.tech': 'Batch',
  'agentTerm.applyPayload.human': 'Import task',
  'agentTerm.applyPayload.tech': 'Apply payload',
  'agentTerm.ready.human': 'To-do',
  'agentTerm.ready.tech': 'Ready',
  'agentTerm.handoff.human': 'Handoff pack',
  'agentTerm.handoff.tech': 'handoff bundle',
  'agentTerm.artifacts.human': 'Deliverables',
  'agentTerm.artifacts.tech': 'artifacts (deliverables)',
  'agentTerm.deps.human': 'Dependencies',
  'agentTerm.deps.tech': 'deps (dependencies)',
  'agentTerm.timeline.human': 'Timeline',
  'agentTerm.timeline.tech': 'Timeline',
  'agentTerm.client.human': 'Client',
  'agentTerm.client.tech': 'Client',
  'agentTerm.onsite.human': 'On-site',
  'agentTerm.onsite.tech': 'On-site',
  'agentTerm.board.human': 'Agent Board',
  'agentTerm.board.tech': 'Agent Board',
  'agentTerm.claimedBy.human': 'Owner',
  'agentTerm.claimedBy.tech': 'claimed by',
  'agentTerm.blockedBy.human': 'Blocked by',
  'agentTerm.blockedBy.tech': 'blocked by',

  /* ───────── Takeover confirm dialog (TransferDialog) ─────────
   * 段间空格落在取值里（JSX 相邻表达式容器之间没有空白）。
   * ⚠️ 两个 `*Hint` 取值**以空格开头**：它们在 JSX 里的左邻居是硬编码的 ` *` 必填标记
   *    （`<span> *{t('…Hint')}</span>`），左段不是取值 ⇒ 空格只能落在右段开头
   *    （zh.ts 文件头规则 ⑤ 的那条例外）。
   * zh 侧保留了两处既有小瑕疵（`**` 明文星号、`，` 后的多余空格），英文侧**同形保留**：
   * 那是同一次界面行为，要不要修是另一笔的裁决，不在「翻译」里夹带。 */
  'agentTransfer.aria': 'Take over an Agent board',
  'agentTransfer.title': 'Take over “{name}”',
  'agentTransfer.cancelAria': 'Cancel takeover',
  'agentTransfer.warning':
    'Takeover moves this board’s data **into the human workspace**, after which it is managed on the “My projects” side. Only admins can do this.',
  'agentTransfer.modeLegend': 'Takeover method',
  'agentTransfer.mode.convert.label': 'Convert to a full project',
  'agentTransfer.mode.convert.hint':
    'The whole board becomes a project in the human workspace (name and stages kept).',
  'agentTransfer.mode.move.label': 'Move tasks',
  'agentTransfer.mode.move.hint':
    'Move the selected tasks into an existing human project (a landing stage is required).',
  'agentTransfer.target': 'Target project',
  'agentTransfer.targetHint': ' (human-workspace projects only)',
  'agentTransfer.noTarget':
    'There are no projects in the human workspace yet. Create one first, or switch to “Convert to a full project”.',
  'agentTransfer.targetPlaceholder': '(choose a target project)',
  'agentTransfer.stage': 'Landing stage',
  'agentTransfer.stageHint': ' (no stage is created automatically)',
  'agentTransfer.pickTargetFirst': 'Choose a target project first.',
  'agentTransfer.noStage':
    'The target project has no stages yet; add stages on its detail page first.',
  'agentTransfer.stagePlaceholder': '(choose a landing stage)',
  'agentTransfer.tasks': 'Tasks to move',
  /*
   * ⚠️ 这个取值的**开头有一个空格**，不是手滑：它在 JSX 里的左邻居是一个**硬编码的
   *    ` *` 必填标记**（`<span className="text-sm">{t('…tasks')}<span> *</span></span>`），
   *    行内元素被折成一个单元后左段的文字以 `*` 结尾 ⇒ 按「左段不是取值时空格落右段开头」
   *    的惯例，空格只能在这里。中文侧不需要（汉字前不加空格）。
   *    本行是 `tests/i18n-jsx-space.spec.ts` 的 en 侧全仓扫描**当场报出来的**（首跑红 1 处）。
   */
  'agentTransfer.selectedCount': ' {selected} of {total} selected',
  'agentTransfer.noTask': 'This board has no tasks yet — nothing to move.',
  'agentTransfer.preview.convert':
    'Preview: turn board “{board}” into a full project in the human workspace ({count} tasks move with it).',
  'agentTransfer.preview.movePre': 'Preview: move the ',
  'agentTransfer.preview.moveMid': ' selected tasks from “{board}” into ',
  'agentTransfer.preview.moveCreate': ', creating ',
  'agentTransfer.preview.moveUpdate': ' and updating ',
  'agentTransfer.preview.moveTail':
    ' (the target project already has tasks with the same external ids).',
  'agentTransfer.noTargetSelected': '(no target project selected)',
  'agentTransfer.dropped.head':
    'Dropping {count} dangling dependencies (their predecessors are not moved with this batch; keeping them would make those tasks look ready to start):',
  'agentTransfer.dropped.row': '· “{task}” no longer depends on “{dep}”',
  'agentTransfer.sourceSide':
    'The source board also has {dropped} dependencies pointing at the moved tasks; they will be stripped as well (affecting {rewired} remaining tasks).',
  'agentTransfer.pickAtLeastOne': 'Select at least one task.',
  'agentTransfer.preview.plainPre': 'Preview: move the ',
  'agentTransfer.preview.plainMid': ' selected tasks from “{board}” into ',
  'agentTransfer.preview.plainTail':
    '. Once you pick a target project and a landing stage, this area lists what will be created, updated, and dropped.',
  'agentTransfer.submitting': 'Working…',
  'agentTransfer.confirm': 'Confirm takeover',
  'agentTransfer.failed': 'Takeover failed, please try again.',

  /* ───────── Plugin sandbox host (PluginSandboxFrame) ───────── */
  'plugin.frame.loadFailed': 'Plugin failed to load: {error}',
  'plugin.frame.readyTimeout':
    'The plugin was not ready within 3 seconds — its entry file never declared window.IDPlanPlugin.mount, or its bundle failed to load.',
  'plugin.frame.localInstall': 'Member-installed',
  'plugin.frame.backToApp': 'Back to app',

  /* ───────── agent-board plugin's own settings (AgentSettingsPanel) ───────── */
  'agentSettings.seatRowLabel': 'Agent seats',
  'agentSettings.seatUsed': 'In use {used}/{limit}',
  'agentSettings.seatOver': 'Over the free seat allowance ({limit}) — this does not block anything, it is a notice.',
  'agentSettings.dbUsageLabel': 'Local DB usage',
  'agentSettings.dbUsageEstimated': '(estimated)',
  'agentSettings.dbUsageHint':
    'Once a single DB grows past roughly 50MB, cleanup / split suggestions will appear here.',
  'agentSettings.ingress.lead': 'External Agents use ',
  'agentSettings.ingress.strong': 'structured commands',
  'agentSettings.ingress.tail':
    ' over the loopback address to reach ID Plan; natural language is parsed by the Agent side — ID Plan does not parse natural language and does not call any LLM. The access address and token are generated and managed in the Agent board’s ingress panel, so they are not repeated here.',
  'agentSettings.boardHint':
    'The Agent board is the AI workspace: execution records, the ingress panel and the task queue all live there.',
  'agentSettings.openBoard': 'Open Agent board',

  /* ═════════ Settings drawer · the four zones' body copy (笔 1-②) ═════════ */
  'settings.schedule.basisPre': 'The scheduling basis (calendar days / workdays) is ',
  /* 段尾空格：下一段（basisTail）在英文里要接着读，而中文侧那里不能有空格 */
  'settings.schedule.basisStrong': 'project-level ',
  'settings.schedule.basisTail':
    'set when you create the project, in the stage picker; it is then saved with that project and this page has no global default. The calendar week starts on Monday, and that is not switchable yet.',

  'settings.data.wherePre': 'Your data lives ',
  'settings.data.whereNas': 'on your NAS',
  'settings.data.whereLocal': 'on this computer',
  'settings.data.addressLead': ' (server address: ',
  'settings.data.notConfigured': '(not configured)',
  'settings.data.whereTail': '). Backups are JSON files saved wherever you choose.',
  'settings.data.localTail':
    ' (inside this computer’s app data, never uploaded). Backups are JSON files saved wherever you choose.',

  'settings.data.saveBackup': 'Save backup',
  'settings.data.loadBackup': 'Import backup',
  'settings.data.backupHint':
    'Save backup = export all data as a JSON file; Import backup = replace all current data from a JSON file (no undo, so keep a copy first).',

  'settings.log.count': '{count} entries',
  'settings.log.emptyLead': 'No log entries yet. By default this log only records',
  /* 段尾空格：中文「报错时**或**执行关键操作」之间不加空格，英文必须加 ——
   * 该接缝在 JSX 里没有 `{' '}`（原文中文就靠 CJK 直接相邻），故空格只能落在取值尾部 */
  'settings.log.emptyOnError': 'errors ',
  'settings.log.emptyOr': 'or',
  'settings.log.emptyKeyOps': 'key actions',
  'settings.log.emptyTail':
    ' (identity switching, backup import/export). Normal browsing produces no entries, which is expected. When you run into something like “the IME types no characters”, reproduce it once and then come back to export.',
  'settings.log.recordedPre': 'Recorded ',
  'settings.log.recordedTail':
    ' runtime events, exportable as a .log file to send to the developer. The log contains only runtime records and error stacks — no project or customer business data.',
  'settings.log.export': 'Export log',
  'settings.log.clear': 'Clear log',
  'settings.log.clearConfirm': 'Clear',
  'settings.log.clearPre': 'Clear the current ',
  'settings.log.clearTail':
    ' frontend log entries. This cannot be undone; if you are troubleshooting, export them first.',
  'settings.log.toastExported': 'Log exported ({count} entries)',
  'settings.log.toastCleared': 'Log cleared',

  'settings.update.checking': 'Checking…',
  'settings.update.check': 'Check for updates',
  'settings.update.upToDate': 'You are on the latest version ({version}).',
  'settings.update.hasUpdate': 'New version {version} available',
  'settings.update.download': 'Go to download',
  'settings.update.failed': 'Check failed: {error}',

  'settings.about.version': 'Version',
  'settings.about.license': 'License',
  'settings.about.betaNote': 'Beta build — features and data formats may still change.',
  'settings.about.frontend': 'Frontend',
  'settings.about.packaging': 'Packaged',
  /* 段尾空格：后面紧跟的是仓库 URL 链接（原文中文用全角「：」直接接，英文要留一格） */
  'settings.about.issueLead': 'Found a bug? Please file a GitHub issue: ',

  'settings.support.wechatTitle': 'Support the author',
  'settings.support.wechatCaption': 'If this tool saves you time, you can buy me a coffee.',
  'settings.support.feedbackTitle': 'Feedback',
  'settings.support.feedbackCaption':
    'Scan the code to tell me what feels off, or which feature you want next.',
};
