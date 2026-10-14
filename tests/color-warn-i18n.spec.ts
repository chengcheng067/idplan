// @vitest-environment jsdom
/**
 * core 片 · 色板派生警告的**语言契约**（英文补齐批 · 段 5 之二）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这条链（与 `core-error-i18n.spec.ts` 同款，缺一段就是假绿）
 * ══════════════════════════════════════════════════════════════════════
 *   ① core 造警告：`warn(code, messageKey, params)`
 *      ⇒ `message` 由 `CORE_WARN_TEXT` 渲染（**载荷口径**，逐字节不变）
 *      ⇒ 同时在警告上挂 `messageKey` / `params`（机器可读）
 *   ② 渲染层：`StageColorPicker` 用 `t(w.messageKey, w.params)` 取**界面口径**
 *      （core 不许 import i18n，故取词只在渲染层发生）
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 为什么文案句柄是**键**而不是 `code`（本文件存在的第一个理由）
 * ══════════════════════════════════════════════════════════════════════
 * `DeriveWarningCode` 是**四码冻结联合**（`derive-stage-colors.ts:113` 明写「不要新增第 5 个码，
 * 否则 T03 的穷尽分支会编译失败」），而 8 处告警**挤在 4 个码上** —— `low-band-contrast`
 * 一个码覆盖 **3 条完全不同**的文案。拿 `code` 当句柄 ⇒ 那三处必然查到同一句，界面**静默印错话**。
 * ⇒ `code` 一字不动（留给穷尽分支与既有 `tests/stage-color-derive.spec.ts` 的四码断言），
 *   另设 `messageKey`。**所以本文件必须同时钉住「码没动」与「键各不同」。**
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 实测可达性台账（本文件存在的第二个理由，也是本笔最该被复核的一条）
 * ══════════════════════════════════════════════════════════════════════
 * 8 个键里，**只有 3 个**能从唯一的生产入口 `deriveAndValidate()` 真的产出：
 *
 *   探针：全立方 step 3（86³ = 635,976）+ 全 256 级灰阶 + 7 个非法串 = **636,319 个输入**
 *   ```
 *   REACHABLE [["colorWarn.mainChromaTooLow","#000000"],
 *              ["colorWarn.mainInvisibleOnLight","#00EAF0"],
 *              ["colorWarn.badMainHex",""]]                  ← 非法串才命中
 *   COUNTS    [["colorWarn.mainChromaTooLow",4874],
 *              ["colorWarn.mainInvisibleOnLight",68607],
 *              ["colorWarn.badMainHex",6]]
 *   ```
 *   ⇒ 另外 **5 条**（`solidInvisibleOnDark` / `lightBandTextLow` / `forcedBandShift` /
 *     `darkBandTextLow` / `unresolvableTriple`）**在这批输入下一次都没出现**。
 *
 * ⚠️ **「未找到触发输入」≠「不可达」** —— 这 5 条是**搜索穷尽型兜底**
 * （R2 的 9 档叠白走到底、E1 的回退搜索走到底才会命中），其中 `forcedBandShift`
 * 另有既有文档判据（同目录 spec 的 I-05：「`resolveDarkBand` 的 shifted 分支在真实色上不可达
 * （H-02 已穷举证明）」）。本文件把它记为**「本次未观测到」**，不记为「死代码」。
 *
 * ⇒ 这条台账的用处：把这 5 条**机器化**成断言（⑤）。将来任何颜色数学放宽使它们真的可触发时，
 *   **这里先红**（而不是等用户在界面上第一次看见一条**从没被核过英文**的中文警告）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 判据：`key={w.code}` 那条防御的「牙齿」（本文件存在的第三个理由）
 * ══════════════════════════════════════════════════════════════════════
 * `StageColorPicker` 原来用 `key={w.code}`。同码重复会让 React 复用/合并兄弟节点。
 * **但实测（636,319 输入）同码重复 0 例** ⇒ 它现在不重复是**颜色数学的巧合**，不是契约：
 * 三处 `low-band-contrast` 的触发条件在实践中互斥。故：
 *   · `key` 已改 `messageKey`（逐处唯一）—— 本笔同改；
 *   · 本文件 ⑥ 把「同码不重复」钉成**显式不变式** ⇒ 巧合变成被检查的性质。
 * ⚠️ 不许把 ⑥ 写成「未来一定会重复」—— 现在**没有**观测到重复，如实记。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { setLang, t } from '../src/i18n';
import {
  CORE_WARN_TEXT,
  coreWarnText,
  type CoreWarnKey,
} from '../src/core/types/core-error-text';
import { en as coreEn, zh as coreZh } from '../src/i18n/messages/parts/core';
import {
  deriveAndValidate,
  type DeriveWarningCode,
} from '../src/core/color/derive-stage-colors';

/** 基准来源：改动前 `src/core/color/derive-stage-colors.ts` 的最后一次改动是 `2ad6ac6`，
 *  取 HEAD（`dcbac8a`）为准；下面每条的 `template` 都是**从那份源码逐字手抄**的。 */
