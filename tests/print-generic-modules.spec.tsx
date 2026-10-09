// @vitest-environment jsdom
/**
 * 期三第一批 · 通用渲染验收（M1 阶段清单 / M2 任务清单 / M4 成员名册 × A/D/E/H）。
 * 产品决策文档 §3.2 候选 3 / §3.5 期三 v1.5-b / 决策 ⑭。
 *
 * ── 验收口径 ──
 * 「外表 × 模块分离」：4 套模板 = 外表，模块跨模板可选。本批三模块在全部
 * 4 套外表下可输出——原生页已存在的（A 的 M1/M2/M4、E 的 M1/M4）走原生页
 * （结构零变化，本 spec 只锁映射不错），其余走通用渲染（本 spec 主体）。
 *
 * ── 本文件锁什么（结构族；几何/截图在 print-generic-modules-a4.spec.ts）──
 *   G1 12 组合映射：每组合隔离渲染（只开该模块），纸面页属性 + 页题 + 模块
 *      主体结构就位；A 三组合 = 原生页（零变化红线）；
 *   G2 通用模块内容：列头/行数据/双编码（四态字形 + 文字、逾期文字签、
 *      Agent 文字签）/ 口径注 / 空态（无示例数据填版）；
 *   G3 分页计划（纯函数）：行不裂、跨页续头、compact 档、空模块 ⇒ 空态纸；
 *   G4 权限口径：VM 已过滤（隐藏阶段的任务/成员不进 VM），通用渲染不重算
 *      ——用「VM 里就没有」的夹具锁「纸面上就没有」。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SwissScheduleDocument } from '../src/print/documents/SwissScheduleDocument';
import { DataEditorialDocument } from '../src/print/documents/DataEditorialDocument';
import { EditorialIndexDocument } from '../src/print/documents/EditorialIndexDocument';
import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { printPhysicalPageCount } from '../src/print/documents/physical-pages';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import type { PrintModuleId } from '../src/components/print/print-skins';
import type {
  PrintMemberVM,
  PrintSheet,
  PrintStageVM,
  PrintTaskVM,
  PrintTemplateId,
  PrintViewModel,
} from '../src/print/model/print-view-model';
import { MemberActorKind, MemberRoleKind, StageStatus, TaskStatus } from '../src/core/types/enums';

/* ------------------------------------------------------------------ 夹具（VM 字面量） */

const PROJECT_ID = 'proj_generic';

function stageVm(n: number, over: Partial<PrintStageVM> = {}): PrintStageVM {
  return {
    id: `stg_g_${n}`,
    orderIndex: n,
    name: `阶段${n}·现场勘查与方案深化`,
    ratioPercent: 11,
    startAt: '2026-01-05',
    endAt: '2026-01-20',
    status: n % 4 === 0 ? StageStatus.Delayed : n % 3 === 0 ? StageStatus.Completed : n % 3 === 1 ? StageStatus.InProgress : StageStatus.NotStarted,
    ownerName: n === 2 ? '小 Agent' : '负责人甲',
    ownerId: n === 2 ? 'm_g_agent' : 'm_g_human',
    colorIndex: ((n - 1) % 9) + 1,
    customColor: null,
    taskProgress: { done: n % 3, total: 4 },
    ...over,
  };
}

function taskVm(n: number, over: Partial<PrintTaskVM> = {}): PrintTaskVM {
  return {
    id: `tsk_g_${n}`,
    taskNo: 1000 + n,
    title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
    status: (['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done'] as TaskStatus[])[n % 7]!,
    assigneeNames: n % 2 === 0 ? ['负责人甲', '小 Agent'] : ['负责人甲'],
    dueDate: n === 4 ? '2026-10-01' : null,
    dependsOn: [],
    artifactCount: n % 3,
    artifacts: [],
    stageId: `stg_g_${((n - 1) % 6) + 1}`,
    overdue: n === 4,
    source: 'human',
    runId: null,
    ...over,
  };
}

const MEMBERS: PrintMemberVM[] = [
  { id: 'm_g_human', name: '负责人甲', role: '项目负责人', roleKind: MemberRoleKind.Admin, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 5 },
  { id: 'm_g_agent', name: '小 Agent', role: '自动执行体', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Agent, agentKind: 'brand-new-harness-9000', taskCount: 2 },
  { id: 'm_g_plain', name: '施工方乙', role: '驻场工程师', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 1 },
];

