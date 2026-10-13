/**
 * AgentBoardPage 渲染夹具 —— **仅适用于 src/pages/AgentBoardPage.tsx（Agent 看板页）**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ① 适用对象
 * ══════════════════════════════════════════════════════════════════════
 * 只用于渲染 Agent 看板页。它**不是**通用页面夹具。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ② ⚠️ 反传染警告：不要把本夹具的前提套到别的页面
 * ══════════════════════════════════════════════════════════════════════
 * 本仓已发生过**一次实际事故**：`tests/agent-console.spec.tsx:30` 有一句注释
 * 「本页只依赖 useRepos 这一个 DI 入口」——它在**执行记录页**成立；有人（我）把这句话
 * **原样搬**来当作**看板页**的前提写进备料。实测看板页**有 7 个入口**：
 *   useRepos / useRoleGuard / useAgentStore / useMembersStore / useProjectsStore
 *   (+createProjectActions) / useSettingsStore / useLayoutStore，
 * 另有 useAgentProjects、visibleProjectsFor 与 react-router 的 Link/useSearchParams。
 * ⇒ 照抄会把错前提**复制给每个使用本夹具的人**。
 * 自查动作（换页面复用时**先跑**，别照抄）：① grep 该页 import 里 hooks/ store/ Provider 清单；
 * ② 跑下面「前提自证」三条；③ 前提变了就改这里的事实并保留来源。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ③ 哪条前提**未查** + 由哪条断言吸收
 * ══════════════════════════════════════════════════════════════════════
 * 已查实（原样输出见交付报告）：
 *   · 页面**无整页早退**（唯二 `if` 是局部小函数）⇒ 不必等装载；
 *   · `data-agent-stance` **不在** `{isAdmin && …}` 内（该块 :987 开、:999 闭，盒子 :1016）
 *     ⇒ 不必先装管理员身份；
 *   · `:960-1020` 片内唯一依赖异步数据的条件是 `agentBoards.length === 0`（:970），
 *     盒子在其后 ⇒ 静态指向「非数据门控」。
 * ⚠️ **未查**：盒子外层若还有别的条件块（`{ready && …}` 等）**未证明**（是"读"出来的）。
 *   ⇒ 由容器独立存在性断言（P3）吸收：前提不成立时它会**先红**且原因直指前提。
 * ⚠️ **未查**：盒子是「首帧」还是「异步后」渲染 ⇒ 由下面的 (i)/(ii) 对照吸收。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ④ 「首帧 / 异步」**已实测**
 * ══════════════════════════════════════════════════════════════════════
 * 实测日期 + 读数见 `tests/agent-board-create.spec.tsx` 的 P3 用例输出（本夹具交付时回填）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 「绿」的四种来源（本仓实测过的四种假绿）
 * ══════════════════════════════════════════════════════════════════════
 *   1. 被注释满足（受体读原文）⇒ 修法：剥注释；2. 锚点选错（串在代码里不存在）⇒ 换真实锚点；
 *   3. 邻居给的绿（串在同 spec 读的**另一个文件**里）⇒ 收窄受体；
 *   4. **抢跑出来的绿**（首帧/异步弄错 ⇒ 偶发绿，并作为"已通过"留在记录里，比偶发红更坏）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 前提自证 P1–P3（复用物比一次性代码更需要对前提自证）
 * ══════════════════════════════════════════════════════════════════════
 *   P1. `useRepos` 这个 mock **被调用过**（计数 ≥ 1）—— 变异：把 `vi.mock` 路径改错一个字 ⇒ 必红；
 *   P2. 页面拿到的 bundle **就是**本夹具那个对象（靠 `repos.closedMark` 同一引用）；
 *   P3. 容器来自**真实渲染路径**：`[data-agent-stance]` 独立存在性断言 + `textContent` 含
 *       `catalogOf('zh')['agent.stanceNl']`（**不放宽到整页**）。
 *
 * ⚠️ 用法约束（vitest 的 hoisting 决定）：`vi.mock` **必须在 spec 文件里**声明、且工厂里
 *    只能用 `vi.hoisted` 暴露的值 —— 故本夹具导出 `repos` 槽位与 `useReposFromSlot`，
 *    spec 侧写：
 *      const slot = vi.hoisted(() => ({ bundle: null as unknown, calls: 0, mark: 'fixture' }));
 *      vi.mock('../src/hooks/useRepos', () => ({ useRepos: () => (slot.calls++, slot.bundle) }));
 *    这样 P1（计数）与 P2（同一引用）都能在外面断言。
 */
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AgentBoardPage } from '../src/pages/AgentBoardPage';

/** 推进异步（与 `agent-console.spec.tsx` 同形的 pump） */
export async function pump(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export interface MountedAgentBoardPage {
  container: HTMLDivElement;
  root: Root;
  /** render 之后**立刻**的读数（不 pump）——用于「首帧 vs 异步」对照的 (i) */
  stanceOnFirstFrame: Element | null;
  unmount(): Promise<void>;
}

/**
 * 渲染 Agent 看板页。
 * 前置：调用方已在 spec 里用 `vi.mock` 顶掉 `useRepos`（见文件头用法约束）。
 * ⚠️ 第一版**不播种** zustand store（依据：`:970` 是片内唯一异步条件，盒子在其后）
 *    —— 若 (i)/(ii) 对照显示「必须 pump 才有」，再回来判断是否需要播种。
 */
export function mountAgentBoardPage(): MountedAgentBoardPage {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(AgentBoardPage)));
  });
  // ★ (i)「render 之后**立刻**」的读数：这里**不 await**、不 pump
  const stanceOnFirstFrame = container.querySelector('[data-agent-stance]');
  return {
    container,
    root,
    stanceOnFirstFrame,
    async unmount(): Promise<void> {
      act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}
