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
  'ingress.explain.readFile': '读这个文件即完成接入',
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
} as const;

/**
 * 文案键全集（由中文表推导）。
 * `en.ts` 声明为 `Record<MessageKey, string>` ⇒ 缺键 / 多键都是编译错。
 */
export type MessageKey = keyof typeof zhMessages;
