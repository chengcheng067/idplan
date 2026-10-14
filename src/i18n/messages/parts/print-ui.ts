/**
 * 消息表分片 · `print-ui`（英文补齐批的并行写入口）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 注册协议（**每个分片 worker 只做两件事**）
 * ══════════════════════════════════════════════════════════════════════
 *   ① 只改**本文件**（在下面的 `zh` / `en` 里加键）+ **你自己目录下的调用点**
 *      （把硬编码中文换成 `t('键')`）；
 *   ② **绝不**碰 `zh.ts` / `en.ts` / `index.ts` / 别人的分片文件 ——
 *      撞公共文件就等于把「4 个人能同时写」这件事作废。
 *
 * 本分片负责：`src/components/print/**` + `src/print/**` 的**屏幕侧** + `src/pages/**`
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

/**
 * print-ui 分片 · 中文（新键写在这里；取值必须与改动前源码逐字一致）
 *
 * ★ 本批只翻**屏幕侧**：打印预览对话框 / 模板与模块选择器 / 配色选择器 /
 *   打印页的屏幕外壳。**纸面**（`src/print/documents/**`、`src/print/pages/**`、
 *   `src/print/adapters/**`、纸面构件、两个打印页的纸面正文）**恒中文，不在此列**
 *   —— 判据见 `src/pages/CalendarPrintPage.tsx` 的 `buildMonthMeta(m, 'zh', …)`
 *   与 `src/i18n/date.ts` 文件头。
 */
