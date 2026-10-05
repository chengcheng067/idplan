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
 * 零新 token：pine（已启用）/ mist（未启用）/ clay（错误）/ amber（需注意）。
 */

import { useMemo, useState } from 'react';
import { Check, Loader2, Puzzle, X } from 'lucide-react';

import { usePluginRegistry } from '../../core/plugin/PluginRegistryProvider';
import type { PluginManifest } from '../../core/plugin/types';
import { cn } from '../../lib/cn';

/** 插件贡献点的一句话概括（给用户看「停用它会少什么」）。 */
function contributionText(m: PluginManifest): string {
  const parts: string[] = [];
  if (m.routes?.length) parts.push(`${m.routes.length} 个页面`);
  if (m.nav?.length) parts.push(`${m.nav.length} 个侧栏入口`);
  if (m.settingsSlot) parts.push('设置区块');
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

export function PluginsSection(): JSX.Element {
  const reg = usePluginRegistry();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      reg.manifests.map((m) => ({
        manifest: m,
        ...reg.stateOf(m.id),
      })),
    [reg],
  );

  const onToggle = async (id: string, next: boolean): Promise<void> => {
    setError(null);
    setBusyId(id);
    try {
      // 写 settings KV 后再改内存 ⇒ 刷新/重启后状态保持
      await reg.setPluginEnabled(id, next);
    } catch {
      setError('保存失败，开关未生效——请重试（本地存储可能不可写）');
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
        </p>

        {error && (
          <p className="mb-2 rounded-md border border-clay/40 bg-clay/5 px-2 py-1 text-[11px] text-clay">
            {error}
          </p>
        )}

        <ul className="divide-y divide-line">
          {rows.map(({ manifest, enabled, explicit }) => {
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
    </section>
  );
}
