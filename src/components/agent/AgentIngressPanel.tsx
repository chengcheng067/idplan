/**
 * 外部写入方「接入配置面板」（v0.7 · T03 · P0-9 剩余部分 / PRD §4.8）。
 *
 * ── 本组件是**纯展示**（本批唯一形态）──
 * 它**不发任何网络请求、不 import 任何仓储、不 import `useAgentStore`**。
 * 面板需要的一切「外部事实」都从 props 进：
 *   · `probeResult` / `status` —— `probe()` / `status()` 的结果；
 *   · `onProbe` / `onSaveToken` / `onCopyToken` / `onAddressChange` —— 动作出海。
 * 真正的通道实现（`transport.contract.ts` + 主进程 loopback / NAS HTTP）在 T01 冻结
 * 契约、T03-B 落地后接上。**本批绝不给出「已连通」的假象**——面板内以说明行
 * 明确写出「当前状态由上层传入」。
 *
 * ── 为什么这样切（T03-A / T03-B 分工）──
 * 面板四件里**三件与契约无关**（地址、token、`isAdmin` 门控），可先落地并验证；
 * 剩一件（服务状态 / 最近同步记录）的**数据来自 `probe()`/`status()`**，其响应类型
 * 属 `transport.contract.ts`（§6.2：跨任务共享类型**全部在 T01 冻结**）。
 * 故本批只**接收**这些值，不自己调、不自己声明契约类型。
 *
 * ── 与「手动粘贴」是**两个入口**，不得合并（主 PRD §4.1 明定）──
 *   ① 本面板 = 外部 Agent 的**通道配置**（自动写入）；
 *   ② `ApplyPayloadPanel` = **离线兜底**的手动粘贴通道。
 * 二者共用同一份 payload schema，但入口语义不同。本面板只提供一个**跳转回调**
 * `onOpenManual`，绝不内嵌、绝不替代手动粘贴。
 *
 * ── 安全硬约束（不可协商，见 §3.4 / 本任务派单）──
 * **token 原文绝不回显**：写入后只显示「已配置」+ 复制按钮。
 *   · 输入框用 `type="password"` 且 `autoComplete="off"`（肩窥 / 浏览器自动填充泄漏）；
 *   · 保存成功后**立即清空**本地草稿态 —— 原文既不留在组件 state，也不留在 DOM；
 *   · 「复制」走 `onCopyToken()` **回调取件**，不经 DOM 读取。
 *   · 故 `useState` 里**只有草稿**，且草稿在一次保存后即消失；本组件**从不**接收
 *     token 原文作为 prop（props 只有布尔 `tokenConfigured`）。
 *
 * ── `isAdmin` 门控（§5.4 #16：成员看不到接入面板）──
 * 权限唯一出口 = `useRoleGuard()`（禁止自行比对 `roleKind`）。
 * ⚠️ `useRoleGuard()` **必须在所有条件 return 之前**调用（React #310：hook 数量
 * 在两次渲染间变化会整树白屏——本项目已因 hook 顺序栽过一次，见
 * `tests/stage-drawer-hook-order.spec.tsx`）。
 * 判定用 `isAdmin`（非管理员，含 `role === null` 未进入，**一律不可见**）——
 * 与 `isRestrictedView(role) === (role !== 'admin')` 同一语义。
 *
 * 零新色：只用既有 token（cream/paper/sunken/sand/line/ink/mist/pine/amber/clay/stage…）。
 * 圆角：本仓 `rounded-lg/xl/2xl` **全是 16px**（`tailwind.config.ts` 重映射过），
 * 12px 必须写 `rounded-md`（写 `rounded-xl` 以为 12 是本项目栽过的坑）。
 */

import { useState } from 'react';

import { Copy, Info, Plug, RefreshCw, X } from 'lucide-react';

import { useRoleGuard } from '../../hooks/useRoleGuard';
import { cn } from '../../lib/cn';

/**
 * 本机 loopback 地址（§3.4：Electron 严格绑 `127.0.0.1:17788`，**不绑** `0.0.0.0`）。
 * 本机档位下地址**只读**——它是主进程写死的事实，可编辑会误导用户以为改得动。
 */
export const LOOPBACK_ORIGIN = '127.0.0.1:17788';

/** 通道档位：本机 loopback（地址只读） / NAS 远程（地址可编辑） */
export type IngressChannelMode = 'local' | 'nas';

