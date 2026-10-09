// @vitest-environment jsdom
/**
 * 期七 · 通用渲染语法保真验收（UX 研究 print-preview-ux-study-2026-10-09 §2.6）。
 *
 * 她的原话：「每一个模板哪怕有别的模块加进来，也应该保持原本设计稿那样的
 * 基础展示方式」。期七把每模板的**结构语法**提成声明式 token
 * （TemplateSyntax），组件按 token 选渲染变体——「一份内容组件」不变，
 * 行形态 / 编号形态 / 分章 / 分隔线 / 焦点行 / 视觉编码按各版原生语法走。
 *
 * 本文件锁（结构族；几何/配色/截图在 print-generic-fidelity-a4.spec.ts）：
 *   F1 token 值表静态锁（§2.6.1 四模板默认 + §2.6.2 十二组合终态）；
 *   F2 A×M1 回落阈值（staggered 仅 ≤9 条，>9 回落 table+tabular）；
 *   F3 E×M2 mono 降级（giant→mono；E×M1/M4 保持 giant）；
 *   F4 H×M2 ≤8 卡化（状态分组卡 + 右栏省略；>8 回清单行 + 右栏常驻）；
 *   F5 三变体结构断言（grid 巨编号分章 / blocks 双栏右栏 / staggered 三列）；
 *   F6 blocks 右栏三模块字段级（阶段健康度 / 任务状态分布 / 席位与门控）；
 *   F7 右栏纪律（列表 ≤6 行超了进「+N」；不与左栏重复字段）。
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SwissScheduleDocument } from '../src/print/documents/SwissScheduleDocument';
import { DataEditorialDocument } from '../src/print/documents/DataEditorialDocument';
import { EditorialIndexDocument } from '../src/print/documents/EditorialIndexDocument';
import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import {
  TEMPLATE_SYNTAX,
  resolveSyntax,
  syntaxOf,
  STAGGERED_MAX_ROWS,
} from '../src/print/pages/generic/syntax';
import { planGenericModule, GENERIC_ROW_H } from '../src/print/pages/generic/shared';
import type { PrintSheet, PrintViewModel } from '../src/print/model/print-view-model';
import { MemberActorKind, MemberRoleKind, StageStatus, TaskStatus } from '../src/core/types/enums';

/* ------------------------------------------------------------------ 夹具 */

type DocKind = 'swiss-schedule' | 'data-editorial' | 'editorial-index' | 'agent-poster';

function stageVm(n: number, over: Partial<PrintViewModel['stages'][number]> = {}) {
  return {
    id: `stg_f_${n}`,
    orderIndex: n,
    name: `阶段${n}·现场勘查与方案深化`,
    ratioPercent: 10,
    startAt: '2026-01-05',
    endAt: '2026-01-20',
    status:
      n % 4 === 0
        ? StageStatus.Delayed
        : n % 3 === 0
          ? StageStatus.Completed
          : n % 3 === 1
            ? StageStatus.InProgress
            : StageStatus.NotStarted,
    ownerName: n === 2 ? '小 Agent' : '负责人甲',
    ownerId: n === 2 ? 'm_f_agent' : 'm_f_human',
    colorIndex: ((n - 1) % 9) + 1,
    customColor: null,
    taskProgress: { done: n % 3, total: 4 },
    ...over,
  };
}

function taskVm(n: number, over: Partial<PrintViewModel['tasks'][number]> = {}) {
  return {
    id: `tsk_f_${n}`,
    taskNo: 1000 + n,
    title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
    status: (['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done'] as TaskStatus[])[n % 7]!,
    assigneeNames: n % 2 === 0 ? ['负责人甲', '小 Agent'] : ['负责人甲'],
    dueDate: n === 4 ? '2026-10-01' : null,
    dependsOn: [],
    artifactCount: n % 3,
    artifacts: [],
    stageId: `stg_f_${((n - 1) % 6) + 1}`,
    overdue: n === 4,
    source: 'human' as const,
    runId: null,
    ...over,
  };
}

const MEMBERS: PrintViewModel['members'] = [
  { id: 'm_f_human', name: '负责人甲', role: '项目负责人', roleKind: MemberRoleKind.Admin, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 5 },
  { id: 'm_f_agent', name: '小 Agent', role: '自动执行体', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Agent, agentKind: 'brand-new-harness-9000', taskCount: 2 },
  { id: 'm_f_plain', name: '施工方乙', role: '驻场工程师', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 1 },
];

