// @vitest-environment jsdom
/**
 * 笔 3-C · 时间轴族（阶段条 / 移动端阶段卡 / 改期弹窗 / 左侧锁列）的**语言契约**（新 spec）。
 *
 * ══════════════════ 这个文件补的是哪三类缺口 ══════════════════
 * ① **取值逐字（短取值）**：本笔有 9 条取值短于 `tools/zh-verbatim-check.mjs` 的
 *    分段阈值（≥6 字）—— `3 天` / `交底` / `开始 {date}` / `· {n} 项任务` …
 *    那个工具**一条也判不了**（它的边界，已如实登记）。这里的 `toBe(字面量)` 才是低界。
 * ② **真渲染**：`MobileStageList` 直接挂载（本组件无 store 依赖），断言屏幕上的字
 *    **就是**消息表那一句，并在 `setLang('en')` 后跟着换。
 * ③ **消费锁（防死词条）**：逐个新键在 `src/**` 的**活代码**里（剥注释后）必须出现为字面量 ——
 *    表里有这句 **且** 页面确实消费该键，两条都要成立（否则「新键写进表、页面仍硬编旧串」
 *    会静默通过）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { MobileStageList } from '../src/components/timeline/MobileStageList';
import { maskComments } from './helpers/cjk-locator-guard';
import type { Member, Stage, Task } from '../src/core/types/entities';
import {
  MemberActorKind,
  MemberRoleKind,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import { catalogOf, setLang, t, type MessageKey } from '../src/i18n';

/* ══════════════ ① 取值锁（zh 字面量，表驱动） ══════════════
 *
 * ⚠️ 这张表的**意图**：下面每条的 zh 取值都必须在 spec 里**逐字**写出来
 *    （含 `· ` / 前后空格 / `*` 必填标记），因为分段器判不了它们。
 *    改 zh 取值 ⇒ 这里当场红 —— 这正是「zh 逐字不变」在本笔的机器判据。
 */
const ZH_LITERALS: ReadonlyArray<{ key: MessageKey; vars?: Record<string, string | number>; zh: string }> = [
  { key: 'timeline.daysCount', vars: { n: 3 }, zh: '3 天' },
  { key: 'timeline.overdueDays', vars: { n: 5 }, zh: '逾期 5 天' },
  { key: 'timeline.dueToday', zh: '今日截止' },
  { key: 'timeline.stageSeg.handover', zh: '交底' },
  { key: 'timeline.stageSeg.midterm', zh: '中期' },
  { key: 'timeline.stageSeg.acceptance', zh: '验收' },
  { key: 'timeline.dragBubble.start', vars: { date: '2026-10-01' }, zh: '开始 2026-10-01' },
  { key: 'timeline.dragBubble.end', vars: { date: '2026-10-31' }, zh: '截止 2026-10-31' },
  { key: 'mobileStage.taskCount', vars: { n: 2 }, zh: '· 2 项任务' },
  { key: 'stageRows.unassigned', zh: '未指派负责人' },
  { key: 'stageRows.unknownOwner', zh: '未知负责人' },
  { key: 'reschedule.title', zh: '改期确认' },
  { key: 'reschedule.titleStage', vars: { stage: '施工图' }, zh: ' · 施工图' },
  { key: 'reschedule.titleMoreStages', vars: { n: 4 }, zh: ' 等 4 个阶段' },
  { key: 'reschedule.cancelAria', zh: '取消改期' },
  { key: 'reschedule.reasonLabel', zh: '延期原因' },
  { key: 'reschedule.reasonRequired', zh: '*（任一阶段截止日后移必填）' },
  { key: 'reschedule.reasonPlaceholder', zh: '如：甲方确认延迟 / 审批排队…' },
  { key: 'reschedule.reasonMissing', zh: '未填写延期原因前无法保存（历史将完整留痕）。' },
  { key: 'reschedule.noteLabel', zh: '备注原因（提前/平移可留空）' },
  { key: 'reschedule.saveMany', vars: { n: 3 }, zh: '保存 3 个阶段并留痕' },
  { key: 'reschedule.saveOne', zh: '保存并留痕' },
  { key: 'reschedule.saveFailed', vars: { n: 2 }, zh: '保存被拒绝：2 个阶段改期失败，请检查延期原因后重试。' },
];

