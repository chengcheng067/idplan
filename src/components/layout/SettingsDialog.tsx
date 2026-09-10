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
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
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
      <Modal open={open} onClose={onClose} placement="right-float" ariaLabel="设置">
        <div className="glass-strong flex flex-col overflow-y-auto rounded-2xl border-white/40 max-h-[calc(100dvh-1.5rem)] w-full sm:max-h-[calc(100dvh-3rem)] sm:w-[400px] sm:self-start sm:mr-2 sm:mt-2">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-pine" aria-hidden />
              <h2 className="font-display text-base font-semibold text-ink">设置</h2>
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
