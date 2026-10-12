// @vitest-environment jsdom
/**
 * 「5 块 × 4 模板」重构 · 批 1 地基（可开关单元模型）验收。
 *
 * 依据：`deliverables/gstack/print-5blocks-mapping-2026-10-13.md`
 *   · 决策 5 的四条实现要求（本文件逐条锁）；
 *   · 决策 6「严格一一对应」在模型层的对价：勾选只决定内容，永不决定版式。
 *
 * 锁六件：
 *   L1-a 注册表形状：5 块（id 与 `SchedulePaperBlocks` 同源）+ 装置逐套声明 label/hint；
 *   L1-b `resolveUnits` 的**同一条解析路径**：装置恒 `forced`（即使 prefs 里
 *        显式勾掉也仍开——这就是「将来开放只需换数据源」的证据）；
 *   L1-c 选择器行的来源 = `printToggleableUnits`（今天只列可勾的块，装置不进清单）；
 *   L2-a 缺键 = 默认全开；有勾选 = 精确增减（决策 6 的模型层判据）；
 *   L2-b 旧「11 模块」勾选 → 新单元集合的迁移（读出来映射、**原键不删**）；
 *   L3 store：`units` 键落库 / 双写兼容（pages + modules + blocks 三键一个不删）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PRINT_BLOCK_IDS,
  PRINT_BLOCKS,
  PRINT_TEMPLATE_UNITS,
  blockRecordOf,
  blocksFromLegacyModules,
  enabledBlockCount,
  forcedBlockUnits,
  isPrintUnitId,
  printTemplateUnits,
  printToggleableUnits,
  resolveUnits,
  unitEnabled,
} from '../src/print/model/print-units';
import { PRINT_TEMPLATE_IDS } from '../src/components/print/print-templates';
import { DEFAULT_SCHEDULE_PAPER_BLOCKS } from '../src/lib/schedule-print';
import {
  SwissScheduleDocument,
  swissBlockPages,
  swissGanttPitch,
} from '../src/print/documents/SwissScheduleDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageLogType,
  StageStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, StageLog } from '../src/core/types/entities';
import { PRINT_PREFS_STORAGE_KEY, usePrintPrefsStore } from '../src/store/usePrintPrefsStore';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

/* ====================================================================================
 * L1-a · 注册表形状
 * ==================================================================================== */

describe('批 1 地基 · L1-a 统一注册表（5 块 + 逐套装置声明）', () => {
  it('5 块 id 与经典 `SchedulePaperBlocks` 的键**逐字同源**（不许第二份真相）', () => {
    expect(PRINT_BLOCK_IDS).toEqual(['header', 'timeline', 'projectInfo', 'stageTable', 'footer']);
    expect(Object.keys(DEFAULT_SCHEDULE_PAPER_BLOCKS).sort()).toEqual([...PRINT_BLOCK_IDS].sort());
    expect(PRINT_BLOCKS.map((b) => b.id)).toEqual([...PRINT_BLOCK_IDS]);
    for (const b of PRINT_BLOCKS) {
      expect(b.label.length, `${b.id} 行文非空`).toBeGreaterThan(0);
      expect(b.hint.length, `${b.id} 说明非空`).toBeGreaterThan(0);
    }
    // 类型守卫：5 块与装置都是合法单元 id；页 kind 不是
    expect(isPrintUnitId('timeline')).toBe(true);
    expect(isPrintUnitId('swiss-topbar')).toBe(true);
    expect(isPrintUnitId('stage-overview'), '页 kind 不得混进单元 id').toBe(false);
    expect(isPrintUnitId('bogus')).toBe(false);
  });

  it('每套模板都声明了 5 块；装置逐套声明 label + hint', () => {
    for (const id of PRINT_TEMPLATE_IDS) {
      const units = printTemplateUnits(id);
      const blocks = units.filter((u) => u.kind === 'block');
      expect(blocks.map((b) => b.id), `${id} 的五块齐全`).toEqual([...PRINT_BLOCK_IDS]);
      for (const u of units) {
        expect(u.label.length, `${id}/${u.id} label 非空`).toBeGreaterThan(0);
        expect(u.hint.length, `${id}/${u.id} hint 非空`).toBeGreaterThan(0);
      }
    }
    // 装置表（§2.6 逐套的版性构件；今天 forced，将来开放勾选时直接用这张表）
    const deviceIds = (id: (typeof PRINT_TEMPLATE_IDS)[number]): string[] =>
      printTemplateUnits(id)
        .filter((u) => u.kind === 'device')
        .map((u) => u.id as string);
    expect(deviceIds('classic'), '经典无版性装置（五块全可摘）').toEqual([]);
    expect(deviceIds('swiss-schedule')).toEqual(['swiss-topbar', 'swiss-percent', 'swiss-bottombar']);
    expect(deviceIds('data-editorial')).toEqual(['de-head', 'de-band']);
    expect(deviceIds('editorial-index')).toEqual(['ei-giant-title']);
    expect(deviceIds('agent-poster')).toEqual([
      'ap-flood-top',
      'ap-flood-bottom',
      'ap-spine',
      'ap-sum',
    ]);
    // 注册表是**声明**，不允许出现「声明了但表里没有」的悬空 id
    for (const id of PRINT_TEMPLATE_IDS) {
      const declared = printTemplateUnits(id).map((u) => u.id);
      expect(new Set(declared).size, `${id} 单元 id 不得重复`).toBe(declared.length);
      expect(PRINT_TEMPLATE_UNITS[id].length).toBe(declared.length);
    }
  });

  it('不可摘块（§2.6 的丙）逐套登记：A/D/E/H 的 B1；H 另有 B5', () => {
    expect(forcedBlockUnits('classic').map((u) => u.id), '经典五块全可摘').toEqual([]);
    for (const id of ['swiss-schedule', 'data-editorial', 'editorial-index'] as const) {
      expect(forcedBlockUnits(id).map((u) => u.id), `${id} 的 B1 不可摘`).toEqual(['header']);
    }
    expect(forcedBlockUnits('agent-poster').map((u) => u.id), 'H 的 B1 与 B5 都不可摘').toEqual([
      'header',
      'footer',
    ]);
  });
});