function buildVm(stageCount = 6, taskCount = 8): PrintViewModel {
  return {
    project: {
      id: 'proj_fid',
      name: '云栖·湖畔茶室综合改造项目',
      address: '城区某路 1 号',
      clientName: '客户甲',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-03-01',
      scheduleBasisLabel: '自然日',
      percent: 50,
      visibleStageCount: stageCount,
      projectOverdue: false,
      todayIso: '2026-10-09',
    },
    stages: Array.from({ length: stageCount }, (_, i) => stageVm(i + 1)),
    tasks: Array.from({ length: taskCount }, (_, i) => taskVm(i + 1)),
    members: MEMBERS,
    stageLogs: [],
    executions: [],
    proposals: [],
    generatedAt: '2026-10-09T07:30:00Z',
    viewerRole: 'admin',
  };
}

const doc = (markup: string): Document => new JSDOM(markup).window.document;

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

const genericSheet = (module: 'stage-list' | 'task-list' | 'member-roster'): PrintSheet[] => [
  { type: 'generic', module },
];

/* ====================================================================================
 * F1 · token 值表静态锁（§2.6.1 模板默认 + §2.6.2 十二组合终态）
 * ==================================================================================== */

describe('期七 · F1 语法 token 值表（防漂移静态锁）', () => {
  it('四模板默认值逐字段 = §2.6.1', () => {
    expect(TEMPLATE_SYNTAX['swiss-schedule']).toEqual({
      rowForm: 'table',
      numberForm: 'tabular',
      chaptering: false,
      divider: 'heavy-rule',
      focusRow: 'invert',
      extraEncodings: [],
    });
    expect(TEMPLATE_SYNTAX['data-editorial']).toEqual({
      rowForm: 'table',
      numberForm: 'mono',
      chaptering: false,
      divider: 'heavy-rule',
      focusRow: 'accent-text',
      extraEncodings: ['kpi-band', 'progress-bar', 'stack-bar'],
    });
    expect(TEMPLATE_SYNTAX['editorial-index']).toEqual({
      rowForm: 'grid',
      numberForm: 'giant',
      chaptering: true,
      divider: 'hairline',
      focusRow: 'left-sign',
      extraEncodings: [],
    });
    expect(TEMPLATE_SYNTAX['agent-poster']).toEqual({
      rowForm: 'blocks',
      numberForm: 'mono',
      chaptering: false,
      divider: 'block-rule',
      focusRow: 'block-focus',
      extraEncodings: [],
    });
  });

  it('十二组合终态 = §2.6.2（模板默认 ⊕ 组合覆盖）', () => {
    const s = (t: Parameters<typeof syntaxOf>[0], m: Parameters<typeof syntaxOf>[1]) => syntaxOf(t, m)!;
    // A：M1 staggered+giant（>9 回落见 F2）；M2/M4 模板默认
    expect(s('swiss-schedule', 'stage-list')).toMatchObject({ rowForm: 'staggered', numberForm: 'giant' });
    expect(s('swiss-schedule', 'task-list')).toMatchObject({ rowForm: 'table', numberForm: 'tabular' });
    expect(s('swiss-schedule', 'member-roster')).toMatchObject({ rowForm: 'table', numberForm: 'tabular' });
    // D：M1 KPI 带 + 进度条；M2/M4 模板默认
    expect(s('data-editorial', 'stage-list').extraEncodings).toEqual(['kpi-band', 'progress-bar']);
    expect(s('data-editorial', 'task-list')).toMatchObject({ rowForm: 'table', numberForm: 'mono' });
    expect(s('data-editorial', 'member-roster')).toMatchObject({ rowForm: 'table', numberForm: 'mono' });
    // E：M1/M4 grid+giant+分章；M2 grid 但 numberForm 降级 mono（F3）
    expect(s('editorial-index', 'stage-list')).toMatchObject({ rowForm: 'grid', numberForm: 'giant', chaptering: true });
    expect(s('editorial-index', 'member-roster')).toMatchObject({ rowForm: 'grid', numberForm: 'giant', chaptering: true });
    expect(s('editorial-index', 'task-list')).toMatchObject({ rowForm: 'grid', numberForm: 'mono', chaptering: true });
    // H：三模块全 blocks+mono
    for (const m of ['stage-list', 'task-list', 'member-roster'] as const) {
      expect(s('agent-poster', m)).toMatchObject({ rowForm: 'blocks', numberForm: 'mono' });
    }
    // classic 不走模块表
    expect(syntaxOf('classic', 'stage-list')).toBeNull();
  });
});

