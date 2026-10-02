/**
 * 设置 · 行业库区（v0.8.6 · 她反馈 #9「行业允许增加自定义」的 UI 闭环）。
 *
 * ── 导入流程（安全姿态的 UI 侧）──
 * 选 JSON → 读字节（超 256KB 前端先拒，省一次解析）→ validateCustomLibrary
 * 严格校验（schema/service 十条）→ 失败**逐条中文展示**（不落半包）；
 * 成功 → 追加进 settings KV `customLibraries`（带 importedAt）。
 *
 * 读侧一律 normalizeCustomLibraries（绝不抛错）——坏条静静跳过不白屏。
 * 落盘后，建档弹窗的套餐选择即可见自定义 preset（消费侧接线见
 * StageSelectPanel——自定义 preset 叠加在内置套餐后）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileJson, Loader2, Plus, Trash2 } from 'lucide-react';

import { useRepos } from '../../hooks/useRepos';
import { cn } from '../../lib/cn';
import {
  validateCustomLibrary,
  CUSTOM_LIBRARY_MAX_BYTES,
} from '../../core/template/custom-library.schema';
import {
  normalizeCustomLibraries,
  CUSTOM_LIBRARIES_SETTING_KEY,
  type StoredCustomLibrary,
} from '../../core/template/custom-library.service';
import { logUser } from '../../core/services/log.service';

const MAX_MB_LABEL = `${Math.floor(CUSTOM_LIBRARY_MAX_BYTES / 1024)}KB`;

export function CustomLibrarySection(): JSX.Element {
  const repos = useRepos();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [libs, setLibs] = useState<StoredCustomLibrary[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const raw = await repos.settings.get<unknown>(CUSTOM_LIBRARIES_SETTING_KEY);
    setLibs(normalizeCustomLibraries(raw));
  }, [repos]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setErrors([]);
      setBusy(true);
      try {
        if (file.size > CUSTOM_LIBRARY_MAX_BYTES) {
          setErrors([`文件超过 ${MAX_MB_LABEL} 上限（当前 ${Math.ceil(file.size / 1024)}KB）`]);
          return;
        }
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setErrors(['不是合法的 JSON 文件']);
          return;
        }
        const result = validateCustomLibrary(parsed, new TextEncoder().encode(text).length);
        if (!result.ok) {
          setErrors(result.issues.map((i) => `${i.path}: ${i.message}`));
          return;
        }
        const existing = normalizeCustomLibraries(
          await repos.settings.get<unknown>(CUSTOM_LIBRARIES_SETTING_KEY),
        );
        // 同名替换（重复导入同名包 = 更新而非叠加两份）
        const next = [
          ...existing.filter((l) => l.name !== result.library.name),
          { ...result.library, importedAt: new Date().toISOString() },
        ];
        await repos.settings.set(CUSTOM_LIBRARIES_SETTING_KEY, next);
        setLibs(next);
        logUser('行业库', `导入「${result.library.name}」（${result.library.items.length} 阶段 / ${result.library.presets.length} 套餐）`);
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [repos],
  );

  const onRemove = useCallback(
    async (name: string) => {
      const existing = normalizeCustomLibraries(
        await repos.settings.get<unknown>(CUSTOM_LIBRARIES_SETTING_KEY),
      );
      const next = existing.filter((l) => l.name !== name);
      await repos.settings.set(CUSTOM_LIBRARIES_SETTING_KEY, next);
      setLibs(next);
      logUser('行业库', `删除「${name}」`);
    },
    [repos],
  );

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <FileJson size={14} className="text-mist" aria-hidden />
          行业库（自定义）
        </h3>
      </div>
      <div className="rounded-[10px] border border-line bg-cream/50 px-3 py-2.5 text-xs leading-6">
        <p className="text-[11px] text-mist">
          导入自定义行业包（JSON ≤ {MAX_MB_LABEL}）：自己的阶段项与套餐，建档时出现在所选行业下。
          阶段 key 须以 <code className="rounded bg-line/60 px-1">usr.</code> 开头。
        </p>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="soft-btn-ghost flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={13} aria-hidden />}
            导入行业包
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="导入行业包"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
        </div>

        {errors.length > 0 && (
          <ul className="mt-2 space-y-0.5 rounded-md border border-clay/40 bg-clay/5 px-2 py-1.5 text-[11px] text-clay">
            {errors.map((e) => (
              <li key={e}>· {e}</li>
            ))}
          </ul>
        )}

        {libs.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {libs.map((lib) => (
              <li key={lib.name} className="flex items-center gap-2 py-1.5">
                <span className="truncate text-ink">{lib.name}</span>
                <span className="shrink-0 text-[10px] text-mist">
                  {lib.items.length} 阶段 · {lib.presets.length} 套餐 · {lib.domain}
                </span>
                <button
                  type="button"
                  onClick={() => void onRemove(lib.name)}
                  aria-label={`删除行业包 ${lib.name}`}
                  className="ml-auto shrink-0 rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-clay"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {libs.length === 0 && errors.length === 0 && (
          <p className={cn('mt-2 text-[11px] text-mist')}>还没有导入行业包。内置 9 个主板块的套餐随包分发。</p>
        )}
      </div>
    </section>
  );
}
