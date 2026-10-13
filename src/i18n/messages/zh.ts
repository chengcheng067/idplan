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
  'nav.mainAria': '主导航',
  'nav.projects': '项目',
  'nav.board': '看板',
  'nav.myTasks': '我的任务',
  'nav.agent': 'Agent',
  'nav.agentAreaAria': 'Agent 工作区',
  'nav.agentWorkspace': '工作区',
  'nav.agentExecutions': '执行记录',
  'nav.pluginBadge': '插件',

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
} as const;

/**
 * 文案键全集（由中文表推导）。
 * `en.ts` 声明为 `Record<MessageKey, string>` ⇒ 缺键 / 多键都是编译错。
 */
export type MessageKey = keyof typeof zhMessages;