/* ====================================================================================
 * F2 · A×M1 回落阈值（staggered 仅 ≤9 条）
 * ==================================================================================== */

describe('期七 · F2 A×M1 三列错落回落（§2.6.2 组合级备注）', () => {
  it('resolveSyntax：≤9 条 staggered+giant；>9 条回落 table+tabular', () => {
    expect(STAGGERED_MAX_ROWS).toBe(9);
    expect(resolveSyntax('swiss-schedule', 'stage-list', 9)).toMatchObject({
      rowForm: 'staggered',
      numberForm: 'giant',
    });
    const over = resolveSyntax('swiss-schedule', 'stage-list', 10)!;
    expect(over.rowForm, '>9 条回落 register 表').toBe('table');
    expect(over.numberForm, '>9 条序号回落 tabular').toBe('tabular');
    // 回落不影响其他模块（M2/M4 恒 table）
    expect(resolveSyntax('swiss-schedule', 'task-list', 30)!.rowForm).toBe('table');
  });

  it('planGenericModule 与实际渲染：9 条三列卡片 / 10 条表格', () => {
    const vm9 = buildVm(9, 0);
    const plan9 = planGenericModule('stage-list', vm9, 'swiss-schedule')!;
    expect(plan9.syntax.rowForm).toBe('staggered');
    const d9 = doc(renderDoc('swiss-schedule', vm9, genericSheet('stage-list')));
    expect(d9.querySelectorAll('.gm-staggered__col')).toHaveLength(3);
    expect(d9.querySelectorAll('.gm-card')).toHaveLength(9);
    expect(d9.querySelector('.gm-table'), '≤9 条不应出表格').toBeNull();

    const vm10 = buildVm(10, 0);
    const plan10 = planGenericModule('stage-list', vm10, 'swiss-schedule')!;
    expect(plan10.syntax.rowForm).toBe('table');
    const d10 = doc(renderDoc('swiss-schedule', vm10, genericSheet('stage-list')));
    expect(d10.querySelectorAll('.gm-row')).toHaveLength(10);
    expect(d10.querySelector('.gm-staggered'), '>9 条不应出三列错落').toBeNull();
    expect(d10.querySelector('.gm-card')).toBeNull();
  });
});

/* ====================================================================================
 * F3 · E×M2 mono 降级（§2.6.3）
 * ==================================================================================== */

describe('期七 · F3 E×M2 巨编号降级 mono', () => {
  it('E×M2 序号走 mono（gm-grid__no--mono）；E×M1/M4 保持 24px 衬线巨编号', () => {
    const vm = buildVm();
    // E×M2：mono 降级
    const d2 = doc(renderDoc('editorial-index', vm, genericSheet('task-list')));
    const no2 = d2.querySelector('.gm-grid__no')!;
    expect(no2.classList.contains('gm-grid__no--mono'), 'E×M2 序号应 mono 降级').toBe(true);
    // E×M1：giant（无 mono 类）
    const d1 = doc(renderDoc('editorial-index', vm, genericSheet('stage-list')));
    const no1 = d1.querySelector('.gm-grid__no')!;
    expect(no1.classList.contains('gm-grid__no--mono'), 'E×M1 不应降级').toBe(false);
    // E×M4：giant
    const d4 = doc(renderDoc('editorial-index', vm, genericSheet('member-roster')));
    const no4 = d4.querySelector('.gm-grid__no')!;
    expect(no4.classList.contains('gm-grid__no--mono'), 'E×M4 不应降级').toBe(false);
  });

  it('E×M1 按状态分章（进行中→延期→未开始→已完成）；章头带计数', () => {
    const vm = buildVm();
    const d = doc(renderDoc('editorial-index', vm, genericSheet('stage-list')));
    const chapters = Array.from(d.querySelectorAll('.gm-chapter__label')).map((el) =>
      (el.textContent ?? '').replace(/\s+/g, ''),
    );
    // 6 阶段四态齐全 ⇒ 四章；章序 = 目录跳读优先级
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    expect(chapters[0]).toContain('进行中');
    expect(d.querySelector('.gm-chapter__count')!.textContent).toMatch(/\d+ 阶段/);
  });
});

