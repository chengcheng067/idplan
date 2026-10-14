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
import { useLang } from '../../i18n';
import { logUser } from '../../core/services/log.service';

export function NasServiceSection(): JSX.Element | null {
  const { t } = useLang();
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
          {t('nas.title')}
        </h3>
      </div>
      <div className="space-y-2.5 rounded-[12px] border border-line bg-cream/40 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-mist">{t('nas.address')}</span>
          <span className="font-medium text-ink">{appEnv.apiBaseUrl || t('nas.addressUnset')}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-mist">
          {/*
            ⚠️ 这条文本流会被 tests/i18n-jsx-space.spec.ts 判空格（三个子项都可解释）：
            `IDPLAN_AGENT_TOKEN` 是**硬编码字面量**（左右贴不带空格）⇒ 它两侧的空格
            按 en.ts 文件头 ⑤ 的「例外」放在**英文取值的前导/尾随**里（中文态不能有空格）。
          */}
          {t('nas.note.pre')}
          <code className="mx-1 rounded bg-line/60 px-1">IDPLAN_AGENT_TOKEN</code>
          {t('nas.note.post')}
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
              placeholder={configured ? t('nas.tokenConfigured') : t('nas.tokenPlaceholder')}
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
            {saved ? t('nas.saved') : t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={probe === 'testing'}
            title={t('nas.probeTitle')}
            className="flex items-center gap-1 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlugZap size={13} />
            {probe === 'testing' ? t('nas.probing') : t('nas.test')}
          </button>
        </div>
        {probe !== 'idle' && (
          <p
            className={`text-[11px] ${
              probe === 'ok' ? 'text-moss' : probe === 'testing' ? 'text-mist' : 'text-amber'
            }`}
          >
            {probe === 'ok' && t('nas.probe.ok')}
            {probe === 'auth' && t('nas.probe.auth')}
            {probe === 'net' && t('nas.probe.net')}
            {probe === 'err' && t('nas.probe.err')}
            {probe === 'testing' && t('nas.probe.testing')}
          </p>
        )}
        {configured && <p className="text-[11px] text-moss">{t('nas.configuredNote')}</p>}
      </div>
    </section>
  );
}