/* ====================================================================================
 * L1-b/L1-c · 同一条解析路径 + 选择器行来源
 * ==================================================================================== */

describe('批 1 地基 · L1-b resolveUnits（装配与渲染的唯一路径）', () => {
  it('缺键 = 默认全开（决策 5 第 4 条：将来开放装置时老用户零迁移）', () => {
    for (const id of PRINT_TEMPLATE_IDS) {
      const units = resolveUnits(id, undefined);
      expect(units.every((u) => u.enabled), `${id} 缺参 ⇒ 全开`).toBe(true);
      expect(units.filter((u) => u.source === 'forced').length, `${id} 有 forced 来源`).toBe(
        printTemplateUnits(id).filter((u) => u.kind === 'device' || u.forced).length,
      );
      expect(units.filter((u) => u.source === 'default').length, `${id} 其余为 default`).toBe(
        printTemplateUnits(id).filter((u) => u.kind === 'block' && !u.forced).length,
      );
    }
  });

  it('装置**恒为 forced**：prefs 里显式勾掉也仍开（这就是「只换数据源」的证据）', () => {
    // 把该模板的可勾单元全部关掉（极端 prefs），装置必须原样在
    const units = resolveUnits('swiss-schedule', {
      units: { 'swiss-schedule': [] },
    });
    expect(unitEnabled(units, 'swiss-topbar'), '黑顶栏装置不可由勾选关闭').toBe(true);
    expect(unitEnabled(units, 'swiss-percent')).toBe(true);
    expect(unitEnabled(units, 'swiss-bottombar')).toBe(true);
    for (const d of units.filter((u) => u.kind === 'device')) {
      expect(d.source, `${d.id} 来源应是 forced`).toBe('forced');
      expect(d.enabled).toBe(true);
    }
    // 块则**精确**跟随用户集合：只勾 timeline ⇒ 其余可勾块全关、不可摘的 B1 仍开
    const only = resolveUnits('swiss-schedule', { units: { 'swiss-schedule': ['timeline'] } });
    expect(blockRecordOf(only)).toEqual({
      header: true, // A 的 B1 是 forced（项目名住在板头）⇒ 即使没在用户集合里也仍开
      timeline: true,
      projectInfo: false,
      stageTable: false,
      footer: false,
    });
    for (const b of only.filter((u) => u.kind === 'block' && !u.forced)) {
      expect(b.source, `${b.id} 来源应是 user`).toBe('user');
    }
  });

  it('不可摘块恒开：A 的 B1 即使被显式关掉也仍在（项目名不许消失）', () => {
    const units = resolveUnits('swiss-schedule', { units: { 'swiss-schedule': [] } });
    const header = units.find((u) => u.id === 'header')!;
    expect(header.enabled, 'A 的 B1 由刊头承担 ⇒ forced 恒开').toBe(true);
    expect(header.source).toBe('forced');
    // 而 classic 的同一块可关（§2.6 明文「与经典的不一致」）
    const classic = resolveUnits('classic', {
      units: { classic: ['timeline'] },
    });
    expect(classic.find((u) => u.id === 'header')!.enabled, '经典 B1 可关').toBe(false);
  });

  it('classic 的解析回落旧键 `blocks`（新键缺失时两条路同一组布尔值）', () => {
    const units = resolveUnits('classic', {
      blocks: { header: false, timeline: true, projectInfo: false, stageTable: true, footer: false },
    });
    expect(blockRecordOf(units)).toEqual({
      header: false,
      timeline: true,
      projectInfo: false,
      stageTable: true,
      footer: false,
    });
    // 新键优先于旧键（正主是 units）
    const both = resolveUnits('classic', {
      units: { classic: ['footer'] },
      blocks: { header: true, timeline: true, projectInfo: true, stageTable: true, footer: true },
    });
    expect(blockRecordOf(both)).toEqual({
      header: false,
      timeline: false,
      projectInfo: false,
      stageTable: false,
      footer: true,
    });
  });

  it('选择器行 = 可勾的块（装置与不可摘块**今天不进清单**，决策 5 第 3 条）', () => {
    expect(printToggleableUnits('classic').map((u) => u.id)).toEqual([...PRINT_BLOCK_IDS]);
    expect(printToggleableUnits('swiss-schedule').map((u) => u.id)).toEqual([
      'timeline',
      'projectInfo',
      'stageTable',
      'footer',
    ]);
    for (const id of PRINT_TEMPLATE_IDS) {
      for (const row of printToggleableUnits(id)) {
        expect(row.kind, `${id} 清单只列块`).toBe('block');
        expect(row.forced, `${id}/${row.id} 可勾行不得是 forced`).toBe(false);
      }
    }
    // 读数与行数同源（否则 A 会出现「清单 4 行、读数 5 块」的自相矛盾）
    expect(enabledBlockCount(resolveUnits('swiss-schedule', undefined)), 'A 缺键 ⇒ 4 行全勾').toBe(4);
    expect(enabledBlockCount(resolveUnits('classic', undefined)), '经典 ⇒ 5 行全勾').toBe(5);
    expect(
      enabledBlockCount(resolveUnits('swiss-schedule', { units: { 'swiss-schedule': ['timeline'] } })),
    ).toBe(1);
  });
});

