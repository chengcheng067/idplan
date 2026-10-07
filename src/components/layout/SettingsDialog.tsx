import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  Bot,
  CalendarDays,
  Database,
  FileDown,
  FileJson,
  Heart,
  Info,
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
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useRepos } from '../../hooks/useRepos';
import { BUILD_VERSION, FRONTEND_STACK, REPO_URL } from '../../constants/version';
import { isDesktop } from '../../lib/desktopBridge';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { NasServiceSection } from '../settings/NasServiceSection';
import { CustomLibrarySection } from '../settings/CustomLibrarySection';
import { PluginsSection } from '../settings/PluginsSection';
import { RestPolicyEditor } from '../settings/RestPolicyDialog';
import { AGENT_SEAT_LIMIT } from '../../constants/agentTerms';
import { useMembersStore } from '../../store/useMembersStore';
import {
  useLayoutStore,
  SIDEBAR_W_COLLAPSED,
  SIDEBAR_W_EXPANDED,
} from '../../store/useLayoutStore';
import { useXlViewport } from '../../hooks/useXlViewport';
import { appEnv } from '../../config/env';
import { useBackupIo } from './useBackupIo';
import { cn } from '../../lib/cn';
import {
  estimateLocalDbUsage,
  formatBytes,
  type LocalDbUsage,
} from '../../lib/storage-estimate';

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
 * 本轮按她的新口径收口：**「Agent 与自动化」不再是独立一级分区**，它的
 * 三项内容（Agent 席位与本地库 / 自然语言通道 / Agent 看板入口）收进
 * **插件区内的二级分组**——插件区顶部一枚两段子导航（插件 / Agent 与
 * 自动化），默认落在「插件」段。为什么用子导航而不是一区两个小标题：
 * 插件区自身已有说明段 + 安装钮 + N 行插件，再并进 Agent 三块会顶出
 * 一屏半，子导航让两段各自一屏内聚焦，也把「Agent 是插件的二级」这件
 * 事在结构上说清。左导航从七项变六项：
 *   ① 外观        主题（侧栏展开/折叠选项已于 0.8.6.0002 反馈 #4 后半拿掉）
 *   ② 排程        休息制度（管理员）/ 排期口径说明（项目级）
 *   ③ 数据与备份  保存·导入备份 / 日志导出 / NAS 服务 / 检查更新 / 数据存放说明
 *   ④ 插件        子导航二段：插件开关/从文件安装/卸载/启用前披露 + Agent 与自动化
 *   ⑤ 行业与模板  行业库（自定义包三步流）
 *   ⑥ 关于        版本 / 开源许可 / Issue / 赞赏与反馈预留卡

 * ── v0.8.6.0002 · 反馈 #11：按角色收分区 ──
 * 她的原话：「成员看板的设置界面，是不是'行业与模板'这个位置就可以让它消失掉」。
 * 规则：「行业与模板」仅管理员可见——成员身份下该分区**从左导航消失**（不是
 * 禁用态占位）。行业库是管理职能（导入的自定义阶段/套餐会进**所有人**的
 * 建档器）；插件**保留给成员**（她明确「插件给成员保留」）；Agent 与自动化
 * 子段原为全员可见，收进插件区后仍全员可见；备份自 0.8.6.0002 起全员开放，
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
 * Agent 与自动化并入插件区作二级分组，回到六区）。顺序即导航顺序；
 * key 同时是导航钩子值。
 * `adminOnly`：仅管理员可见（反馈 #11 + 图 5 第 3 点）——成员身份下该分区
 * 从左导航消失（不是禁用）。
 */
type ZoneKey = 'appearance' | 'schedule' | 'data' | 'plugins' | 'industry' | 'about';

const ZONES: ReadonlyArray<{ key: ZoneKey; label: string; Icon: LucideIcon; adminOnly?: boolean }> = [
  { key: 'appearance', label: '外观', Icon: Sun },
  { key: 'schedule', label: '排程', Icon: CalendarDays },
  { key: 'data', label: '数据与备份', Icon: Database },
  { key: 'plugins', label: '插件', Icon: Puzzle },
  // 行业库是管理职能（反馈 #11）：成员身份下整分区从左导航消失
  { key: 'industry', label: '行业与模板', Icon: FileJson, adminOnly: true },
  { key: 'about', label: '关于', Icon: Info },
];

/**
 * 插件区内的两段子导航（v0.8.6.0002 图 5 第 1 点：Agent 与自动化归入插件区）。
 * 她是「Agent 与自动化」与「插件」不是平级关系的原话落地处：一级分区只有
 * 「插件」一枚，Agent 段是它的二级。顺序即子导航顺序；key 同时是子导航钩子值。
 */
