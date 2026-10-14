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
    'Takeover moves this board’s data into the human workspace, after which it is managed on the “My projects” side. Only admins can do this.',
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

  /* ═════════ Settings ▸ Plugins (PluginsSection, 笔 1-③) ═════════ */
  'plugin.title': 'Plugins',
  'plugin.count': '{installed} installed · {enabled} enabled',
  /* 与 zh 同形保留明文星号（那是原文的显示缺陷，不是翻译问题；改动会破坏 zh 逐字证明） */
  'plugin.intro':
    'Plugins are functional bundles you can toggle individually. Disabling one hides its pages and sidebar entry right away (data is kept and comes back when you re-enable it); the plugin card stays in the list below, and its gear opens its own settings. Toggle state is stored in the local / NAS settings and survives a restart. Third-party plugins can be installed from a file (restart required, disabled by default, and you are shown its permissions before installing).',
  'plugin.adminNotice':
    'The plugin switch is a NAS-wide setting and only admins can change it; members can see the current state and each plugin’s own settings.',
  'plugin.installFromFile': 'Install from file',
  'plugin.pick.title': 'Choose the plugin manifest.json',
  'plugin.pick.filterName': 'Plugin manifest',
  'plugin.install.unsupportedEnv':
    'Installing from a file is not supported in this environment (desktop app only)',
  'plugin.skipped': '{count} local plugin folders were skipped (incomplete manifest or unsupported version).',
  'plugin.capLabel': 'Capabilities: ',
  'plugin.contribLabel': 'Contributes: ',
  'plugin.notExplicit': '(not set manually · {state} by default)',
  'plugin.stateOn': 'enabled',
  'plugin.stateOff': 'disabled',
  'plugin.empty': 'This build ships with no plugins.',
  'plugin.settingsDisabledHint':
    '“{name}” is currently disabled — enable it and its own settings will appear here.',
  'plugin.uninstallAria': 'Uninstall plugin {name}',
  'plugin.settingsAria': 'Settings for {name}',
  'plugin.settingsTitleOn': 'Open “{name}”’s own settings',
  'plugin.settingsTitleOff': 'This plugin has no settings of its own',
  'plugin.toggleAriaDisable': 'Disable plugin {name}',
  'plugin.toggleAriaEnable': 'Enable plugin {name}',
  'plugin.toggleTitleAdminOnly':
    'The plugin switch is a NAS-wide setting and only admins can change it',

  'plugin.contrib.pages': '{count} pages',
  'plugin.contrib.nav': '{count} sidebar entries',
  'plugin.contrib.settings': 'a settings block',
  'plugin.contrib.fullPage': 'a full-page sandbox UI',
  'plugin.contrib.none': 'no UI contribution (data / tool plugin)',
  'plugin.cap.none': 'No data capabilities required',
  'plugin.cap.readOnly': 'Read-only access to your project data (cannot write)',
  'plugin.source.builtin': 'Bundled',
  'plugin.source.member': 'Member-installed',

  'plugin.toggleFail.storage':
    'Save failed, the switch did not take effect — local storage is not writable. Check the browser’s storage permission and retry.',
  'plugin.toggleFail.noToken':
    'No access token configured: this NAS requires writes to carry a token. Go to Settings → NAS service, fill it in and retry.',
  'plugin.toggleFail.remote': 'The server rejected the write, or the server is unreachable: {reason}',
  'plugin.toggleFail.generic': 'Save failed, the switch did not take effect: {reason}',

  'plugin.disclosure.lead': 'The code you are about to run comes from ',
  'plugin.disclosure.strongFile': 'a file you picked',
  'plugin.disclosure.nameSuffix': ' (“{name}”)',
  'plugin.disclosure.tail':
    ' — it is installed only on this computer, and it runs only on this computer.',
  'plugin.disclosure.readLead': 'It can ',
  'plugin.disclosure.readStrong': 'read',
  'plugin.disclosure.readMid': ' your project data (projects / stages / tasks), and it ',
  'plugin.disclosure.readDeny': 'cannot write',
  'plugin.disclosure.readTail': ';',
  'plugin.disclosure.sandbox':
    'It runs in a sandbox and cannot reach your other data (login credentials and other plugins’ data are out of its reach);',
  'plugin.disclosure.netLead': 'but it ',
  'plugin.disclosure.netStrong': 'can access the network',
  'plugin.disclosure.netTail':
    ' — v1 does not restrict its egress, so only install plugins from sources you trust;',
  'plugin.disclosure.effect':
    'Restart required after install; new plugins are disabled by default — installing and enabling are two different things.',

  'plugin.confirmRun.title': 'Run code from a file',
  'plugin.confirmRun.confirm': 'I trust this file, continue',
  'plugin.confirmUninstall.title': 'Uninstall plugin',
  'plugin.confirmUninstall.confirm': 'Uninstall',
  'plugin.confirmUninstall.bodyPre': 'All files of “',
  'plugin.confirmUninstall.bodyTail':
    '” will be deleted and the plugin will be disabled. This cannot be undone; after a restart it disappears from the list (the data it read is unaffected — plugins cannot write anyway).',

  'plugin.err.conflictToggle':
    'This setting was changed on another device. Refresh and retry (nothing was written this time; what you see may be someone else’s new value).',
  'plugin.err.conflictShort': 'This setting was changed on another device. Refresh and retry.',
  'plugin.err.notDesktop':
    'Installing from a file is not supported in this environment (desktop only).',
  'plugin.err.installFailed': 'Install failed: {reason}',
  'plugin.err.installPartial':
    '“{name}” was installed, but the “disabled by default” state could not be saved: {reason}',
  'plugin.err.installNoResponse': 'Install failed: the main process did not respond',
  'plugin.err.uninstallAbortedConflict':
    'Uninstall aborted: this setting was changed on another device. Refresh and retry.',
  'plugin.err.uninstallAborted': 'Uninstall aborted — could not disable this plugin first: {reason}',
  'plugin.err.uninstallFailed': 'Uninstall failed: {reason}',
  'plugin.err.uninstallNoResponse': 'Uninstall failed: the main process did not respond',
  'plugin.err.mainNoResponse': 'the main process did not respond',
  'plugin.notice.installed':
    'Installed “{name}” v{version} ({count} files) — takes effect after a restart, disabled by default',
  'plugin.notice.uninstalled': 'Uninstalled “{name}” — it disappears from the list after a restart',
  'plugin.toast.installed': 'Plugin “{name}” installed; takes effect after a restart',
  'plugin.toast.uninstalled': 'Plugin “{name}” uninstalled',

  /* ══════════════ 笔 1-④：Settings ▸ Industry & Templates ▸ Custom industry library ══════════════ */
  /* ⚠️ `library.step.*` 三条的前导空格是**必需的**：它们紧跟在 JSX 里的硬编码序号
     `<span>①</span>` 之后，而中文态那里不能有空格（`①复制提示词`）⇒ 空格只能放英文取值
     （见本文件头 ⑤ 的「例外」）。`library.introPost` 同理由 `<code>usr.</code>` 引出。 */
  'library.title': 'Custom industry library',
  'library.step.copy': ' Copy the prompt',
  'library.step.agent': ' Send it to your Agent and have it reply with a single JSON',
  'library.step.back': ' Import it back here',
  'library.introPre':
    'Import a custom industry library (JSON ≤ {size}): your own stages and presets, shown under the chosen industry when creating a project. Stage keys must start with ',
  'library.introPost': ' to be accepted.',
  'library.noteLabel': 'Describe your industry in one sentence',
  'library.notePlaceholder':
    'Describe your industry in one sentence (optional; it is appended to the prompt)',
  'library.copyPrompt': 'Copy prompt',
  'library.import': 'Import library',
  'library.importAria': 'Import industry library',
  'library.attachRef': 'Attach my current libraries ({count}) as reference',
  'library.flash.copied':
    'Prompt copied — paste it to your Agent and have it reply with a single JSON',
  'library.flash.copyFailed':
    'Copy failed: the browser did not grant clipboard access. Select the text and copy it manually.',
  'library.flash.errorsCopied':
    'Error list copied — paste it back to your Agent to fix them one by one',
  'library.err.tooLarge': 'The file exceeds the {max} limit (currently {size}KB)',
  'library.err.notJson':
    'This file is not valid JSON — your Agent probably printed explanation text around the JSON',
  'library.err.persistFailed':
    'Failed to write to local storage (possibly out of space). The library was not imported.',
  'library.exported': 'Exported “{name}.json”',
  'library.importedCard':
    'Imported “{name}”: {items} stages · {presets} presets · filed under the “{domain}” domain — pick “{domain}” when creating a project to see it. Importing the same name again updates this pack.',
  'library.closeSuccessAria': 'Dismiss the import success message',
  'library.copyAllErrors': 'Copy all errors and paste them back to your Agent',
  'library.rowMeta': '{items} stages · {presets} presets · {domain}',
  'library.exportAria': 'Export industry library {name}',
  'library.removeAria': 'Delete industry library {name}',
  'library.empty':
    'No industry library imported yet. Presets for the 9 built-in domains ship with the app.',

  /* ══════════ 笔 1-⑤：Rest policy（entry / editor / recalc confirm dialog） ══════════ */
  'restPolicy.entryTitle': 'Company rest policy (two days off / one day off / alternating weeks)',
  'restPolicy.dialogAria': 'Company rest policy',
  'restPolicy.dialogTitle': 'Company rest policy',
  'restPolicy.intro':
    'Decides which days are workdays across the system (calendar shading, timeline rest bands, reschedule snapping, and duration accounting).',
  'restPolicy.holidays.label': 'Skip Chinese public holidays (including make-up workdays)',
  'restPolicy.holidays.note':
    'Bundled public-holiday and make-up-workday schedule for {years} (source: annual notice of the General Office of the State Council); updated with new releases once next year’s schedule is published. When it is on, saving can recalculate already-scheduled stages under the new rules (a confirmation preview appears first).',
  'restPolicy.single.lead': 'Single rest day = ',
  'restPolicy.single.tail': ' (only this day off each week)',
  'restPolicy.single.restoreTitle': 'Restore the factory default: Sunday off',
  'restPolicy.single.restore': 'Restore default (Sunday)',
  'restPolicy.single.note':
    'Default is Sunday (matching historical behaviour). After switching to a single weekday off, saving can recalculate already-scheduled stages under the new rules.',
  'restPolicy.double.lead': 'Double rest days =',
  'restPolicy.double.tail': ' ({days} off each week)',
  'restPolicy.double.twoDays': 'two days',
  'restPolicy.double.oneDay': 'one day — pick another',
  'restPolicy.double.restoreTitle': 'Restore the factory default: Saturday + Sunday',
  'restPolicy.double.restore': 'Restore default (Sat + Sun)',
  'restPolicy.double.note':
    'Two consecutive days or two separate days both work. Once two days are selected, clicking other dates has no effect; clicking a selected day deselects it (at least one day must remain). After switching to custom double rest days, saving can recalculate already-scheduled stages under the new rules.',
  'restPolicy.preview.lead': 'Next {weeks} weeks · anchor week',
  'restPolicy.preview.unset': 'not set',
  'restPolicy.preview.tail': ' (big-rest week)',
  'restPolicy.preview.swapTitle': 'Shift the anchor week by one week to swap big and small rest weeks',
  'restPolicy.preview.swap': 'Swap from next week',
  'restPolicy.preview.legendOn':
    'Grey cells are rest days (public holidays and make-up workdays included; make-up workdays are still workdays).',
  'restPolicy.preview.legendOff':
    'Grey cells are rest days. With “Skip Chinese public holidays” off, reschedule manually when a public holiday falls on a workday.',
  'restPolicy.bigWeek': 'Big rest',
  'restPolicy.smallWeek': 'Small rest',
  'restPolicy.dayRest': '{date} rest day',
  'restPolicy.dayWork': '{date} workday',
  'restPolicy.footer.note':
    'Saving after switching the policy recalculates already-scheduled stages under the new rules (a confirmation preview appears first).',
  'restPolicy.saving': 'Saving…',
  'restPolicy.toast.saved': 'Rest policy saved',
  'restPolicy.toast.savedNoRecalc': 'Rest policy saved (no stages needed recalculating)',
  'restPolicy.err.doubleIncomplete': 'Pick both rest days before saving a two-day-off policy.',
  'restPolicy.err.saveFailed': 'Failed to save the rest policy.',

  'restPolicy.recalc.dialogAria': 'Recalculate after switching the rest policy',
  'restPolicy.recalc.dialogTitle': 'Recalculate after switching the rest policy',
  'restPolicy.recalc.subtitle.single': ' (single rest day = {day})',
  'restPolicy.recalc.cancelAria': 'Cancel recalculation',
  'restPolicy.recalc.impact':
    'Will recalculate {stages} stages across {projects} workday-based projects ({frozen} completed ones stay frozen)',
  'restPolicy.recalc.dueCount':
    '{count} task due dates will fall outside the new stage range (not followed by default; align them below if you want).',
  'restPolicy.recalc.mode.keep': 'Keep durations (default)',
  'restPolicy.recalc.mode.keepHint':
    'Each stage keeps its workday duration; start and end shift along the chain under the new policy',
  'restPolicy.recalc.mode.custom': 'Adjust durations',
  'restPolicy.recalc.mode.customHint':
    'Enter a new workday count per stage (leave blank to keep the original duration)',
  'restPolicy.recalc.row.count': '{changed} / {total} stages will change',
  'restPolicy.recalc.row.frozen': ' · {count} completed and frozen',
  'restPolicy.recalc.row.plannedEnd': ' · completion date {from} → {to}',
  'restPolicy.recalc.th.stage': 'Stage',
  'restPolicy.recalc.th.oldRange': 'Old range',
  'restPolicy.recalc.th.newRange': 'New range',
  'restPolicy.recalc.th.workdays': 'Duration (workdays)',
  'restPolicy.recalc.freezeFull': ' · frozen',
  'restPolicy.recalc.freezeStart': ' · start frozen',
  'restPolicy.recalc.unchanged': 'unchanged',
  'restPolicy.recalc.daysPlaceholder': '{count} days',
  'restPolicy.recalc.noWorkdayProjects':
    'No workday-based projects (calendar-day projects are unaffected by the rest policy).',
  'restPolicy.recalc.align.label':
    'Shift due dates into the new stage range (keeping their relative offset inside the stage)',
  'restPolicy.recalc.align.hint':
    'dueDate is a task-level promise (it may have been promised to someone for a specific day), so it is not followed by default.',
  'restPolicy.recalc.backup.warning': 'Recalculation cannot be undone (no undo — restore from a backup)',
  'restPolicy.recalc.backup.busy': 'Backing up…',
  'restPolicy.recalc.backup.do': 'Back up first',
  'restPolicy.recalc.ledger.pre':
    'The recalculation is written to the stage log (one reschedule entry per stage), ',
  'restPolicy.recalc.ledger.strong': 'visible when printing the delay ledger',
  'restPolicy.recalc.ledger.post':
    ' — “who moved which stage from which day to which day, and why” is traceable.',
  'restPolicy.recalc.applying': 'Recalculating…',
  'restPolicy.recalc.confirm': 'Confirm recalculation and save policy',
  'restPolicy.recalc.noChanges': 'No stages need recalculating (zero change under the new rules).',
  'restPolicy.recalc.err.failed': 'Recalculation failed; the policy was not saved.',
  'restPolicy.recalc.toast.stages': 'Recalculated {count} stages under the new rest policy',
  'restPolicy.recalc.toast.projects': ' ({count} project completion dates shifted)',
  'restPolicy.recalc.toast.tasks': ', {count} task due dates aligned',
  'restPolicy.recalc.toast.names': ': {names}',
  'restPolicy.recalc.toast.nameSep': ', ',
  'restPolicy.recalc.toast.failed': '{summary}; {count} writes failed, please retry',

  /* ══════════ 笔 1-⑤：Settings ▸ Scheduling ▸ Print logo + poster headline ══════════ */
  'printLogo.title': 'Print logo',
  'printLogo.status.uploaded':
    'Uploaded. It is placed at a fixed position in all four template versions and on the classic sheet (classic: next to the footer signature; A: left end of the black top bar; D: top-left cell of each page header; E / H: below the hairline at the top-left of each page, and on page 1 of H below the headline).',
  'printLogo.status.empty':
    'Not uploaded. All four template versions and the classic sheet show the “ID Plan” wordmark instead — never a blank space.',
  'printLogo.processing': 'Processing…',
  'printLogo.replace': 'Replace logo',
  'printLogo.upload': 'Upload logo',
  'printLogo.remove': 'Remove',
  'printLogo.uploadAria': 'Upload print logo',
  'printLogo.support.note':
    'Supports PNG / JPG / SVG; uploads are converted to greyscale and binarised automatically (readable in black-and-white printing), limited to {kb}KB (so a single image cannot blow up the backup JSON, which travels with backups when you switch devices). Administrators only.',
  'printLogo.toast.uploaded': 'Print logo updated; all four templates and the classic sheet now use it',
  'printLogo.toast.removed': 'Removed; the four versions will show the “ID Plan” wordmark',

  'printLogo.brandWord.title': 'Poster headline',
  'printLogo.brandWord.aria': 'Poster headline',
  'printLogo.brandWord.note':
    'Poster headline (the bleed headline at the top of H page 1) · leave blank to use {word}. It is always printed in capitals (lowercase input is printed uppercase), and its upper part bleeds past the paper edge — limit {max} characters (longer input is truncated on save; any longer would cut the meaning off). The “IDPLAN” at the bottom of H pages is a fixed brand device and does not follow this field.',
  'printLogo.brandWord.overlong':
    'Over the limit; it will be truncated on save to “{kept}” (limit {max} characters)',
  'printLogo.brandWord.toastCleared':
    'Poster headline cleared; the H page-top headline falls back to “{word}”',
  'printLogo.brandWord.toastSaved':
    'Poster headline updated to “{word}”; the H page-top headline follows',

  'printLogo.err.processFailed': 'logo processing failed',
  'printLogo.err.decodeFailed': 'Could not decode the image — use a PNG / JPG / SVG file',
  'printLogo.err.canvasUnavailable': 'canvas unavailable',
  'printLogo.err.readFailed': 'Could not read the image',
  'printLogo.err.svgNoSize':
    'This SVG has no width/height, so it cannot be processed — use a PNG, or write width / height inside the SVG',
  'printLogo.err.tooLarge':
    'Still over {kb}KB after processing — simplify the logo with an image tool first (flat colour, little detail), then upload again',

  'toast.saveFailedRetry': 'Save failed, please retry',
  'toast.deleteFailedRetry': 'Delete failed, please retry',

  /* ══════════ 笔 1-⑥：Settings ▸ Data & Backup ▸ NAS service ══════════ */
  'nas.title': 'NAS service',
  'nas.address': 'Server address',
  'nas.addressUnset': '(not configured)',
  /* ⚠️ 段间空格归英文取值：`note.pre` **尾随空格**（右段是硬编码的
     `IDPLAN_AGENT_TOKEN`），`note.post` **前导空格**（左段同上）。中文态那两处紧贴、不能有空格。 */
  'nas.note.pre':
    'Saving or restoring backups requires a server token. Set it in the backend container environment on your NAS: ',
  'nas.note.post':
    ' (UGOS: Docker Suite → idplan-backend → Edit → Environment variables), then paste the same value below. The token lives only in this browser; it is never uploaded and never shown back.',
  'nas.tokenConfigured': 'Configured · enter a new value to replace it',
  'nas.tokenPlaceholder': 'Paste the same token configured on the server',
  'nas.saved': 'Saved',
  'nas.probeTitle': 'Send one read-only probe to the server backup channel with the current token',
  'nas.probing': 'Probing',
  'nas.test': 'Test connection',
  'nas.probe.ok': 'Backup channel reachable: the server accepted the token, backups should work.',
  'nas.probe.auth':
    'The server rejected the token (401): the two sides differ, or IDPLAN_AGENT_TOKEN is unset or blank on the server.',
  'nas.probe.net':
    'Cannot reach the server: check that the address is reachable (it should be your NAS on the local network).',
  'nas.probe.err':
    'The server returned an unexpected status; retry later or check the NAS container logs.',
  'nas.probe.testing': 'Probing the backup channel…',
  'nas.configuredNote': 'A backup token is configured; saving backups should work now.',

  /* ══════════ 笔 1-⑥：Plugin settings slot ▸ Sample projects ══════════ */
  'sample.title': 'Sample projects',
  'sample.note.lead': 'Load ',
  'sample.note.demo': '5 demo projects',
  'sample.note.mid':
    ' (across industries, with stages, tasks and dates) to quickly see how the board / calendar / Gantt work. It is ',
  'sample.note.strong': 'overwriting',
  'sample.note.tail':
    ': it replaces all current data at once and cannot be undone. Back up first with “Save backup” if you have real data.',
  'sample.loading': 'Loading…',

  /* ══════════ 笔 2.1：Execution · the two audit reason strings written by zombie recovery ══════════ */
  'execution.recovery.reason':
    'On startup this execution was found in the running state, but no execution can be running in the current process any more (the process restarted, or a backup restore bypassed status validation); it has been converged to needs attention. The confirmation credentials are unchanged — if the plan has not changed, the confirmation is still valid and the execution can enter running again without re-confirming.',
  'execution.recovery.attemptReason':
    'Converged together with its execution: the process this attempt belonged to no longer exists (the process restarted, or a backup restore bypassed status validation), so it was interrupted.',

  /* ══════════ 笔 2.2：Agent board ▸ handoff bundle panel ══════════ */
  'handoff.subtitle': '(prompt pack for the next Agent)',
  'handoff.scope.ready': '{label} (recommended)',
  'handoff.scope.all': 'All tasks',
  'handoff.scope.stage': 'Pick {label}',
  'handoff.empty': '(Current scope is empty — nothing to generate.)',
  'handoff.footNote': 'No member-sensitive fields (contact / passwordHash) are included; generated at ',
  'handoff.copy': 'Copy',
  'handoff.download': 'Download .md',
  'handoff.toast.copied': '{what} copied to clipboard',
  'handoff.toast.copyFailed':
    'Copy failed (clipboard unavailable). Select the text in the preview area and copy it manually.',
  'handoff.toast.downloaded': '{what} downloaded as .md',

  /* ══════════ 笔 3-A：Calendar (filter row / legend / day popover) ══════════ */
  'calendar.stageLabel': 'Stage',
  'calendar.filter.clear': 'Clear filters',
  'calendar.legend.swatchTitle': 'Stage {n}',
  'calendar.legend.progressDot': 'Current progress point',
  'calendar.legend.holidayHint': 'Holiday name = public holiday · Work = make-up workday',
  'calendar.dayPopover.closeAria': 'Close the day list',
  'calendar.dayPopover.footHint': 'Press Esc or click outside to close',

  /* ══════════ Batch 3-B: month cell / day popover head / holiday badge ══════════ */
  'calendar.dayPopover.head': '{date} · {n} projects',
  'calendar.cell.todaySuffix': ' (today)',
  'calendar.cell.countSuffix': ', {n} projects',
  'calendar.cell.holidaySuffix': ', {label}',
  'calendar.cell.mobileCount': '{n} items',
  'calendar.cell.openProject': 'Open project {name}',
  'calendar.cell.expandAria': 'Expand the day list of {n} projects',
  'calendar.cell.overflow': '…+{n} more',
  'calendar.holiday.makeupBadge': 'Work',
  'calendar.holiday.makeupAria': 'make-up workday',

  /* Chinese public-holiday names (8 distinct values across cn-2025/2026.json) */
  'holiday.cn.newYear': "New Year's Day",
  'holiday.cn.springFestival': 'Spring Festival',
  'holiday.cn.qingming': 'Qingming Festival',
  'holiday.cn.laborDay': 'Labour Day',
  'holiday.cn.dragonBoat': 'Dragon Boat Festival',
  'holiday.cn.midAutumn': 'Mid-Autumn Festival',
  'holiday.cn.nationalDay': 'National Day',
  'holiday.cn.nationalDayMidAutumn': 'National Day · Mid-Autumn Festival',

  /* ══════════ Batch 3-C: timeline (stage bar / mobile stage cards / reschedule dialog) ══════════ */
  'timeline.daysCount': '{n} days',
  'timeline.overdueDays': '{n} days overdue',
  'timeline.dueToday': 'Due today',
  'timeline.stageSeg.handover': 'Briefing',
  'timeline.stageSeg.midterm': 'Mid-term',
  'timeline.stageSeg.acceptance': 'Acceptance',
  'timeline.dragBubble.start': 'Start {date}',
  'timeline.dragBubble.end': 'End {date}',
  'mobileStage.taskCount': '· {n} tasks',
  'stageRows.unassigned': 'No owner assigned',
  'stageRows.unknownOwner': 'Unknown owner',
  'reschedule.title': 'Confirm reschedule',
  'reschedule.titleStage': ' · {stage}',
  'reschedule.titleMoreStages': ' and {n} stages',
  'reschedule.cancelAria': 'Cancel reschedule',
  'reschedule.reasonLabel': 'Reason for delay',
  'reschedule.reasonRequired': '* (required when any stage end moves later)',
  'reschedule.reasonPlaceholder': 'e.g. client confirmed a delay / approval queue…',
  'reschedule.reasonMissing':
    'A reason is required before saving (the history keeps a full record).',
  'reschedule.noteLabel': 'Note (optional when pulled in or shifted)',
  'reschedule.saveMany': 'Save {n} stages with a record',
  'reschedule.saveOne': 'Save with a record',
  'reschedule.saveFailed':
    'Save rejected: {n} stages failed to reschedule. Check the delay reason and retry.',

  /* ══════════ Batch 3-D: stage drawer family ══════════ */
  'timeline.dateEdge.start': 'Start',
  'timeline.dateEdge.end': 'End',
  'stageDrawer.ariaWithName': 'Stage details: {name}',
  'stageDrawer.subtitle': '{project} · Stage {n}',
  'stageDrawer.closeAria': 'Close drawer',
  'stageDrawer.tasksTitle': 'To do in this stage',
  'stageDrawer.resourcesTitle': 'Notes and files',
  'stageDrawer.delayArchiveTitle': 'Delay archive (append-only)',
  'stageDrawer.nextStageToast': 'You can remind the members of the next stage "{name}" to start',
  'stageDrawer.switchTo': 'Switch to {status}',
  'stageDrawer.postponePrompt':
    'Moving the end date later requires a reason for delay (kept in full in the history):',
  'stageDrawer.postponeCancelled': 'No reason given, save cancelled.',
  'delayHistory.empty':
    'No reschedules yet. Drag a bar edge, or change the dates and confirm, and an immutable record is appended here.',
  'delayHistory.operator': ' · by {name}',
  'delayHistory.shifted': ' · pulled in / shifted',
  'taskChecklist.markDone': 'Mark as done',
  'taskChecklist.markUndone': 'Mark as not done',
  'taskChecklist.unassigned': 'Unassigned',
  'taskChecklist.primaryOwner': 'Lead owner: {name}',
  'taskChecklist.assignAria': 'Assign participants (single choice)',
  'taskChecklist.assignTitle': 'Assign participants (multiple choice)',
  'taskChecklist.noMembers': 'No members yet. Add members on the home page first.',
  'taskChecklist.removeAria': 'Remove {name}',
  'taskChecklist.removeEntryAria': 'Delete entry',
  'taskChecklist.newEntryPlaceholder': 'Entry title, press Enter to confirm',
  'taskChecklist.addEntry': 'Add entry',
  'resourcePath.placeholder': 'e.g. D:\\Projects\\03-Scheme or file://D:/…',
  'resourcePath.register': 'Register the stage resource folder path…',
  'resourcePath.open': 'Open',
  'resourcePath.copy': 'Copy path',
  'resourcePath.edit': 'Edit',
  'resourcePath.savedToast': 'Resource path saved',
  'resourcePath.openFallbackToast':
    'The browser does not allow opening a local folder directly. The path has been copied — paste it into the File Explorer address bar.',
  'common.confirm': 'OK',

  /* ══════════ Batch 4-c: index.html meta description (runtime sync) ══════════ */
  'meta.description':
    'ID Plan — a cross-industry project scheduling tool: turn a contract into a stage timeline anyone can read.',

  /* ══════════ Batch 3-E: travel itinerary panel ══════════ */
  'travel.loading': 'Generating the daily itinerary…',
  'travel.title': 'Daily itinerary',
  'travel.totalDays': '{n} days in total',
  'travel.budget': 'Budget',
  'travel.actual': 'Actual',
  'travel.diff': 'Difference',
  'travel.syncTitle': 'Fill in the missing day cards from the project start/end dates (adds only)',
  'travel.sync': 'Sync dates',
  'travel.addDayTitle': 'Append one day (after the last day)',
  'travel.addDay': 'Add a day',
  'travel.dayIndex': 'Day {n}',
  'travel.today': '· today',
  'travel.removeDayAria': 'Delete the day card of {date}',
  'travel.fieldTransport': 'Transport',
  'travel.fieldAccommodation': 'Stay',
  'travel.fieldTransportAria': '{date} transport',
  'travel.fieldAccommodationAria': '{date} stay',
  'travel.fieldTransportPlaceholder': 'e.g. HSR G1234 / taxi in town',
  'travel.fieldAccommodationPlaceholder': 'e.g. XX Hotel · king room',
  'travel.fieldBudgetAria': '{date} budget amount',
  'travel.fieldActualAria': '{date} actual amount',
  'travel.unassignedTitle': 'Unscheduled tasks (not on any day yet)',
  'travel.assignAria': 'Schedule "{title}" onto a day',
  'travel.assignPlaceholder': 'Schedule…',
  'travel.detachAria': 'Move "{title}" out of the day',
  'travel.detachTitle': 'Move out of the day',
  'travel.summaryTransport': 'Transport "{value}"',
  'travel.summaryAccommodation': 'Stay "{value}"',
  'travel.summaryBudget': 'Budget {amount}',
  'travel.summaryActual': 'Actual {amount}',
  'travel.summarySep': ', ',
  'travel.removeDialogTitle': 'Delete day card',
  'travel.removeDialogConfirm': 'Delete',
  'travel.removeDialogBody': 'Delete the day card of {date}?',
  'travel.removeDialogFilled': 'Filled in that day: {summary}.',
  'travel.removeDialogIrreversible': 'Deleted data cannot be recovered',
  'travel.removeDialogNote':
    '(Tasks already scheduled that day are not deleted — they go back to "Unscheduled tasks".)',
  'travel.loadFailed': 'Failed to load the daily itinerary.',
  'travel.saveFailed': 'Save failed. Please retry.',
  'travel.invalidEndDate': 'Set a valid project end date first.',
  'travel.addDayFailed': 'Cannot add a day card for {date}.',
  'travel.dayHasTasks': 'That day still has tasks. Move or delete them first.',
  'travel.removeFailed': 'Failed to delete the day card. Please retry.',
};
