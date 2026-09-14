/**
 * 阶段切分算法（架构 §3.3 实现规格，纯函数）：
 *   1. totalDays = diff(end,start)+1（含头尾）
 *   2. 按占比得每段理论天数（子集内归一化：ratioPercent / ratioTotal * 100）
 *   3. rounding 残差由【施工图深化】段（最大段）吸收 → Σ段长==totalDays、无缝连续
 *   4. pinned 锚点钉死对应段边界；两侧按剩余占比在「严格有序、不重叠、end>=start」
 *      约束下重切剩余天数
 *   5. 输出 StageDraft[]（status 恒 not_started），确认后才入库
 *
 * 阶段集合由 `SplitInput.stageItems` 决定（1 ≤ N ≤ 20，顺序即 orderIndex 1..N）；
 * **未传时回落到全量九段模板**，输出与「固定 9 阶段」版本逐字段一致（零回归锚点）。
 */

import type {
  StageDraft,
  StageOverride,
  StageSelectionItem,
  StageTemplateItem,
} from '../types/dto';
import { getTemplateStages } from './nine-stages';
import { legacyColorIndexOf, legacyTemplateKeyOf } from './stage-fallback';
import { ChangxiaError, ChangxiaErrorCode, ScheduleBasis, StageStatus } from '../types/enums';
import {
  DEFAULT_REST_POLICY,
  DEFAULT_SCHEDULE_BASIS,
  type RestPolicyConfig,
} from '../types/entities';
import { addWorkdays, countWorkdays } from '../../lib/workdays';
import { toIsoDate } from '../../lib/date';

/** 默认时间轴配色 index（阶段 s1..s9 token，从 1 起） */
export function stageColorIndex(orderIndex: number): number {
  return Math.min(Math.max(orderIndex, 1), 9);
}

/** 单次项目最少阶段数（0 段会让完成度、当前阶段、时间轴全部无定义） */
export const MIN_STAGE_COUNT = 1;

/**
 * 单次项目最多阶段数。
 *
 * v0.8：12 → 20。为什么能到 20：
 *   · 色板不再是 9 个死数——`Stage.customColor` 让用户可以给第 10 段起自己指定颜色，
 *     颜色重复不再是硬约束（T02 的 `palette-20` 亦把内置色扩到 20）；
 *   · 打印按 A4 高度估算分页（`paginateSections`），段数只影响页数，不会崩。
 * 代价（已知、接受）：20 段的时间轴在窄屏需要横向滚动——这是可读性问题，不是正确性问题。
 */
export const MAX_STAGE_COUNT = 20;

export interface SplitInput {
  startAt: string;
  endAt: string;
  overrides?: Partial<Record<number, StageOverride>>;
  /**
   * 本次服务包含的阶段项（顺序即 orderIndex 1..N，N ∈ [MIN_STAGE_COUNT, MAX_STAGE_COUNT]）。
   * 显式传空数组 / 超过 N 上限 → 抛 Validation。
   * **未传（undefined）→ 回落到 getTemplateStages() 全量九段**，行为与改造前完全一致。
   *
   * v0.8：元素类型放宽为 `StageSelectionItem`（＝模板项 ＋ 可选 `customColor`）。
   * 因 `customColor` 是可选字段，既有的 `StageTemplateItem[]` 入参仍然合法。
   */
  stageItems?: StageSelectionItem[];
  /** 排期基准：不传 → DEFAULT_SCHEDULE_BASIS（自然日）。Workday 时按休息制度跳过休息日切分。 */
  scheduleBasis?: ScheduleBasis;
  /** 公司休息制度：不传 → DEFAULT_REST_POLICY（双休）。仅 scheduleBasis=Workday 时消费。 */
  restPolicy?: RestPolicyConfig;
}

interface SegmentSpan {
  orderIndex: number;
  length: number; // 天数（含头尾）
}

/**
 * 残差吸收段：施工图深化（orderIndex=6，默认九段模板中最大占比段）。
 * 子集中不存在该段时，下方 `?? 最长段` 兜底自动接管——子集切分无需改这里。
 */
export const RESIDUAL_STAGE_INDEX = 6;

