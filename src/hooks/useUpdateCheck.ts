import { useCallback, useEffect, useState } from 'react';

import { isDesktop } from '../lib/desktopBridge';
import type { UpdatePayload } from '../lib/update.types';

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'has-update' | 'error';

/**
 * 桌面端更新检测 hook。
 *
 * - 浏览器 / NAS 端（isDesktop() === false）：desktop 恒为 false，effect 直接 return、check() 直接
 *   返回 null——不渲染任何更新 UI、不发起任何网络请求（更新请求只能走 Electron 主进程）。
 * - 桌面端：自动订阅主进程启动 8s 后的 update:available 推送（自动检查失败静默，无推送即无更新）；
 *   手动 check() 用于设置面板「检查更新」，失败时返回 status='error' 并带 reason，由 UI 反馈给用户。
 */
export function useUpdateCheck() {
  const desktop = isDesktop();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [payload, setPayload] = useState<UpdatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 订阅主进程启动时推送的「发现新版本」
  useEffect(() => {
    if (!desktop || !window.idplan) return;
    const unsub = window.idplan.onUpdateAvailable((p) => {
      setPayload(p);
      setStatus('has-update');
    });
    return unsub;
  }, [desktop]);

  const check = useCallback(async (): Promise<UpdatePayload | null> => {
    // 非桌面端：什么都不做，保持静默
    if (!desktop || !window.idplan) return null;
    setStatus('checking');
    setError(null);
    try {
      const p = await window.idplan.checkUpdate();
      setPayload(p);
      setStatus(p.hasUpdate ? 'has-update' : 'up-to-date');
      return p;
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [desktop]);

  return { desktop, status, payload, error, check };
}