/* ====================================================================================
 * F4 · H×M2 ≤8 卡化（§2.6.4 左栏联动规则）
 * ==================================================================================== */

describe('期七 · F4 H×M2 状态分组卡化（≤8 条）', () => {
  it('≤8 条：左栏状态分组卡（ap-status__card 同构）+ 右栏省略', () => {
    const vm = buildVm(6, 8);
    const d = doc(renderDoc('agent-poster', vm, genericSheet('task-list')));
    expect(d.querySelector('.gm-blocks'), '卡化模式不走双栏').toBeNull();
    const cards = d.querySelectorAll('.ap-status__card');
    expect(cards.length, '应按任务七态出卡（8 条覆盖全部七态）').toBe(7);
    // 卡同构 ExecutionStatusPage：glyph + 状态名 + key + 计数
    const card = cards[0]!;
    expect(card.querySelector('.ap-status__card-glyph')).not.toBeNull();
    expect(card.querySelector('.ap-status__card-name')).not.toBeNull();
    expect(card.querySelector('.ap-status__card-key')).not.toBeNull();
    expect(card.querySelector('.ap-status__card-count')!.textContent).toBe('2');
    expect(d.querySelector('.gm-panel'), '卡化模式右栏省略').toBeNull();
  });

  it('>8 条：回清单行 + 右栏「任务状态分布」常驻', () => {
    const vm = buildVm(6, 9);
    const d = doc(renderDoc('agent-poster', vm, genericSheet('task-list')));
    expect(d.querySelectorAll('.gm-block-row')).toHaveLength(9);
    expect(d.querySelector('.ap-status__card'), '>8 条不出卡').toBeNull();
    expect(d.querySelector('.gm-panel__title')!.textContent).toBe('任务状态分布');
  });
});

/* ====================================================================================
 * F5 · 三变体结构断言
 * ==================================================================================== */

describe('期七 · F5 三变体结构（grid / blocks / staggered）', () => {
  it('grid（E×M1）：六列 grid 行 + 巨编号独立列 + 发丝线类名 + Agent 左签标记', () => {
    const vm = buildVm();
    const d = doc(renderDoc('editorial-index', vm, genericSheet('stage-list')));
    const page = d.querySelector('[data-print-page="generic-stage-list"]')!;
    expect(page.querySelector('.gm-table'), 'grid 变体不是 table').toBeNull();
    expect(page.querySelectorAll('.gm-grid__row')).toHaveLength(6);
    // 六列语义：编号/名称/状态/日期/负责人/占比
    const row = page.querySelector('.gm-grid__row')!;
    expect(row.querySelector('.gm-grid__no')).not.toBeNull();
    expect(row.querySelector('.gm-grid__name')).not.toBeNull();
    expect(row.querySelector('.gm-grid__state')).not.toBeNull();
    expect(row.querySelector('.gm-grid__date')).not.toBeNull();
    expect(row.querySelector('.gm-grid__owner')).not.toBeNull();
    expect(row.querySelector('.gm-grid__ratio')).not.toBeNull();
    // Agent 负责阶段（ownerId = 小 Agent）：左签 + 姓名标记 + Agent 文字签
    const agentRow = page.querySelector('.gm-grid__row[data-agent]');
    expect(agentRow, '阶段 2 由 Agent 负责').not.toBeNull();
    expect(agentRow!.querySelector('.gm-grid__agent-tag')!.textContent).toBe('Agent');
  });

  it('blocks（H×M1）：左栏明细行 + 右栏面板；行带 mono 编号/状态/日期', () => {
    const vm = buildVm();
    const d = doc(renderDoc('agent-poster', vm, genericSheet('stage-list')));
    const page = d.querySelector('[data-print-page="generic-stage-list"]')!;
    expect(page.querySelector('.gm-table'), 'blocks 变体不是 table').toBeNull();
    expect(page.querySelectorAll('.gm-block-row')).toHaveLength(6);
    const row = page.querySelector('.gm-block-row')!;
    expect(row.querySelector('.gm-block-row__no')!.textContent).toBe('01');
    expect(row.querySelector('.gm-block-row__state')!.textContent).toContain('进行中');
    expect(row.querySelector('.gm-block-row__date')!.textContent).toContain('2026-01-05');
    // 延期行：治理焦点橙的 data 标记（CSS 落地在 a4 spec）
    expect(page.querySelector('.gm-block-row[data-delayed]')).not.toBeNull();
  });

  it('staggered（A×M1 ≤9）：三列卡片 + 序号/名称/状态 + meta 四项', () => {
    const vm = buildVm(9, 0);
    const d = doc(renderDoc('swiss-schedule', vm, genericSheet('stage-list')));
    const page = d.querySelector('[data-print-page="generic-stage-list"]')!;
    expect(page.querySelector('.gm-table'), 'staggered 变体不是 table').toBeNull();
    const cards = page.querySelectorAll('.gm-card');
    expect(cards).toHaveLength(9);
    const card = cards[0]!;
    expect(card.querySelector('.gm-card__no')!.textContent).toBe('01');
    expect(card.querySelector('.gm-card__name')).not.toBeNull();
    expect(card.querySelector('.gm-card__state')).not.toBeNull();
    const meta = card.querySelector('.gm-card__bottom')!.textContent ?? '';
    expect(meta).toContain('占比');
    expect(meta).toContain('任务');
    expect(meta).toContain('负责人');
  });
});

