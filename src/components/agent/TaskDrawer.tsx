/**
 * 任务详情抽屉（v0.6 · 设计文档 T12 / PRD §6.2）。
 *
 * 四区块：① 概要 ② description（轻量 Markdown：标题/列表/代码块/粗体，自实现
 * 转义防注入，不引 markdown 库）③ deps（前置+后继，可点跳转）④ artifacts 列表。
 *
 * 纪律：
 *   - 状态流转按钮只渲染 `TASK_STATUS_TRANSITIONS[current]` 允许的目标态
 *     （UI 层就不给非法选项；服务层 assertTransition 再兜一次）；
 *   - 「认领」走 useAgentStore.claimTask（原子；冲突 toast 文案并保持抽屉打开）；
 *   - 空值兜底 `—`（SC-02：全字段有渲染位、空值有兜底文案）；
 *   - artifacts 路径：浏览器无法探测本地路径存在性（AF-02）→ 降级为「复制路径 +
 *     提示无法在浏览器中直接打开」；url → 新窗打开 rel="noopener noreferrer"；
 *   - 移动端全屏（<sm w-full），桌面右侧滑出（复用 Modal placement="right"）。
 */

import { useMemo } from 'react';

import { Bot, Copy, ExternalLink, FileText, Link2, User } from 'lucide-react';

import type { Task } from '../../core/types/entities';
import { TASK_STATUS_TRANSITIONS } from '../../core/types/enums';
import type { TaskStatus } from '../../core/types/enums';
import { useRepos } from '../../hooks/useRepos';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useAgentStore } from '../../store/useAgentStore';
import { useMembersStore } from '../../store/useMembersStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { termFor } from '../../constants/agentTerms';
import { StatusBadge } from './AgentTaskCard';
import { Modal } from '../common/Modal';
import { remainingDays } from '../../lib/date';

/* ------------------------- 轻量 Markdown 渲染（转义防注入） ------------------------- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内粗体 `**x**` → <strong>（已转义后处理，无注入面） */
function inlineBold(escaped: string): string {
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** 轻量 Markdown：标题(#/##/###)、无序/有序列表、代码块(``` 围栏)、粗体。其余按段落。 */
function renderMarkdownLite(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().startsWith('```')) {
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre class="rounded-md bg-sand/60 p-2 text-xs overflow-x-auto"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(raw));
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length + 3; // h4/h5/h6：抽屉内标题不抢页面层级
      out.push(
        `<h${level} class="mt-2 mb-1 text-sm font-semibold text-ink">${inlineBold(escapeHtml(heading[2]!))}</h${level}>`,
      );
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line.trim());
    if (ul) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul class="list-disc pl-5 text-sm text-ink/90">');
        listType = 'ul';
      }
      out.push(`<li>${inlineBold(escapeHtml(ul[1]!))}</li>`);
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    if (ol) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol class="list-decimal pl-5 text-sm text-ink/90">');
        listType = 'ol';
      }
      out.push(`<li>${inlineBold(escapeHtml(ol[1]!))}</li>`);
      continue;
    }
    if (line.trim() === '') {
      closeList();
      continue;
    }
    closeList();
    out.push(`<p class="mb-1 text-sm leading-6 text-ink/90">${inlineBold(escapeHtml(line))}</p>`);
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('');
}

/** Markdown 只读渲染容器（dangerouslySetInnerHTML 内容全部经 escapeHtml） */
function MarkdownView({ source }: { source: string | null }): JSX.Element {
  if (!source || !source.trim()) {
    return <p className="text-sm text-mist">—</p>;
  }
  return <div dangerouslySetInnerHTML={{ __html: renderMarkdownLite(source) }} />;
}

/* ------------------------------ artifacts 行 ------------------------------ */

const ARTIFACT_KIND_ICONS: Record<string, JSX.Element> = {
  task_md: <FileText size={13} aria-hidden />,
  doc: <FileText size={13} aria-hidden />,
  file: <FileText size={13} aria-hidden />,
  diff: <FileText size={13} aria-hidden />,
  link: <Link2 size={13} aria-hidden />,
  other: <FileText size={13} aria-hidden />,
};

