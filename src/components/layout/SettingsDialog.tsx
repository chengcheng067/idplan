import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CalendarDays,
  Database,
  FileDown,
  FileJson,
  Heart,
  Info,
  Languages,
  MessageSquare,
  Monitor,
  Moon,
  Puzzle,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { createLogExportIo } from './useLogExport';
import { clearLogs, dump, logUser } from '../../core/services/log.service';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useTheme } from '../../hooks/useTheme';
import { useLang, type Lang, type MessageKey } from '../../i18n';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { BUILD_VERSION, FRONTEND_STACK, REPO_URL } from '../../constants/version';
import { isDesktop } from '../../lib/desktopBridge';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { NasServiceSection } from '../settings/NasServiceSection';
import { CustomLibrarySection } from '../settings/CustomLibrarySection';
import { PluginsSection } from '../settings/PluginsSection';
import { PrintLogoSection } from '../settings/PrintLogoSection';
import { RestPolicyEditor } from '../settings/RestPolicyDialog';
import {
  useLayoutStore,
  SIDEBAR_W_COLLAPSED,
  SIDEBAR_W_EXPANDED,
} from '../../store/useLayoutStore';
import { useUiStore } from '../../store/useUiStore';
import { useXlViewport } from '../../hooks/useXlViewport';
import { appEnv } from '../../config/env';
import { useBackupIo } from './useBackupIo';
import { cn } from '../../lib/cn';

