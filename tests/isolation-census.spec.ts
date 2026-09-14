/**
 * L2 · Agent 隔离**派生函数穷举** ＋ L3 · **反向断言**（v0.8 · 设计 §7.7 的 L2/L3 行）。
 *
 * ═══════════════════════ 为什么需要一个"表驱动"的 spec ═══════════════════════
 *
 * `tests/isolation-guard.spec.ts`（L1）守的是「**有人绕过漏斗**」——它是**静态**的，
 * 只能看见"直接读 `store.projects`"这种形状。它**看不见**下面这一类漏点：
 *
 *   > 用了漏斗，但**忘了**用（或用了错的一侧）。
 *
 * 例：`MemberBoardPage` 昨天用 `useHumanTasks()`，今天有人为了拿"本月完成数"改成
 * `useProjectsStore((s) => s.tasks)` —— L1 只守 `projects` 切片，这次改动**不会红**；
 * 而它的后果是"AI 指派给人类成员的任务"漏进成员看板（设计 §7.2 #15 标注的
 * ★★关键漏点：`assigneeHuman` 一指向成员，那个 Agent 看板就漏进来了）。
 *
 * 于是本 spec 把设计 §7.2 的 **27 项清单**从「人工清单」变成**可执行断言**：
 * 一行 = 一项（`id` 就是表里的 #）。清单会腐化（今天 27 项全对，明天有人加第 28 处），
 * 而 L1 的白名单 ＋ 本表驱动断言的组合，使"新增任何一项含项目数据的位置"
 * **必须**在 L1 或 L2 里有交代（否则红）。
 *
 * ── 每一行怎么被断言（三段，缺一行的绿灯就是空的）──
 *   ① **本行断言**：按该行**自己的**接法（P / Pid / A / — / 特判）算出的渲染集合里，
 *      Agent 看板名出现次数 `=== row.expect`；
 *   ② **判别力**（`direction` 为 human/agent 的行才有）：把该行的 kind 收窄**故意关掉**
 *      （`see = 'none'`），断言 Agent 看板名**确实**会漏出来 —— 否则这一行的绿灯
 *      可能是"夹具里本来就没有能漏的东西"造成的**假绿**（本项目高发区，§12.3）；
 *   ③ **L3 反向**（`direction === 'agent'` 的行）：把 `see` 换成人类侧，断言
 *      **人类**项目名出现 0 次 —— 这就是 §7.7 的「#20/#21 反向排除」。
 *
 * ── 与设计文本的**两处**刻意对齐差异（写出来，免得被当成实现偏差）──
 *   1. §7.7 的 L2 行写「断言 Agent 数据出现次数 ＝ 0（第 22/23/24/25 项…＝ 1）」，
 *      这是一个**单侧**表述。但 §7.2 里 #20/#21 的接法是 **A**（反向：只统计 Agent 看板），
 *      它们**本来就该**看到 Agent 数据 —— 按"＝ 0"实现会直接把正确的代码判红。
 *      故本表给每行加 `direction`：`'human'` 行断言 0，`'agent'` 行断言 1
 *      （并把"人类名 0 次"放进 ③ 的反向断言，这正是 §7.7 L3 行原文要的）。
 *   2. §7.7 说夹具里 Agent 侧任务字段叫 `assigneeHuman`；**实体里没有这个字段**。
 *      实际泄漏向量是 `Task.assigneeIds`（含人类成员的 id）——见 §7.2 #15 的机理描述
 *      「AI 把任务 `assigneeHuman` 指给成员」。夹具按**实际字段名** `assigneeIds` 构造，
 *      语义与设计文本逐字一致（Agent 看板的任务挂在人类成员名下）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Member, Project, Stage, Task } from '../src/core/types/entities';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ProjectType,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
  type ProjectKind,
  type TaskSource,
} from '../src/core/types/enums';
import {
  effectiveDomainOf,
  filterByProjectKind,
  projectKindOf,
  needsDomainConfirm,
  visibleProjectIds,
  visibleProjectsFor,
} from '../src/core/project/visibility';
import { deriveColumns } from '../src/pages/HomePage';
import { computeProjectStatus } from '../src/lib/progress';

const ROOT = join(__dirname, '..');

/**
 * 剥掉注释后的源码。
 *
 * ★ 为什么下面那组「源码锚点」的**否定式**断言必须用剥注释后的文本：
 *   本仓的注释风格是"把旧实现/反例**抄进注释里**讲清楚为什么改"（§7.5 就是这么写的）。
 *   于是 `not.toContain("getPreset(")` 会被 **HomePage 自己那句
 *   「老代码（已修掉）：`const preset = … ? getPreset(p.stagePresetKey) : null`」**
 *   判红 —— 断言测到的是注释，不是代码。这是一个**纯度**问题，不是宽松：
 *   去掉注释后，"真的还在调用"仍会被抓到。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
}

/* ══════════════════════════════ 夹具常量 ══════════════════════════════ */

/** 固定的"今天"：全部派生显式注入，用例幂等可重放 */
const TODAY = '2026-09-03';

