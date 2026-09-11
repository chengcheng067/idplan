// @vitest-environment jsdom
/**
 * v0.7 T03-A · 技术号展示（P0-15 / V1-10 / V1-14）—— 纯展示层里 jsdom 判得了的那半。
 *
 * ── 本文件锁什么 ──
 * ① `taskMetaText` 的**格式化不变量**（补零下限 / 进位不截断 / 老数据归一 / 永不出 `T-null`）；
 * ② 技术卡（tech 分支）与 Ready 卡的 DOM 上**确实**渲染了该串（锚点 `data-task-no`）；
 * ③ 人话模式**不渲染**该锚点（V1-9：人话模式不显示技术号）；
 * ④ 关键行为变更：有号时**不再**回落到 `externalId`（旧串是给机器看的幂等键）。
 *
 * ── 本文件**不**锁什么（诚实边界）──
 * 圆角 / 字号 / 尺寸一律**不在此断言**：jsdom 不加载 Tailwind 产物、不做类→像素映射，
 * `getComputedStyle` 对 Tailwind 类恒返回空值，在这里断言「r12 / 11px」只能是自欺
 * （本项目已因此栽过一次：`rounded-xl` 实为 16px，类名断言永远绿）。
 * 几何事实归真 Chromium 的几何 spec，本文件只判 DOM 结构与文本内容。
 *
 * ── 与 team-lead 口述口径的一处**已知分歧**（已上报，见 `taskMetaText.ts` 文件头）──
 * team-lead 口述：「`taskNo === null` 时回退到 `task.externalId ?? task.id`」。
 * 但设计 §8-V1-14 的验收 ③ 明文：「老数据 → 卡上显示 `—`（断言**不出现 `T-` 前缀**）」，
 * 且 §2（:172 / :195）、`entities.ts` 的 `taskNo` 注释、`task-no.ts` 的函数注释
 * **四处一致**为「`null` → `—`」。
 * 二者不可同时成立（回落到 externalId 会显示 `workbuddy:run1:local3`，不含 `—`）。
 * 本实现按**可执行的验收断言**（V1-14 ③）落地 = `— · agent`；若 team-lead 裁定
 * 改回 externalId，只需改 `taskMetaText` 一处。
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { taskMetaText } from '../src/components/agent/taskMetaText';
import { AgentTaskCard } from '../src/components/agent/AgentTaskCard';
import { ReadyQueue } from '../src/components/agent/ReadyQueue';
import { useLayoutStore } from '../src/store/useLayoutStore';
import { TaskStatus } from '../src/core/types/enums';
import type { Task } from '../src/core/types/entities';

/** React 18 的 act 环境开关：不设会打出「not wrapped in act」噪声，且收敛不稳定 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/* --------------------------------- 夹具 --------------------------------- */