const BASELINE_SHA = 'dcbac8a';

interface WarnBaseline {
  /** 改动前的 `code`（**不许变**：既有四码断言与 T03 穷尽分支都靠它） */
  code: DeriveWarningCode;
  /** 改动前那句**模板**逐字手抄；源码里的 `${expr}` 在表里写作 `{name}` */
  template: string;
  /** 样例参数。**取值形态照告警点**：`toFixed` 的结果是 string；`raw` 连引号一起传 */
  params?: Record<string, string | number>;
  /** 上面那组参数在**改动前**的实现下渲染出的那句（逐字） */
  rendered: string;
  /** 实测能产出这条告警的输入；`null` = 636,319 个输入里一次都没出现（见文件头台账） */
  reachableBy: string | null;
}

const BASELINE: Record<CoreWarnKey, WarnBaseline> = {
  /* 改动前：`主色 ${JSON.stringify(String(mainHex))} 不是合法颜色（期望 #RRGGBB），已按 ${INK} 兜底；请重新取色。` */
  'colorWarn.badMainHex': {
    code: 'unresolvable',
    template: '主色 {raw} 不是合法颜色（期望 #RRGGBB），已按 {ink} 兜底；请重新取色。',
    // ⚠️ `raw` 必须**连双引号**：旧式是 `JSON.stringify(...)` ⇒ 渲染结果带引号
    params: { raw: '"not-a-color"', ink: '#111318' },
    rendered: '主色 "not-a-color" 不是合法颜色（期望 #RRGGBB），已按 #111318 兜底；请重新取色。',
    reachableBy: 'not-a-color',
  },
  /* 改动前：`主色彩度过低（C*=${chroma.toFixed(1)} < ${NEUTRAL_CHROMA_MIN}）：…` */
  'colorWarn.mainChromaTooLow': {
    code: 'low-band-contrast',
    template:
      '主色彩度过低（C*={chroma} < {min}）：派生的阶段色与界面中性色（墨色/边框/灰底）属同一视觉层级，时间轴与月历上难以识别；建议换一个有色相的色。',
    // `#FFFFFF` 的 chroma = 0 ⇒ `toFixed(1)` = `"0.0"`；`NEUTRAL_CHROMA_MIN` = 6
    params: { chroma: '0.0', min: 6 },
    rendered:
      '主色彩度过低（C*=0.0 < 6）：派生的阶段色与界面中性色（墨色/边框/灰底）属同一视觉层级，时间轴与月历上难以识别；建议换一个有色相的色。',
    reachableBy: '#FFFFFF',
  },
  /* 改动前：`主色在亮色底上不可见（对比度 ${onLight.toFixed(2)} < ${CONTRAST_WARN_MAIN_ON_PAGE}）；建议同色相加深。` */
  'colorWarn.mainInvisibleOnLight': {
    code: 'low-page-contrast',
    template: '主色在亮色底上不可见（对比度 {ratio} < {min}）；建议同色相加深。',
    // `#FFFFFF` 对白底：contrast = 1 ⇒ `toFixed(2)` = `"1.00"`；阈值 = 1.5
    params: { ratio: '1.00', min: 1.5 },
    rendered: '主色在亮色底上不可见（对比度 1.00 < 1.5）；建议同色相加深。',
    reachableBy: '#FFFFFF',
  },
  /* 改动前：`派生出的实心块（暗色主题用 lightBar）在暗色底上不可见（对比度 ${solidOnDark.toFixed(2)} < ${CONTRAST_WARN_MAIN_ON_PAGE}）；建议同色相变浅或加深。` */
  'colorWarn.solidInvisibleOnDark': {
    code: 'low-page-contrast',
    template:
      '派生出的实心块（暗色主题用 lightBar）在暗色底上不可见（对比度 {ratio} < {min}）；建议同色相变浅或加深。',
    params: { ratio: '1.20', min: 1.5 },
    rendered:
      '派生出的实心块（暗色主题用 lightBar）在暗色底上不可见（对比度 1.20 < 1.5）；建议同色相变浅或加深。',
    reachableBy: null,
  },
  /* 改动前：`亮色色带上的文字对比度不足（${lightContrast.toFixed(2)} < ${TEXT_MIN_CONTRAST}），即使走完 R2 的全部叠白档位仍无解；建议换主色。` */
  'colorWarn.lightBandTextLow': {
    code: 'low-band-contrast',
    template:
      '亮色色带上的文字对比度不足（{ratio} < {min}），即使走完 R2 的全部叠白档位仍无解；建议换主色。',
    params: { ratio: '4.49', min: 4.5 },
    rendered:
      '亮色色带上的文字对比度不足（4.49 < 4.5），即使走完 R2 的全部叠白档位仍无解；建议换主色。',
    reachableBy: null,
  },
  /* 改动前：`暗色色带偏离了 R5 原生规则（改用比例 ${DARK_BAND_FALLBACK_SEARCH.join('/')} 中的另一档）以满足文字对比度 ≥ ${TEXT_MIN_CONTRAST}。` */
  'colorWarn.forcedBandShift': {
    code: 'forced-band-shift',
    template: '暗色色带偏离了 R5 原生规则（改用比例 {ratios} 中的另一档）以满足文字对比度 ≥ {min}。',
    // `DARK_BAND_FALLBACK_SEARCH.join('/')` 的字面结果；`TEXT_MIN_CONTRAST` = 4.5
    params: { ratios: '0.58/0.65/0.72/0.80', min: 4.5 },
    rendered: '暗色色带偏离了 R5 原生规则（改用比例 0.58/0.65/0.72/0.80 中的另一档）以满足文字对比度 ≥ 4.5。',
    reachableBy: null,
  },
  /* 改动前：`暗色色带上的文字对比度不足（${darkContrast.toFixed(2)} < ${TEXT_MIN_CONTRAST}），E1 回退搜索亦无解；请换主色（不建议落库半成品）。` */
  'colorWarn.darkBandTextLow': {
    code: 'low-band-contrast',
    template:
      '暗色色带上的文字对比度不足（{ratio} < {min}），E1 回退搜索亦无解；请换主色（不建议落库半成品）。',
    params: { ratio: '4.49', min: 4.5 },
    rendered:
      '暗色色带上的文字对比度不足（4.49 < 4.5），E1 回退搜索亦无解；请换主色（不建议落库半成品）。',
    reachableBy: null,
  },
  /* 改动前是**单引号普通串**（没有插值）：'该主色无法派生出「亮/暗两套都达标」的三层令牌；请改用其它主色。' */
  'colorWarn.unresolvableTriple': {
    code: 'unresolvable',
    template: '该主色无法派生出「亮/暗两套都达标」的三层令牌；请改用其它主色。',
    rendered: '该主色无法派生出「亮/暗两套都达标」的三层令牌；请改用其它主色。',
    reachableBy: null,
  },
};

