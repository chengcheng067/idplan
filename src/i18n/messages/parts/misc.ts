/**
 * 消息表分片 · `misc`（英文补齐批的并行写入口）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 注册协议（**每个分片 worker 只做两件事**）
 * ══════════════════════════════════════════════════════════════════════
 *   ① 只改**本文件**（在下面的 `zh` / `en` 里加键）+ **你自己目录下的调用点**
 *      （把硬编码中文换成 `t('键')`）；
 *   ② **绝不**碰 `zh.ts` / `en.ts` / `index.ts` / 别人的分片文件 ——
 *      撞公共文件就等于把「4 个人能同时写」这件事作废。
 *
 * 本分片负责：`src/di` / `src/plugins` / `src/hooks` / `src/lib` / `src/store` / `src/channels` / `src/main.tsx`
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

/** misc 分片 · 中文（新键写在这里；取值必须与改动前源码逐字一致） */
export const zh = {
  /* ══════════ src/di/repository.provider.tsx（启动仓储 · 升级闸门 · 三个致命面）══════════
   * 这一页的文案被 `<strong>` / `<code>` / `<span>` 切成了多段，故一段一键：
   * **段与段的拼接结果必须与改动前逐字一致**（中文态），空格归英文取值（en 侧惯例见
   * `messages/en.ts` 文件头 ⑤）。`{' '}` 只在**中英都要**的那个空格处显式写。
   */
  'di.repo.initFailed': '本地数据库初始化失败（可能是隐私模式禁用了存储）。',
  'di.repo.gate.title': '需要先导出升级前备份',
  'di.repo.gate.failedBefore': '备份导出失败（请检查磁盘空间 / 下载权限）。为保护你的数据，本次',
  'di.repo.gate.failedStrong': '不执行升级',
  'di.repo.gate.failedAfter': '，本地数据仍为旧格式、未受任何影响。',
  'di.repo.gate.retry': '重试导出',
  'di.repo.gate.detectedBefore': '检测到本地数据库是旧版本（v{from}），即将升级到 v{to}。升级会',
  'di.repo.gate.detectedStrong': '就地改写本地数据且不可逆',
  'di.repo.gate.detectedAfter': '，因此必须先导出一份备份—— 这是升级后唯一的回滚凭据。',
  'di.repo.gate.downloadBefore': '点击按钮将下载',
  'di.repo.gate.downloadAfter': '，导出成功后自动继续升级。',
  'di.repo.gate.exporting': '正在导出…',
  'di.repo.gate.exportAndContinue': '导出备份并继续',
  'di.repo.ahead.title': '本地数据比当前应用更新',
  'di.repo.ahead.intro': '这份数据是用更新版本的 ID Plan 打开过的：',
  'di.repo.ahead.dataVersion': '数据 v{version}',
  'di.repo.ahead.appVersion': 'v{version}',
  'di.repo.ahead.appOnlyTo': '，当前应用只支持到',
  'di.repo.ahead.damageBefore': '。为避免把新格式的数据改坏，本次',
  'di.repo.ahead.damageStrong': '没有打开它，也没有做任何修改',
  'di.repo.ahead.damageAfter': '。',
  'di.repo.ahead.advice':
    '正确做法：更新到不低于数据版本的 ID Plan 再打开。如果你是刚刚从新版本 换回了旧版本，请换回新版本——数据一直都在，换回去就能看到。',
  'di.repo.ahead.warnBefore': '请',
  'di.repo.ahead.warnStrong': '不要',
  'di.repo.ahead.warnAfter':
    '删除浏览器/站点数据，也不要重装应用来 「修」它：那会真的把这份数据删掉，而它现在完好无损。',
  'di.repo.fatal.title': '无法访问本地数据',
  'di.repo.fatal.hint': '请确认未处于浏览器无痕/隐私模式，或为站点启用站点数据后刷新重试。',
  'di.repo.noProvider': '仓储上下文缺失：RepoProvider 未挂载。',

  /* ══════════ src/plugins/agent-board/** ══════════
   * 插件名（`Agent 看板`）**不另建键** —— 复用 `agentTerm.board.human`（该词条
   * 的说明就是「整个工作区的名字」）；`nav[].label`（`Agent 工作区`）复用
   * `nav.agentAreaAria`，均为同值同义，故本分片只补 summary 一条。
   */
  'plugin.agentBoard.summary': 'AI 代理的工作区：接入外部 Agent、执行单与写回提案审批、AI 规划向导',

  /* ══════════ src/plugins/weekly-report/**（项目周报样板插件）══════════ */
  'plugin.weeklyReport.name': '项目周报',
  'plugin.weeklyReport.summary': '一页看完本周全部项目的阶段/任务/逾期（只读）',
  'plugin.weeklyReport.rangeSummary': '本周 {from} → {to} · 共 {projects} 个进行中项目 · 逾期任务 {overdue} 条',
  'plugin.weeklyReport.collapse': '收起明细',
  'plugin.weeklyReport.expand': '展开明细',
  'plugin.weeklyReport.collapsed': '明细已收起。',
  'plugin.weeklyReport.empty': '本周还没有进行中的项目。',
  'plugin.weeklyReport.th.project': '项目',
  'plugin.weeklyReport.th.client': '客户',
  'plugin.weeklyReport.th.stages': '阶段',
  'plugin.weeklyReport.th.tasks': '任务',
  'plugin.weeklyReport.th.done': '已完成',
  'plugin.weeklyReport.th.overdue': '逾期',
  'plugin.weeklyReport.readOnlyNote': '本面板只读项目数据，不写入、不修改任何内容。',

  /* ══════════ src/hooks/** 与 src/channels/**（Agent loopback 的兜底文案）══════════
   * ⚠️ 这五条只在「拿不到真因」的那一支用：`err.userMessage` 里的**真实失败原因
   *    一律原样透传**（数据侧真因规则），本分片不参与那条通路。
   */
  'agentLoopback.writeFailed': '写入失败。',
  'agentLoopback.createBoardFailed': '建板失败。',
  'agentLoopback.notAgentBoard': '目标项目（id={id}）不是 Agent 看板，Agent 通道读不到它的任务。',
  'agentLoopback.listTasksFailed': '读取任务失败。',
  'agentLoopback.commandFailed': '命令执行失败。',
  'agentLoopback.httpFailed': 'Agent loopback 请求失败（HTTP {status}）。',

  /* ══════════ src/hooks/useProjectsBootstrap.ts ══════════ */
  'bootstrap.loaded': '数据装载完成',
  'bootstrap.loadFailed': '本地数据装载失败，可在页面上点「重新装载」。',
  'bootstrap.unknownError': '未捕获到错误信息（本机存储可能暂时不可用）。',

  /* ══════════ src/lib/** ══════════ */
  'print.frame.docTitle': '打印',
  /* 色号 / 配色预设名（产品 2026-10-15 拍板：也翻）。落库的是 `key`（pine/amber/…），
     名称只用于显示 ⇒ 翻名不动任何数据；`label` 以 getter 形态取词，理由见
     `src/lib/projectAccent.ts` 表上方注释。 */
  'project.cover.pine': '靛蓝',
  'project.cover.amber': '琥珀',
  'project.cover.clay': '陶红',
  'project.cover.moss': '苔绿',
  'project.cover.mist': '雾灰',
  'project.cover.cream': '米白',

  /* ══════════════════════════════════════════════════════════════════════
   * 区 A · 建档向导族 · `src/components/contract-wizard/**`
   * ══════════════════════════════════════════════════════════════════════
   * 位置模板（`{…}` 由 `t()` 插值）：{name} 阶段/套餐名、{max}/{min}/{count} 数字、
   * {domains}/{library}/{label} 已算好的展示串。**不翻**的：库里的 key/domain
   * 这类 ASCII 值，以及「阶段名重复」里的名字列表分隔符（复用 `ui.listSeparator`）。
   */
  'wizard.maxStages': '单次项目最多 {max} 个阶段',
  'wizard.selectStagesTitle': '选择本次服务的阶段',
  'wizard.selectedCount': '已选 {count} / 上限 {max}',
  'wizard.scheduleBasis': '排期基准',
  'wizard.scheduleBasisAria': '排期基准 {label}',
  'wizard.byDurationTitle': '按阶段时长排期（为每个阶段填天数，竣工日期自动算出）',
  'wizard.byDurationHint':
    '未填的阶段按默认占比匀摊。你也可以直接在「展开设置 → 排期基准」切换自然日 / 工作日口径。',
  'wizard.quickPresets': '快捷套餐',
  'wizard.quickPresetsWithDomain': '快捷套餐（{domain}）',
  'wizard.noPresets': '该板块暂无快捷套餐，请直接勾选阶段。',
  'wizard.presetAria': '套餐 {name}',
  'wizard.customPresetAria': '自定义套餐 {name}（{library}）',
  'wizard.customPresetTitle': '自定义行业包「{library}」',
  'wizard.stagePool': '阶段池',
  'wizard.addCustomStageAria': '新增自定义阶段',
  'wizard.customStages': '自定义阶段',
  'wizard.customStagesEmpty': '暂无自定义阶段。点上方的「＋ 自定义阶段」添加（如「消防报审」）。',
  'wizard.collapseOtherDomains': '收起其他行业阶段',
  'wizard.showOtherDomains': '显示其他行业阶段（{domains}）',
  'wizard.duplicateNames': '阶段名重复：{names}。请改名后再提交（Agent 通道按名定位阶段，重名会歧义）。',
  'wizard.selectedOrderTitle': '已选顺序（可上下调整）',
  'wizard.longListHint':
    '已选 {count} 段，阶段较多：建议确认每段都有明确交付物，必要时合并或用套餐。',
  'wizard.minStages': '至少选择 {min} 个阶段',
  'wizard.durationPlaceholder': '天数',
  'wizard.durationAria': '{name} 时长（天）',
  'wizard.daysUnit': '天',
  'wizard.moveUpAria': '上移 {name}',
  'wizard.moveDownAria': '下移 {name}',
  'wizard.removeAria': '移除 {name}',
  'wizard.chipToggleAria': '{action}阶段 {name}',
  'wizard.deselect': '取消选择',
  'wizard.select': '选择',
} as const;

