/**
 * Agent 看板列表（v0.8 · T04-B；设计文档 §4.1 文件清单第 11 项、PRD B6 / B14 / B15 / B16）。
 *
 * ── 两种状态，各有明确出口（B16：**现状最刺眼的问题**）──
 *   ① `boards.length > 0` → 卡片列表：每行一枚 Bot 图标 ＋ 浅靛底（`pine-soft`），
 *      当前看板高亮（`aria-current="page"`）。形态刻意是**列表**而不是人类首页那种
 *      项目卡网格 —— B15 要求「两个列表在同一屏（侧栏）中一眼可辨」；
 *   ② `boards.length === 0` → **明确空态**：说清"这里还没有东西"＋"下一步能做什么"。
 *      绝不复用人类项目数据来把面板填满：库里只有人类项目时，本组件渲染的仍然是空态
 *      （这正是 v0.8 要修掉的那条：Agent 页曾经列出一堆人类项目）。
 *
 * ── 数据来源 ──
 * 本组件是**纯展示**：`boards` 由调用方经漏斗（`visibility.ts` 的 `useAgentProjects()`）
 * 或 Agent 页自己的集合传入，组件自身**不读任何 store** —— 于是"喂错数据"这件事
 * 在调用点一眼可见（#20/#21 的接线纪律：页面禁止直接读 `store.projects`）。
 *
 * ── 消费方（两个，别当成只有一个）──
 *   · Agent 页：**无看板时**用它承载空态（含「新建 Agent 看板」入口）；
 *   · 侧栏（B14「在 Agent 侧时侧栏显示独立的『Agent 看板』列表」）：传入看板数组即可复用，
 *     故 `onCreate` 是可选的（只读场景不传，空态里就不出现新建按钮）。
 *     侧栏接线不在本文件、也不由本任务负责（Sidebar.tsx 归 T04 的另一半），
 *     这里只保证**组件本身**已按 B15 的形态与锚点就绪。
 *
 * ── 视觉与锚点 ──
 *   · 零新色：只用既有 token（paper/sunken/sand/line/ink/mist/pine/pine-soft）；
 *   · 圆角：本仓 `rounded-lg/xl/2xl` 全是 16px（tailwind.config.ts 重映射过），
 *     12px 必须写 `rounded-md`（写 `rounded-xl` 以为 12 是本项目栽过的坑）；
 *   · `data-agent-board-list` / `data-agent-board-item` / `data-agent-board-empty`
 *     是**验收用的稳定锚点**（与既有 `data-app-sidebar` / `data-board-hidden-hint`
 *     同一惯例）：让断言不必依赖中文文案或样式类名。
 */

import { Bot, Plus } from 'lucide-react';

import type { Project } from '../../core/types/entities';
import { cn } from '../../lib/cn';

export function AgentBoardList({
  boards,
  currentId,
  onSelect,
  onCreate,
}: {
  /** 只应传 `kind === 'agent'` 的看板（喂给人类项目是调用方的错，本组件不替它兜） */
  boards: readonly Project[];
  /** 当前选中的看板 id；不在 `boards` 里时视为"未选中"（不高亮） */
  currentId: string | null;
  onSelect(boardId: string): void;
  /** 空态里的「新建 Agent 看板」入口。只读场景（如侧栏）不传 ⇒ 空态只有说明文字 */
  onCreate?(): void;
}): JSX.Element {
  if (boards.length === 0) {
    return (
      <section
        data-agent-board-empty=""
        aria-label="Agent 看板（暂无）"
        className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line bg-paper p-6"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-pine-soft text-pine">
          <Bot size={20} aria-hidden />
        </span>
        <h2 className="text-base font-semibold text-ink">还没有 Agent 看板</h2>
        {/*
          空态文案**只承诺界面上真有的事**：
            · 有 `onCreate` → 才说「可以自己新建一块看板」（按钮就在下面）；
            · 没有 `onCreate`（只读场景，如侧栏）→ 只讲外部写入方这条通道，
              绝不写「点下面按钮新建」这种点了没反应的假承诺。
        */}
        {onCreate ? (
          <p className="max-w-[52ch] text-sm text-mist">
            这里只放外部写入方（如 WorkBuddy）的排期看板，与「我的项目」互不混料。
            可以自己新建一块看板，也可以把外部写入方接上后由它直接建板。
          </p>
        ) : (
          <p className="max-w-[52ch] text-sm text-mist">
            这里只放外部写入方（如 WorkBuddy）的排期看板，与「我的项目」互不混料。
            把外部写入方接上后，它会直接在这里建板并写入任务。
          </p>
        )}
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-2xl bg-pine px-4 text-sm font-medium text-white transition-colors hover:bg-pine-deep"
          >
            <Plus size={14} aria-hidden />
            新建 Agent 看板
          </button>
        )}
      </section>
    );
  }

  return (
    <ul data-agent-board-list="" aria-label="Agent 看板列表" className="flex flex-col gap-2">
      {boards.map((b) => {
        const active = b.id === currentId;
        return (
          <li key={b.id}>
            <button
              type="button"
              data-agent-board-item={b.id}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(b.id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
                active
                  ? 'border-pine bg-pine-soft'
                  : 'border-line bg-paper hover:bg-sunken',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                  active ? 'bg-paper text-pine' : 'bg-pine-soft text-pine',
                )}
              >
                <Bot size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {b.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-mist">
                {b.plannedStartAt.slice(0, 10)} → {b.plannedEndAt.slice(0, 10)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