/* ====================================================================================
 * L2 · 旧数据迁移
 * ==================================================================================== */

describe('批 1 地基 · L2 旧「11 模块」→ 新「单元」映射（原键不删）', () => {
  it('只有 stageTable 有模块承载位：stage-list / progress-matrix ⇒ stageTable', () => {
    expect(blocksFromLegacyModules(['stage-list'])).toEqual({ stageTable: true });
    expect(blocksFromLegacyModules(['progress-matrix'])).toEqual({ stageTable: true });
    expect(blocksFromLegacyModules(['stage-list', 'progress-matrix'])).toEqual({ stageTable: true });
  });

  it('无承载位的模块不表态（不把旧数据翻译成一张白纸）', () => {
    // 只勾过「任务清单」的用户：stageTable 之外一个块都不表态
    expect(blocksFromLegacyModules(['task-list'])).toEqual({ stageTable: false });
    expect(blocksFromLegacyModules(['delay-ledger', 'member-roster'])).toEqual({ stageTable: false });
    // 显式空集同理（旧语义是「一页都不打」，新语义里它只关得掉有承载位的那块）
    expect(blocksFromLegacyModules([])).toEqual({ stageTable: false });
    // 脏值 ⇒ null（调用方保持缺键 = 默认全开）
    expect(blocksFromLegacyModules(undefined)).toBeNull();
    expect(blocksFromLegacyModules('stage-list')).toBeNull();
  });
});

