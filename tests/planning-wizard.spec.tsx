// @vitest-environment jsdom
/**
 * 0.8.6 竞品三件套之三 · AI 规划向导（Kanban AI 范式）。
 *
 * 向导的安全姿态：**不调 LLM**——「说想法 → 给 AI → 粘回结果」，AI 在用户
 * 那边（用户自己的 Claude/WorkBuddy），我们只做结构化收集 + 共享核心落库。
 *
 * 钉六条：
 *   ① buildPlanningPrompt：项目名/行业/想法/阶段设想全部进指令（不替他改写原文）；
 *   ② 未填项有诚实占位（「未命名，请你据需求起名」/「未指定，请你判断」），不编默认值；
 *   ③ 阶段设想为空时不出现该段（不塞空标题）；
 *   ④ 三步可走通：说想法 → 指令（可复制）→ 粘回 JSON；
 *   ⑤ 粘非 JSON → 中文错误、不建板；
 *   ⑥ schema 错的 JSON → 校验错误逐条展示、不建板（不半套写入）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { PlanningWizardDialog, buildPlanningPrompt } from '../src/components/agent/PlanningWizardDialog';

// 向导依赖 repos/store —— 用最小 mock（同 first-run-guide spec 的 vi.mock 范式）
const createBoardSpy = vi.fn(async () => ({ id: 'proj_new', name: 'n', kind: 'agent' }));
const applySpy = vi.fn(async () => ({ created: 2, updated: 0, rejected: [], stage: { mode: 'existing', id: 's1', name: '', orderIndex: 1 } }));
vi.mock('../src/core/repositories/local/local.repositories', () => ({}));
vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => ({}) as never,
}));
vi.mock('../src/store/useProjectsStore', () => ({
  createProjectActions: () => ({ createAgentBoard: createBoardSpy }),
  useProjectsStore: (sel: (s: { pushToast: (t: string, m: string) => void }) => unknown) =>
    sel({ pushToast: () => undefined }),
}));

const validPayload = {
  schema: 'idplan-agent-payload/v1',
  projectId: null,
  stageId: null,
  producedBy: { actorKind: 'agent', agentKind: 'claude', agentName: 'Claude', runId: 'r1' },
  tasks: [
    {
      externalId: 'a',
      title: '概念方案',
      description: null,
      status: 'draft',
      assigneeAgentKind: null,
      assigneeHuman: null,
      dependsOnExternal: [],
      startAt: null,
      dueDate: null,
      artifacts: [],
    },
    {
      externalId: 'b',
      title: '深化',
      description: null,
      status: 'draft',
      assigneeAgentKind: null,
      assigneeHuman: null,
      dependsOnExternal: ['a'],
      startAt: null,
      dueDate: null,
      artifacts: [],
    },
  ],
};

async function renderWizard(el: HTMLElement): Promise<void> {
  await act(async () => {
    createRoot(el).render(<PlanningWizardDialog open onClose={() => undefined} />);
  });
}

describe('AI 规划向导（buildPlanningPrompt 纯函数）', () => {
  it('① 四项上下文全部进指令（想法原文不加工）', () => {
    const text = buildPlanningPrompt({
      projectName: '茶空间全流程',
      domain: 'indoor',
      idea: '先给甲方看概念，过了再深化\n材料要并行盯',
      stageHint: '概念 → 深化 → 施工',
    });
    expect(text).toContain('项目名称：茶空间全流程');
    expect(text).toContain('所属行业：室内');
    expect(text).toContain('先给甲方看概念，过了再深化');
    expect(text).toContain('材料要并行盯'); // 换行保留（原文）
    expect(text).toContain('我想到的阶段');
  });

  it('② 未填项诚实占位，不编默认值', () => {
    const text = buildPlanningPrompt({ projectName: '', domain: null, idea: '', stageHint: '' });
    expect(text).toContain('（未命名，请你据需求起名）');
    expect(text).toContain('（未指定，请你判断）');
    expect(text).not.toContain('我想到的阶段'); // ③ 空阶段设想不出该段
  });
});

describe('AI 规划向导（三步流程）', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    createBoardSpy.mockClear();
    applySpy.mockClear();
  });

  it('④ 三步可走通；第 2 步展示生成的指令', async () => {
    await renderWizard(container);
    expect(document.body.querySelector('[data-planning-step="1"]')).toBeTruthy();
    // 填想法 → 下一步
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '先做概念方案');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const nextBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('下一步'),
    ) as HTMLButtonElement;
    await act(async () => {
      nextBtn.click();
    });
    expect(document.body.querySelector('[data-planning-step="2"]')).toBeTruthy();
    expect(document.body.querySelector('[data-planning-prompt]')?.textContent).toContain('先做概念方案');
  });

  it('⑤ 粘非 JSON → 中文错误、不建板', async () => {
    await renderWizard(container);
    // 直接跳到第 3 步（点两次下一步）
    for (let i = 0; i < 2; i += 1) {
      const nextBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('下一步'),
      ) as HTMLButtonElement;
      await act(async () => {
        nextBtn.click();
      });
    }
    const ta = document.body.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, '这不是 JSON');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const createBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('建板并导入'),
    ) as HTMLButtonElement;
    await act(async () => {
      createBtn.click();
    });
    expect(document.body.textContent).toContain('不是合法的 JSON');
    expect(createBoardSpy).not.toHaveBeenCalled();
  });

  it('⑥ schema 错的 JSON → 校验错误、不建板（不半套写入）', async () => {
    await renderWizard(container);
    for (let i = 0; i < 2; i += 1) {
      const nextBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('下一步'),
      ) as HTMLButtonElement;
      await act(async () => {
        nextBtn.click();
      });
    }
    const ta = document.body.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, JSON.stringify({ schema: 'wrong/v1', tasks: [] }));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const createBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('建板并导入'),
    ) as HTMLButtonElement;
    await act(async () => {
      createBtn.click();
    });
    expect(document.body.textContent).toContain('校验');
    expect(createBoardSpy).not.toHaveBeenCalled();
  });
});
