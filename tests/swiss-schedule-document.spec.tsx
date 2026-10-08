// @vitest-environment jsdom
/**
 * A 版 · SwissScheduleDocument 组件测试（02 文档 §9 组件测试清单）。
 *
 * 锁六件：
 *   ① 渲染 4 页 `.a4-page`，`.print-root.print-template-swiss-schedule` 在位；
 *   ② 三槽位配色经 `.print-root` inline CSS 变量挂载（iframe 打印无损的前提）；
 *   ③ 页面选择器可关单页且**页码重排**（第 N / M 页随启用页变）；
 *   ④ P1-P4 各页数据口径：四态双编码 / taskNo 读号 / 三类延期分列 / Agent 行焦点；
 *   ⑤ 空数据显示标准空态文案，**不出现示例数据**；
 *   ⑥ `.a4-page` 等受保护选择器不被改名（02 §5 契约）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { SwissScheduleDocument, SWISS_SCHEDULE_PAGES } from '../src/print/documents/SwissScheduleDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageLogType,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, StageLog, Task } from '../src/core/types/entities';

/* ====================================================================================
 * 夹具：2 阶段（1 延期）× 3 任务（1 逾期/1 老号）× 2 成员（1 Agent）× 2 流水
 * ==================================================================================== */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_swiss';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '云栖·湖畔茶室',
  address: '城区某路 1 号',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-01-01T00:00:00Z',
  plannedEndAt: '2026-03-01T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: null,
  kind: 'human',
  ownerMemberId: null,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const HUMAN: Member = {
  id: 'm-swiss-human',
  name: '负责人甲',
  role: '项目负责人',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const AGENT: Member = {
  id: 'm-swiss-agent',
  name: '小 Agent',
  role: '自动执行体',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: MemberRoleKind.Member,
  passwordHash: null,
  actorKind: MemberActorKind.Agent,
  // 开放字符串：不存在的 harness 名也必须原样上纸
  agentKind: 'brand-new-harness-9000',
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const STAGES: Stage[] = [
  {
    id: 'stg_swiss_1',
    projectId: PROJECT_ID,
    orderIndex: 1,
    templateKey: null,
    colorIndex: 1,
    customColor: null,
    name: '提案与测量',
    ratioPercent: 40,
    startAt: '2026-01-05T00:00:00Z',
    endAt: '2026-01-20T23:59:59Z',
    status: StageStatus.Completed,
    ownerId: HUMAN.id,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stg_swiss_2',
    projectId: PROJECT_ID,
    orderIndex: 2,
    templateKey: null,
    colorIndex: 2,
    customColor: null,
    name: '平面方案',
    ratioPercent: 60,
    startAt: '2026-01-21T00:00:00Z',
    endAt: '2026-02-10T23:59:59Z',
    status: StageStatus.Delayed,
    ownerId: AGENT.id,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function task(id: string, taskNo: number | null, stageId: string, status: TaskStatus, dueDate: string | null): Task {
  return {
    id,
    taskNo,
    projectId: PROJECT_ID,
    stageId,
    title: `任务${taskNo ?? '老'}`,
    done: status === TaskStatus.Done,
    assigneeId: HUMAN.id,
    assigneeIds: [HUMAN.id, AGENT.id],
    dueDate,
    source: 'human',
    externalId: null,
    agentId: null,
    status,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const TASKS: Task[] = [
  task('tsk_swiss_1', 1001, 'stg_swiss_1', TaskStatus.Done, '2026-01-15'),
  // 逾期：截止日早于今天且未完成
  task('tsk_swiss_2', 1002, 'stg_swiss_2', TaskStatus.InProgress, '2026-10-01'),
  // 老数据：无读号
  task('tsk_swiss_3', null, 'stg_swiss_2', TaskStatus.Draft, null),
];
TASKS[0]!.artifacts = [
  { id: 'art_s1', kind: 'doc', title: '会议纪要', path: null, url: null, note: null },
  { id: 'art_s2', kind: 'file', title: '测绘图', path: null, url: null, note: null },
];

const LOGS: StageLog[] = [
  {
    id: 'log_swiss_1',
    stageId: 'stg_swiss_2',
    projectId: PROJECT_ID,
    type: StageLogType.Rescheduled,
    fromStatus: null,
    toStatus: null,
    oldStartAt: null,
    newStartAt: null,
    oldEndAt: '2026-02-01T23:59:59Z',
    newEndAt: '2026-02-10T23:59:59Z',
    reason: '等客户确认材料',
    operatorName: '负责人甲',
    createdAt: '2026-02-02T02:00:00Z',
  },
];

function buildVm(): ReturnType<typeof buildPrintViewModel> {
  return buildPrintViewModel({
    project: PROJECT,
    stages: STAGES,
    tasks: TASKS,
    members: [HUMAN, AGENT],
    stageLogs: LOGS,
    role: MemberRoleKind.Admin,
    currentMemberId: HUMAN.id,
    todayIso: TODAY,
    now: new Date('2026-10-09T07:30:00Z'),
  });
}

const BASELINE = PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline;

/* ====================================================================================
 * 渲染助手
 * ==================================================================================== */

let container: HTMLDivElement;
let root: Root;

function render(pages?: readonly string[]): void {
  act(() => {
    root.render(
      <SwissScheduleDocument
        vm={buildVm()}
        pages={pages as never}
        palette={BASELINE}
      />,
    );
  });
}

const q = (sel: string): Element | null => document.querySelector(sel);
const qa = (sel: string): Element[] => Array.from(document.querySelectorAll(sel));
const text = (sel: string): string => q(sel)?.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

/* ====================================================================================
 * 断言
 * ==================================================================================== */

describe('A 版 · SwissScheduleDocument（02 §9 组件测试）', () => {
  it('① 渲染 4 页 .a4-page，.print-root.print-template-swiss-schedule 在位', () => {
    render();
    const rootEl = q('.print-root');
    expect(rootEl).not.toBeNull();
    expect(rootEl!.className).toContain('print-template-swiss-schedule');
    expect(qa('.a4-page')).toHaveLength(4);
    // 受保护选择器不被改名（02 §5 契约：.print-root / .a4-page）
    expect(qa('.print-root .a4-page').length).toBe(4);
  });

  it('② 三槽位配色经 .print-root inline CSS 变量挂载', () => {
    render();
    const style = q('.print-root')!.getAttribute('style') ?? '';
    expect(style).toContain('--tpl-accent');
    expect(style).toContain('#F2D957');
    expect(style).toContain('--tpl-ink');
    expect(style).toContain('#191816');
    expect(style).toContain('--tpl-line');
  });

  it('③ 页面选择器可关单页且页码重排', () => {
    render(['task-register', 'member-roster']);
    expect(qa('.a4-page')).toHaveLength(2);
    const first = q('.a4-page')!;
    expect(first.getAttribute('data-print-page')).toBe('task-register');
    // 页码随启用页重排：第 1 / 2 页、第 2 / 2 页
    expect(qa('.swiss-bottombar')[0]!.textContent).toContain('第 1 / 2 页');
    expect(qa('.swiss-bottombar')[1]!.textContent).toContain('第 2 / 2 页');
    // 每页都有项目标识 + 数据时间（01 §2：每页可独立解释）
    for (const bar of qa('.swiss-topbar__title')) {
      expect(bar.textContent).toBe(PROJECT.name);
    }
    expect(qa('.swiss-bottombar')[0]!.textContent).toContain('数据时间 2026-10-09 07:30');
  });

  it('④a P1 阶段总览：序号/名称/四态双编码/日期/占比/负责人/任务进度', () => {
    render(['stage-overview']);
    const root = text('.print-root');
    expect(root).toContain('提案与测量');
    expect(root).toContain('平面方案');
    expect(root).toContain('已完成');
    expect(root).toContain('延期');
    expect(root).toContain('2026-01-05 — 2026-01-20');
    expect(root).toContain('占比 40%');
    expect(root).toContain('负责人 负责人甲');
    // 四态字形双编码（灰度可读，不靠色相）
    expect(q('.swiss-stage-row[data-state="delayed"] .swiss-state-glyph')?.textContent).toBe('▲');
    expect(q('.swiss-stage-row[data-state="completed"] .swiss-state-glyph')?.textContent).toBe('●');
    // 项目元信息体现排期基准（01 P1 硬要求）
    expect(root).toContain('按自然日');
    expect(root).toContain('完成度 50%');
  });

  it('④b P2 任务读号表：taskNo 读号 / 七态 / 负责人 / 产出物数 / 逾期标记', () => {
    render(['task-register']);
    const rows = qa('.swiss-register tbody tr');
    expect(rows).toHaveLength(3);
    // 读号走 formatTaskNo（T-1001 / 老数据 —）
    expect(rows[0]!.textContent).toContain('T-1001');
    expect(rows[2]!.textContent).toContain('—');
    // 七态文案（TASK_STATUS_LABELS 单一出处）
    expect(rows[0]!.textContent).toContain('已完成');
    expect(rows[1]!.textContent).toContain('进行中 · 逾期');
    expect(rows[2]!.textContent).toContain('草稿');
    // 负责人 + 产出物数
    expect(rows[0]!.textContent).toContain('负责人甲、小 Agent');
    expect(rows[0]!.textContent).toContain('2');
  });

  it('④c P3 延期记录表：三类口径分列 + StageLog 台账（旧/新结束日/原因/操作人）', () => {
    render(['delay-ledger']);
    const root = text('.print-root');
    // 三类延期口径各自判据（不混）
    expect(root).toContain('项目逾期');
    expect(root).toContain('是 · 结束日 2026-03-01');
    expect(root).toContain('阶段延期');
    expect(root).toContain('1 个阶段');
    expect(root).toContain('任务逾期');
    expect(root).toContain('1 条任务');
    // 台账：真实 StageLog 的旧/新结束日 + reason + 操作人 + 时间
    const row = q('.swiss-register tbody tr')!;
    expect(row.textContent).toContain('平面方案');
    expect(row.textContent).toContain('改期');
    expect(row.textContent).toContain('2026-02-01');
    expect(row.textContent).toContain('2026-02-10');
    expect(row.textContent).toContain('等客户确认材料');
    expect(row.textContent).toContain('负责人甲');
    expect(row.textContent).toContain('2026-02-02 02:00');
  });

  it('④d P4 成员责任表：Agent 行唯一强焦点 + agentKind 未知值原样', () => {
    render(['member-roster']);
    const agentRow = q('.swiss-roster__row--agent');
    expect(agentRow).not.toBeNull();
    expect(agentRow!.getAttribute('data-agent')).toBe('true');
    expect(agentRow!.textContent).toContain('小 Agent');
    expect(agentRow!.textContent).toContain('Agent');
    // 开放字符串：不存在的 harness 名原样上纸（01 §3.2）
    expect(agentRow!.textContent).toContain('brand-new-harness-9000');
    // 表头五列齐（含负责任务数列）
    const heads = qa('.swiss-roster thead th').map((th) => th.textContent);
    expect(heads).toEqual(['姓名', '类型', 'agentKind', '角色', '负责任务数']);
    // 人类行无焦点类（焦点唯一）
    expect(qa('.swiss-roster__row--agent')).toHaveLength(1);
  });

  it('⑤ 空数据显示标准空态文案，不出现示例数据', () => {
    const emptyVm = buildPrintViewModel({
      project: PROJECT,
      stages: [],
      tasks: [],
      members: [],
      stageLogs: [],
      role: MemberRoleKind.Admin,
      currentMemberId: HUMAN.id,
      todayIso: TODAY,
      now: new Date('2026-10-09T07:30:00Z'),
    });
    act(() => {
      root.render(<SwissScheduleDocument vm={emptyVm} palette={BASELINE} />);
    });
    // P3 台账空态 = 02 §8 标准文案（按页定位，别误中 P1 的阶段空态）
    expect(
      q('.a4-page[data-print-page="delay-ledger"] [data-print-empty="stageLog"]')?.textContent,
    ).toBe('当前可见范围内无阶段延期记录');
    expect(q('[data-print-empty="stages"]')?.textContent).toBe('当前可见范围内无阶段');
    expect(q('[data-print-empty="tasks"]')?.textContent).toBe('当前可见范围内无任务');
    expect(q('[data-print-empty="members"]')?.textContent).toBe('当前可见范围内无相关成员');
    // 无阶段/任务/成员 ⇒ 各自空态，且不出现任何示例行
    expect(qa('.swiss-stage-row')).toHaveLength(0);
    expect(qa('.swiss-register tbody tr')).toHaveLength(0);
    const rootText = text('.print-root');
    expect(rootText).not.toContain('T-1000');
    expect(rootText).not.toContain('示例');
  });

  it('⑥ pageRef 收集 4 个页面元素（PNG 逐页导出的前提）', () => {
    const collected: Array<HTMLDivElement | null> = [];
    act(() => {
      root.render(
        <SwissScheduleDocument
          vm={buildVm()}
          palette={BASELINE}
          pageRef={(idx) => (el: HTMLDivElement | null) => {
            collected[idx] = el;
          }}
        />,
      );
    });
    expect(collected).toHaveLength(4);
    for (const el of collected) {
      expect(el).not.toBeNull();
      expect(el!.className).toContain('a4-page');
    }
  });

  it('⑦ 默认 pages 缺省 = 四页全选（01 §8）', () => {
    render();
    expect(SWISS_SCHEDULE_PAGES).toHaveLength(4);
    expect(qa('.a4-page').map((el) => el.getAttribute('data-print-page'))).toEqual([
      'stage-overview',
      'task-register',
      'delay-ledger',
      'member-roster',
    ]);
  });
});
