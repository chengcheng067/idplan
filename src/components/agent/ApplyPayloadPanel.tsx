/**
 * Apply payload 面板（v0.6 · Ingress W1，设计文档 T10 / PRD §6.1）。
 *
 * 三态 UI：校验失败（红色区逐条 path+message）→ 差异预览（created/updated/rejected
 * 徽标 + rejected 明细）→ 确认写入。
 *
 * AF-01「50 条 ≤ 2 次点击」：粘贴 / 拖入后**自动触发** previewPayload（无「校验」按钮），
 * 用户只点「确认写入」= 1 次点击。
 * 失败纪律：任何失败保留面板与用户输入（**不清空输入框**）；写入成功才关闭面板。
 * 输入通道：textarea 粘贴 + 拖拽 .json/.md（FileReader.readAsText 纯文本读取，
 * 不做二进制文档解析——本面板只接受用户手工粘贴/导出的纯文本载荷）。
 * .md / 非 JSON 起始 → markdown-ingest.parseMarkdownTasks；否则 JSON.parse + validate。
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { Check, Copy, Info, Sparkles, Upload, X } from 'lucide-react';

import { useRepos } from '../../hooks/useRepos';
import { useAgentStore } from '../../store/useAgentStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import {
  AGENT_PAYLOAD_SCHEMA_ID,
  tryValidateAgentPayload,
} from '../../core/types/agent-payload';
import type { AgentPayloadV1, ApplyResult } from '../../core/types/agent-payload';
import { parseMarkdownTasks } from '../../core/agent/markdown-ingest';
import { termFor, useLang } from '../../i18n';
import { useLayoutStore } from '../../store/useLayoutStore';
import { cn } from '../../lib/cn';

type PanelState =
  | { phase: 'input' }
  | { phase: 'invalid'; issues: Array<{ path: string; message: string }> }
  | { phase: 'preview'; payload: AgentPayloadV1; result: ApplyResult };

/**
 * 喂给外部 Agent（WorkBuddy / Codex / DeepSeek…）的**提示词模板**（反馈 #9）。
 *
 * ── 为什么内置在软件里 ──
 *   用户的真实困惑是「我不知道该让 WorkBuddy 输出什么，也不知道令牌在哪」。
 *   让他自己去读契约再手写提示词，等于把集成成本全丢给用户。
 *   这里给一段**可直接复制**的提示词 + 一份**与契约同源**的 JSON 骨架，
 *   外部 Agent 照着输出，用户复制粘贴回来即可（手动通道，也是 V1 的兜底通道）。
 *
 * ── 为什么**不含令牌** ──
 *   本提示词是「让 Agent 生成排期内容」，与写入通道的访问令牌无关；
 *   令牌是给**自动导入通道**用的（在「导入任务 → 接入配置」里设置与复制）。
 *   把令牌写进要贴到聊天窗口的提示词里 = 主动泄漏，故这里刻意只留说明、不留值。
 *
 * ── 为什么**不随界面语言翻译**（2026-08-27 · 英文线，有意保留中文）──
 *   **读者不是用户，是外部 Agent**：这段文本是**指令契约**，字段名（schema /
 *   producedBy / externalId …）与 `idplan-agent-payload/v1` 的校验口径一一对应。
 *   翻译它 = 把**同一份契约拆成两种文本**：中英两个 Agent 会被要求产出不同的东西，
 *   而校验器只有一套 —— 英文用户拿到的提示词只会更难对上校验错误信息。
 *   ⇒ 整段保持中文，并在 `<pre>` 上标 `lang="zh-CN"`（告诉浏览器与读屏器「这段是
 *     中文」，别按界面语言处理）。
 *   ⇒ 内容侧已有锁：`tests/agent-prompt-template.spec.ts`（断言模板里含
 *     `只输出 JSON 本体` / schema id / 七种 status / `YYYY-MM-DD`，且**不含**
 *     `token` 与「令牌」）—— 它就是「这段是中文字面量」这件事的机器凭证。
 *   ⇒ 若将来真要服务英文 Agent，正确做法是**两份契约文本 + 同步的校验口径**，
 *     不是就地翻译这一份。
 */