/* ====================================================================================
 * F6 · blocks 右栏三模块字段级（§2.6.4）
 * ==================================================================================== */

describe('期七 · F6 blocks 右栏三模块（字段级）', () => {
  it('H×M1「阶段健康度」：大号 mono 已完成/总数 + 每阶段一行 + 延期 ▲ 橙标记', () => {
    const vm = buildVm();
    const d = doc(renderDoc('agent-poster', vm, genericSheet('stage-list')));
    const panel = d.querySelector('.gm-panel')!;
    expect(panel.querySelector('.gm-panel__title')!.textContent).toBe('阶段健康度');
    expect(panel.querySelector('.gm-panel__big')!.textContent).toBe('02/06');
    expect(panel.querySelector('.gm-panel__caption')!.textContent).toBe('阶段已完成');
    const items = panel.querySelectorAll('.gm-panel__item');
    expect(items).toHaveLength(6);
    // 每阶段一行：序号 + 名 + 状态 + 占比
    expect(items[0]!.textContent).toContain('01');
    expect(items[0]!.textContent).toContain('10%');
    // 延期行：data-delayed + ▲（治理焦点橙由 CSS 落地）
    const delayed = panel.querySelector('.gm-panel__item[data-delayed]');
    expect(delayed).not.toBeNull();
    expect(delayed!.textContent).toContain('延期');
    expect(delayed!.querySelector('.gm-glyph')!.textContent).toBe('▲');
  });

  it('H×M2「任务状态分布」：大号 mono + 状态×数量 + 逾期块（▲ + 数 + 最早逾期日）', () => {
    // 9 条（>8）⇒ 回清单行 + 右栏常驻（≤8 走卡化无右栏，见 F4）
    const vm = buildVm(6, 9);
    const d = doc(renderDoc('agent-poster', vm, genericSheet('task-list')));
    const panel = d.querySelector('.gm-panel')!;
    expect(panel.querySelector('.gm-panel__title')!.textContent).toBe('任务状态分布');
    // 9 条任务：done = n%7===0 ⇒ n=7 一条 ⇒ 01/09
    expect(panel.querySelector('.gm-panel__big')!.textContent).toBe('01/09');
    // 状态×数量列表（按数量降序；九条覆盖全部七态）
    const items = panel.querySelectorAll('.gm-panel__item');
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items[0]!.textContent).toMatch(/[①②③④⑤⑥⑦○□◔◐▲△●]/);
    // 逾期块：▲ + 逾期 1 条 + 最早 2026-10-01
    const flag = panel.querySelector('.gm-panel__flag')!;
    expect(flag.textContent).toContain('逾期 1 条');
    expect(flag.textContent).toContain('最早 2026-10-01');
  });

  it('H×M4「席位与门控」：大号 mono 已用/上限 + 人类/Agent 分栏 + Agent 简列 + 门控行', () => {
    const vm = buildVm();
    const d = doc(renderDoc('agent-poster', vm, genericSheet('member-roster')));
    const panel = d.querySelector('.gm-panel')!;
    expect(panel.querySelector('.gm-panel__title')!.textContent).toBe('席位与门控');
    expect(panel.querySelector('.gm-panel__big')!.textContent).toBe('01/03');
    expect(panel.querySelector('.gm-panel__caption')!.textContent).toBe('Agent 席位已用');
    // 人类 / Agent 分栏计数
    const items = Array.from(panel.querySelectorAll('.gm-panel__item')).map((el) => el.textContent ?? '');
    expect(items.some((t) => t.includes('人类成员') && t.includes('2'))).toBe(true);
    expect(items.some((t) => t.includes('Agent 执行体') && t.includes('1'))).toBe(true);
    // Agent 简列：编号 + 名 + agentKind（开放字符串原样）
    expect(panel.textContent).toContain('brand-new-harness-9000');
    // 门控提示行（未满席）
    expect(panel.querySelector('.gm-panel__gate')!.textContent).toContain('剩余 2 席');
  });

  it('右栏纪律：列表 ≤6 行超了进「+N」；不与左栏重复（左栏无占比/任务数字段）', () => {
    // 8 阶段 ⇒ 右栏列 6 行 + 「+2」
    const vm = buildVm(8, 0);
    const d = doc(renderDoc('agent-poster', vm, genericSheet('stage-list')));
    const panel = d.querySelector('.gm-panel')!;
    expect(panel.querySelectorAll('.gm-panel__item')).toHaveLength(6);
    expect(panel.querySelector('.gm-panel__more')!.textContent).toBe('+2');
    // 左栏明细行不带占比/任务数（那是右栏的结论字段）
    const leftRow = d.querySelector('.gm-block-row')!;
    expect(leftRow.textContent).not.toContain('10%');
    expect(leftRow.textContent).not.toContain('任务');
  });
});