function ArtifactRow({ a }: { a: Task['artifacts'][number] }): JSX.Element {
  const pushToast = useProjectsStore((s) => s.pushToast);
  const copyPath = async (): Promise<void> => {
    if (!a.path) return;
    try {
      await navigator.clipboard.writeText(a.path);
      // AF-02 降级提示：浏览器无法探测本地路径存在性，Electron 桌面端可经
      // desktopBridge 打开（§10-R5，V1）；Web 端明确告知「复制后自行在编辑器打开」
      pushToast('success', `路径已复制（浏览器无法直接打开本地路径，请粘贴到编辑器/终端）：${a.path}`);
    } catch {
      pushToast('error', '复制失败（剪贴板不可用），请手动选择路径文本复制。');
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-sand bg-cream/50 px-2.5 py-2 text-xs">
      <span className="text-mist">{ARTIFACT_KIND_ICONS[a.kind] ?? ARTIFACT_KIND_ICONS.other}</span>
      <span className="font-medium text-ink">{a.title}</span>
      <span className="rounded-[5px] bg-sand px-1.5 py-0.5 font-mono text-[10px] text-mist">{a.kind}</span>
      {a.path && (
        <>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-pine">{a.path}</code>
          <button
            type="button"
            onClick={() => void copyPath()}
            className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-sand px-2 py-0.5 text-[10px] text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            <Copy size={11} aria-hidden /> 复制路径
          </button>
        </>
      )}
      {a.url && (
        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-pine/40 px-2 py-0.5 text-[10px] text-pine transition-colors hover:bg-pine-soft"
        >
          <ExternalLink size={11} aria-hidden /> 打开
        </a>
      )}
      {a.note && <p className="w-full text-[10px] text-mist">{a.note}</p>}
    </li>
  );
}

/* --------------------------------- 主抽屉 --------------------------------- */

export function TaskDrawer({
  task,
  projectStages,
  onClose,
}: {
  task: Task | null;
  /** 当前项目的批次（用于渲染批次名；Agent Board 语境展示「批次（Batch）」） */
  projectStages: Array<{ id: string; name: string }>;
  onClose(): void;
}): JSX.Element | null {
  const repos = useRepos();
  const members = useMembersStore((s) => s.members);
  const { currentMember } = useRoleGuard();
  const claimTask = useAgentStore((s) => s.claimTask);
  const transitionTask = useAgentStore((s) => s.transitionTask);
  const openDrawer = useAgentStore((s) => s.openDrawer);
  const allTasks = useProjectsStore((s) => s.tasks);

  /** 后继（被本任务依赖的任务）——deps 双向导航 */
  const successors = useMemo(
    () => (task ? allTasks.filter((t) => (t.dependsOn ?? []).includes(task.id)) : []),
    [allTasks, task],
  );

  if (!task) return null;

  const stageName =
    projectStages.find((s) => s.id === task.stageId)?.name ?? '—';
  const assignee = task.assigneeId ? members.find((m) => m.id === task.assigneeId) : null;
  const agent = task.agentId ? members.find((m) => m.id === task.agentId) : null;
  const allowedTargets = TASK_STATUS_TRANSITIONS[task.status] ?? [];
  const canClaim = task.status === ('ready' as TaskStatus) && task.claimedAt === null;
  const dueDays = task.dueDate ? remainingDays(task.dueDate.slice(0, 10)) : null;

  /** 概要字段统一渲染（空值兜底 —，SC-02） */
  const Field = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-mist">{label}</dt>
      <dd className="truncate text-xs text-ink">{children ?? '—'}</dd>
    </div>
  );

  return (
    <Modal open onClose={onClose} placement="right" ariaLabel="任务详情">
      <div className="glass-strong flex h-full w-full flex-col overflow-y-auto rounded-none border-white/40 p-5 outline-none sm:w-[440px] sm:rounded-l-2xl">
        {/* 头部 */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {task.source === 'agent' ? (
              <Bot size={15} className="shrink-0 text-pine" aria-hidden />
            ) : (
              <User size={15} className="shrink-0 text-mist" aria-hidden />
            )}
            <h2 className="min-w-0 truncate font-display text-base font-semibold text-ink">
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭任务详情"
            className="shrink-0 rounded-md p-1 text-mist hover:bg-sand"
          >
            ✕
          </button>
        </div>

        {/* ① 概要 */}
        <section className="rounded-[12px] border border-sand bg-cream/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge status={task.status} />
            {task.source === 'agent' && agent?.agentKind && (
              <span className="rounded-[6px] bg-pine-soft px-1.5 py-0.5 font-mono text-[10px] text-pine">
                {agent.agentKind}
              </span>
            )}
            {canClaim && (
              <button
                type="button"
                onClick={() => claimTask(repos, task.id, currentMember?.id ?? task.assigneeId ?? '')}
                className="ml-auto rounded-[8px] border border-pine px-2.5 py-1 text-xs text-pine transition-colors hover:bg-pine-soft"
              >
                claim
              </button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2">
            <Field label="id">
              <span className="font-mono">{task.id}</span>
            </Field>
            <Field label="externalId">
              <span className="font-mono">{task.externalId ?? '—'}</span>
            </Field>
            <Field label="source">{task.source}</Field>
            <Field label="agentId">
              <span className="font-mono">{agent ? `${agent.name}` : (task.agentId ?? '—')}</span>
            </Field>
            <Field label="assignee">{assignee?.name ?? '—'}</Field>
            <Field label={termFor('stageShort')}>{stageName}</Field>
            <Field label="startAt">
              <span className="font-mono">{task.startAt?.slice(0, 10) ?? '—'}</span>
            </Field>
            <Field label="dueDate">
              <span className="font-mono">
                {task.dueDate ? `${task.dueDate.slice(0, 10)}` : '—'}
                {dueDays !== null && !taskIsDoneLocal(task) && (
                  <span className="ml-1 text-mist">（剩余 {dueDays} 天）</span>
                )}
              </span>
            </Field>
          </dl>

          {/* 状态流转：只渲染白名单允许的目标态（UI 层不给非法选项） */}
          {allowedTargets.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-mist">流转 →</span>
              {allowedTargets.map((to) => (
                <button
                  key={to}
                  type="button"
                  onClick={() => transitionTask(repos, task.id, to)}
                  className="rounded-[6px] border border-sand px-2 py-0.5 font-mono text-[10px] text-mist transition-colors hover:border-pine hover:text-pine"
                >
                  {to}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ② description（轻量 Markdown） */}
        <section className="mt-4">
          <h3 className="mb-1.5 text-xs font-semibold text-mist">description</h3>
          <MarkdownView source={task.description} />
        </section>

        {/* ③ deps（前置 + 后继，可点击跳转） */}
        <section className="mt-4">
          <h3 className="mb-1.5 text-xs font-semibold text-mist">{termFor('deps')}</h3>
          {(task.dependsOn?.length ?? 0) === 0 && successors.length === 0 ? (
            <p className="text-sm text-mist">—</p>
          ) : (
            <>
              {(task.dependsOn ?? []).length > 0 && (
                <p className="mb-1 text-[10px] text-mist">前置（blocks this）</p>
              )}
              <ul className="mb-2 flex flex-col gap-1">
                {(task.dependsOn ?? []).map((depId) => {
                  const dep = allTasks.find((t) => t.id === depId);
                  return (
                    <li key={depId}>
                      <button
                        type="button"
                        onClick={() => openDrawer(depId)}
                        className="w-full truncate rounded-[8px] bg-sand/50 px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-sand hover:text-pine"
                      >
                        ↑ <span className="font-mono text-[10px] text-mist">{depId}</span> {dep?.title ?? '（已删除）'}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {successors.length > 0 && (
                <>
                  <p className="mb-1 text-[10px] text-mist">后继（depends on this）</p>
                  <ul className="flex flex-col gap-1">
                    {successors.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => openDrawer(s.id)}
                          className="w-full truncate rounded-[8px] bg-sand/50 px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-sand hover:text-pine"
                        >
                          ↓ <span className="font-mono text-[10px] text-mist">{s.id}</span> {s.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        {/* ④ artifacts */}
        <section className="mt-4">
          <h3 className="mb-1.5 text-xs font-semibold text-mist">{termFor('artifacts')}</h3>
          {task.artifacts.length === 0 ? (
            <p className="text-sm text-mist">—</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {task.artifacts.map((a) => (
                <ArtifactRow key={a.id} a={a} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** 局部 done 判定（避免与导入名冲突；同 taskIsDone 语义） */
function taskIsDoneLocal(t: Pick<Task, 'status' | 'done'>): boolean {
  return t.status === 'done' || t.done === true;
}