/**
 * 两个名字带**共同子串**「长夏」，好让 #13（顶栏全局搜索）有一个
 * "能同时匹配人类项目与 Agent 看板"的查询词 —— 否则 #13 的对断是空的。
 */
const HUMAN_NAME = '长夏·人类项目';
const AGENT_NAME = '长夏·AI看板';
const HUMAN_MEMBER = '成员甲';
const AGENT_MEMBER = 'Agent甲';

const HUMAN_ID = 'proj_human';
const AGENT_ID = 'proj_agent';

/* ══════════════════════════════ 夹具工厂 ══════════════════════════════ */

function makeProject(
  over: Partial<Project> & Pick<Project, 'id' | 'name' | 'kind'>,
): Project {
  return {
    type: ProjectType.Dining,
    address: '示例地址',
    clientName: '示例客户',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-09-30',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: 'indoor_full',
    stageTemplateVersion: 2,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: 'indoor',
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** 每个项目 3 个阶段：s1 已完成（9/2 完）／s2 进行中（9/4 到期）／s3 未开始（9/9 到期） */
function makeStages(projectId: string, prefix: string): Stage[] {
  const ranges: Array<[number, string, string, StageStatus]> = [
    [1, '2026-09-01', '2026-09-02', StageStatus.Completed],
    [2, '2026-09-03', '2026-09-04', StageStatus.InProgress],
    [3, '2026-09-05', '2026-09-09', StageStatus.NotStarted],
  ];
  return ranges.map(([i, startAt, endAt, status]) => ({
    id: `stg_${prefix}_${i}`,
    projectId,
    orderIndex: i,
    templateKey: null,
    colorIndex: i,
    customColor: null,
    name: `${prefix}阶段${i}`,
    ratioPercent: 33,
    startAt,
    endAt,
    status,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  }));
}

/**
 * 每个项目 5 个任务。
 *
 * ★ `assigneeId` / `assigneeIds` **两者都塞人类成员** —— 这是 §7.2 #15 的泄漏向量：
 *   Agent 看板的任务挂在人类成员名下，若成员看板/我的任务页不按 `projectId` 收窄，
 *   这个 Agent 看板就会从那两处漏出去。
 */
function makeTasks(
  projectId: string,
  stageIds: readonly string[],
  prefix: string,
  source: TaskSource,
  assigneeMemberId: string,
): Task[] {
  return [0, 1, 2, 3, 4].map((i) => ({
    id: `tsk_${prefix}_${i}`,
    taskNo: 1000 + i,
    projectId,
    stageId: stageIds[i % stageIds.length]!,
    title: `${prefix}任务${i}`,
    done: false,
    assigneeId: assigneeMemberId,
    assigneeIds: [assigneeMemberId],
    dueDate: '2026-09-04',
    source,
    externalId: null,
    agentId: null,
    status: TaskStatus.Ready,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: i,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  }));
}

function makeMember(id: string, name: string, actorKind: MemberActorKind): Member {
  return {
    id,
    name,
    role: '设计',
    contact: null,
    avatarColor: '#000000',
    active: true,
    roleKind: actorKind === MemberActorKind.Agent ? MemberRoleKind.Member : MemberRoleKind.Admin,
    passwordHash: null,
    actorKind,
    agentKind: actorKind === MemberActorKind.Agent ? 'workbuddy' : null,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

interface Fixture {
  projects: Project[];
  stages: Stage[];
  tasks: Task[];
  members: Member[];
}

function buildFixture(
  projects: readonly Project[],
  stagePrefixes: Record<string, string>,
): Fixture {
  const stages = projects.flatMap((p) => makeStages(p.id, stagePrefixes[p.id] ?? p.id));
  const tasks = projects.flatMap((p) => {
    const ids = stages.filter((s) => s.projectId === p.id).map((s) => s.id);
    return makeTasks(
      p.id,
      ids,
      stagePrefixes[p.id] ?? p.id,
      p.kind === 'agent' ? 'agent' : 'human',
      HUMAN_MEMBER,
    );
  });
  return {
    projects: [...projects],
    stages,
    tasks,
    members: [
      makeMember('mem_human', HUMAN_MEMBER, MemberActorKind.Human),
      makeMember('mem_agent', AGENT_MEMBER, MemberActorKind.Agent),
    ],
  };
}

/**
 * 主夹具：**1 个人类项目 ＋ 1 个 Agent 看板**（各 3 阶段 5 任务，
 * Agent 侧任务 `assigneeIds` 指向同一人类成员 —— 设计 §7.7 的夹具要求）。
 *
 * ★ Agent 看板刻意写成 `stagePresetKey: 'custom'` ＋ `domain: 'software'`：
 *   ① `domain: 'software'` 让它的看板列（planning/designing/developing/…）
 *      与人类项目（indoor：design/deepen/build）**完全不相交** ⇒ #8 的对断非空；
 *   ② `stagePresetKey: 'custom'` 让 `getPreset('custom') === null` ——
 *      这正是**纠错③**的现场：老 `deriveColumns` 在这种项目上整体失效。
 */
const MAIN: Fixture = buildFixture(
  [
    makeProject({ id: HUMAN_ID, name: HUMAN_NAME, kind: 'human' }),
    makeProject({
      id: AGENT_ID,
      name: AGENT_NAME,
      kind: 'agent',
      stagePresetKey: 'custom',
      domain: 'software',
      // #5 的判别力需要它：Agent 看板的计划完工日已过 ⇒ 未收窄时必然进入「逾期风险」
      plannedEndAt: '2026-08-20',
    }),
  ],
  { [HUMAN_ID]: 'h', [AGENT_ID]: 'a' },
);

/** 「库里只有 Agent 看板」夹具 —— #10 空态判定的现场 */
const AGENT_ONLY: Fixture = buildFixture(
  [makeProject({ id: AGENT_ID, name: AGENT_NAME, kind: 'agent', domain: 'software' })],
  { [AGENT_ID]: 'a' },
);

/** 「库里的两类项目都已归档」夹具 —— #2/#16 的现场（Agent 不参与人类归档语义） */
const ARCHIVED: Fixture = buildFixture(
  [
    makeProject({ id: HUMAN_ID, name: HUMAN_NAME, kind: 'human', status: ProjectStatus.Archived }),
    makeProject({
      id: AGENT_ID,
      name: AGENT_NAME,
      kind: 'agent',
      status: ProjectStatus.Archived,
      domain: 'software',
    }),
  ],
  { [HUMAN_ID]: 'h', [AGENT_ID]: 'a' },
);

/* ══════════════════════════════ 派生辅助（全部纯函数） ══════════════════════════════

 * `see` 是本 spec 的核心旋钮：
 *   · `'human'` / `'agent'` → 按该侧收窄（**该行的正确接法**）；
 *   · `'none'`              → **故意关掉收窄**（"有人忘了过滤"的假想态），
 *                             用于②的判别力对断。
 */

type See = ProjectKind | 'none';

function projectsFor(f: Fixture, see: See): Project[] {
  return see === 'none' ? [...f.projects] : visibleProjectsFor(see, f.projects);
}

function idsFor(f: Fixture, see: See): Set<string> {
  return see === 'none'
    ? new Set(f.projects.map((p) => p.id))
    : visibleProjectIds(see, f.projects);
}

function projectNameOf(f: Fixture, projectId: string): string {
  return f.projects.find((p) => p.id === projectId)?.name ?? '<unknown>';
}

/** 取某 id 下的阶段（**不按 kind 收窄** —— 单项目直达口径，§7.3） */
function stagesOf(f: Fixture, projectId: string): Stage[] {
  return f.stages.filter((s) => s.projectId === projectId);
}

/* ------------------------------ 与 HomePage 同口径的日期小工具 ------------------------------
 * HomePage 里 `startOfWeekIso` / `endOfWeekIso` 是模块私有（未导出），
 * 故此处按**同一口径**（周一为一周起点、本地时区）重写；两处口径若漂移，
 * #4 的对断会先红，比"悄悄少算几天"好。
 */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekBounds(todayIso: string): { start: string; end: string } {
  const [y, m, d] = todayIso.split('-').map(Number);
  const base = new Date(y!, m! - 1, d!);
  const dow = (base.getDay() + 6) % 7; // 周一 = 0
  const start = new Date(base);
  start.setDate(base.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: localIso(start), end: localIso(end) };
}

/* ══════════════════════════════ 计数与表结构 ══════════════════════════════ */

function countOf(labels: readonly string[], target: string): number {
  return labels.filter((l) => l === target).length;
}

type Direction = ProjectKind | 'none' | 'special';
type Wiring = 'P' | 'Pid' | 'A' | '—' | '特判' | 'n/a';

interface CensusRow {
  /** 设计 §7.2 的项号（1..27，与表逐行对应） */
  id: number;
  /** §7.2「位置」列原文 */
  where: string;
  /** §7.2「数据源」列原文 */
  source: string;
  /** §7.2「接法」列 */
  wiring: Wiring;
  /**
   * 该行**该看到**的一侧。
   * `'none'` ＝ 本行有意不做 kind 排除（#22/#23/#24/#25，以及 #19 的宽口径）。
   * `'special'` ＝ §7.3 的单项目直达特判（#17/#18/#27，允许穿越但必须带来源标识）。
   */
  see: See | 'special';
  /** 被计数的标签（默认 Agent 看板名；#24 计 Agent 成员名） */
  target: string;
  /** 期望：`target` 在该行渲染集合里出现的次数 */
  expect: number;
  /** 本行用哪套夹具 */
  fixture: Fixture;
  /** 该行对应的**纯派生**：返回"这一行会渲染出来的一串名字" */
  derive: (f: Fixture, see: See) => string[];
  /** 口径说明（尤其当 expect 不是 0/1 的直觉值时） */
  note?: string;
}

const rows: CensusRow[] = [
  /* ───────────────────────── #1–#11 · 人类侧（P / Pid） ───────────────────────── */
  {
    id: 1,
    where: '首页 · 项目卡片网格',
    source: 'projects active',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) =>
      projectsFor(f, see)
        .filter((p) => p.status === ProjectStatus.Active)
        .map((p) => p.name),
  },
  {
    id: 2,
    where: '首页 · 「已归档」折叠区',
    source: 'projects 非 active',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: ARCHIVED,
    derive: (f, see) =>
      projectsFor(f, see)
        .filter((p) => p.status !== ProjectStatus.Active)
        .map((p) => p.name),
    note: '用 ARCHIVED 夹具：Agent 看板**也**是 archived 时，人类归档区仍不许出现它（Agent 归档是独立概念，P1）',
  },
  {
    id: 3,
    where: '首页 · 统计卡「进行中项目」',
    source: 'active.length',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) =>
      projectsFor(f, see)
        .filter((p) => p.status === ProjectStatus.Active)
        .map((p) => p.name),
    note: '口径 = `active.length`。此处返回名字而非数字，好让"哪一个漏进来了"在红灯里直接可读',
  },
  {
    id: 4,
    where: '首页 · 统计卡「本周到期任务」',
    source: '全部 stages',
    wiring: 'Pid',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => {
      const { start, end } = weekBounds(TODAY);
      return filterByProjectKind(f.stages, idsFor(f, see))
        .filter(
          (s) =>
            s.visible !== false &&
            s.status !== StageStatus.Completed &&
            s.endAt.slice(0, 10) >= start &&
            s.endAt.slice(0, 10) <= end,
        )
        .map((s) => projectNameOf(f, s.projectId));
    },
    note: '★ PRD 自标「派生自 stages 不是 projects ⇒ 最容易漏」。夹具下每项目恰 1 段命中 ⇒ 判别力对断非空',
  },
  {
    id: 5,
    where: '首页 · 统计卡「逾期风险」',
    source: 'active ＋ computeProjectStatus',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) =>
      projectsFor(f, see)
        .filter(
          (p) =>
            p.status === ProjectStatus.Active &&
            computeProjectStatus(p, stagesOf(f, p.id), TODAY) === 'overdue',
        )
        .map((p) => p.name),
    note: '夹具里 Agent 看板的 plannedEndAt 是过去日（overdue）⇒ 忘了过滤必然漏出，判别力非空',
  },
  {
    id: 6,
    where: '首页 · 统计卡「本月完工」',
    source: '全部 stages',
    wiring: 'Pid',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => {
      const monthPrefix = TODAY.slice(0, 7);
      return filterByProjectKind(f.stages, idsFor(f, see))
        .filter((s) => s.status === StageStatus.Completed && s.endAt.slice(0, 7) === monthPrefix)
        .map((s) => projectNameOf(f, s.projectId));
    },
    note: '★ 同 #4，同为 Pid 类（数据源是 stages）',
  },
  {
    id: 7,
    where: '首页 · 月历 MonthlyCalendarView',
    source: 'active projects',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => {
      const activeIds = new Set(
        projectsFor(f, see)
          .filter((p) => p.status === ProjectStatus.Active)
          .map((p) => p.id),
      );
      return filterByProjectKind(f.stages, activeIds).map((s) => projectNameOf(f, s.projectId));
    },
    note: '月历的项目色带来自 active projects 的阶段 ⇒ 与 #1 同源但取的是 stages（口径更严）',
  },
  {
    id: 8,
    where: '首页 · deriveColumns',
    source: '在库项目的 domain',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (_f, see) => {
      const f = MAIN;
      const ps = projectsFor(f, see);
      // 「这一列是被谁拉进来的」：先求"除掉 Agent 看板之后的列集合"，
      // 再逐列判断它是否只在含 Agent 看板时才存在 —— 只有 Agent 看板能贡献的列
      // 记一次 `AGENT_NAME`。漏过滤时（see='none'）它至少贡献一个独有列。
      const withoutAgent = new Set(
        deriveColumns(ps.filter((p) => p.id !== AGENT_ID)).map((c) => c.key),
      );
      return deriveColumns(ps)
        .map((c) => c.key)
        .filter((k) => !withoutAgent.has(k))
        .map(() => AGENT_NAME);
    },
    note: '★ 同时是纠错③的现场：Agent 看板是 custom 套餐（getPreset 返回 null），老实现会整体失效',
  },
  {
    id: 9,
    where: '首页 · 搜索 filtered',
    source: 'active',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => {
      const q = '长夏'; // 两类名字的共同子串 ⇒ 这个查询词能同时命中两侧，对断非空
      return projectsFor(f, see)
        .filter((p) => p.status === ProjectStatus.Active)
        .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        .map((p) => p.name);
    },
    note: '夹具两名字均含「长夏」⇒ 该查询词在未过滤时必然同时命中两侧',
  },
  {
    id: 10,
    where: '首页 · 空态判定',
    source: 'active.length === 0',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: AGENT_ONLY,
    derive: (f, see) => {
      const actives = projectsFor(f, see)
        .filter((p) => p.status === ProjectStatus.Active)
        .map((p) => p.name);
      return actives.length === 0 ? ['<空态>'] : actives;
    },
    note: '★ 用 AGENT_ONLY 夹具：库里只有 Agent 看板时，人类首页必须是**空态**（不能"有项目却一片空白"）',
  },
  {
    id: 11,
    where: '侧栏 · 我的项目列表 ＋「还有 N 个」＋ 折叠态 top3',
    source: 'projects',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => projectsFor(f, see).map((p) => p.name),
    note: '★ 这一处是 #17/#18/#27 的**入口结构性关闭**的依据（人类侧列表里根本不出现它）',
  },
  {
    id: 12,
    where: '侧栏 ·「我的任务」角标',
    source: '—（不存在）',
    wiring: 'n/a',
    see: 'none',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: () => [],
    note: 'TBD-7 裁决：该角标**不存在**，已从清单删除。存在性由下方专用用例守住（源码锚点），不靠本行',
  },
  {
    id: 13,
    where: '顶栏 · 全局搜索',
    source: 'projects（占位「搜索项目、任务、成员」）',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => {
      const q = '长夏';
      return projectsFor(f, see)
        .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        .map((p) => p.name);
    },
  },
  {
    id: 14,
    where: '我的任务页',
    source: '全部 tasks',
    wiring: 'Pid',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) =>
      filterByProjectKind(f.tasks, idsFor(f, see))
        .filter((t) => t.assigneeIds.includes(HUMAN_MEMBER) || t.assigneeId === HUMAN_MEMBER)
        .map((t) => projectNameOf(f, t.projectId)),
    note: '★ 用户决策 2 明示；AI 指派给人类成员的任务**也不出现**（夹具正是这么造的）',
  },
  {
    id: 15,
    where: '成员看板 MemberBoardPage（任务/阶段反查 ＋ 3 统计卡 ＋ groupByColumn）',
    source: '任务/阶段反查',
    wiring: 'Pid',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => [
      ...filterByProjectKind(f.tasks, idsFor(f, see))
        .filter((t) => t.assigneeIds.includes(HUMAN_MEMBER))
        .map((t) => projectNameOf(f, t.projectId)),
      ...filterByProjectKind(f.stages, idsFor(f, see)).map((s) => projectNameOf(f, s.projectId)),
    ],
    note: '★★ §7.2 标注的关键漏点：Agent 任务挂到人类成员名下时，若不按 projectId 收窄就会漏',
  },
  {
    id: 16,
    where: '归档语义',
    source: 'status',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: ARCHIVED,
    derive: (f, see) =>
      projectsFor(f, see)
        .filter((p) => p.status === ProjectStatus.Archived)
        .map((p) => p.name),
    note: 'Agent 归档是独立概念（P1）；本行只保证它不混进人类归档语义',
  },
  {
    id: 17,
    where: '打印 /project/:id/schedule-print',
    source: '单项目',
    wiring: '特判',
    see: 'special',
    target: AGENT_NAME,
    // 只允许"正文那一次"出现（穿越），任何"顺手带出"的列表里都不许有它
    expect: 1,
    fixture: MAIN,
    derive: (f) => {
      const target = f.projects.find((p) => p.id === AGENT_ID);
      return [target?.name ?? '<missing>', ...projectsFor(f, 'human').map((p) => p.name)];
    },
    note: '§7.3 #17/#18：路由**保留可打开**（删路由会破深链），但打开后必须渲染「AI 工作区」来源标识；expect=1 的含义是"只在这一处出现一次"',
  },
  {
    id: 18,
    where: '打印 /project/:id/calendar-print',
    source: '单项目',
    wiring: '特判',
    see: 'special',
    target: AGENT_NAME,
    expect: 1,
    fixture: MAIN,
    derive: (f) => {
      const target = f.projects.find((p) => p.id === AGENT_ID);
      return [target?.name ?? '<missing>', ...projectsFor(f, 'human').map((p) => p.name)];
    },
    note: '同 #17（同一特判设计）',
  },
  {
    id: 19,
    where: '成员可见范围 useRoleGuard',
    source: '角色',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => projectsFor(f, see).map((p) => p.name),
    note: 'D5：member 可进可建、接管仅 admin。**guard 本身不加 kind 限制**（它只看角色），0 是「它保护范围内的项目列表」的口径',
  },

  /* ───────────────────────── #20–#21 · Agent 侧（A · 反向排除） ───────────────────────── */
  {
    id: 20,
    where: 'Agent 看板 · 项目下拉',
    source: 'projects 全量',
    wiring: 'A',
    see: 'agent',
    target: AGENT_NAME,
    expect: 1,
    fixture: MAIN,
    derive: (f, see) => projectsFor(f, see).map((p) => p.name),
    note: '★★「现状最刺眼处」：下拉里曾是人类项目。本行断言 Agent 看板**在**（1 次），反向由 L3 断言人类名 0 次',
  },
  {
    id: 21,
    where: 'Agent 统计 SourceStatCard',
    source: 'projectTasks ＋ members',
    wiring: 'A',
    see: 'agent',
    target: AGENT_NAME,
    expect: 1,
    fixture: MAIN,
    derive: (f, see) =>
      // 按看板去重：本行回答的是"有几个 Agent 看板被统计进来"，不是"有几条任务"
      [...new Set(projectsFor(f, see).map((p) => p.name))],
    note: '只统计 Agent 看板；去重后 1 = 恰一个 Agent 看板进入统计',
  },

  /* ───────────────────────── #22–#25 · 有意不排除（—） ───────────────────────── */
  {
    id: 22,
    where: '备份导出/导入',
    source: "list({status:'all'})",
    wiring: '—',
    see: 'none',
    target: AGENT_NAME,
    expect: 1,
    fixture: ARCHIVED,
    derive: (f, see) => projectsFor(f, see).map((p) => p.name),
    note: '两者都要备份 ⇒ 有意不排除（Agent 名恰出现 1 次）。"`kind` 必须随备份往返"由下方专用用例断言',
  },
  {
    id: 23,
    where: '服务端 GET /api/projects',
    source: '全量',
    wiring: '—',
    see: 'none',
    target: AGENT_NAME,
    expect: 1,
    fixture: MAIN,
    derive: (f, see) => projectsFor(f, see).map((p) => p.name),
    note: '必须透出 `kind` 供前端分流 ⇒ 有意不排除；服务端未按 kind 过滤由源码锚点断言',
  },
  {
    id: 24,
    where: '成员管理 MembersPageSection',
    source: '成员',
    wiring: '—',
    see: 'none',
    target: AGENT_MEMBER,
    expect: 1,
    fixture: MAIN,
    derive: (f) => f.members.map((m) => m.name),
    note: '成员不分 kind ⇒ Agent 行为体也在成员管理里（计的是 **Agent 成员名**，不是看板名）',
  },
  {
    id: 25,
    where: '首启闸门 / HomeRouteGuard',
    source: 'hydrated / 角色',
    wiring: '—',
    see: 'none',
    target: AGENT_NAME,
    expect: 1,
    fixture: MAIN,
    derive: (f, see) => projectsFor(f, see).map((p) => p.name),
    note: '闸门是全库级别、不按 kind 排除（"#10 受其影响"：闸门放行后 #10 的空态判定才有意义）',
  },
  {
    id: 26,
    where: 'Agent 通道 listProjectCandidates()',
    source: '全量项目',
    wiring: 'P',
    see: 'human',
    target: AGENT_NAME,
    expect: 0,
    fixture: MAIN,
    derive: (f, see) => projectsFor(f, see).map((p) => p.name),
    note: '★ 是 `human` **不是** `agent`：候选集只列人类项目（防 AI 误写人类项目）。SQL 侧收窄由源码锚点断言',
  },
  {
    id: 27,
    where: '项目详情页 /project/:id',
    source: '单项目',
    wiring: '特判',
    see: 'special',
    target: AGENT_NAME,
    expect: 1,
    fixture: MAIN,
    derive: (f) => {
      const target = f.projects.find((p) => p.id === AGENT_ID);
      // 正文（允许穿越的那一处）＋ 页内任何人类侧列表（相关项目/面包屑/侧栏高亮）
      return [target?.name ?? '<missing>', ...projectsFor(f, 'human').map((p) => p.name)];
    },
    note: '★ §7.3 #27：详情页是**唯一允许穿越**的通道，但必须**单向** —— expect=1 保证页内其它派生一次都没带出它',
  },
];