let seq = 0;
function makeTask(partial: Partial<Task> & { title: string }): Task {
  seq += 1;
  return {
    id: `tsk_t03a_${seq}`,
    taskNo: null,
    projectId: 'p-t03a',
    stageId: 's-t03a',
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'agent',
    externalId: null,
    agentId: null,
    status: TaskStatus.Draft,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: seq,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderInto(node: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const localHost = host;
  root = createRoot(localHost);
  act(() => {
    root!.render(node);
  });
  return localHost;
}

afterEach(() => {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
  useLayoutStore.setState({ agentBoardMode: 'human' });
});

/* ========================= ① 纯函数：格式化不变量 ========================= */

describe('① taskMetaText —— 号格式与来源串（唯一出处）', () => {
  const cases: ReadonlyArray<[number | null | undefined, Task['source'], string]> = [
    [1000, 'agent', 'T-1000 · agent'],
    [1042, 'agent', 'T-1042 · agent'],
    [1042, 'human', 'T-1042 · human'],
    [1, 'human', 'T-0001 · human'],
    [0, 'agent', 'T-0000 · agent'],
    [9999, 'agent', 'T-9999 · agent'],
    // ★ 进位不截断：超出 4 位自然变成 5 位，绝不回绕/截断（截断=制造重复号）
    [10000, 'agent', 'T-10000 · agent'],
    [123456, 'human', 'T-123456 · human'],
    // ★ 老数据：交给 formatTaskNo 归一为 `—`，**不是** `T-null`
    [null, 'agent', '— · agent'],
    [undefined, 'human', '— · human'],
  ];

  it.each(cases)('taskNo=%s source=%s → %s', (taskNo, source, expected) => {
    expect(taskMetaText({ taskNo, source })).toBe(expected);
  });

  it('有号时匹配 V1-14 ① 的正则（技术卡与 Ready 卡同一口径）', () => {
    for (const n of [1000, 1001, 9999, 10000, 123456]) {
      expect(taskMetaText({ taskNo: n, source: 'agent' })).toMatch(/^T-\d{4,} · (agent|human)$/);
      expect(taskMetaText({ taskNo: n, source: 'human' })).toMatch(/^T-\d{4,} · (agent|human)$/);
    }
  });

  it('★ 老数据不含 `T-` 前缀，且永不出 `T-null` / `T-undefined`（V1-14 ③）', () => {
    for (const taskNo of [null, undefined] as const) {
      const text = taskMetaText({ taskNo, source: 'agent' });
      expect(text).toContain('—');
      expect(text.startsWith('T-')).toBe(false);
      expect(text).not.toContain('T-null');
      expect(text).not.toContain('T-undefined');
    }
  });

  it('穷举一段号段：任何输入都不产生 `T-null` / `T-undefined` / 空串', () => {
    const inputs: Array<number | null | undefined> = [
      null,
      undefined,
      0,
      1,
      9,
      10,
      99,
      999,
      1000,
      9999,
      10000,
      99999,
      100000,
    ];
    for (const taskNo of inputs) {
      for (const source of ['agent', 'human'] as const) {
        const text = taskMetaText({ taskNo, source });
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/T-(null|undefined)/);
        expect(text).toContain(' · ');
      }
    }
  });
});

/* ========================= ② 技术卡（tech 分支）========================= */

describe('② 技术卡元信息第二行 = 短号 · 来源', () => {
  it('有号：渲染 `T-1042 · agent`，且**不再**显示 externalId（行为变更点）', () => {
    useLayoutStore.setState({ agentBoardMode: 'tech' });
    const task = makeTask({
      title: '接线法务条款',
      taskNo: 1042,
      source: 'agent',
      // 旧实现会把这个幂等键显示出来；新实现必须显示短号
      externalId: 'workbuddy:run1:local3',
    });

    // tech 分支 = 调用方**不传** group（传了 group 才是人话模式）
    const el = renderInto(<AgentTaskCard task={task} onOpen={() => undefined} />);
    const anchor = el.querySelector('[data-task-no]');

    expect(anchor, '技术卡应存在 data-task-no 锚点').not.toBeNull();
    expect(anchor!.textContent).toBe('T-1042 · agent');
    expect(anchor!.textContent).not.toContain('workbuddy:run1:local3');
  });

  it('★ 老数据（taskNo=null）：显示 `— · agent`，不是 `T-null`', () => {
    useLayoutStore.setState({ agentBoardMode: 'tech' });
    const task = makeTask({ title: '存量老任务', taskNo: null, source: 'agent' });

    const el = renderInto(<AgentTaskCard task={task} onOpen={() => undefined} />);
    const anchor = el.querySelector('[data-task-no]');

    expect(anchor!.textContent).toBe('— · agent');
    expect(anchor!.textContent).not.toContain('T-');
  });

  it('human 来源显示 `· human`', () => {
    useLayoutStore.setState({ agentBoardMode: 'tech' });
    const task = makeTask({ title: '人工任务', taskNo: 1000, source: 'human' });

    const el = renderInto(<AgentTaskCard task={task} onOpen={() => undefined} />);
    expect(el.querySelector('[data-task-no]')!.textContent).toBe('T-1000 · human');
  });

  it('V1-9：人话模式（传 group）**不渲染**技术号锚点', () => {
    const task = makeTask({ title: '人话卡片', taskNo: 1042, source: 'agent' });

    const el = renderInto(
      <AgentTaskCard task={task} group="ready" onOpen={() => undefined} onPrimary={() => undefined} />,
    );

    expect(el.querySelector('[data-task-no]')).toBeNull();
    // 连号本身也不应出现在卡面上（人话模式不显示技术号）
    expect(el.textContent).not.toContain('T-1042');
  });
});

/* ========================= ③ Ready 卡 ========================= */

describe('③ Ready 卡 = 同一函数，同一串', () => {
  it('ready 任务：渲染 `T-1000 · agent`', () => {
    const task = makeTask({
      title: '就绪任务',
      status: TaskStatus.Ready,
      taskNo: 1000,
      source: 'agent',
      externalId: 'workbuddy:run9:local1',
    });

    const el = renderInto(
      <ReadyQueue tasks={[task]} onOpenTask={() => undefined} onClaim={() => undefined} />,
    );
    const anchor = el.querySelector('[data-task-no]');

    expect(anchor, 'Ready 卡应存在 data-task-no 锚点').not.toBeNull();
    expect(anchor!.textContent).toBe('T-1000 · agent');
    expect(anchor!.textContent).not.toContain('workbuddy:run9:local1');
  });

  it('★ Ready 卡老数据同样显示 `— · agent`', () => {
    const task = makeTask({ title: '老的就绪任务', status: TaskStatus.Ready, taskNo: null });

    const el = renderInto(
      <ReadyQueue tasks={[task]} onOpenTask={() => undefined} onClaim={() => undefined} />,
    );
    const anchor = el.querySelector('[data-task-no]');

    expect(anchor!.textContent).toBe('— · agent');
    expect(anchor!.textContent).not.toContain('T-');
  });

  it('两卡的元信息串逐字符一致（同一函数，不存在两份格式）', () => {
    const taskNo = 1042;
    const cardText = taskMetaText({ taskNo, source: 'agent' });

    useLayoutStore.setState({ agentBoardMode: 'tech' });
    const cardEl = renderInto(
      <AgentTaskCard task={makeTask({ title: 'A', taskNo, source: 'agent' })} onOpen={() => undefined} />,
    );
    const readyEl = renderInto(
      <ReadyQueue
        tasks={[makeTask({ title: 'B', status: TaskStatus.Ready, taskNo, source: 'agent' })]}
        onOpenTask={() => undefined}
        onClaim={() => undefined}
      />,
    );

    expect(cardEl.querySelector('[data-task-no]')!.textContent).toBe(cardText);
    expect(readyEl.querySelector('[data-task-no]')!.textContent).toBe(cardText);
  });
});
