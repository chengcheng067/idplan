/**
 * 休息制度切换重算（src/lib/restPolicyRecalc.ts）· 纯函数测试。
 *
 * 覆盖产品决策文档 §4.5 单测要点全清单：
 *   ① 四种制度两两切换（双↔单↔大小休）× 链式 / 有间隙 / 已完成冻结 / 进行中半冻结；
 *   ② singleRestWeekday 七个值各一例；
 *   ③ extraHolidays / extraWorkdays / skipHolidays 开启时重算（节假日表合并后判定）；
 *   ④ 幂等（同制度重算两次 = 第二次零变化）；
 *   ⑤ 自然日制项目零影响（plan 口径：调用方只传 workday 项目）；
 *   ⑥ 空项目 / 单阶段项目；
 *   ⑦ 阶段拖出 plannedEndAt 的锚处理（plannedEndAt 跟随末段漂移）；
 *   ⑧ 工期改变模式（durationOverrides：填了某阶段天数 → 该阶段按新工期、其余不变）；
 *   ⑨ 弹窗预览与应用同一结果（plan 确定性：同输入两次调用深度相等）。
 *
 * 日期基准（与 workdays.rest-policy.spec.ts 同源）：
 *   2026-W37 = 2026-09-07(一) … 2026-09-13(日)
 *   2026-W38 = 2026-09-14(一) … 2026-09-20(日)
 *   2026-W39 = 2026-09-21(一) … 2026-09-27(日)
 *   2026-09-01 是周二；2026-09-12 是周六。
 */

import { describe, it, expect } from 'vitest';

import {
  parseDurationDays,
  planRestPolicyRecalc,
  restPolicyRecalcReason,
  sameWorkdayPolicy,
  type RecalcInputProject,
} from '../src/lib/restPolicyRecalc';
import { addWorkdays, countWorkdays, isRestDay } from '../src/lib/workdays';
import { hydrateRestPolicy } from '../src/core/holidays/policy';
import { DEFAULT_REST_POLICY } from '../src/core/types/entities';
import type { Project, RestPolicyConfig, Stage, Task } from '../src/core/types/entities';
import {
  ProjectStatus,
  RestPolicyKind,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';

/* ------------------------------ 夹具 ------------------------------ */

const DOUBLE: RestPolicyConfig = { kind: RestPolicyKind.DoubleOff, anchorWeek: null };
const SINGLE: RestPolicyConfig = { kind: RestPolicyKind.SingleOff, anchorWeek: null };

/** 单休 + 自定义休息周几（0=周一 … 6=周日） */
function singleOn(weekday: number | undefined): RestPolicyConfig {
  return { kind: RestPolicyKind.SingleOff, anchorWeek: null, singleRestWeekday: weekday };
}

/** 大小休（2026-W37 为大休周） */
const BIG_SMALL: RestPolicyConfig = {
  kind: RestPolicyKind.BigSmallWeek,
  anchorWeek: '2026-W37',
};

let seq = 0;
function makeProject(over: Partial<Project> = {}): Project {
  seq += 1;
  return {
    id: `proj_r_${seq}`,
    name: `项目 ${seq}`,
    address: '',
    clientName: '客户甲',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-07T00:00:00Z',
    plannedEndAt: '2026-09-30T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Workday,
    domain: null,
    kind: 'human',
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-09-07T00:00:00Z',
    ownerMemberId: null,
    ...over,
  };
}

function makeStage(
  projectId: string,
  orderIndex: number,
  startAt: string,
  endAt: string,
  over: Partial<Stage> = {},
): Stage {
  seq += 1;
  return {
    id: `stg_r_${seq}`,
    projectId,
    orderIndex,
    templateKey: null,
    colorIndex: 1,
    customColor: null,
    name: `阶段 ${orderIndex}`,
    ratioPercent: 10,
    startAt: `${startAt}T00:00:00Z`,
    endAt: `${endAt}T23:59:59Z`,
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-09-07T00:00:00Z',
    ...over,
  };
}

function makeTask(stageId: string, projectId: string, over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `tsk_r_${seq}`,
    taskNo: seq,
    projectId,
    stageId,
    title: '任务',
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: 'draft',
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 0,
    revision: 1,
    updatedAt: '2026-09-07T00:00:00Z',
    ...over,
  } as Task;
}

/** 链式三阶段项目（双休口径）：09-07~09-11 / 09-14~09-18 / 09-21~09-25 */
function chainProject(stageOver: Array<Partial<Stage>> = []): RecalcInputProject {
  const project = makeProject();
  const stages = [
    makeStage(project.id, 1, '2026-09-07', '2026-09-11', stageOver[0]),
    makeStage(project.id, 2, '2026-09-14', '2026-09-18', stageOver[1]),
    makeStage(project.id, 3, '2026-09-21', '2026-09-25', stageOver[2]),
  ];
  return { project, stages };
}