/* ══════════════════════════════ 表完整性 ══════════════════════════════ */

describe('L2 清单完整性（清单腐化守卫）', () => {
  it('恰好 27 行，且 id 就是 1..27（与设计 §7.2 逐行对应）', () => {
    expect(rows.map((r) => r.id)).toEqual(
      Array.from({ length: 27 }, (_, i) => i + 1),
    );
  });

  it('判别力对断（see !== none/special）的行必须**真的**会漏 —— 否则绿灯是空的', () => {
    const probeable = rows.filter((r) => r.see !== 'none' && r.see !== 'special');
    const vacuous = probeable
      .filter((r) => countOf(r.derive(r.fixture, 'none'), r.target) === 0)
      .map((r) => `#${r.id} ${r.where}`);
    expect(
      vacuous,
      [
        '以下行在"故意关掉 kind 收窄"后依然数不到目标名 —— 说明该行的夹具里根本没有能漏的东西，',
        '它的绿灯是**假绿**（设计 §12.3 明列的高发区）。请修夹具，别改断言：',
        ...vacuous,
      ].join('\n'),
    ).toEqual([]);
  });
});

/* ══════════════════════════════ ① L2 · 本行断言 ══════════════════════════════ */

describe('L2 · 27 项逐行断言（Agent 数据在该行的渲染集合里出现几次）', () => {
  for (const row of rows) {
    if (row.wiring === 'n/a') {
      it(`#${row.id} ${row.where} → 本项已删除（TBD-7），见专用存在性用例`, () => {
        expect(row.expect).toBe(0);
        expect(row.derive(row.fixture, 'none')).toEqual([]);
      });
      continue;
    }

    const see: See = row.see === 'special' ? 'human' : row.see;

    it(`#${row.id} ${row.where} → 「${row.target}」出现 ${row.expect} 次`, () => {
      const labels = row.derive(row.fixture, see);
      expect(
        countOf(labels, row.target),
        `#${row.id} ${row.where}（接法 ${row.wiring}${row.note ? ` · ${row.note}` : ''}）\n` +
          `渲染集合 = ${JSON.stringify(labels)}`,
      ).toBe(row.expect);
    });
  }
});

