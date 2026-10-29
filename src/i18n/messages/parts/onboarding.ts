/**
 * 消息表分片 · `onboarding`（新手引导竖切样板 · 第一批）
 *
 * 注册协议与其余分片一致（见 `parts/misc.ts` 文件头）：
 *   ① 键只写在本文件（zh / en 两列同给）；② 调用点只在 `src/components/onboarding/**`
 *   与设置 → 关于 的重看入口；③ `as const`，不加宽类型注解。
 *
 * 文案口径（设计稿 onboarding-design-2026-10-30.md 拍板原文）：
 *   · 示例一律用代号，不出现真实人名/公司名（本分片没有示例名）；
 *   · 语气克制、口语但不油：中文避免「亲」「哦」式腔调，英文避免机翻腔。
 */

/** onboarding 分片 · 中文（设计稿 §三/§四/§五 的拍板原文逐字落键） */
export const zh = {
  /* ══════════ 第一屏（选模式）══════════ */
  'onboarding.welcome.title': '欢迎使用 ID Plan',
  'onboarding.welcome.tagline': '离线优先的项目排程工具，为设计工作室而生。',
  'onboarding.welcome.tagline2': '先选一种方式认识它——之后随时可以在设置里重新查看。',
  'onboarding.mode.quick.title': '快速了解',
  'onboarding.mode.quick.eta': '约 30 秒',
  'onboarding.mode.quick.desc': '一屏看完核心功能，适合想马上上手的人。',
  'onboarding.mode.steps.title': '分步引导',
  'onboarding.mode.steps.eta': '约 3 分钟',
  'onboarding.mode.steps.desc': '一步一步带你认识每个功能板块，边看边可以试。',
  'onboarding.welcome.foot': '随时可以跳过 · 设置 → 关于 → 重新查看新手引导',
  'onboarding.welcome.artBadge': '概览',

  /* ══════════ 简单介绍线（单屏 6 卡）══════════ */
  'onboarding.quick.heading': '快速了解',
  'onboarding.quick.lead': 'ID Plan 的六个核心板块，一屏看完。',
  'onboarding.feature.board.title': '看板',
  'onboarding.feature.board.desc': '项目按阶段排队，拖一拖就更新进度。',
  'onboarding.feature.calendar.title': '月历',
  'onboarding.feature.calendar.desc': '中国法定节假日自动标注，排期一眼可见。',
  'onboarding.feature.print.title': '打印',
  'onboarding.feature.print.desc': '5 套模板 × 自选内容，A4 直接出图。',
  'onboarding.feature.members.title': '成员与身份',
  'onboarding.feature.members.desc': '管理员/成员分权，进入工作区需密码。',
  'onboarding.feature.backup.title': '备份',
  'onboarding.feature.backup.desc': '数据全在本机，一键导出 JSON。',
  'onboarding.feature.agent.title': 'Agent 通道',
  'onboarding.feature.agent.desc': '用一句话自然语言建档排期。',
  'onboarding.quick.start': '开始使用',
  'onboarding.quick.switch': '改看详细引导',

  /* ══════════ 分步引导线（壳 + 步骤）══════════ */
  'onboarding.steps.heading': '分步引导',
  'onboarding.steps.progress': '第 {current} 步，共 {total} 步',
  'onboarding.steps.prev': '上一步',
  'onboarding.steps.next': '下一步',
  'onboarding.steps.skip': '跳过引导',
  'onboarding.step.board.title': '看板',
  'onboarding.step.board.lead':
    '项目按阶段排成几列，拖动卡片就能更新进度——这是你以后最常待的界面。',
  'onboarding.step.board.h1': '四列看板，阶段进度条一眼可读。',
  'onboarding.step.board.h2': '拖拽卡片即可换阶段，窄窗自动换行。',
  'onboarding.step.board.h3': '每个项目一种颜色，成员头像直接标在卡上。',
  'onboarding.step.calendar.title': '月历',
  'onboarding.step.timeline.title': '甘特 / 时间轴',
  'onboarding.step.print.title': '打印',
  'onboarding.step.members.title': '成员与身份',
  'onboarding.step.backup.title': '数据与备份',
  'onboarding.step.agent.title': 'Agent 通道与行业库',
  'onboarding.step.plugins.title': '插件',
  'onboarding.step.placeholder.lead': '这一步的介绍正在准备中。',
  'onboarding.step.placeholder.tail': '可以先跳过引导，或直接开始使用。',

  /* ══════════ 完成页 ══════════ */
  'onboarding.finish.title': '你已了解 ID Plan 的核心功能',
  'onboarding.finish.lead': '随时可以从「设置 → 关于」重新查看这份引导。',
  'onboarding.finish.newProject': '新建第一个项目',
  'onboarding.finish.lookAround': '先随便看看',

  /* ══════════ 设置 → 关于：重看入口 ══════════ */
  'settings.onboarding.replay': '重新查看新手引导',
  'settings.onboarding.replayDesc': '随时回看两种新手引导，不会改动任何数据。',
} as const;