/** 第一步：初始化 span 为占比理论天数（至少 1 天），记录未取整残差 */
function initSpans(totalDays: number, ratios: Array<{ orderIndex: number; ratioPercent: number }>): {
  spans: SegmentSpan[];
} {
  let assigned = 0;
  const spans: SegmentSpan[] = ratios.map((r) => {
    const exact = (totalDays * r.ratioPercent) / 100;
    const len = Math.max(1, Math.floor(exact));
    assigned += len;
    return { orderIndex: r.orderIndex, length: len };
  });
  // 残差：全部塞给最大段（施工图深化）
  const residual = totalDays - assigned;
  if (residual !== 0) {
    const target =
      spans.find((s) => s.orderIndex === RESIDUAL_STAGE_INDEX) ??
      spans.reduce((a, b) => (b.length > a.length ? b : a));
    target.length += residual;
    if (target.length < 1) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `总工期过短，无法按所选 ${spans.length} 个阶段切分（各阶段至少 1 天）。请检查起止日期。`,
      );
    }
  }
  return { spans };
}

/** 校验：Σ长度 == totalDays */
function assertSum(spans: SegmentSpan[], totalDays: number): void {
  const sum = spans.reduce((acc, s) => acc + s.length, 0);
  if (sum !== totalDays) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `切分内部错误：阶段总天数 ${sum} ≠ 总工期 ${totalDays}`,
    );
  }
}

/** 把 spans 顺序展开为日期边界（startDayOffset 数组），返回每日偏移量边界 */
function spansToOffsets(spans: SegmentSpan[]): Array<{ orderIndex: number; startOff: number; endOff: number }> {
  let cursor = 0;
  return spans.map((s) => {
    const seg = { orderIndex: s.orderIndex, startOff: cursor, endOff: cursor + s.length - 1 };
    cursor += s.length;
    return seg;
  });
}

/**
 * pinned 重切（切割点求解法）：
 *   把九段之间的 n+1 个切割点视作未知量，锚点等价于「某切割点取固定值」；
 *   全部固定后，对连续未知区间内的相邻段按初始理论占比瓜分剩余天数。
 *   Σ守恒由构造保证；空间不足 / 锚点越界 / 互相矛盾时抛 Conflict。
 */