/** 阶段计划快查 */
function planOf(plan: ReturnType<typeof planRestPolicyRecalc>, orderIndex: number) {
  return plan.projects[0].stages.find((s) => s.orderIndex === orderIndex)!;
}

/* ------------------------------ parseDurationDays ------------------------------ */

describe('parseDurationDays：每阶段时长覆盖解析（与建档 ManualFallbackForm 同源）', () => {
  it('空串 / 未填 = null（走原工期）', () => {
    expect(parseDurationDays('')).toBeNull();
    expect(parseDurationDays('   ')).toBeNull();
    expect(parseDurationDays(undefined)).toBeNull();
    expect(parseDurationDays(null)).toBeNull();
  });

  it('正整数原样；小数四舍五入；非数字 / 非正数 = null', () => {
    expect(parseDurationDays('5')).toBe(5);
    expect(parseDurationDays(' 7 ')).toBe(7);
    expect(parseDurationDays('3.4')).toBe(3);
    expect(parseDurationDays('3.6')).toBe(4);
    expect(parseDurationDays('abc')).toBeNull();
    expect(parseDurationDays('0')).toBeNull();
    expect(parseDurationDays('-2')).toBeNull();
  });
});

/* ------------------------------ sameWorkdayPolicy ------------------------------ */

describe('sameWorkdayPolicy：制度变更检测', () => {
  it('同 kind 同配置 = 相同', () => {
    expect(sameWorkdayPolicy(DOUBLE, { kind: RestPolicyKind.DoubleOff, anchorWeek: null })).toBe(true);
  });

  it('kind 不同 = 不同', () => {
    expect(sameWorkdayPolicy(DOUBLE, SINGLE)).toBe(false);
  });

  it('单休周几不同 = 不同；缺省与 6（周日）等价', () => {
    expect(sameWorkdayPolicy(SINGLE, singleOn(6))).toBe(true);
    expect(sameWorkdayPolicy(SINGLE, singleOn(2))).toBe(false);
  });

  it('非单休档的 singleRestWeekday 不参与判定', () => {
    expect(sameWorkdayPolicy(DOUBLE, { ...DOUBLE, singleRestWeekday: 2 })).toBe(true);
  });

  it('节假日三件套任一变化 = 不同', () => {
    expect(sameWorkdayPolicy(DOUBLE, { ...DOUBLE, extraHolidays: ['2026-09-12'] })).toBe(false);
    expect(sameWorkdayPolicy(DOUBLE, { ...DOUBLE, extraWorkdays: ['2026-09-13'] })).toBe(false);
    expect(sameWorkdayPolicy(DOUBLE, { ...DOUBLE, skipHolidays: true })).toBe(false);
    expect(sameWorkdayPolicy(BIG_SMALL, { ...BIG_SMALL, anchorWeek: '2026-W38' })).toBe(false);
  });

  it('数组顺序不影响判定（集合语义）', () => {
    expect(
      sameWorkdayPolicy(
        { ...DOUBLE, extraHolidays: ['2026-09-12', '2026-09-13'] },
        { ...DOUBLE, extraHolidays: ['2026-09-13', '2026-09-12'] },
      ),
    ).toBe(true);
  });
});

/* ------------------------------ 双→单：链式平移 ------------------------------ */