export const PROMPT_TEMPLATE = `你是一名排期助手。请把我的需求整理成「ID Plan」可以直接导入的 JSON，**只输出 JSON 本体**（不要解释文字、不要 Markdown 代码围栏）。

硬性要求：
1. 顶层 schema 必须恰好是字符串 "idplan-agent-payload/v1"；projectId / stageId 填 null（导入时我自己选落点）。
2. producedBy 必填四项：actorKind 填 "agent"；agentKind 填你的名字（如 "workbuddy"）；agentName 填展示名；runId 填本次运行的独立标识。
3. tasks[] 每项都写全这些字段，没有的填 null 或空数组，**不要省略字段**：
   externalId（项目内唯一、稳定、**不要包含 runId**）、title、description、status、
   assigneeAgentKind、assigneeHuman、dependsOnExternal、startAt、dueDate、artifacts。
4. status 只能取：draft / ready / claimed / in_progress / blocked / review / done（默认 draft）。
5. 日期一律 "YYYY-MM-DD"；不确定就写 null，不要写「下周」「月底」这类相对时间。
6. 任务有先后依赖时，用 dependsOnExternal 引用另一条任务的 externalId（只引用本批次或历史批次里出现过的 externalId）。

参考骨架：
{
  "schema": "idplan-agent-payload/v1",
  "projectId": null,
  "stageId": null,
  "producedBy": { "actorKind": "agent", "agentKind": "workbuddy", "agentName": "WorkBuddy", "runId": "run-20260917-01" },
  "tasks": [
    {
      "externalId": "workbuddy:concept-01",
      "title": "概念方案初稿",
      "description": null,
      "status": "draft",
      "assigneeAgentKind": null,
      "assigneeHuman": null,
      "dependsOnExternal": [],
      "startAt": "2026-10-01",
      "dueDate": "2026-10-08",
      "artifacts": []
    }
  ]
}

我的需求如下：
<在这里粘贴你的需求、聊天记录或资料>`;

/** 判定输入是否「非 JSON 起始」→ 走 Markdown 清单通道 */
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[');
}

/** 非空行号提示（校验失败区的原文行号辅助） */
function lineHints(text: string): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter((x) => x.line.length > 0)
    .slice(0, 3)
    .map((x) => `L${x.no}: ${x.line.slice(0, 40)}`);
}

