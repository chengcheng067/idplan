import { useEffect, useMemo, useState } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
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
import { useLayoutStore } from '../../store/useLayoutStore';
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
 * 新形态：`Modal placement="left"`，抽屉从**窗口左缘**滑出、盖住侧栏、贴顶栏
 * 底缘全高展开（遮罩让位见 Modal.tsx 的 top-14 xl:top-16）。宽 640（≥xl），
 * <xl 近全屏（calc(100vw - 2rem)）。`anchor` 形参整个删除：新形态下锚点无意义
 * （Sidebar / MobileMoreMenu 两处调用点的 settingsAnchor state 同步移除）。
 *
 * ── v0.8.6 · 反馈 #7：分区重构（一列到底 → 左导航六区双栏）──
 * 她的原话：「设置里面有非常混乱每个部分应该属于哪一个栏，这些都是看不清楚的」，
 * 并授权「按我们软件自己的需求分区，不必对齐 ID-Aura」。分区顺序（即导航顺序）：
 *   ① 外观        主题 / 侧栏默认形态
 *   ② 排程        休息制度（管理员）/ 排期口径说明（项目级）
 *   ③ 数据与备份  保存·导入备份 / 日志导出 / NAS 服务 / 检查更新 / 数据存放说明
 *   ④ Agent 与自动化  插件开关 / Agent 席位与本地库 / 自然语言通道 / Agent 看板入口
 *   ⑤ 行业与模板  行业库（自定义包三步流）
 *   ⑥ 关于        版本 / 开源许可 / Issue / 赞赏与反馈预留卡
 * 「数据与备份」排第 3 是刻意的：她在 0.8.6.0001 说过「导入备份没有看到在哪里」——
 * 备份是高频路径，不能埋在最后。
 *
 * 实现纪律（本轮只搬位置 + 补分区结构，不动设置项自身的 DOM/文案/钩子）：
 *   - 每个既有 Section 组件（CustomLibrary / Plugins / NasService / RestPolicyEditor）
 *     原样搬进对应分区，内部零改动；
 *   - 左导航 168（≥xl 竖排）；<xl 退化为顶部横向条（overflow-x-auto），不断裂；
 *   - 右内容区 flex-1 min-h-0 overflow-y-auto（沿用抽屉既有滚动底子）；
 *   - data-settings-drawer 几何钩子保持；导航与分区面板用 data-settings-zone /
 *     data-settings-zone-panel 两条新钩子供验收，既有 data- 属性与 aria 一律不动。
 */

/** 六个分区（反馈 #7）。顺序即导航顺序；key 同时是导航钩子值。 */
type ZoneKey = 'appearance' | 'schedule' | 'data' | 'agent' | 'industry' | 'about';

const ZONES: ReadonlyArray<{ key: ZoneKey; label: string; Icon: LucideIcon }> = [
  { key: 'appearance', label: '外观', Icon: Sun },
  { key: 'schedule', label: '排程', Icon: CalendarDays },
  { key: 'data', label: '数据与备份', Icon: Database },
  { key: 'agent', label: 'Agent 与自动化', Icon: Bot },
  { key: 'industry', label: '行业与模板', Icon: FileJson },
  { key: 'about', label: '关于', Icon: Info },
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
  // 仅桌面端生效：浏览器/NAS 端 isDesktop() 为 false，下方更新区整块不渲染、从不发起请求。
  const { status, payload, error, check } = useUpdateCheck();
  /** 当前所在分区（反馈 #7：默认「外观」——最轻、最高频的一项） */
  const [zone, setZone] = useState<ZoneKey>('appearance');

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

  // 侧栏默认形态（v0.7 · D3 持久化偏好）：此前只能通过侧栏折叠开关触达，
  // 反馈 #7 盘点后收进「外观」区；与侧栏开关共用同一 store 字段，不新造状态。
  const sidebarExpanded = useLayoutStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = useLayoutStore((s) => s.setSidebarExpanded);

  // 打包日期（构建时静态快照，便于排查版本）
  const buildDate = new Date().toISOString().slice(0, 10);

  // 主题三选控件
  const themeOptions = [
    { key: 'light' as const, label: '浅色', icon: <Sun size={15} aria-hidden /> },
    { key: 'dark' as const, label: '深色', icon: <Moon size={15} aria-hidden /> },
    { key: 'system' as const, label: '跟随系统', icon: <Monitor size={15} aria-hidden /> },
  ];

  // 侧栏默认形态两选控件（与主题三选同一形态语言：按压块 + pine 选中态）
  const sidebarOptions = [
    { key: true as const, label: '展开', icon: <PanelLeftOpen size={15} aria-hidden /> },
    { key: false as const, label: '折叠', icon: <PanelLeftClose size={15} aria-hidden /> },
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
      <Modal open={open} onClose={onClose} placement="left" ariaLabel="设置">
        {/*
          v0.8.6 · 反馈 #4：从窗口左缘滑出的全高抽屉，盖住侧栏。
          · 宽 640（≥xl 分栏预留）；<xl 全屏（该档无持久侧栏，抽屉即主视野）
          · 贴顶栏底缘全高（Modal left 档几何：p-0 + items-stretch），不再有
            max-h/圆角被裁的旧问题——高度就是遮罩可用高度
          · 圆角只留右缘（左缘贴窗口边，滑出来源）；glass-strong 自带描边与底色
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
              {ZONES.map((z) => {
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

                  {/* 侧栏默认形态（反馈 #7 盘点补收：此前只有侧栏上一枚折叠开关） */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5">
                      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <PanelLeftOpen size={14} className="text-mist" aria-hidden />
                        侧栏
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      {sidebarOptions.map((o) => {
                        const active = sidebarExpanded === o.key;
                        return (
                          <button
                            key={o.label}
                            type="button"
                            onClick={() => setSidebarExpanded(o.key)}
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
                      宽屏（≥xl）下侧栏的默认形态；窄屏侧栏收在抽屉里，与本设置无关。
                      侧栏上的折叠开关随时可改，改动立即生效并记住。
                    </p>
                  </section>
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

              {/* ④ Agent 与自动化 */}
              {zone === 'agent' && (
                <>
                  {/* 插件区（v0.8.6 阶段 1 · 她要求「插件要能手动在设置里面去开关」） */}
                  <PluginsSection />

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

              {/* ⑤ 行业与模板 */}
              {zone === 'industry' && <CustomLibrarySection />}

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