/** 6 阶段（四态齐全 + 延期）/ 8 任务（七态轮换 + 1 逾期）/ 3 成员（含 Agent） */
function buildVm(over: Partial<PrintViewModel> = {}): PrintViewModel {
  return {
    project: {
      id: PROJECT_ID,
      name: '云栖·湖畔茶室综合改造项目',
      address: '城区某路 1 号',
      clientName: '客户甲',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-03-01',
      scheduleBasisLabel: '自然日',
      percent: 50,
      visibleStageCount: 6,
      projectOverdue: false,
      todayIso: '2026-10-09',
    },
    stages: Array.from({ length: 6 }, (_, i) => stageVm(i + 1)),
    tasks: Array.from({ length: 8 }, (_, i) => taskVm(i + 1)),
    members: MEMBERS,
    stageLogs: [],
    executions: [],
    proposals: [],
    generatedAt: '2026-10-09T07:30:00Z',
    viewerRole: 'admin',
    ...over,
  };
}

/* ------------------------------------------------------------------ 渲染助手 */

type DocKind = 'swiss-schedule' | 'data-editorial' | 'editorial-index' | 'agent-poster';

function renderDoc(template: DocKind, vm: PrintViewModel, sheets: readonly PrintSheet[]): string {
  const palette = PRINT_TEMPLATE_PALETTES[template].baseline;
  switch (template) {
    case 'swiss-schedule':
      return renderToStaticMarkup(createElement(SwissScheduleDocument, { vm, sheets, palette }));
    case 'data-editorial':
      return renderToStaticMarkup(createElement(DataEditorialDocument, { vm, sheets, palette }));
    case 'editorial-index':
      return renderToStaticMarkup(createElement(EditorialIndexDocument, { vm, sheets, palette }));
    case 'agent-poster':
      return renderToStaticMarkup(createElement(AgentPosterDocument, { vm, sheets, palette }));
  }
}

const doc = (markup: string): Document => new JSDOM(markup).window.document;

/** 12 组合：模块 × 外表（A/D/E/H） */
const COMBOS: ReadonlyArray<{ module: PrintModuleId; template: DocKind; pageAttr: string }> = [
  { module: 'stage-list', template: 'swiss-schedule', pageAttr: 'stage-overview' },
  { module: 'stage-list', template: 'data-editorial', pageAttr: 'generic-stage-list' },
  { module: 'stage-list', template: 'editorial-index', pageAttr: 'stage-index' },
  { module: 'stage-list', template: 'agent-poster', pageAttr: 'generic-stage-list' },
  { module: 'task-list', template: 'swiss-schedule', pageAttr: 'task-register' },
  { module: 'task-list', template: 'data-editorial', pageAttr: 'generic-task-list' },
  { module: 'task-list', template: 'editorial-index', pageAttr: 'generic-task-list' },
  { module: 'task-list', template: 'agent-poster', pageAttr: 'generic-task-list' },
  { module: 'member-roster', template: 'swiss-schedule', pageAttr: 'member-roster' },
  { module: 'member-roster', template: 'data-editorial', pageAttr: 'generic-member-roster' },
  { module: 'member-roster', template: 'editorial-index', pageAttr: 'member-index' },
  { module: 'member-roster', template: 'agent-poster', pageAttr: 'generic-member-roster' },
];

/* ====================================================================================
 * G1 · 12 组合映射（隔离渲染：只开该模块）
 * ==================================================================================== */