describe('双休→单休：工期不变 + 链式平移（结束日提前）', () => {
  const plan = planRestPolicyRecalc({
    projects: [chainProject()],
    oldPolicy: DOUBLE,
    newPolicy: SINGLE,
  });

  it('第一段（首周无周六）起止不变', () => {
    const s1 = planOf(plan, 1);
    expect(s1.oldStartAt).toBe('2026-09-07');
    expect(s1.oldEndAt).toBe('2026-09-11');
    expect(s1.newStartAt).toBe('2026-09-07');
    expect(s1.newEndAt).toBe('2026-09-11');
    expect(s1.changed).toBe(false);
    expect(s1.workdays).toBe(5);
  });

  it('第二段：周六变为工作日，起止提前 2 天（09-14~09-18 → 09-12~09-17）', () => {
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-12'); // 单休下周六上班
    expect(s2.newEndAt).toBe('2026-09-17');
    expect(s2.changed).toBe(true);
    // 工期口径不变：新旧都是 5 个工作日
    expect(countWorkdays(s2.oldStartAt, s2.oldEndAt, DOUBLE)).toBe(5);
    expect(countWorkdays(s2.newStartAt, s2.newEndAt, SINGLE)).toBe(5);
  });

  it('第三段：链式跟随，起止提前 3 天（09-21~09-25 → 09-18~09-23）', () => {
    const s3 = planOf(plan, 3);
    expect(s3.newStartAt).toBe('2026-09-18');
    expect(s3.newEndAt).toBe('2026-09-23');
    expect(s3.changed).toBe(true);
  });

  it('新起止都不落在新制度休息日上', () => {
    for (const s of plan.projects[0].stages) {
      expect(isRestDay(s.newStartAt, SINGLE)).toBe(false);
      expect(isRestDay(s.newEndAt, SINGLE)).toBe(false);
    }
  });

  it('plannedEndAt 只增不减：结束日提前不缩短计划窗口（09-30 保持）', () => {
    expect(plan.projects[0].oldPlannedEndAt).toBe('2026-09-30');
    expect(plan.projects[0].newPlannedEndAt).toBe('2026-09-30');
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
  });

  it('汇总计数：1 项目 / 2 阶段变化 / 0 冻结', () => {
    expect(plan.affectedProjectCount).toBe(1);
    expect(plan.changedStageCount).toBe(2);
    expect(plan.frozenStageCount).toBe(0);
    expect(plan.hasChanges).toBe(true);
  });

  it('预览与应用同一结果：同输入两次调用深度相等', () => {
    const input = chainProject();
    const first = planRestPolicyRecalc({
      projects: [input],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    const second = planRestPolicyRecalc({
      projects: [input],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(second).toEqual(first);
  });
});

/* ------------------------------ 单→双：反向延后 ------------------------------ */

describe('单休→双休：链式平移（结束日延后）', () => {
  // 单休口径三阶段：09-07~09-11 / 09-12~09-17 / 09-18~09-23
  const project = makeProject();
  const stages = [
    makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
    makeStage(project.id, 2, '2026-09-12', '2026-09-17'),
    makeStage(project.id, 3, '2026-09-18', '2026-09-23'),
  ];
  const plan = planRestPolicyRecalc({
    projects: [{ project, stages }],
    oldPolicy: SINGLE,
    newPolicy: DOUBLE,
  });

  it('第一段不变；第二段起止延后 2 天（09-12~09-17 → 09-14~09-18）', () => {
    expect(planOf(plan, 1).changed).toBe(false);
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-14');
    expect(s2.newEndAt).toBe('2026-09-18');
  });

  it('第三段链式延后 3 天（09-18~09-23 → 09-21~09-25）', () => {
    const s3 = planOf(plan, 3);
    expect(s3.newStartAt).toBe('2026-09-21');
    expect(s3.newEndAt).toBe('2026-09-25');
  });

  it('plannedEndAt 保持（末段新结束日 09-25 仍在计划窗口内）', () => {
    expect(plan.projects[0].newPlannedEndAt).toBe('2026-09-30');
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
  });
});

/* ------------------------------ 大小休切换 ------------------------------ */

describe('双休→大小休 / 单休→大小休', () => {
  it('双→大小休（锚 W37=大休周）：大休周内不变，小休周周六变上班', () => {
    const plan = planRestPolicyRecalc({
      projects: [chainProject()],
      oldPolicy: DOUBLE,
      newPolicy: BIG_SMALL,
    });
    // W37 大休（周六休）= 双休；S1 不变
    expect(planOf(plan, 1).changed).toBe(false);
    // S2 起点：09-11 之后第一个工作日——09-12 周六（W37 大休休）、09-13 周日休 → 09-14
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-14');
    expect(s2.newEndAt).toBe('2026-09-18');
    expect(s2.changed).toBe(false);
    // S3：W38 为小休周（周六上班）→ 起点 09-18 之后第一个工作日 = 09-19 周六；
    // 工期 5 个工作日（09-20 周日休）落在 09-19~09-24
    const s3 = planOf(plan, 3);
    expect(s3.newStartAt).toBe('2026-09-19');
    expect(s3.newEndAt).toBe('2026-09-24');
    expect(s3.changed).toBe(true);
  });

  it('单→大小休（锚 W37=大休周）：周六由全上班变交替，S2/S3 重排', () => {
    const project = makeProject();
    const stages = [
      makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
      makeStage(project.id, 2, '2026-09-12', '2026-09-17'),
      makeStage(project.id, 3, '2026-09-18', '2026-09-23'),
    ];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: SINGLE,
      newPolicy: BIG_SMALL,
    });
    // S1（W37 大休周内，周内无周六）不变
    expect(planOf(plan, 1).changed).toBe(false);
    // S2：起点从 09-12（单休周六上班）推到 09-14（大休周周六休）
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-14');
    expect(s2.newEndAt).toBe('2026-09-18');
    // S3：W38 小休周（周六上班）→ 起点 09-18 之后第一个工作日 = 09-19 周六；
    // 旧工期 5 个工作日（09-18~09-23 单休：18,19,21,22,23）落在 09-19~09-24
    const s3 = planOf(plan, 3);
    expect(s3.workdays).toBe(5);
    expect(s3.newStartAt).toBe('2026-09-19');
    expect(s3.newEndAt).toBe('2026-09-24');
    expect(s3.changed).toBe(true);
  });

  it('大小休锚点位移一周（W37→W36）：大休周六变上班，链式提前', () => {
    const project = makeProject();
    const stages = [
      makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
      makeStage(project.id, 2, '2026-09-14', '2026-09-18'),
      makeStage(project.id, 3, '2026-09-21', '2026-09-25'),
    ];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: BIG_SMALL,
      newPolicy: { kind: RestPolicyKind.BigSmallWeek, anchorWeek: '2026-W36' },
    });
    // S1（W37 内无周六）不变
    expect(planOf(plan, 1).changed).toBe(false);
    // S2：锚点位移后 09-12 周六由休变上班 → 起点提前 2 天（09-14 → 09-12），
    // 工期 5 个工作日落在 09-12~09-17
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-12');
    expect(s2.newEndAt).toBe('2026-09-17');
    expect(s2.changed).toBe(true);
    // S3：间隙保留——旧制度（锚 W37）下 09-18 与 09-21 之间有 1 个工作日（09-19
    // 周六小休上班）⇒ steps=2；新制度（锚 W36）下 09-19 周六大休休 ⇒ 从 09-17
    // 往后数 2 个工作日 = 09-21。工期 5 个工作日落在 09-21~09-25，与原区间一致。
    const s3 = planOf(plan, 3);
    expect(s3.newStartAt).toBe('2026-09-21');
    expect(s3.newEndAt).toBe('2026-09-25');
    expect(s3.changed).toBe(false);
  });
});

