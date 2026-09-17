/**
 * 「授权」区（设置面板内）· Windows 桌面版离线许可证 MVP。
 *
 * ── 为什么是离线签发，而不是账号登录 ──
 * 本应用是**离线优先**的（数据在本机 Dexie / NAS SQLite），引入账号体系等于把
 * 「能不能打开自己的项目」交给一个网络服务，与产品定位相悖。故授权做成
 * 「机器码 → 离线签发 → 本地导入」：作者用私钥签一份绑定本机的许可证给用户，
 * 应用侧只用**公钥验签**，任何时刻都能离线自证。
 *
 * ── 本组件只做三件事，且都不碰私钥 ──
 *   ① 读主进程算好的状态（`license:status`）：机器码、是否已授权、到期日、拒绝原因；
 *   ② 复制机器码（用户把它发给作者换许可证）；
 *   ③ 导入许可证（粘贴 JSON 或选文件）→ 交给主进程验签落盘。
 * 验签、机器码、落盘**全部在主进程**（`electron/license.cjs`），渲染进程拿不到私钥、
 * 也不参与判分 —— 前端改一行 JS 不能把自己变成已授权。
 *
 * ── 只在桌面端渲染 ──
 * 浏览器 / NAS 端根本没有 `window.idplan`，`licenseStatus()` 不存在；此时整区不渲染，
 * 也不发任何请求（与本仓「NAS 版不加桌面专属功能」的既有口径一致）。
 *
 * 零新色；12px 圆角在本仓写作 `rounded-md`（`rounded-xl` 已被重映射为 16px）。
 */

import { useCallback, useEffect, useState } from 'react';

import { BadgeCheck, Copy, FileUp, Info, RefreshCw, ShieldAlert } from 'lucide-react';

import { isDesktop } from '../../lib/desktopBridge';

/** 主进程回传的授权状态（与 `electron/license.cjs` 的 readLicenseStatus 同形） */
export interface LicenseStatusView {
  machineId: string;
  licensed: boolean;
  reason: string | null;
  expiresAt: string | null;
}

/** 「2099-12-31T00:00:00.000Z」→「2099-12-31」；解析不了就原样回显，不吞掉事实 */
function formatExpiry(value: string | null): string {
  if (!value) return '永久有效';
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toISOString().slice(0, 10);
}

export function LicenseSection(): JSX.Element | null {
  const desktop = isDesktop();
  const [status, setStatus] = useState<LicenseStatusView | null>(null);
  /** 粘贴进来的许可证原文（导入成功后立即清空，不留副本） */
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!desktop) return;
    const api = window.idplan?.licenseStatus;
    if (typeof api !== 'function') {
      setFailed('桌面端授权接口未就绪，请重启应用后再试。');
      return;
    }
    try {
      setStatus(await api());
    } catch {
      setFailed('读取授权状态失败。');
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!desktop) return null;

  const copyMachineId = async (): Promise<void> => {
    const id = status?.machineId;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setHint('机器码已复制，发给作者即可换取许可证。');
    } catch {
      // 剪贴板被拒（少见）：把机器码留在屏幕上让用户手抄，不假装复制成功
      setHint('复制失败，请手动选中上方机器码复制。');
    }
  };

  const doImport = async (text: string): Promise<void> => {
    const payload = text.trim();
    if (payload === '') {
      setFailed('请先粘贴许可证内容或选择 license.json 文件。');
      return;
    }
    const api = window.idplan?.importLicense;
    if (typeof api !== 'function') {
      setFailed('桌面端授权接口未就绪，请重启应用后再试。');
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      const next = await api(payload);
      setStatus(next);
      if (next.licensed) {
        setRaw('');
        setHint(`授权成功${next.expiresAt ? `，有效期至 ${formatExpiry(next.expiresAt)}` : ''}。`);
      } else {
        setFailed(next.reason ?? '许可证未被接受。');
      }
    } catch {
      setFailed('导入失败：许可证内容不是有效的 JSON。');
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      await doImport(await file.text());
    } catch {
      setFailed('文件读取失败，请改用粘贴方式。');
    }
  };

  const licensed = status?.licensed === true;

  return (
    <section data-license-section="">
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          {licensed ? (
            <BadgeCheck size={14} className="text-pine" aria-hidden />
          ) : (
            <ShieldAlert size={14} className="text-mist" aria-hidden />
          )}
          授权
        </h3>
      </div>

      <div className="rounded-[10px] border border-line bg-cream/50 px-3 py-2.5 text-xs leading-6">
        <div className="flex items-center justify-between gap-2">
          <span className="text-mist">状态</span>
          <span className={licensed ? 'font-medium text-pine' : 'font-medium text-mist'}>
            {licensed ? '已授权' : '未授权'}
            {licensed && status?.expiresAt ? `（至 ${formatExpiry(status.expiresAt)}）` : ''}
          </span>
        </div>

        {!licensed && status?.reason && (
          <p data-license-reason="" className="text-[11px] text-mist">
            {status.reason}
          </p>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-mist">机器码</span>
          <span className="flex items-center gap-1.5">
            <code
              data-license-machine-id=""
              className="max-w-[180px] truncate font-mono text-[11px] text-ink"
              title={status?.machineId ?? ''}
            >
              {status?.machineId ?? '读取中…'}
            </code>
            <button
              type="button"
              onClick={() => void copyMachineId()}
              disabled={!status?.machineId}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-mist transition-colors hover:bg-sand hover:text-ink disabled:opacity-50"
            >
              <Copy size={11} aria-hidden /> 复制
            </button>
          </span>
        </div>

        <p className="mt-1 text-[11px] leading-relaxed text-mist">
          许可证与本机绑定：把机器码发给作者，收到 <code>license.json</code> 后在下方导入。
          换机器需重新申请；本机不上传任何数据。
        </p>

        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-mist">粘贴许可证内容</span>
          <textarea
            aria-label="许可证内容"
            data-license-input=""
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder='{"payload":{…},"signature":"…"}'
            className="w-full resize-y rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-pine"
          />
        </label>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void doImport(raw)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-pine px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileUp size={12} aria-hidden /> {busy ? '校验中…' : '导入许可证'}
          </button>

          {/* 选文件：与粘贴共用同一导入路径（同一个验签闸门，不做第二条捷径） */}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-mist transition-colors hover:bg-sand hover:text-ink">
            <FileUp size={12} aria-hidden /> 选择文件
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="选择许可证文件"
              onChange={(e) => {
                void onPickFile(e.target.files?.[0]);
                e.target.value = ''; // 允许重复选择同一个文件
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            <RefreshCw size={11} aria-hidden /> 重新检测
          </button>
        </div>

        {hint && (
          <p data-license-hint="" className="mt-1.5 flex items-start gap-1 text-[11px] text-pine">
            <Info size={11} className="mt-0.5 shrink-0" aria-hidden /> {hint}
          </p>
        )}
        {failed && (
          <p data-license-error="" className="mt-1.5 text-[11px] text-clay">
            {failed}
          </p>
        )}
      </div>
    </section>
  );
}
