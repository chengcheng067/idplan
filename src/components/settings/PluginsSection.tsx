/**
 * 设置 · 插件面板（v0.8.6 阶段 1 · 她 10-04 明确要求「插件要能手动在设置里面去开关」）
 *
 * ── 这个面板守什么 ──
 * ① **开关本身**：每个插件一枚 Switch，停用立刻生效（写 settings KV ⇒ 刷新不丢）
 * ② **来源分层**：builtin（随包分发）与 member（成员自装）在**视觉上可分**——
 *    左竖条 + 底色退一档（设计师：来源与能力两条轴正交，来源只用形态不用徽章）
 * ③ **生效面说明**：每个插件写清「它贡献什么」（路由/侧栏入口/设置区块），
 *    停用后这些都不出现——不是「藏起来」，是从注册表里摘掉
 * ④ **默认态可见**：没动过的插件显示「默认启用/默认停用」，免得用户以为开关失灵
 *
 * ── v0.8.6 · L2「从文件安装」新增 ──
 * ⑤ **安装**：「从文件安装」选 manifest.json ⇒ 披露对话框（诚实说清：代码来自
 *    你选的文件、只读数据、**可以访问网络**、重启生效）⇒ 校验落盘 ⇒ 强制写
 *    启用 KV = false（id 复用不继承旧插件的启用态）⇒ 重启后出现在列表里；
 * ⑥ **卸载**：二次确认 ⇒ 先停用（iframe 走完整 unmount 握手）⇒ 删目录 ⇒ 写
 *    启用 KV = false ⇒ 重启后从列表消失；
 * ⑦ **首次启用也要披露**：手动拷进 userData/plugins 的插件绕过了安装披露，
 *    所以「启用中 + 已安装 + 从未确认过」三者同时成立时，拨开关前再问一次；
 *    确认标记存 localStorage（`idplan.pluginAck.<id>`）——它是本机同意记录，
 *    不该进备份、也不该跟 ID 走。
 *
 * 零新 token：pine（已启用）/ mist（未启用）/ clay（错误）/ amber（需注意）。
 */

import { useMemo, useState } from 'react';
import { Check, FolderInput, Loader2, Puzzle, Trash2, X } from 'lucide-react';

import { ConfirmDialog } from '../common/ConfirmDialog';
import { usePluginRegistry } from '../../core/plugin/PluginRegistryProvider';
import type { PluginManifest } from '../../core/plugin/types';
import { isDesktop } from '../../lib/desktopBridge';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../store/useProjectsStore';

/** 本机「启用前已披露」同意标记（localStorage：不进备份、不跟 ID 走） */
const ACK_PREFIX = 'idplan.pluginAck.';
function ackKey(pluginId: string): string {
  return ACK_PREFIX + pluginId;
}
function hasAck(pluginId: string): boolean {
  try {
    return localStorage.getItem(ackKey(pluginId)) === '1';
  } catch {
    return false;
  }
}
function writeAck(pluginId: string): void {
  try {
    localStorage.setItem(ackKey(pluginId), '1');
  } catch {
    /* 存储不可用：下次启用再问一次（同意记录丢了的代价是多问一次，可接受） */
  }
}

/** 插件贡献点的一句话概括（给用户看「停用它会少什么」）。 */
function contributionText(m: PluginManifest): string {
  const parts: string[] = [];
  if (m.routes?.length) parts.push(`${m.routes.length} 个页面`);
  if (m.nav?.length) parts.push(`${m.nav.length} 个侧栏入口`);
  if (m.settingsSlot) parts.push('设置区块');
  if (m.entry) parts.push('沙箱整页界面');
  return parts.length > 0 ? parts.join(' · ') : '无界面贡献（数据/工具类）';
}

/**
 * 能力行（v0.8.6 阶段 3）。**这一行是用户判断「能不能信这个插件」的关键**：
 * 只读插件写不了你的数据，第三方插件若有一天声明了写能力，会在这里显形。
 * v1 只存在 data.read 一种（写/网/文件保存都不在 v1，见 types.ts 的论证）。
 */
function capabilityText(m: PluginManifest): string {
  const caps = m.capabilities ?? [];
  if (caps.length === 0) return '无需任何数据能力';
  return caps.includes('data.read') ? '只读你的项目数据（不可写入）' : String(caps.join('、'));
}

function sourceLabel(m: PluginManifest): string {
  return m.source === 'builtin' ? '随包分发' : '成员自装';
}

/** 待处理的披露对话（安装 / 首次启用两种入口，同一份诚实文本） */
type PendingDisclosure = { kind: 'install'; filePath: string } | { kind: 'enable'; pluginId: string; name: string };

