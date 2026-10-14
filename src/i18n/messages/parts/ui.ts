/**
 * 消息表分片 · `ui`（英文补齐批的并行写入口）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 注册协议（**每个分片 worker 只做两件事**）
 * ══════════════════════════════════════════════════════════════════════
 *   ① 只改**本文件**（在下面的 `zh` / `en` 里加键）+ **你自己目录下的调用点**
 *      （把硬编码中文换成 `t('键')`）；
 *   ② **绝不**碰 `zh.ts` / `en.ts` / `index.ts` / 别人的分片文件 ——
 *      撞公共文件就等于把「4 个人能同时写」这件事作废。
 *
 * 本分片负责：`src/components/**` —— **不含** `components/print/**`、**不含** `components/contract-wizard/**`
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

/** ui 分片 · 中文（新键写在这里；取值必须与改动前源码逐字一致） */
export const zh = {
  /* ── 通用小词（`common.*` 住在主表里，分片不许撞键 ⇒ 分片内另起 `ui.` 前缀） ── */
  'ui.next': '下一步',
  'ui.listSeparator': '、',

  /* ── common/CountdownNumber ── */
  'ui.countdown.overdue': '逾期 {days}',
  'ui.countdown.days': '天',
  'ui.countdown.dueToday': '今天截止',
  'ui.countdown.daysLeft': '剩余{days}天',

  /* ── common/CompletionRing ── */
  'ui.completionRing.aria': '完成度 {percent}%',

  /* ── common/Modal（缺省可访问名） ── */
  'ui.modal.defaultAria': '浮层',

  /* ── layout/ThemeToggle ── */
  'ui.theme.switchTo': '切换到{target}主题',
  'ui.theme.light': '亮色',
  'ui.theme.dark': '暗色',

  /* ── layout/SidebarCollapseToggle ── */
  'ui.sidebar.expandAria': '展开侧边栏',
  'ui.sidebar.collapseAria': '收起侧边栏',

  /* ── layout/SaveBackupButton + LoadBackupButton（标题；标签复用 sidebar.*） ── */
  'ui.backup.saveTitle': '导出 JSON 备份包（含全部项目、成员与记录）',
  'ui.backup.loadTitle': '从 JSON 备份包恢复（整体替换当前全部数据）',

  /* ── layout/ExportLogButton ── */
  'ui.logExport.empty': '暂无日志，先正常使用后再导出',
  'ui.logExport.titleAttr': '导出前端日志（仅本地运行记录与错误堆栈，不含项目业务数据）',
  'ui.logExport.confirmAction': '导出',
  'ui.logExport.confirmPre': '将导出 ',
  'ui.logExport.confirmMid': ' 条前端日志（运行事件 + 错误堆栈），保存为 .log 文件。',
  'ui.logExport.confirmNote': '日志仅含本地运行记录与错误堆栈，不含项目/客户业务数据，可放心发给开发排查。',

  /* ── layout/DataGate ── */
  'ui.dataGate.failedTitle': '本地数据装载失败',
  'ui.dataGate.failedNotePre': '你的数据仍然保存在本机数据库中，这次只是没能读进界面——',
  'ui.dataGate.failedNoteStrong': '装载失败不等于数据丢失',
  'ui.dataGate.failedNoteTail': '。请不要删除 浏览器/站点数据，也不要重装应用来「修」它。',
  'ui.dataGate.reason': '常见原因：另一个窗口正在使用同一份数据，或本机存储暂时不可用。',
  'ui.dataGate.retry': '重新装载',
  'ui.dataGate.retryHint': '点一下就会重新读取本地数据，不必重启应用。',
  'ui.dataGate.loading': '正在装载本地数据…',

  /* ── layout/IdentityDialog ── */
  'ui.identity.toastAdminEstablished': '管理员「{name}」已确立',
  'ui.identity.nameMiss': '名单中没有找到你的名字，请联系管理员添加后重试',
  'ui.identity.setFailed': '身份设置失败，请重试。',
  'ui.identity.passwordWrong': '密码错误，请重试。',
  'ui.identity.passwordVerifyFailed': '密码校验失败，请重试。',
  'ui.identity.firstRunLead': '首次使用需要先确定管理员身份（项目负责人）。',
  'ui.identity.firstRunTail': '管理员可以看到全部项目、成员与备份；成员只能看到分派给自己的任务。',
  'ui.identity.iAmAdmin': '我是管理员',
  'ui.identity.noAdminNotice': '系统当前还没有管理员。请联系管理员完成首次设置后再进入。',
  'ui.identity.iAmNotAdmin': '我不是管理员',
  'ui.identity.adminNameHint': '请填写你的姓名，系统会创建/匹配管理员身份。',
  'ui.identity.memberNameHint': '请输入你的姓名（仅在本机匹配，不会展示其他成员名单）。',
  'ui.identity.namePlaceholder': '你的姓名',
  'ui.identity.confirmAdmin': '确认为管理员',
  'ui.identity.passwordLead': '请输入 ',
  'ui.identity.passwordMid': ' 的登录密码 （由管理员设置；无密码成员无需此步）。',
  'ui.identity.thisMember': '该成员',
  'ui.identity.passwordTitle': '输入密码',
  'ui.identity.login': '登录',
  'ui.identity.cannotEnterPeriod': '无法进入。',
  'ui.identity.gotIt': '知道了',
  'ui.identity.ariaFirstRun': '首次使用引导',
  'ui.identity.ariaNameInput': '输入身份',
  'ui.identity.cannotEnter': '无法进入',
  'ui.identity.adminPromptTitle': '你是管理员（项目负责人）吗？',
  'ui.identity.setAdminTitle': '设置管理员身份',
  'ui.identity.nameInputTitle': '输入你的姓名',
  'ui.identity.cannotEnterTitle': '暂时无法进入',

  /* ── layout/MemberIdentityPicker ── */
  'ui.identity.enterTitle': '点击进入身份（我的任务按此身份过滤）',
  'ui.identity.enter': '点击进入',
  'ui.identity.currentTitle': '当前身份（点击切换/退出）',
  'ui.identity.switchHint': '（点击切换/退出）',
  'ui.identity.menuAria': '身份操作',
  'ui.identity.switch': '切换身份',
  'ui.identity.exit': '退出身份',

  /* ── project/ProjectSourceBadge ── */
  'ui.agentSourceBadge.text': 'AI 工作区',
  'ui.agentSourceBadge.title': '这是 AI 工作区里的看板，与「我的项目」相互隔离',

  /* ── project/DomainConfirmPrompt ── */
  'ui.domainConfirm.barText': '此项目板块待确认',
  'ui.domainConfirm.aria': '板块待确认',
  'ui.domainConfirm.summary': '有 {count} 个项目的板块待确认（这些项目目前仍显示在「室内」列，确认后会立即归位）：',
  'ui.domainConfirm.collapse': '收起',
  'ui.domainConfirm.confirm': '确认',
  'ui.domainConfirm.adminOnly': '（仅管理员可修改）',
  'ui.domainConfirm.willAssign': '将归入「{domain}」',
  'ui.domainConfirm.pickDomainFirst': '请先选择主板块',
  'ui.domainConfirm.submit': '确认归入此板块',

  /* ── project/ProjectAppearanceDialog ── */
  'ui.appearance.title': '侧栏方块外观',
  'ui.appearance.affectsPre': '只影响',
  'ui.appearance.affectsStrong': '折叠态侧栏',
  'ui.appearance.affectsTail': '（64px）里的项目方块； 展开态侧栏与其它视图始终显示完整项目名。',
  'ui.appearance.shortLabel': '方块简称',
  'ui.appearance.shortLabelPlaceholder': '留空则用项目名首字（{initial}）',
  'ui.appearance.shortLabelHint': '最多 {max} 个字，留空即回到「项目名首字」。',
  'ui.appearance.colorLabel': '方块颜色',
  'ui.appearance.colorHint': '默认跟随项目当前阶段色；选任一颜色后优先使用该颜色。',
  'ui.appearance.followStageColor': '跟随阶段色',
  'ui.appearance.preview': '预览',

  /* ── project/ProjectCard ── */
  'ui.projectCard.allDone': '全部完成',
  'ui.projectCard.overdue': '逾期 {days} 天',
  'ui.projectCard.due': '{date} 到期',
  'ui.projectCard.exportSchedule': '导出日程表',
  'ui.projectCard.printPreviewTitle': '打印预览（应用内面板，只读导出）',
  'ui.projectCard.moreActions': '项目更多操作',
  'ui.projectCard.rename': '项目重命名',
  'ui.projectCard.archive': '归档项目',
  'ui.projectCard.delete': '删除项目',
  'ui.projectCard.progress': '进度',
  'ui.projectCard.renameHint': '修改后将同步到项目详情与所有视图。',
  'ui.projectCard.renamePlaceholder': '输入新的项目名称',
  'ui.projectCard.newNameAria': '新的项目名称',
  'ui.projectCard.deleteAction': '删除',
  'ui.projectCard.archiveConfirm': '确认归档「{name}」？归档后将从首页列表隐藏（可在「已归档」区恢复）。',
  'ui.projectCard.deleteConfirmPre': '确认删除「{name}」？该项目下的所有阶段、任务与操作记录将一并永久删除，',
  'ui.projectCard.deleteConfirmDanger': '不可恢复',
  'ui.projectCard.deleteConfirmTail': '。建议先归档而非删除。',

  /* ── agent/CreateAgentBoardDialog ── */
  'ui.agentBoard.errNameRequired': '请填写看板名称。',
  'ui.agentBoard.errStartRequired': '请选择开始日期（本表单不会自动填写默认日期）。',
  'ui.agentBoard.errEndRequired': '请选择结束日期（本表单不会自动填写默认日期）。',
  'ui.agentBoard.errEndBeforeStart': '结束日期不能早于开始日期。',
  'ui.agentBoard.errMinStages': '请至少选择 {min} 个阶段。',
  'ui.agentBoard.errMaxStages': '单次最多 {max} 个阶段。',
  'ui.agentBoard.errEmptyStageName': '阶段名称不能为空。',
  'ui.agentBoard.errDuplicateStages': '阶段名重复：{names}，请改名后再提交。',
  'ui.agentBoard.errInvalidRange': '请选择有效的开始日期与结束日期（不会自动填充默认日期）。',
  'ui.agentBoard.errCreateFailed': '创建看板失败，请重试。',
  'ui.agentBoard.createTitle': '新建 Agent 看板',
  'ui.agentBoard.createCloseAria': '关闭新建 Agent 看板',
  'ui.agentBoard.nameLabel': '看板名称 *',
  'ui.agentBoard.nameAria': '看板名称',
  'ui.agentBoard.namePlaceholder': '如「某某项目 · 排期」',
  'ui.agentBoard.startLabel': '开始日期 *',
  'ui.agentBoard.startAria': '开始日期',
  'ui.agentBoard.endLabel': '结束日期 *',
  'ui.agentBoard.endAria': '结束日期',
  'ui.agentBoard.noPrefillNote': '名称、起止日期与阶段集合都需显式填写，系统不会替你填默认值。',
  'ui.agentBoard.filterNote': '下面只用来筛出要用的阶段分组，不会改变看板归属。',
  'ui.agentBoard.stagesLabel': '看板阶段 * · 已选 {count} 项',
  'ui.agentBoard.stagesMinHint': '（请至少选择 1 项）',
  'ui.agentBoard.stagesMaxHint': '（上限 {max}）',
  'ui.agentBoard.creating': '创建中…',
  'ui.agentBoard.createAction': '创建看板',

  /* ── agent/PlanningWizardDialog ── */
  'ui.planning.errBadJson': '不是合法的 JSON——请把 AI 回传的整段内容原样粘进来',
  'ui.planning.errInvalidPayload': 'payload 校验未通过',
  'ui.planning.toastImported': '已建板并导入 {created} 条任务',
  'ui.planning.toastUpdated': '（更新 {updated}）',
  'ui.planning.errPersistFailed': '落库失败（看板可能已建，请检查）',
  'ui.planning.title': 'AI 规划向导',
  'ui.planning.step1': '说想法',
  'ui.planning.step2': '给 AI',
  'ui.planning.step3': '收结果',
  'ui.planning.intro': '三步把一个想法变成有任务的 Agent 看板：说清楚想法 → 把指令给你的 AI → 把它回的 JSON 粘回来。AI 用你自己那个（Claude / WorkBuddy / 别的都行）， 这里不调任何模型、不经手你的数据。',
  'ui.planning.nameLabel': '项目名称（可留空，AI 会起名）',
  'ui.planning.namePlaceholder': '如：门店开业筹备',
  'ui.planning.domainLabel': '所属行业（决定看板列形态与套餐）',
  'ui.planning.ideaLabel': '我的想法（原文即可，不必工整）',
  'ui.planning.ideaPlaceholder': '如：先出初版方案给需求方确认，通过后再深化；准备与执行要并行推进；收尾阶段留一周做交付确认。',
  'ui.planning.stageHintLabel': '我想到的阶段（可空，AI 会调整/补充）',
  'ui.planning.stageHintPlaceholder': '如：概念 → 深化 → 施工图 → 材料 → 施工 → 交付',
  'ui.planning.nextToPrompt': '下一步：生成给 AI 的指令',
  'ui.planning.copyHint': '复制下面两段（顺序随意）粘给你的 AI，它回一段 JSON 给你。',
  'ui.planning.copied': '已复制',
  'ui.planning.copyIdea': '复制我的想法',
  'ui.planning.formatHint': '完整的 JSON 格式要求在「粘贴面板 → 接入」里（同样的规则，AI 那边需要看）',
  'ui.planning.prev': '上一步',
  'ui.planning.nextToPaste': '下一步：粘回 AI 的结果',
  'ui.planning.pasteLabel': '把 AI 回的 JSON 粘到这里（原样）',
  'ui.planning.importing': '正在建板并导入…',
  'ui.planning.importAction': '建板并导入',

  /* ── agent/TaskDrawer ── */
  'ui.taskDrawer.pathCopied': '路径已复制（浏览器无法直接打开本地路径，请粘贴到编辑器/终端）：{path}',
  'ui.taskDrawer.copyFailed': '复制失败（剪贴板不可用），请手动选择路径文本复制。',
  'ui.taskDrawer.title': '任务详情',
  'ui.taskDrawer.closeAria': '关闭任务详情',
  'ui.taskDrawer.runIdTitle': '来源批次：{runId}（写入该任务的那一次 Agent 运行）',
  'ui.taskDrawer.runIdChip': '来源批次 {short}',
  'ui.taskDrawer.daysLeft': '（剩余 {days} 天）',
  'ui.taskDrawer.transition': '流转 →',
  'ui.taskDrawer.techDetails': '技术详情',
  'ui.taskDrawer.blocks': '前置（blocks this）',
  'ui.taskDrawer.deleted': '（已删除）',
  'ui.taskDrawer.dependsOn': '后继（depends on this）',
} as const;