/* ══════════════════════════════ ② 判别力（反面对断） ══════════════════════════════ */

describe('L2 · 判别力：故意关掉 kind 收窄后，Agent 数据**确实**会漏进来', () => {
  for (const row of rows) {
    if (row.see === 'none' || row.see === 'special' || row.wiring === 'n/a') continue;

    it(`#${row.id} ${row.where} → 关掉收窄后能数到「${row.target}」`, () => {
      const leaked = countOf(row.derive(row.fixture, 'none'), row.target);
      expect(
        leaked,
        `#${row.id} ${row.where} 在未收窄时数不到目标名 ⇒ 该行断言无判别力（假绿）`,
      ).toBeGreaterThan(0);
    });
  }
});

/* ══════════════════════════════ ③ L3 · 反向断言 ══════════════════════════════ */

describe('L3 · 反向：人类数据在 Agent 侧出现 0 次（§7.7 的「#20/#21 反向排除」）', () => {
  const mirror = rows.filter((r) => r.see === 'agent');

  it('镜像行恰好是 #20/#21（清单漂移会让本用例先红）', () => {
    expect(mirror.map((r) => r.id)).toEqual([20, 21]);
  });

  for (const row of mirror) {
    it(`#${row.id} ${row.where} → 人类项目「${HUMAN_NAME}」出现 0 次`, () => {
      // 取该行**自己的**（＝ Agent 侧）派生，断言人类项目一次都没有被带出来
      const labels = row.derive(row.fixture, 'agent');
      expect(
        countOf(labels, HUMAN_NAME),
        `#${row.id} 的 Agent 侧派生把人类项目带了出来：${JSON.stringify(labels)}`,
      ).toBe(0);
    });
  }

  it('#26 · listProjectCandidates() 只含人类项目 —— 反向（`agent` 侧）必须能看到看板', () => {
    const row = rows.find((r) => r.id === 26)!;
    // 正向：候选集里没有 Agent 看板（0 次）
    expect(countOf(row.derive(row.fixture, 'human'), AGENT_NAME)).toBe(0);
    // 反向：同一个派生换个 side，Agent 看板**确实**在库里 —— 证明上面那个 0 是真的过滤出来的
    expect(countOf(row.derive(row.fixture, 'agent'), AGENT_NAME)).toBe(1);
  });

  it('L3 · 人类侧全量列表（#1/#2/#11/#16 共用口径）在两类数据都在库时不含 Agent 看板', () => {
    for (const seed of [MAIN, ARCHIVED]) {
      expect(visibleProjectsFor('human', seed.projects).map((p) => p.name)).not.toContain(
        AGENT_NAME,
      );
      // 且 Agent 侧不会反过来漏出人类项目（两侧互为镜像）
      expect(visibleProjectsFor('agent', seed.projects).map((p) => p.name)).not.toContain(
        HUMAN_NAME,
      );
    }
  });
});