describe('期三 · G1 十二组合映射（M1/M2/M4 × A/D/E/H）', () => {
  it('每组合隔离渲染：恰好一页、页属性与页题就位、模板类正确', () => {
    const vm = buildVm();
    for (const c of COMBOS) {
      // 通用组合给 generic sheet；原生组合（A/E 的 M1/M4）给原生页 kind
      const sheets: PrintSheet[] = c.pageAttr.startsWith('generic-')
        ? [{ type: 'generic', module: c.module }]
        : [{ type: 'native', page: c.pageAttr as 'stage-overview' }];
      const d = doc(renderDoc(c.template, vm, sheets));
      const pages = d.querySelectorAll('.a4-page');
      expect(pages.length, `${c.module} × ${c.template} 应恰好一页`).toBe(1);
      expect(pages[0]!.getAttribute('data-print-page'), `${c.module} × ${c.template} 页属性`).toBe(c.pageAttr);
      // 模板类（外表）就位
      const root = d.querySelector('.print-root');
      expect(root!.className).toContain(`print-template-${c.template}`);
      // 页题（通用页 = 模块名；原生页 = 各版原生页题）
      const title = pages[0]!.querySelector('h1, .swiss-topbar__title');
      expect(title, `${c.module} × ${c.template} 应有页题元素`).not.toBeNull();
      // 项目名上纸（每页可独立解释）
      expect(pages[0]!.textContent).toContain('云栖·湖畔茶室综合改造项目');
    }
  });

  it('A 外表三组合 = 原生页（结构零变化：时刻表/读号表/责任表的老类名与结构）', () => {
    const vm = buildVm();
    // A M1 ⇒ 三列错落时刻表（原生类名 swiss-columns / swiss-stage-row）
    const a1 = doc(renderDoc('swiss-schedule', vm, [{ type: 'native', page: 'stage-overview' }]));
    expect(a1.querySelector('.swiss-columns')).not.toBeNull();
    expect(a1.querySelectorAll('.swiss-stage-row')).toHaveLength(6);
    // A M2 ⇒ 读号表（原生类名 swiss-register）
    const a2 = doc(renderDoc('swiss-schedule', vm, [{ type: 'native', page: 'task-register' }]));
    expect(a2.querySelector('.swiss-register')).not.toBeNull();
    // A M4 ⇒ 成员责任表（Agent 行反色焦点）
    const a4 = doc(renderDoc('swiss-schedule', vm, [{ type: 'native', page: 'member-roster' }]));
    expect(a4.querySelector('.swiss-roster__row--agent')).not.toBeNull();
    // 通用模块类不出现在 A 原生页上（两套渲染不串）
    expect(a1.querySelector('.gm-module')).toBeNull();
  });

  it('预计页数与实际出纸同源（printPhysicalPageCount 走各版装配函数）', () => {
    const vm = buildVm();
    expect(printPhysicalPageCount('swiss-schedule', vm, [{ type: 'native', page: 'stage-overview' }])).toBe(1);
    expect(printPhysicalPageCount('data-editorial', vm, [{ type: 'generic', module: 'task-list' }])).toBe(1);
    expect(printPhysicalPageCount('editorial-index', vm, [{ type: 'generic', module: 'task-list' }])).toBe(1);
    expect(printPhysicalPageCount('agent-poster', vm, [{ type: 'generic', module: 'member-roster' }])).toBe(1);
  });
});

/* ====================================================================================
 * G2 · 通用模块内容（D/E/H 三套外表同一份内容组件）
 * ==================================================================================== */