/** 本笔新增/复用的全部键（消费锁用；与上表同源，故不会漂） */
const NEW_KEYS: readonly MessageKey[] = [
  ...ZH_LITERALS.map((r) => r.key),
  'common.cancel', // 复用既有键（值同为「取消」）
];

/**
 * 「两语言取值**本就该相同**」的显式登记表（每次登记必须写一行理由）。
 * 判据同 `src/i18n/labels.ts` 的 `MODE_COLLAPSED_KEYS`：不要为了「不同」而造人为差异。
 */
const SAME_IN_BOTH: ReadonlyArray<{ key: MessageKey; why: string }> = [
  {
    key: 'reschedule.titleStage',
    why: '取值是 ` · {stage}` —— **纯标点 + 占位符，一个词都没有**，两种语言本就同形',
  },
];

describe('① zh 取值锁（字面量表驱动；分段器判不了的短取值在这里判）', () => {
  it.each(ZH_LITERALS)('$key → «$zh»', ({ key, vars, zh }) => {
    expect(t(key, vars), `${key} 的 zh 取值变了（zh 逐字不变是硬线）`).toBe(zh);
  });

  it('复用键的取值确实是「取消」（RescheduleDialog 用它替掉硬编的取消）', () => {
    expect(catalogOf('zh')['common.cancel']).toBe('取消');
  });

  it('en 侧每条都有取值、且与 zh 不同（防「漏翻成中文」与「英文=中文」两种假绿）', () => {
    const zh = catalogOf('zh');
    const en = catalogOf('en');
    for (const key of NEW_KEYS) {
      expect(en[key].length, `${key} 的英文取值为空`).toBeGreaterThan(0);
      /*
       * 「两语言取值必须不同」是**逐语言成立的事实**，不是公理：本笔有一条键
       * 两语言天然一字不差 —— 它是**纯标点 + 占位符，一个词都没有**
       * （`' · {stage}'`）。硬要它们不同只会逼出「人为制造的差异」，
       * 那比重合更坏（同 `MODE_COLLAPSED_KEYS` 的收窄口径）。
       * ⇒ 重合必须**显式登记**（每次登记都要写一行理由），不是默默放行。
       */
      if (SAME_IN_BOTH.some((r) => r.key === key)) continue;
      expect(en[key], `${key} 的英文取值与中文一字不差 ⇒ 极可能漏翻`).not.toBe(zh[key]);
    }
  });

  it('登记表里「两语言相同」的键确实相同（登记表不许腐化成万能豁免）', () => {
    for (const { key } of SAME_IN_BOTH) {
      expect(catalogOf('en')[key], `${key} 已改得不相同 ⇒ 这行登记该删掉`).toBe(
        catalogOf('zh')[key],
      );
    }
  });

  it('★「改期确认」这个词只有 `reschedule.title` 一个键（拼出来的标题逐字可复算）', () => {
    // 浮层 aria 与可见标题前半截共用同一个键 ⇒ 两处不可能漂成「改期确认」/「改期」两种说法
    const titleOne = t('reschedule.title') + t('reschedule.titleStage', { stage: '施工图' });
    expect(titleOne).toBe('改期确认 · 施工图');
    const titleMany =
      t('reschedule.title') +
      t('reschedule.titleStage', { stage: '施工图' }) +
      t('reschedule.titleMoreStages', { n: 4 });
    expect(titleMany).toBe('改期确认 · 施工图 等 4 个阶段');
  });
});

/* ══════════════ ② 真渲染：MobileStageList 的字 = 消息表那句 ══════════════ */