function applyPins(
  spans: SegmentSpan[],
  totalDays: number,
  pins: Map<number, { pinStart?: string; pinEnd?: string }>,
  baseStart: string,
  /** 日期 → 单位偏移（自然日口径 = 天偏移；工作日口径 = 工作日序号偏移）。不传走默认自然日。 */
  offsetOf?: (iso: string) => number,
): SegmentSpan[] {
  if (pins.size === 0) return spans;

  const MS_DAY = 86400000;
  const baseMs = new Date(`${baseStart}T00:00:00Z`).getTime();
  /** iso 日期 → 相对基准日的单位偏移（自然日口径为天偏移；工作日口径为工作日序号） */
  const off =
    offsetOf ??
    ((iso: string): number =>
      Math.round((new Date(`${iso}T00:00:00Z`).getTime() - baseMs) / MS_DAY));

  const conflict = (msg: string): ChangxiaError =>
    new ChangxiaError(ChangxiaErrorCode.Conflict, msg);

  /* ------------------ 1. 锚点 → 天偏移 + 越界校验 ------------------ */
  interface Pin {
    orderIndex: number;
    startOff?: number;
    endOff?: number;
  }
  const pinList: Pin[] = [];
  for (const [orderIndex, p] of pins.entries()) {
    const startOff = p.pinStart ? off(p.pinStart) : undefined;
    const endOff = p.pinEnd ? off(p.pinEnd) : undefined;
    if (
      (startOff !== undefined && (startOff < 0 || startOff >= totalDays)) ||
      (endOff !== undefined && (endOff < 0 || endOff >= totalDays))
    ) {
      throw conflict(`锚点开始日期超出项目工期范围（阶段 ${orderIndex}）。`);
    }
    pinList.push({ orderIndex, startOff, endOff });
  }

  /* -------------------- 2. 切割点初始化与固定 -------------------- */
  // cuts[i] = 第 i 段之后的独占边界（右开）：cuts[0]=0、cuts[n]=totalDays 恒定
  const n = spans.length;
  const orderToIdx = new Map<number, number>();
  spans.forEach((s, i) => orderToIdx.set(s.orderIndex, i));

  const cuts: Array<number | null> = new Array<number | null>(n + 1).fill(null);
  cuts[0] = 0;
  cuts[n] = totalDays;
  for (const p of pinList) {
    const idx = orderToIdx.get(p.orderIndex);
    if (idx === undefined) continue;
    const setCut = (pos: number, val: number): void => {
      if (cuts[pos] !== null && cuts[pos] !== val) {
        throw conflict('锚点钉住后无法满足总工期约束：请核对锚点日期是否落在工期内且互不矛盾。');
      }
      cuts[pos] = val;
    };
    if (p.startOff !== undefined) setCut(idx, p.startOff); // 段起点 → 左侧切割点
    if (p.endOff !== undefined) setCut(idx + 1, p.endOff + 1); // 段终点（含）→ 右侧切割点
  }

  /* ---------------------- 3. 已固定点单调性校验 --------------------- */
  let prevBound = -1;
  for (let i = 0; i <= n; i += 1) {
    const v = cuts[i];
    if (v !== null) {
      if (v < prevBound) {
        throw conflict('锚点钉住后无法满足总工期约束：请核对锚点日期是否落在工期内且互不矛盾。');
      }
      prevBound = v;
    }
  }

  /* ------------- 4. 连续未知区间：两侧界内段按占比瓜分 -------------- */
  /** 比例瓜分：每人先保底 1 天，剩余天数按权重最大余数法分配（Σ恒等于 room） */
  const splitProportional = (room: number, weights: number[], firstOrderIndex: number): number[] => {
    const cnt = weights.length;
    if (room < cnt) {
      throw conflict(
        `锚点重切后空间不足（阶段 ${firstOrderIndex} 起的连续段落至少各需 1 天）。请调整锚点或总工期。`,
      );
    }
    const out = new Array<number>(cnt).fill(1);
    const remain = room - cnt;
    const wSum = weights.reduce((a, b) => a + b, 0);
    if (remain <= 0 || wSum <= 0) return out;
    const extras = weights.map((w) => Math.floor((remain * w) / wSum));
    let used = extras.reduce((a, b) => a + b, 0);
    // 最大余数法：把未分完的天数给小数部分最大的段
    const byFracDesc = weights
      .map((w, i) => ({ i, frac: (remain * w) / wSum - extras[i] }))
      .sort((a, b) => b.frac - a.frac);
    let p = 0;
    while (used < remain) {
      extras[byFracDesc[p % cnt].i] += 1;
      used += 1;
      p += 1;
    }
    return out.map((v, i2) => v + extras[i2]);
  };

  let i = 0;
  while (i <= n) {
    if (cuts[i] !== null) {
      i += 1;
      continue;
    }
    // 找出极大未知游程 [i, j)
    let j = i;
    while (j <= n && cuts[j] === null) j += 1;
    const L = cuts[i - 1] as number; // i>=1：cuts[0] 恒定，左界必已知
    const R = cuts[j] as number; // j<=n：cuts[n] 恒定，右界必已知
    // 受影响段：两侧切点都落在未知游程内的段，下标 [i-1, j-1]
    const group: number[] = [];
    for (let k = i - 1; k <= j - 1; k += 1) group.push(k);
    const shares = splitProportional(
      R - L,
      group.map((k) => spans[k].length),
      spans[group[0]].orderIndex,
    );
    let cursor = L;
    group.forEach((k, gi) => {
      spans[k].length = shares[gi];
      cuts[i + gi] = cursor + shares[gi];
      cursor += shares[gi];
    });
    i = j;
  }

  /* ------------------- 5. 由切割点反推各段长度 -------------------- */
  return spans.map((s, k) => ({
    orderIndex: s.orderIndex,
    length: (cuts[k + 1] as number) - (cuts[k] as number),
  }));
}

/** 切分用的阶段视图（子集与全量模板的统一内部形状） */
interface SplitStage {
  orderIndex: number;
  name: string;
  ratioPercent: number;
  defaultTasks: string[];
  templateKey: string | null;
  colorIndex: number;
  /** v0.8 用户自定义主色；null = 用 colorIndex 的内置色 */
  customColor: string | null;
}

/**
 * 阶段集合解析：
 *   - 传了 stageItems → 按数组顺序重编号为 1..N（项目内必须连续无空缺）；
 *   - 未传 → 回落全量九段模板（name/ratioPercent/defaultTasks 逐字段不变，零回归锚点）。
 */