/**
 * 「设置」抽屉（侧栏底部入口 · 所有角色可见）。
 *
 * 用户反馈：导出日志按钮藏在顶栏一堆小图标里不明显，且第一次点总是提示「暂无日志」——
 * 因为日志系统是**被动记录**的，正常浏览不会有错误、日常操作也不会埋点，所以 0 条是常态。
 * 为让「导出日志」好找、且不至于每次都空，本面板：
 *   - 作为「设置」抽屉承载：导出日志、当前日志条数、清空日志；
 *   - 首屏显示日志条数，空时给引导提示文案（而不是裸的"暂无日志"）；
 *   - 后续设置项（主题、数据源等）可继续往这里收。
 *
 * 边界：所有角色可用（导出日志不限管理员，调试友好）。破坏性动作（清空日志）走二次确认。
 *
 * ── v0.8.6 · 反馈 #4：形态重构（跟随点击点 → 侧栏左缘抽屉）──
 * 旧形态（v0.8.5 C 系列）：`Modal placement="float"`，面板在**鼠标点击处**展开
 * （anchor={x: clientX, y: clientY}，键盘触发退化右下角）。她的原话：「应该是从
 * 这个边栏从左往右滑出，而不是鼠标在哪里点击弹出设置窗口，它就从哪里生成」。
 *
 * v0.8.6 形态：`Modal placement="left"`，抽屉从**窗口左缘**滑出、盖住侧栏、贴顶栏
 * 底缘全高展开（遮罩让位见 Modal.tsx 的 top-14 xl:top-16）。宽 640（≥xl），
 * <xl 近全屏（calc(100vw - 2rem)）。`anchor` 形参整个删除：新形态下锚点无意义
 * （Sidebar / MobileMoreMenu 两处调用点的 settingsAnchor state 同步移除）。
 *
 * ── v0.8.6.0002 · 反馈 #1：位置修正（盖住侧栏 → 贴侧栏右缘展开）──
 * 她的原话：「点击设置以后的二级菜单，我希望是在红色框的范围，当然可以往右边
 * 再有延伸。而不是现在的这个设置弹开的面板样式」——红框圈的是**侧栏那一列**
 * （含设置按钮）。即：她不要「盖住侧栏」，要设置面板**从侧栏右缘开始、紧贴
 * 侧栏右侧展开**（侧栏保持可见可点——她想设置时还能切侧栏）。
 *
 * 新形态：`Modal placement="left-rail"`，遮罩左缘 = 侧栏宽度（xl 展开 240 /
 * 收起 64，随侧栏折叠实时跟随），抽屉贴侧栏右缘展开；遮罩只压内容区，侧栏
 * 不被压住、中心命中测试仍是侧栏自己。宽仍 640（≥xl）/<xl 全屏（该档无持久
 * 侧栏，railLeft=0 与旧 left 档一致）。几何验收见 tests/settings-zones.spec.ts
 * 的 S-Z4；qa-batch-a-verify 的 Q-A2-1 旧口径（left≈0 / 盖住侧栏）随本次
 * 语义变更报 team-lead 确认后更新。
 *
 * ── v0.8.6 · 反馈 #7：分区重构（一列到底 → 左导航双栏）──
 * 她的原话：「设置里面有非常混乱每个部分应该属于哪一个栏，这些都是看不清楚的」，
 * 并授权「按我们软件自己的需求分区，不必对齐 ID-Aura」。
 * 「数据与备份」排第 3 是刻意的：她在 0.8.6.0001 说过「导入备份没有看到在哪里」——
 * 备份是高频路径，不能埋在最后。
 *
 * ── v0.8.6.0002 · 反馈 #2（她 10-07 21:21 图 5 第 1 点**自我修正**）──
 * 早些时候她说「插件才是一级选项，Agent 只是二级」，我实现时理解成
 * 「Agent 席位是宿主能力、不该塞进插件」，做成了七区（Agent 与自动化
 * 与插件平级）。她看完真机后明确否定：「Agent 与自动化的设置应该是在
 * 插件里面，它属于插件的设置，和插件不应该是平级关系。」
 *
 * 那一轮的口径：**「Agent 与自动化」不再是独立一级分区**，三项内容收进
 * 插件区顶部一枚**两段子导航**（插件 / Agent 与自动化）。左导航从七项变六项：
 *   ① 外观        主题（侧栏展开/折叠选项已于 0.8.6.0002 反馈 #4 后半拿掉）
 *   ② 排程        休息制度（管理员）/ 排期口径说明（项目级）
 *   ③ 数据与备份  保存·导入备份 / 日志导出 / NAS 服务 / 检查更新 / 数据存放说明
 *   ④ 插件        插件开关/从文件安装/卸载/启用前披露（+ 上一轮的 Agent 子段）
 *   ⑤ 行业与模板  行业库（自定义包三步流）
 *   ⑥ 关于        版本 / 开源许可 / Issue / 赞赏与反馈预留卡
 *
 * ── v1.0 · 设置再收一层：**插件自带的设置搬进插件自己的卡**（本轮）──
 * 她的原话：「Agent 实际上应该包含在下面那个箭头指的『插件』里面，给里面
 * 增加一个设置按钮。**每一个插件都应该有自己对应的设置，它应该是在自己的
 * 板块里面**」。
 *
 * 上一轮的「两段子导航」被这句话判死——它把 Agent 做成了**插件区的一个固定
 * 二级页**，于是「插件」这个概念里只有 Agent 一家有事可说，再加第二个插件就
 * 得往子导航里塞第三个段，是一张会无限长的**硬编码清单**。本轮拆掉它，改成
 * 声明式：**哪个插件有什么设置，由 manifest 的 `settingsSlot` 说**，
 * 宿主只负责在每张插件卡上放一枚齿轮、点开就地渲染 `PluginSettingsSlot`
 * （`PluginsSection.tsx`）。一级导航仍是六项、插件仍不是一级板块。
 *
 * 随之发生的事（都在本轮改完，无遗留）：
 *   · `PluginSubKey` / `PLUGIN_SUBS` / `pluginSub` 状态 / 那枚 `role="tablist"`
 *     两段子导航 —— **整块删除**（`data-plugins-subtab` 钩子一并退役）；
 *   · 插件区右栏变成**无条件** `<PluginsSection />`（不再有子段分支）；
 *   · Agent 三块（席位与本地库 / 自然语言通道 / 看板入口）搬进
 *     `src/plugins/agent-board/AgentSettingsPanel.tsx`，经该插件的
 *     `settingsSlot` 挂载——**权限口径不变：全员可见**（原来那两段子导航
 *     也没有 adminOnly 门控，见下方 #11 段落）；
 *   · 因此 `SettingsDialog` 不再持有 Agent 席位 / 本地库占用 / Agent 相关
 *     图标与 i18n 键的引用，也不再 import `Link`（唯一一处 `<Link to="/agent">`
 *     跟着搬家；它原先在插件停用时是个死链，搬进 slot 后天然只在插件启用时存在）。
 *
 * ── v0.8.6.0002 · 反馈 #11 + 图 5 第 3 点：按角色收分区 ──
 * 她的原话（#11）：「成员看板的设置界面，是不是'行业与模板'这个位置就可以让它消失掉」；
 * （图 5 第 3 点）：「成员的设置界面是看不到排程这个按钮的。」
 * 规则：**「行业与模板」与「排程」均仅管理员可见**——成员身份下这两个
 * 分区**从左导航消失**（不是禁用态占位）。行业库是管理职能（导入的
 * 自定义阶段/套餐会进**所有人**的建档器）；排程区两块内容——「休息制度」
 * 本就是 admin-only（RestPolicyEditor 内含 isAdmin 门控，双保险），
 * 「排期基准」是**项目级**设置的落脚说明，而新建项目仅管理员可操作
 * （侧栏新建项目按钮 isAdmin 门控）⇒ 成员没有「排程设置在哪」这个问题，
 * 不为了留内容而破坏「成员看不到排程」：该说明随分区对成员消失、对管理员保留。
 * 插件**保留给成员**（她明确「插件给成员保留」）；Agent 与自动化那三块原为
 * 全员可见，v1.0 起搬进 agent-board 的 `settingsSlot` 后**仍全员可见**
 * （不因「搬进插件」而顺手加管理员门控）；备份自 0.8.6.0002 起全员开放，
 * 数据与备份区同样保留。
 *
 * ── v0.8.6.0002 · 反馈 #4 后半：拿掉外观区「侧栏 展开/折叠」选项 ──
 * 她的原话：「至于侧栏的展开与折叠，你是不是想要实现：如果选择了展开，
 * 外面的折叠按钮就会消失？我觉得这个地方和上面有一点点冲突，看有没有
 * 必要。如果没必要的话，就把设置里的这个选项给拿掉」。
 * 判定：拿掉——侧栏上本来就有折叠开关，设置里再放一份 = 两个真相源
 * （改一处另一处不跟随的困惑）。`useLayoutStore.sidebarExpanded` 的持久化
 * 与侧栏折叠开关本身不动（设置只是不再重复表达它）。
 *
 * 实现纪律（本轮只搬位置 + 补分区结构，不动设置项自身的 DOM/文案/钩子）：
 *   - 每个既有 Section 组件（CustomLibrary / Plugins / NasService / RestPolicyEditor）
 *     原样搬进对应分区，内部零改动；
 *   - 左导航 168（≥xl 竖排）；<xl 退化为顶部横向条（overflow-x-auto），不断裂；
 *   - 右内容区 flex-1 min-h-0 overflow-y-auto（沿用抽屉既有滚动底子）；
 *   - data-settings-drawer 几何钩子保持；导航与分区面板用 data-settings-zone /
 *     data-settings-zone-panel 两条新钩子供验收，既有 data- 属性与 aria 一律不动。
 */