const KEYS = Object.keys(BASELINE) as CoreWarnKey[];

/** 实测可达的键（见文件头台账）；⑤ 把它与「扫出来的集合」比 */
const REACHABLE_KEYS: readonly CoreWarnKey[] = [
  'colorWarn.badMainHex',
  'colorWarn.mainChromaTooLow',
  'colorWarn.mainInvisibleOnLight',
];
/** 非法主色串（`badMainHex` 只从这里命得中） */
const MALFORMED = ['', 'not-a-color', '#12', '#1234567', 'rgb(1,2,3)', '#GGGGGG', '12AB34'];

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const zhTable = coreZh as Record<string, string>;
const enTable = coreEn as Record<string, string>;

let prev: string;
beforeEach(() => {
  prev = 'zh';
  setLang('zh');
});
afterEach(() => setLang('zh'));

describe('色板警告 · ① 三表不漂（载荷表 / 分片 zh / 分片 en）', () => {
  it('★ 键集两两相等，且与本文件的基准表逐键对齐', () => {
    // 判据与 `core-error-i18n.spec.ts` ① 同款、同一次收窄：本分片同时承载三个命名空间
    // （`coreErr.*` / `colorWarn.*` / `plugin.*`），故按**本表的前缀**取分片侧键集。
    // 强度不变：两侧一处增一处漏都红。
    const shardWarnKeys = Object.keys(zhTable)
      .filter((k) => k.startsWith('colorWarn.'))
      .sort();
    expect(Object.keys(CORE_WARN_TEXT).sort(), '载荷表与分片 zh 的 colorWarn.* 键集不一致').toEqual(
      shardWarnKeys,
    );
    expect(KEYS.slice().sort(), 'BASELINE 与载荷表键集不一致').toEqual(Object.keys(CORE_WARN_TEXT).sort());
    expect(Object.keys(enTable).filter((k) => k.startsWith('colorWarn.')).sort()).toEqual(
      Object.keys(CORE_WARN_TEXT).sort(),
    );
  });

  it('★ zh 取值逐字相等：载荷表 === 分片 zh', () => {
    for (const key of KEYS) {
      expect(zhTable[key], `${key} 的两处中文不一致`).toBe(CORE_WARN_TEXT[key]);
    }
  });

  it('★ 8 条警告的 `code` 仍是四码冻结联合里的值（`code` 一字不动是本笔的硬约束）', () => {
    const frozen: readonly DeriveWarningCode[] = [
      'low-page-contrast',
      'low-band-contrast',
      'forced-band-shift',
      'unresolvable',
    ];
    for (const key of KEYS) expect(frozen, `${key} 的 code 漂了`).toContain(BASELINE[key].code);
  });

  it('★ 一个键一条文案：3 处 `low-band-contrast` 各有各的键（码不够用，这正是本笔的动因）', () => {
    const bandKeys = KEYS.filter((k) => BASELINE[k].code === 'low-band-contrast');
    expect(bandKeys.length, 'low-band-contrast 应覆盖 3 条不同文案').toBe(3);
    // 码相同但模板必须两两不同 —— 否则「3 处 push 共用一句」就不需要新键了
    const templates = new Set(bandKeys.map((k) => BASELINE[k].template));
    expect(templates.size).toBe(3);
  });
});