/**
 * misc 分片 · 英文（每个 zh 键都必须有对应英文，漏一个 = 编译错）
 *
 * ⚠️ **段尾空格是刻意的**（`en.ts` 文件头 ⑤）：`di.repo.*` / `plugin.weeklyReport.*`
 * 那几句在 JSX 里被 `<strong>` / `<code>` / `<span>` 切成多段，段与段之间 JSX
 * **不产生任何空白**，而英文必须要它 ⇒ 空格只能写在取值里。守卫：
 * `tests/i18n-jsx-space.spec.ts` 全仓扫描（零豁免）。
 */
export const en = {
  'di.repo.initFailed':
    'Failed to initialize the local database (storage may be disabled in private mode).',
  'di.repo.gate.title': 'Export a pre-upgrade backup first',
  'di.repo.gate.failedBefore':
    'Exporting the backup failed (check disk space / download permissions). To protect your data, this upgrade was ',
  'di.repo.gate.failedStrong': 'not performed',
  'di.repo.gate.failedAfter': '; your local data stays in the old format and is completely untouched.',
  'di.repo.gate.retry': 'Retry export',
  'di.repo.gate.detectedBefore':
    'The local database is an older version (v{from}) and will be upgraded to v{to}. The upgrade will ',
  'di.repo.gate.detectedStrong': 'rewrite local data in place, irreversibly',
  'di.repo.gate.detectedAfter':
    ', so you must export a backup first — it is the only rollback evidence after the upgrade.',
  'di.repo.gate.downloadBefore': 'Clicking the button downloads',
  'di.repo.gate.downloadAfter': '; the upgrade continues automatically once the export succeeds.',
  'di.repo.gate.exporting': 'Exporting…',
  'di.repo.gate.exportAndContinue': 'Export backup and continue',
  'di.repo.ahead.title': 'Local data is newer than this app',
  'di.repo.ahead.intro': 'This data was opened by a newer version of ID Plan: ',
  'di.repo.ahead.dataVersion': 'Data v{version}',
  'di.repo.ahead.appVersion': 'v{version}',
  'di.repo.ahead.appOnlyTo': ', but the current app only supports up to ',
  'di.repo.ahead.damageBefore':
    '. To avoid corrupting data in the newer format, this time it ',
  'di.repo.ahead.damageStrong': 'did not open it or make any changes',
  'di.repo.ahead.damageAfter': '.',
  'di.repo.ahead.advice':
    'The right thing to do: update to an ID Plan version that is at least as new as your data, then open it. If you just switched back from a newer version, switch back — the data is still there and will show up again.',
  'di.repo.ahead.warnBefore': 'Please ',
  'di.repo.ahead.warnStrong': 'do not',
  'di.repo.ahead.warnAfter':
    ' delete browser/site data, and do not reinstall the app to “fix” it: that would really delete this data, and it is right now intact.',
  'di.repo.fatal.title': 'Local data is not reachable',
  'di.repo.fatal.hint':
    'Make sure you are not in a browser incognito/private mode, or enable site data for this site and refresh to retry.',
  'di.repo.noProvider': 'Repository context is missing: RepoProvider is not mounted.',

  'plugin.agentBoard.summary':
    'Workspace for AI agents: connect external agents, approve execution orders and write-back proposals, AI planning wizard',

  'plugin.weeklyReport.name': 'Weekly report',
  'plugin.weeklyReport.summary':
    'See the stages / tasks / overdue items of every project for this week on one page (read-only)',
  'plugin.weeklyReport.rangeSummary':
    'This week {from} → {to} · {projects} projects in progress · {overdue} overdue tasks',
  'plugin.weeklyReport.collapse': 'Hide details',
  'plugin.weeklyReport.expand': 'Show details',
  'plugin.weeklyReport.collapsed': 'Details are hidden.',
  'plugin.weeklyReport.empty': 'No projects in progress this week.',
  'plugin.weeklyReport.th.project': 'Project',
  'plugin.weeklyReport.th.client': 'Client',
  'plugin.weeklyReport.th.stages': 'Stages',
  'plugin.weeklyReport.th.tasks': 'Tasks',
  'plugin.weeklyReport.th.done': 'Done',
  'plugin.weeklyReport.th.overdue': 'Overdue',
  'plugin.weeklyReport.readOnlyNote':
    'This panel only reads project data — it writes and changes nothing.',

  'agentLoopback.writeFailed': 'Write failed.',
  'agentLoopback.createBoardFailed': 'Failed to create the board.',
  'agentLoopback.notAgentBoard':
    'The target project (id={id}) is not an Agent board, so the Agent channel cannot read its tasks.',
  'agentLoopback.listTasksFailed': 'Failed to read tasks.',
  'agentLoopback.commandFailed': 'Command failed.',
  'agentLoopback.httpFailed': 'Agent loopback request failed (HTTP {status}).',

  'bootstrap.loaded': 'Data loaded',
  'bootstrap.loadFailed':
    'Failed to load local data. You can click “Reload” on the page.',
  'bootstrap.unknownError':
    'No error information was captured (local storage may be temporarily unavailable).',

  'print.frame.docTitle': 'Print',
  'project.cover.pine': 'Indigo',
  'project.cover.amber': 'Amber',
  'project.cover.clay': 'Clay',
  'project.cover.moss': 'Moss',
  'project.cover.mist': 'Mist',
  'project.cover.cream': 'Cream',

  /* 区 A · 建档向导族 · `src/components/contract-wizard/**` */
  'wizard.maxStages': 'A project can have at most {max} stages',
  'wizard.selectStagesTitle': 'Select the stages for this project',
  'wizard.selectedCount': '{count} selected / limit {max}',
  'wizard.scheduleBasis': 'Scheduling basis',
  'wizard.scheduleBasisAria': 'Scheduling basis {label}',
  'wizard.byDurationTitle':
    'Schedule by stage duration (enter days per stage; the end date is calculated automatically)',
  'wizard.byDurationHint':
    'Stages left blank are spread by the default share. You can also switch between calendar days / workdays under “Advanced settings → Scheduling basis”.',
  'wizard.quickPresets': 'Quick presets',
  'wizard.quickPresetsWithDomain': 'Quick presets ({domain})',
  'wizard.noPresets': 'No quick presets for this board yet — tick the stages directly.',
  'wizard.presetAria': 'Preset {name}',
  'wizard.customPresetAria': 'Custom preset {name} ({library})',
  'wizard.customPresetTitle': 'Custom industry library “{library}”',
  'wizard.stagePool': 'Stage pool',
  'wizard.addCustomStageAria': 'Add custom stage',
  'wizard.customStages': 'Custom stages',
  'wizard.customStagesEmpty':
    'No custom stages yet. Use “+ Custom stage” above to add one (for example “Fire permit review”).',
  'wizard.collapseOtherDomains': 'Hide stages from other industries',
  'wizard.showOtherDomains': 'Show stages from other industries ({domains})',
  'wizard.duplicateNames':
    'Duplicate stage names: {names}. Rename them before submitting (the Agent channel locates stages by name, so duplicates are ambiguous).',
  'wizard.selectedOrderTitle': 'Selected order (move up / down)',
  'wizard.longListHint':
    '{count} stages selected — that is a lot. Make sure each one has a clear deliverable; merge them or use a preset if needed.',
  'wizard.minStages': 'Select at least {min} stages',
  'wizard.durationPlaceholder': 'Days',
  'wizard.durationAria': '{name} duration (days)',
  'wizard.daysUnit': 'days',
  'wizard.moveUpAria': 'Move {name} up',
  'wizard.moveDownAria': 'Move {name} down',
  'wizard.removeAria': 'Remove {name}',
  'wizard.chipToggleAria': '{action} stage {name}',
  'wizard.deselect': 'Deselect',
  'wizard.select': 'Select',
} as const;