/* ------------------------------ 有间隙：间隙保留 ------------------------------ */

describe('有间隙链：间隙按旧制度工作日步数保留', () => {
  // S1: 09-07~09-11；S2: 09-16 起（双休下空隙 09-14、09-15 两个工作日）
  const project = makeProject();
  const stages = [
    makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
    makeStage(project.id, 2, '2026-09-16', '2026-09-22'),
  ];
  const plan = planRestPolicyRecalc({
    projects: [{ project, stages }],
    oldPolicy: DOUBLE,
    newPolicy: SINGLE,
  });

  it('S2 新起点前保留 2 个工作日空隙（09-11 → 空 09-12、09-14 → 09-15 起）', () => {
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-15');
    // 空隙 = 09-11 之后、09-15 之前的工作日（单休口径）
    const gap = countWorkdays('2026-09-12', '2026-09-14', SINGLE);
    expect(gap).toBe(2);
  });

  it('无间隙项目不引入空隙（首尾相接 steps=1）', () => {
    const chain = planRestPolicyRecalc({
      projects: [chainProject()],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    // S2 新终点 09-17 的下一个工作日（单休）== S3 新起点 09-18
    expect(addWorkdays('2026-09-17', 1, SINGLE)).toBe(planOf(chain, 3).newStartAt);
  });
});

/* ------------------------------ 三态口径：冻结 ------------------------------ */

describe('三态口径：completed 整段冻结 / in_progress 半冻结 / not_started 重算', () => {
  // S1 completed 09-01~09-04；S2 in_progress 09-07~09-14；S3 not_started 09-15~09-21
  const project = makeProject();
  const stages = [
    makeStage(project.id, 1, '2026-09-01', '2026-09-04', { status: StageStatus.Completed }),
    makeStage(project.id, 2, '2026-09-07', '2026-09-14', { status: StageStatus.InProgress }),
    makeStage(project.id, 3, '2026-09-15', '2026-09-21'),
  ];
  const plan = planRestPolicyRecalc({
    projects: [{ project, stages }],
    oldPolicy: DOUBLE,
    newPolicy: SINGLE,
  });

  it('completed：整段冻结，changed=false，带冻结原因', () => {
    const s1 = planOf(plan, 1);
    expect(s1.newStartAt).toBe('2026-09-01');
    expect(s1.newEndAt).toBe('2026-09-04');
    expect(s1.changed).toBe(false);
    expect(s1.freeze).toBe('full');
    expect(s1.freezeReason).toContain('完工事实');
  });

  it('in_progress：startAt 冻结、endAt 按新制度重算（09-07~09-14 → 09-07~09-12）', () => {
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-07'); // 冻结
    expect(s2.newEndAt).toBe('2026-09-12'); // 6 个工作日落在 09-07~09-12（周六上班）
    expect(s2.changed).toBe(true);
    expect(s2.freeze).toBe('start');
    expect(s2.freezeReason).toContain('开工日是事实');
  });

  it('not_started：从冻结段的 endAt 之后第一个工作日接（09-14 → 09-14 起）', () => {
    const s3 = planOf(plan, 3);
    // 前段（in_progress）新 endAt=09-12，下一工作日（单休）= 09-14
    expect(s3.newStartAt).toBe('2026-09-14');
    expect(s3.newEndAt).toBe('2026-09-18');
    expect(s3.freeze).toBeNull();
  });

  it('frozenStageCount 只数 completed（1），changedStageCount=2', () => {
    expect(plan.frozenStageCount).toBe(1);
    expect(plan.changedStageCount).toBe(2);
  });

  it('delayed 与 not_started 同口径（起止都重算）', () => {
    const p2 = makeProject();
    const st = [
      makeStage(p2.id, 1, '2026-09-07', '2026-09-11', { status: StageStatus.Delayed }),
    ];
    const delayed = planRestPolicyRecalc({
      projects: [{ project: p2, stages: st }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(planOf(delayed, 1).newEndAt).toBe('2026-09-11');
    expect(planOf(delayed, 1).freeze).toBeNull();
  });
});

/* ------------------------------ singleRestWeekday 七个值 ------------------------------ */

describe('singleRestWeekday：七个值各一例（0=周一 … 6=周日）', () => {
  // 单阶段 not_started 项目：双休口径 09-07~09-11（5 个工作日）→ 单休 weekday=k 重算
  // 期望推导（单休只有周 k 休息、其余六天全上班；工期 5 个工作日含起点）：
  //   k=0 周一休：起点吸附到 09-08 → 09-08,09,10,11,12 → 09-12
  //   k=1 周二休：09-07,09,10,11,12 → 09-12
  //   k=2 周三休：09-07,08,10,11,12 → 09-12
  //   k=3 周四休：09-07,08,09,11,12 → 09-12
  //   k=4 周五休：09-07,08,09,10,12 → 09-12
  //   k=5 周六休：09-07,08,09,10,11 → 09-11
  //   k=6 周日休：09-07,08,09,10,11 → 09-11（与改造前逐字节一致）
  const expected: Record<number, string> = {
    0: '2026-09-12',
    1: '2026-09-12',
    2: '2026-09-12',
    3: '2026-09-12',
    4: '2026-09-12',
    5: '2026-09-11',
    6: '2026-09-11',
  };

  for (let k = 0; k <= 6; k += 1) {
    it(`singleRestWeekday=${k}：endAt=${expected[k]}，且不落在休息日`, () => {
      const project = makeProject();
      const stages = [makeStage(project.id, 1, '2026-09-07', '2026-09-11')];
      const plan = planRestPolicyRecalc({
        projects: [{ project, stages }],
        oldPolicy: DOUBLE,
        newPolicy: singleOn(k),
      });
      const s1 = planOf(plan, 1);
      expect(s1.newEndAt).toBe(expected[k]);
      expect(isRestDay(s1.newEndAt, singleOn(k))).toBe(false);
      // 工期守恒：新区间在新制度下仍是 5 个工作日
      expect(countWorkdays(s1.newStartAt, s1.newEndAt, singleOn(k))).toBe(5);
    });
  }

  it('缺省 singleRestWeekday = 周日（与旧行为逐字节一致）', () => {
    const project = makeProject();
    const stages = [makeStage(project.id, 1, '2026-09-07', '2026-09-11')];
    const legacy = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      newPolicy: { kind: RestPolicyKind.SingleOff, anchorWeek: null },
    });
    const explicit = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      newPolicy: singleOn(6),
    });
    expect(legacy).toEqual(explicit);
    expect(planOf(legacy, 1).newEndAt).toBe('2026-09-11');
  });
});

/* ------------------------------ 节假日：extraHolidays / extraWorkdays / skipHolidays ------------------------------ */

describe('节假日字段开启时重算（合并后判定）', () => {
  it('extraHolidays：新制度下周六被放假 → 阶段避开该日', () => {
    const project = makeProject();
    const stages = [
      makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
      makeStage(project.id, 2, '2026-09-14', '2026-09-18'),
    ];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      // 单休 + 09-12 周六放假 ⇒ 09-12 实际休息，S2 起点从 09-12 推到 09-14
      newPolicy: { ...SINGLE, extraHolidays: ['2026-09-12'] },
    });
    const s2 = planOf(plan, 2);
    expect(s2.newStartAt).toBe('2026-09-14');
    expect(s2.newEndAt).toBe('2026-09-18');
  });

  it('extraWorkdays：新制度下周日调休上班 → 阶段可用该日', () => {
    const project = makeProject();
    // 双休口径 09-07~09-14 = 6 个工作日（09-07..11 + 09-14）
    const stages = [makeStage(project.id, 1, '2026-09-07', '2026-09-14')];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      // 单休 + 09-13 周日调休上班 ⇒ 6 个工作日：09-07,08,09,10,11,12（周六上班）→ 09-12
      newPolicy: { ...SINGLE, extraWorkdays: ['2026-09-13'] },
    });
    const s1 = planOf(plan, 1);
    expect(s1.workdays).toBe(6);
    expect(s1.newStartAt).toBe('2026-09-07');
    expect(s1.newEndAt).toBe('2026-09-12');
  });

  it('skipHolidays：hydrate 合并内置表后，新起止避开 2026 年中秋/国庆节假日', () => {
    const project = makeProject({
      plannedStartAt: '2026-09-07T00:00:00Z',
      plannedEndAt: '2026-09-30T23:59:59Z',
    });
    // 双休+skipHolidays 下 09-07~09-30 = 18 个工作日（中秋 09-25~27 休、09-20 补班）
    const stages = [makeStage(project.id, 1, '2026-09-07', '2026-09-30')];
    const oldPolicy = hydrateRestPolicy({ kind: 'double_off', anchorWeek: null, skipHolidays: true });
    const newPolicy = hydrateRestPolicy({ kind: 'single_off', anchorWeek: null, skipHolidays: true });
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy,
      newPolicy,
    });
    const s1 = planOf(plan, 1);
    expect(s1.workdays).toBe(18);
    expect(isRestDay(s1.newStartAt, newPolicy)).toBe(false);
    expect(isRestDay(s1.newEndAt, newPolicy)).toBe(false);
    // 单休（周六上班）跳过同样的节假日 → 同样 18 个工作日提前 2 天完成
    expect(s1.newEndAt).toBe('2026-09-28');
    expect(s1.newEndAt < s1.oldEndAt).toBe(true);
  });
});