export const zh = {
  // ─────────────────────── 模板 / 外表（print-templates.ts） ───────────────────────
  'print.template.classic.label': '经典',
  'print.template.classic.scene': '现有排程纸面：甘特摘要 + 阶段清单，五块可摘',
  'print.template.swissSchedule.label': 'Swiss Schedule',
  'print.template.swissSchedule.scene': '时刻表式竖读扫描：阶段 / 任务 / 延期 / 成员',
  'print.template.dataEditorial.label': 'Data Editorial',
  'print.template.dataEditorial.scene': '横读矩阵与数据图形：进度 / 依赖 / 工作量 / 验收',
  'print.template.editorialIndex.label': 'Editorial Index',
  'print.template.editorialIndex.scene': '跳读大编号索引：阶段 / 成员 / 产出物归档',
  'print.template.agentPoster.label': 'Agent Poster',
  'print.template.agentPoster.scene': '海报式跳读：阶段 / 任务 / 成员的公告板',
  /** 经典无真缩略图 ⇒ 卡片占位用版本字母（中文侧是「经」） */
  'print.template.classicGlyph': '经',
  'print.template.thumbAlt': '{name} 第 1 页预览',

  // ─────────────────────── 11 个内容模块（选择器中截；今只在能力表留存） ───────────────────────
  'print.module.stageList.label': '阶段清单',
  'print.module.stageList.hint': 'Stage 四态 / 日期 / 占比 / 负责人',
  'print.module.taskList.label': '任务清单',
  'print.module.taskList.hint': 'taskNo / 七态 / 负责人 / 产出物数',
  'print.module.delayLedger.label': '延期台账',
  'print.module.delayLedger.hint': 'StageLog 改期 · 旧 / 新结束日 / 原因',
  'print.module.memberRoster.label': '成员名册',
  'print.module.memberRoster.hint': '角色 · 负责任务数',
  'print.module.progressMatrix.label': '进度矩阵',
  'print.module.progressMatrix.hint': '阶段内任务完成度 / 日期 / 占比',
  'print.module.dependencyNetwork.label': '依赖网络',
  'print.module.dependencyNetwork.hint': 'dependsOn 有向图 · 环与缺失引用',
  'print.module.workloadComposition.label': '工作量构成',
  'print.module.workloadComposition.hint': 'ratioPercent 堆叠条 · 分期汇总',
  'print.module.milestoneAcceptance.label': '里程碑验收',
  'print.module.milestoneAcceptance.hint': 'M1 / M2 / M3 · 验收清单与签署',
  'print.module.artifactList.label': '产出物清单',
  'print.module.artifactList.hint': '种类 / 关联任务 / 来源',
  'print.module.agentExecution.label': 'Agent 执行',
  'print.module.agentExecution.hint': '10 态四组流程 · runId / confidence',
  'print.module.writebackProposals.label': '写回提案',
  'print.module.writebackProposals.hint': '五态 · 四项白名单 · confidence',

  // ─────────────────────── 原生页名（选择器右侧的渲染方式提示；同名 kind 逐套取名） ───────────────────────
  'print.page.swiss.stageOverview': '阶段总览',
  'print.page.swiss.taskRegister': '任务读号表',
  'print.page.swiss.delayLedger': '延期记录表',
  'print.page.swiss.memberRoster': '成员责任表',
  'print.page.data.progressMatrix': '阶段进度矩阵',
  'print.page.data.dependencyNetwork': '任务依赖网络',
  'print.page.data.workloadComposition': '阶段工作量构成',
  'print.page.data.milestoneAcceptance': '里程碑与验收',
  'print.page.editorial.stageIndex': '阶段目录',
  'print.page.editorial.memberIndex': '成员执行体目录',
  'print.page.poster.stageOverview': '阶段海报',
  'print.page.poster.taskRegister': '任务海报',
  'print.page.poster.memberRoster': '成员海报',

  // ─────────────────────── 五块打印内容（print-units.ts · PRINT_BLOCKS） ───────────────────────
  'print.unit.header.label': '打印头部',
  'print.unit.header.hint': '项目名 / 周期',
  'print.unit.timeline.label': '打印时间轴',
  'print.unit.timeline.hint': '甘特图',
  'print.unit.projectInfo.label': '项目信息',
  'print.unit.projectInfo.hint': '排期基准',
  'print.unit.stageTable.hint': '表格',
  'print.unit.footer.label': '页脚',
  'print.unit.footer.hint': '署名 / 页码',

  // ─────────────────────── 版性装置声明（print-units.ts · deviceSpec） ───────────────────────
  'print.unit.swissTopbar.label': '黑顶栏',
  'print.unit.swissTopbar.hint': 'logo / 栏目 / 页题 / 品牌·页序（版式构件）',
  'print.unit.swissPercent.label': '板头巨字完成度',
  'print.unit.swissPercent.hint': '右对齐版面锚点（版式构件）',
  'print.unit.swissBottombar.label': '黑底栏',
  'print.unit.swissBottombar.hint': '署名 / 页码 / 数据时间（版式构件）',
  'print.unit.deHead.label': '刊头装置',
  'print.unit.deHead.hint': 'mono 顶行 / 巨字标题 / 橙副标 / 3px 硬边线',
  'print.unit.deBand.label': '页尾完成度横带',
  'print.unit.deBand.hint': '每页的聚合横带（版式构件）',
  'print.unit.eiGiantTitle.label': '两行巨题',
  'print.unit.eiGiantTitle.hint': '衬线巨题（目录身份装置）',
  'print.unit.eiSheetTag.label': 'SHEET 页签',
  'print.unit.eiSheetTag.hint': 'SHEET nn / NN · A4（刊头身份；与页脚页码并存）',
  'print.unit.apFloodTop.label': '页顶出血巨字',
  'print.unit.apFloodTop.hint': '品牌词 + 叠字主题词（页锚点）',
  'print.unit.apFloodBottom.label': '页底出血巨字',
  'print.unit.apFloodBottom.hint': 'IDPLAN（B5 的署名由它承担，不许摘）',
  'print.unit.apSpine.label': '中轴与栏头线',
  'print.unit.apSpine.hint': '双栏语法本体',
  'print.unit.apSum.label': '居中摘要块',
  'print.unit.apSum.hint': '装置本体；B2 借它的第 4 个载荷',

  // ─────────────────────── 配色选择器（print-palette.ts + PaletteSection.tsx） ───────────────────────
  'print.palette.slot.accent': '身份色',
  'print.palette.slot.ink': '主文字',
  'print.palette.slot.line': '线色',
  'print.palette.section.title': '配色（三枚受控 token）',
  'print.palette.section.preset': '预设 · {name}',
  'print.palette.section.custom': '自定义',
  'print.palette.section.baseline': '设计师基线',
  'print.palette.presetGroup': '配色预设',
  'print.palette.presetTitle': '{name}（三枚打包，已过灰度验收）',
  'print.palette.toggle.expand': '收起自定义',
  'print.palette.reset': '恢复基线',
  'print.palette.pair.ratio': '{ratio} / 需 ≥{min}:1',
  'print.palette.save': '保存自定义',
  'print.palette.saveHint': '达标后才可保存',
  'print.palette.gate.blocked': '对比度不足，已禁止保存：',
  'print.palette.gate.need': '（需 ≥{min}:1）',
  'print.palette.gate.join': '；',
  // 预设色号名（产品负责人 2026-10-14 拍板：色号名也翻）
  'print.palette.swiss.trafficYellow': '交通黄',
  'print.palette.swiss.platformBlue': '站台蓝',
  'print.palette.swiss.ochre': '赭石',
  'print.palette.swiss.pine': '松墨',
  'print.palette.data.signalOrange': '橙红',
  'print.palette.data.indigo': '靛蓝',
  'print.palette.data.pineGreen': '墨绿',
  'print.palette.data.sienna': '赭石',
  'print.palette.editorial.vermilion': '赭红',
  'print.palette.editorial.indigo': '靛蓝',
  'print.palette.editorial.pineGreen': '墨绿',
  'print.palette.editorial.sienna': '赭石',
  'print.palette.poster.signalOrange': '橙',
  'print.palette.poster.vermilion': '朱红',
  'print.palette.poster.indigo': '靛蓝',
  'print.palette.poster.pineGreen': '墨绿',
  // 对比度配对名（禁存提示里指名用）
  'print.palette.pair.inkPaper': '主文字 vs 纸面',
  'print.palette.pair.linePaper': '线色 vs 纸面',
  'print.palette.pair.accentLine': '栏内反白字 vs 栏底',
  'print.palette.pair.inkPage': '主文字 vs 纸底',
  'print.palette.pair.accentPage': '身份色 vs 纸底',
  'print.palette.pair.linePage': '线色 vs 纸底',
  'print.palette.pair.focusPage': '焦点色 vs 纸底',
  'print.palette.pair.hairlinePage': '发丝线 vs 纸底',
  'print.palette.pair.statusPage': '状态色 vs 纸底',
  'print.palette.pair.dividerPage': '分隔线 vs 纸底',

  // ─────────────────────── 模板与模块选择器（PrintPreviewDialog.tsx） ───────────────────────
  'print.selector.title': '模板与模块',
  'print.selector.close': '关闭模板与模块',
  'print.selector.readMode': '阅读方式',
  'print.selector.blocksTitle': '打印内容（五块）',
  'print.selector.blocksNote':
    '模板自身的版式构件（刊头 / 页脚线 / 页序 / 摘要块）不在此列；可摘项随版式而定。',
  'print.selector.paletteBuilding':
    '配色：{name} 页面建设中，三槽位与预设已就绪，页面落地后生效。',
  'print.selector.status': '当前 {count} {unit} · 预计 {pages} 页',
  'print.selector.status.blocks': '块',
  'print.selector.status.modules': '个模块',
  'print.selector.effectNote': '勾选与配色即时生效、无需确认；Esc / 点遮罩 / ✕ 均为纯关闭',
  'print.selector.outputs': '输出模块',
  'print.selector.selectAll': '全选',
  'print.selector.selectNone': '反选',
  'print.selector.generic': '通用渲染',
  'print.selector.unavailable': '该外表下暂不可用',
  'print.selector.modulesNote':
    '阶段清单 / 任务清单 / 成员名册在无原生页的外表下走通用渲染；暂不可用的模块将随通用渲染陆续支持。模块勾选按外表各存一套，换外表不丢失。',

  // ─────────────────────── 不可摘块的原因（§2.6 纪律 1） ───────────────────────
  'print.forced.header': '由该模板的刊头承载项目名与页序，属版式构件',
  'print.forced.footer':
    '在本模板由版式构件承担（署名 = 页底巨字、页码 = 页眉页序），脚注是治理披露，都不随勾选变化',
  'print.forced.fallback': '属该模板的版式构件',
  'print.forced.note': '「{label}」{reason} —— 该模板当前不可摘。',

  // ─────────────────────── 打印预览工具条 / 动作条 ───────────────────────
  'print.preview.title': '打印预览',
  'print.preview.close': '关闭打印预览',
  'print.preview.head': '{name} · 预计 {pages} 页 · A4',
  'print.zoom.group': '预览缩放',
  'print.zoom.fit': '适应',
  'print.zoom.slider': '预览缩放滑块',
  'print.grayscale.aria': '灰度预览',
  'print.grayscale.label': '灰度',
  'print.building.title': '{name} · 页面建设中',
  'print.building.body':
    '模板已注册（{count} 个原生模块；模块勾选与配色槽位已就绪）， 页面将在后续批次实现。当前不会输出任何纸面，打印与导出已禁用。',
  'print.action.needPdf': '需要 PDF？在打印对话框选「另存为 PDF」',
  'print.action.notPrintable': '该模板页面建设中，暂不可打印',
  'print.action.print': '打印',
  'print.action.exportPng': '导出 PNG',
  'print.action.exportPngCount': '导出 PNG（{count} 张）',
  'print.action.busy': '生成中…',
  'print.action.pngFailed': 'PNG 导出失败，请改用「打印 / 另存为 PDF」。',
  'print.action.printedMain': '已回退主窗口打印。',

  // ─────────────────────── 三个打印页的屏幕外壳（*PrintPage.tsx 的 no-print 区与空态） ───────────────────────
  'print.page.loading.schedule': '正在装载日程表…',
  'print.page.loading.calendar': '正在装载月历…',
  'print.page.loading.itinerary': '正在装载行程单…',
  'print.page.notFound': '未找到该项目。',
  'print.page.backToList': '← 返回项目列表',
  'print.page.backToMyTasks': '← 返回我的任务',
  'print.page.backToProject': '返回项目',
  'print.page.backToProjectDetail': '← 返回项目详情',
  'print.page.notRelated': '该项目的阶段与你无关。',
  'print.page.notTravel': '「{name}」不是旅游项目，没有客户行程单。',
  'print.page.estimatedPages': '预计 {pages} 页 · A4',
  'print.page.totalPages': '共 {pages} 页 · A4',
  'print.page.exportPdf': '导出 PDF',
  'print.page.printPdf': '打印 / 导出 PDF',
  'print.page.calendarView': '月历视图',
  'print.page.pdfDialogHint': '已在打印对话框打开：请选择「另存为 PDF」即可导出。',
} as const;