/* ====================================================================================
 * F7 · 分页估高按变体分档（别 reintroduce 早断）
 * ==================================================================================== */

describe('期七 · F7 变体行估高进分页计划', () => {
  it('GENERIC_ROW_H 按 rowForm 分档；grid 巨编号行高于 table 行', () => {
    expect(GENERIC_ROW_H['stage-list'].table).toBeDefined();
    expect(GENERIC_ROW_H['stage-list'].grid).toBeDefined();
    expect(GENERIC_ROW_H['stage-list'].blocks).toBeDefined();
    expect(GENERIC_ROW_H['stage-list'].staggered).toBeDefined();
    expect(GENERIC_ROW_H['stage-list'].grid!.normal).toBeGreaterThan(GENERIC_ROW_H['stage-list'].table!.normal);
    expect(GENERIC_ROW_H['member-roster'].grid!.normal).toBeGreaterThan(
      GENERIC_ROW_H['member-roster'].table!.normal,
    );
  });

  it('E×M1 60 阶段分章跨页：行不裂 + 章头不孤儿 + 续头只标真跨页', async () => {
    const vm = buildVm(60, 0);
    const plan = planGenericModule('stage-list', vm, 'editorial-index')!;
    expect(plan.syntax.rowForm).toBe('grid');
    expect(plan.compact, '60 行 ⇒ compact').toBe(true);
    expect(plan.chunks.length, '60 阶段应跨页').toBeGreaterThan(1);
    // 行不裂：总行数守恒（章头条目不计）
    const rows = plan.chunks.flatMap((c) => c.filter((i) => i.kind === 'row'));
    expect(rows).toHaveLength(60);
    // 章头不孤儿：每个 chunk 的章头后必有行
    for (const c of plan.chunks) {
      const items = c;
      for (let i = 0; i < items.length; i++) {
        if (items[i]!.kind === 'chapter') {
          expect(i, '章头后必须有行（不孤儿）').toBeLessThan(items.length - 1);
        }
      }
    }
    // 续头只标真跨页：带 continued 的章头只在非首 chunk 出现
    const contCount = plan.chunks.flatMap((c, ci) =>
      c.filter((i) => i.kind === 'chapter' && i.continued).map(() => ci),
    );
    for (const ci of contCount) expect(ci, '续头只在跨页 chunk').toBeGreaterThan(0);
  });
});