function resolveSplitStages(stageItems: StageSelectionItem[] | undefined): SplitStage[] {
  if (stageItems === undefined) {
    return getTemplateStages().map((s) => ({
      orderIndex: s.orderIndex,
      name: s.name,
      ratioPercent: s.ratioPercent,
      defaultTasks: s.defaultTasks,
      // 老数据口径：9 段一一对应 indoor_full 套餐，色号 == orderIndex
      templateKey: legacyTemplateKeyOf(s.orderIndex),
      colorIndex: legacyColorIndexOf(s.orderIndex),
      // 回落路径 = 「改造前的九段」，用户没机会指定颜色 ⇒ 恒 null（零回归锚点）
      customColor: null,
    }));
  }
  if (stageItems.length < MIN_STAGE_COUNT) {
    throw new ChangxiaError(ChangxiaErrorCode.Validation, '请至少选择 1 个阶段。');
  }
  if (stageItems.length > MAX_STAGE_COUNT) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `单次项目最多 ${MAX_STAGE_COUNT} 个阶段，当前已选 ${stageItems.length} 个。`,
    );
  }
  return stageItems.map((item, idx) => ({
    orderIndex: idx + 1,
    name: item.name,
    ratioPercent: item.ratioPercent,
    defaultTasks: item.defaultTasks,
    templateKey: item.key,
    colorIndex: stageColorIndex(item.colorIndex),
    // 用户色随选中项带入草稿（自定义阶段 / 取色器指定）；未指定 → null（内置色）
    customColor: item.customColor ?? null,
  }));
}

/**
 * 主入口：previewSplit —— 向导第三步展示的就是本函数输出。
 */
export function previewSplit(input: SplitInput): StageDraft[] {
  const { startAt, endAt, overrides } = input;
  const basis = input.scheduleBasis ?? DEFAULT_SCHEDULE_BASIS;
  const policy = input.restPolicy ?? DEFAULT_REST_POLICY;
  const useWorkday = basis === ScheduleBasis.Workday;

  const startDate = toIsoDate(startAt);
  const endDate = toIsoDate(endAt);
  if (!startDate || !endDate) {
    throw new ChangxiaError(ChangxiaErrorCode.Validation, '项目起止日期无效。');
  }
  const startD = new Date(`${startDate}T00:00:00Z`);
  const endD = new Date(`${endDate}T00:00:00Z`);
  if (endD.getTime() < startD.getTime()) {
    throw new ChangxiaError(ChangxiaErrorCode.Validation, '截止日期早于开始日期。');
  }

  // 总单位数：自然日口径 = 自然日天数；工作日口径 = 区间内工作日数（含头尾，跳过休息日）
  const totalUnits = useWorkday
    ? countWorkdays(startDate, endDate, policy)
    : Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1;
  if (totalUnits < 1) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      useWorkday
        ? '该工期范围内没有任何工作日，无法按工作日排期。请调整起止日期或休息制度。'
        : '项目起止日期无效。',
    );
  }

  const templateStages = resolveSplitStages(input.stageItems);
  // 子集内归一化：ratioPercent / ratioTotal * 100（沿用既有逻辑，删段后无需手调占比）
  const ratios = templateStages.map((s) => ({
    orderIndex: s.orderIndex,
    ratioPercent: overrides?.[s.orderIndex]?.ratioPercent ?? s.ratioPercent,
  }));
  const ratioTotal = ratios.reduce((acc, r) => acc + r.ratioPercent, 0);
  if (ratioTotal <= 0) {
    throw new ChangxiaError(ChangxiaErrorCode.Validation, '阶段占比合计必须大于 0。');
  }

  let spans = initSpans(
    totalUnits,
    ratios.map((r) => ({ ...r, ratioPercent: (r.ratioPercent / ratioTotal) * 100 })),
  ).spans;

  // pinned 锚点收集（显式传 null 表示无 pin）
  const pins = new Map<number, { pinStart?: string; pinEnd?: string }>();
  for (const s of templateStages) {
    const ov = overrides?.[s.orderIndex];
    if (!ov) continue;
    const pinStart = ov.pinnedStartAt ? toIsoDate(ov.pinnedStartAt) : undefined;
    const pinEnd = ov.pinnedEndAt ? toIsoDate(ov.pinnedEndAt) : undefined;
    if (pinStart ?? pinEnd) {
      pins.set(s.orderIndex, { pinStart: pinStart ?? undefined, pinEnd: pinEnd ?? undefined });
    }
  }
  // 工作日口径下锚点日期 → 工作日序号偏移。
  // 休息日锚点自然吸附到之前的工作日（countWorkdays 只数工作日，不含休息日本身）。
  const offsetOf = useWorkday
    ? (iso: string): number => countWorkdays(startDate, iso, policy) - 1
    : undefined;
  spans = applyPins(spans, totalUnits, pins, startDate, offsetOf);
  assertSum(spans, totalUnits);

  const offsets = spansToOffsets(spans);

  // 组装 StageDraft（visible 覆写支持隐藏交付段个案）
  return offsets.map((seg) => {
    const tpl = templateStages.find((s) => s.orderIndex === seg.orderIndex);
    const ov = overrides?.[seg.orderIndex];
    return {
      orderIndex: seg.orderIndex,
      // 键序铁律：与 Stage 实体 / stageSchema / project.service stageRows 四处一致
      templateKey: tpl?.templateKey ?? null,
      colorIndex: tpl?.colorIndex ?? stageColorIndex(seg.orderIndex),
      // v0.8：用户自定义主色随草稿下传（null = 用内置色）。漏这一行 = 静默丢色。
      customColor: tpl?.customColor ?? null,
      name: ov?.name ?? tpl?.name ?? `阶段 ${seg.orderIndex}`,
      ratioPercent: ov?.ratioPercent ?? tpl?.ratioPercent ?? 0,
      startAt: useWorkday
        ? addWorkdays(startDate, seg.startOff, policy)
        : addDaysIso(startDate, seg.startOff),
      endAt: useWorkday
        ? addWorkdays(startDate, seg.endOff, policy)
        : addDaysIso(startDate, seg.endOff),
      status: StageStatus.NotStarted as StageStatus,
      ownerId: null,
      visible: ov?.visible ?? true,
      resourcePath: null,
      defaultTasks: tpl?.defaultTasks ?? [],
    } satisfies StageDraft;
  });
}

