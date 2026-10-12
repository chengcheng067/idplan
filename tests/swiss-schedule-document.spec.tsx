// @vitest-environment jsdom
/**
 * A 版 · SwissScheduleDocument 组件测试（02 文档 §9 组件测试清单）。
 *
 * 锁六件：
 *   ① 缺省（五块形态）渲染 `.a4-page`，`.print-root.print-template-swiss-schedule` 在位
 *      （原「渲染 4 页」随 2026-10-13 批 1 重定：缺省 = 五块形态；旧四页仍可由
 *      显式 `sheets` 复现，见用例内两条断言）；
 *   ② 三槽位配色经 `.print-root` inline CSS 变量挂载（iframe 打印无损的前提）；
 *   ③ 页面选择器可关单页且**页码重排**（第 N / M 页随启用页变）——旧页路径；
 *   ④ P1-P4 各页数据口径：四态双编码 / taskNo 读号 / 三类延期分列 / Agent 行焦点；
 *   ⑤ 空数据显示标准空态文案，**不出现示例数据**；
 *   ⑥ `.a4-page` 等受保护选择器不被改名（02 §5 契约）。
 *
 * ── 2026-10-13「5 块 × 4 模板」重构 · 批 1 的重定（逐条）──
 *   · ① 「渲染 4 页」⇒ 缺省 1 页（2 阶段 × 五块形态装得下）+ 显式四页仍 4 页；
 *   · ⑤ 空态：旧四页的空态走显式 `sheets` 复跑（原断言逐字保留），另加五块
 *     形态的空态（B4 标准空态 + 改期记录整段不出，§0.5）；
 *   · ⑥ pageRef：五块形态 1 页；旧四页路径另测 4 页；
 *   · ⑦ 「缺省 = 四页全选」⇒ 缺省 = 五块形态；四页由显式页清单复现。
 *   **未动**：②③④a-④e 的全部断言（③④b/④c/④d 走显式 sheets ⇒ 旧页路径原样）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { SwissScheduleDocument, SWISS_SCHEDULE_PAGES } from '../src/print/documents/SwissScheduleDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import type { PrintPageKind } from '../src/print/model/print-view-model';
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

/**
 * 渲染助手（期三：pages → sheets。A 版四页全是原生页，spec 仍按原生页
 * kind 传，helper 负责包成 native sheet——「外表 × 模块分离」后纸面
 * 单元是 sheet，A 的原生页语义不变）。
 */