/**
 * 服务探测结果的**展示视图**（本批由上层传入）。
 *
 * ★ 这是 `transport.contract.ts`（T01 冻结）落地前的**占位视图类型**，
 * 字段名**全部取自设计**、未自行发挥：
 *   `ok` / `version` / `dataLayer` ← §3.2 `GET /api/agent/health` 响应；
 *   `seatUsed` / `seatLimit`       ← §3.2 的 `agentSeats: { used, limit }`；
 *   `projectCount`                 ← §3.2 的 `projects[]` 长度。
 * T03-B 接真通道时应改为从契约 re-export（或直接别名），届时本类型**删除**，
 * 避免出现「同一事实两处定义」。刻意只保留**面板真正渲染**的字段。
 */
export interface IngressProbeView {
  ok: boolean;
  version: string;
  /** §3.2：本机 loopback 形态附加；渲染窗口不存在时 `unavailable` */
  dataLayer?: 'ready' | 'unavailable';
  seatUsed?: number;
  seatLimit?: number;
  projectCount?: number;
}

/**
 * 最近同步记录的**展示视图**（字段名逐字取自 §T03 源文件行：
 * `status().lastSyncAt` / `status().lastSyncSummary`）。
 * 同为 `transport.contract.ts` 落地前的占位，见上。
 */
export interface IngressSyncView {
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
}

export interface AgentIngressPanelProps {
  /** 档位（受控）：本机 / NAS */
  mode: IngressChannelMode;
  onModeChange(next: IngressChannelMode): void;
  /** NAS 地址（受控）。本机档位下不使用此值，改显示只读 `LOOPBACK_ORIGIN` */
  address: string;
  onAddressChange(next: string): void;

  /** token 是否已配置 —— **只传布尔，绝不传原文** */
  tokenConfigured: boolean;
  /** 写入 token。原文只经此回调出海；本组件不留存、不回显 */
  onSaveToken(token: string): void;
  /** 复制 token（回调取件，不经 DOM 读取） */
  onCopyToken(): void;

  /** 服务状态探测结果（未探测过 → null） */
  probeResult: IngressProbeView | null;
  /** 触发一次探测 */
  onProbe(): void;

  /** 最近同步记录（无记录 → null） */
  status: IngressSyncView | null;

  /** 「手动粘贴」入口（离线兜底；**另一个入口**，不合并） */
  onOpenManual(): void;

  onClose(): void;
}

/** 档位展示名（唯一出处，不在 JSX 里散写） */
const MODE_LABELS: Readonly<Record<IngressChannelMode, string>> = {
  local: '本机',
  nas: 'NAS',
};

const MODE_ORDER: readonly IngressChannelMode[] = ['local', 'nas'];

/** 时间戳 → 展示串（空值统一 `—`，不渲染 `null`/`Invalid Date`） */
function formatSyncAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return iso;
}