/* ------------------------------ 幂等 ------------------------------ */

describe('幂等：同制度重算第二次零变化', () => {
  it('双→双：零变化', () => {
    const plan = planRestPolicyRecalc({
      projects: [chainProject()],
      oldPolicy: DOUBLE,
      newPolicy: { kind: RestPolicyKind.DoubleOff, anchorWeek: null },
    });
    expect(plan.hasChanges).toBe(false);
    expect(plan.changedStageCount).toBe(0);
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
    for (const s of plan.projects[0].stages) expect(s.changed).toBe(false);
  });

  it('双→单算完后，以结果为旧数据再跑单→单：第二次零变化', () => {
    const first = planRestPolicyRecalc({
      projects: [chainProject()],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(first.hasChanges).toBe(true);
    // 用第一次的输出构造「已重算过的项目」（plannedEndAt 同样只增不减 → 09-30 保持）
    const project = makeProject({
      plannedEndAt: `${first.projects[0].newPlannedEndAt}T23:59:59Z`,
    });
    const stages = first.projects[0].stages.map((p) =>
      makeStage(project.id, p.orderIndex, p.newStartAt, p.newEndAt),
    );
    const second = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: SINGLE,
      newPolicy: SINGLE,
    });
    expect(second.hasChanges).toBe(false);
    expect(second.changedStageCount).toBe(0);
    expect(second.projects[0].plannedEndAtChanged).toBe(false);
  });

  it('有冻结段 + 有间隙的项目同样幂等', () => {
    const build = (): RecalcInputProject => {
      const project = makeProject();
      return {
        project,
        stages: [
          makeStage(project.id, 1, '2026-09-01', '2026-09-04', { status: StageStatus.Completed }),
          makeStage(project.id, 2, '2026-09-07', '2026-09-14', { status: StageStatus.InProgress }),
          makeStage(project.id, 3, '2026-09-23', '2026-09-29'),
        ],
      };
    };
    const first = planRestPolicyRecalc({
      projects: [build()],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    const rebased = build();
    rebased.stages = first.projects[0].stages.map((p) =>
      makeStage(rebased.project.id, p.orderIndex, p.newStartAt, p.newEndAt, {
        status: p.status,
      }),
    );
    const second = planRestPolicyRecalc({
      projects: [rebased],
      oldPolicy: SINGLE,
      newPolicy: SINGLE,
    });
    expect(second.hasChanges).toBe(false);
  });
});

/* ------------------------------ 自然日制零影响 ------------------------------ */

describe('自然日制项目零影响（plan 口径）', () => {
  it('调用方只传 workday 项目；无项目 = 空 plan 全零', () => {
    const plan = planRestPolicyRecalc({ projects: [], oldPolicy: DOUBLE, newPolicy: SINGLE });
    expect(plan.projects).toEqual([]);
    expect(plan.affectedProjectCount).toBe(0);
    expect(plan.changedStageCount).toBe(0);
    expect(plan.hasChanges).toBe(false);
  });

  it('自然日制项目不应进入 plan（契约：调用方前置过滤）——过滤器示范', () => {
    const cal = makeProject({ scheduleBasis: ScheduleBasis.Calendar });
    const wd = makeProject({ scheduleBasis: ScheduleBasis.Workday });
    const workdayOnly = [cal, wd].filter((p) => p.scheduleBasis === ScheduleBasis.Workday);
    expect(workdayOnly).toHaveLength(1);
    expect(workdayOnly[0].id).toBe(wd.id);
  });
});

/* ------------------------------ 空项目 / 单阶段 ------------------------------ */

describe('空项目与单阶段项目', () => {
  it('空项目（0 阶段）：不崩、零变化、plannedEndAt 不动', () => {
    const project = makeProject();
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages: [] }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(plan.projects[0].stages).toEqual([]);
    expect(plan.projects[0].changedStageCount).toBe(0);
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
    expect(plan.projects[0].oldPlannedEndAt).toBe('2026-09-30');
    expect(plan.projects[0].newPlannedEndAt).toBe('2026-09-30');
    expect(plan.hasChanges).toBe(false);
  });

  it('单阶段项目：锚 = 自身吸附，工期守恒', () => {
    const project = makeProject();
    // 双休口径 09-07~09-18 = 10 个工作日
    const stages = [makeStage(project.id, 1, '2026-09-07', '2026-09-18')];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    const s1 = planOf(plan, 1);
    expect(s1.workdays).toBe(10);
    expect(s1.newStartAt).toBe('2026-09-07');
    expect(s1.newEndAt).toBe('2026-09-17'); // 单休周六上班 → 10 个工作日落在 09-17
    expect(s1.changed).toBe(true);
    // plannedEndAt 只增不减：09-17 仍在计划窗口内 → 保持
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
  });

  it('首阶段起点落在新制度休息日时吸附（脏数据/周内单休）', () => {
    const project = makeProject();
    const stages = [makeStage(project.id, 1, '2026-09-13', '2026-09-18')]; // 旧制度周日完工的脏起点
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    const s1 = planOf(plan, 1);
    expect(s1.oldStartAt).toBe('2026-09-13');
    expect(s1.newStartAt).toBe('2026-09-14'); // 周日（单休休息）→ 吸附到下个工作日
    expect(s1.changed).toBe(true);
  });
});

/* ------------------------------ plannedEndAt 锚处理 ------------------------------ */

describe('plannedEndAt 锚处理：末段拖出项目计划竣工日', () => {
  it('末段 completed 冻结 → plannedEndAt 不变', () => {
    const project = makeProject();
    const stages = [
      makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
      makeStage(project.id, 2, '2026-09-14', '2026-09-18', { status: StageStatus.Completed }),
    ];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
    expect(plan.projects[0].newPlannedEndAt).toBe('2026-09-30');
  });

  it('双→单末段提前 → plannedEndAt 保持（不缩短计划窗口）', () => {
    const project = makeProject();
    const stages = [makeStage(project.id, 1, '2026-09-07', '2026-09-23')];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(plan.projects[0].newPlannedEndAt).toBe('2026-09-30');
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
  });

  it('单→双末段延后拖出窄窗口（plannedEndAt=09-18）→ 延长到末段新 endAt', () => {
    const project = makeProject({ plannedEndAt: '2026-09-18T23:59:59Z' });
    // 单休 09-07~09-21 = 12 个工作日（含三个周六）
    const stages = [makeStage(project.id, 1, '2026-09-07', '2026-09-21')];
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages }],
      oldPolicy: SINGLE,
      newPolicy: DOUBLE,
    });
    // 单休 09-07~09-21 = 13 个工作日（三个周六 09-12/19 上班 + 09-21 当天）；
    // 双休下同样 13 个 = 09-07,08,09,10,11,14,15,16,17,18,21,22,23 → 09-23
    expect(planOf(plan, 1).workdays).toBe(13);
    expect(planOf(plan, 1).newEndAt).toBe('2026-09-23');
    expect(plan.projects[0].oldPlannedEndAt).toBe('2026-09-18');
    expect(plan.projects[0].newPlannedEndAt).toBe('2026-09-23');
    expect(plan.projects[0].plannedEndAtChanged).toBe(true);
  });
});

