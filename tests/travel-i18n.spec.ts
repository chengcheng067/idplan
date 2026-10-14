// @vitest-environment jsdom
/**
 * 笔 3-E · 行程面板（`TravelItineraryPanel`）的**语言契约**（新 spec）。
 *
 * ══════════════════ 补的是哪三类缺口 ══════════════════
 * ① **取值逐字（短取值）**：本笔多条取值短于 `tools/zh-verbatim-check.mjs` 的分段阈值（≥6），
 *    那个工具一条都判不了 —— 表内的 `toBe(字面量)` 才是它们的低界。
 * ② **钩子换掉之后的那半边**：`删除 {date} 行程卡` 这条 aria 已改走消息表、定位改成
 *    `data-itinerary-remove` 钩子；钩子只证结构 ⇒ 这里补「可见名 = 消息表那句」（调用形状锁）。
 * ③ **禁区登记（B 不翻）**：`assignTask` 的 `'我'` 是 **operatorName ⇒ 落库**。
 *    它必须**留在源码里且等于 `'我'`** —— 把它翻掉是本笔最容易犯的错，故钉一条反向断言。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments } from './helpers/cjk-locator-guard';
import { catalogOf, t, type MessageKey } from '../src/i18n';
/* 英文补齐批 · core 片第二波：错误正文改走 core 的解析器（core 内零 i18n，`t` 由渲染层注入） */
import { ChangxiaError, ChangxiaErrorCode, resolveErrorText } from '../src/core/types/enums';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/* ══════════════ ① 取值锁（zh 字面量，表驱动） ══════════════ */
const ZH_LITERALS: ReadonlyArray<{ key: MessageKey; vars?: Record<string, string | number>; zh: string }> = [
  { key: 'travel.loading', zh: '正在生成每日行程…' },
  { key: 'travel.title', zh: '每日行程' },
  { key: 'travel.totalDays', vars: { n: 3 }, zh: '共 3 天' },
  { key: 'travel.budget', zh: '预算' },
  { key: 'travel.actual', zh: '实际' },
  { key: 'travel.diff', zh: '差额' },
  { key: 'travel.syncTitle', zh: '按当前项目起止日期补齐缺失日期卡（只补不删）' },
  { key: 'travel.sync', zh: '同步日期' },
  { key: 'travel.addDayTitle', zh: '追加一天（最后一天之后）' },
  { key: 'travel.addDay', zh: '加一天' },
  { key: 'travel.dayIndex', vars: { n: 2 }, zh: '第 2 天' },
  { key: 'travel.today', zh: '· 今天' },
  { key: 'travel.removeDayAria', vars: { date: '2026-10-01' }, zh: '删除 2026-10-01 行程卡' },
  { key: 'travel.fieldTransport', zh: '交通' },
  { key: 'travel.fieldAccommodation', zh: '住宿' },
  { key: 'travel.fieldTransportAria', vars: { date: '2026-10-01' }, zh: '2026-10-01 交通' },
  { key: 'travel.fieldAccommodationAria', vars: { date: '2026-10-01' }, zh: '2026-10-01 住宿' },
  { key: 'travel.fieldTransportPlaceholder', zh: '如 高铁 G1234 / 市内打车' },
  { key: 'travel.fieldAccommodationPlaceholder', zh: '如 XX 酒店 · 大床房' },
  { key: 'travel.fieldBudgetAria', vars: { date: '2026-10-01' }, zh: '2026-10-01 预算金额' },
  { key: 'travel.fieldActualAria', vars: { date: '2026-10-01' }, zh: '2026-10-01 实际金额' },
  { key: 'travel.unassignedTitle', zh: '待排任务（未挂到某一天）' },
  { key: 'travel.assignAria', vars: { title: '量房' }, zh: '将「量房」排入某天' },
  { key: 'travel.assignPlaceholder', zh: '排入…' },
  { key: 'travel.detachAria', vars: { title: '量房' }, zh: '将「量房」移出当日行程' },
  { key: 'travel.detachTitle', zh: '移出当日行程' },
  { key: 'travel.summaryTransport', vars: { value: '高铁 G1' }, zh: '交通「高铁 G1」' },
  { key: 'travel.summaryAccommodation', vars: { value: 'XX 酒店' }, zh: '住宿「XX 酒店」' },
  { key: 'travel.summaryBudget', vars: { amount: '¥1,200' }, zh: '预算 ¥1,200' },
  { key: 'travel.summaryActual', vars: { amount: '¥900' }, zh: '实际 ¥900' },
  { key: 'travel.summarySep', zh: '、' },
  { key: 'travel.removeDialogTitle', zh: '删除行程卡' },
  { key: 'travel.removeDialogConfirm', zh: '删除' },
  { key: 'travel.removeDialogBody', vars: { date: '2026-10-01' }, zh: '确认删除 2026-10-01 的行程卡？' },
  { key: 'travel.removeDialogFilled', vars: { summary: '交通「高铁 G1」' }, zh: '该日已填：交通「高铁 G1」。' },
  { key: 'travel.removeDialogIrreversible', zh: '删除后不可恢复' },
  { key: 'travel.removeDialogNote', zh: '（该日已排的任务不会被删除，只会回到「待排任务」）。' },
  { key: 'travel.loadFailed', zh: '每日行程加载失败。' },
  { key: 'travel.saveFailed', zh: '保存失败，请重试。' },
  { key: 'travel.invalidEndDate', zh: '请先设置有效的项目结束日期。' },
  { key: 'travel.addDayFailed', vars: { date: '2026-10-05' }, zh: '无法新增 2026-10-05 的每日行程卡。' },
  { key: 'travel.dayHasTasks', zh: '该日还有任务，请先移走或删除任务。' },
  { key: 'travel.removeFailed', zh: '删除行程卡失败，请重试。' },
];