export function AgentIngressPanel({
  mode,
  onModeChange,
  address,
  onAddressChange,
  tokenConfigured,
  onSaveToken,
  onCopyToken,
  probeResult,
  onProbe,
  status,
  onOpenManual,
  onClose,
}: AgentIngressPanelProps): JSX.Element | null {
  /*
   * ★ 权限唯一出口 + **必须早于任何条件 return**（React hook 顺序铁律，见文件头）。
   */
  const { isAdmin } = useRoleGuard();

  /** token **草稿**（仅用于输入框；保存后立即清空，原文不留存） */
  const [tokenDraft, setTokenDraft] = useState('');

  /*
   * 门控：成员 / 未进入身份（role=null）一律看不到接入面板（§5.4 #16）。
   * 用 `isAdmin` 正向判定——等价于 `isRestrictedView(role)`，且不会把 role=null
   * 误当管理员（BUG-1 的教训）。
   */
  if (!isAdmin) return null;

  const isLocal = mode === 'local';
  const shownAddress = isLocal ? LOOPBACK_ORIGIN : address;

  const saveToken = (): void => {
    const value = tokenDraft.trim();
    if (!value) return;
    onSaveToken(value);
    setTokenDraft(''); // ★ 原文不留在组件 state，也不留在 DOM
  };

  return (
    <div
      data-agent-ingress-panel=""
      className="glass-strong iridescent-border dialog-pop flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl p-5 shadow-soft outline-none"
    >
      {/* 头部 */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="font-display text-display-md">接入外部写入方</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded-md p-1 text-mist hover:bg-sand"
        >
          <X size={16} />
        </button>
      </div>

      {/*
        诚实说明行：本批**不含任何 API 调用**，面板上的状态值由上层传入。
        绝不写「已连通」——那会让用户以为配好了，然后发现任务根本没进来。
      */}
      <div className="mb-3 flex items-start gap-2 rounded-md bg-sunken px-3.5 py-2.5 text-xs text-mist">
        <Info size={13} className="mt-0.5 shrink-0 text-pine" aria-hidden />
        <span>
          在 Windows 桌面版的<strong className="text-ink">本机模式</strong>下，应用已可接收自动导入；
          在这里设置访问令牌后点击“复制”，再将令牌与下方的导入格式提供给 WorkBuddy 或其他写入方。
          <strong className="text-ink">NAS 模式当前只支持连通探测，远程自动写入尚未启用。</strong>
        </span>
      </div>

      {/* ---------------- ① 地址（NAS / 本机） ---------------- */}
      <section className="rounded-md border border-line bg-paper p-3.5">
        <div className="mb-2 flex items-center gap-2">
          <Plug size={13} className="shrink-0 text-mist" aria-hidden />
          <h3 className="text-xs font-semibold text-ink">服务地址</h3>

          {/* 档位切换（分段控件；本批只切展示形态，不触发任何请求） */}
          <div
            role="tablist"
            aria-label="通道档位"
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-sunken p-1"
          >
            {MODE_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                data-ingress-mode={m}
                onClick={() => onModeChange(m)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs transition-colors',
                  mode === m ? 'bg-paper text-ink' : 'text-mist hover:text-ink',
                )}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            data-ingress-address=""
            /* 本机档位：地址是主进程写死的事实 → 只读展示，不让改（改了也无效） */
            readOnly={isLocal}
            aria-readonly={isLocal}
            value={shownAddress}
            onChange={(e) => onAddressChange(e.target.value)}
            aria-label="服务地址"
            spellCheck={false}
            placeholder="https://nas.example.com:7788"
            className={cn(
              'h-[38px] min-w-0 flex-1 rounded-md border border-line px-3 font-mono text-xs outline-none',
              isLocal ? 'bg-sunken text-mist' : 'bg-paper text-ink focus:border-pine',
            )}
          />
        </div>

        <p className="mt-1.5 text-[11px] text-mist">
          {isLocal
            ? '本机模式仅监听 127.0.0.1，不对外暴露；配置令牌后可接收自动导入。'
            : 'NAS 模式当前仅支持地址与令牌的连通探测；远程自动写入尚未启用。'}
        </p>
      </section>

      {/* ---------------- ② 令牌（写入后只回显「已配置」，绝不回显原文） ---------------- */}
      <section className="mt-3 rounded-md border border-line bg-paper p-3.5">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-semibold text-ink">访问令牌</h3>
          {/* 只暴露「是否已配置」这一个布尔事实 */}
          <span
            data-ingress-token-state={tokenConfigured ? 'configured' : 'unset'}
            className={cn(
              'ml-auto shrink-0 rounded-md px-2 py-0.5 text-[11px]',
              tokenConfigured ? 'bg-pine-soft text-pine' : 'bg-sand text-mist',
            )}
          >
            {tokenConfigured ? '已配置' : '未配置'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            data-ingress-token-input=""
            type="password"
            autoComplete="off"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            aria-label="访问令牌"
            placeholder={tokenConfigured ? '重新输入以替换现有令牌' : '粘贴访问令牌'}
            className="h-[38px] min-w-0 flex-1 rounded-md border border-line bg-paper px-3 font-mono text-xs text-ink outline-none focus:border-pine"
          />
          <button
            type="button"
            data-ingress-token-save=""
            onClick={saveToken}
            disabled={tokenDraft.trim().length === 0}
            className="inline-flex h-[38px] shrink-0 items-center rounded-md bg-pine px-3.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-40"
          >
            保存
          </button>
          {/* 复制走回调取件 —— 绝不从 DOM 读值（DOM 里根本没有原文） */}
          <button
            type="button"
            data-ingress-token-copy=""
            onClick={onCopyToken}
            disabled={!tokenConfigured}
            aria-label="复制令牌"
            className="inline-flex h-[38px] shrink-0 items-center gap-1 rounded-md border border-line px-3 text-sm text-ink transition-colors hover:bg-sunken disabled:opacity-40"
          >
            <Copy size={13} aria-hidden />
            复制
          </button>
        </div>

        <p className="mt-1.5 text-[11px] text-mist">
          令牌只写入本机，保存后不再回显原文——需要时用「复制」取用。
        </p>
      </section>

      {/* ---------------- ③ 服务状态（值由上层传入，本批不自行探测） ---------------- */}
      <section
        data-ingress-probe=""
        className="mt-3 rounded-md border border-line bg-paper p-3.5"
      >
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-semibold text-ink">服务状态</h3>
          <button
            type="button"
            data-ingress-probe-action=""
            onClick={onProbe}
            className="ml-auto inline-flex h-[30px] shrink-0 items-center gap-1 rounded-md border border-line px-3 text-xs text-ink transition-colors hover:bg-sunken"
          >
            <RefreshCw size={12} aria-hidden />
            一键探测
          </button>
        </div>

        {probeResult ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-ingress-probe-state={probeResult.ok ? 'ok' : 'fail'}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px]',
                  probeResult.ok ? 'bg-pine-soft text-pine' : 'bg-clay-soft text-clay',
                )}
              >
                {probeResult.ok ? '可连通' : '不可连通'}
              </span>
              <span className="font-mono text-[11px] text-mist">version {probeResult.version}</span>
              {probeResult.dataLayer && (
                /*
                  §3.2：渲染窗口不存在时 dataLayer='unavailable'——主进程 HTTP 活着
                  但 Dexie 够不到。**必须显式提示**，绝不静默失败（V1-13）。
                */
                <span
                  data-ingress-datalayer={probeResult.dataLayer}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[11px]',
                    probeResult.dataLayer === 'ready' ? 'bg-sand text-mist' : 'bg-amber-soft text-amber',
                  )}
                >
                  {probeResult.dataLayer === 'ready' ? '数据层就绪' : '数据层不可用'}
                </span>
              )}
            </div>
            {probeResult.dataLayer === 'unavailable' && (
              <p role="alert" className="text-[11px] text-amber">
                ID Plan 未运行（或数据层未就绪）——请先打开应用再重试。
              </p>
            )}
            {(probeResult.projectCount !== undefined || probeResult.seatLimit !== undefined) && (
              <p className="text-[11px] text-mist">
                {probeResult.projectCount !== undefined && <>项目 {probeResult.projectCount} 个</>}
                {probeResult.projectCount !== undefined && probeResult.seatLimit !== undefined && ' · '}
                {probeResult.seatLimit !== undefined && (
                  <>
                    席位 {probeResult.seatUsed ?? 0} / {probeResult.seatLimit}
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          <p data-ingress-probe-empty="" className="text-[11px] text-mist">
            尚未探测。点「一键探测」检查服务是否可连通。
          </p>
        )}
      </section>

      {/* ---------------- ④ 最近同步记录（值由上层传入） ---------------- */}
      <section
        data-ingress-sync=""
        className="mt-3 rounded-md border border-line bg-paper p-3.5"
      >
        <h3 className="mb-2 text-xs font-semibold text-ink">最近同步记录</h3>
        {status ? (
          <dl className="flex flex-col gap-1 text-[11px]">
            <div className="flex gap-2">
              <dt className="shrink-0 text-mist">最近同步</dt>
              <dd data-ingress-sync-at="" className="min-w-0 font-mono text-ink">
                {formatSyncAt(status.lastSyncAt)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 text-mist">结果</dt>
              <dd data-ingress-sync-summary="" className="min-w-0 text-ink">
                {status.lastSyncSummary ?? '—'}
              </dd>
            </div>
          </dl>
        ) : (
          <p data-ingress-sync-empty="" className="text-[11px] text-mist">
            {isLocal ? '尚未收到本机自动写入。' : 'NAS 远程自动写入尚未启用，因此没有同步记录。'}
          </p>
        )}
      </section>

      {/* ---------------- ⑤ 底部动作：手动粘贴是**另一个入口** ---------------- */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          data-ingress-manual=""
          onClick={onOpenManual}
          className="mr-auto rounded-md text-xs text-pine underline underline-offset-2"
        >
          改为手动粘贴排期文件
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