/** 用 UTC 加法做安全的天数偏移（避免本地时区越界问题） */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 按「每阶段时长顺延」正向推算竣工日期（图5：手动建档阶段池自定义时长自动算竣工）。
 *
 * 与占比较劈分 `previewSplit` 方向相反：
 *   - previewSplit：给定 start+end → 按占比把总工期切给各阶段；
 *   - computeEndAtByDurations：给定 start + 每阶段天数 → 逐个顺延 → 得 end。
 *
 * 输入 `items` 携带每阶段 `durationDays`（可选，缺失回退 `ratioPercent` 归一化兜底天数）；
 * 按 scheduleBasis 决定自然日/工作日顺延（Workday 跳过休息日）。
 *
 * @returns 顺延后的竣工日期（ISO 'YYYY-MM-DD'），以及每阶段实际边界（用于回显）。
 */
export function computeEndAtByDurations(
  startAt: string,
  items: StageTemplateItem[],
  basis: ScheduleBasis = DEFAULT_SCHEDULE_BASIS,
  policy: RestPolicyConfig = DEFAULT_REST_POLICY,
): { endAt: string; spans: Array<{ orderIndex: number; startAt: string; endAt: string; days: number }> } {
  const startDate = toIsoDate(startAt);
  if (!startDate) {
    throw new ChangxiaError(ChangxiaErrorCode.Validation, '开始日期无效。');
  }
  if (items.length === 0) {
    throw new ChangxiaError(ChangxiaErrorCode.Validation, '请至少选择 1 个阶段。');
  }
  const useWorkday = basis === ScheduleBasis.Workday;

  // 已选占比合计（用于缺失天数时的归一化兜底）
  const ratioTotal = items.reduce((acc, it) => acc + (it.ratioPercent || 0), 0);
  const nd = items.length;

  let cursor = startDate;
  const spans: Array<{ orderIndex: number; startAt: string; endAt: string; days: number }> = [];

  for (let i = 0; i < nd; i += 1) {
    const item = items[i]!;
    // 天数：优先用户填的 durationDays；缺失时按占比归一化成「整数天（至少 1）」
    let days = Number.isFinite(item.durationDays) && (item.durationDays ?? 0) > 0
      ? Math.max(1, Math.round(item.durationDays as number))
      : Math.max(1, Math.round((ratioTotal > 0 ? (item.ratioPercent / ratioTotal) * 100 : 100 / nd)));
    // 单位口径换算：Workday 下 days 是「工作日数」，需把结束日也算进来（含头尾）
    let stageStart = cursor;
    let stageEnd: string;
    if (useWorkday) {
      // 顺延 days 个工作日：从 stageStart 加 (days-1) 个工作日得到结束日（含头尾）
      stageEnd = addWorkdays(stageStart, Math.max(0, days - 1), policy);
      // 下一阶段从 stageEnd 的下一个工作日开始
      cursor = addWorkdays(stageEnd, 1, policy);
    } else {
      stageEnd = addDaysIso(stageStart, days - 1);
      cursor = addDaysIso(stageStart, days);
    }
    spans.push({ orderIndex: i + 1, startAt: stageStart, endAt: stageEnd, days });
  }

  return { endAt: spans[spans.length - 1]!.endAt, spans };
}