const NEW_KEYS: readonly MessageKey[] = ZH_LITERALS.map((r) => r.key);

describe('① zh 取值锁（字面量表驱动；分段器判不了的短取值在这里判）', () => {
  it.each(ZH_LITERALS)('$key → «$zh»', ({ key, vars, zh }) => {
    expect(t(key, vars), `${key} 的 zh 取值变了（zh 逐字不变是硬线）`).toBe(zh);
  });

  it('收敛：整条删除确认文案由片段键**逐字拼回**（防「整句又抄一份」两份真相）', () => {
    const summary = [
      t('travel.summaryTransport', { value: '高铁 G1' }),
      t('travel.summaryBudget', { amount: '¥1,200' }),
    ].join(t('travel.summarySep'));
    expect(summary).toBe('交通「高铁 G1」、预算 ¥1,200');
    expect(t('travel.removeDialogBody', { date: '2026-10-01' })).toBe('确认删除 2026-10-01 的行程卡？');
  });

  it('「预算 / 实际」各只有一个键（汇总条标签与每日卡字段标签是同一个词）', () => {
    // 若有人给字段另造一个键，这条会因「同词两键」而暴露：两处取值必须逐字相同
    expect(catalogOf('zh')['travel.budget']).toBe('预算');
    expect(catalogOf('zh')['travel.actual']).toBe('实际');
    const zh = catalogOf('zh');
    const dup = Object.keys(zh).filter((k) => k.startsWith('travel.field') && k.endsWith('Budget'));
    expect(dup, '字段侧不许另造「预算」键').toEqual([]);
  });
});