/** ui 分片 · 英文（每个 zh 键都必须有对应英文，漏一个 = 编译错） */
export const en = {
  'ui.next': 'Next',
  'ui.listSeparator': ', ',

  'ui.countdown.overdue': 'Overdue {days}',
  'ui.countdown.days': 'days',
  'ui.countdown.dueToday': 'Due today',
  'ui.countdown.daysLeft': '{days} days left',

  'ui.completionRing.aria': '{percent}% complete',

  'ui.modal.defaultAria': 'Dialog',

  'ui.theme.switchTo': 'Switch to {target} theme',
  'ui.theme.light': 'light',
  'ui.theme.dark': 'dark',

  'ui.sidebar.expandAria': 'Expand sidebar',
  'ui.sidebar.collapseAria': 'Collapse sidebar',

  'ui.backup.saveTitle': 'Export a JSON backup (all projects, members and logs)',
  'ui.backup.loadTitle': 'Restore from a JSON backup (replaces all current data)',

  'ui.logExport.empty': 'No logs yet — use the app for a while, then export',
  'ui.logExport.titleAttr': 'Export frontend logs (local run records and error stacks only, no project data)',
  'ui.logExport.confirmAction': 'Export',
  'ui.logExport.confirmPre': 'Export ',
  'ui.logExport.confirmMid': ' frontend log entries (run events + error stacks) to a .log file.',
  'ui.logExport.confirmNote': 'Logs contain only local run records and error stacks — no project or client data — so they are safe to send to a developer.',

  'ui.dataGate.failedTitle': 'Failed to load local data',
  'ui.dataGate.failedNotePre': 'Your data is still stored in the local database — it just could not be read into the interface this time. ',
  'ui.dataGate.failedNoteStrong': 'A failed load is not data loss',
  'ui.dataGate.failedNoteTail': '. Do not clear your browser/site data, and do not reinstall the app to “fix” it.',
  'ui.dataGate.reason': 'Common causes: another window is using the same data, or local storage is temporarily unavailable.',
  'ui.dataGate.retry': 'Reload',
  'ui.dataGate.retryHint': 'One click re-reads local data — no need to restart the app.',
  'ui.dataGate.loading': 'Loading local data…',

  'ui.identity.toastAdminEstablished': 'Administrator “{name}” is now set',
  'ui.identity.nameMiss': 'That name is not on the list — ask an administrator to add you and try again',
  'ui.identity.setFailed': 'Could not set your identity. Please try again.',
  'ui.identity.passwordWrong': 'Wrong password. Please try again.',
  'ui.identity.passwordVerifyFailed': 'Password check failed. Please try again.',
  'ui.identity.firstRunLead': 'Before first use, the administrator identity (project owner) must be set.',
  'ui.identity.firstRunTail': 'Administrators can see every project, member and backup; members see only tasks assigned to them.',
  'ui.identity.iAmAdmin': 'I am the administrator',
  'ui.identity.noAdminNotice': 'There is no administrator yet. Ask an administrator to finish first-time setup before entering.',
  'ui.identity.iAmNotAdmin': 'I am not the administrator',
  'ui.identity.adminNameHint': 'Enter your name; an administrator identity will be created or matched.',
  'ui.identity.memberNameHint': 'Enter your name (matched on this machine only; other members are never listed).',
  'ui.identity.namePlaceholder': 'Your name',
  'ui.identity.confirmAdmin': 'Confirm as administrator',
  'ui.identity.passwordLead': 'Enter the login password for ',
  'ui.identity.passwordMid': ' (set by an administrator; members without a password skip this step).',
  'ui.identity.thisMember': 'this member',
  'ui.identity.passwordTitle': 'Enter password',
  'ui.identity.login': 'Log in',
  'ui.identity.cannotEnterPeriod': 'Cannot enter.',
  'ui.identity.gotIt': 'Got it',
  'ui.identity.ariaFirstRun': 'First-time guide',
  'ui.identity.ariaNameInput': 'Enter identity',
  'ui.identity.cannotEnter': 'Cannot enter',
  'ui.identity.adminPromptTitle': 'Are you the administrator (project owner)?',
  'ui.identity.setAdminTitle': 'Set administrator identity',
  'ui.identity.nameInputTitle': 'Enter your name',
  'ui.identity.cannotEnterTitle': 'Temporarily unavailable',

  'ui.identity.enterTitle': 'Enter your identity (My tasks are filtered by it)',
  'ui.identity.enter': 'Enter',
  'ui.identity.currentTitle': 'Current identity (click to switch or exit)',
  'ui.identity.switchHint': ' (click to switch or exit)',
  'ui.identity.menuAria': 'Identity actions',
  'ui.identity.switch': 'Switch identity',
  'ui.identity.exit': 'Exit identity',

  'ui.agentSourceBadge.text': 'Agent workspace',
  'ui.agentSourceBadge.title': 'This board lives in the Agent workspace and is isolated from My projects',

  'ui.domainConfirm.barText': 'Domain to confirm',
  'ui.domainConfirm.aria': 'Domain to confirm',
  'ui.domainConfirm.summary': '{count} project(s) have a domain to confirm (they still show in the “Indoor” column and will move as soon as you confirm):',
  'ui.domainConfirm.collapse': 'Collapse',
  'ui.domainConfirm.confirm': 'Confirm',
  'ui.domainConfirm.adminOnly': '(administrators only)',
  'ui.domainConfirm.willAssign': 'Will be filed under “{domain}”',
  'ui.domainConfirm.pickDomainFirst': 'Pick a main domain first',
  'ui.domainConfirm.submit': 'Confirm this domain',

  'ui.appearance.title': 'Sidebar tile appearance',
  'ui.appearance.affectsPre': 'Affects only the project tiles in the ',
  'ui.appearance.affectsStrong': 'collapsed sidebar',
  'ui.appearance.affectsTail': ' (64px); the expanded sidebar and all other views always show the full project name.',
  'ui.appearance.shortLabel': 'Tile abbreviation',
  'ui.appearance.shortLabelPlaceholder': 'Leave empty to use the first character of the project name ({initial})',
  'ui.appearance.shortLabelHint': 'Up to {max} characters; clear it to fall back to the first character of the project name.',
  'ui.appearance.colorLabel': 'Tile color',
  'ui.appearance.colorHint': 'Follows the project’s current stage color by default; once you pick a color, that color wins.',
  'ui.appearance.followStageColor': 'Follow stage color',
  'ui.appearance.preview': 'Preview',

  'ui.projectCard.allDone': 'All stages done',
  'ui.projectCard.overdue': 'Overdue {days} days',
  'ui.projectCard.due': 'Due {date}',
  'ui.projectCard.exportSchedule': 'Export schedule',
  'ui.projectCard.printPreviewTitle': 'Print preview (in-app panel, read-only export)',
  'ui.projectCard.moreActions': 'More project actions',
  'ui.projectCard.rename': 'Rename project',
  'ui.projectCard.archive': 'Archive project',
  'ui.projectCard.delete': 'Delete project',
  'ui.projectCard.progress': 'Progress',
  'ui.projectCard.renameHint': 'The change syncs to the project detail page and every view.',
  'ui.projectCard.renamePlaceholder': 'Enter a new project name',
  'ui.projectCard.newNameAria': 'New project name',
  'ui.projectCard.deleteAction': 'Delete',
  'ui.projectCard.archiveConfirm': 'Archive “{name}”? It will be hidden from the home list (restorable from the Archived section).',
  'ui.projectCard.deleteConfirmPre': 'Delete “{name}”? All stages, tasks and activity logs under this project will be permanently removed — ',
  'ui.projectCard.deleteConfirmDanger': 'this cannot be undone',
  'ui.projectCard.deleteConfirmTail': '. Consider archiving instead.',

  'ui.agentBoard.errNameRequired': 'Please enter a board name.',
  'ui.agentBoard.errStartRequired': 'Please pick a start date (this form never fills in a default date).',
  'ui.agentBoard.errEndRequired': 'Please pick an end date (this form never fills in a default date).',
  'ui.agentBoard.errEndBeforeStart': 'The end date cannot be earlier than the start date.',
  'ui.agentBoard.errMinStages': 'Select at least {min} stages.',
  'ui.agentBoard.errMaxStages': 'At most {max} stages per board.',
  'ui.agentBoard.errEmptyStageName': 'Stage names cannot be empty.',
  'ui.agentBoard.errDuplicateStages': 'Duplicate stage names: {names}. Rename them before submitting.',
  'ui.agentBoard.errInvalidRange': 'Please pick a valid start date and end date (defaults are never auto-filled).',
  'ui.agentBoard.errCreateFailed': 'Could not create the board. Please try again.',
  'ui.agentBoard.createTitle': 'New Agent board',
  'ui.agentBoard.createCloseAria': 'Close the new Agent board dialog',
  'ui.agentBoard.nameLabel': 'Board name *',
  'ui.agentBoard.nameAria': 'Board name',
  'ui.agentBoard.namePlaceholder': 'e.g. “Acme rollout · schedule”',
  'ui.agentBoard.startLabel': 'Start date *',
  'ui.agentBoard.startAria': 'Start date',
  'ui.agentBoard.endLabel': 'End date *',
  'ui.agentBoard.endAria': 'End date',
  'ui.agentBoard.noPrefillNote': 'Name, start/end dates and the stage set must all be filled in explicitly — the system will not fill in defaults for you.',
  'ui.agentBoard.filterNote': 'Used only to filter which stage groups you see; it does not change the board’s domain.',
  'ui.agentBoard.stagesLabel': 'Board stages * · {count} selected',
  'ui.agentBoard.stagesMinHint': '(select at least 1)',
  'ui.agentBoard.stagesMaxHint': '(max {max})',
  'ui.agentBoard.creating': 'Creating…',
  'ui.agentBoard.createAction': 'Create board',

  'ui.planning.errBadJson': 'Not valid JSON — paste the whole reply from your AI exactly as it came',
  'ui.planning.errInvalidPayload': 'payload validation failed',
  'ui.planning.toastImported': 'Board created and {created} task(s) imported',
  'ui.planning.toastUpdated': ' ({updated} updated)',
  'ui.planning.errPersistFailed': 'Could not write to the database (the board may already exist — please check)',
  'ui.planning.title': 'AI planning wizard',
  'ui.planning.step1': 'Describe',
  'ui.planning.step2': 'Ask your AI',
  'ui.planning.step3': 'Paste result',
  'ui.planning.intro': 'Three steps turn an idea into an Agent board with tasks: describe the idea → hand the instructions to your AI → paste back the JSON it returns. The AI is your own (Claude / WorkBuddy / anything else) — no model is called here and your data never passes through us.',
  'ui.planning.nameLabel': 'Project name (optional — the AI can name it)',
  'ui.planning.namePlaceholder': 'e.g. Store opening preparation',
  'ui.planning.domainLabel': 'Industry (decides board columns and stage presets)',
  'ui.planning.ideaLabel': 'My idea (verbatim is fine — no need to polish it)',
  'ui.planning.ideaPlaceholder': 'e.g. Send a first-pass concept for sign-off, then deepen it; preparation and execution should run in parallel; keep a week at the end for delivery sign-off.',
  'ui.planning.stageHintLabel': 'Stages I have in mind (optional — the AI can adjust or add)',
  'ui.planning.stageHintPlaceholder': 'e.g. Concept → Design development → Construction drawings → Materials → Construction → Handover',
  'ui.planning.nextToPrompt': 'Next: generate the instructions for your AI',
  'ui.planning.copyHint': 'Copy both blocks below (order does not matter) into your AI; it replies with a JSON block.',
  'ui.planning.copied': 'Copied',
  'ui.planning.copyIdea': 'Copy my idea',
  'ui.planning.formatHint': 'The full JSON format spec lives in “Paste panel → Ingest” (same rules — your AI needs to see them)',
  'ui.planning.prev': 'Back',
  'ui.planning.nextToPaste': 'Next: paste back the AI result',
  'ui.planning.pasteLabel': 'Paste the JSON your AI returned here (as-is)',
  'ui.planning.importing': 'Creating the board and importing…',
  'ui.planning.importAction': 'Create board & import',

  'ui.taskDrawer.pathCopied': 'Path copied (a browser cannot open local paths directly — paste it into your editor or terminal): {path}',
  'ui.taskDrawer.copyFailed': 'Copy failed (clipboard unavailable) — please select the path text and copy it manually.',
  'ui.taskDrawer.title': 'Task details',
  'ui.taskDrawer.closeAria': 'Close task details',
  'ui.taskDrawer.runIdTitle': 'Source run: {runId} (the Agent run that wrote this task)',
  'ui.taskDrawer.runIdChip': 'Source run {short}',
  'ui.taskDrawer.daysLeft': ' ({days} days left)',
  'ui.taskDrawer.transition': 'Transition →',
  'ui.taskDrawer.techDetails': 'Technical details',
  'ui.taskDrawer.blocks': 'Blockers (blocks this)',
  'ui.taskDrawer.deleted': '(deleted)',
  'ui.taskDrawer.dependsOn': 'Dependents (depends on this)',
} as const;