type PluginSubKey = 'plugins' | 'agent';

const PLUGIN_SUBS: ReadonlyArray<{ key: PluginSubKey; label: string; Icon: LucideIcon }> = [
  { key: 'plugins', label: '插件', Icon: Puzzle },
  { key: 'agent', label: 'Agent 与自动化', Icon: Bot },
];

/** 「赞赏支持 / 反馈建议」预留卡（v0.8.6 · 反馈 #7）：微信图由产品负责人后续提供 */
function ReservedCard({ title, icon: Icon }: { title: string; icon: LucideIcon }): JSX.Element {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line bg-cream/40 px-4 py-6 text-center">
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-full bg-pine-soft text-pine"
      >
        <Icon size={16} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-[11px] text-mist">图片待补</p>
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
  // 角色闭环：休息制度仅在管理员设置界面出现（普通成员界面取消该区块）。
  // 顶栏独立入口 RestPolicySettingsButton 已是 admin-only，这里保持一致，权限规则不再散落。
  const { isAdmin } = useRoleGuard();
  /**
   * 按角色收分区（v0.8.6.0002 · 反馈 #11）：「行业与模板」仅管理员可见——
   * 成员身份下从左导航**消失**（不是禁用占位）。判定与休息制度同源
   * （useRoleGuard().isAdmin），不另造角色口径。
   */
  const visibleZones = useMemo(() => ZONES.filter((z) => !z.adminOnly || isAdmin), [isAdmin]);
  // 仅桌面端生效：浏览器/NAS 端 isDesktop() 为 false，下方更新区整块不渲染、从不发起请求。
  const { status, payload, error, check } = useUpdateCheck();
  /** 当前所在分区（反馈 #7：默认「外观」——最轻、最高频的一项） */
  const [zone, setZone] = useState<ZoneKey>('appearance');
  /**
   * 插件区内的当前子段（图 5 第 1 点：Agent 与自动化是插件区的二级分组）。
   * 默认「插件」——第三方功能包管理是这个区的主业；Agent 段收在它下面。
   */
  const [pluginSub, setPluginSub] = useState<PluginSubKey>('plugins');
  /** 右内容滚动容器：切分区 / 切插件子段时回到顶部（内容整块换血，不留旧滚动位） */
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [zone, pluginSub]);

  // 打开时实时读一次日志条数（抽屉每次打开都刷新，避免静态旧值）
  const count = useMemo(() => dump().length, [open]);

  // —— v0.6 · T13：Agent 席位明示（B5：只展示不拦截）+ 本地库占用量 ——
  const members = useMembersStore((st) => st.members);
  const agentSeatUsed = members.filter((m) => m.actorKind === 'agent').length;
  const agentSeatOver = agentSeatUsed > AGENT_SEAT_LIMIT;
  const repos = useRepos();
  // 本地库占用：每次打开抽屉时估算一次（打开期间不轮询，展示用途足够）
  const [dbUsage, setDbUsage] = useState<LocalDbUsage | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void estimateLocalDbUsage(async () => {
      const projects = await repos.projects.list();
      const stages = (
        await Promise.all(projects.map((pj) => repos.stages.listByProject(pj.id)))
      ).flat();
      return {
        projects,
        stages,
        tasks: await repos.tasks.list(),
        members: await repos.members.list(),
      };
    }).then((u) => {
      if (!cancelled) setDbUsage(u);
    });
    return () => {
      cancelled = true;
    };
  }, [open, repos]);

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

  // 主题三选控件
  const themeOptions = [
    { key: 'light' as const, label: '浅色', icon: <Sun size={15} aria-hidden /> },
    { key: 'dark' as const, label: '深色', icon: <Moon size={15} aria-hidden /> },
    { key: 'system' as const, label: '跟随系统', icon: <Monitor size={15} aria-hidden /> },
  ];

  const onExport = (): void => {
    const n = io.export();
    onClose();
    toast('success', `日志已导出（${n} 条）`);
  };

  const onClear = (): void => {
    clearLogs();
    setConfirmClearOpen(false);
    logUser('设置', '清空日志');
    toast('success', '日志已清空');
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        placement="left-rail"
        railLeft={`${railLeftPx}px`}
        ariaLabel="设置"
      >
        {/*
          v0.8.6.0002 · 反馈 #1：贴侧栏右缘展开的全高抽屉（左缘 = 侧栏右缘，
          侧栏不被遮罩压住、保持可见可点）。
          · ≥xl：遮罩 left = 侧栏宽（展开 240 / 收起 64，见 railLeftPx），
            抽屉宽 640 紧随其后；<xl：railLeft=0 ⇒ 全屏（该档无持久侧栏）
          · 贴顶栏底缘全高（Modal 抽屉族几何：p-0 + items-stretch），不再有
            max-h/圆角被裁的旧问题——高度就是遮罩可用高度
          · 圆角只留右缘（左缘贴侧栏，视觉上是侧栏的延伸）；glass-strong 自带描边与底色
          · v0.8.6 · 反馈 #7：头部之下改「左导航 168 + 右内容」双栏（≥xl 竖排导航；
            <xl 导航退化顶部横向条），主体滚动收进右栏（min-h-0 overflow-y-auto）
          · drawer-in-left：从左缘 24px 滑入，200ms ease-out（克制；reduced-motion 已关停）
          · data-settings-drawer：真几何验收钩子（新增，不动任何既有 data-/aria 钩子）
        */}
        <div
          data-settings-drawer=""
          className="drawer-in-left glass-strong flex h-full w-[640px] max-w-[100vw] flex-col rounded-r-2xl max-xl:w-full"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-pine" aria-hidden />
              <h2 className="font-display text-base font-semibold text-ink">设置</h2>
              {/* Beta 标记（v0.7）：与侧栏品牌同款徽标，提示内测版本 */}
              <span
                title="内测版本"
                className="inline-flex h-[18px] shrink-0 items-center rounded-sm bg-pine-soft px-1.5 text-[10px] font-medium text-pine"
              >
                Beta
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭设置"
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
              aria-label="设置分区"
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-2 xl:w-[168px] xl:flex-col xl:overflow-y-auto xl:border-b-0 xl:border-r xl:px-3 xl:py-4"
            >
              {visibleZones.map((z) => {
                const active = zone === z.key;
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
                    <span className="whitespace-nowrap">{z.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* 右内容（当前分区；切换分区即整块换血，滚动位置随之重置） */}
            <div
              ref={panelRef}
              data-settings-zone-panel={zone}
              className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
            >
              {/* ① 外观 */}
              {zone === 'appearance' && (
                <>
                  {/* 主题区（从原一列到底首屏迁入） */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Sun size={14} className="text-mist" aria-hidden />
                        主题
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
                    <p className="mt-1.5 text-xs text-mist">
                      选「跟随系统」后，应用随系统深色 / 浅色设置实时变化。
                    </p>
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

              {/* ② 排程 */}
              {zone === 'schedule' && (
                <>
                  {/* 休息制度区（嵌入原 RestPolicyDialog 编辑主体）——仅管理员可见 */}
                  {isAdmin && (
                    <section>
                      <div className="mb-2 flex items-center gap-1.5">
                        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                          <Settings size={14} className="text-mist" aria-hidden />
                          休息制度
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
                  */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <CalendarDays size={14} className="text-mist" aria-hidden />
                        排期基准
                      </h3>
                    </div>
                    <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                      排期基准（自然日 / 工作日）是<strong className="text-ink">项目级</strong>
                      设置：新建项目时在阶段选择里指定，之后随该项目保存，本页没有全局默认项。
                      月历以周一为一周起始，当前不可切换。
                    </p>
                  </section>
                </>
              )}

              {/* ③ 数据与备份（反馈 #7：备份是高频路径，排第 3 区） */}
              {zone === 'data' && (
                <>
                  {/* 数据存放说明（一句人话：桌面=本机 / NAS=你的 NAS） */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Database size={14} className="text-mist" aria-hidden />
                        数据存在哪
                      </h3>
                    </div>
                    <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                      {appEnv.dataSource === 'remote' ? (
                        <>
                          你的数据存放在<strong className="text-ink">你的 NAS</strong>（服务地址：
                          <span className="font-mono text-ink">{appEnv.apiBaseUrl || '（未配置）'}</span>
                          ）。备份是 JSON 文件，保存在你自己选的位置。
                        </>
                      ) : (
                        <>
                          你的数据存放在<strong className="text-ink">本机</strong>
                          （这台电脑的应用数据里，不上传）。备份是 JSON 文件，保存在你自己选的位置。
                        </>
                      )}
                    </p>
                  </section>

                  {/* 备份两枚（与侧栏 / ⋮ 菜单同一份 useBackupIo 实现，零新逻辑） */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <FileJson size={14} className="text-mist" aria-hidden />
                        备份
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void save()}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand"
                      >
                        保存备份
                      </button>
                      <button
                        type="button"
                        onClick={pick}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line px-4 py-2.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
                      >
                        导入备份
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-mist">
                      保存备份 = 导出全部数据为 JSON 文件；导入备份 = 从 JSON 文件
                      整体替换当前全部数据（不可撤销，恢复前建议先留档）。
                    </p>
                  </section>

                  {/* 日志区（原底部固定操作区的两枚按钮随迁本区，行为不变） */}
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Database size={14} className="text-mist" aria-hidden />
                        前端日志
                      </h3>
                      <span className="rounded-md bg-cream px-2 py-0.5 text-xs text-mist">
                        {count} 条
                      </span>
                    </div>

                    {count === 0 ? (
                      <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                        暂无日志。日志默认在{' '}
                        <strong className="text-ink">报错时</strong>或{' '}
                        <strong className="text-ink">执行关键操作</strong>（身份切换、备份导入导出）时
                        才记录。正常浏览页面不会有日志，属正常现象。遇到"输入法打不出字"这类问题时，
                        请先复现一次再回来导出。
                      </p>
                    ) : (
                      <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                        已记录 <strong className="text-ink">{count}</strong> 条运行事件，可导出为 .log
                        文件发给开发。日志仅含运行记录与错误堆栈，不含项目/客户业务数据。
                      </p>
                    )}

                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={onExport}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand"
                      >
                        <FileDown size={15} className="text-mist" aria-hidden />
                        导出日志
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearOpen(true)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line px-4 py-2.5 text-sm text-mist transition-colors hover:bg-sand hover:text-clay"
                      >
                        <Trash2 size={15} className="text-mist" aria-hidden />
                        清空日志
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
                          更新
                        </h3>
                      </div>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => void check()}
                          disabled={status === 'checking'}
                          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {status === 'checking' ? '检查中…' : '检查更新'}
                        </button>

                        {status === 'up-to-date' && (
                          <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-2.5 text-xs text-mist">
                            已是最新版本（{BUILD_VERSION}）。
                          </p>
                        )}
                        {status === 'has-update' && payload && (
                          <div className="rounded-xl border border-clay/40 bg-clay-soft px-3.5 py-2.5 text-xs">
                            <p className="font-medium text-clay-deep">发现新版本 {payload.latest}</p>
                            <a
                              href={payload.exeAssetUrl || payload.releaseUrl || REPO_URL}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-pine underline-offset-2 hover:underline"
                            >
                              前往下载
                            </a>
                          </div>
                        )}
                        {status === 'error' && (
                          <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-2.5 text-xs text-mist">
                            检查失败：{error}
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}

              {/*
                ④ 插件（含 Agent 与自动化子段）——v0.8.6.0002 图 5 第 1 点：
                「Agent 与自动化的设置应该是在插件里面，它属于插件的设置，
                和插件不应该是平级关系」。一级分区只有「插件」一枚，顶部两段
                子导航（插件 / Agent 与自动化）把 Agent 三项收成它的二级。
              */}
              {zone === 'plugins' && (
                <>
                  {/* 插件区二级导航（ segmented 两段；role=tablist 供验收与读屏） */}
                  <div
                    role="tablist"
                    aria-label="插件分区"
                    className="flex gap-1 rounded-[10px] border border-line bg-cream/50 p-1"
                  >
                    {PLUGIN_SUBS.map((s) => {
                      const active = pluginSub === s.key;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          data-plugins-subtab={s.key}
                          onClick={() => setPluginSub(s.key)}
                          className={cn(
                            'flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors outline-none',
                            'focus-visible:ring-2 focus-visible:ring-pine/40',
                            active
                              ? 'bg-paper text-ink shadow-soft'
                              : 'text-mist hover:bg-sand hover:text-ink',
                          )}
                        >
                          <s.Icon size={13} aria-hidden />
                          <span className="whitespace-nowrap">{s.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 子段一：插件（v0.8.6 阶段 1 · 她要求「插件要能手动在设置里面去开关」；
                      L2「从文件安装」+ 卸载/启用前披露同在此区） */}
                  {pluginSub === 'plugins' && <PluginsSection />}

                  {/*
                    子段二：Agent 与自动化（原一级分区整体迁入，内容零改动）。
                    v0.6 · T13：席位明示（B5：只展示不拦截）+ 本地库占用。
                  */}
                  {pluginSub === 'agent' && (
                    <>
                      {/* Agent 与本地库区（v0.6 · T13：席位明示 + 库占用，只展示不拦截） */}
                      <section>
                        <div className="mb-2 flex items-center gap-1.5">
                          <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                            <Database size={14} className="text-mist" aria-hidden />
                            Agent 与本地库
                          </h3>
                        </div>
                        <div className="rounded-[10px] border border-line bg-cream/50 px-3 py-2.5 text-xs leading-6">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-mist">Agent 席位</span>
                            <span className="font-mono text-ink">
                              已用 {agentSeatUsed}/{AGENT_SEAT_LIMIT}
                            </span>
                          </div>
                          {agentSeatOver && (
                            <p className="text-[11px] text-amber">
                              已超出免费席位额度（{AGENT_SEAT_LIMIT} 个）——不影响使用，仅作提示。
                            </p>
                          )}
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-mist">本地库占用</span>
                            <span className="font-mono text-ink">
                              {dbUsage ? formatBytes(dbUsage.bytes) : '—'}
                              {dbUsage && dbUsage.source === 'serialization-fallback' && (
                                <span className="ml-1 text-[10px] text-mist">（估算）</span>
                              )}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-mist">
                            未来单库超过约 50MB 时会在此提示清理 / 分库建议。
                          </p>
                        </div>
                      </section>

                      {/*
                        自然语言通道（说明性条目，不重复数据）：接入凭据的生成/管理在
                        Agent 看板的接入面板——那边是工作流现场，设置里只讲清口径。
                      */}
                      <section>
                        <div className="mb-2 flex items-center gap-1.5">
                          <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                            <Bot size={14} className="text-mist" aria-hidden />
                            自然语言通道
                          </h3>
                        </div>
                        <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                          外部 Agent 通过本机回环地址以<strong className="text-ink">结构化命令</strong>
                          接入 ID Plan；自然语言由 Agent 侧自己解析——ID Plan 不解析自然语言、不调用大模型。
                          接入地址与访问令牌在 Agent 看板的接入面板里生成与管理，此处不重复。
                        </p>
                      </section>

                      {/* Agent 看板入口（说明性：数据不复制进设置，点它去现场） */}
                      <section>
                        <div className="mb-2 flex items-center gap-1.5">
                          <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                            <Bot size={14} className="text-mist" aria-hidden />
                            Agent 看板
                          </h3>
                        </div>
                        <p className="mb-2 rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
                          Agent 看板是 AI 工作区：执行记录、接入面板与任务队列都在那里。
                        </p>
                        <Link
                          to="/agent"
                          onClick={onClose}
                          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand"
                        >
                          <Bot size={15} className="text-mist" aria-hidden />
                          打开 Agent 看板
                        </Link>
                      </section>
                    </>
                  )}
                </>
              )}

              {/* ⑤ 行业与模板（仅管理员：反馈 #11 成员身份下整分区不渲染） */}
              {zone === 'industry' && isAdmin && <CustomLibrarySection />}

              {/* ⑥ 关于 */}
              {zone === 'about' && (
                <>
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Database size={14} className="text-mist" aria-hidden />
                        关于
                      </h3>
                    </div>
                    <dl className="space-y-1.5 rounded-[12px] border border-line bg-cream/40 px-3.5 py-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">版本号</dt>
                        <dd className="font-medium text-ink">{BUILD_VERSION}</dd>
                      </div>
                      {/* 开源许可（MIT，仓库根 LICENSE）——反馈 #7 分区方案里「关于」区的明列项 */}
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">开源许可</dt>
                        <dd className="text-ink">MIT</dd>
                      </div>
                      {/* 内测提示（v0.7）：与标题 Beta 徽标呼应，克制地说明版本状态 */}
                      <p className="pt-0.5 text-[11px] leading-relaxed text-mist">
                        内测版本，功能与数据格式仍可能调整。
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">前端</dt>
                        <dd className="text-ink">{FRONTEND_STACK}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-mist">打包</dt>
                        <dd className="text-ink">{buildDate}</dd>
                      </div>
                    </dl>

                    <p className="mt-1.5 text-[11px] text-mist">
                      如有 bug 请提交 GitHub Issue：
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
                    赞赏与反馈（两张预留卡）：微信图由产品负责人后续提供，卡上标「图片待补」。
                  */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Heart size={14} className="text-mist" aria-hidden />
                        赞赏与反馈
                      </h3>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ReservedCard title="赞赏支持" icon={Heart} />
                      <ReservedCard title="反馈建议" icon={MessageSquare} />
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
        title="清空日志"
        confirmText="清空"
        onConfirm={onClear}
        onCancel={() => setConfirmClearOpen(false)}
      >
        <p>
          将清空当前 <strong>{count}</strong> 条前端日志。此操作不可恢复，如需排查问题建议先导出。
        </p>
      </ConfirmDialog>

      {/* 备份导入的隐藏 file input + 覆盖式恢复二次确认（与侧栏同一份 useBackupIo 逻辑） */}
      {fileInput}
      {confirmDialog}
    </>
  );
}
