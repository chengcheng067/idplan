import { useMemo, useState } from 'react';

import { Database, FileDown, Monitor, Moon, Settings, Sun, Trash2, X } from 'lucide-react';

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
import { titleBarHeight } from '../../lib/topbarMetrics';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { NasServiceSection } from '../settings/NasServiceSection';
import { CustomLibrarySection } from '../settings/CustomLibrarySection';
import { RestPolicyEditor } from '../settings/RestPolicyDialog';
import { AGENT_SEAT_LIMIT } from '../../constants/agentTerms';
import { useMembersStore } from '../../store/useMembersStore';
import {
  estimateLocalDbUsage,
  formatBytes,
  type LocalDbUsage,
} from '../../lib/storage-estimate';
import { useEffect } from 'react';

/**
 * 「设置」面板（顶栏右侧 · 所有角色可见）。
 *
 * 用户反馈：导出日志按钮藏在顶栏一堆小图标里不明显，且第一次点总是提示「暂无日志」——
 * 因为日志系统是**被动记录**的，正常浏览不会有错误、日常操作也不会埋点，所以 0 条是常态。
 * 为让「导出日志」好找、且不至于每次都空，本面板：
 *   - 作为「设置」抽屉承载：导出日志、当前日志条数、清空日志；
 *   - 首屏显示日志条数，空时给引导提示文案（而不是裸的"暂无日志"）；
 *   - 后续设置项（主题、数据源等）可继续往这里收。
 *
 * 边界：所有角色可用（导出日志不限管理员，调试友好）。破坏性动作（清空日志）走二次确认。
 */
/**
 * Modal `right-float` 锚点容器在 **≥sm** 档的上/下内边距（Modal.tsx 的 `sm:p-6` = 24px）。
 * 桌面端窗口最小宽 960（electron/main.cjs 的 `minWidth`）⇒ 恒 ≥sm(640) ⇒ 该档即桌面端实际生效档。
 * 这个数字只用于「面板还要再让多少」，即 titleBarHeight() − 24；Modal 一改就要跟着改。
 */
const RIGHT_FLOAT_PADDING_SM = 24;

/**
 * 需要避让的原生标题栏高度（px）。0 = 无需避让（浏览器 / NAS 端 / 非 Windows 平台）。
 * 三键由系统绘制并**浮在网页内容之上**，不避让就会盖住浮层头部。
 */
function nativeTitleBarInset(): number {
  if (!isDesktop() || window.idplan?.platform !== 'win32') return 0;
  return titleBarHeight();
}

export function SettingsDialog({
  open,
  onClose,
  anchor = null,
}: {
  open: boolean;
  onClose(): void;
  /**
   * 触发点视口坐标（反馈 #3）：设置面板在**点击位置附近**展开，
   * 而不是固定在屏幕右侧。由打开它的入口（侧栏齿轮 / 移动端更多）传入。
   */
  anchor?: { x: number; y: number } | null;
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

  // 打包日期（构建时静态快照，便于排查版本）
  const buildDate = new Date().toISOString().slice(0, 10);

  /**
   * 原生标题栏占位高度（px，0 = 无需避让）。
   * 视口跨 xl 断点时 `titleBarHeight()` 会 56 ↔ 64 变（与 TopBar 的 h-14/xl:h-16 同口径），
   * 故监听 resize 重算一次——否则用户把窗口拉过 1280 后面板会被三键压掉 8px。
   */
  const [titleBarInset, setTitleBarInset] = useState(0);
  useEffect(() => {
    const sync = (): void => setTitleBarInset(nativeTitleBarInset());
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  /**
   * ⚠️ 锚定形态下**不再计算下移量**：面板纵向位置由锚定算法连同 `insetTop` 一起算
   * （见 Modal 的 float 分支），再叠一次 marginTop 会把面板推离点击处。
   * 旧的 `avoidTitleBarTop` 因此删除；`RIGHT_FLOAT_PADDING_SM` 仍参与 maxHeight 计算。
   */

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
      <Modal open={open} onClose={onClose} placement="float" anchor={anchor} ariaLabel="设置">
        {/*
          max-h 口径必须与 Modal 容器的 padding 口径**一致**，否则面板总高超出容器，
          底部圆角会被推出视口裁掉（v0.7 批次 A 修的「设置弹窗底部圆角丢失」）。
          容器现为：<sm `pt-[max(env(safe-area-inset-top),3rem)]`，≥sm `sm:p-6`（上下各 24）。
            · <sm  ：容器上下各占 3rem（48px）→ max-h 取 100dvh-1.5rem 的偏紧档
                     （手机上本就近全屏，留一点呼吸即可）
            · ≥sm  ：容器上下各 24px，共 3rem → `sm:max-h-[calc(100dvh-3rem)]` 恰好
                     顶到容器可用高度，圆角完整可见
          原实现把 `sm:mr-2 sm:mt-2` 叠在容器 sm:p-6 之上，等于又多让 8px 且只让右侧/顶部，
          破坏了「对称」这一修复目标，故一并去掉——间距统一由容器 sm:p-6 控制。
        */}
        <div
          className="glass-strong flex flex-col overflow-y-auto rounded-2xl border-white/40 max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-2rem)] max-w-[400px] sm:max-h-[calc(100dvh-3rem)]"
          /*
            ── 原生三键避让（仅 Windows 桌面端，其余环境 style 为 undefined）──
            ⚠️ 锚定形态下**不再给 marginTop**：面板的纵向位置已由锚定算法连同
              `insetTop` 一起算好（见 Modal 的 float 分支），再叠一次会把面板推离点击处。
            maxHeight 仍要扣掉这段，否则「避让 + 原 max-h」会超出视口，
              面板底部连圆角一起被裁出屏幕（批次 A 修过的同一个坑，不能重犯）。
              这里用内联值而不加 Tailwind 类，是因为类名不能动态拼接（本仓库 BUG-05：
              静态扫描的类名一旦拼接就整条不生成 CSS），而这里只有两个取值。
          */
          style={
            titleBarInset > 0
              ? { maxHeight: `calc(100dvh - ${titleBarInset + RIGHT_FLOAT_PADDING_SM}px)` }
              : undefined
          }
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

          {/* 内容 */}
          <div className="flex-1 space-y-5 px-5 py-5">
            {/* 日志区 */}
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
            </section>

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

            {/* 行业库区（v0.8.6 · 她反馈 #9：行业允许增加自定义） */}
            <CustomLibrarySection />

            {/* 主题区 */}
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
              授权区已于 0.8.1 移除（MIT 开源：commit 20c9183）——此处不留空壳组件，
              入口注释一并归档。人类侧设置区依次为：成员 / 休息制度 / NAS 服务 / 关于。
            */}
            {/* NAS 服务区（0.8.2.0002 备份事故修复）：仅 remote 数据源渲染，local/桌面整块不出现 */}
            <NasServiceSection />

            {/* 关于区 */}
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

              {/* 检查更新：仅 Windows 桌面端显示；浏览器/NAS 端 isDesktop() 为 false，整块不渲染 */}
              {isDesktop() && (
                <div className="mt-3 space-y-2">
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
              )}

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
          </div>

          {/* 底部操作 */}
          <div className="space-y-2.5 border-t border-line px-5 py-4">
            <button
              type="button"
              onClick={onExport}
              className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand"
            >
              <FileDown size={15} className="text-mist" aria-hidden />
              导出日志
            </button>
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line px-4 py-2.5 text-sm text-mist transition-colors hover:bg-sand hover:text-clay"
            >
              <Trash2 size={15} className="text-mist" aria-hidden />
              清空日志
            </button>
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
    </>
  );
}