/* ══════════════════════════════ 行外专用用例（本行断言盖不住的形态） ══════════════════════════════ */

describe('#8 · 纠错③ 回归：deriveColumns 读 `project.domain`，不再从 preset 反推', () => {
  it('custom 套餐 ＋ 已确认 domain ⇒ 列集合**按 domain** 出（老实现整体失效）', () => {
    const customIndoor: Project = makeProject({
      id: 'proj_custom_indoor',
      name: '自定义室内',
      kind: 'human',
      stagePresetKey: 'custom',
      domain: 'indoor',
    });
    const customSoftware: Project = makeProject({
      id: 'proj_custom_sw',
      name: '自定义软件',
      kind: 'human',
      stagePresetKey: 'custom',
      domain: 'software',
    });

    const indoorKeys = deriveColumns([customIndoor]).map((c) => c.key);
    const softwareKeys = deriveColumns([customSoftware]).map((c) => c.key);

    // 老实现：`getPreset('custom')` → null ⇒ 两处都只出兜底 indoor 列（software 那份被算进 indoor）
    expect(softwareKeys).not.toEqual(indoorKeys);
    expect(softwareKeys).toContain('developing'); // 软件开发板块独有列
    expect(indoorKeys).toContain('deepen'); // 室内板块独有列
  });

  it('custom 套餐 ＋ domain 为 null ⇒ 读时回落 indoor（行为与今天逐字一致，零回归）', () => {
    const unresolved = makeProject({
      id: 'proj_custom_null',
      name: '自定义未确认',
      kind: 'human',
      stagePresetKey: 'custom',
      domain: null,
    });
    expect(effectiveDomainOf(unresolved)).toBe('indoor');
    expect(needsDomainConfirm(unresolved)).toBe(true);
  });

  it('TBD-10 待确认判定的边界：有 domain 不提示；非 custom 套餐不提示', () => {
    expect(
      needsDomainConfirm(
        makeProject({ id: 'a', name: 'a', kind: 'human', stagePresetKey: 'custom', domain: null }),
      ),
    ).toBe(true);
    expect(
      needsDomainConfirm(
        makeProject({
          id: 'b',
          name: 'b',
          kind: 'human',
          stagePresetKey: 'custom',
          domain: 'software',
        }),
      ),
    ).toBe(false);
    expect(
      needsDomainConfirm(
        makeProject({
          id: 'c',
          name: 'c',
          kind: 'human',
          stagePresetKey: 'indoor_full',
          domain: null,
        }),
      ),
    ).toBe(false);
  });
});

