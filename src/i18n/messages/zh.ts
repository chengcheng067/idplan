/**
 * 中文文案表（**全站唯一文案源**，键为扁平点号串）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 纪律（照 `src/constants/agentTerms.ts` 的体例）
 * ══════════════════════════════════════════════════════════════════════
 *   ① 本文件**只允许加键、改值**，不许改键名——键名是对外契约，
 *      `en.ts` 与 `src/i18n/labels.ts` 都按它对齐（改键名 = 编译错，见下）；
 *   ② `MessageKey` 由本表导出，`en.ts` 声明为 `Record<MessageKey, string>`
 *      ⇒ **英文缺任何一个键都编译不过**（这是「两列都得给」的机器保障）；
 *   ③ 中文值必须与改造前源码里的字面量**逐字节一致**——全量用例与真机
 *      验收（`tests/settings-zones.spec.ts` 等）按中文文案定位元素，
 *      「默认中文」下行为必须零变化。这条不是风格洁癖，是回归前提。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 与 `src/core/types/enums.ts` 的关系（为什么那里还留着中文值）
 * ══════════════════════════════════════════════════════════════════════
 * `enums.ts` 的五张标签表（REST_POLICY_LABELS / SCHEDULE_BASIS_LABELS /
 * MEMBER_ROLE_LABELS / TASK_STATUS_LABELS / MEMBER_ACTOR_KIND_LABELS）
 * **本批不移除值**，原因有三，全部是硬约束：
 *   ① 它们的消费方里有 `src/print/**`（7 个文件）与 `src/lib/restPolicyRecalc.ts`、
 *      `src/core/services/task.service.ts`——打印是**后批**，且
 *      `src/core/**` 属共享内核（服务端也跑），批 1 动不得；
 *   ② `tests/workdays.rest-policy.spec.ts:447-449 / :479-480` 直接断言这五张表的
 *      中文值（`expect(REST_POLICY_LABELS[DoubleOff]).toBe('双休')`），
 *      `tests/print-selector-modules.spec.tsx:1133` 断言经典模板名里含「经」；
 *      把值换成 key 会当场撞红三条**不属本批**的 spec；
 *   ③ `enums.ts` 在 `tests/arch-boundary.spec.ts` 的共享内核约束面内
 *      （禁 window / document / localStorage）⇒ 它**不可能**自己读语言状态。
 * ⇒ 因此：值留在 enums（打印与既有用例继续吃中文），React 层改走 `t()`，
 *   两张表的**中文一致性由 `tests/i18n.spec.ts` 逐键对照锁死**（防漂移）。
 *   后批动打印时，是把 enums 的表改成 key、消费方整体改指向。
 */