/* ══════════════ ② 钩子换掉后的那半边 + 禁区登记 ══════════════ */
describe('② 钩子背后有人话 + 禁区（B）不许被翻', () => {
  const src = maskComments(read('src/components/travel/TravelItineraryPanel.tsx'));

  it('★ 每日卡删除钮：`data-itinerary-remove` 与 aria **成对**，且 aria 取消息表', () => {
    expect(src, '钩子没了？那这条断言是空的').toContain('data-itinerary-remove=""');
    expect(src, '挂钩子但 aria 没走消息表 ⇒ 读屏名成了硬编码').toMatch(
      /data-itinerary-remove=""[\s\S]{0,120}?t\('travel\.removeDayAria', \{ date: day\.date \}\)/,
    );
  });

  it('★ 禁区登记：`assignTask` 的 operatorName 必须**还是** `\'我\'`（B · 落库值）', () => {
    // 反面：有人「顺手把它翻掉」⇒ 库里会开始出现英文操作人，历史留痕随语言分叉
    expect(src, 'operatorName 被改成消息表取值了 —— 这是落库值（B），翻它会污染流水').toMatch(
      /assignTask[\s\S]{0,400}?updateTask\(taskId, \{ itineraryDate: date \}, '我'\)/,
    );
  });

  it('数据侧 `userMessage` 原样透传（不翻）：只在**没有**它时才用消息表兜底句', () => {
    /*
     * ⚠️ **换载体、不放松口径**（英文补齐批 · core 片的第二波）：本条原先锁的是**源码形状**
     *   `userMessage: unknown })?.userMessage) … : t('travel.loadFailed')` ——
     *   那是「鸭子类型分支」的写法。现在两处改走 core 的 `resolveErrorText(err, t, 兜底句)`，
     *   形状变了，**口径一字未松**：
     *     · 有机器码（core 已结构化）⇒ 取本地化文案；
     *     · 无机器码但有 `userMessage` ⇒ **原样透传**（数据层事实不被兜底句盖掉）；
     *     · 都没有 ⇒ 才用 `t('travel.loadFailed')`。
     *   ⇒ 故本条的**正判据从「源码形状」升级成「可执行行为」**（比原来更硬：
     *     形状可以被写成「看起来对」而实际分支错，行为断言不会）。
     */
    expect(src, '两处错误正文没走 core 的解析器（机理未接）').toMatch(
      /resolveErrorText\(err, t, t\('travel\.loadFailed'\)\)/,
    );
    expect(src, '追加一天那处的兜底句丢了').toMatch(
      /resolveErrorText\(err, t, t\('travel\.addDayFailed', \{ date: nextDate \}\)\)/,
    );

    // ★ 行为断言（换载体后新增的**比原来更硬**的那一条）：真因必须逐字回来
    const real = new ChangxiaError(ChangxiaErrorCode.Storage, '每日行程读取失败。');
    expect(
      resolveErrorText(real, t, t('travel.loadFailed')),
      '无机器码的真因被兜底句盖掉了 —— 渲染层改写了数据层事实',
    ).toBe('每日行程读取失败。');
    // 反向：没有真因时才轮到兜底句（否则上面那条会退化成「永远返回入参」的假绿）
    expect(resolveErrorText(new Error('boom'), t, t('travel.loadFailed'))).toBe(
      t('travel.loadFailed'),
    );

    /*
     * 反面判据要**窄**：不许把 `userMessage` 塞进任何 `t(...)` 实参里
     * （那等于让渲染层改写数据层事实 —— 文案会说「加载失败」而真实原因被吞掉）。
     * ⚠️ 第一版写成「`userMessage` 与 `t('travel.loadFailed')` 相距 <40 字」是**错的**：
     *   代码里 `userMessage)\n : t('travel.loadFailed')` 本来就只有十几个字符，
     *   那条负断言会把**正确写法**判红（当场被夹具抓到，故改成按 `t(` 的实参判）。
     */
    expect(src, '数据层文案被塞进了取词实参 ⇒ 渲染层改写了数据事实').not.toMatch(
      /\bt\([^)]*userMessage/,
    );
  });
});

/* ══════════════ ③ 消费锁：新键必须在 src 的活代码里被引用 ══════════════ */
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
  const code = srcFiles(join(rootDir, 'src'))
    .map((abs) => maskComments(readFileSync(abs, 'utf8')))
    .join('\n');

  it.each(NEW_KEYS)('%s 在 src/** 里出现为字面量', (key) => {
    expect(code.includes(`'${key}'`), `${key} 没有任何 src 消费方 ⇒ 死词条`).toBe(true);
  });
});
