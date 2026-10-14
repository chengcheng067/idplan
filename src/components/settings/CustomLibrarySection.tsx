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
 *
 * ── v1.0.0.0009 中英切换（笔 1-④）──
 * 本文件所有**界面文案**改走 `t()`（键前缀 `library.`）。三条取词纪律：
 *   ① ★ 5 个 `useCallback`（onCopyPrompt / onCopyErrors / onPick / onExport / onRemove）
 *      里，**前四个都取词** —— `t` 是 `useCallback(…, [lang])` 的**新身份**，故取词的
 *      那几个**必须把 `t` 加进 deps**。漏了它回调会捕获旧语言：切英文后 toast 仍是
 *      中文、而界面看着是英文（本仓最怕的那类假绿）。`onRemove` 不取词（只写库 +
 *      落中文日志）⇒ deps 不变。
 *   ② `domainLabel()` 是 `core/template/stage-library` 的**模块级函数、不订阅语言**
 *      ⇒ 它在英文态仍返回中文板块名。**这是有意的**：内置行业名（两套）属
 *      team-lead 未拍板的 C 灰区，本笔一个字都不动。
 *   ③ 三处**有意保留中文**（都不是界面文案，各自理由见就地注释）：
 *      失败预告卡与逐条 issue（取值来自 `custom-library.prompt.ts`，属**提示词载荷**
 *      模块，不在本笔范围）／发给 Agent 的失败回帖（同上，是载荷不是界面）／
 *      4 条 `logUser(...)`（team-lead 已裁定：日志分组键与消息维持中文，
 *      与阶段预设名同类——落库的、又被当显示用的值）。
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
import { useLang } from '../../i18n';
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
  const { t } = useLang();
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
    /*
     * ⚠️ 变量名是 `timer` 而**不是** `t`：本组件顶部有 i18n 的
     * `const { t } = useLang()`，写成 `const t = setTimeout(...)` 会**遮蔽**它 ——
     * 今天这个 effect 不取词所以能跑，但下一个人在这里加一句 `t('…')` 会拿到
     * 一个 Timeout 对象（错误信息还指向别处）。这是接任包里点名过的坑（第 9 条），
     * 本笔顺手改掉（纯改名，行为零变化）。
     */
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
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
        ? { tone: 'ok', text: t('library.flash.copied') }
        : { tone: 'warn', text: t('library.flash.copyFailed') },
    );
    // 有意不翻：logUser 的分组键与消息（team-lead 裁定，见文件头 ③）
    if (ok) logUser('行业库', `复制生成 prompt${attachRef ? `（附 ${libs.length} 个现有库作参照）` : ''}`);
  }, [note, attachRef, libs, t]);

  /** ⑥-3 一键复制全部错误，贴回给 Agent 修正——闭环回流程 ② */
  const onCopyErrors = useCallback(async () => {
    if (!failure) return;
    const text =
      failure.kind === 'file'
        ? // 有意不翻：这段是**发给用户自己 Agent 的载荷**（贴进剪贴板），不是界面文案
          `我的行业包导入失败了：${failure.message}。请修复后重新只输出一个 JSON 代码块。`
        : buildAgentFeedbackText(failure.issues, failure.raw);
    const ok = await copyText(text);
    setFlash(
      ok
        ? { tone: 'ok', text: t('library.flash.errorsCopied') }
        : { tone: 'warn', text: t('library.flash.copyFailed') },
    );
  }, [failure, t]);

  /**
   * ③ 导回校验：文件级 / schema 级失败分流，成功落确认卡。
   * ④（F1-③）**落库失败**也是失败：settings.set 抛错 → 复用文件级失败卡说明「未导入」，
   *   不再出现「选完文件、框空了、什么都没发生」的静默面。
   */
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
            message: t('library.err.tooLarge', {
              max: MAX_MB_LABEL,
              size: Math.ceil(file.size / 1024),
            }),
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
            message: t('library.err.notJson'),
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
      } catch {
        /*
          ★ 落库失败零反馈的修复（审计 F1-③）。
          修复前：`finally` 之前没有 catch —— `repos.settings.set` 抛错（IndexedDB 配额
          用满、库被降级、隐私模式禁用存储…）时，onPick 的 Promise 静默 reject，界面
          什么也不说，而 finally 已经把文件选择框清空。用户看到的是「选完文件、框空了、
          什么都没发生」，只能再选一次、再空一次——永远查不出原因（错误只进本地日志，
          要专门去导出才看得见）。
          这里复用**既有的**文件级失败卡（零新 UI），文案把「没导入」说死：校验全过了
          但没落盘，最可能的解释就是空间不足。
        */
        setFailure({
          kind: 'file',
          message: t('library.err.persistFailed'),
        });
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [repos, t],
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
    // 有意不翻：这是**落盘的默认文件名**（数据侧），不是界面文案
    a.download = `${lib.name || '行业库'}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // ★ revoke 让出一拍：同步 revoke 与下载启动存在竞态（同 backup.service 手法）
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setFlash({ tone: 'ok', text: t('library.exported', { name: lib.name }) });
    logUser('行业库', `导出「${lib.name}」`);
  }, [t]);

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
          {t('library.title')}
        </h3>
      </div>
      <div className="rounded-[10px] border border-line bg-cream/50 px-3 py-2.5 text-xs leading-6">
        {/* ① 三步常驻条（她 #6.2：先教怎么生出文件，再谈导入） */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-mist">
          <li className="flex items-center gap-1">
            <span className="text-mist/70">①</span>{t('library.step.copy')}
          </li>
          <li aria-hidden className="text-mist/50">→</li>
          <li className="flex items-center gap-1">
            <span className="text-mist/70">②</span>{t('library.step.agent')}
          </li>
          <li aria-hidden className="text-mist/50">→</li>
          <li className="flex items-center gap-1">
            <span className="text-mist/70">③</span>{t('library.step.back')}
          </li>
        </ol>
        <p className="mt-1 text-[11px] text-mist">
          {t('library.introPre', { size: MAX_MB_LABEL })}
          <code className="rounded bg-line/60 px-1">usr.</code>
          {t('library.introPost')}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="custom-library-note">
            {t('library.noteLabel')}
          </label>
          <textarea
            id="custom-library-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('library.notePlaceholder')}
            className="soft-input min-w-[220px] flex-1 rounded-[10px] px-2.5 py-1.5 text-xs leading-5 text-ink outline-none placeholder:text-mist/70"
          />
          <button
            type="button"
            data-testid="library-copy-prompt"
            onClick={() => void onCopyPrompt()}
            className="soft-btn-primary soft-press soft-focus-halo flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            <ClipboardCopy size={13} aria-hidden />
            {t('library.copyPrompt')}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="soft-btn-ghost soft-focus-halo flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={13} aria-hidden />}
            {t('library.import')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={t('library.importAria')}
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
          <label className="flex items-center gap-1.5 text-[11px] text-mist">
            <input
              type="checkbox"
              checked={attachRef}
              onChange={(e) => setAttachRef(e.target.checked)}
              className="accent-pine"
            />
            {t('library.attachRef', { count: libs.length })}
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
              {t('library.importedCard', {
                name: success.name,
                items: success.items,
                presets: success.presets,
                // 有意不翻：domainLabel 是模块级、不订阅语言（内置行业名属未拍板的 C 灰区）
                domain: domainLabel(success.domain),
              })}
            </p>
            <button
              type="button"
              onClick={() => setSuccess(null)}
              aria-label={t('library.closeSuccessAria')}
              className="ml-auto shrink-0 rounded-md p-0.5 text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        )}

        {/* ⑥ 失败路径人话化：预告卡（最常见三种）→ 逐条错误 → 一键复制 */}
        {failure && (
          <div className="mt-2 space-y-1.5">
            {/* 有意不翻：h.title / h.fix 的取值来自 custom-library.prompt.ts（提示词载荷模块，不在本笔范围） */}
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
              {t('library.copyAllErrors')}
            </button>
          </div>
        )}

        {libs.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {libs.map((lib) => (
              <li key={lib.name} className="flex items-center gap-2 py-1.5">
                <span className="truncate text-ink">{lib.name}</span>
                <span className="shrink-0 text-[10px] text-mist">
                  {t('library.rowMeta', {
                    items: lib.items.length,
                    presets: lib.presets.length,
                    // 有意不翻：同 success 卡（domainLabel 不订阅语言）
                    domain: domainLabel(lib.domain),
                  })}
                </span>
                <button
                  type="button"
                  data-testid={`library-export-${lib.name}`}
                  onClick={() => onExport(lib)}
                  aria-label={t('library.exportAria', { name: lib.name })}
                  className="ml-auto shrink-0 rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-pine"
                >
                  <Download size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  data-testid={`library-remove-${lib.name}`}
                  onClick={() => void onRemove(lib.name)}
                  aria-label={t('library.removeAria', { name: lib.name })}
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
            {t('library.empty')}
          </p>
        )}
      </div>
    </section>
  );
}