function render(pages?: readonly PrintPageKind[]): void {
  act(() => {
    root.render(
      <SwissScheduleDocument
        vm={buildVm()}
        sheets={pages?.map((page) => ({ type: 'native', page }) as const)}
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
  it('① 缺省 = 五块形态（本夹具 2 页）；显式 sheets 仍出旧四页（代码与 spec 全留）', () => {
    render();
    const rootEl = q('.print-root');
    expect(rootEl).not.toBeNull();
    expect(rootEl!.className).toContain('print-template-swiss-schedule');
    /*
     * 五块形态的页数：本夹具 2 阶段 **且带 1 条 rescheduled 流水** ⇒ 2 页。
     * 真机实测（2026-10-13 批 1，见 print-a4-visual 的 20 阶段用例与交付报告）：
     * A 的首页被 B1（板头 265.5）+ B2（2 行甘特 131）+ B3（168）+ 贴底行（20）
     * 吃掉 ~585px，剩 ~330px 给 B4；而 B4（组头 93 + 一列卡 95 + 错落 34）
     * + L3 改期记录（124.5）需 ~366px ⇒ **整段后移一页**（不留空壳尾页）。
     */
    expect(qa('.a4-page')).toHaveLength(2);
    expect(q('.a4-page')!.getAttribute('data-print-page'), '五块形态的纸面标识').toBe('blocks');
    // 受保护选择器不被改名（02 §5 契约：.print-root / .a4-page）
    expect(qa('.print-root .a4-page').length).toBe(2);
    // 旧四页路径（额外内容页 / 通用模块；选择器不再暴露，代码与 spec 全留 —— 决策 2）
    render(SWISS_SCHEDULE_PAGES);
    expect(qa('.a4-page')).toHaveLength(4);
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
    // 每页可独立解释（01 §2）：项目标识 = 栏外板头的「站名」
    // （P0-3 起项目名从黑顶栏移到栏外板头，与参考稿 A P1 站位一致；栏内改登中文页题）
    for (const name of qa('.swiss-masthead__name')) {
      expect(name.textContent).toBe(PROJECT.name);
    }
    expect(qa('.swiss-masthead__name')).toHaveLength(2);
    // 黑顶栏登的是本页中文页题（参考稿栏内站位）
    expect(qa('.swiss-topbar__title').map((el) => el.textContent)).toEqual([
      '任务读号表',
      '成员责任表',
    ]);
    // 栏内置品牌 + 页序（参考稿 `ID PLAN · 01/04`）
    expect(qa('.swiss-topbar__meta')[0]!.textContent).toContain('ID PLAN · 01 / 02');
    expect(qa('.swiss-bottombar')[0]!.textContent).toContain('数据时间 2026-10-09 07:30');
  });

  it('④a P1 阶段总览：序号/名称/四态胶囊/日期/占比/负责人', () => {
    render(['stage-overview']);
    const root = text('.print-root');
    expect(root).toContain('提案与测量');
    expect(root).toContain('平面方案');
    expect(root).toContain('已完成');
    expect(root).toContain('延期');
    // 日期区间走参考稿的箭头写法（`01-01 → 01-24`）
    expect(root).toContain('2026-01-05 → 2026-01-20');
    expect(root).toContain('占比 40%');
    expect(root).toContain('负责人 负责人甲');
    // 四态字形双编码（灰度可读，不靠色相）
    expect(q('.swiss-stage-row[data-state="delayed"] .swiss-state-glyph')?.textContent).toBe('▲');
    expect(q('.swiss-stage-row[data-state="completed"] .swiss-state-glyph')?.textContent).toBe('●');
    // P0-6：状态升格为**胶囊**（独立行），不再是名称行末尾的小字
    const capsules = qa('.swiss-stage-row__capsule');
    expect(capsules).toHaveLength(2);
    expect(capsules[0]!.getAttribute('data-state')).toBe('completed');
    expect(capsules[1]!.getAttribute('data-state')).toBe('delayed');
    // 胶囊与日期同排，且日期右对齐（参考稿同排）
    expect(q('.swiss-stage-row__capsule-row .swiss-stage-row__date')?.textContent).toContain(
      '2026-01-05 → 2026-01-20',
    );
    // 名称行里不再挂状态（降级回归护栏）
    expect(q('.swiss-stage-row__top .swiss-state-glyph')).toBeNull();
    // 项目元信息体现排期基准（01 P1 硬要求）
    expect(root).toContain('按自然日');
    // P0-3：完成度升格为板头巨字 + 口径副行（旧板头计数行已移除）
    expect(q('.swiss-masthead__pct')?.textContent).toBe('50%');
    expect(q('.swiss-masthead__pct-caption')?.textContent).toBe('项目完成度（阶段粒度）');
    // 板头左元信息 3 行（参考稿站位）
    const metaLines = qa('.swiss-masthead__meta-line').map((el) => el.textContent);
    expect(metaLines).toHaveLength(3);
    expect(metaLines[0]).toBe('排期基准 按自然日');
    expect(metaLines[1]).toBe('阶段套餐 —（2 项）');
    expect(metaLines[2]).toBe('可见阶段 2 / 2');
  });

  it('④e P1 页尾：口径行 + 休息制度黑块 + 数据来源行（P0-4）', () => {
    render(['stage-overview']);
    // 口径注（01 §2 + 宪法 7：每页独立解释）
    expect(text('.swiss-board__note')).toContain('阶段四态：已完成 进行中 未开始 延期');
    expect(text('.swiss-board__note')).toContain('占比 = Stage.ratioPercent');
    // 休息制度黑块：制度名（真实 settings 口径投影）+ 判定链说明
    expect(text('.swiss-rest__title')).toBe('休息制度　双休 DoubleOff');
    const note = text('.swiss-rest__note');
    expect(note).toContain('排期基准为自然日');
    expect(note).toContain('周六/周日为休息日');
    // 不伪造班次/工时（宪法 7）
    expect(note).not.toContain('小时');
    expect(note).not.toContain('班次');
    // 数据来源行（含装配时刻）
    expect(text('.swiss-source')).toBe('数据来源 ID Plan 排程库 2026-10-09 07:30 同步');
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

  it('④d P4 成员责任表：Agent 行唯一强焦点（「类型」/ agentKind 两列已下架）', () => {
    render(['member-roster']);
    const agentRow = q('.swiss-roster__row--agent');
    expect(agentRow).not.toBeNull();
    expect(agentRow!.getAttribute('data-agent')).toBe('true');
    expect(agentRow!.textContent).toContain('小 Agent');
    // 「类型」与 agentKind 两列按需求方要求下架（打印不出 Agent 板块）：
    // Agent 身份改由 data-agent + 反色焦点类 + 姓名列承载，不再有
    // 「Agent」文字签，原始 harness 名（开放字符串）也不再上纸。
    expect(agentRow!.textContent).not.toContain('brand-new-harness-9000');
    expect(agentRow!.querySelectorAll('td')).toHaveLength(3);
    // 表头三列齐（含负责任务数列）
    const heads = qa('.swiss-roster thead th').map((th) => th.textContent);
    expect(heads).toEqual(['姓名', '角色', '负责任务数']);
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
    // 旧四页路径的空态（显式 sheets；额外内容页的代码与 spec 全留 —— 决策 2）
    act(() => {
      root.render(
        <SwissScheduleDocument
          vm={emptyVm}
          sheets={SWISS_SCHEDULE_PAGES.map((page) => ({ type: 'native', page }) as const)}
          palette={BASELINE}
        />,
      );
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

    // 五块形态的空态：B4 出标准空态；L3「改期记录」整段不出（§0.5 的空态纪律：
    // 无 rescheduled ⇒ 不出孤单表头）
    act(() => {
      root.render(<SwissScheduleDocument vm={emptyVm} palette={BASELINE} />);
    });
    expect(qa('.a4-page')).toHaveLength(1);
    expect(q('[data-print-empty="stages"]')?.textContent).toBe('当前可见范围内无阶段');
    expect(qa('.swiss-resched'), '无改期记录 ⇒ 整段不出').toHaveLength(0);
    expect(qa('.swiss-register tbody tr')).toHaveLength(0);
    expect(text('.print-root'), '空数据下也不出现示例数据').not.toContain('示例');
  });

  it('⑥ pageRef 收集页面元素（PNG 逐页导出的前提）', () => {
    // 五块形态：本夹具 2 页（见 ① 的实测说明）
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
    expect(collected).toHaveLength(2);
    for (const el of collected) {
      expect(el).not.toBeNull();
      expect(el!.className).toContain('a4-page');
    }
    // 旧四页路径：同一 ref 协议仍按页收集（额外内容页的 PNG 导出链全留）
    const collectedLegacy: Array<HTMLDivElement | null> = [];
    act(() => {
      root.render(
        <SwissScheduleDocument
          vm={buildVm()}
          sheets={SWISS_SCHEDULE_PAGES.map((page) => ({ type: 'native', page }) as const)}
          palette={BASELINE}
          pageRef={(idx) => (el: HTMLDivElement | null) => {
            collectedLegacy[idx] = el;
          }}
        />,
      );
    });
    expect(collectedLegacy).toHaveLength(4);
    for (const el of collectedLegacy) {
      expect(el).not.toBeNull();
      expect(el!.className).toContain('a4-page');
    }
  });

  it('⑦ 缺省 = 五块形态（决策 1）；显式四页时页序与旧默认逐页一致', () => {
    render();
    expect(qa('.a4-page').map((el) => el.getAttribute('data-print-page'))).toEqual([
      'blocks',
      'blocks',
    ]);
    render(SWISS_SCHEDULE_PAGES);
    expect(SWISS_SCHEDULE_PAGES).toHaveLength(4);
    expect(qa('.a4-page').map((el) => el.getAttribute('data-print-page'))).toEqual([
      'stage-overview',
      'task-register',
      'delay-ledger',
      'member-roster',
    ]);
  });
});