/* ====================================================================================
 * L3 · store：units 键落库 + 三键兼容
 * ==================================================================================== */

describe('批 1 地基 · L3 store（units 键 + 旧键保留）', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(async () => {
    localStorage.clear();
    await usePrintPrefsStore.persist.rehydrate();
  });

  /** flush microtask：zustand persist 的 setItem 是 thenable 链（异步一拍） */
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('setUnit 落库为 units[template]；未声明的 id 不接受；classic 不接受（正主是 blocks）', async () => {
    localStorage.clear();
    usePrintPrefsStore.setState({ template: 'swiss-schedule', units: {}, modules: {}, blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS } });
    usePrintPrefsStore.getState().setUnit('swiss-schedule', 'timeline', false);
    // 缺键起手 = 默认全开（**含装置**：集合是「单元 id 集合」，将来开放装置
    // 勾选时老用户的装置已在集合里 ⇒ 零迁移，决策 5 第 4 条）⇒ 只少了 timeline
    expect(usePrintPrefsStore.getState().units['swiss-schedule']).toEqual([
      'header',
      'projectInfo',
      'stageTable',
      'footer',
      'swiss-topbar',
      'swiss-percent',
      'swiss-bottombar',
    ]);
    // 未声明的 id 不接受（集合长度不变）
    usePrintPrefsStore.getState().setUnit('swiss-schedule', 'bogus' as never, false);
    expect(usePrintPrefsStore.getState().units['swiss-schedule']).toHaveLength(7);
    // classic 无操作（同 palette 的 classic 口径）
    usePrintPrefsStore.getState().setUnit('classic', 'timeline', false);
    expect(usePrintPrefsStore.getState().units['classic']).toBeUndefined();
    await flush();
    const raw = localStorage.getItem(PRINT_PREFS_STORAGE_KEY);
    expect(raw, 'units 键应落库').not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.units).toEqual({
      'swiss-schedule': [
        'header',
        'projectInfo',
        'stageTable',
        'footer',
        'swiss-topbar',
        'swiss-percent',
        'swiss-bottombar',
      ],
    });
    // 三个旧键**一个都不删**（数据不可逆损失的防护）
    expect(parsed.state, 'blocks 键保留').toHaveProperty('blocks');
    expect(parsed.state, 'modules 键保留（债② 正主）').toHaveProperty('modules');
    expect(parsed.state, 'pages 键保留（更早的键）').toHaveProperty('pages');
  });

  it('hydrate：旧 modules 数据映射到 units；旧键仍在；units 键存在时它是正主', async () => {
    const modules = { 'swiss-schedule': ['stage-list', 'task-list'] };
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({ state: { template: 'swiss-schedule', modules, pages: modules }, version: 0 }),
    );
    await usePrintPrefsStore.persist.rehydrate();
    const s = usePrintPrefsStore.getState();
    expect(s.modules['swiss-schedule'], '旧键照旧装载（D/E/H 仍在用）').toEqual([
      'stage-list',
      'task-list',
    ]);
    expect(s.units['swiss-schedule'], '映射结果：stage-list ⇒ stageTable，其余按默认全开').toEqual([
      'header',
      'timeline',
      'projectInfo',
      'stageTable',
      'footer',
    ]);

    // units 键存在 ⇒ 它是正主（modules 不再参与单元解析）
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: {
          template: 'swiss-schedule',
          modules: { 'swiss-schedule': ['stage-list'] },
          units: { 'swiss-schedule': ['timeline'] },
        },
        version: 0,
      }),
    );
    await usePrintPrefsStore.persist.rehydrate();
    expect(usePrintPrefsStore.getState().units['swiss-schedule']).toEqual(['timeline']);
  });

  it('模块被显式摘掉「阶段清单」⇒ 新形态的 stageTable 跟着关（旧意图不丢）', async () => {
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: { template: 'swiss-schedule', modules: { 'swiss-schedule': ['task-list'] } },
        version: 0,
      }),
    );
    await usePrintPrefsStore.persist.rehydrate();
    const units = resolveUnits('swiss-schedule', {
      units: usePrintPrefsStore.getState().units,
    });
    expect(blockRecordOf(units), 'stageTable 关、其余块默认开').toEqual({
      header: true,
      timeline: true,
      projectInfo: true,
      stageTable: false,
      footer: true,
    });
  });
});

