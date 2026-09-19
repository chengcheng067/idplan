/**
 * v0.3 变更 E：日程表打印视图数据组装测试（增量架构 4.2 新增用例）：
 *   1. buildScheduleSections 按 orderIndex 阶段分组（仅 visible 阶段）；
 *   2. 参与人多值姓名映射；
 *   3. 未指派 → assigneeNames=[]（页面渲染「—」）；
 *   4. 无任务阶段 → tasks=[]（页面显示「无任务」空行）；
 *   5. 成员 id 找不到 → 显示 id 兜底。
 * node 环境纯函数断言，无需 DOM/canvas。
 */

import { describe, it, expect } from 'vitest';

import {
  buildScheduleSections,
  schedulePngFileName,
  EXPORT_BG,
  EXPORT_FG,
  EXPORT_BORDER,
  schedulePngExportOptions,
} from '../src/lib/schedule-print';
import { MemberActorKind, MemberRoleKind, ProjectStatus, ScheduleBasis, StageStatus, TaskStatus } from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';

const project: Project = {
  id: 'proj_1',
  name: '望江楼茶空间',
  address: '成都市青羊区',
  clientName: '测试甲方',
  contractAmount: 880000,
  signedAt: '2026-07-20T00:00:00.000Z',
  plannedStartAt: '2026-08-01',
  plannedEndAt: '2026-12-31',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: null,
  kind: 'human',
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const members: Member[] = [
  { id: 'mem_a', name: '许工', role: '主案', contact: null, avatarColor: '#3D6B5B', active: true, roleKind: MemberRoleKind.Member, passwordHash: null, actorKind: MemberActorKind.Human, agentKind: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'mem_b', name: '王工', role: '绘图', contact: null, avatarColor: '#D9A441', active: true, roleKind: MemberRoleKind.Member, passwordHash: null, actorKind: MemberActorKind.Human, agentKind: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
];

const stages: Stage[] = [
  { id: 'stg_1', projectId: 'proj_1', orderIndex: 1, templateKey: null, colorIndex: 1, customColor: null, name: '提案', ratioPercent: 5, startAt: '2026-08-01', endAt: '2026-08-07', status: StageStatus.NotStarted, ownerId: null, visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'stg_2', projectId: 'proj_1', orderIndex: 2, templateKey: null, colorIndex: 2, customColor: null, name: '测量', ratioPercent: 4, startAt: '2026-08-08', endAt: '2026-08-13', status: StageStatus.NotStarted, ownerId: null, visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'stg_3', projectId: 'proj_1', orderIndex: 3, templateKey: null, colorIndex: 3, customColor: null, name: '平面方案', ratioPercent: 11, startAt: '2026-08-14', endAt: '2026-08-29', status: StageStatus.NotStarted, ownerId: null, visible: false, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'stg_other', projectId: 'proj_2', orderIndex: 9, templateKey: null, colorIndex: 9, customColor: null, name: '其他项目阶段', ratioPercent: 5, startAt: '2026-09-01', endAt: '2026-09-30', status: StageStatus.NotStarted, ownerId: null, visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
];

const tasks: Task[] = [
  { id: 'tsk_1', taskNo: null, projectId: 'proj_1', stageId: 'stg_1', title: '意向收集', done: false, assigneeId: 'mem_a', assigneeIds: ['mem_a'], dueDate: '2026-08-05', source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, orderIndex: 1, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'tsk_2', taskNo: null, projectId: 'proj_1', stageId: 'stg_1', title: '主材清单', done: true, assigneeId: 'mem_b', assigneeIds: ['mem_a', 'mem_b'], dueDate: '2026-08-06', source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, orderIndex: 2, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'tsk_3', taskNo: null, projectId: 'proj_1', stageId: 'stg_1', title: '未指派任务', done: false, assigneeId: null, assigneeIds: [], dueDate: null, source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, orderIndex: 3, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'tsk_4', taskNo: null, projectId: 'proj_1', stageId: 'stg_2', title: '量房', done: false, assigneeId: 'mem_ghost', assigneeIds: ['mem_ghost'], dueDate: '2026-08-12', source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, orderIndex: 1, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'tsk_other', taskNo: null, projectId: 'proj_2', stageId: 'stg_other', title: '别项目任务', done: false, assigneeId: null, assigneeIds: [], dueDate: null, source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, orderIndex: 1, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
];

describe('buildScheduleSections：日程表数据组装', () => {
  it('仅本项目 visible 阶段，按 orderIndex 1→9 分组', () => {
    const sections = buildScheduleSections({ project, stages, tasks, members });
    expect(sections.map((s) => s.orderIndex)).toEqual([1, 2]);
    // 隐藏阶段 stg_3 与别项目阶段 stg_other 均不出现
    expect(sections.some((s) => s.name === '平面方案')).toBe(false);
  });

  it('参与人多值姓名映射（assigneeIds 展开全部参与人）', () => {
    const sections = buildScheduleSections({ project, stages, tasks, members });
    const s1 = sections.find((s) => s.orderIndex === 1)!;
    const multi = s1.tasks.find((t) => t.id === 'tsk_2')!;
    expect(multi.assigneeNames).toEqual(['许工', '王工']);
    expect(multi.done).toBe(true);
  });

  it('未指派任务 → assigneeNames=[]（页面渲染「—」）', () => {
    const sections = buildScheduleSections({ project, stages, tasks, members });
    const s1 = sections.find((s) => s.orderIndex === 1)!;
    const unassigned = s1.tasks.find((t) => t.id === 'tsk_3')!;
    expect(unassigned.assigneeNames).toEqual([]);
    expect(unassigned.dueDate).toBeNull();
  });

  it('成员 id 找不到 → 显示 id 兜底', () => {
    const sections = buildScheduleSections({ project, stages, tasks, members });
    const s2 = sections.find((s) => s.orderIndex === 2)!;
    expect(s2.tasks[0]!.assigneeNames).toEqual(['mem_ghost']);
  });

  it('无任务阶段 → tasks=[]（页面显示「无任务」空行）', () => {
    const noTaskStages: Stage[] = [
      { ...stages[0]! },
      { ...stages[1]!, id: 'stg_empty', orderIndex: 2, name: '空阶段' },
    ];
    const sections = buildScheduleSections({ project, stages: noTaskStages, tasks, members });
    const empty = sections.find((s) => s.name === '空阶段')!;
    expect(empty.tasks).toEqual([]);
  });

  it('任务按 orderIndex 排序', () => {
    const sections = buildScheduleSections({ project, stages, tasks, members });
    const s1 = sections.find((s) => s.orderIndex === 1)!;
    expect(s1.tasks.map((t) => t.id)).toEqual(['tsk_1', 'tsk_2', 'tsk_3']);
  });

  it('阶段起止/状态透传（打印头部与状态色块用）', () => {
    const sections = buildScheduleSections({ project, stages, tasks, members });
    expect(sections[0]).toMatchObject({
      orderIndex: 1,
      name: '提案',
      startAt: '2026-08-01',
      endAt: '2026-08-07',
      status: StageStatus.NotStarted,
    });
  });
});

describe('schedulePngFileName：PNG 下载文件名', () => {
  it('以 id-plan-schedule- 开头、含项目名与时间戳', () => {
    const name = schedulePngFileName('望江楼茶空间', new Date('2026-09-01T08:30:00.000Z'));
    expect(name).toMatch(/^id-plan-schedule-[^-]+-\d{12}\.png$/);
    expect(name.startsWith('id-plan-schedule-')).toBe(true);
    expect(name.endsWith('.png')).toBe(true);
  });

  it('非法文件名字符被清理', () => {
    const name = schedulePngFileName('a/b:c*d?e', new Date('2026-09-01T08:30:00.000Z'));
    expect(name).not.toMatch(/[/:*?"<>|]/);
  });
});

describe('导出 PNG 配色：固定浅底深字，不跟随主题（回归防护）', () => {
  it('EXPORT_BG / EXPORT_FG / EXPORT_BORDER 为固定浅底深字常量', () => {
    expect(EXPORT_BG).toBe('#ffffff');
    expect(EXPORT_FG).toBe('#1e293b');
    expect(EXPORT_BORDER).toBe('#e2e8f0');
  });

  it('schedulePngExportOptions().backgroundColor 固定为 EXPORT_BG（浅色），不读取主题', () => {
    const opts = schedulePngExportOptions();
    // 关键回归：必须是写死的浅色常量字面量。若改回「跟随主题」（读取 CSS 变量 / store），
    // 该值将不再等于固定的 #ffffff，本条测试失败。
    expect(opts.backgroundColor).toBe(EXPORT_BG);
    expect(opts.backgroundColor).toBe('#ffffff');
    // 纯函数：多次调用结果一致，证明不依赖运行时主题状态。
    expect(schedulePngExportOptions().backgroundColor).toBe(opts.backgroundColor);
  });

  it('ignoreElements 排除 .no-print 操作栏（其使用跟随主题的配色），保留正文', () => {
    const opts = schedulePngExportOptions();
    expect(typeof opts.ignoreElements).toBe('function');
    const noPrint = { classList: { contains: (c: string) => c === 'no-print' } } as unknown as HTMLElement;
    const body = { classList: { contains: () => false } } as unknown as HTMLElement;
    expect(opts.ignoreElements!(noPrint)).toBe(true);
    expect(opts.ignoreElements!(body)).toBe(false);
  });
});