/**
 * 六个分区（反馈 #7 六区 → v0.8.6.0002 反馈 #2 七区 → 图 5 第 1 点收回口：
 * Agent 与自动化并入插件区 → v1.0 起 Agent 三块再收进 agent-board 插件自己的
 * 设置卡，一级导航**始终是这六项**）。顺序即导航顺序；key 同时是导航钩子值。
 * `adminOnly`：仅管理员可见（反馈 #11 + 图 5 第 3 点）——成员身份下该分区
 * 从左导航消失（不是禁用）。
 */
type ZoneKey = 'appearance' | 'schedule' | 'data' | 'plugins' | 'industry' | 'about';

/**
 * 分区导航标签走 i18n（2026-10-13 中英切换 · 批 1）：这里只留**键**，
 * 值住在 `src/i18n/messages/{zh,en}.ts`。理由见 `src/i18n/labels.ts` 文件头。
 */
const ZONES: ReadonlyArray<{ key: ZoneKey; labelKey: MessageKey; Icon: LucideIcon; adminOnly?: boolean }> = [
  { key: 'appearance', labelKey: 'settings.zone.appearance', Icon: Sun },
  // 排程区（图 5 第 3 点）：「成员的设置界面是看不到排程这个按钮的」——
  // 与「行业与模板」同款口径，成员身份下整分区从左导航消失
  { key: 'schedule', labelKey: 'settings.zone.schedule', Icon: CalendarDays, adminOnly: true },
  { key: 'data', labelKey: 'settings.zone.data', Icon: Database },
  { key: 'plugins', labelKey: 'settings.zone.plugins', Icon: Puzzle },
  // 行业库是管理职能（反馈 #11）：成员身份下整分区从左导航消失
  { key: 'industry', labelKey: 'settings.zone.industry', Icon: FileJson, adminOnly: true },
  { key: 'about', labelKey: 'settings.zone.about', Icon: Info },
];

/**
 * 「赞赏支持 / 反馈建议」卡（v0.8.6 · 反馈 #7）。
 * 微信图 2026-10-08 由产品负责人提供，落 public/（随安装包与仓库分发）：
 *   · wechat-pay.jpg     —— 微信收款码（竖图 828×1124）
 *   · wechat-contact.jpg —— 微信个人二维码（竖图 592×754）
 * 排版：实线卡（不再是虚线占位）+ 150px 图宽保持原比例（3:4 竖图不裁切，
 * 裁了二维码不完整就扫不了）。文案口语化，不写"敬请赞赏"这类客套。
 */