/* ====================================================================================
 * L5 · 5 块形态的页装配（「预计页数 = 实际出纸」的对价）
 * ==================================================================================== */

describe('批 1 地基 · L5 A 版五块形态的页装配与自适应行高', () => {
  const PROJECT = {
    id: 'p_blocks',
    name: '某茶空间',
    address: '',
    clientName: '客户甲',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01T00:00:00Z',
    plannedEndAt: '2026-06-18T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind: 'human' as const,
    ownerMemberId: null,
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const ADMIN: Member = {
    id: 'm_blocks',
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
  function vmOf(n: number, withLog = true) {
    const stages: Stage[] = Array.from({ length: n }, (_, i) => ({
      id: `stg_b_${i + 1}`,
      projectId: PROJECT.id,
      orderIndex: i + 1,
      templateKey: null,
      colorIndex: ((i) % 9) + 1,
      customColor: null,
      name: `阶段${i + 1}`,
      ratioPercent: 10,
      startAt: '2026-01-05T00:00:00Z',
      endAt: '2026-02-20T23:59:59Z',
      status: StageStatus.InProgress,
      ownerId: ADMIN.id,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    }));
    const logs: StageLog[] = withLog
      ? [
          {
            id: 'log_b_1',
            stageId: stages[0]!.id,
            projectId: PROJECT.id,
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
        ]
      : [];
    return buildPrintViewModel({
      project: PROJECT,
      stages,
      tasks: [],
      members: [ADMIN],
      stageLogs: logs,
      role: MemberRoleKind.Admin,
      currentMemberId: ADMIN.id,
      todayIso: '2026-03-01',
      now: new Date('2026-03-01T07:30:00Z'),
    });
  }

  /** 文档层实际渲染出来的页数（renderToStaticMarkup，无浏览器） */
  function renderedPages(n: number, withLog = true): number {
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, {
        vm: vmOf(n, withLog),
        palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline,
      }),
    );
    return (markup.match(/class="a4-page swiss-page"/g) ?? []).length;
  }

  it('★ 预计页数 ≡ 实际出纸（2 / 9 / 14 / 20 / 27 阶段逐一对照）', () => {
    for (const n of [2, 9, 14, 20, 27]) {
      const vm = vmOf(n);
      const planned = swissBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS).length;
      expect(renderedPages(n), `${n} 阶段：装配层 ${planned} 页、文档层应逐页一致`).toBe(planned);
      expect(planned, `${n} 阶段：至少 1 页`).toBeGreaterThan(0);
    }
  });

  it('阶段清单关掉 ⇒ 单页；阶段清单的每一页都承载阶段（纸壳页不出空态）', () => {
    const vm = vmOf(9);
    expect(
      swissBlockPages(vm, { ...DEFAULT_SCHEDULE_PAPER_BLOCKS, stageTable: false }),
      'B4 关掉 ⇒ 只有首页（B1/B2/B3）',
    ).toHaveLength(1);
    // 阶段全部有主：切片并集 = 全量、不重不漏
    const plans = swissBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS);
    const ids = plans.flatMap((p) => p.stages.map((s) => s.id));
    expect(ids).toEqual(vm.stages.map((s) => s.id));
    // 纸壳页（无承载）只允许是首页（B2/B3 占满、清单后移）
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i]!.stages.length, `第 ${i + 1} 页不该是空壳`).toBeGreaterThan(0);
    }
    // L3 改期记录只挂在最后一页（§0.5：不单独成页）
    expect(plans.filter((p) => p.last)).toHaveLength(1);
    expect(plans[plans.length - 1]!.last).toBe(true);
  });

  it('B2 行高自适应：阶段越多行越矮（夹在 14–28），且 125 阶段仍给得出行高', () => {
    expect(swissGanttPitch(2), '2 阶段：设计基线 28').toBe(28);
    expect(swissGanttPitch(9), '9 阶段：仍 28').toBe(28);
    expect(swissGanttPitch(20), '20 阶段：压到可读下限之上').toBeLessThan(28);
    expect(swissGanttPitch(20)).toBeGreaterThanOrEqual(14);
    expect(swissGanttPitch(40), '40 阶段：下限 14（再压会与字号打架）').toBe(14);
    for (const n of [1, 5, 12, 33, 125]) {
      const p = swissGanttPitch(n);
      expect(p).toBeGreaterThanOrEqual(14);
      expect(p).toBeLessThanOrEqual(28);
    }
  });

  it('B1 的 meta 恒三行且字段全集不丢（委托方只在 admin 且非空时附加）', () => {
    // 铁律①「B1 ∪ B3 = 同一组字段全集」：可见阶段 / 阶段套餐 / 打印日期三件恒在，
    // 委托方按角色附加（普通成员 VM 里 clientName 恒 undefined）
    const admin = renderToStaticMarkup(
      createElement(SwissScheduleDocument, {
        vm: vmOf(2),
        palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline,
      }),
    );
    const all = (admin.match(/swiss-masthead__meta-line swiss-num">[^<]*</g) ?? []).map((m) =>
      m.slice(m.indexOf('">') + 2, -1),
    );
    // 本夹具 2 页（每页一枚板头 ⇒ 6 行）；判据只看首页那三行
    const lines = all.slice(0, 3);
    expect(all.length, '每页一枚板头、每枚三行').toBe(6);
    expect(lines).toHaveLength(3);
    expect(lines[0], '可见阶段恒在第一行').toContain('可见阶段 2 / 2');
    expect(lines[0], 'admin 且有委托方 ⇒ 同行附加').toContain('委托方 客户甲');
    expect(lines[1]).toContain('阶段套餐');
    expect(lines[2]).toContain('打印日期');
  });

  it('无改期记录的小项目：单页（§3 速查表「A 纸面 1 页」的常见形态）', () => {
    expect(swissBlockPages(vmOf(2, false), DEFAULT_SCHEDULE_PAPER_BLOCKS)).toHaveLength(1);
    expect(renderedPages(2, false)).toBe(1);
  });
});

