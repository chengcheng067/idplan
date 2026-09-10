/**
 * handoff bundle 面板（v0.6 · Egress R1，设计文档 T12 要点 7 / PRD §6 V6）。
 *
 * 范围选择（Ready / 全部 / 指定批次）→ handoff.buildHandoffBundle → 预览 +
 * 「复制」+「下载 .md」（Blob 下载范式，与 downloadBackup 同款）。
 * 安全边界（HF-04）：bundle 生成器从类型层面不收 Member 实体，本面板只传
 * 「id → 展示名」纯字符串映射；预览区等宽字体全量展示，用户复制前可人工审阅。
 */

import { useMemo, useState } from 'react';

import { Copy, Download, X } from 'lucide-react';

import type { Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { useMembersStore } from '../../store/useMembersStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { buildHandoffBundle } from '../../core/agent/handoff';
import { computeReadyTasks } from '../../core/agent/dag';
import { termFor } from '../../constants/agentTerms';
import { useLayoutStore } from '../../store/useLayoutStore';
import { cn } from '../../lib/cn';

type HandoffScope = 'ready' | 'all' | 'stage';

export function HandoffPanel({
  projectName,
  stages,
  tasks,
  onClose,
}: {
  /** 预留：未来按项目缓存生成的 bundle */
  projectId: string;
  projectName: string;
  stages: Array<{ id: string; name: string }>;
  tasks: readonly Task[];
  onClose(): void;
}): JSX.Element {
  const members = useMembersStore((s) => s.members);
  const pushToast = useProjectsStore((s) => s.pushToast);

  const [scope, setScope] = useState<HandoffScope>('ready');
  const [stageId, setStageId] = useState<string>(stages[0]?.id ?? '');
  /** 术语模式（human 人话 / tech 技术）：T04 起必须显式传入，无缺省（§4.4） */
  const termMode = useLayoutStore((s) => s.agentBoardMode);

  /** memberId → 展示名（agent 显示 agentKind；HF-04：绝不传 Member 实体） */
  const assigneeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.id] = m.actorKind === 'agent' && m.agentKind ? m.agentKind : m.name;
    }
    return map;
  }, [members]);

  /** 纯派生：scope → bundle 文本 + 生成时间（useMemo 内零副作用，不写 store） */
  const { text, generatedAt } = useMemo(() => {
    if (scope === 'stage' && !stageId) return { text: '', generatedAt: '' };
    const ready = computeReadyTasks([...tasks]).ready;
    const readySet = new Set(ready.map((t) => t.id));
    const { blocked, layerIndex } = computeReadyTasks([...tasks]);
    const inScope = (t: Task): boolean =>
      scope === 'ready'
        ? readySet.has(t.id)
        : scope === 'stage'
          ? t.stageId === stageId
          : true;
    // 已完成前置映射（QA 返工 🟡-2）：handoff 的「前置已完成」行如实列出
    const doneTaskTitles = new Map(
      [...tasks].filter((t) => taskIsDone(t)).map((t) => [t.id, t.title] as const),
    );
    const bundle = buildHandoffBundle({
      projectName,
      generatedAt: new Date().toISOString(),
      ready: scope === 'ready' ? ready : [...tasks].filter((t) => readySet.has(t.id)),
      blocked: blocked.filter((b) => inScope(b.task)),
      layerIndex,
      agentKindLabel: null,
      assigneeLabels,
      doneTaskTitles,
    });
    return { text: bundle, generatedAt: new Date().toISOString() };
    // assigneeLabels 已按 members 记忆化；tasks 变化时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, stageId, tasks, assigneeLabels, projectName]);

  const copy = async (): Promise<void> => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      pushToast('success', `${termFor('handoff', termMode)} 已复制到剪贴板`);
    } catch {
      pushToast('error', '复制失败（剪贴板不可用），请手动全选预览区文本复制。');
    }
  };

  const download = (): void => {
    if (!text.trim()) return;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `handoff-${projectName}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', `${termFor('handoff', termMode)} 已下载为 .md`);
  };

  return (
    <div className="glass-strong iridescent-border dialog-pop flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl p-5 shadow-soft outline-none">
      {/* 头部 */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="font-display text-display-md">
          {termFor('handoff', termMode)}{' '}
          <span className="text-xs font-normal text-mist">（给下一个 Agent 的 prompt 包）</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded-md p-1 text-mist hover:bg-sand"
        >
          <X size={16} />
        </button>
      </div>

      {/* 范围选择 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ['ready', `${termFor('ready', termMode)}（推荐）`],
            ['all', '全部任务'],
            ['stage', `指定${termFor('stageShort', termMode)}`],
          ] as Array<[HandoffScope, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setScope(key)}
            aria-pressed={scope === key}
            className={cn(
              'rounded-[8px] border px-2.5 py-1 transition-colors',
              scope === key
                ? 'border-pine bg-pine text-white'
                : 'border-line text-mist hover:bg-sand hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
        {scope === 'stage' && (
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="rounded-[8px] border border-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-pine"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 预览（等宽、全量展示供人工审阅敏感信息） */}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-[12px] border border-line bg-paper p-3 font-mono text-[11px] leading-5 text-ink">
        {text || '（当前范围为空，无可生成内容。）'}
      </pre>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] text-mist">
          内容不含成员敏感字段（contact / passwordHash）；生成时间 {generatedAt.slice(0, 10) || '—'}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-md border border-pine px-3 py-1.5 text-sm text-pine transition-colors hover:bg-pine-soft"
          >
            <Copy size={13} aria-hidden /> 复制
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-md bg-pine px-3 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep"
          >
            <Download size={13} aria-hidden /> 下载 .md
          </button>
        </div>
      </div>
    </div>
  );
}