/* ------------------------------ 工期改变模式 ------------------------------ */

describe('工期改变模式：durationOverrides', () => {
  it('填了某阶段天数 → 该阶段按新工期、其余不变', () => {
    const base = chainProject();
    const stage2Id = base.stages[1].id;
    const plan = planRestPolicyRecalc({
      projects: [base],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
      durationOverrides: { [stage2Id]: 2 },
    });
    const s1 = planOf(plan, 1);
    const s2 = planOf(plan, 2);
    const s3 = planOf(plan, 3);
    // S1 不受影响
    expect(s1.newEndAt).toBe('2026-09-11');
    expect(s1.durationOverridden).toBe(false);
    // S2 按 2 个工作日重排：09-12（周六上班）+ 09-14 → 09-12~09-14
    expect(s2.workdays).toBe(2);
    expect(s2.durationOverridden).toBe(true);
    expect(s2.newStartAt).toBe('2026-09-12');
    expect(s2.newEndAt).toBe('2026-09-14');
    // S3 链式跟随：起点 = S2 新终点之后第一个工作日 = 09-15；原工期 5 个工作日 → 09-19
    expect(s3.newStartAt).toBe('2026-09-15');
    expect(s3.newEndAt).toBe('2026-09-19');
    expect(s3.durationOverridden).toBe(false);
    // plannedEndAt 只增不减：09-21 仍在计划窗口内 → 保持
    expect(plan.projects[0].plannedEndAtChanged).toBe(false);
  });

  it('非法覆盖值（0/负）被忽略，走原工期', () => {
    const base = chainProject();
    const stage2Id = base.stages[1].id;
    const plan = planRestPolicyRecalc({
      projects: [base],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
      durationOverrides: { [stage2Id]: 0, bogus: -3 },
    });
    expect(planOf(plan, 2).durationOverridden).toBe(false);
    expect(planOf(plan, 2).workdays).toBe(5);
  });
});