export const zhMessages = {
  /* ──────────────────────────── 通用 ──────────────────────────── */
  'common.unknown': '未知',
  'common.untitledProject': '项目',
  'common.loading': '正在加载…',
  'common.updateAvailableAria': '有新版本可用',
  'common.plugins': '插件',

  /* ─────────────────────── 设置抽屉 · 外壳 ─────────────────────── */
  'settings.title': '设置',
  'settings.betaBadge': 'Beta',
  'settings.betaTitle': '内测版本',
  'settings.closeAria': '关闭设置',
  'settings.navAria': '设置分区',
  'settings.drawerAria': '设置',

  /* ──────────────────── 设置抽屉 · 六个一级分区 ──────────────────── */
  'settings.zone.appearance': '外观',
  'settings.zone.schedule': '排程',
  'settings.zone.data': '数据与备份',
  'settings.zone.plugins': '插件',
  'settings.zone.industry': '行业与模板',
  'settings.zone.about': '关于',

  /* ───────────────── 设置抽屉 · 插件区两段二级子导航 ───────────────── */
  'settings.pluginsSub.plugins': '插件',
  'settings.pluginsSub.agent': 'Agent 与自动化',

  /* ────────────────────── 设置抽屉 · 各区小标题 ────────────────────── */
  'settings.section.theme': '主题',
  'settings.section.restPolicy': '休息制度',
  'settings.section.scheduleBasis': '排期基准',
  'settings.section.dataLocation': '数据存在哪',
  'settings.section.backup': '备份',
  'settings.section.frontendLog': '前端日志',
  'settings.section.update': '更新',
  'settings.section.agentSeats': 'Agent 与本地库',
  'settings.section.naturalLanguage': '自然语言通道',
  'settings.section.agentBoard': 'Agent 看板',
  'settings.section.about': '关于',
  'settings.section.support': '赞赏与反馈',

  /* ───────────────────── 外观区 · 主题 / 语言 ───────────────────── */
  'appearance.theme.light': '浅色',
  'appearance.theme.dark': '深色',
  'appearance.theme.system': '跟随系统',
  'appearance.themeHint': '选「跟随系统」后，应用随系统深色 / 浅色设置实时变化。',
  'appearance.lang': '语言',
  'appearance.lang.zh': '中文',
  'appearance.lang.en': 'English',
  'appearance.langHint': '切换后界面文案即时更新，无需重启。',

  /* ──────────────────────── 侧栏主导航 ──────────────────────── */
  'nav.mainAria': '主导航',  'nav.projects': '项目',
  'nav.board': '看板',
  'nav.myTasks': '我的任务',
  'nav.agent': 'Agent',
  'nav.agentAreaAria': 'Agent 工作区',
  'nav.agentWorkspace': '工作区',
  'nav.agentExecutions': '执行记录',
  'nav.homeAria': 'ID Plan 首页',
  'nav.sidebarAria': '主导航侧边栏',
  /* 窄窗（<xl）时侧栏以抽屉形态出现，这是该抽屉浮层的无障碍名（与「主导航侧边栏」不同面） */
  'nav.drawerAria': '导航菜单',
  'sidebar.agentBoards': 'Agent 看板',
  'sidebar.noIdentityHint':
    '还未进入身份。点侧栏最下方的身份行选择成员后，这里会显示你能看到与改动的项目。',
  'nav.pluginBadge': '插件',

  /* ─────────────── 侧栏底部区 / 手机档「更多」菜单（同一批文案，两处共用）─────────────── */
  'sidebar.settingsTitle': '设置（导出日志 / 清空日志）',
  'sidebar.loadDemo': '载入示例项目',
  'sidebar.loadDemoTitle': '载入 5 个演示项目（覆盖式替换当前数据）——用来快速看懂产品',
  'sidebar.saveBackup': '保存备份',
  'sidebar.saveBackupTitle': '保存备份（导出为本地 JSON 文件）',
  'sidebar.loadBackup': '加载备份',
  'sidebar.loadBackupTitle': '加载备份（从本地 JSON 文件恢复，会替换当前全部数据）',
  'sidebar.newProject': '新建项目',
  'sidebar.viewAllProjectsTitle': '查看全部项目',
  'sidebar.viewAll': '查看全部',
  'sidebar.expandAllProjects': '展开显示全部 {count} 个项目',
  'sidebar.remainingProjects': '还有 {count} 个项目…',
  /* 手机档「更多」菜单（<md 的唯一导航入口） */
  'mobile.moreAria': '更多操作',

  /* ─────────────────────── 首启引导卡（FirstRunGuide）─────────────────────── */
  'guide.aria': '首次运行引导',
  'guide.title': '欢迎使用 ID Plan',
  'guide.dismissAria': '先四处看看',
  'guide.lead.before': '它把一份项目合同，变成一张',
  'guide.lead.strong': '看得懂的阶段时间轴',
  'guide.lead.after': '——看板、月历、甘特、打印，四种看法同一份数据。',
  'guide.privacy': '数据存在你自己机器上，离线可用，不上传。',
  'guide.pickDomain': '想先看看哪个行业的样子？',
  'guide.card.software': '软件',
  'guide.line.software': '选它就带出该行业的阶段与看板列——规划到发布五个阶段排在一张板上',
  'guide.card.travel': '旅游',
  'guide.line.travel': '选它就带出该行业的阶段与看板列，线路策划到出行结算节点再多也不丢',
  'guide.card.indoor': '室内',
  'guide.line.indoor': '选它就带出该行业的阶段与看板列，一图看清走到哪',
  'guide.demoNotReady': '示例筹备中',
  'guide.adminOnlyTitle': '仅管理员可载入示例项目',
  'guide.lookAround': '先四处看看（不进示例）',
  'guide.canReturn': '随时可在侧栏「载入示例项目」回看',

  /* ─────────────────────────── 顶栏 ─────────────────────────── */
  'topbar.page.home': '我的项目',
  'topbar.page.memberBoard': '成员看板',
  'topbar.page.myTasks': '我的任务',
  'topbar.page.agent': 'Agent 看板',
  'topbar.breadcrumb.project': '项目',
  'topbar.breadcrumb.projectDetail': '项目详情',
  'topbar.breadcrumb.myProjects': '我的项目',
  'topbar.breadcrumb.schedule': '日程表',
  'topbar.breadcrumb.calendar': '月历',
  'topbar.searchPlaceholder': '搜索项目、任务或客户…',
  'topbar.searchAria': '搜索项目、任务或客户',
  'topbar.searchClearAria': '清空并关闭搜索',
  'topbar.backAria': '返回上一页',
  /* 汉堡（<xl 的侧栏抽屉触发器，与手机档 MobileMoreMenu 的 ⋮ 不是同一个控件） */
  'topbar.navMenuAria': '打开导航菜单',
  /* 平板档（768–1279）的搜索图标按钮 */
  'topbar.searchOpenAria': '打开搜索',
  'topbar.searchOpenTitle': '搜索（⌘K）',
  /* Electron 自绘窗口三键（Windows 专有；macOS 走系统红绿灯，整块不渲染） */
  'topbar.windowControlsAria': '窗口控制',
  'topbar.windowMinimize': '最小化',
  'topbar.windowMaximize': '最大化',
  'topbar.windowRestore': '还原',

  /* ────────────────────── 星期（两套粒度）────────────────────── */
  /* 短名：月历 7 列表头（改造前是「一~日」单字） */
  'weekday.short.mon': '一',
  'weekday.short.tue': '二',
  'weekday.short.wed': '三',
  'weekday.short.thu': '四',
  'weekday.short.fri': '五',
  'weekday.short.sat': '六',
  'weekday.short.sun': '日',
  /* 全名：休息制度编辑器里的「周X」（改造前是 `周${短名}` 拼串） */
  'weekday.full.mon': '周一',
  'weekday.full.tue': '周二',
  'weekday.full.wed': '周三',
  'weekday.full.thu': '周四',
  'weekday.full.fri': '周五',
  'weekday.full.sat': '周六',
  'weekday.full.sun': '周日',

  /* ─────────────── 枚举展示名镜像（值同 enums.ts，锁死一致）─────────────── */
  'restPolicy.doubleOff': '双休',
  'restPolicy.singleOff': '单休',
  'restPolicy.bigSmallWeek': '大小休',
  'scheduleBasis.calendar': '按自然日',
  'scheduleBasis.workday': '按工作日',
  'memberRole.admin': '管理员',
  'memberRole.member': '成员',
  'memberActorKind.human': '人类',
  'memberActorKind.agent': 'Agent',
  'taskStatus.draft': '草稿',
  'taskStatus.ready': '就绪',
  'taskStatus.claimed': '已认领',
  'taskStatus.inProgress': '进行中',
  'taskStatus.blocked': '受阻',
  'taskStatus.review': '待验收',
  'taskStatus.done': '已完成',
  'stageStatus.notStarted': '未开始',
  'stageStatus.inProgress': '进行中',
  'stageStatus.completed': '已完成',
  'stageStatus.delayed': '延期',

  /* ─────────────────── 月历 · 状态筛选 / 图例 ─────────────────── */
  'calendarStatus.inProgress': '进行中',
  'calendarStatus.completed': '已完成',
  'calendarStatus.overdue': '逾期',
  'calendarStatus.notStarted': '未开始',

  /* ─────────────────────── Agent · 写回状态 ─────────────────────── */
  'agent.writeback.draft': '草稿',
  'agent.writeback.proposed': '待审',
  'agent.writeback.applied': '已应用',
  'agent.writeback.rejected': '已拒绝',
  'agent.writeback.conflict': '冲突',

  /* ───────────────────── Agent · 接入档位（本机 / NAS）───────────────────── */
  'agent.ingress.local': '本机',
  'agent.ingress.nas': 'NAS',

  /* ─────────────────── 建项目表单 · 中性示例占位 ───────────────────
   * ⚠️ 值必须保持**跨行业中性**（「某某项目」这类占位，不许写某个行业的示例）。
   *    `tests/industry-neutral-copy.spec.ts` ② 的载体从源码挪到了本表，
   *     原意不变：placeholder 不许变成行业本位话术。 */
  'project.namePlaceholder': '如「某某项目・第一阶段」',

  /* ─────────────────── toast（store 层高频，批 1 范围）─────────────────── */
  'toast.projectCreated': '「{name}」建档完成',
  'toast.projectCreatedManual': '「{name}」手动建档完成',
  'toast.projectCreateFailed': '建档失败，请重试。',
  'toast.projectUpdated': '项目信息已更新',
  'toast.updateFailed': '更新失败',
  'toast.projectDomainConfirmed': '项目板块已确认',
  'toast.projectDomainConfirmFailed': '板块确认失败，请重试。',
  'toast.boardCreated': '「{name}」看板已创建',
  'toast.boardCreateFailed': '创建看板失败，请重试。',
  'toast.boardReadBackFailed': '看板已创建，但读取新看板失败。请刷新后查看。',
  'toast.archived': '已归档',
  'toast.restored': '已恢复',
  'toast.restoredToActive': '已恢复为进行中',
  'toast.actionFailed': '操作失败',
  'toast.projectDeleted': '「{name}」已删除',
  'toast.deleteFailed': '删除失败',
  'toast.takeoverFailed': '接管失败，请重试。',
  'toast.takeoverNotSupportedOnNas':
    '接管操作仅支持本机数据档：NAS 档的服务端尚未提供跨项目搬移端点。',
  'toast.projectPromoted': '「{name}」已转为正式项目，归「我的项目」管理',
  'toast.tasksMoved': '已搬运 {count} 条任务',
  'toast.tasksMovedDropped': '已搬运 {count} 条任务（剥离 {dropped} 条悬空依赖）',
  'toast.tasksMoveFailed': '搬运失败，请重试。',
  'toast.rescheduled': '已改期并留痕',
  'toast.rescheduleFailed': '改期失败',
  'toast.statusUpdated': '状态已更新',
  'toast.statusTransitionFailed': '状态流转失败',
  'toast.saveFailed': '保存失败',
  'toast.taskStatusSaveFailedRolledBack': '任务状态保存失败，已回滚。',
  'toast.taskSaved': '任务已保存',
  'toast.taskSaveFailed': '任务保存失败',
  'toast.entryAdded': '条目已添加',
  'toast.entryAddFailed': '添加失败',
  'toast.entryDeleted': '条目已删除',
  'toast.entryDeleteFailedReverted': '删除失败，已还原。',
  'toast.memberAdded': '成员「{name}」已添加',
  'toast.memberAddFailed': '添加成员失败',
  'toast.memberUpdated': '成员信息已更新',
  'toast.payloadPreviewFailed': 'payload 预览失败。',
  'toast.payloadWriteFailed': 'payload 写入失败。',
  'toast.payloadWriteDone': '写入完成：新增 {created} / 更新 {updated}',
  'toast.payloadWriteDoneRejected': '写入完成：新增 {created} / 更新 {updated} / 拒绝 {rejected}',
  'toast.handoffFailed': '交接包生成失败。',
  'toast.claimed': '已认领，开始执行',
  'toast.claimFailed': '认领失败。',
  /* Agent store 的状态流转失败文案带句号，与项目 store 的同名提示**不同字面**
   * （改造前就如此）。逐字节保真是本批的硬前提，故单立一键，不擅自统一标点。 */
  'toast.agentStatusTransitionFailed': '状态流转失败。',
  'toast.payloadInvalid': 'payload 校验失败：{path} {message}',
  'toast.payloadMoreIssues': '……另有 {count} 条结构错误未展示。',

  'common.close': '关闭',

  /* ────────────────── Agent 接入面板（AgentIngressPanel）────────────────── */
  'ingress.title': '接入外部写入方',
  'ingress.explain.before': '在 Windows 桌面版的',
  'ingress.explain.localMode': '本机模式',
  'ingress.explain.afterA': '下，点下方「生成接入信息」即可：',
  'ingress.explain.afterB':
    '访问令牌自动生成，接入信息（地址 / 令牌 / 端点 / payload 格式）写入固定路径的',
  'ingress.explain.writers': '，WorkBuddy 等写入方',
  'ingress.explain.readFile': '读这个文件即完成接入。',
  'ingress.explain.nasNote': 'NAS 模式当前只支持连通探测，远程自动写入尚未启用。',
  'ingress.addressTitle': '服务地址',
  'ingress.modeTablistAria': '通道档位',
  'ingress.addressAria': '服务地址',
  'ingress.localAddressHint': '本机模式仅监听 127.0.0.1，不对外暴露；生成接入信息后即可接收自动导入。',
  'ingress.nasAddressHint': 'NAS 模式当前仅支持地址与令牌的连通探测；远程自动写入尚未启用。',
  'ingress.fileTitle': '接入信息',
  'ingress.tokenGenerated': '令牌已生成',
  'ingress.tokenNotGenerated': '未生成',
  'ingress.generate': '生成接入信息',
  'ingress.regenerate': '重新生成',
  'ingress.regenerateTitle': '生成新令牌并重写接入文件（旧令牌立即失效）',
  'ingress.copyPath': '复制文件路径',
  'ingress.copyInstruction': '复制接入指令',
  'ingress.copyInstructionTitle': '复制完整接入指令（给不能读文件的写入方兜底）',
  'ingress.fileNotReady':
    '尚未生成。点「生成接入信息」后，把文件路径提供给写入方（或让它直接读这个固定路径）。',
  'ingress.tokenAutoNote': '令牌由本机自动生成，无需手动设置；轮换后以接入文件的最新版本为准。',
  'ingress.tokenTitle': '访问令牌',
  'ingress.tokenConfigured': '已配置',
  'ingress.tokenUnconfigured': '未配置',
  'ingress.tokenAria': '访问令牌',
  'ingress.tokenReplacePlaceholder': '重新输入以替换现有令牌',
  'ingress.tokenPastePlaceholder': '粘贴 NAS 服务端配置的访问令牌',
  'ingress.save': '保存',
  'ingress.copyTokenAria': '复制令牌',
  'ingress.copy': '复制',
  'ingress.nasTokenNote':
    'NAS 档的令牌由服务端环境变量配置（与 NAS 上设置的保持一致）；保存后不再回显原文。',
  'ingress.statusTitle': '服务状态',
  'ingress.probe': '一键探测',
  'ingress.probeOk': '可连通',
  'ingress.probeFail': '不可连通',
  'ingress.dataLayerReady': '数据层就绪',
  'ingress.dataLayerUnavailable': '数据层不可用',
  'ingress.appNotRunning': 'ID Plan 未运行（或数据层未就绪）——请先打开应用再重试。',
  'ingress.projectCount': '项目 {count} 个',
  'ingress.seatUsage': '席位 {used} / {limit}',
  'ingress.probeEmpty': '尚未探测。点「一键探测」检查服务是否可连通。',
  'ingress.syncTitle': '最近同步记录',
  'ingress.syncAt': '最近同步',
  'ingress.syncResult': '结果',
  'ingress.syncEmptyLocal': '尚未收到本机自动写入。',
  'ingress.syncEmptyNas': 'NAS 远程自动写入尚未启用，因此没有同步记录。',
  'ingress.openManual': '改为手动粘贴排期文件',

  /* ──────────────── Agent 活动流（AgentActivityStream）──────────────── */
  'agent.activity.aria': 'Agent 活动流',
  'agent.activity.title': 'Agent 活动',
  'agent.activity.changes': '{count} 项变更',
  'agent.activity.pendingProposals': '有待审提案——在「写回」标签页批量处理',
  /* ───────────────────── 首页（HomePage）───────────────────── */
  'home.subtitle': '{active} 个进行中 · {due} 个本周到期 · {overdue} 个逾期',
  'home.column.todo': '待启动',
  'home.stat.active': '进行中项目',
  'home.stat.dueThisWeek': '本周到期任务',
  'home.stat.overdue': '逾期风险',
  'home.stat.doneThisMonth': '本月完工',
  'home.viewSwitchAria': '首页视图切换',
  'home.noSearchMatch': '没有匹配「{query}」的项目',
  'home.clearSearch': '清除搜索',
  'home.memberHitsAria': '成员搜索结果',
  'home.memberHitsTitle': '搜索到的成员',
  'home.memberHitsHint': '点击查看该成员的任务看板',
  'home.archivedToggle': '已归档（{count}）',
  'empty.noActiveProjects': '还没有进行中的项目',
  'home.empty.body':
    '新建一个项目，把阶段排期跑起来；项目名称与竣工日为必填，其余可进入后随时补充。',
  'home.empty.privacy':
    '你的数据自动保存在本机浏览器中，关闭浏览器不会丢失；如需换电脑或留档，点击侧栏底部的「保存备份」导出文件，随时可再恢复。',
  'home.openManual': '直接手动建档',
  /* ───────────────────── 我的任务（MyTasksPage）───────────────────── */
  'myTasks.subtitle': '只显示与我相关的内容',
  'myTasks.groupAria': '任务分组方式',
  'myTasks.byProject': '按项目',
  'myTasks.byTime': '按时间',
  'myTasks.showDoneOn': '已含已完成',
  'myTasks.showDoneOff': '显示已完成',
  'myTasks.stat.today': '今天到期',
  'myTasks.stat.undone': '未完成总数',
  'myTasks.group.overdue': '已逾期',
  'myTasks.group.today': '今天',
  'myTasks.group.week': '7 天内',
  'myTasks.group.later': '更晚',
  'myTasks.noIdentity': '请到左侧导航最下方进入身份，输入你的姓名；',
  'myTasks.noIdentityNoAdmin': '若系统还没有管理员，请先让管理员完成首次设置后再进入。',
  'myTasks.empty.mine': '{name}，目前没有分配给你的待办 🎉',
  'myTasks.empty.notFound': '未找到该身份。',
  'myTasks.unknownProject': '（未知项目）',
  'myTasks.overdueCount': '逾期 {count}',
  'myTasks.markDone': '标记完成',
  'myTasks.markNotDone': '标记未完成',
  'myTasks.dueOverdue': '逾期{days}天',
  'myTasks.dueInDays': '{days} 天',
  /* ───────────── 成员看板页（MemberBoardPage，⑤b · 含任务三块）─────────────
     复用（不另立第二份真相）：
       · `topbar.backAria`（返回上一页）—— 本页返回键与 TopBar 面包屑返回箭**同一口径**
         （`goBack` 注释明写「同一个行为，不是第二套」）；
       · `nav.board` / `topbar.breadcrumb.calendar` —— 视图切换与首页**同一个控件、同一档位**；
       · `home.stat.*` 四个统计卡标签 —— 本页统计行与首页**逐字同款**（并有真机 spec 锁）；
       · `myTasks.group.overdue`（已逾期）—— 任务三块的「已逾期」与「我的任务」页同源口径。 */
  'member.board.title': '项目看板',
  'member.board.titleOf': '{name} 的项目看板',
  'member.board.scopeAdmin': '管理员视角 · 仅显示与「{name}」相关的项目与任务',
  'member.board.scopeSelf': '仅显示与我相关的项目',
  'member.board.viewSwitchAria': '成员看板视图切换',
  'member.board.missingTitle': '找不到该成员',
  'member.board.missingBody':
    '这个看板链接指向的成员已不存在（可能被删除）。可以返回成员看板查看自己的项目。',
  'member.board.missingBack': '返回成员看板',
  'member.board.emptyTitle': '还没有与你相关的项目',
  'member.board.emptyBody':
    '当管理员把阶段负责人或参与任务分派给你后，相关项目会出现在这里。',
  'member.board.columnEmpty': '暂无项目',
  'member.board.unknownProject': '未知项目',
  'member.board.openProjectTitle': '打开项目：{name}',
  /* 任务三块（已逾期那块的标签复用 myTasks.group.overdue） */
  'member.triage.ongoing': '进行中',
  'member.triage.recentDone': '近期完成',
  'member.triage.emptyOverdue': '没有逾期的任务',
  'member.triage.emptyOngoing': '没有进行中的任务',
  'member.triage.emptyRecentDone': '最近没有完成的任务',
  'member.triage.moreDone': '另有 {count} 条更早完成',
  /* ───────────── Agent 看板页（AgentBoardPage，⑤b-②）─────────────
     · 四组标题与「人话/技术」模式名在页面里是**模块级键表**（模块顶层不能调 useLang，
       本仓既定形态是「键表 + 渲染期 t()」，见 src/i18n/useLang.ts 纪律②）。
     · `agentBoard.dueOverdue` / `dueRemaining` 与 `myTasks.dueOverdue` / `dueInDays`
       是**两套**：那边是「逾期3天」（无空格），这边原文是「逾期 3 天」（有空格），
       为保中文逐字不变而分开登记（英文取值同口径，不制造第三份措辞）。 */
  'agentBoard.group.confirm': '待我确认',
  'agentBoard.group.ready': '可开工',
  'agentBoard.group.doing': '进行中',
  'agentBoard.group.done': '已完成',
  'agentBoard.group.hidden': '隐藏',
  'agentBoard.mode.human': '人话',
  'agentBoard.mode.tech': '技术',
  'agentBoard.modeTabsAria': '看板模式切换',
  'agentBoard.dueOverdue': '逾期 {days} 天',
  'agentBoard.dueRemaining': '剩余 {days} 天',
  /* 接入通道的 toast（10 处） */
  'agentBoard.tokenSaved': '访问令牌已保存到本机。',
  'agentBoard.tokenNotConfigured': '尚未配置访问令牌。',
  'agentBoard.tokenCopied': '访问令牌已复制。',
  'agentBoard.copyFailed': '复制失败，请重试。',
  'agentBoard.ingressEnvUnsupported': '当前运行环境不支持写入接入文件（仅 Windows 桌面版可用）。',
  'agentBoard.ingressWriteFailed': '接入文件写入失败：{reason}',
  'agentBoard.unknownReason': '未知原因',
  'agentBoard.ingressGeneratedCopied': '接入信息已生成，路径已复制：{path}',
  'agentBoard.ingressGenerated': '接入信息已生成：{path}',
  'agentBoard.ingressNotGenerated': '尚未生成接入信息，请先点「生成接入信息」。',
  'agentBoard.pathCopied': '文件路径已复制。',
  'agentBoard.tokenNotGenerated': '尚未生成访问令牌，请先生成接入信息。',
  'agentBoard.ingressFileAbsent': '（尚未生成接入文件，请先在面板点「生成接入信息」）',
  'agentBoard.ingressInstructionCopied': '接入指令已复制，粘给写入方即可。',
  /* 写回提案落定的 toast */
  'agentBoard.proposalsApproved': '已通过 {count} 条提案',
  'agentBoard.proposalsRejected': '已拒绝 {count} 条提案',
  'agentBoard.proposalsFailed': '{count} 条提案落定失败（可能已被他人处理）',
  /* 工具行 */
  'agentBoard.backToProjects': '← 项目',
  'agentBoard.boardSelectAria': '选择 Agent 看板',
  'agentBoard.noBoards': '（暂无 Agent 看板）',
  'agentBoard.deleteTitle': '永久删除当前 Agent 看板',
  'agentBoard.deleteDisabledTitle': '先选中一块 Agent 看板',
  'agentBoard.deleteButton': '删除看板',
  /* 「现在该做什么」置顶条 */
  'agentBoard.nowTitle': '现在该做什么',
  'agentBoard.startNow': '开始处理',
  'agentBoard.claimHint': '认领后即可开始处理，相关前置依赖都已就绪。',
  'agentBoard.nowEmpty': '暂时没有可开工的任务。导入新任务或解除受阻后会出现在这里。',
  'agentBoard.cyclicWarning': '检测到 {count} 条任务存在依赖环，已移出主列表。请修正依赖后刷新。',
  /* 置顶条脚注（数字保持加粗 span ⇒ 拆键；`{' '}` 与 `<span>` 由 JSX 保留） */
  'agentBoard.sameGroupPre': '同类{group} ',
  'agentBoard.unitItems': '项',
  'agentBoard.overdueInline': '· 已逾期 ',
  /* 隐藏提示行（句子中间夹一个按钮 ⇒ 空格落在英文取值尾部） */
  'agentBoard.hiddenHintPre': '另有 {count} 条在上游准备中，',
  'agentBoard.hiddenHintSwitch': '切到「{mode}」',
  'agentBoard.hiddenHintPost': '可查看全部',
  /* 规划向导 / 接入面板 / 删除确认 */
  'agentBoard.planningWizard': '用 AI 规划建板',
  'agentBoard.ingressModalAria': '接入外部写入方',
  'agentBoard.deleteDialogTitle': '删除 Agent 看板',
  'agentBoard.deleteConfirmText': '永久删除',
  'agentBoard.deleteBodyPre': '确认删除「{name}」？该看板下的所有阶段与任务将一并永久删除，',
  'agentBoard.deleteBodyStrong': '不可恢复',
  'agentBoard.deleteBodyPost':
    '，且不会进入「已归档」。 若只是想把它留在项目里，请改用详情页的「接管 · 转为正式项目」。',
  /* ───────── Agent 看板页渲染的四个组件（⑤b-③：卡 / Ready 队列 / 来源统计 / 提案审批）─────────
     复用：剩余·逾期天数直接用 `agentBoard.dueOverdue` / `dueRemaining`（同一句话、同一口径）。 */
  'agentCard.actionClaim': '开始处理',
  'agentCard.actionApprove': '验收',
  'agentCard.actionUnblock': '解阻塞',
  'agentCard.actionProgress': '查看进度',
  'agentCard.actionReuse': '查看/复用',
  'agentCard.actionOpen': '查看',
  'agentCard.metaOwner': '负责人：{name}',
  'agentCard.unclaimed': '待认领',
  'agentCard.metaBlocked': '{who} · 受阻：{titles}',
  'agentCard.titleSep': '、',
  'agentCard.blockedTitle': '{term}：{titles}',
  'agentCard.blockedTag': '（受阻）',
  'agentQueue.title': '⚡ {term} —— 下一步该做什么',
  'agentQueue.cyclicWarning':
    '检测到 {count} 条任务存在依赖环（deps 相互引用），已从 Ready 队列排除。请在任务详情中修正 deps 后刷新。',
  'agentQueue.empty':
    '当前没有可执行的 Ready 任务。通过「{term}」导入或把任务流转到 ready 即可出现在这里。',
  'agentQueue.claim': '认领',
  'agentQueue.blockedTitle': '暂时不要碰（被阻塞 {count}）',
  'agentQueue.blockedByQuote': '「{title}」',
  'agentQueue.blockedBySep': '、',
  'agentSource.empty': '暂无 agent 来源任务（导入 payload 后此处按 agentKind 聚合）',
  'agentSource.seatsPre': 'Agent 席位 已用 ',
  'agentSource.seatsPost': '/{limit}',
  'agentSource.seatsOver': '（超出免费额度，仅提示）',
  'agentProposal.notProvided': '未提供',
  'agentProposal.emptyValue': '（空）',
  'agentProposal.reviewAria': '写回提案审批',
  'agentProposal.pendingTitle': '待审提案（{count}）',
  'agentProposal.picked': '已选 {count}',
  'agentProposal.approveAll': '批量通过',
  'agentProposal.rejectAll': '批量拒绝',
  'agentProposal.selectAria': '选择提案 {id}',
  'agentProposal.noReason': '（提案未给理由）',
  'agentProposal.confidence': '置信度 {value}',
  'agentProposal.expandAria': '展开变更明细',
  'agentProposal.collapseAria': '收起变更明细',
  'agentProposal.approveAria': '通过提案 {id}',
  'agentProposal.rejectAria': '拒绝提案 {id}',
  /* ───────── 执行控制台页（AgentExecutionConsolePage，⑤b-④）─────────
     六张模块级中文表（矛盾标记 / 执行十态 / 尝试六态 / 提案五态 / 行为体 / 来源）
     一律改成**键表**：模块顶层调不了 useLang()，本仓既定形态是「键表 + 渲染期 t()」。
     ⚠️ 提案五态与 `agent.writeback.*`（labels.ts）**不是同一份**：那套中文是
     「待审 / 已拒绝」，本页是「待应用 / 已驳回」——措辞不同，故不能复用。 */
  'agentConsole.contradiction.live': '数据矛盾：该执行单已结束，却有尝试仍显示「执行中」',
  'agentConsole.contradiction.pending': '数据矛盾：该执行单已结束，却有尝试仍处于「排队中」',
  'agentConsole.contradictionHint':
    '这类记录是终态执行单上残留的未结束尝试（多为进程被杀或备份恢复绕过状态校验所致）。状态机没有合法转移可收口，故按原样保留、仅供识别。',
  'agentConsole.execStatus.draft': '草稿',
  'agentConsole.execStatus.awaitingConfirmation': '待确认',
  'agentConsole.execStatus.queued': '排队中',
  'agentConsole.execStatus.running': '执行中',
  'agentConsole.execStatus.paused': '已暂停',
  'agentConsole.execStatus.needsAttention': '需关注',
  'agentConsole.execStatus.awaitingReview': '待复核',
  'agentConsole.execStatus.completed': '已完成',
  'agentConsole.execStatus.failed': '已失败',
  'agentConsole.execStatus.cancelled': '已取消',
  'agentConsole.attemptStatus.queued': '排队中',
  'agentConsole.attemptStatus.running': '执行中',
  'agentConsole.attemptStatus.succeeded': '成功',
  'agentConsole.attemptStatus.failed': '失败',
  'agentConsole.attemptStatus.cancelled': '已取消',
  'agentConsole.attemptStatus.interrupted': '被中断',
  'agentConsole.proposalStatus.draft': '草稿',
  'agentConsole.proposalStatus.proposed': '待应用',
  'agentConsole.proposalStatus.applied': '已应用',
  'agentConsole.proposalStatus.rejected': '已驳回',
  'agentConsole.proposalStatus.conflict': '冲突',
  'agentConsole.actor.user': '人',
  'agentConsole.actor.agent': 'Agent',
  'agentConsole.actor.system': '系统',
  'agentConsole.actor.external': '外部',
  'agentConsole.source.projectTask': '项目任务',
  'agentConsole.source.memberBoard': '成员看板',
  'agentConsole.source.manual': '手动',
  'agentConsole.attemptNoSuffix': '（尝试 #{n}）',
  'agentConsole.attemptNo': '尝试 #{n}',
  'agentConsole.minutes': '{mins} 分钟',
  'agentConsole.terminalReason': '结束原因：{reason}',
  'agentConsole.reason': '原因：{reason}',
  'agentConsole.blockedReason': '阻塞：{reason}',
  'agentConsole.decidedBy': '裁决人 {name}',
  'agentConsole.noDecision': '尚无裁决',
  'agentConsole.loadingDetail': '正在读取执行明细…',
  'agentConsole.loadingList': '正在读取执行记录…',
  'agentConsole.listLoadFailed': '执行记录读取失败。',
  'agentConsole.listFailedTitle': '执行记录读取失败',
  'agentConsole.detailGone': '该执行单已不存在，可能已被删除。以下为仍保留的明细数据。',
  'agentConsole.detailLoadFailed': '执行明细读取失败。',
  'agentConsole.retry': '重试',
  'agentConsole.refresh': '刷新',
  'agentConsole.section.attempts': '执行尝试',
  'agentConsole.section.events': '事件流水',
  'agentConsole.section.proposals': '写回提案',
  'agentConsole.empty.attempts': '尚无执行尝试。',
  'agentConsole.empty.events': '尚无事件流水。',
  'agentConsole.empty.proposals': '尚无写回提案。',
  'agentConsole.field.created': '创建',
  'agentConsole.field.started': '开始',
  'agentConsole.field.finished': '结束',
  'agentConsole.field.duration': '耗时',
  'agentConsole.title': '执行控制台',
  'agentConsole.subtitle': '只读视图 · 共 {count} 条执行记录',
  'agentConsole.hiddenCount': ' · 已隐藏 {count} 条矛盾数据',
  'agentConsole.attentionCount': ' · {count} 条需关注',
  'agentConsole.showContradictions': '显示矛盾数据',
  'agentConsole.recordsCount': '{count} 条',
  'agentConsole.emptyVisibleTitle': '当前没有可正常显示的执行记录',
  'agentConsole.emptyAllHidden':
    '库中共有 {count} 条执行记录，全部被判定为「矛盾数据」且已按你的设置隐藏。',
  'agentConsole.emptyAllHiddenHint': '打开右上角的「显示矛盾数据」开关即可看到它们。',
  'agentConsole.emptyNoneTitle': '还没有任何执行记录',
  'agentConsole.emptyNoneBody1':
    '当 Agent 或人工在项目、成员看板上发起一次执行时，执行单会出现在这里。',
  'agentConsole.emptyNoneBody2': '你现在看到的是空视图，说明尚未有执行被创建。',
  /* ───────────────────── 项目详情（ProjectDetailPage）───────────────────── */
  'project.notFound': '未找到该项目（可能已被归档或删除）。',
  'project.backToList': '← 返回项目列表',
  'project.noRelatedStages': '该项目的阶段与你无关。',
  'project.needIdentity': '请先到左侧导航最下方进入身份，再查看项目。',
  'project.backToMyTasks': '返回我的任务',
  'project.backToHome': '返回首页',
  'project.printPreviewTitle': '打印预览（应用内面板）',
  'project.schedule': '日程表',
  'project.openInAgentTitle': '在该 Agent 工作区中打开',
  'project.takeoverTitle': '转为正式项目，或把任务搬进人类项目',
  'project.takeover': '接管',
  'project.archived': '已归档',
  'project.archiveHint': '归档后从首页列表隐藏',
  'project.archive': '归档',
  'project.client': '客户：{name}',
  'project.totalDays': '· 总工期 {days} 天',
  'project.currentStage': '当前：',
  'project.itineraryHint': '客户行程单按天列出交通、住宿、安排与费用，可直接发给客户或打印。',
  'project.itineraryTitle': '打开客户行程单（新窗口，只读导出）',
  'project.itinerary': '客户行程单',

  /* ───────────── Agent 看板页 · 现状说明盒（data-agent-stance）───────────── */
  'agent.stanceBefore': 'Agent 看板目前',
  'agent.stanceStrong': '只承接外部写入方的排期',
  'agent.stanceNl': '（本机自动导入可用，NAS 远程写入尚未启用），这一块正按反馈重新定义。',
  /* ───────────── 月历空态四态（CalendarEmptyStates）───────────── */
  'calendar.empty.body': '新建一个项目，把阶段排期跑起来',
  'calendar.empty.monthNoActive': '{month} 暂无在途项目',
  'calendar.empty.tryAdjacent': '试试切换到相邻月份看看',
  'calendar.empty.stageNo': '阶段 {n}',
  'calendar.empty.noFilterMatch': '没有符合筛选条件的项目',
  'calendar.empty.clearFilter': '清除筛选',
  'calendar.empty.stageTimeline': '阶段时间轴',
  'calendar.empty.clientPrefix': '委托方：',
  'calendar.empty.period': '· 周期',
  'calendar.empty.noRelated': '该项目的阶段与你无关',
  'calendar.empty.noRelatedBody': '你可以查看项目概况，或联系项目负责人',

  /* ───────────────────── Agent 看板列表空态（AgentBoardList）───────────────────── */
  'agentList.emptyAria': 'Agent 看板（暂无）',
  'agentList.emptyTitle': '还没有 Agent 看板',
  'agentList.scopeLine': '这里只放外部写入方（如 WorkBuddy）的排期看板，与「我的项目」互不混料。',
  'agentList.canCreate': '可以自己新建一块看板，也可以把外部写入方接上后由它直接建板。',
  'agentList.writerOnly': '把外部写入方接上后，它会直接在这里建板并写入任务。',
  'agentList.statusLine': '现状：本机自动导入（Windows 桌面版）可用，NAS 远程写入尚未启用。',
  'agentList.redefineLine': '这一块的定位正在按你的反馈重新讨论，可能还会有较大调整。',
  'agentList.createButton': '新建 Agent 看板',
  'agentList.listAria': 'Agent 看板列表',

  /* ───────────── 清单导入面板 · 提示词引导（ApplyPayloadPanel A2）───────────── */
  'agentPayload.promptAsk': '不知道让 WorkBuddy / Codex 输出什么？复制这段提示词给它',
  'agentPayload.promptSend': '把它连同你的需求一起发给外部 Agent，它会照 ID Plan 的导入格式产出 JSON；',
  'agentPayload.promptPaste':
    '你拿到 JSON 后粘贴到下面的输入区即可（粘贴即预览，不需额外点「校验」）。',
  /* 说明盒三句（`:238-240`）：段间空格归英文取值，句间空格用 JSX 的 `{' '}` */
  'agentPayload.hintPastePre': '现在可',
  'agentPayload.hintPasteStrong': '手动粘贴或拖入',
  'agentPayload.hintPastePost': '排期文件（下方输入区即用）。',
  'agentPayload.hintDesktopPre': 'Windows 桌面版本还支持经“导入任务”配置的',
  'agentPayload.hintDesktopStrong': '本机自动导入',
  'agentPayload.hintDesktopPost': '；',
  'agentPayload.hintNas': 'NAS 远程自动写入目前尚未启用，请勿将连通探测视为可导入状态。',
  /* 复制按钮两态（`:279`） */
  'agentPayload.copyPrompt': '复制提示词',
  'agentPayload.copyPromptDone': '已复制提示词',
  /* 令牌说明段（`:301-302`，两个 strong） */
  'agentPayload.tokenPre': '提示词里',
  'agentPayload.tokenStrongA': '不含访问令牌',
  'agentPayload.tokenMid': '：令牌只用于「导入任务 → 接入配置」的',
  'agentPayload.tokenStrongB': '自动写入',
  'agentPayload.tokenTail': '通道（在那一栏里设置并复制），不要贴进给 Agent 的聊天窗口。',
  /* 输入区（`:323` 占位符带 `{schema}` 插值；`:333/339/341` 是 flex 里的三项） */
  'agentPayload.pastePlaceholder': '粘贴 payload JSON，或拖入 .json / .md 文件……\n（{schema}）',
  'agentPayload.dropOr': '拖入文件或',
  'agentPayload.chooseFile': '选择文件',
  'agentPayload.afterPaste': '；粘贴完成后自动生成差异预览。',
  /* 校验失败区（`:359` / `:367` 带 `{count}` 插值） */
  'agentPayload.invalidTitle': 'payload 校验失败（未写入任何数据）',
  'agentPayload.moreErrors': '……另有 {count} 条错误未展示。',
  'agentPayload.parseFailed': '解析失败',
  'agentPayload.dropUnsupported': '仅支持 .json / .md 纯文本文件（pdf/docx 请先由 Agent 转出 payload）。',
  /* 态三两个按钮（`:425` / `:433`） */
  'agentPayload.editAgain': '重新编辑',
  'agentPayload.writing': '写入中…',
  'agentPayload.confirmWrite': '确认写入',
  /* ───────────────────── 备份 / 恢复的 toast（useBackupIo）───────────────────── */
  'backup.toast.saved': '备份包已保存',
  'backup.toast.exportFailed': '备份导出失败。',
  'backup.toast.demoFailed': '示例数据加载失败，未做任何改动。',
  'backup.toast.verifyFailed': '备份文件校验失败，未做任何改动。',
  'backup.toast.restoreFailed': '备份恢复失败，本地数据未受影响。',
  /* ───────────── 备份/恢复确认弹窗（useBackupIo · ConfirmDialog）───────────── */
  'backup.dialog.loadDemoTitle': '载入示例项目',
  'backup.dialog.restoreTitle': '从备份恢复',
  'backup.dialog.confirmLoad': '确认载入',
  'backup.dialog.confirmRestore': '确认恢复',
  'backup.dialog.demo1': '将载入',
  'backup.dialog.demoStrong': '5 个演示项目',
  'backup.dialog.demo2': '（覆盖式），',
  'backup.dialog.replaceStrong': '整体替换当前全部数据且不可撤销',
  'backup.dialog.demo3': '。没有真实数据的库可以放心载入；有真实数据建议先「保存备份」留档。',
  'backup.dialog.restore1': '恢复将',
  'backup.dialog.restore2': '。建议先「保存备份」留档，再确认恢复。',
  'backup.dialog.filePrefix': '文件：',
  'backup.dialog.noPasswordHash':
    '⚠ 此备份不含密码哈希（{count} 个成员设有密码）——导入后这些成员需重设密码。',
  /* ───────────────────── 成员管理区（MembersPageSection）───────────────────── */
  'common.save': '保存',
  'common.cancel': '取消',
  'member.sectionTitle': '成员',
  'member.showAgents': '显示 Agent（{count}/3）',
  'member.addMember': '添加成员',
  'member.typeLabel': '类型',
  'member.typeHuman': '👤 人',
  'member.seatHint': 'Agent 席位 已用 {count}/3（超额仅提示，不拦截）',
  'member.namePlaceholder': '姓名 *',
  'member.rolePlaceholder': '角色（角色（如负责人））',
  'member.contactPlaceholder': '联系方式',
  'member.agentKindPlaceholder': 'agentKind（如 workbuddy / codex）',
  'member.add': '添加',
  'member.empty':
    '还没有成员。添加后可在阶段清单中指派任务，并在左侧导航最下方进入身份后查看「我的任务」。',
  'member.demoteTitle': '取消管理员',
  'member.demoteConfirm': '确认降级',
  'member.demoteBodyBefore': '将 ',
  'member.demoteBodyAfter': ' 降级为普通成员：该成员将立即失去管理员权限，只能看到分派给自己的内容。',
  'member.toastLastAdmin': '系统至少需要一名管理员，无法降级',
  'member.toastDemoted': '已取消管理员身份',
  'member.toastDemoteFailed': '降级失败，请重试。',
  'member.pwTitle': '设置密码',
  'member.pwChangeTitle': '修改「{name}」的密码',
  'member.pwSetTitle': '设置「{name}」的密码',
  'member.pwHintChange': '输入新密码可重置；不做任何输入并点「清除密码」则该成员无需密码即可进入。',
  'member.pwHintSet': '设置密码后，该成员需在「输入姓名」后凭密码登录。留空并点「清除密码」则无需密码。',
  'member.pwPlaceholder': '输入新密码（留空则不修改）',
  'member.pwClear': '清除密码',
  'member.pwSaveNew': '保存新密码',
  'member.toastPwEmpty': '请先输入新密码，或用「清除密码」移除。',
  'member.toastPwSet': '已设置「{name}」的登录密码',
  'member.toastPwCleared': '已清除该成员密码',
  'member.rowNamePlaceholder': '姓名',
  'member.hasPassword': '有密码',
  'member.noPassword': '无密码',
  'member.adminBadge': '管理员',
  'member.openBoardTitle': '查看该成员的看板',
  'member.promote': '设为管理员',
  'member.lastAdminTitle': '系统至少需要一名管理员',
  'member.demote': '取消管理员',
  'member.pwActionTitleChange': '修改/清除密码',
  'member.password': '密码',
  'member.rename': '重命名',
  'member.deactivateTitle': '停用成员',
  'member.reactivateTitle': '重新启用',
  'member.deactivate': '停用',
  'member.reactivate': '启用',
  /* ─────────────────── 时间轴工具栏（TimelineView）─────────────────── */
  'timeline.hint': '提示：拖动彩条边缘改期；←/→ 键平移时间轴（Shift 加速）',
  'timeline.zoom.month': '月',
  'timeline.zoom.halfMonth': '双周',
  'timeline.aria': '九阶段时间轴',

  /* ─────────────────── 月历工具行（MonthlyCalendarView）─────────────────── */
  'calendar.density.month': '月',
  'calendar.density.week': '周',
  'calendar.density.agenda': '日程',
  'calendar.prevMonth': '上个月',
  'calendar.nextMonth': '下个月',
  'calendar.today': '今天',
  'calendar.densityAria': '月历视图密度',
  'calendar.thisWeek': '本周（周一 ~ 周日）',
  'calendar.view': '查看',
  'calendar.lunarPlaceholder': '农历（占位）',

  /* ───────── Agent 术语表（agentTerm.* · 13 key × 2 模式 = 26 键 · #354）─────────
   * 取值是**搬家**：逐字来自原 `src/constants/agentTerms.ts` 的 `AGENT_TERMS`，一字未改
   * （搬迁自证：`tests/i18n-agent-terms.spec.tsx` 逐键比对）。键表与取词函数现在住
   * `src/i18n/labels.ts`（本仓「枚举 → 文案键 → 取词小函数」的屋子）。
   * 为什么不留在 `constants/agentTerms.ts`：那份文件在 `server/tsconfig.json` 的
   * include 白名单里，而该配置 `lib: ["ES2020"]`（**无 DOM**）—— 它一旦 import i18n，
   * 就把引用 `document.documentElement` 的 `src/i18n/lang.ts` 拖进服务端 program，
   * `npm run typecheck:server` 当场连红两条 TS2584（2026-08-27 实测）。
   * ⚠️ human = 人话（设计师/项目经理读者）、tech = 技术（Agent/工程师读者）。
   *    两列的取值**不保证在每种语言下都不同**；登记在案的重合见 `MODE_COLLAPSED_KEYS`。
   * ─────────────────────────────────────────────────────────────────────────── */
  'agentTerm.stage.human': '阶段',
  'agentTerm.stage.tech': '批次（Batch）',
  'agentTerm.stageShort.human': '阶段',
  'agentTerm.stageShort.tech': '批次',
  'agentTerm.applyPayload.human': '导入任务',
  'agentTerm.applyPayload.tech': 'Apply payload',
  'agentTerm.ready.human': '待办',
  'agentTerm.ready.tech': 'Ready',
  'agentTerm.handoff.human': '交接包',
  'agentTerm.handoff.tech': 'handoff bundle',
  'agentTerm.artifacts.human': '产出物',
  'agentTerm.artifacts.tech': 'artifacts（产出物）',
  'agentTerm.deps.human': '依赖',
  'agentTerm.deps.tech': 'deps（依赖）',
  'agentTerm.timeline.human': '时间轴',
  'agentTerm.timeline.tech': 'Timeline',
  'agentTerm.client.human': '委托方',
  'agentTerm.client.tech': '客户 / 委托方',
  'agentTerm.onsite.human': '现场',
  'agentTerm.onsite.tech': '现场',
  'agentTerm.board.human': 'Agent 看板',
  'agentTerm.board.tech': 'Agent Board',
  'agentTerm.claimedBy.human': '负责人',
  'agentTerm.claimedBy.tech': 'claimed by',
  'agentTerm.blockedBy.human': '被…阻塞',
  'agentTerm.blockedBy.tech': 'blocked by',

  /* ───────── 「接管」确认弹窗（TransferDialog · v0.8 英文线收口）─────────
   * ⚠️ 本组取值是**逐字搬迁**：就是改造前屏幕上渲染出来的那串（含 JSX 折行产生的空格）。
   *    两处**保留原样**的既有小瑕疵（不在本次修，另报）：
   *      · `warning` 里的 `**…**` 是明文显示的星号（那一段不是 Markdown 上下文）；
   *      · 几处 `，` 后有**一个多余空格**（来自源码折行折叠）—— 保留是为了让本笔
   *        对屏幕**零行为差异**（改文案措辞/空格属于另一类改动，不夹带在翻译里）。
   * ───────────────────────────────────────────────────────────────────────── */
  'agentTransfer.aria': '接管 Agent 看板',
  'agentTransfer.title': '接管「{name}」',
  'agentTransfer.cancelAria': '取消接管',
  'agentTransfer.warning':
    '接管会把这块看板里的数据**移入人类工作区**，此后它归「我的项目」一侧管理。 该操作仅管理员可用。',
  'agentTransfer.modeLegend': '接管方式',
  'agentTransfer.mode.convert.label': '转为正式项目',
  'agentTransfer.mode.convert.hint': '整块看板变成人类工作区里的一个项目（名称与阶段一并保留）。',
  'agentTransfer.mode.move.label': '搬运任务',
  'agentTransfer.mode.move.hint': '把选中的任务搬进一个已有的人类项目（需选落点阶段）。',
  'agentTransfer.target': '目标项目',
  'agentTransfer.targetHint': '（仅列人类工作区的项目）',
  'agentTransfer.noTarget': '人类工作区里还没有项目。请先建一个项目，或改选「转为正式项目」。',
  'agentTransfer.targetPlaceholder': '（请选择目标项目）',
  'agentTransfer.stage': '落点阶段',
  'agentTransfer.stageHint': '（不自动新建阶段）',
  'agentTransfer.pickTargetFirst': '请先选择目标项目。',
  'agentTransfer.noStage': '目标项目还没有阶段，请先在其详情页添加阶段后再搬运。',
  'agentTransfer.stagePlaceholder': '（请选择落点阶段）',
  'agentTransfer.tasks': '搬运任务',
  'agentTransfer.selectedCount': '已选 {selected} / {total}',
  'agentTransfer.noTask': '这块看板下还没有任务，没有可搬运的内容。',
  'agentTransfer.preview.convert':
    '预览：把看板「{board}」整体转为人类工作区的正式项目 （其中 {count} 条任务一并转入）。',
  /*
   * 搬运预览（未算完计划时的那一版）。`movePre` 末尾的空格与 `moveMid` 开头的空格
   * 不是手滑：JSX 相邻的表达式容器之间**不会**产生空白（本仓实测过的粘连缺陷），
   * 故段间空格一律落在取值里（中文侧尾随空格，见 zh.ts 文件头的规则 ⑤）。
   */
  'agentTransfer.preview.movePre': '预览：把选中的 ',
  'agentTransfer.preview.moveMid': ' 条任务从「{board}」搬入 ',
  'agentTransfer.preview.moveCreate': '，其中新建 ',
  'agentTransfer.preview.moveUpdate': ' 条、 更新既有 ',
  'agentTransfer.preview.moveTail': ' 条 （目标项目已有同外部编号的任务）。',
  'agentTransfer.noTargetSelected': '（未选择目标项目）',
  'agentTransfer.dropped.head':
    '将剔除 {count} 条悬空依赖（前驱未随本批搬走， 留着会让任务被误判为可开工）：',
  'agentTransfer.dropped.row': '· 「{task}」不再依赖「{dep}」',
  'agentTransfer.sourceSide':
    '源看板中另有 {dropped} 条依赖指向被搬走的任务， 将一并剥除（涉及 {rewired} 条留下的任务）。',
  'agentTransfer.pickAtLeastOne': '请至少勾选一条任务。',
  'agentTransfer.preview.plainPre': '预览：把选中的 ',
  'agentTransfer.preview.plainMid': ' 条任务 从「{board}」搬入 ',
  'agentTransfer.preview.plainTail':
    '。选好目标项目与落点阶段后，这里会列出将新建 / 将更新 / 将剔除的悬空依赖。',
  'agentTransfer.submitting': '处理中…',
  'agentTransfer.confirm': '确认接管',
  'agentTransfer.failed': '接管失败，请重试。',

  /* ───────── 插件沙箱宿主（PluginSandboxFrame · 全屏插件页的顶条与失败态）─────────
   * ⚠️ 失败文案**存键不存字**：宿主把 `{ key, vars }` 放进 state、渲染期才 `t()`。
   *    存当时译文会在切语言后不重译（本仓 `TransferDialog` 栽过的同款缺陷）。 */
  'plugin.frame.loadFailed': '插件加载失败：{error}',
  'plugin.frame.readyTimeout':
    '插件未能在 3 秒内就绪——入口文件未声明 window.IDPlanPlugin.mount，或产物加载失败',
  'plugin.frame.localInstall': '成员自装',
  'plugin.frame.backToApp': '回到主界面',

  /* ───────── agent-board 插件自己的设置（AgentSettingsPanel · 设置 ▸ 插件 ▸ 齿轮）─────────
   * 三块的**小标题**早已走 `settings.section.*`（搬位置时给的）；这里是搬进来之后
   * 一直没接的**正文**。取值逐字取自搬迁前的源码（搬位置那笔承诺过「文案逐字一致」）。 */
  'agentSettings.seatRowLabel': 'Agent 席位',
  'agentSettings.seatUsed': '已用 {used}/{limit}',
  'agentSettings.seatOver': '已超出免费席位额度（{limit} 个）——不影响使用，仅作提示。',
  'agentSettings.dbUsageLabel': '本地库占用',
  'agentSettings.dbUsageEstimated': '（估算）',
  'agentSettings.dbUsageHint': '未来单库超过约 50MB 时会在此提示清理 / 分库建议。',
  'agentSettings.ingress.lead': '外部 Agent 通过本机回环地址以',
  'agentSettings.ingress.strong': '结构化命令',
  /* 取值里那一个空格不是手滑：原文是**同一个 JSXText 内的换行**，JSX 把它折成一个空格，
   * 故换成单个键之后必须由取值自己带着（同 `agentTransfer.dropped.head` 的做法）。 */
  'agentSettings.ingress.tail':
    '接入 ID Plan；自然语言由 Agent 侧自己解析——ID Plan 不解析自然语言、不调用大模型。 接入地址与访问令牌在 Agent 看板的接入面板里生成与管理，此处不重复。',
  'agentSettings.boardHint': 'Agent 看板是 AI 工作区：执行记录、接入面板与任务队列都在那里。',
  'agentSettings.openBoard': '打开 Agent 看板',

  /* ═════════ 设置抽屉 · 四个分区正文（SettingsDialog · 英文线 0009 · 笔 1-②）═════════
   * 分区**小标题**早已走 `settings.section.*`；这一批是各区的正文 —— 它们此前
   * 一条都没进文案表，即「设置屏只有标题是英文、正文整块中文」的实际来源。 */
  /* ── 排程区 · 排期口径说明 ── */
  'settings.schedule.basisPre': '排期基准（自然日 / 工作日）是',
  'settings.schedule.basisStrong': '项目级',
  /* 取值里那个空格 = 原文同一 JSXText 内的换行（JSX 折成一个空格），下同 */
  'settings.schedule.basisTail':
    '设置：新建项目时在阶段选择里指定，之后随该项目保存，本页没有全局默认项。 月历以周一为一周起始，当前不可切换。',

  /* ── 数据与备份区 · 数据存在哪 ── */
  'settings.data.wherePre': '你的数据存放在',
  'settings.data.whereNas': '你的 NAS',
  'settings.data.whereLocal': '本机',
  'settings.data.addressLead': '（服务地址：',
  'settings.data.notConfigured': '（未配置）',
  'settings.data.whereTail': '）。备份是 JSON 文件，保存在你自己选的位置。',
  'settings.data.localTail':
    '（这台电脑的应用数据里，不上传）。备份是 JSON 文件，保存在你自己选的位置。',

  /* ── 数据与备份区 · 备份两枚按钮 ──
   * ⚠️ 与 `sidebar.saveBackup` **同值不同面**（侧栏底部那枚是同一份 useBackupIo 的
   * 另一个入口）。不复用的理由：键名是位置契约，设置屏读 `sidebar.*` 会误导下一个人；
   * 而两者将来分头改文案是正常需求。`导入备份` 与侧栏的 `加载备份` 本来就不同词。 */
  'settings.data.saveBackup': '保存备份',
  'settings.data.loadBackup': '导入备份',
  'settings.data.backupHint':
    '保存备份 = 导出全部数据为 JSON 文件；导入备份 = 从 JSON 文件 整体替换当前全部数据（不可撤销，恢复前建议先留档）。',

  /* ── 数据与备份区 · 前端日志 ── */
  'settings.log.count': '{count} 条',
  'settings.log.emptyLead': '暂无日志。日志默认在',
  'settings.log.emptyOnError': '报错时',
  'settings.log.emptyOr': '或',
  'settings.log.emptyKeyOps': '执行关键操作',
  'settings.log.emptyTail':
    '（身份切换、备份导入导出）时 才记录。正常浏览页面不会有日志，属正常现象。遇到"输入法打不出字"这类问题时， 请先复现一次再回来导出。',
  'settings.log.recordedPre': '已记录 ',
  'settings.log.recordedTail':
    ' 条运行事件，可导出为 .log 文件发给开发。日志仅含运行记录与错误堆栈，不含项目/客户业务数据。',
  'settings.log.export': '导出日志',
  'settings.log.clear': '清空日志',
  'settings.log.clearConfirm': '清空',
  'settings.log.clearPre': '将清空当前 ',
  'settings.log.clearTail': ' 条前端日志。此操作不可恢复，如需排查问题建议先导出。',
  'settings.log.toastExported': '日志已导出（{count} 条）',
  'settings.log.toastCleared': '日志已清空',

  /* ── 数据与备份区 · 检查更新（仅 Windows 桌面端渲染）── */
  'settings.update.checking': '检查中…',
  'settings.update.check': '检查更新',
  'settings.update.upToDate': '已是最新版本（{version}）。',
  'settings.update.hasUpdate': '发现新版本 {version}',
  'settings.update.download': '前往下载',
  'settings.update.failed': '检查失败：{error}',

  /* ── 关于区 ── */
  'settings.about.version': '版本号',
  'settings.about.license': '开源许可',
  'settings.about.betaNote': '内测版本，功能与数据格式仍可能调整。',
  'settings.about.frontend': '前端',
  'settings.about.packaging': '打包',
  'settings.about.issueLead': '如有 bug 请提交 GitHub Issue：',

  /* ── 关于区 · 赞赏与反馈（两张微信卡）── */
  'settings.support.wechatTitle': '赞赏支持',
  'settings.support.wechatCaption': '这工具省了你的时间的话，可以请我喝杯咖啡。',
  'settings.support.feedbackTitle': '反馈建议',
  'settings.support.feedbackCaption': '用得别扭、想要什么功能，扫码直接跟我说。',
} as const;

/**
 * 文案键全集（由中文表推导）。
 * `en.ts` 声明为 `Record<MessageKey, string>` ⇒ 缺键 / 多键都是编译错。
 */
export type MessageKey = keyof typeof zhMessages;
