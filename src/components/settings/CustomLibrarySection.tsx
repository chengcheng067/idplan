/**
 * 设置 · 行业库区（v0.8.6 · 她反馈 #9「行业允许增加自定义」的 UI 闭环；
 * #6.2「先教用户怎么生成文件再谈导入」的新流程落地）。
 *
 * ── v0.8.6.0001 新流程（她反馈 #6.2 原话见文件末）──
 * 旧流程「先有文件再找入口」不成立：用户手里根本没有那个 JSON。改为：
 *   ① 复制提示词（代码生成的 prompt，规则全部来自 schema 常量）
 *   → ② 用户在自己的 Agent 里让它只回一个 JSON
 *   → ③ 导回这里（校验不放松：不落半包，逐条人话化报错）
 * 三步常驻条钉在区顶部，成功/失败都有明确反馈（导入成功确认卡 / 失败四层人话化）。
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
import { AlertTriangle, Check, ClipboardCopy, Copy, Download, FileJson, Loader2, Plus, Trash2, X } from 'lucide-react';

import { useRepos } from '../../hooks/useRepos';
import { cn } from '../../lib/cn';
import {
  validateCustomLibrary,
  CUSTOM_LIBRARY_MAX_BYTES,
  type CustomLibraryFile,
  type CustomLibraryIssue,
} from '../../core/template/custom-library.schema';
import {
  normalizeCustomLibraries,
  CUSTOM_LIBRARIES_SETTING_KEY,
  type StoredCustomLibrary,
} from '../../core/template/custom-library.service';
import {
  buildAgentFeedbackText,
  buildCustomLibraryPrompt,
  CUSTOM_LIBRARY_ERROR_HINTS,
  translateCustomLibraryIssue,
} from '../../core/template/custom-library.prompt';
import { domainLabel } from '../../core/template/stage-library';
import { logUser } from '../../core/services/log.service';

const MAX_MB_LABEL = `${Math.floor(CUSTOM_LIBRARY_MAX_BYTES / 1024)}KB`;

/** 剪贴板写入（统一出口）。不可用/被拒时返回 false——非安全上下文拿不到 clipboard */
async function copyText(text: string): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.writeText !== 'function') return false;
  try {
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 导入失败：文件级（超限/非 JSON）或 schema 级（逐条 issue，带原文供位置翻译取 key/name） */
type ImportFailure =
  | { kind: 'file'; message: string }
  | { kind: 'schema'; issues: CustomLibraryIssue[]; raw: unknown };

/** 导入成功的确认卡素材（④：她要求「导入后给个响」） */
interface ImportSuccess {
  name: string;
  items: number;
  presets: number;
  domain: CustomLibraryFile['domain'];
}

/** 瞬时反馈（复制成功/失败、导出完成）：1.8s 自灭，不常驻不弹窗 */
interface Flash {
  tone: 'ok' | 'warn';
  text: string;
}

export function CustomLibrarySection(): JSX.Element {
  const repos = useRepos();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [libs, setLibs] = useState<StoredCustomLibrary[]>([]);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [success, setSuccess] = useState<ImportSuccess | null>(null);
  const [note, setNote] = useState('');
  const [attachRef, setAttachRef] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const raw = await repos.settings.get<unknown>(CUSTOM_LIBRARIES_SETTING_KEY);
    setLibs(normalizeCustomLibraries(raw));
  }, [repos]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 复制反馈 1.8s 后自灭（克制：不常驻、不弹窗）
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  /** ① 复制提示词 = 代码生成的 prompt + 用户的一句话（+ 可选参照库） */
  const onCopyPrompt = useCallback(async () => {
    const text = buildCustomLibraryPrompt({
      userNote: note,
      ...(attachRef ? { referenceLibraries: libs } : {}),
    });
    const ok = await copyText(text);
    setFlash(
      ok
        ? { tone: 'ok', text: '提示词已复制——去粘贴给你的 Agent，让它只回一个 JSON' }
        : { tone: 'warn', text: '复制失败：浏览器未授权剪贴板，请手动选择文本复制' },
    );
    if (ok) logUser('行业库', `复制生成 prompt${attachRef ? `（附 ${libs.length} 个现有库作参照）` : ''}`);
  }, [note, attachRef, libs]);

  /** ⑥-3 一键复制全部错误，贴回给 Agent 修正——闭环回流程 ② */
  const onCopyErrors = useCallback(async () => {
    if (!failure) return;
    const text =
      failure.kind === 'file'
        ? `我的行业包导入失败了：${failure.message}。请修复后重新只输出一个 JSON 代码块。`
        : buildAgentFeedbackText(failure.issues, failure.raw);
    const ok = await copyText(text);
    setFlash(
      ok
        ? { tone: 'ok', text: '错误清单已复制——贴回给 Agent 让它按条修正' }
        : { tone: 'warn', text: '复制失败：浏览器未授权剪贴板，请手动选择文本复制' },
    );
  }, [failure]);

  /** ③ 导回校验：文件级 / schema 级失败分流，成功落确认卡 */
  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setFailure(null);
      setSuccess(null);
      setBusy(true);
      try {
        if (file.size > CUSTOM_LIBRARY_MAX_BYTES) {
          setFailure({
            kind: 'file',
            message: `文件超过 ${MAX_MB_LABEL} 上限（当前 ${Math.ceil(file.size / 1024)}KB）`,
          });
          return;
        }
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setFailure({
            kind: 'file',
            message: '这个文件不是合法的 JSON——多半是 Agent 在 JSON 前后多输出了说明文字',
          });
          return;
        }
        const result = validateCustomLibrary(parsed, new TextEncoder().encode(text).length);
        if (!result.ok) {
          setFailure({ kind: 'schema', issues: result.issues, raw: parsed });
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
        setSuccess({
          name: result.library.name,
          items: result.library.items.length,
          presets: result.library.presets.length,
          domain: result.library.domain,
        });
        logUser('行业库', `导入「${result.library.name}」（${result.library.items.length} 阶段 / ${result.library.presets.length} 套餐）`);
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [repos],
  );

  const onExport = useCallback((lib: StoredCustomLibrary) => {
    const file = {
      schema: lib.schema,
      name: lib.name,
      domain: lib.domain,
      items: lib.items,
      presets: lib.presets,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lib.name || '行业库'}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // ★ revoke 让出一拍：同步 revoke 与下载启动存在竞态（同 backup.service 手法）
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setFlash({ tone: 'ok', text: `已导出「${lib.name}.json」` });
    logUser('行业库', `导出「${lib.name}」`);
  }, []);

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

  const issueLines =
    failure?.kind === 'schema'
      ? failure.issues.map((i) => translateCustomLibraryIssue(i, failure.raw))
      : failure && failure.kind === 'file'
        ? [failure.message]
        : [];

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <FileJson size={14} className="text-mist" aria-hidden />
          行业库（自定义）
        </h3>
      </div>
      <div className="rounded-[10px] border border-line bg-cream/50 px-3 py-2.5 text-xs leading-6">
        {/* ① 三步常驻条（她 #6.2：先教怎么生出文件，再谈导入） */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-mist">
          <li className="flex items-center gap-1">
            <span className="text-mist/70">①</span>复制提示词
          </li>
          <li aria-hidden className="text-mist/50">→</li>
          <li className="flex items-center gap-1">
            <span className="text-mist/70">②</span>发给你的 Agent，让它只回一个 JSON
          </li>
          <li aria-hidden className="text-mist/50">→</li>
          <li className="flex items-center gap-1">
            <span className="text-mist/70">③</span>导回这里
          </li>
        </ol>
        <p className="mt-1 text-[11px] text-mist">
          导入自定义行业包（JSON ≤ {MAX_MB_LABEL}）：自己的阶段项与套餐，建档时出现在所选行业下。
          阶段 key 须以 <code className="rounded bg-line/60 px-1">usr.</code> 开头。
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="custom-library-note">
            用一句话说你的行业
          </label>
          <textarea
            id="custom-library-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="用一句话说你的行业（可选，会拼进提示词）"
            className="soft-input min-w-[220px] flex-1 rounded-[10px] px-2.5 py-1.5 text-xs leading-5 text-ink outline-none placeholder:text-mist/70"
          />
          <button
            type="button"
            onClick={() => void onCopyPrompt()}
            className="soft-btn-primary soft-press soft-focus-halo flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            <ClipboardCopy size={13} aria-hidden />
            复制提示词
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="soft-btn-ghost soft-focus-halo flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
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
          <label className="flex items-center gap-1.5 text-[11px] text-mist">
            <input
              type="checkbox"
              checked={attachRef}
              onChange={(e) => setAttachRef(e.target.checked)}
              className="accent-pine"
            />
            附上我当前的行业库（{libs.length} 个）作参照
          </label>
        </div>

        {flash && (
          <p
            className={cn(
              'mt-1.5 flex items-center gap-1 text-[11px]',
              flash.tone === 'ok' ? 'text-pine' : 'text-clay',
            )}
            role="status"
          >
            {flash.tone === 'ok' ? <Check size={11} aria-hidden /> : <AlertTriangle size={11} aria-hidden />}
            {flash.text}
          </p>
        )}

        {/* ④ 导入成功确认卡 */}
        {success && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-pine/40 bg-pine-soft px-2 py-1.5 text-[11px] text-ink">
            <Check size={13} className="mt-0.5 shrink-0 text-pine" aria-hidden />
            <p className="leading-5">
              已导入「{success.name}」：{success.items} 个阶段 · {success.presets} 个套餐 · 挂在「
              {domainLabel(success.domain)}」板块下——建档时选「
              {domainLabel(success.domain)}」就能看到。同名再导入 = 更新这一包。
            </p>
            <button
              type="button"
              onClick={() => setSuccess(null)}
              aria-label="关闭导入成功提示"
              className="ml-auto shrink-0 rounded-md p-0.5 text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        )}

        {/* ⑥ 失败路径人话化：预告卡（最常见三种）→ 逐条错误 → 一键复制 */}
        {failure && (
          <div className="mt-2 space-y-1.5">
            <ul className="space-y-0.5 rounded-md border border-amber/40 bg-amber-soft px-2 py-1.5 text-[11px] text-ink">
              {CUSTOM_LIBRARY_ERROR_HINTS.map((h) => (
                <li key={h.id} className="leading-5">
                  · {h.title}——{h.fix}
                </li>
              ))}
            </ul>
            <ul className="space-y-0.5 rounded-md border border-clay/40 bg-clay-soft px-2 py-1.5 text-[11px] text-clay">
              {issueLines.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void onCopyErrors()}
              className="soft-btn-ghost soft-focus-halo flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
            >
              <Copy size={12} aria-hidden />
              一键复制全部错误，贴回给 Agent
            </button>
          </div>
        )}

        {libs.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {libs.map((lib) => (
              <li key={lib.name} className="flex items-center gap-2 py-1.5">
                <span className="truncate text-ink">{lib.name}</span>
                <span className="shrink-0 text-[10px] text-mist">
                  {lib.items.length} 阶段 · {lib.presets.length} 套餐 · {domainLabel(lib.domain)}
                </span>
                <button
                  type="button"
                  onClick={() => onExport(lib)}
                  aria-label={`导出行业包 ${lib.name}`}
                  className="ml-auto shrink-0 rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-pine"
                >
                  <Download size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => void onRemove(lib.name)}
                  aria-label={`删除行业包 ${lib.name}`}
                  className="shrink-0 rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-clay"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {libs.length === 0 && !failure && (
          <p className={cn('mt-2 text-[11px] text-mist')}>
            还没有导入行业包。内置 9 个主板块的套餐随包分发。
          </p>
        )}
      </div>
    </section>
  );
}