/* ====================================================================================
 * L4 · 静态锁（模型层不许出现第二处「装置是否渲染」的判断）
 * ==================================================================================== */

describe('批 1 地基 · L4 静态锁', () => {
  it('print-units.ts：5 块 id 取自 SchedulePaperBlocks（无第二份 id 列表）', () => {
    const src = read('src/print/model/print-units.ts');
    expect(src).toContain('export type PrintBlockId = keyof SchedulePaperBlocks');
    expect(src, '五块 id 唯一出处是 keyof SchedulePaperBlocks').toContain('DEFAULT_SCHEDULE_PAPER_BLOCKS');
    expect(src).toContain('export function resolveUnits');
    expect(src).toContain('export function printToggleableUnits');
    expect(src).toContain('export function printTemplateUnits');
  });

  it('渲染侧：A 的文档只有**一处**分叉（sheets / 五块形态），装置与内容块同一出处', () => {
    const src = read('src/print/documents/SwissScheduleDocument.tsx');
    expect(src).toContain('const physical = sheets ? swissSchedulePhysical(vm, sheets) : null');
    // 决策 5 第 2 条：渲染侧收的是**单元解析结果**，不是五块布尔值 + 写死装置
    expect(src, '文档层收 ResolvedPrintUnit[]').toContain('units?: readonly ResolvedPrintUnit[]');
    expect(src).toContain("const resolvedUnits = units ?? resolveUnits('swiss-schedule', undefined)");
    expect(src, '块布尔值从单元派生').toContain('blockRecordOf(resolvedUnits)');
    // 三件装置都经 show()（= unitEnabled）判定 —— 将来开放勾选只需改注册表
    for (const device of ['swiss-topbar', 'swiss-bottombar', 'swiss-percent']) {
      expect(src, `装置 ${device} 必须走 show()`).toContain(`show('${device}')`);
    }
    expect(src, '黑顶栏不得无条件渲染（必须被 show() 包住）').toMatch(
      /show\('swiss-topbar'\) && \(\s*\n\s*<header className="swiss-topbar">/,
    );
    expect(src, '黑底栏不得无条件渲染（必须被 show() 包住）').toMatch(
      /show\('swiss-bottombar'\) && \(\s*\n\s*<footer className="swiss-bottombar">/,
    );
    // 五块**全部**经 blocks.* 判定（决策 6 的一一对应在渲染层的落点）
    for (const key of ['timeline', 'projectInfo', 'stageTable', 'footer']) {
      expect(src, `B 块 ${key} 应经 blocks 判定`).toContain(`blocks.${key}`);
    }
  });
});