describe('期三+期七 · G2 通用模块内容结构（D/E/H 三套外表同一份内容组件）', () => {
  it('M1 阶段清单（D：merged 表 + KPI 带 + 行内进度条）：四态双编码 + 延期焦点 + 口径注', () => {
    const vm = buildVm();
    const d = doc(renderDoc('data-editorial', vm, [{ type: 'generic', module: 'stage-list' }]));
    const page = d.querySelector('[data-print-page="generic-stage-list"]')!;
    // 模块头 + 元信息行（期七深化：新稿 E P1 口径「可见阶段 N · 完成度 X%」）
    expect(page.querySelector('.gm-head__label')!.textContent).toBe('阶段清单');
    expect(page.querySelector('.gm-head__count')!.textContent).toContain('可见阶段 6');
    expect(page.querySelector('.gm-head__count')!.textContent).toContain('完成度 50%');
    // 期七 D×M1：KPI 带三格（已完成/延期/占比）——复用原生 de-stat 视觉
    const kpi = page.querySelector('.gm-kpi');
    expect(kpi, 'D×M1 应有 KPI 带').not.toBeNull();
    expect(kpi!.querySelectorAll('.de-stat')).toHaveLength(3);
    expect(kpi!.textContent).toContain('阶段已完成');
    expect(kpi!.textContent).toContain('延期阶段');
    // merged 表：序号并入阶段单元格（同 D 原生 de-matrix），表头中英双语
    const heads = Array.from(page.querySelectorAll('.gm-table th')).map((th) => th.textContent);
    expect(heads).toEqual([
      'STAGE 阶段',
      'STATUS 状态',
      'DATES 计划日期',
      'TASK PROGRESS 阶段内任务完成度',
      'RATIO 占比',
      'OWNER 负责人',
    ]);
    // 6 行数据；行不裂、序号补零（并入阶段单元格）
    const rows = page.querySelectorAll('.gm-row');
    expect(rows).toHaveLength(6);
    expect(rows[0]!.querySelector('.gm-cell-no')!.textContent).toBe('01');
    expect(rows[0]!.querySelector('.gm-cell-date')!.textContent).toBe('2026-01-05 — 2026-01-20');
    // 行内进度条（复用原生 de-bar；done/total 条外 + ≥15% 段内白字百分比）
    const bar = rows[0]!.querySelector('.de-bar');
    expect(bar, 'D×M1 行内应有进度条').not.toBeNull();
    expect(bar!.querySelector('.de-bar__num')!.textContent).toContain('1/4');
    expect(bar!.querySelector('.gm-bar__num')!.textContent).toBe('25%');
    // 四态 = 字形 + 文字双编码（灰度可读，不靠色相）
    const glyphs = Array.from(page.querySelectorAll('.gm-glyph')).map((g) => g.textContent);
    expect(new Set(glyphs)).toEqual(new Set(['□', '◐', '●', '▲']));
    // 延期行：data-delayed + signal 态 + 进度条填充走信号色
    const delayed = page.querySelector('.gm-row[data-delayed]');
    expect(delayed).not.toBeNull();
    expect(delayed!.querySelector('.gm-state')!.getAttribute('data-tone')).toBe('signal');
    expect(delayed!.querySelector('.de-bar__fill')!.getAttribute('data-tone')).toBe('signal');
    // 口径注：占比 ≠ 完成度（01 §3.1 防误读）
    expect(page.querySelector('.gm-note')!.textContent).toContain('占比 = 阶段工作量分配（ratioPercent），不等于完成度');
    // 空态不出现在有数据时
    expect(page.querySelector('[data-print-empty]')).toBeNull();
  });

  it('M2 任务清单（E：grid + mono 序号降级 + 按七态分章）：读号 formatTaskNo + 逾期文字签', () => {
    const vm = buildVm();
    const d = doc(renderDoc('editorial-index', vm, [{ type: 'generic', module: 'task-list' }]));
    const page = d.querySelector('[data-print-page="generic-task-list"]')!;
    expect(page.querySelector('.gm-head__label')!.textContent).toBe('任务清单');
    // 期七 E×M2：grid 行（不是 table）+ mono 序号降级 + 按七态分章
    expect(page.querySelector('.gm-grid'), 'E×M2 应是 grid 行形态').not.toBeNull();
    expect(page.querySelector('.gm-table'), 'E×M2 不应有 table').toBeNull();
    const rows = page.querySelectorAll('.gm-grid__row--task');
    expect(rows).toHaveLength(8);
    // mono 序号降级（§2.6.3：巨编号是目录身份装置，任务读号是密集表设备）
    const firstNo = rows[0]!.querySelector('.gm-grid__no')!;
    expect(firstNo.classList.contains('gm-grid__no--mono'), 'E×M2 序号应走 mono 降级').toBe(true);
    // 读号 = T-1001 形式（formatTaskNo 唯一出处；分章按七态重排，取集合断言）
    const nos = Array.from(rows).map((r) => r.querySelector('.gm-grid__no')!.textContent);
    expect(nos).toContain('T-1001');
    expect(firstNo.textContent).toMatch(/^T-10\d\d$/);
    // 分章：按任务七态（章头 + 计数）
    const chapters = page.querySelectorAll('.gm-chapter');
    expect(chapters.length, '应按七态分章').toBeGreaterThan(0);
    // 逾期 = 文字「· 逾期」+ data-focus（双编码）
    const overdue = page.querySelector('.gm-grid__state[data-focus]');
    expect(overdue).not.toBeNull();
    expect(overdue!.textContent).toContain('· 逾期');
    // 老数据无号 ⇒ '—'（formatTaskNo(null)）
    const noNo = doc(
      renderDoc('editorial-index', buildVm({ tasks: [taskVm(1, { taskNo: null })] }), [
        { type: 'generic', module: 'task-list' },
      ]),
    );
    expect(noNo.querySelector('.gm-grid__no')!.textContent).toBe('—');
    // 长任务名不越列：省略截断 + title 可访问（02 §8；分章重排，按 title 找行）
    const nameCell = Array.from(page.querySelectorAll('.gm-grid__name')).find((el) =>
      (el.getAttribute('title') ?? '').includes('任务1'),
    ) as Element;
    expect(nameCell, '应存在任务1 的行').not.toBeUndefined();
    expect(nameCell.getAttribute('title')).toContain('整理测绘图');
    // 空态：无任务 ⇒ EmptyPrintState（不用示例数据填版）
    const empty = doc(
      renderDoc('editorial-index', buildVm({ tasks: [] }), [{ type: 'generic', module: 'task-list' }]),
    );
    expect(empty.querySelector('[data-print-page="generic-task-list"] [data-print-empty="tasks"]')).not.toBeNull();
  });

  it('M4 成员名册（H：blocks 双栏 + 席位与门控右栏）：全员口径 + Agent 签 + agentKind 原样', () => {
    const vm = buildVm();
    const d = doc(renderDoc('agent-poster', vm, [{ type: 'generic', module: 'member-roster' }]));
    const page = d.querySelector('[data-print-page="generic-member-roster"]')!;
    expect(page.querySelector('.gm-head__label')!.textContent).toBe('成员名册');
    expect(page.querySelector('.gm-head__count')!.textContent).toContain('3 人 · Agent 1');
    // 期七 H×M4：blocks 双栏（左明细 + 右 240px 摘要）
    expect(page.querySelector('.gm-blocks'), 'H×M4 应是 blocks 双栏').not.toBeNull();
    const rows = page.querySelectorAll('.gm-block-row');
    expect(rows).toHaveLength(3);
    // Agent 行：data-agent + 「Agent」文字签（双编码，灰度可辨）
    const agentRow = page.querySelector('.gm-block-row[data-agent]');
    expect(agentRow).not.toBeNull();
    expect(agentRow!.querySelector('.gm-block-row__state')!.textContent).toBe('Agent');
    // agentKind 开放字符串原样显示（右栏 Agent 简列；01 §3.2：不收敛枚举）
    expect(page.querySelector('.gm-panel__item-kind')!.textContent).toBe('brand-new-harness-9000');
    // 右栏「席位与门控」：大号 mono 已用/上限（AGENT_SEAT_LIMIT=3）+ 门控提示行
    const panel = page.querySelector('.gm-panel')!;
    expect(panel.querySelector('.gm-panel__title')!.textContent).toBe('席位与门控');
    expect(panel.querySelector('.gm-panel__big')!.textContent).toBe('01/03');
    expect(panel.querySelector('.gm-panel__gate')!.textContent).toContain('剩余 2 席');
    // human 行：负责任务数上纸（左栏行尾）
    const humanRow = page.querySelector('.gm-block-row:not([data-agent])');
    expect(humanRow!.querySelector('.gm-block-row__num')!.textContent).toBe('5');
    // 空态：无成员 ⇒ 明确空态
    const empty = doc(
      renderDoc('agent-poster', buildVm({ members: [] }), [{ type: 'generic', module: 'member-roster' }]),
    );
    expect(empty.querySelector('[data-print-page="generic-member-roster"] [data-print-empty="members"]')).not.toBeNull();
  });

  it('三套外表同一份内容组件：同一行模型三种呈现（table/grid/blocks 字段集各随其版）', () => {
    const vm = buildVm();
    // 各变体的行选择器与必备字段（D 表 = 六列含占比/负责人；E grid = 巨编号六列；
    // H blocks = 左栏明细行 + 右栏摘要——字段集按各版原生语法，不再是同一张表）
    const rowsOf = (template: DocKind): Element[] => {
      const d = doc(renderDoc(template, vm, [{ type: 'generic', module: 'stage-list' }]));
      const sel =
        template === 'data-editorial'
          ? '.gm-row'
          : template === 'editorial-index'
            ? '.gm-grid__row'
            : '.gm-block-row';
      return Array.from(d.querySelectorAll(sel));
    };
    const dRows = rowsOf('data-editorial');
    const eRows = rowsOf('editorial-index');
    const hRows = rowsOf('agent-poster');
    expect(dRows).toHaveLength(6);
    expect(eRows).toHaveLength(6);
    expect(hRows).toHaveLength(6);
    // 同一行模型：三个变体的序号集合逐一相等（内容同源，只改呈现与排序；
    // E 的 grid 按状态分章会重排行序，故按集合比对不按下标）
    const noSet = (rows: Element[]): Set<string> => {
      const s = new Set<string>();
      for (const r of rows) {
        const m = (r.textContent ?? '').match(/\b0[1-6]\b/);
        if (m) s.add(m[0]);
      }
      return s;
    };
    expect(noSet(eRows)).toEqual(noSet(dRows));
    expect(noSet(hRows)).toEqual(noSet(dRows));
    // 各版语法差异落地：D 表含占比列、E grid 行带 data-state、H 有右栏面板
    expect(dRows[0]!.querySelector('.gm-cell-ratio')).not.toBeNull();
    expect(eRows[0]!.getAttribute('data-state')).not.toBeNull();
    expect(doc(renderDoc('agent-poster', vm, [{ type: 'generic', module: 'stage-list' }])).querySelector('.gm-panel')).not.toBeNull();
  });

  it('G4 权限口径：VM 过滤之外的纸面零重算（隐藏阶段任务/成员不进 VM ⇒ 不上纸）', () => {
    // 夹具：VM 只给 2 个可见阶段的任务（适配器已过滤）；纸面必须只有 2 行
    const vm = buildVm({
      stages: [stageVm(1), stageVm(2)],
      tasks: [taskVm(1), taskVm(2)],
      members: [MEMBERS[0]!],
    });
    const d = doc(renderDoc('data-editorial', vm, [{ type: 'generic', module: 'task-list' }]));
    expect(d.querySelectorAll('.gm-row')).toHaveLength(2);
    expect(d.body!.textContent).not.toContain('stg_g_5');
  });
});

