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
 * ── v1.0 · 反馈「每一个插件都应该有自己对应的设置，它应该是在自己的板块里面」──
 * ⑧ **每张卡一枚齿轮**：设置不再是「插件区里的一个二级分组」（那套 `plugins` /
 *    `agent` 两段子导航已整块拆掉，见 `SettingsDialog.tsx`），而是**每个插件
 *    自己的**——点某张卡上的齿轮，就地展开该插件的 `manifest.settingsSlot`。
 *    三条判据：
 *      · **不隐藏、只置灰**——`manifest.settingsSlot` 为空的插件（如
 *        `weekly-report`）齿轮置灰 `disabled`：「这个插件没有自己的设置」是
 *        一个**可被看见**的事实，藏起来会让人以为界面坏了。
 *      · 展开区就是 `PluginSettingsSlot`（`core/plugin/PluginRegistryProvider.tsx`），
 *        它自己判启用态：**插件停用 ⇒ 返回 null，设置随之消失**——这正好把本文件
 *        第 243 行那句「停用后……设置区块会立即消失」从空头支票变成真话。
 *      · 展开态是**本组件内的瞬态**（`useState`），不落 URL、不落 KV：它是「我此刻
 *        在看哪个插件的设置」，不是配置。同一时刻只展开一个（再点一次收起）。
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

import { useEffect, useMemo, useState } from 'react';
import { Check, FolderInput, Loader2, Puzzle, Settings, Trash2, X } from 'lucide-react';

import { ConfirmDialog } from '../common/ConfirmDialog';
import { PluginSettingsSlot, usePluginRegistry } from '../../core/plugin/PluginRegistryProvider';
import type { SetPluginEnabledResult } from '../../core/plugin/PluginRegistryProvider';
import type { PluginManifest } from '../../core/plugin/types';
import { isDesktop } from '../../lib/desktopBridge';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { appEnv } from '../../config/env';
import { API_TOKEN_KEY } from '../../core/repositories/remote/rest.client';
import { ChangxiaError, ChangxiaErrorCode } from '../../core/types/enums';

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

/**
 * 本浏览器是否配了 NAS 访问令牌。
 *
 * 判据与 **设置 → NAS 服务** 的「已配置」状态**同源同键**（`API_TOKEN_KEY`，
 * 见 `NasServiceSection.tsx` 的读取点）：那边只认 localStorage 手填值，这里也只认它。
 * 刻意不在这里再实现一遍「localStorage → VITE_API_TOKEN」的优先级 —— 那是
 * `createRemoteRepositories` 的职责，抄第二份必然漂移；而且两处显示的「是否已配置」
 * 应当一致，否则用户会在两个界面看到互相矛盾的结论。
 */
function hasStoredApiToken(): boolean {
  try {
    return (localStorage.getItem(API_TOKEN_KEY) ?? '').trim() !== '';
  } catch {
    return false;
  }
}

/**
 * 写入失败 → **如实**的文案（#17）。三类各自说各的，**不许**用一句通用话盖过两种原因。
 *
 * 事故形态（实测）：服务端配了 `IDPLAN_AGENT_TOKEN`、本浏览器没填令牌时，写 settings
 * 走 `PUT /api/settings/:key`，被 `guardWrite` 401 掉；而旧文案写的是「本地存储可能
 * 不可写」，把用户送去查一个**完全不相干**的东西。误导性的错误文案比没有文案更坏。
 *
 * 分类依据（都能在客户端诚实拿到）：
 *   · `ChangxiaErrorCode.Storage` —— 本地仓储（Dexie）写失败。**只有这一类**才配说
 *     「本地存储不可写」。
 *   · `ChangxiaErrorCode.Network` —— rest.client 把「连不上」与「HTTP 非 2xx（含 401）」
 *     都归到这一码。若本机是 remote(NAS) 形态**且**没填令牌，那最可能的就是 401，
 *     这时给出「未配置访问令牌」并指到 **设置 → NAS 服务**（正确的去处）。
 *   · 其余（含无 Provider 的纯 Error）—— 原样带上 message，不做猜测。
 *
 * ⚠️ **已知上限**（如实登记，不要让它看起来比实际更准）：令牌**填了但不对**的 401
 * 与 5xx / 真连不上，在客户端**无法再分开** —— `rest.client.ts` 把 401 映射成
 * `Network` 并丢掉了服务端错误体里结构化的 `error.code: 'Unauthorized'`。
 * 要精确到「401」需要在那张映射表里加一档（不在本次划给我的文件内）。
 */