/** print-ui 分片 · 英文（每个 zh 键都必须有对应英文，漏一个 = 编译错） */
export const en = {
  'print.template.classic.label': 'Classic',
  'print.template.classic.scene':
    'The existing schedule paper: Gantt summary + stage list, five removable blocks',
  'print.template.swissSchedule.label': 'Swiss Schedule',
  'print.template.swissSchedule.scene':
    'Timetable-style vertical scan: stages / tasks / delays / members',
  'print.template.dataEditorial.label': 'Data Editorial',
  'print.template.dataEditorial.scene':
    'Horizontal matrices and data graphics: progress / dependencies / workload / acceptance',
  'print.template.editorialIndex.label': 'Editorial Index',
  'print.template.editorialIndex.scene':
    'Skim-friendly large-number index: stages / members / artifacts',
  'print.template.agentPoster.label': 'Agent Poster',
  'print.template.agentPoster.scene': 'Poster-style skim: a notice board of stages / tasks / members',
  'print.template.classicGlyph': 'C',
  'print.template.thumbAlt': '{name} first page preview',

  'print.module.stageList.label': 'Stage list',
  'print.module.stageList.hint': 'Stage status / dates / share / owner',
  'print.module.taskList.label': 'Task list',
  'print.module.taskList.hint': 'taskNo / status / owner / artifact count',
  'print.module.delayLedger.label': 'Delay ledger',
  'print.module.delayLedger.hint': 'StageLog reschedules · old / new end date / reason',
  'print.module.memberRoster.label': 'Member roster',
  'print.module.memberRoster.hint': 'Role · assigned task count',
  'print.module.progressMatrix.label': 'Progress matrix',
  'print.module.progressMatrix.hint': 'Per-stage task completion / dates / share',
  'print.module.dependencyNetwork.label': 'Dependency network',
  'print.module.dependencyNetwork.hint': 'dependsOn digraph · cycles and missing refs',
  'print.module.workloadComposition.label': 'Workload composition',
  'print.module.workloadComposition.hint': 'ratioPercent stacked bars · per-phase totals',
  'print.module.milestoneAcceptance.label': 'Milestones & acceptance',
  'print.module.milestoneAcceptance.hint': 'M1 / M2 / M3 · acceptance checklist and sign-off',
  'print.module.artifactList.label': 'Artifact list',
  'print.module.artifactList.hint': 'Kind / linked tasks / source',
  'print.module.agentExecution.label': 'Agent execution',
  'print.module.agentExecution.hint': 'Four groups of states · runId / confidence',
  'print.module.writebackProposals.label': 'Write-back proposals',
  'print.module.writebackProposals.hint': 'Five states · four-field allowlist · confidence',

  'print.page.swiss.stageOverview': 'Stage overview',
  'print.page.swiss.taskRegister': 'Task register',
  'print.page.swiss.delayLedger': 'Delay record',
  'print.page.swiss.memberRoster': 'Member responsibility',
  'print.page.data.progressMatrix': 'Stage progress matrix',
  'print.page.data.dependencyNetwork': 'Task dependency network',
  'print.page.data.workloadComposition': 'Stage workload composition',
  'print.page.data.milestoneAcceptance': 'Milestones & acceptance',
  'print.page.editorial.stageIndex': 'Stage index',
  'print.page.editorial.memberIndex': 'Member index',
  'print.page.poster.stageOverview': 'Stage poster',
  'print.page.poster.taskRegister': 'Task poster',
  'print.page.poster.memberRoster': 'Member poster',

  'print.unit.header.label': 'Print header',
  'print.unit.header.hint': 'Project name / period',
  'print.unit.timeline.label': 'Print timeline',
  'print.unit.timeline.hint': 'Gantt chart',
  'print.unit.projectInfo.label': 'Project info',
  'print.unit.projectInfo.hint': 'Schedule basis',
  'print.unit.stageTable.hint': 'Table',
  'print.unit.footer.label': 'Footer',
  'print.unit.footer.hint': 'Credit / page number',

  'print.unit.swissTopbar.label': 'Black top bar',
  'print.unit.swissTopbar.hint': 'logo / sections / page title / brand·page (layout device)',
  'print.unit.swissPercent.label': 'Board-head percentage',
  'print.unit.swissPercent.hint': 'Right-aligned layout anchor (layout device)',
  'print.unit.swissBottombar.label': 'Black bottom bar',
  'print.unit.swissBottombar.hint': 'Credit / page number / data time (layout device)',
  'print.unit.deHead.label': 'Masthead device',
  'print.unit.deHead.hint': 'mono top line / giant title / orange subtitle / 3px hard rule',
  'print.unit.deBand.label': 'Footer completion band',
  'print.unit.deBand.hint': 'Aggregate band on every page (layout device)',
  'print.unit.eiGiantTitle.label': 'Two-line giant title',
  'print.unit.eiGiantTitle.hint': 'Serif giant title (index identity device)',
  'print.unit.eiSheetTag.label': 'SHEET tab',
  'print.unit.eiSheetTag.hint': 'SHEET nn / NN · A4 (masthead identity; coexists with the footer page number)',
  'print.unit.apFloodTop.label': 'Top bleed giant type',
  'print.unit.apFloodTop.hint': 'Brand word + stacked theme word (page anchor)',
  'print.unit.apFloodBottom.label': 'Bottom bleed giant type',
  'print.unit.apFloodBottom.hint': 'IDPLAN (carries the B5 credit; not removable)',
  'print.unit.apSpine.label': 'Center axis & column rules',
  'print.unit.apSpine.hint': 'The two-column grammar itself',
  'print.unit.apSum.label': 'Centered summary block',
  'print.unit.apSum.hint': 'The device itself; B2 borrows its fourth payload',

  'print.palette.slot.accent': 'Accent',
  'print.palette.slot.ink': 'Body text',
  'print.palette.slot.line': 'Line',
  'print.palette.section.title': 'Palette (three controlled tokens)',
  'print.palette.section.preset': 'Preset · {name}',
  'print.palette.section.custom': 'Custom',
  'print.palette.section.baseline': 'Designer baseline',
  'print.palette.presetGroup': 'Palette presets',
  'print.palette.presetTitle': '{name} (three tokens as a set, grayscale-verified)',
  'print.palette.toggle.expand': 'Collapse custom',
  'print.palette.reset': 'Reset to baseline',
  'print.palette.pair.ratio': '{ratio} / needs ≥{min}:1',
  'print.palette.save': 'Save custom',
  'print.palette.saveHint': 'Savable once it passes',
  'print.palette.gate.blocked': 'Contrast too low, saving blocked: ',
  'print.palette.gate.need': ' (needs ≥{min}:1)',
  'print.palette.gate.join': '; ',
  'print.palette.swiss.trafficYellow': 'Traffic yellow',
  'print.palette.swiss.platformBlue': 'Platform blue',
  'print.palette.swiss.ochre': 'Ochre',
  'print.palette.swiss.pine': 'Pine ink',
  'print.palette.data.signalOrange': 'Signal orange',
  'print.palette.data.indigo': 'Indigo',
  'print.palette.data.pineGreen': 'Pine green',
  'print.palette.data.sienna': 'Sienna',
  'print.palette.editorial.vermilion': 'Vermilion',
  'print.palette.editorial.indigo': 'Indigo',
  'print.palette.editorial.pineGreen': 'Pine green',
  'print.palette.editorial.sienna': 'Sienna',
  'print.palette.poster.signalOrange': 'Orange',
  'print.palette.poster.vermilion': 'Scarlet',
  'print.palette.poster.indigo': 'Indigo',
  'print.palette.poster.pineGreen': 'Pine green',
  'print.palette.pair.inkPaper': 'Body text vs paper',
  'print.palette.pair.linePaper': 'Line vs paper',
  'print.palette.pair.accentLine': 'Reversed text vs bar',
  'print.palette.pair.inkPage': 'Body text vs page',
  'print.palette.pair.accentPage': 'Accent vs page',
  'print.palette.pair.linePage': 'Line vs page',
  'print.palette.pair.focusPage': 'Focus vs page',
  'print.palette.pair.hairlinePage': 'Hairline vs page',
  'print.palette.pair.statusPage': 'Status vs page',
  'print.palette.pair.dividerPage': 'Divider vs page',

  'print.selector.title': 'Template & modules',
  'print.selector.close': 'Close template & modules',
  'print.selector.readMode': 'Reading style',
  'print.selector.blocksTitle': 'Printed content (five blocks)',
  'print.selector.blocksNote':
    "The template's own layout devices (masthead / footer rule / page sequence / summary block) are not listed here; removable items depend on the layout.",
  'print.selector.paletteBuilding':
    'Palette: {name} page is under construction — the three slots and presets are ready and take effect once the page ships.',
  'print.selector.status': '{count} {unit} now · about {pages} pages',
  'print.selector.status.blocks': 'blocks',
  'print.selector.status.modules': 'modules',
  'print.selector.effectNote':
    'Toggles and palette take effect immediately, no confirmation needed; Esc / overlay click / ✕ all just close',
  'print.selector.outputs': 'Output modules',
  'print.selector.selectAll': 'Select all',
  'print.selector.selectNone': 'Invert',
  'print.selector.generic': 'Generic render',
  'print.selector.unavailable': 'Not available in this style',
  'print.selector.modulesNote':
    'Stage list / task list / member roster use generic rendering in styles without native pages; unavailable modules will be supported as generic rendering rolls out. Module choices are stored per style and survive style switches.',

  'print.forced.header': 'carried by this template’s masthead (project name and page sequence), a layout device',
  'print.forced.footer':
    'carried by layout devices in this template (credit = bottom bleed type, page number = header sequence), and the footnote is a governance disclosure — none of them follow the toggles',
  'print.forced.fallback': 'a layout device of this template',
  'print.forced.note': '“{label}” {reason} — not removable in this template yet.',

  'print.preview.title': 'Print preview',
  'print.preview.close': 'Close print preview',
  'print.preview.head': '{name} · about {pages} pages · A4',
  'print.zoom.group': 'Preview zoom',
  'print.zoom.fit': 'Fit',
  'print.zoom.slider': 'Preview zoom slider',
  'print.grayscale.aria': 'Grayscale preview',
  'print.grayscale.label': 'Grayscale',
  'print.building.title': '{name} · page under construction',
  'print.building.body':
    'Template registered ({count} native modules; module toggles and palette slots are ready), the page will ship in a later batch. Nothing is printed right now; printing and export are disabled.',
  'print.action.needPdf': 'Need a PDF? Choose “Save as PDF” in the print dialog',
  'print.action.notPrintable': 'This template’s page is under construction; not printable yet',
  'print.action.print': 'Print',
  'print.action.exportPng': 'Export PNG',
  'print.action.exportPngCount': 'Export PNG ({count} images)',
  'print.action.busy': 'Generating…',
  'print.action.pngFailed': 'PNG export failed — please use “Print / Save as PDF” instead.',
  'print.action.printedMain': 'Fell back to printing from the main window.',

  'print.page.loading.schedule': 'Loading the schedule…',
  'print.page.loading.calendar': 'Loading the calendar…',
  'print.page.loading.itinerary': 'Loading the itinerary…',
  'print.page.notFound': 'Project not found.',
  'print.page.backToList': '← Back to project list',
  'print.page.backToMyTasks': '← Back to my tasks',
  'print.page.backToProject': 'Back to project',
  'print.page.backToProjectDetail': '← Back to project detail',
  'print.page.notRelated': 'None of this project’s stages involve you.',
  'print.page.notTravel': '“{name}” is not a travel project, so there is no client itinerary.',
  'print.page.estimatedPages': 'about {pages} pages · A4',
  'print.page.totalPages': '{pages} pages · A4',
  'print.page.exportPdf': 'Export PDF',
  'print.page.printPdf': 'Print / Export PDF',
  'print.page.calendarView': 'Calendar view',
  'print.page.pdfDialogHint': 'Opened in the print dialog: choose “Save as PDF” to export.',
} as const;