function WeChatCard({
  title,
  caption,
  img,
  icon: Icon,
}: {
  title: string;
  caption: string;
  img: string;
  icon: LucideIcon;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[12px] border border-line bg-paper px-4 py-5 text-center">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-full bg-pine-soft text-pine"
        >
          <Icon size={12} />
        </span>
        <p className="text-sm font-medium text-ink">{title}</p>
      </div>
      <img
        src={img}
        alt={title}
        loading="lazy"
        className="w-[150px] rounded-[8px] border border-line"
      />
      <p className="max-w-[220px] text-[11px] leading-relaxed text-mist">{caption}</p>
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}): JSX.Element | null {
  const io = useMemo(() => createLogExportIo(), []);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const toast = useProjectsStore((s) => s.pushToast);
  const { mode, setMode } = useTheme();
  /**
   * 界面语言（2026-10-13 批 1）：本 hook 同时是**语言变化的订阅点**——
   * 少了它，切语言时本抽屉不会重渲染（文案停在旧语言）。
   */
  const { t, lang, setLang } = useLang();
  // 角色闭环：休息制度仅在管理员设置界面出现（普通成员界面取消该区块）。
  // 顶栏独立入口 RestPolicySettingsButton 已是 admin-only，这里保持一致，权限规则不再散落。
  const { isAdmin } = useRoleGuard();
  /**
   * 按角色收分区（v0.8.6.0002 · 反馈 #11 + 图 5 第 3 点）：「行业与模板」与
   * 「排程」仅管理员可见——成员身份下这两个分区从左导航**消失**（不是禁用占位）。
   * 判定与休息制度同源（useRoleGuard().isAdmin），不另造角色口径。
   */
  const visibleZones = useMemo(() => ZONES.filter((z) => !z.adminOnly || isAdmin), [isAdmin]);
  /** 可见分区的第一项 —— 分区复位时的落点（所有角色都看得见「外观」，故必存在） */
  const firstVisibleZone: ZoneKey = visibleZones[0]?.key ?? 'appearance';
  // 仅桌面端生效：浏览器/NAS 端 isDesktop() 为 false，下方更新区整块不渲染、从不发起请求。
  const { status, payload, error, check } = useUpdateCheck();
  /** 当前所在分区（反馈 #7：默认「外观」——最轻、最高频的一项） */
  const [zone, setZone] = useState<ZoneKey>('appearance');
  /**
   * 右栏**实际渲染**的分区。
   *
   * ★ F5（team-lead 2026-10-12）：修前 `zone` 只在用户点击左导航时被写（全文件
   *   仅 `setZone` 一处调用点），关闭抽屉与身份切换都不复位，而设置组件的挂载点
   *   （Sidebar 底部 / MobileMoreMenu）**不随身份切换卸载** ⇒ 状态跨会话保留。
   *   症状：管理员 → 设置 → 选「排程」→ 关闭 → 顶栏切成**成员** → 重开设置
   *   ⇒ 右栏仍是排程内容（含打印标识上传、品牌词编辑），而左导航里既没有「排程」
   *   这一项、也没有任何高亮；成员看到管理员专属界面并且**可以直接操作**。
   *
   * 根因是 `ZONES` 的 `adminOnly` 只喂给了 `visibleZones`（**导航**），没有喂给
   * **内容分支** —— 于是「导航藏起来」被当成了"权限做到了"。这里把判据收成一条：
   * 渲染只看可见集。`zone` 不在可见集里（身份变了）就渲染第一可见分区。
   *
   * 为什么渲染期另算一次、而不是只靠下面的复位 effect：effect 在 **paint 之后**
   * 才跑，只靠它会让成员**闪一帧**排程面板（含 logo 上传按钮）。这里是零帧泄漏，
   * effect 负责把 `zone` 状态本身也搬正（左导航高亮 / data-* 钩子随之一致）。
   */
  const activeZone: ZoneKey = visibleZones.some((z) => z.key === zone) ? zone : firstVisibleZone;
  /**
   * 「请把设置抽屉收起来」的**显式请求**（v1.0 · 2026-10-14）——插件设置面板里的
   * 站内跳转要用它（最典型：`agent-board` 的「打开 Agent 看板」）。
   *
   * 为什么不是把 `onClose` 传下去：抽屉的 `open` 是 Sidebar / MobileMoreMenu 的
   * **组件内 state**，而插件面板由 `PluginSettingsSlot` 以 `<Slot />` **无 props**
   * 渲染 —— 传不下去。故请求方经 `useUiStore.requestSettingsClose()` 发一个单向信号，
   * 抽屉在这里订阅并调自己的 `onClose`：**关不关仍由抽屉决定**，状态归属不动。
   *
   * 实现是「计数边沿检测」而不是「布尔订阅」：计数器每次请求 +1，本组件只在**值变了**
   * 的那一次调 `onClose`（用 ref 记住上次看到的值）。这样连续两次请求不会被去重，
   * 且 Effect 因 `onClose` 每次渲染换新引用而重跑时，也**不会**误触发关闭
   * ——这是这个写法的关键，别改成 `if (req > 0) onClose()` 那种形态。
   */
  const settingsCloseRequest = useUiStore((s) => s.settingsCloseRequest);
  const seenCloseRequest = useRef(settingsCloseRequest);
  useEffect(() => {
    if (settingsCloseRequest === seenCloseRequest.current) return;
    seenCloseRequest.current = settingsCloseRequest;
    if (open) onClose();
  }, [settingsCloseRequest, open, onClose]);

  /**
   * 把 `zone` 状态与「抽屉开合 / 角色」对齐 —— 渲染期的 `activeZone` 已挡住泄漏，
   * 本条负责**状态本身**不残留（否则下次打开时左导航高亮与右栏会短暂不一致，
   * 且 `data-settings-zone-panel` 钩子会指向一个渲染不出来的分区）。
   * 两条判据：抽屉关着 ⇒ 归零；开着但当前分区已不可见（身份刚切换）⇒ 同样归零。
   */
  useEffect(() => {
    if (open && visibleZones.some((z) => z.key === zone)) return;
    setZone(firstVisibleZone);
  }, [open, zone, visibleZones, firstVisibleZone]);
  /**
   * 右内容滚动容器：切分区时回到顶部（内容整块换血，不留旧滚动位）
   */
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    // 盯 activeZone 而不是 zone：回顶要对齐**实际换掉的那块内容**
  }, [activeZone]);

  // 打开时实时读一次日志条数（抽屉每次打开都刷新，避免静态旧值）
  const count = useMemo(() => dump().length, [open]);

  // 备份两枚（v0.8.6.0002 · 反馈 #3）：与侧栏/⋮ 菜单同一份 useBackupIo 逻辑，
  // 这里是设置内「数据与备份」区的入口——备份是高频路径，不埋在所有区最后。
  const { save, pick, fileInput, confirmDialog } = useBackupIo();

  // 侧栏展开态（v0.7 · D3 持久化偏好）：抽屉贴侧栏右缘展开的几何要用——
  // ≥xl 侧栏是持久左栏（宽 240/64），<xl 侧栏自身是 Modal 抽屉（无持久栏 ⇒ 全屏）。
  // ⚠️ 本订阅**只为**抽屉贴缘几何存在：外观区不再放「侧栏 展开/折叠」选项
  //（v0.8.6.0002 · 反馈 #4 后半已拿掉，避免与侧栏折叠开关两个真相源）；
  // setSidebarExpanded 的设置入口随该选项一并删除，侧栏开关本身不动。
  const sidebarExpanded = useLayoutStore((s) => s.sidebarExpanded);
  const xl = useXlViewport();
  /**
   * v0.8.6.0002 · 反馈 #1：遮罩（与抽屉）左缘让出的宽度 = 侧栏宽度。
   * ≥xl 展开 240 / 收起 64（与 CSS --sidebar-w / --sidebar-w-collapsed 同值，
   * 常量见 useLayoutStore）；<xl 传 0——该档无持久侧栏，抽屉即主视野（全屏）。
   * 折叠开关在设置打开期间也能点（zustand 订阅 ⇒ 抽屉随缘实时跟随）。
   */
  const railLeftPx = xl ? (sidebarExpanded ? SIDEBAR_W_EXPANDED : SIDEBAR_W_COLLAPSED) : 0;

  // 打包日期（构建时静态快照，便于排查版本）
  const buildDate = new Date().toISOString().slice(0, 10);

  // 主题三选控件（文案走 i18n；键与英文值见 src/i18n/messages/）
  const themeOptions = [
    { key: 'light' as const, label: t('appearance.theme.light'), icon: <Sun size={15} aria-hidden /> },
    { key: 'dark' as const, label: t('appearance.theme.dark'), icon: <Moon size={15} aria-hidden /> },
    {
      key: 'system' as const,
      label: t('appearance.theme.system'),
      icon: <Monitor size={15} aria-hidden />,
    },
  ];

  /**
   * 语言两选（2026-10-13 批 1）。形态照抄上面的主题三选（同排、同高、同选中样式），
   * 差别只有两处，都是有原因的：
   *   · 两选而非三选——语言没有第三档「跟随系统」的合理语义（跟随浏览器语言
   *     是我们**明确排除**的：英文系统的用户一打开就变英文，属无人要求的行为变更）；
   *   · `data-lang-option` 钩子——本仓一律用 `data-*` 定位元素（全仓 0 处 `getByText`），
   *     真机验收按钩子点，不按文案点（文案会随语言变，钩子不会）。
   * 切换**即时生效**：setLang() 同步改模块级 store，订阅方（useLang）在同一次
   * React 更新里拿到新语言，不需要刷新、不需要重开设置。
   */
  const langOptions: ReadonlyArray<{ key: Lang; labelKey: MessageKey }> = [
    { key: 'zh', labelKey: 'appearance.lang.zh' },
    { key: 'en', labelKey: 'appearance.lang.en' },
  ];

  const onExport = (): void => {
    const n = io.export();
    onClose();
    toast('success', t('settings.log.toastExported', { count: n }));
  };

  const onClear = (): void => {
    clearLogs();
    setConfirmClearOpen(false);
    // logUser 的**第一个参数是分组键**（非显示文本）⇒ 按 release-checklist §5 口径不翻
    logUser('设置', t('settings.log.clear'));
    toast('success', t('settings.log.toastCleared'));
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        placement="left-rail"
        railLeft={`${railLeftPx}px`}
        ariaLabel={t('settings.drawerAria')}
      >
        {/*
          v0.8.6.0002 · 反馈 #1：贴侧栏右缘展开的全高抽屉（左缘 = 侧栏右缘，
          侧栏不被遮罩压住、保持可见可点）。
          · ≥xl：遮罩 left = 侧栏宽（展开 240 / 收起 64，见 railLeftPx），
            抽屉宽 640 紧随其后；<xl：railLeft=0 ⇒ 全屏（该档无持久侧栏）
          · 贴顶栏底缘全高（Modal 抽屉族几何：p-0 + items-stretch），不再有
            max-h/圆角被裁的旧问题——高度就是遮罩可用高度
          · 圆角只留右缘（左缘贴侧栏，视觉上是侧栏的延伸）；glass-strong 自带描边与底色
          · v0.8.6.0002 · 图 5 第 2 点：贴侧栏右缘时**接缝不画线、投影不溅到侧栏**——
            她的原话：「弹出的设置窗颜色和侧边栏的颜色差别过大，我认为这个时候
            不应该有这个色差。」实测两侧底色本来就是同一个 paper token，差别全部
            来自接缝（抽屉左描边 + 侧栏右描边两道 1px line，以及两侧外凸投影互相
            溅——暗色下把侧栏右缘压深一档 #1f2126→#181a1e，像两块拼起来的）。
            抽屉侧接缝类 settings-rail-drawer 清零左描边（投影保留、向左的
            溢出被上层不透明侧栏挡住）；侧栏的右描边 / 投影 / z 层在 Sidebar 同步收。
          · v0.8.6 · 反馈 #7：头部之下改「左导航 168 + 右内容」双栏（≥xl 竖排导航；
            <xl 导航退化顶部横向条），主体滚动收进右栏（min-h-0 overflow-y-auto）
          · drawer-in-left：从左缘 24px 滑入，200ms ease-out（克制；reduced-motion 已关停）
          · data-settings-drawer：真几何验收钩子（新增，不动任何既有 data-/aria 钩子）
        */}
        <div
          data-settings-drawer=""
          className="drawer-in-left settings-rail-drawer glass-strong flex h-full w-[640px] max-w-[100vw] flex-col rounded-r-2xl max-xl:w-full"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-pine" aria-hidden />
              <h2 className="font-display text-base font-semibold text-ink">{t('settings.title')}</h2>
              {/* Beta 标记（v0.7）：与侧栏品牌同款徽标，提示内测版本 */}
              <span
                title={t('settings.betaTitle')}
                className="inline-flex h-[18px] shrink-0 items-center rounded-sm bg-pine-soft px-1.5 text-[10px] font-medium text-pine"
              >
                Beta
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('settings.closeAria')}
              className="rounded-[8px] p-1.5 text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>

          {/*
            反馈 #7 双栏：左导航（六区）+ 右内容（随导航切换、独立滚动）。
            · ≥xl：竖排导航 168 固定宽（shrink-0），右栏 flex-1；
            · <xl：导航退化顶部横向条（flex-col → flex-row，overflow-x-auto 防窄屏挤裂），
              与右栏上下堆叠——390px 手机档横条可横滑，不截断也不压内容。
          */}
          <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
            <nav
              aria-label={t('settings.navAria')}
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-2 xl:w-[168px] xl:flex-col xl:overflow-y-auto xl:border-b-0 xl:border-r xl:px-3 xl:py-4"
            >
              {visibleZones.map((z) => {
                const active = activeZone === z.key;
                return (
                  <button
                    key={z.key}
                    type="button"
                    data-settings-zone={z.key}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setZone(z.key)}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-2 text-sm transition-colors outline-none',
                      'focus-visible:ring-2 focus-visible:ring-pine/40',
                      // 高亮口径与侧栏导航同源：亮色 pine-soft 底 pine 字，暗色凹陷 sunken
                      active
                        ? 'bg-pine-soft text-pine dark:bg-sunken'
                        : 'text-mist hover:bg-sand hover:text-ink',
                    )}
                  >
                    <z.Icon size={15} aria-hidden />
                    <span className="whitespace-nowrap">{t(z.labelKey)}</span>
                  </button>
                );
              })}
            </nav>

            {/* 右内容（当前分区；切换分区即整块换血，滚动位置随之重置） */}
            <div
              ref={panelRef}
              data-settings-zone-panel={activeZone}
              className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
            >
              {/* ① 外观 */}
              {activeZone === 'appearance' && (
                <>
                  {/* 主题区（从原一列到底首屏迁入） */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Sun size={14} className="text-mist" aria-hidden />
                        {t('settings.section.theme')}
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      {themeOptions.map((o) => {
                        const active = mode === o.key;
                        return (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() => setMode(o.key)}
                            aria-pressed={active}
                            className={
                              'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors ' +
                              (active
                                ? 'border-pine bg-pine text-cream shadow-accent'
                                : 'border-line text-mist hover:bg-sand hover:text-ink')
                            }
                          >
                            {o.icon}
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-mist">{t('appearance.themeHint')}</p>
                  </section>

                  {/*
                    语言两选（2026-10-13 · 批 1）。紧贴「主题」之后、同属「外观」，
                    两条理由：① 它是所有角色都看得见的第一分区（ZONES 的
                    appearance 没有 adminOnly，成员也进得来）；② 与主题同性质
                    ——都是「这台机器上的界面偏好」，不是业务配置。
                    ⚠️ 这条**绝对不许**新增第七个一级分区：tests/settings-zones.spec.ts
                    对 data-settings-zone 的 ZONE_KEYS 是**全等断言**（:401/:614/:661），
                    加一级分区当场红；加**行内控件**不撞。
                  */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Languages size={14} className="text-mist" aria-hidden />
                        {t('appearance.lang')}
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      {langOptions.map((o) => {
                        const active = lang === o.key;
                        return (
                          <button
                            key={o.key}
                            type="button"
                            data-lang-option={o.key}
                            onClick={() => setLang(o.key)}
                            aria-pressed={active}
                            className={
                              'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors ' +
                              (active
                                ? 'border-pine bg-pine text-cream shadow-accent'
                                : 'border-line text-mist hover:bg-sand hover:text-ink')
                            }
                          >
                            {t(o.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-mist">{t('appearance.langHint')}</p>
                  </section>
                  {/*
                    v0.8.6.0002 · 反馈 #4 后半：「侧栏 展开/折叠」两选已**整块拿掉**。
                    她的原话：「如果没必要的话，就把设置里的这个选项给拿掉」——
                    侧栏上本来就有折叠开关，设置里再放一份 = 两个真相源。
                    侧栏折叠开关（SidebarCollapseToggle）与 sidebarExpanded 持久化
                    均不动；抽屉贴侧栏右缘的几何仍订阅该 store（见 railLeftPx）。
                  */}
                </>
              )}

              {/*
                ② 排程（v0.8.6.0002 · 图 5 第 3 点：整分区仅管理员）——她的原话：
                「成员的设置界面是看不到排程这个按钮的。」与「行业与模板」同款
                口径，成员身份下从左导航消失（见 ZONES 的 adminOnly）。区内
                两块内容一并对成员消失（说明见下方注释），不为了留内容破坏整区收。
              */}
              {activeZone === 'schedule' && (
                <>
                  {/* 休息制度区（嵌入原 RestPolicyDialog 编辑主体）——仅管理员可见 */}
                  {isAdmin && (
                    <section>
                      <div className="mb-2 flex items-center gap-1.5">
                        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                          <Settings size={14} className="text-mist" aria-hidden />
                          {t('settings.section.restPolicy')}
                        </h3>
                      </div>
                      <div className="rounded-[12px] border border-line bg-cream/40 p-3">
                        <RestPolicyEditor embedded />
                      </div>
                    </section>
                  )}

                  {/*
                    排期口径说明（反馈 #7 盘点结论）：排期基准是**项目级**设置
                    （建档时在阶段选择里指定，随项目保存），不在全局设置里；
                    周起始日无切换项（月历按 ISO 周，周一开头）。写在这里是为了
                    回答「排程类的设置到底在哪」——她的原话是「看不清楚」。
                    图 5 第 3 点后本区仅管理员可达，该说明随之只对管理员显示：
                    新建项目仅管理员可操作（侧栏新建项目按钮 isAdmin 门控），
                    成员没有这个疑问，不单独给它找全员可见的落脚处。
                  */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <CalendarDays size={14} className="text-mist" aria-hidden />
                        {t('settings.section.scheduleBasis')}
                      </h3>
                    </div>
                    <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                      {t('settings.schedule.basisPre')}
                      <strong className="text-ink">{t('settings.schedule.basisStrong')}</strong>
                      {t('settings.schedule.basisTail')}
                    </p>
                  </section>

                  {/*
                    打印标识（logo）：全局级、管理员上传（产品决策文档 §3.3）。
                    住在排程区 = 「管理员可见、成员不可见」由分区角色可见性直接
                    兑现（本区 adminOnly，成员从左导航整区消失）；上传时前端
                    灰度二值化 + ≤200KB，落 settings KV（随备份换设备恢复）。
                    未上传 ⇒ 四版模板与经典纸面统一「ID Plan」文字标。
                  */}
                  <PrintLogoSection />
                </>
              )}

              {/* ③ 数据与备份（反馈 #7：备份是高频路径，排第 3 区） */}
              {activeZone === 'data' && (
                <>
                  {/* 数据存放说明（一句人话：桌面=本机 / NAS=你的 NAS） */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Database size={14} className="text-mist" aria-hidden />
                        {t('settings.section.dataLocation')}
                      </h3>
                    </div>
                    <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                      {appEnv.dataSource === 'remote' ? (
                        <>
                          {t('settings.data.wherePre')}
                          <strong className="text-ink">{t('settings.data.whereNas')}</strong>
                          {t('settings.data.addressLead')}
                          <span className="font-mono text-ink">{appEnv.apiBaseUrl || t('settings.data.notConfigured')}</span>
                          {t('settings.data.whereTail')}
                        </>
                      ) : (
                        <>
                          {t('settings.data.wherePre')}
                          <strong className="text-ink">{t('settings.data.whereLocal')}</strong>
                          {t('settings.data.localTail')}
                        </>
                      )}
                    </p>
                  </section>

                  {/* 备份两枚（与侧栏 / ⋮ 菜单同一份 useBackupIo 实现，零新逻辑） */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <FileJson size={14} className="text-mist" aria-hidden />
                        {t('settings.section.backup')}
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void save()}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand"
                      >
                        {t('settings.data.saveBackup')}
                      </button>
                      <button
                        type="button"
                        onClick={pick}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line px-4 py-2.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
                      >
                        {t('settings.data.loadBackup')}
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-mist">
                      {t('settings.data.backupHint')}
                    </p>
                  </section>

                  {/* 日志区（原底部固定操作区的两枚按钮随迁本区，行为不变） */}
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Database size={14} className="text-mist" aria-hidden />
                        {t('settings.section.frontendLog')}
                      </h3>
                      <span className="rounded-md bg-cream px-2 py-0.5 text-xs text-mist">
                        {t('settings.log.count', { count })}
                      </span>
                    </div>

                    {count === 0 ? (
                      <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                        {t('settings.log.emptyLead')}{' '}
                        <strong className="text-ink">{t('settings.log.emptyOnError')}</strong>
                        {t('settings.log.emptyOr')}{' '}
                        <strong className="text-ink">{t('settings.log.emptyKeyOps')}</strong>
                          {t('settings.log.emptyTail')}
                      </p>
                    ) : (
                      <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                        {t('settings.log.recordedPre')}
                        <strong className="text-ink">{count}</strong>
                        {t('settings.log.recordedTail')}
                      </p>
                    )}

                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={onExport}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand"
                      >
                        <FileDown size={15} className="text-mist" aria-hidden />
                        {t('settings.log.export')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearOpen(true)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line px-4 py-2.5 text-sm text-mist transition-colors hover:bg-sand hover:text-clay"
                      >
                        <Trash2 size={15} className="text-mist" aria-hidden />
                        {t('settings.log.clear')}
                      </button>
                    </div>
                  </section>

                  {/* NAS 服务区（0.8.2.0002 备份事故修复）：仅 remote 数据源渲染，local/桌面整块不出现 */}
                  <NasServiceSection />

                  {/* 检查更新：仅 Windows 桌面端显示；浏览器/NAS 端 isDesktop() 为 false，整块不渲染 */}
                  {isDesktop() && (
                    <section>
                      <div className="mb-2 flex items-center gap-1.5">
                        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                          <Info size={14} className="text-mist" aria-hidden />
                          {t('settings.section.update')}
                        </h3>
                      </div>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => void check()}
                          disabled={status === 'checking'}
                          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {status === 'checking' ? t('settings.update.checking') : t('settings.update.check')}
                        </button>

                        {status === 'up-to-date' && (
                          <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-2.5 text-xs text-mist">
                            {t('settings.update.upToDate', { version: BUILD_VERSION })}
                          </p>
                        )}
                        {status === 'has-update' && payload && (
                          <div className="rounded-xl border border-clay/40 bg-clay-soft px-3.5 py-2.5 text-xs">
                            <p className="font-medium text-clay-deep">
                              {t('settings.update.hasUpdate', { version: payload.latest })}
                            </p>
                            <a
                              href={payload.exeAssetUrl || payload.releaseUrl || REPO_URL}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-pine underline-offset-2 hover:underline"
                            >
                              {t('settings.update.download')}
                            </a>
                          </div>
                        )}
                        {status === 'error' && (
                          <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-2.5 text-xs text-mist">
                            {t('settings.update.failed', { error: error ?? '' })}
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}

              {/*
                ④ 插件（v1.0 · 她的原话：「Agent 实际上应该包含在下面那个箭头指的
                『插件』里面，给里面增加一个设置按钮。**每一个插件都应该有自己对应的
                设置，它应该是在自己的板块里面**」）。

                形态：插件区**只剩一件事**——那张插件列表，每张卡一枚齿轮，点开就是
                **该插件自己的设置**（内容来自 `manifest.settingsSlot`，渲染在
                `PluginsSection` 里）。两级硬编码导航（`PLUGIN_SUBS` 的「插件 /
                Agent 与自动化」两段子导航）随之整块拆掉：插件不做一级板块，也**不再
                在插件区里做第二个二级层**——「哪个插件有什么设置」由 manifest 声明，
                不由宿主再抄一份名单。

                Agent 三块（席位与本地库 / 自然语言通道 / 看板入口）已搬进
                `src/plugins/agent-board/AgentSettingsPanel.tsx`，经 agent-board 的
                `settingsSlot` 挂载——所以它天然只在 agent-board 启用时存在
                （原实现里那枚 `<Link to="/agent">` 因此顺手摘掉了「插件关掉后
                点过去 404」的死链问题）。权限口径不变：**全员可见**（原二级子段
                也没有 adminOnly 门控，搬进插件 slot 后不得顺手加管理员墙）。
              */}
              {activeZone === 'plugins' && <PluginsSection />}

              {/* ⑤ 行业与模板（仅管理员：反馈 #11 成员身份下整分区不渲染） */}
              {activeZone === 'industry' && isAdmin && <CustomLibrarySection />}

              {/* ⑥ 关于 */}
              {activeZone === 'about' && (
                <>
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Database size={14} className="text-mist" aria-hidden />
                        {t('settings.section.about')}
                      </h3>
                    </div>
                    <dl className="space-y-1.5 rounded-[12px] border border-line bg-cream/40 px-3.5 py-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">{t('settings.about.version')}</dt>
                        <dd className="font-medium text-ink">{BUILD_VERSION}</dd>
                      </div>
                      {/* 开源许可（MIT，仓库根 LICENSE）——反馈 #7 分区方案里「关于」区的明列项 */}
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">{t('settings.about.license')}</dt>
                        <dd className="text-ink">MIT</dd>
                      </div>
                      {/* 内测提示（v0.7）：与标题 Beta 徽标呼应，克制地说明版本状态 */}
                      <p className="pt-0.5 text-[11px] leading-relaxed text-mist">
                        {t('settings.about.betaNote')}
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">{t('settings.about.frontend')}</dt>
                        <dd className="text-ink">{FRONTEND_STACK}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">{t('settings.about.packaging')}</dt>
                        <dd className="text-ink">{buildDate}</dd>
                      </div>
                    </dl>

                    <p className="mt-1.5 text-[11px] text-mist">
                      {t('settings.about.issueLead')}
                      <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="text-pine underline-offset-2 hover:underline"
                      >
                        {REPO_URL}
                      </a>
                    </p>
                  </section>

                  {/*
                    赞赏与反馈：微信图 2026-10-08 到位（public/wechat-pay.jpg 收款码 +
                    public/wechat-contact.jpg 个人二维码），两张虚线占位卡换成实卡。
                  */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Heart size={14} className="text-mist" aria-hidden />
                        {t('settings.section.support')}
                      </h3>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <WeChatCard
                        title={t('settings.support.wechatTitle')}
                        icon={Heart}
                        img="/wechat-pay.jpg"
                        caption={t('settings.support.wechatCaption')}
                      />
                      <WeChatCard
                        title={t('settings.support.feedbackTitle')}
                        icon={MessageSquare}
                        img="/wechat-contact.jpg"
                        caption={t('settings.support.feedbackCaption')}
                      />
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmClearOpen}
        title={t('settings.log.clear')}
        confirmText={t('settings.log.clearConfirm')}
        onConfirm={onClear}
        onCancel={() => setConfirmClearOpen(false)}
      >
        <p>
{t('settings.log.clearPre')}
          <strong>{count}</strong>
          {t('settings.log.clearTail')}
        </p>
      </ConfirmDialog>

      {/* 备份导入的隐藏 file input + 覆盖式恢复二次确认（与侧栏同一份 useBackupIo 逻辑） */}
      {fileInput}
      {confirmDialog}
    </>
  );
}