function describeToggleFailure(err: unknown): string {
  if (err instanceof ChangxiaError) {
    if (err.code === ChangxiaErrorCode.Storage) {
      return '保存失败，开关未生效——本地存储不可写，请检查浏览器存储权限后重试';
    }
    if (err.code === ChangxiaErrorCode.Network) {
      if (appEnv.dataSource === 'remote' && !hasStoredApiToken()) {
        return '未配置访问令牌：本 NAS 的服务端要求写入携带访问令牌，请到 设置 → NAS 服务 填写后重试';
      }
      return `写入被服务端拒绝或服务端不可达：${err.userMessage}`;
    }
    return `保存失败，开关未生效：${err.userMessage}`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `保存失败，开关未生效：${msg}`;
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
  /**
   * 插件开关 = **本 NAS/本机的全局设置**，不是个人偏好：一个人拨一下，所有人的侧栏
   * 与路由都跟着变。故只有管理员能改（G3 · 用户已拍板走「管理员策略」）。
   *
   * ⚠️ **这是 UI 半门，不是完整防护**：服务端 v1 没有角色概念（`PUT /api/settings/:key`
   * 只校验 Bearer 令牌，不认「谁」），所以绕过界面直接调 API 仍可写。真正的强制要等
   * 服务端有身份模型；在此之前这一层的作用是「不给成员一个会导致全局变化的按钮」，
   * 别把它当成权限系统。
   */
  const { isAdmin } = useRoleGuard();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDisclosure | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<{ id: string; name: string } | null>(null);
  /**
   * 此刻展开着谁的设置（`manifest.id`；null = 都收起）。
   * 瞬态、不落 URL / KV——「我正在看哪个插件的设置」是一种当下视图，不是配置。
   * 同一时刻只开一个：再点同一个齿轮即收起，点别的齿轮就换人。
   */
  const [openSettings, setOpenSettings] = useState<string | null>(null);

  /**
   * ── 打开设置时重读一次启用状态（G2）──
   * 注册表只在**启动**读过 settings KV（`PluginRegistryProvider` 的 hydrate effect），
   * 之后再不重读。于是另一个标签页 / 另一台设备改过的值，这边要刷新页面才看得到，
   * 而「基于旧快照的盲写」还会覆盖别人的改动（G1 拦下了写入，但看到旧值本身就够糟）。
   * 这里在**本区挂载时**（= 用户打开设置并切到「插件」）显式重读一次即可。
   *
   * 刻意**不**做轮询、不做全局订阅：插件开关是极低频设置，多读一次已经覆盖全部真实
   * 场景，持续订阅只是新的噪音源。依赖只有 `reloadEnabled`（身份稳定：`useCallback([repos])`），
   * 所以每个挂载周期只跑一次。
   */
  const reloadEnabled = reg.reloadEnabled;
  useEffect(() => {
    void reloadEnabled();
  }, [reloadEnabled]);

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
      // 先落库后改内存（写前还会做一次冲突校验，见 setPluginEnabled）
      const res: SetPluginEnabledResult = await reg.setPluginEnabled(pluginId, next);
      if (res.ok) return;
      setError(
        res.reason === 'conflict'
          ? '该设置已被其他设备修改，请刷新后重试（本次未写入，你看到的可能是别人的新值）'
          : describeToggleFailure(res.error),
      );
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
        const disabled = await reg.setPluginEnabled(res.manifest.id, false);
        if (!disabled.ok) {
          // 文件已落盘、状态没写成 ⇒ **不许**报告成完全成功：否则用户重启后发现
          // 新插件是启用着的，而界面说过「默认关闭」。
          setError(
            `「${res.manifest.name}」已安装，但「默认关闭」状态没写成：${
              disabled.reason === 'conflict'
                ? '该设置已被其他设备修改，请刷新后重试'
                : describeToggleFailure(disabled.error)
            }`,
          );
          return;
        }
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
      const disabled = await reg.setPluginEnabled(target.id, false);
      if (!disabled.ok) {
        // 停用没成功 ⇒ **中止卸载**（删了目录但插件还处于启用态 = 跑着的 iframe 指向已删文件）。
        // 这条中止语义与改造前一致：那时 setPluginEnabled 抛错，被下面的 catch 接住。
        setError(
          disabled.reason === 'conflict'
            ? '卸载已中止：该设置已被其他设备修改，请刷新后重试'
            : `卸载已中止——无法先停用这个插件：${describeToggleFailure(disabled.error)}`,
        );
        return;
      }
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
        {/*
          G4：这句原先写「停用后它的页面、侧栏入口**与设置区块**会立即消失」——**是假话**。
          设置区块（本轮起是「插件卡片上的齿轮 + 该插件自己的设置」）与这张列表同生共死：
          插件停用后卡片仍在列表里、齿轮也还在（置灰的判据只有「有没有声明 settingsSlot」），
          只是齿轮点开后是那句「当前是停用状态」的说明。**消失的是页面与导航入口。**
          假文案比没有文案更坏——它会让人以为「关掉插件后去设置里就找不到它了」。
        */}
        <p className="mb-2 text-[11px] leading-relaxed text-mist">
          插件是可**单独开关**的功能包。停用后它的页面与侧栏入口会立即隐藏
          （数据保留，重新启用即恢复）；插件卡片仍在下面的列表里，点它的齿轮可以看到
          它自己的设置。开关状态存在本地/NAS 设置里，重启不丢。
          第三方插件可从文件安装（重启生效、默认关闭、装前会把权限摊给你看）。
        </p>

        {/*
          G3：开关是**全局**设置（改它 = 改所有人的侧栏与路由），故仅管理员可拨。
          ⚠️ 服务端 v1 无角色概念 ⇒ 这是 **UI 半门**（见组件顶部注释），不是完整防护。
          文案放两处：这里一处可见说明（触屏也能看到）+ 每枚开关的 tooltip（鼠标可查）。
        */}
        {!isAdmin && (
          <p
            data-plugins-admin-notice=""
            className="mb-2 rounded-md border border-amber/40 bg-amber-soft px-2 py-1 text-[11px] text-amber"
          >
            插件开关是本 NAS 的全局设置，仅管理员可改；成员只能查看当前状态与各插件自己的设置。
          </p>
        )}

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
            /**
             * 这个插件有没有自己的设置区块（manifest 声明式给出，见 PluginManifest.settingsSlot）。
             * 没有 ⇒ 齿轮**置灰不隐藏**：「它没有自己的设置」是个该被看见的事实。
             */
            const hasOwnSettings = Boolean(manifest.settingsSlot);
            const settingsExpanded = openSettings === manifest.id;
            return (
              <li
                key={manifest.id}
                data-plugin-row={manifest.id}
                className={cn(
                  // 竖列：第一行是插件卡（原来的 `flex items-start gap-2.5` 原样收进内层），
                  // 第二行是展开的设置区。行布局因此零变化（min-w-0 flex-1 + 两枚按钮同轴）。
                  'flex flex-col py-2.5',
                  // 来源分层：member 自装插件左竖条（设计师规范：来源只用形态）
                  manifest.source === 'member' && 'border-l-2 border-line pl-2',
                )}
              >
                <div className="flex items-start gap-2.5">
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

                  {/*
                    齿轮（本插件自己的设置）：夹在卸载与开关之间。
                    `disabled` 的唯一判据 = 这个插件**声明了 settingsSlot 没有**——
                    置灰而不是隐藏，让「它没有自己的设置」可被看见。
                    没有另设「未启用也置灰」：那会把两个不同的事实压进同一个灰，
                    而且 `PluginSettingsSlot` 自己就会在插件停用时返回 null（见文件头 ⑧）。
                  */}
                  <button
                    type="button"
                    aria-label={`${manifest.name} 的设置`}
                    data-plugin-settings={manifest.id}
                    aria-expanded={hasOwnSettings ? settingsExpanded : undefined}
                    disabled={!hasOwnSettings}
                    title={hasOwnSettings ? `打开「${manifest.name}」自己的设置` : '这个插件没有自己的设置'}
                    onClick={() =>
                      setOpenSettings((cur) => (cur === manifest.id ? null : manifest.id))
                    }
                    className={cn(
                      'mt-0.5 shrink-0 rounded-md p-1.5 text-mist transition-colors',
                      'hover:bg-sand hover:text-ink',
                      'outline-none focus-visible:ring-2 focus-visible:ring-pine/40',
                      // 置灰态：cursor-not-allowed + 明确降透明度（与其余 disabled 同款 50%）
                      'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-mist',
                      settingsExpanded && hasOwnSettings && 'bg-pine-soft text-pine hover:text-pine',
                    )}
                  >
                    <Settings size={13} aria-hidden />
                  </button>

                  {/*
                    开关：button + aria-pressed（键盘可达；不用裸 checkbox 以保证样式一致）。
                    G3：`disabled` 的第二半是 `!isAdmin` —— 这是**全局**设置，不是个人偏好；
                    tooltip 说清原因（成员看得到状态，但拨不动）。
                  */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? '停用' : '启用'}插件 ${manifest.name}`}
                    disabled={busy || !isAdmin}
                    data-plugin-toggle={manifest.id}
                    title={isAdmin ? undefined : '插件开关是本 NAS 的全局设置，仅管理员可改'}
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
                </div>

                {/*
                  展开区 = 该插件**自己的**设置（`PluginSettingsSlot`）。
                  插件停用时该 Slot 返回 null（它自己判启用态，见 PluginRegistryProvider）
                  ⇒ 这里补一句人话把位置占住：否则「点了齿轮什么都没有」会被当成界面坏了，
                  而这正是本文件第 243 行「停用后……设置区块会立即消失」的行为化。
                */}
                {hasOwnSettings && settingsExpanded && (
                  <div
                    data-plugin-settings-panel={manifest.id}
                    className="mt-2.5 rounded-[10px] border border-line bg-cream/40 px-3 py-3"
                  >
                    {enabled ? (
                      <PluginSettingsSlot pluginId={manifest.id} />
                    ) : (
                      <p className="text-[11px] leading-relaxed text-mist">
                        「{manifest.name}」当前是停用状态——启用它之后，它自己的设置会出现在这里。
                      </p>
                    )}
                  </div>
                )}
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
