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
  'guide.lead.before': 'It turns a project contract into a',
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
  'ingress.explain.readFile': 'just read that file and they are connected',
  'ingress.explain.nasNote':
    'NAS mode currently supports connectivity probing only; remote automatic write is not enabled yet.',
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
  'project.currentStage': 'Now:',
  'project.itineraryHint':
    'The client itinerary lists transport, lodging, plans and costs day by day — send it to the client or print it directly.',
  'project.itineraryTitle': 'Open the client itinerary (new window, read-only export)',
  'project.itinerary': 'Client itinerary',

  /* ───────────── Agent board · status note box (data-agent-stance) ───────────── */
  'agent.stanceBefore': 'The Agent board currently',
  'agent.stanceStrong': 'only carries schedules from external writers',
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
  'backup.dialog.demo1': 'This will load',
  'backup.dialog.demoStrong': '5 demo projects',
  'backup.dialog.demo2': ' (replacing everything),',
  'backup.dialog.replaceStrong': 'replacing all current data with no undo',
  'backup.dialog.demo3':
    '. A library with no real data is safe to load; if you have real data, save a backup first.',
  'backup.dialog.restore1': 'Restoring will',
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
};