/* ====================================================================================
 * G3 · 分页计划（纯函数：行不裂 / 跨页续头 / compact 档 / 空模块空态纸）
 * ==================================================================================== */

describe('期三 · G3 分页计划（纯函数）', () => {
  it('60 任务 ⇒ D 外表跨页：行不裂、续头只标真跨页、每页行数 ≤ 容量', async () => {
    const { planGenericModule, GENERIC_ROW_H, GENERIC_ROWS_H } = await import(
      '../src/print/pages/generic/shared'
    );
    const vm = buildVm({ tasks: Array.from({ length: 60 }, (_, i) => taskVm(i + 1)) });
    const plan = planGenericModule('task-list', vm, 'data-editorial')!;
    expect(plan.compact, '60 行 ⇒ compact 档').toBe(true);
    expect(plan.chunks.length, '60 行应跨页').toBeGreaterThan(1);
    // 行不裂：总行数守恒
    const total = plan.chunks.reduce((n, c) => n + c.length, 0);
    expect(total).toBe(60);
    // 每页行数 ≤ 容量（行区高 ÷ compact 行高；期七起行高按 rowForm 分档，
    // D×M2 是 table 变体）
    const cap = Math.floor(GENERIC_ROWS_H['data-editorial'] / GENERIC_ROW_H['task-list'].table!.compact);
    for (const c of plan.chunks) expect(c.length).toBeLessThanOrEqual(cap);
  });

  it('16 行是 compact 阈值；≤16 行走 normal 档', async () => {
    const { planGenericModule } = await import('../src/print/pages/generic/shared');
    const mk = (n: number): PrintViewModel => buildVm({ tasks: Array.from({ length: n }, (_, i) => taskVm(i + 1)) });
    expect(planGenericModule('task-list', mk(16), 'data-editorial')!.compact).toBe(false);
    expect(planGenericModule('task-list', mk(17), 'data-editorial')!.compact).toBe(true);
  });

  it('空模块 ⇒ plan 为 null（调用方出空态纸，不出表格纸面）', async () => {
    const { planGenericModule } = await import('../src/print/pages/generic/shared');
    expect(planGenericModule('stage-list', buildVm({ stages: [] }), 'data-editorial')).toBeNull();
    expect(planGenericModule('task-list', buildVm({ tasks: [] }), 'editorial-index')).toBeNull();
    expect(planGenericModule('member-roster', buildVm({ members: [] }), 'agent-poster')).toBeNull();
  });

  it('跨页物理纸面：模块头带「（续）」+ 页码连续（第 i / N 页同源 N）', async () => {
    const { planGenericModule } = await import('../src/print/pages/generic/shared');
    const vm = buildVm({ tasks: Array.from({ length: 60 }, (_, i) => taskVm(i + 1)) });
    const plan = planGenericModule('task-list', vm, 'data-editorial')!;
    const d = doc(renderDoc('data-editorial', vm, [{ type: 'generic', module: 'task-list' }]));
    const pages = d.querySelectorAll('.a4-page');
    expect(pages.length, '物理纸面数 = chunk 数').toBe(plan.chunks.length);
    // 第一页模块头无「（续）」；后续页有
    expect(pages[0]!.querySelector('.gm-head__label')!.textContent).toBe('任务清单');
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]!.querySelector('.gm-head__label')!.textContent).toBe('任务清单（续）');
    }
    // 页码连续且同源总数
    const n = pages.length;
    for (let i = 0; i < n; i++) {
      expect(pages[i]!.textContent).toContain(`第 ${i + 1} / ${n} 页`);
    }
    // 每页都有表头（自解释）与口径注
    for (const p of pages) {
      expect(p.querySelector('.gm-table thead')).not.toBeNull();
      expect(p.querySelector('.gm-note')).not.toBeNull();
    }
  });
});

