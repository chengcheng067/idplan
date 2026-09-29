/**
 * 「NAS 服务」设置区（0.8.2.0002 · 备份不可用事故的修复入口）。
 *
 * ── 事故背景 ──
 * NAS 形态下「保存备份」曾结构性不可用：服务端 `/api/backup` 要求
 * `IDPLAN_AGENT_TOKEN`（fail-closed），但 ① UPK 的 compose 模板没给它环境位，
 * ② 前端 token 是构建期 `VITE_API_TOKEN` 烤死在静态包里的，终端用户改不了。
 * 用户实测日志：连续 16 次「保存备份失败：备份通道需要鉴权」。
 *
 * ── 本区做什么 ──
 * 让用户在这一处填入**服务端配的同一串令牌**（存 localStorage，最高优先于
 * 构建期 env），保存即派发 `API_TOKEN_EVENT` → DI provider 重建 remote
 * bundle → 备份链路当场可用（无需刷新页面）。
 *
 * ── 纪律 ──
 * - 仅 remote 数据源渲染（local/桌面无服务端概念，整块不出现）
 * - 令牌**不回显**：已有配置只显示「已配置」状态，输入框 placeholder 提示；
 *   与 Agent 令牌面板同纪律（log 与截图泄漏面最小化）
 * - apiBaseUrl 只读展示（改它是部署层的事，不在应用内）
 */

import { useCallback, useEffect, useState } from 'react';

import { Check, KeyRound, PlugZap, Save, Server } from 'lucide-react';

import { appEnv } from '../../config/env';
import { API_TOKEN_KEY } from '../../core/repositories/remote/rest.client';
import { API_TOKEN_EVENT } from '../../di/repository.provider';
import { logUser } from '../../core/services/log.service';

export function NasServiceSection(): JSX.Element | null {
  const remote = appEnv.dataSource === 'remote';
  const [draft, setDraft] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  /** 备份通道自检（0.8.3）：idle 未测 / testing 测中 / ok / auth / net / err */
  const [probe, setProbe] = useState<'idle' | 'testing' | 'ok' | 'auth' | 'net' | 'err'>('idle');

  /**
   * 备份通道自检：GET {apiBaseUrl}/backup 带当前令牌。
   * 用 GET 而不是 POST——它只读导出、不写库，探活零副作用。
   * 判读：200=通 / 401=令牌不匹配（服务端有配但值不对，或服务端没配）/ 网络错=地址不通。
   */
  const testConnection = useCallback(async () => {
    setProbe('testing');
    const token = (localStorage.getItem(API_TOKEN_KEY) ?? '').trim();
    try {
      const res = await fetch(`${appEnv.apiBaseUrl}/backup`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setProbe(res.status === 200 ? 'ok' : res.status === 401 ? 'auth' : 'err');
    } catch {
      setProbe('net');
    }
  }, []);

  useEffect(() => {
    if (!remote) return;
    const cur = (localStorage.getItem(API_TOKEN_KEY) ?? '').trim();
    setConfigured(cur !== '');
  }, [remote]);

  const save = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    localStorage.setItem(API_TOKEN_KEY, next);
    window.dispatchEvent(new Event(API_TOKEN_EVENT));
    setConfigured(true);
    setDraft('');
    setSaved(true);
    logUser('NAS 服务', '备份令牌已更新（保存后 remote bundle 已重建）');
    window.setTimeout(() => setSaved(false), 2400);
  }, [draft]);

  if (!remote) return null;

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Server size={14} className="text-mist" aria-hidden />
          NAS 服务
        </h3>
      </div>
      <div className="space-y-2.5 rounded-[12px] border border-line bg-cream/40 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-mist">服务地址</span>
          <span className="font-medium text-ink">{appEnv.apiBaseUrl || '（未配置）'}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-mist">
          保存备份 / 从备份恢复需要服务端令牌。请在 NAS 的后端容器环境变量里配置
          <code className="mx-1 rounded bg-line/60 px-1">IDPLAN_AGENT_TOKEN</code>
          （UGOS：Docker 套件 → idplan-backend → 编辑 → 环境变量），
          把同一串值填在下面。令牌只存在本机浏览器里，不上传、不回显。
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <KeyRound
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist"
              aria-hidden
            />
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={configured ? '已配置 · 输入新值可更换' : '粘贴服务端配置的同一串令牌'}
              className="w-full rounded-[10px] border border-line bg-paper py-1.5 pl-7 pr-2.5 text-xs text-ink placeholder:text-mist/70 focus:border-ink/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!draft.trim()}
            className="flex items-center gap-1 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? <Check size={13} className="text-moss" /> : <Save size={13} />}
            {saved ? '已保存' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={probe === 'testing'}
            title="用当前令牌向服务端备份通道发一次只读探测"
            className="flex items-center gap-1 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlugZap size={13} />
            {probe === 'testing' ? '探测中' : '测试连接'}
          </button>
        </div>
        {probe !== 'idle' && (
          <p
            className={`text-[11px] ${
              probe === 'ok' ? 'text-moss' : probe === 'testing' ? 'text-mist' : 'text-amber'
            }`}
          >
            {probe === 'ok' && '备份通道连通：令牌已被服务端接受，可以正常保存备份。'}
            {probe === 'auth' &&
              '服务端拒绝了令牌（401）：两侧值不一致，或服务端 IDPLAN_AGENT_TOKEN 未配/留空。'}
            {probe === 'net' && '连不上服务端：检查地址是否可达（应为本机局域网的 NAS 地址）。'}
            {probe === 'err' && '服务端返回了意外状态，稍后重试或查看 NAS 容器日志。'}
            {probe === 'testing' && '正在探测备份通道…'}
          </p>
        )}
        {configured && (
          <p className="text-[11px] text-moss">当前已配置备份令牌，保存备份应该可以正常使用了。</p>
        )}
      </div>
    </section>
  );
}