describe('谓词口径（两侧互为镜像 · kind 缺失回落人类侧）', () => {
  it('projectKindOf：只认字面量 agent，其余（含 undefined/脏值）一律人类侧', () => {
    expect(projectKindOf({ kind: 'agent' })).toBe('agent');
    expect(projectKindOf({ kind: 'human' })).toBe('human');
    // 老库读不到该列时运行时是 undefined —— 必须落人类侧，否则老项目会从人类侧凭空消失
    expect(projectKindOf({} as Pick<Project, 'kind'>)).toBe('human');
    expect(projectKindOf({ kind: 'agentt' as ProjectKind })).toBe('human');
    expect(projectKindOf(null)).toBe('human');
    expect(projectKindOf(undefined)).toBe('human');
  });

  it('visibleProjectIds / visibleProjectsFor / filterByProjectKind 三者同源', () => {
    const ids = visibleProjectIds('agent', MAIN.projects);
    expect([...ids]).toEqual([AGENT_ID]);
    expect(visibleProjectsFor('agent', MAIN.projects).map((p) => p.id)).toEqual([AGENT_ID]);
    // filterByProjectKind 用同一集合收窄 stages/tasks ⇒ 行数必须是"Agent 看板名下那些"
    expect(filterByProjectKind(MAIN.stages, ids).length).toBe(
      MAIN.stages.filter((s) => s.projectId === AGENT_ID).length,
    );
    expect(filterByProjectKind(MAIN.tasks, ids).length).toBe(
      MAIN.tasks.filter((t) => t.projectId === AGENT_ID).length,
    );
  });
});