const STAGE: Stage = {
  id: 'stg_tl_1',
  projectId: 'proj_tl_1',
  orderIndex: 1,
  templateKey: null,
  colorIndex: 1,
  customColor: null,
  name: '施工图',
  ratioPercent: 100,
  startAt: '2026-10-01T00:00:00Z',
  endAt: '2026-10-10T23:59:59Z',
  status: StageStatus.InProgress,
  ownerId: null,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
};

const MEMBER: Member = {
  id: 'mem_tl_1',
  name: '探针成员',
  role: '负责人',
  contact: null,
  avatarColor: '#88A293',
  active: true,
  roleKind: MemberRoleKind.Member,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
};

const TASK: Task = {
  id: 'tsk_tl_1',
  taskNo: null,
  projectId: 'proj_tl_1',
  stageId: 'stg_tl_1',
  title: '意向收集',
  done: false,
  assigneeId: null,
  assigneeIds: [],
  dueDate: null,
  source: 'human',
  externalId: null,
  agentId: null,
  status: TaskStatus.Draft,
  description: null,
  dependsOn: [],
  artifacts: [],
  startAt: null,
  claimedAt: null,
  runId: null,
  orderIndex: 1,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function unmount(): void {
  if (root !== null) {
    const r = root;
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

function renderList(tasks: Task[]): HTMLElement {
  unmount();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <MobileStageList
        stages={[STAGE]}
        tasks={tasks}
        members={[MEMBER]}
        todayIso="2026-10-05"
        onOpen={() => undefined}
      />,
    );
  });
  return h;
}

/** 文本流里的每一段（用于「屏幕上确实出现了消息表那句」） */
function texts(el: HTMLElement): string[] {
  return [...el.querySelectorAll('span')].map((s) => (s.textContent ?? '').trim());
}

describe('② 真渲染：跨度天数 / 任务数 = 消息表取值（且随语言切换）', () => {
  afterEach(() => {
    unmount();
    setLang('zh'); // 语言是模块级全局状态 ⇒ 复位，避免污染后续用例
  });

  it('zh：跨度「10 天」来自 `timeline.daysCount`（与到期胶囊同一个键）', () => {
    setLang('zh');
    const el = renderList([]);
    // 2026-10-01 ~ 2026-10-10 含头尾 = 10 天
    expect(texts(el)).toContain(t('timeline.daysCount', { n: 10 }));
    expect(texts(el)).toContain('10 天');
  });

  it('zh：任务数「· 2 项任务」来自 `mobileStage.taskCount`', () => {
    setLang('zh');
    const el = renderList([TASK, { ...TASK, id: 'tsk_tl_2' }]);
    expect(texts(el)).toContain(t('mobileStage.taskCount', { n: 2 }));
    expect(texts(el)).toContain('· 2 项任务');
  });

  it('en：切语言后同一处变英文（证明组件订阅了语言，不是只读了一次模块级快照）', () => {
    setLang('en');
    const el = renderList([TASK, { ...TASK, id: 'tsk_tl_2' }]);
    expect(texts(el)).toContain('10 days');
    expect(texts(el)).toContain('· 2 tasks');
    expect(texts(el), '英文态不得残留中文单位').not.toContain('10 天');
  });
});

/* ══════════════ ③ 消费锁：新键必须在 src 的活代码里被引用 ══════════════ */

/** 递归收集 src/** 的 ts/tsx */
function srcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) srcFiles(abs, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}

describe('③ 消费锁：本笔每个键都真的被 src/** 的活代码消费（防死词条）', () => {
  const rootDir = join(__dirname, '..');
  /** 剥注释后的全仓源码（只留活代码：注释里写一句「键名」不该算消费） */
  const code = srcFiles(join(rootDir, 'src'))
    .map((abs) => maskComments(readFileSync(abs, 'utf8')))
    .join('\n');

  it.each(NEW_KEYS)('%s 在 src/** 里出现为字面量', (key) => {
    // 用引号界定，避免前缀键（`timeline.daysCount` vs `timeline.daysCountX`）互相满足
    expect(code.includes(`'${key}'`), `${key} 没有任何 src 消费方 ⇒ 死词条`).toBe(true);
  });
});