export function ApplyPayloadPanel({
  projectId,
  onClose,
  onCommitted,
}: {
  /** 目标项目（Agent Board 当前选中）；payload 自带 projectId 时以其为准 */
  projectId: string | null;
  onClose(): void;
  /** 写入成功回调（关闭面板 + 刷新看板由父级负责） */
  onCommitted(result: ApplyResult): void;
}): JSX.Element {
  /** 取词 + 语言变化订阅点（面板文案在渲染期取） */
  const { t } = useLang();
  const repos = useRepos();
  const previewPayload = useAgentStore((s) => s.previewPayload);
  const commitPayload = useAgentStore((s) => s.commitPayload);
  const pushToast = useProjectsStore((s) => s.pushToast);
  /** 术语模式（human 人话 / tech 技术）：T04 起必须显式传入，无缺省（§4.4） */
  const termMode = useLayoutStore((s) => s.agentBoardMode);

  const [text, setText] = useState('');
  const [state, setState] = useState<PanelState>({ phase: 'input' });
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 提示词是否已复制（按钮文案反馈；复制失败保持 false，不假装成功） */
  const [promptCopied, setPromptCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 统一入口：解析文本 → 校验/预览（自动触发，无需点「校验」） */
  const analyze = useCallback(
    async (raw: string): Promise<void> => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setState({ phase: 'input' });
        return;
      }
      try {
        let payloadJson: unknown;
        if (looksLikeJson(trimmed)) {
          payloadJson = JSON.parse(trimmed);
        } else {
          // Markdown 清单通道：parseMarkdownTasks 直接产出完整 payload
          //（md 无真实产出者身份，给占位 identity；runId 用时间戳保证 externalId 不撞）
          payloadJson = parseMarkdownTasks(trimmed, {
            actorKind: 'agent',
            agentKind: 'markdown',
            agentName: t('ui.applyPayload.markdownAgentName'),
            runId: `md-${Date.now()}`,
          });
        }
        const validated = tryValidateAgentPayload(payloadJson);
        if (!validated.ok) {
          setState({ phase: 'invalid', issues: validated.issues });
          return;
        }
        const result = await previewPayload(repos, validated.payload, projectId ?? undefined);
        if (!result) {
          setState({ phase: 'input' }); // store 已 toast 具体原因
          return;
        }
        setState({ phase: 'preview', payload: validated.payload, result });
      } catch (err) {
        // JSON.parse 失败等：红色区提示，不清空输入
        setState({
          phase: 'invalid',
          issues: [{ path: '(root)', message: (err as Error)?.message ?? t('agentPayload.parseFailed') }],
        });
      }
    },
    [previewPayload, projectId, repos, t],
  );

  const readFile = useCallback(
    (file: File): void => {
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result ?? '');
        setText(content);
        void analyze(content);
      };
      reader.readAsText(file);
    },
    [analyze],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!/\.(json|md|markdown|txt)$/i.test(file.name)) {
        pushToast('error', t('agentPayload.dropUnsupported'));
        return;
      }
      readFile(file);
    },
    [pushToast, readFile, t],
  );

  const commit = useCallback(async (): Promise<void> => {
    if (state.phase !== 'preview' || busy) return;
    setBusy(true);
    try {
      const result = await commitPayload(repos, state.payload, projectId ?? undefined);
      if (result) {
        onCommitted(result); // 成功才关面板；失败 commitPayload 已 toast 且输入保留
      }
    } finally {
      setBusy(false);
    }
  }, [busy, commitPayload, onCommitted, projectId, repos, state]);

  return (
    <div className="glass-strong iridescent-border dialog-pop flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl p-5 shadow-soft outline-none">
      {/* 头部 */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="font-display text-display-md">
          {termFor('applyPayload', termMode)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="rounded-md p-1 text-mist hover:bg-sand"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-[12px] bg-sunken px-3.5 py-2.5 text-xs text-mist">
        <Info size={13} className="mt-0.5 shrink-0 text-pine" aria-hidden />
        {/*
          一句话拆成多段的接缝规则（详见 `src/i18n/messages/en.ts` 文件头 ⑤ 与守卫
          `tests/i18n-jsx-space.spec.ts`）：
            · **段间**空格中英都需要 ⇒ 只能写在英文取值里（惯例：段尾）；
            · **句间**空格中英都需要 ⇒ 在这里用 `{' '}` 显式写出来。
          改这三句时别把 `{' '}` 删了 —— 删了文案会变成「…即用）。Windows 桌面…」。
        */}
        <span>
          {t('agentPayload.hintPastePre')}
          <strong className="text-ink">{t('agentPayload.hintPasteStrong')}</strong>
          {t('agentPayload.hintPastePost')}
          {' '}
          {t('agentPayload.hintDesktopPre')}
          <strong className="text-ink">{t('agentPayload.hintDesktopStrong')}</strong>
          {t('agentPayload.hintDesktopPost')}
          {' '}
          {t('agentPayload.hintNas')}
        </span>
      </div>

      {/* ---------------- 提示词模板（反馈 #9：不知道该让 Agent 输出什么） ---------------- */}
      <details
        data-apply-prompt=""
        className="mb-3 rounded-[12px] border border-line bg-cream/50 px-3.5 py-2.5 text-xs text-mist"
      >
        <summary className="cursor-pointer select-none text-ink">
          <Sparkles size={12} className="mr-1 inline align-[-1px] text-pine" aria-hidden />
          {t('agentPayload.promptAsk')}
        </summary>

        <p className="mt-2 leading-relaxed">
          {t('agentPayload.promptSend')}
          {t('agentPayload.promptPaste')}
        </p>

        {/* 模板整段**有意保持中文**（指令契约，见本文件头；`lang` 标出来免得被按界面语言处理） */}
        <pre
          data-apply-prompt-body=""
          lang="zh-CN"
          className="mt-2 max-h-64 overflow-auto rounded-[10px] border border-line bg-paper p-2.5 font-mono text-[11px] leading-5 text-ink"
        >
          {PROMPT_TEMPLATE}
        </pre>

        <button
          type="button"
          data-apply-prompt-copy=""
          onClick={() => {
            void navigator.clipboard?.writeText(PROMPT_TEMPLATE).then(
              () => setPromptCopied(true),
              // 剪贴板被拒时**不假装成功**：提示用户手动全选复制
              () => setPromptCopied(false),
            );
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-paper px-3 py-1.5 text-xs text-ink transition-colors hover:bg-sunken"
        >
          {promptCopied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {promptCopied ? (
            t('agentPayload.copyPromptDone')
          ) : (
            t('agentPayload.copyPrompt')
          )}
        </button>

        {/* 令牌是**另一个通道**的事：这里说清它不在提示词里，避免用户把令牌贴进聊天窗口 */}
        <p className="mt-2 leading-relaxed">
          {t('agentPayload.tokenPre')}
          <strong className="text-ink">{t('agentPayload.tokenStrongA')}</strong>
          {t('agentPayload.tokenMid')}
          <strong className="text-ink">{t('agentPayload.tokenStrongB')}</strong>
          {t('agentPayload.tokenTail')}
        </p>
      </details>

      {/* 输入区：粘贴 textarea + 拖拽区一体（AF-01：粘贴即预览） */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-[12px] border border-dashed p-3 transition-colors',
          dragOver ? 'border-pine bg-pine-soft' : 'border-line',
        )}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void analyze(text)}
          placeholder={t('agentPayload.pastePlaceholder', { schema: AGENT_PAYLOAD_SCHEMA_ID })}
          rows={8}
          spellCheck={false}
          className="w-full resize-y rounded-[10px] border border-line bg-paper p-3 font-mono text-xs leading-5 text-ink outline-none focus:border-pine"
        />
        <div className="mt-2 flex items-center gap-2 text-[11px] text-mist">
          <Upload size={12} aria-hidden />
          {/* 三件都是 **flex 项**（容器 `gap-2`）⇒ 视觉间距由 flex 给，文案里不带空格 */}
          {t('agentPayload.dropOr')}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-pine underline underline-offset-2"
          >
            {t('agentPayload.chooseFile')}
          </button>
          {t('agentPayload.afterPaste')}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = ''; // 允许重复选同一文件
            }}
          />
        </div>
      </div>

      {/* 态一：校验失败（红色区，逐条 path+message；不清空输入） */}
      {state.phase === 'invalid' && (
        <div role="alert" className="mt-3 rounded-[12px] border border-clay/50 bg-clay-soft p-3">
          <p className="mb-1.5 text-xs font-semibold text-clay">{t('agentPayload.invalidTitle')}</p>
          <ul className="flex flex-col gap-1">
            {state.issues.slice(0, 20).map((issue, i) => (
              <li key={`${issue.path}-${i}`} className="font-mono text-[11px] text-clay">
                {issue.path}: {issue.message}
              </li>
            ))}
            {state.issues.length > 20 && (
              <li className="text-[11px] text-clay">
                {t('agentPayload.moreErrors', { count: state.issues.length - 20 })}
              </li>
            )}
          </ul>
          <p className="mt-1.5 text-[10px] text-mist">{lineHints(text).join(' ｜ ')}</p>
        </div>
      )}

      {/* 态二：差异预览（三徽标 + rejected 明细） */}
      {state.phase === 'preview' && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[8px] bg-pine-soft px-2.5 py-1 font-mono text-xs text-pine">
              created {state.result.created}
            </span>
            <span className="rounded-[8px] bg-sand px-2.5 py-1 font-mono text-xs text-mist">
              updated {state.result.updated}
            </span>
            <span
              className={cn(
                'rounded-[8px] px-2.5 py-1 font-mono text-xs',
                state.result.rejected.length > 0 ? 'bg-clay-soft text-clay' : 'bg-sand text-mist',
              )}
            >
              rejected {state.result.rejected.length}
            </span>
          </div>

          {state.result.rejected.length > 0 && (
            <table className="mt-2 w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="text-mist">
                  <th className="border-b border-line py-1 pr-2 font-medium">externalId</th>
                  <th className="border-b border-line py-1 pr-2 font-medium">code</th>
                  <th className="border-b border-line py-1 font-medium">reason</th>
                </tr>
              </thead>
              <tbody>
                {state.result.rejected.map((r) => (
                  <tr key={`${r.externalId}-${r.code}`}>
                    <td className="border-b border-line/50 py-1 pr-2 font-mono text-ink">{r.externalId}</td>
                    <td className="border-b border-line/50 py-1 pr-2 font-mono text-clay">{r.code}</td>
                    <td className="border-b border-line/50 py-1 text-mist">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 态三：确认写入（AF-01 的第 2 次点击） */}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setState({ phase: 'input' })}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              {t('agentPayload.editAgain')}
            </button>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy || (state.result.created === 0 && state.result.updated === 0)}
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {busy ? t('agentPayload.writing') : t('agentPayload.confirmWrite')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