/* ══════════════════════════════ 源码锚点（L2/L3 发现不了的"接线是否真存在"） ══════════════════════════════
 *
 * 上面每一行都是**纯派生**断言 —— 它证明"派生对了"，**不**证明"页面真的用了这个派生"。
 * 下面这组只读源码字符串，把"接线存在"这件事也钉住（数量少、每条都指向设计原文）。
 */
describe('源码锚点（接线真的接上了，而不只是派生写对了）', () => {
  const read = (p: string): string => readFileSync(join(ROOT, p), 'utf-8');

  it('#17/#18/#27 · 三个页面都渲染 ProjectSourceBadge，且文案是「AI 工作区」', () => {
    const badge = read('src/components/project/ProjectSourceBadge.tsx');
    expect(badge).toContain('AI 工作区');

    for (const page of [
      'src/pages/ProjectDetailPage.tsx',
      'src/pages/SchedulePrintPage.tsx',
      'src/pages/CalendarPrintPage.tsx',
    ]) {
      expect(read(page), `${page} 未渲染 ProjectSourceBadge`).toContain('<ProjectSourceBadge');
    }
  });

  it('#17/#18 · 人类侧不给 Agent 看板任何打印入口（详情页按 projectKindOf 隐藏）', () => {
    const detail = read('src/pages/ProjectDetailPage.tsx');
    expect(detail).toContain('projectKindOf(project)');
    expect(detail).toContain("!== 'agent'");
  });

  it('#26 · 服务端候选集按等值 kind = human 收窄（不是 `<> agent`）', () => {
    const routes = stripComments(read('server/routes/agent.routes.ts'));
    expect(routes).toContain("kind = 'human'");
    // 反应式断言（只看代码）：等值写法是刻意的 —— 避免将来第三种 kind 悄悄混进候选集
    expect(routes).not.toContain("kind <> 'agent'");
  });

  it('#8 · 首页看板不再从 preset 反推 domain（getPreset 已从本页代码移除）', () => {
    const home = stripComments(read('src/pages/HomePage.tsx'));
    expect(home).not.toContain('getPreset(');
    expect(home).toContain('effectiveDomainOf(p)');
  });

  it('#12 · 「我的任务」角标确实不存在（TBD-7：侧栏不读 tasks、不派生任务计数）', () => {
    const sidebar = stripComments(read('src/components/layout/Sidebar.tsx'));
    expect(sidebar).not.toContain('useHumanTasks');
    expect(sidebar).not.toMatch(/useProjectsStore\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.tasks/);
  });

  it('#22 · kind 必须随备份往返（备份链的归一函数保留该字段）', () => {
    const backup = read('src/core/services/backup.service.ts');
    // projectSchema 必须声明 kind —— 否则导出会把它丢掉，导入后 Agent 看板会"变成人类项目"
    expect(backup).toMatch(/kind:\s*z\.[^\n]*/);
  });
});