/* ------------------------------ Task.dueDate 对齐 ------------------------------ */

describe('Task.dueDate：默认不跟随，可选平移', () => {
  function dueProject(): { input: RecalcInputProject; taskId: string } {
    const project = makeProject();
    const stages = [
      makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
      makeStage(project.id, 2, '2026-09-14', '2026-09-18'),
    ];
    const task = makeTask(stages[1].id, project.id, {
      title: '阶段二任务',
      dueDate: '2026-09-16',
    });
    return { input: { project, stages, tasks: [task] }, taskId: task.id };
  }

  it('默认不跟随：plan 恒算出 taskShiftCount（弹窗提示用），是否真写由应用层复选框决定', () => {
    const { input } = dueProject();
    const plan = planRestPolicyRecalc({
      projects: [input],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(plan.taskShiftCount).toBe(1);
    expect(plan.projects[0].taskShifts).toHaveLength(1);
  });

  it('到期日平移到新区间内（保持相对偏移；应用层勾选后写入）', () => {
    const { input, taskId } = dueProject();
    const plan = planRestPolicyRecalc({
      projects: [input],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(plan.taskShiftCount).toBe(1);
    const shift = plan.projects[0].taskShifts[0];
    expect(shift.taskId).toBe(taskId);
    expect(shift.oldDueDate).toBe('2026-09-16');
    // 阶段二新区间 09-12~09-17；原偏移 = 09-16 - 09-14 = 2 天 → 09-12 + 2 = 09-14
    expect(shift.newDueDate).toBe('2026-09-14');
    expect(shift.newDueDate >= '2026-09-12' && shift.newDueDate <= '2026-09-17').toBe(true);
  });

  it('阶段未变化的任务不平移；dueDate 为 null 的任务跳过', () => {
    const project = makeProject();
    const stages = [
      makeStage(project.id, 1, '2026-09-07', '2026-09-11'), // 双→单不变（首周无周六）
      makeStage(project.id, 2, '2026-09-14', '2026-09-18'),
    ];
    const t1 = makeTask(stages[0].id, project.id, { dueDate: '2026-09-09' });
    const t2 = makeTask(stages[1].id, project.id, { dueDate: null });
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages, tasks: [t1, t2] }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(plan.taskShiftCount).toBe(0);
  });

  it('原本掉出阶段区间的到期日 clamp 进新区间端点', () => {
    const project = makeProject();
    const stages = [
      makeStage(project.id, 1, '2026-09-07', '2026-09-11'),
      makeStage(project.id, 2, '2026-09-14', '2026-09-18'),
    ];
    // dueDate 掉到阶段二开始之前 3 天
    const task = makeTask(stages[1].id, project.id, { dueDate: '2026-09-11' });
    const plan = planRestPolicyRecalc({
      projects: [{ project, stages, tasks: [task] }],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    // 新区间 09-12~09-17；原偏移 -3 → 09-12-3=09-09 < start → clamp 到 09-12
    expect(plan.projects[0].taskShifts[0].newDueDate).toBe('2026-09-12');
  });
});

/* ------------------------------ reason 串 ------------------------------ */

describe('restPolicyRecalcReason：StageLog 留痕原因', () => {
  it('格式为「休息制度切换：旧→新」（新制度名）', () => {
    expect(restPolicyRecalcReason(DOUBLE, SINGLE)).toBe('休息制度切换：双休→单休');
    expect(restPolicyRecalcReason(SINGLE, BIG_SMALL)).toBe('休息制度切换：单休→大小休');
    expect(restPolicyRecalcReason(BIG_SMALL, DOUBLE)).toBe('休息制度切换：大小休→双休');
  });
});

/* ------------------------------ 多项目汇总 ------------------------------ */

describe('多项目：汇总计数与混合场景', () => {
  it('两项目（一个全冻结、一个有变化）：计数分别汇总', () => {
    const p1 = makeProject();
    const s1 = [makeStage(p1.id, 1, '2026-09-07', '2026-09-11', { status: StageStatus.Completed })];
    const p2 = makeProject();
    const s2 = [
      makeStage(p2.id, 1, '2026-09-07', '2026-09-11'),
      makeStage(p2.id, 2, '2026-09-14', '2026-09-18'),
    ];
    const plan = planRestPolicyRecalc({
      projects: [
        { project: p1, stages: s1 },
        { project: p2, stages: s2 },
      ],
      oldPolicy: DOUBLE,
      newPolicy: SINGLE,
    });
    expect(plan.affectedProjectCount).toBe(2);
    expect(plan.changedStageCount).toBe(1); // 只有 p2 的 S2
    expect(plan.frozenStageCount).toBe(1); // p1 的 completed
    expect(plan.projects[0].changedStageCount).toBe(0);
    expect(plan.projects[1].changedStageCount).toBe(1);
  });

  it('出厂默认（DEFAULT_REST_POLICY）作旧制度不抛错', () => {
    const base = chainProject();
    const plan = planRestPolicyRecalc({
      projects: [base],
      oldPolicy: DEFAULT_REST_POLICY,
      newPolicy: SINGLE,
    });
    expect(plan.changedStageCount).toBe(2);
  });
});