describe('色板警告 · ② 载荷逐字节不变（基准手抄自改动前的实现，不是重算）', () => {
  it.each(KEYS)('★ %s：模板与改动前那句逐字节相等', (key) => {
    expect(CORE_WARN_TEXT[key]).toBe(BASELINE[key].template);
  });

  it.each(KEYS)('★ %s：渲染结果与改动前那句逐字节相等', (key) => {
    expect(coreWarnText(key, BASELINE[key].params)).toBe(BASELINE[key].rendered);
  });

  it('★ 不传 params 时占位符**原样保留**（与 `t()` 同口径：漏传变量要看得见）', () => {
    expect(coreWarnText('colorWarn.mainChromaTooLow')).toBe(BASELINE['colorWarn.mainChromaTooLow'].template);
  });

  it(`★ 基准来源可追溯：改动前那份源码在 ${BASELINE_SHA}`, () => {
    // 这条不是形式：`git log --oneline -1 -- src/core/color/derive-stage-colors.ts` 的输出
    // 就是 `2ad6ac6`，而 HEAD 是 `dcbac8a` ⇒ 基准取自 HEAD 的源码内容
    expect(BASELINE_SHA).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('色板警告 · ③ 英文真能取到（防假绿）', () => {
  it.each(KEYS)('★ %s：zh 取到与载荷逐字相同的中文；en 取到不含汉字的英文', (key) => {
    const { params } = BASELINE[key];

    setLang('zh');
    expect(t(key, params), `${key} 的 zh 取值必须等于载荷口径`).toBe(BASELINE[key].rendered);

    setLang('en');
    const english = t(key, params);
    expect(english.length).toBeGreaterThan(0);
    expect(english, `${key} 在英文下仍给中文`).not.toMatch(CJK);
    if (params !== undefined) {
      expect(english, `${key} 的英文里还留着占位符`).not.toMatch(/\{\w+\}/);
      for (const [name, value] of Object.entries(params)) {
        expect(english, `${key} 的英文里没出现参数 ${name}`).toContain(String(value));
      }
    }
  });

  it('★ 占位符两侧一致（载荷模板有 `{name}` ⇒ 英文也得有）', () => {
    const holders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    for (const key of KEYS) {
      expect(holders(enTable[key] ?? ''), `${key} 的占位符两侧不一致`).toEqual(
        holders(CORE_WARN_TEXT[key]),
      );
    }
  });
});

describe('色板警告 · ④ 真实调用点（core 侧产出，渲染层取词）', () => {
  it('★ `#FFFFFF` ⇒ 恰好两条：彩度过低 + 亮底不可见，且与基准逐字一致', () => {
    const ws = deriveAndValidate('#FFFFFF').warnings;
    expect(ws.map((w) => w.messageKey)).toEqual([
      'colorWarn.mainChromaTooLow',
      'colorWarn.mainInvisibleOnLight',
    ]);
    expect(ws[0]).toMatchObject({
      code: 'low-band-contrast',
      message: BASELINE['colorWarn.mainChromaTooLow'].rendered,
    });
    expect(ws[1]).toMatchObject({
      code: 'low-page-contrast',
      message: BASELINE['colorWarn.mainInvisibleOnLight'].rendered,
    });
  });

  it('★ 非法主色 ⇒ 载荷里那句**带双引号**（`JSON.stringify` 的形态没丢）', () => {
    const ws = deriveAndValidate('not-a-color').warnings;
    const bad = ws.find((w) => w.messageKey === 'colorWarn.badMainHex');
    expect(bad).toBeDefined();
    expect(bad!.params).toEqual({ raw: '"not-a-color"', ink: '#111318' });
    expect(bad!.message).toBe(BASELINE['colorWarn.badMainHex'].rendered);
    expect(bad!.message).toContain('"not-a-color"');
  });

  it('★ `warn()` 的两半从不分叉：每条真实警告的 `message` 恒等于 `coreWarnText(messageKey, params)`', () => {
    for (const hex of ['#FFFFFF', '#000000', '#808080', 'not-a-color', '#FFF2D6', '#E0FFB7', '#FFD16B']) {
      for (const w of deriveAndValidate(hex).warnings) {
        expect(w.message, `${hex} 的 ${w.messageKey}`).toBe(coreWarnText(w.messageKey, w.params));
      }
    }
  });

  it('★ 合规主色零警告（这条保证上面几条不是「凡输入都出警告」）', () => {
    expect(deriveAndValidate('#215452').warnings).toEqual([]);
  });

  it('★ 英文界面下这三条真的变英文（端到端：core 产出 ⇒ `<li>` 里印的东西）', () => {
    setLang('en');
    const ws = deriveAndValidate('#FFFFFF').warnings;
    for (const w of ws) {
      const printed = t(w.messageKey, w.params);
      expect(printed).not.toMatch(CJK);
      expect(printed, '界面口径不该等于载荷口径（否则等于没翻）').not.toBe(w.message);
    }
  });
});

describe('色板警告 · ⑤ 可达性台账：8 键里只有 3 键能从生产入口产出', () => {
  /** 快扫（常驻不能用 636,319 点那次的规模）：全立方 step 17 + 全灰阶 step 17 + 非法串 */
  function scan(): CoreWarnKey[] {
    const seen = new Set<CoreWarnKey>();
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
          for (const w of deriveAndValidate(hex).warnings) seen.add(w.messageKey);
        }
      }
    }
    for (const bad of MALFORMED) {
      for (const w of deriveAndValidate(bad).warnings) seen.add(w.messageKey);
    }
    return [...seen].sort();
  }

  it(`★ 实测可达集 === 登记的三键（${REACHABLE_KEYS.length}）；其余 5 键**本次未观测到**`, () => {
    expect(scan()).toEqual(REACHABLE_KEYS.slice().sort());
  });

  it('★ 台账与基准表互不矛盾：标 `reachableBy` 的都在可达集里，标 `null` 的都不在', () => {
    const reachable = scan();
    for (const key of KEYS) {
      const recorded = BASELINE[key].reachableBy;
      if (recorded === null) {
        expect(reachable, `${key} 标着「未观测到」却又被扫出来了`).not.toContain(key);
      } else {
        expect(reachable, `${key} 标着可达却没被扫出来`).toContain(key);
        // 登记的输入必须**真的**能产出这条（不是随手填的）
        expect(
          deriveAndValidate(recorded).warnings.map((w) => w.messageKey),
          `登记输入 ${recorded} 产不出 ${key}`,
        ).toContain(key);
      }
    }
  });
});

describe('色板警告 · ⑥ 「同码不重复」不变式（`key={w.code}` 那条防御的牙齿）', () => {
  it('★ 实测：任何输入下，一次派生结果里不出现重复的 `code`', () => {
    // ⚠️ 现在成立是**颜色数学的巧合**（三处 low-band-contrast 的触发条件互斥），**不是契约**。
    //    把它钉成不变式 ⇒ 将来任一处条件放宽 / 新增第 9 处 push 用了同一个码时，这里先红，
    //    而不是等 React 把两条并成一条、用户少看一条提示。
    const offenders: string[] = [];
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
          const codes = deriveAndValidate(hex).warnings.map((w) => w.code);
          if (codes.length !== new Set(codes).size) offenders.push(hex);
        }
      }
    }
    for (const bad of MALFORMED) {
      const codes = deriveAndValidate(bad).warnings.map((w) => w.code);
      if (codes.length !== new Set(codes).size) offenders.push(bad);
    }
    expect(offenders, '出现同码重复 —— `StageColorPicker` 的 `key` 虽已改 messageKey，但仍需复核这条').toEqual([]);
  });

  it('★ 反向自证：判据不是恒真 —— 手工构造同码两条时它必须能认出来', () => {
    const dup = [{ code: 'low-band-contrast' }, { code: 'low-band-contrast' }];
    const codes = dup.map((w) => w.code);
    expect(codes.length).not.toBe(new Set(codes).size);
  });

  it('★ `messageKey` 逐处唯一（即使同码，键也不同）⇒ 拿它当 React `key` 是安全的', () => {
    for (const hex of ['#FFFFFF', 'not-a-color', '#000000']) {
      const keys = deriveAndValidate(hex).warnings.map((w) => w.messageKey);
      expect(new Set(keys).size, `${hex} 的 messageKey 有重复`).toBe(keys.length);
    }
  });
});