/* ====================================================================================
 * G5 · 静态源码锁（组件/CSS 落位 + 零硬编码色）
 * ==================================================================================== */

describe('期三 · G5 静态锁', () => {
  const ROOT = resolve(__dirname, '..');
  const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

  it('通用模块组件与 CSS 落位；样式走 token 不硬编码纸面三色', () => {
    const css = read('src/print/styles/generic-modules.css');
    // 四套外表各一个承接块（双类前缀纪律）
    for (const t of ['swiss-schedule', 'data-editorial', 'editorial-index', 'agent-poster']) {
      expect(css, `缺少 ${t} 承接块`).toContain(`.print-root.print-template-${t} .gm-`);
    }
    // 配色一律走槽位变量（用户改 accent/ink/line 时通用渲染跟着变）
    expect(css).toContain('var(--tpl-accent)');
    expect(css).toContain('var(--tpl-ink)');
    expect(css).toContain('var(--tpl-line)');
    // 不出现硬编码 hex（会绕过硬闸门）。白色豁免：#fff/#ffffff 是**纸面白常量**
    // （深色 fill/标签上的反白字），不在 accent/ink/line 三槽位里，闸门管不到它；
    // 原生四版 CSS 同样直接用 #ffffff（agent-poster.css:558 等）。其余 hex 一律禁。
    const nonWhite = css.replace(/#[fF]{3,6}/g, '');
    expect(nonWhite).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    // 组件落位
    for (const f of [
      'src/print/pages/generic/shared.ts',
      'src/print/pages/generic/StageListModule.tsx',
      'src/print/pages/generic/TaskListModule.tsx',
      'src/print/pages/generic/MemberRosterModule.tsx',
      'src/print/pages/generic/GenericModuleBody.tsx',
    ]) {
      expect(() => read(f)).not.toThrow();
    }
    // 空态走共享组件（不造示例数据）
    for (const f of ['StageListModule', 'TaskListModule', 'MemberRosterModule']) {
      expect(read(`src/print/pages/generic/${f}.tsx`), `${f} 应消费 EmptyPrintState`).toContain(
        'EmptyPrintState',
      );
    }
  });
});