/** onboarding 分片 · 英文（与 zh 逐键成对；语气向原生英文靠，不做逐字直译） */
export const en = {
  'onboarding.welcome.title': 'Welcome to ID Plan',
  'onboarding.welcome.tagline': 'Offline-first project scheduling, built for design studios.',
  'onboarding.welcome.tagline2':
    'Pick a way to look around — you can always revisit it later in Settings.',
  'onboarding.mode.quick.title': 'Quick tour',
  'onboarding.mode.quick.eta': '~30 seconds',
  'onboarding.mode.quick.desc': 'The core features on one screen, for getting started right away.',
  'onboarding.mode.steps.title': 'Step-by-step guide',
  'onboarding.mode.steps.eta': '~3 minutes',
  'onboarding.mode.steps.desc': 'Walk through each feature area one step at a time, and try as you go.',
  'onboarding.welcome.foot': 'Skip anytime · Settings → About → Replay the introduction',
  'onboarding.welcome.artBadge': 'Overview',

  'onboarding.quick.heading': 'Quick tour',
  'onboarding.quick.lead': 'Six core areas of ID Plan, on one screen.',
  'onboarding.feature.board.title': 'Board',
  'onboarding.feature.board.desc': 'Projects queue up by stage — drag a card to update progress.',
  'onboarding.feature.calendar.title': 'Calendar',
  'onboarding.feature.calendar.desc': 'Chinese public holidays marked automatically, schedules at a glance.',
  'onboarding.feature.print.title': 'Print',
  'onboarding.feature.print.desc': '5 templates with selectable content, straight to A4.',
  'onboarding.feature.members.title': 'Members & roles',
  'onboarding.feature.members.desc': 'Admin and member roles; entering a workspace needs a password.',
  'onboarding.feature.backup.title': 'Backup',
  'onboarding.feature.backup.desc': 'Your data stays on this machine — export JSON in one click.',
  'onboarding.feature.agent.title': 'Agent channel',
  'onboarding.feature.agent.desc': 'Create projects and schedules with a plain sentence.',
  'onboarding.quick.start': 'Get started',
  'onboarding.quick.switch': 'See the step-by-step guide',

  'onboarding.steps.heading': 'Step-by-step guide',
  'onboarding.steps.progress': 'Step {current} of {total}',
  'onboarding.steps.prev': 'Back',
  'onboarding.steps.next': 'Next',
  'onboarding.steps.skip': 'Skip',
  'onboarding.step.board.title': 'Board',
  'onboarding.step.board.lead':
    'Projects line up as columns by stage — drag a card to move it along. This is where you will spend most of your time.',
  'onboarding.step.board.h1': 'Four board columns with stage progress at a glance.',
  'onboarding.step.board.h2': 'Drag cards between stages; columns reflow on narrow windows.',
  'onboarding.step.board.h3': 'One color per project, with assignees shown right on the card.',
  'onboarding.step.calendar.title': 'Calendar',
  'onboarding.step.timeline.title': 'Timeline',
  'onboarding.step.print.title': 'Print',
  'onboarding.step.members.title': 'Members & roles',
  'onboarding.step.backup.title': 'Data & backup',
  'onboarding.step.agent.title': 'Agent & industry library',
  'onboarding.step.plugins.title': 'Plugins',
  'onboarding.step.placeholder.lead': 'This step is still being prepared.',
  'onboarding.step.placeholder.tail': 'You can skip the guide, or just start using ID Plan.',

  'onboarding.finish.title': 'You now know the core of ID Plan',
  'onboarding.finish.lead': 'You can replay this guide anytime from Settings → About.',
  'onboarding.finish.newProject': 'Create your first project',
  'onboarding.finish.lookAround': 'Just look around',

  'settings.onboarding.replay': 'Replay the introduction',
  'settings.onboarding.replayDesc': 'Replay either introduction anytime. Nothing is written to your data.',
} as const;