/** 披露对话框正文——v1 做不到的事一律直说，不做空头支票（网络出口尤其） */
function DisclosureBody({ pluginName }: { pluginName?: string }): JSX.Element {
  return (
    <>
      <p>
        你将要运行的代码来自<strong className="text-ink">你选择的文件</strong>
        {pluginName ? `（「${pluginName}」）` : ''}
        ——它只装在这台电脑上，也只在这台电脑上运行。
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>
          它可以<strong className="text-ink">只读</strong>你的项目数据（项目 / 阶段 / 任务），
          <strong className="text-ink">不可写入</strong>；
        </li>
        <li>它跑在沙箱里，摸不到你的其它数据（登录凭据、其它插件的数据它拿不到）；</li>
        <li>
          但它<strong className="text-clay">可以访问网络</strong>
          ——v1 未做出入口限制，请只装你信任的来源的插件；
        </li>
        <li>安装后重启生效；新插件默认关闭——「装」与「开」是两件事。</li>
      </ul>
    </>
  );
}

export function PluginsSection(): JSX.Element {
  const reg = usePluginRegistry();
  const toast = useProjectsStore((s) => s.pushToast);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDisclosure | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<{ id: string; name: string } | null>(null);

  const rows = useMemo(
    () =>
      reg.manifests.map((m) => ({
        manifest: m,
        ...reg.stateOf(m.id),
        installed: reg.installedIds.has(m.id),
      })),
    [reg],
  );

  const applyToggle = async (pluginId: string, next: boolean): Promise<void> => {
    setError(null);
    setBusyId(pluginId);
    try {
      // 写 settings KV 后再改内存 ⇒ 刷新/重启后状态保持
      await reg.setPluginEnabled(pluginId, next);
    } catch {
      setError('保存失败，开关未生效——请重试（本地存储可能不可写）');
    } finally {
      setBusyId(null);
    }
  };

  const onToggle = async (id: string, next: boolean): Promise<void> => {
    setNotice(null);
    // 首次启用已安装插件（本地无同意标记）⇒ 先披露再开（手动拷目录的插件绕过了安装披露）
    if (next && reg.installedIds.has(id) && !hasAck(id)) {
      setPending({ kind: 'enable', pluginId: id, name: reg.manifests.find((m) => m.id === id)?.name ?? id });
      return;
    }
    await applyToggle(id, next);
  };

  /* ── 安装链路 ── */

  const onInstall = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    const bridge = isDesktop() ? window.idplan?.pluginInstall : undefined;
    if (!bridge) {
      setError('当前运行环境不支持从文件安装（仅桌面版可用）');
      return;
    }
    const pick = await bridge.pickManifestFile();
    if (!pick.ok || pick.canceled || !pick.filePath) return; // 取消：静默
    setPending({ kind: 'install', filePath: pick.filePath });
  };

  const onDisclosureConfirm = async (): Promise<void> => {
    const p = pending;
    setPending(null);
    if (!p) return;
    const bridge = window.idplan?.pluginInstall;
    if (!bridge) {
      setError('当前运行环境不支持从文件安装（仅桌面版可用）');
      return;
    }
    if (p.kind === 'install') {
      setInstalling(true);
      try {
        const res = await bridge.installFromFile(p.filePath);
        if (!res.ok) {
          setError(`安装失败：${res.reason}`);
          return;
        }
        writeAck(res.manifest.id);
        // 强制写 false：id 复用 = 新插件，不继承上一个插件的启用态（探路实测风险）
        await reg.setPluginEnabled(res.manifest.id, false);
        setNotice(
          `已安装「${res.manifest.name}」v${res.manifest.version}（${res.fileCount} 个文件）——重启后生效，默认关闭`,
        );
        toast('success', `插件「${res.manifest.name}」已安装，重启后生效`);
      } catch {
        setError('安装失败：主进程未响应');
      } finally {
        setInstalling(false);
      }
      return;
    }
    // 首次启用：记录同意标记后照常开
    writeAck(p.pluginId);
    await applyToggle(p.pluginId, true);
  };

  /* ── 卸载链路 ── */

  const onUninstallConfirm = async (): Promise<void> => {
    const target = uninstallTarget;
    setUninstallTarget(null);
    if (!target) return;
    setError(null);
    setNotice(null);
    setBusyId(target.id);
    try {
      // 先停用（iframe 走完整 unmount 握手）再删目录——反序会让跑着的插件指向已删文件
      await reg.setPluginEnabled(target.id, false);
      const res = await window.idplan?.pluginInstall?.uninstall(target.id);
      if (!res || !res.ok) {
        setError(`卸载失败：${res?.reason ?? '主进程未响应'}`);
        return;
      }
      setNotice(`已卸载「${target.name}」——重启后从列表消失`);
      toast('success', `插件「${target.name}」已卸载`);
    } catch {
      setError('卸载失败：主进程未响应');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Puzzle size={14} className="text-mist" aria-hidden />
          插件
        </h3>
        <span className="text-[11px] text-mist">
          已装 {rows.length} · 启用 {rows.filter((r) => r.enabled).length}
        </span>
      </div>

      <div className="rounded-[10px] border border-line bg-cream/50 px-3 py-2.5">
        <p className="mb-2 text-[11px] leading-relaxed text-mist">
          插件是可**单独开关**的功能包。停用后它的页面、侧栏入口与设置区块会立即消失
          （数据保留，重新启用即恢复）。开关状态存在本地/NAS 设置里，重启不丢。
          第三方插件可从文件安装（重启生效、默认关闭、装前会把权限摊给你看）。
        </p>

        {isDesktop() && (
          <button
            type="button"
            data-plugin-install=""
            onClick={() => void onInstall()}
            disabled={installing}
            className={cn(
              'mb-2 flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5',
              'text-[11px] text-mist transition-colors hover:bg-sand hover:text-ink',
              'outline-none focus-visible:ring-2 focus-visible:ring-pine/40 disabled:opacity-50',
            )}
          >
            {installing ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <FolderInput size={12} aria-hidden />}
            从文件安装
          </button>
        )}

        {error && (
          <p className="mb-2 rounded-md border border-clay/40 bg-clay/5 px-2 py-1 text-[11px] text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-2 rounded-md border border-pine/40 bg-pine/5 px-2 py-1 text-[11px] text-pine">
            {notice}
          </p>
        )}
        {reg.skippedPlugins.length > 0 && (
          <p className="mb-2 text-[10px] text-amber">
            有 {reg.skippedPlugins.length} 个本地插件目录未加载（manifest 不完整或版本不兼容），已跳过。
          </p>
        )}

        <ul className="divide-y divide-line">
          {rows.map(({ manifest, enabled, explicit, installed }) => {
            const busy = busyId === manifest.id;
            return (
              <li
                key={manifest.id}
                data-plugin-row={manifest.id}
                className={cn(
                  'flex items-start gap-2.5 py-2.5',
                  // 来源分层：member 自装插件左竖条（设计师规范：来源只用形态）
                  manifest.source === 'member' && 'border-l-2 border-line pl-2',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{manifest.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-mist">
                      v{manifest.version} · {sourceLabel(manifest)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-mist">{manifest.summary}</p>
                  <p className="mt-0.5 text-[10px] text-mist">
                    能力：{capabilityText(manifest)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-mist">
                    贡献：{contributionText(manifest)}
                    {!explicit && (
                      <span className="ml-1.5 text-mist/80">
                        （尚未手动设置 · 默认{enabled ? '启用' : '停用'}）
                      </span>
                    )}
                  </p>
                </div>

                {/* 卸载：仅「从文件安装」的插件有（内置随包插件不给卸） */}
                {installed && (
                  <button
                    type="button"
                    aria-label={`卸载插件 ${manifest.name}`}
                    data-plugin-uninstall={manifest.id}
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setUninstallTarget({ id: manifest.id, name: manifest.name });
                    }}
                    className={cn(
                      'mt-0.5 shrink-0 rounded-md p-1.5 text-mist transition-colors',
                      'hover:bg-clay/10 hover:text-clay',
                      'outline-none focus-visible:ring-2 focus-visible:ring-clay/40 disabled:opacity-50',
                    )}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}

                {/* 开关：button + aria-pressed（键盘可达；不用裸 checkbox 以保证样式一致） */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? '停用' : '启用'}插件 ${manifest.name}`}
                  disabled={busy}
                  data-plugin-toggle={manifest.id}
                  onClick={() => void onToggle(manifest.id, !enabled)}
                  className={cn(
                    'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors',
                    'outline-none focus-visible:ring-2 focus-visible:ring-pine/40 disabled:opacity-50',
                    enabled ? 'border-pine bg-pine' : 'border-line bg-sunken',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-all',
                      'flex items-center justify-center',
                      enabled ? 'left-[18px] bg-paper' : 'left-0.5 bg-mist/60',
                    )}
                  >
                    {busy ? (
                      <Loader2 size={8} className="animate-spin text-ink/60" aria-hidden />
                    ) : enabled ? (
                      <Check size={8} className="text-pine" aria-hidden />
                    ) : (
                      <X size={8} className="text-paper" aria-hidden />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {rows.length === 0 && (
          <p className="py-3 text-center text-[11px] text-mist">这个构建没有附带任何插件。</p>
        )}
      </div>

      {/* 安装 / 首次启用前披露（同一份诚实文本：只读、沙箱、网络出口开着、重启生效） */}
      <ConfirmDialog
        open={pending !== null}
        title="运行来自文件的代码"
        confirmText="我信任这个文件，继续"
        cancelText="取消"
        onConfirm={() => void onDisclosureConfirm()}
        onCancel={() => setPending(null)}
      >
        <DisclosureBody pluginName={pending?.kind === 'enable' ? pending.name : undefined} />
      </ConfirmDialog>

      {/* 卸载二次确认（删目录不可恢复） */}
      <ConfirmDialog
        open={uninstallTarget !== null}
        title="卸载插件"
        confirmText="卸载"
        danger
        onConfirm={() => void onUninstallConfirm()}
        onCancel={() => setUninstallTarget(null)}
      >
        <p>
          将删除「<strong>{uninstallTarget?.name}</strong>」的全部文件并停用它。此操作不可恢复，
          重启后它将从列表消失（它读过的数据不受影响——插件本来就写不了）。
        </p>
      </ConfirmDialog>
    </section>
  );
}
