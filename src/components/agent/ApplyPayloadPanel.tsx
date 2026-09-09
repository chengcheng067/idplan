/**
 * Apply payload 面板（v0.6 · Ingress W1，设计文档 T10 / PRD §6.1）。
 *
 * 三态 UI：校验失败（红色区逐条 path+message）→ 差异预览（created/updated/rejected
 * 徽标 + rejected 明细）→ 确认写入。
 *
 * AF-01「50 条 ≤ 2 次点击」：粘贴 / 拖入后**自动触发** previewPayload（无「校验」按钮），
 * 用户只点「确认写入」= 1 次点击。
 * 失败纪律：任何失败保留面板与用户输入（**不清空输入框**）；写入成功才关闭面板。
 * 输入通道：textarea 粘贴 + 拖拽 .json/.md（FileReader.readAsText 纯文本，
 * 不复用 file-extractors——那是 pdf/docx 二进制提取）。
 * .md / 非 JSON 起始 → markdown-ingest.parseMarkdownTasks；否则 JSON.parse + validate。
 */

import { useCallback, useRef, useState } from 'react';

import { Upload, X } from 'lucide-react';

import { useRepos } from '../../hooks/useRepos';
import { useAgentStore } from '../../store/useAgentStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import {
  AGENT_PAYLOAD_SCHEMA_ID,
  tryValidateAgentPayload,
} from '../../core/types/agent-payload';
import type { AgentPayloadV1, ApplyResult } from '../../core/types/agent-payload';
import { parseMarkdownTasks } from '../../core/agent/markdown-ingest';
import { termFor } from '../../constants/agentTerms';
import { cn } from '../../lib/cn';

type PanelState =
  | { phase: 'input' }
  | { phase: 'invalid'; issues: Array<{ path: string; message: string }> }
  | { phase: 'preview'; payload: AgentPayloadV1; result: ApplyResult };

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
  const repos = useRepos();
  const previewPayload = useAgentStore((s) => s.previewPayload);
  const commitPayload = useAgentStore((s) => s.commitPayload);
  const pushToast = useProjectsStore((s) => s.pushToast);

  const [text, setText] = useState('');
  const [state, setState] = useState<PanelState>({ phase: 'input' });
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
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
            agentName: 'Markdown 清单导入',
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
          issues: [{ path: '(root)', message: (err as Error)?.message ?? '解析失败' }],
        });
      }
    },
    [previewPayload, projectId, repos],
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
        pushToast('error', '仅支持 .json / .md 纯文本文件（pdf/docx 请先由 Agent 转出 payload）。');
        return;
      }
      readFile(file);
    },
    [pushToast, readFile],
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
        <h2 className="font-display text-display-md">{termFor('applyPayload')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded-md p-1 text-mist hover:bg-sand"
        >
          <X size={16} />
        </button>
      </div>

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
          dragOver ? 'border-pine bg-pine-soft' : 'border-sand',
        )}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void analyze(text)}
          placeholder={`粘贴 payload JSON，或拖入 .json / .md 文件……\n（${AGENT_PAYLOAD_SCHEMA_ID}）`}
          rows={8}
          spellCheck={false}
          className="w-full resize-y rounded-[10px] border border-sand bg-paper p-3 font-mono text-xs leading-5 text-ink outline-none focus:border-pine"
        />
        <div className="mt-2 flex items-center gap-2 text-[11px] text-mist">
          <Upload size={12} aria-hidden />
          拖入文件或
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-pine underline underline-offset-2"
          >
            选择文件
          </button>
          ；粘贴完成后自动生成差异预览。
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
          <p className="mb-1.5 text-xs font-semibold text-clay">payload 校验失败（未写入任何数据）</p>
          <ul className="flex flex-col gap-1">
            {state.issues.slice(0, 20).map((issue, i) => (
              <li key={`${issue.path}-${i}`} className="font-mono text-[11px] text-clay">
                {issue.path}: {issue.message}
              </li>
            ))}
            {state.issues.length > 20 && (
              <li className="text-[11px] text-clay">……另有 {state.issues.length - 20} 条错误未展示。</li>
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
                  <th className="border-b border-sand py-1 pr-2 font-medium">externalId</th>
                  <th className="border-b border-sand py-1 pr-2 font-medium">code</th>
                  <th className="border-b border-sand py-1 font-medium">reason</th>
                </tr>
              </thead>
              <tbody>
                {state.result.rejected.map((r) => (
                  <tr key={`${r.externalId}-${r.code}`}>
                    <td className="border-b border-sand/50 py-1 pr-2 font-mono text-ink">{r.externalId}</td>
                    <td className="border-b border-sand/50 py-1 pr-2 font-mono text-clay">{r.code}</td>
                    <td className="border-b border-sand/50 py-1 text-mist">{r.reason}</td>
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
              className="rounded-md border border-sand px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              重新编辑
            </button>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy || (state.result.created === 0 && state.result.updated === 0)}
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {busy ? '写入中…' : '确认写入'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
