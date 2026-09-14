/**
 * 颜色数学底座（v0.8 · T02）—— **与工作区根 `tmp/build_palette2.py` 逐行对齐**。
 *
 * ── 为什么单独一个文件 ──
 * 派生算法（derive-stage-colors.ts）要的是「可比对、可回归」的纯函数：同一份输入永远
 * 得到同一份输出，且输出必须与现网 v0.7 九色的生成脚本**逐字节相等**。
 * 因此本文件是「算法原文的 TS 转录」，函数粒度与脚本一一对应（脚本行号写在每个函数上方），
 * **任何"顺手优化"都会让 tests/stage-color-derive.spec.ts 的 45 条 byte-exact 断言变红**——
 * 这正是那些断言存在的意义。
 *
 * ── 权威来源 ──
 *   工作区根 `tmp/build_palette2.py`（不是 `changxia/tmp/`，那里没有 palette 文件）
 *   `tmp/palette2.json` 的 `meta.rule` 字符串**已知漂移**，不作为实现依据。
 *
 * ── 三个必须照抄、不许"优化"的反直觉点 ──
 *   1. `toHex` 是 **round 后 clamp 再 `%02X`**（脚本 :46），不是 floor；
 *      而且脚本用的是 **Python 的 round()＝四舍六入五取偶**（banker's rounding），
 *      与 JS `Math.round()` **不等价**：`mix("#215452","#FFFFFF",0.25)` 的三个通道里
 *      88.5 / 126.75 / 125.25 会让 `Math.round` 得到 `#597F7D`，而脚本给出 **`#587F7D`**。
 *      故本文件用 `roundHalfToEven()` 精确复刻 Python 语义（见其注释）。
 *   2. `mix` 是 **sRGB 逐通道线性插值后取整**，**严禁** HSL/OKLab 插值。
 *   3. `de` 是 **CIE76（Lab 欧氏距离）**，不是 CIEDE2000。
 */

/** RGB 三元组（0–255，可含小数——中间结果用，落 hex 前才取整） */
export type RgbTriplet = readonly [number, number, number];

/** Lab 三元组：[L*, a*, b*]（L* 0–100 量纲，即 R2/R5 阈值所用口径） */
export type LabTriplet = readonly [number, number, number];

/* ------------------------------------------------------------------ 取整与解析 */

/**
 * Python `round()` 语义：四舍六入，**恰为 .5 时取偶**（banker's rounding）。
 *
 * ⚠️ 这不是洁癖：脚本用 `"%02X" % round(v)` 落 hex，而 `mix()` 在 t=0.25 这类比例下
 * 极易产出 `.5` 的通道值（如 `33*0.75 + 255*0.25 = 88.5`）。
 * 实测差异：`mix("#215452","#FFFFFF",0.25)` → Python `#587F7D` / `Math.round` `#597F7D`。
 * s1 的亮带搜索正是从这一档被拒后才落到 t=0.30，因此**这个取整方式是被锚点断言锁住的**。
 */
export function roundHalfToEven(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const floor = Math.floor(v);
  const diff = v - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 单通道钳制到 [0,255]（脚本 :46 的 `max(0, min(255, ...))`） */
function clamp255(v: number): number {
  return Math.max(0, Math.min(255, roundHalfToEven(v)));
}

const HEX6 = /^([0-9a-f]{6})$/;
const HEX3 = /^([0-9a-f]{3})$/;

/**
 * 宽松解析：容忍首尾空白、可选 `#`、大小写混合、3 位简写（`#abc` → `#aabbcc`）。
 * 非法输入返回 `null`（**不抛**）——所有面向组件的出口都走这一条，
 * 保证「用户把 `customColor` 落成脏值」时界面不崩、且能拿到 `unresolvable` 警告。
 *
 * 说明：脚本 `hx()` 只处理 6 位；3 位简写是**输入归一化**的补充，
 * 不改动任何 6 位输入的输出（锚点断言已锁）。
 */
export function tryParseHex(input: unknown): RgbTriplet | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase().replace(/^#/, '');
  let body = raw;
  if (HEX3.test(body)) {
    body = `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  if (!HEX6.test(body)) return null;
  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
  ] as const;
}

/** 归一化为大写 `#RRGGBB`；非法输入返回 `null` */
export function normalizeHex(input: unknown): string | null {
  const rgb = tryParseHex(input);
  return rgb === null ? null : rgbToHex(rgb);
}

/** 解析 hex → RGB 三元组；非法输入**抛 RangeError**（供内部断言用的严格入口） */
export function hexToRgb(hex: string): RgbTriplet {
  const rgb = tryParseHex(hex);
  if (rgb === null) {
    throw new RangeError(`hexToRgb: 非法颜色字面量 ${JSON.stringify(hex)}（期望 #RRGGBB / #RGB）`);
  }
  return rgb;
}

/** 脚本 `hx()` 的别名（保留短名，便于与脚本对照阅读） */
export const hx = hexToRgb;

/** 脚本 `to_hex()`（:45-46）：逐通道 round → clamp [0,255] → `%02X` 大写 */
export function rgbToHex(rgb: readonly number[]): string {
  const c = [0, 1, 2].map((i) => clamp255(Number(rgb[i] ?? 0)));
  return `#${c.map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

/** 脚本 `to_hex()` 的别名 */
export const toHex = rgbToHex;

/** 供 CSS 变量注入的三元组文本：`"100 135 134"`（`--stage-local-ink-rgb` 用；算法同脚本 `-rgb` 段） */
export function rgbTripletString(hex: string): string {
  return hexToRgb(hex).join(' ');
}

/* ------------------------------------------------------------------ 色度学 */

/**
 * 脚本 `lin()`（:49-51）：sRGB 反伽马。分段点 0.04045 / 12.92。
 * ⚠️ 先除 255 再比阈值（与脚本一致），不要"优化"成整数比较。
 */
export function lin(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 脚本 `rlum()`（:71-73）：WCAG 相对亮度 `0.2126R + 0.7152G + 0.0722B`（线性空间） */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 脚本 `rlum()` 的别名 */
export const rlum = relativeLuminance;

/**
 * 脚本 `contrast()`（:76-80）：WCAG 对比度 `(Lmax+0.05)/(Lmin+0.05)`。
 * 无单位比值，4.5 = WCAG AA 正文阈值（TEXT_MIN_CONTRAST）。
 */
export function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 脚本 `lab()`（:54-63）：sRGB → CIE Lab。
 * D65 白点，除数**必须是** `0.95047 / 1.0 / 1.08883`；`f(t)` 分段点 0.008856（含 7.787t + 16/116）。
 */
export function toLab(hex: string): LabTriplet {
  const [r, g, b] = hexToRgb(hex);
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const X = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
  const Y = (0.2126 * rl + 0.7152 * gl + 0.0722 * bl) / 1.0;
  const Z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)] as const;
}

/** 脚本 `lab()` 的别名 */
export const lab = toLab;

/** 脚本 `lstar()`（:92-93）：CIE L*（0–100）。R2 的 >80 与 R5 的 >=70 都用这一量纲 */
export function lstar(hex: string): number {
  return toLab(hex)[0];
}

/**
 * Lab 彩度 `C* = √(a² + b²)`（**脚本没有这个量**，是 T02 为「中性灰主色」判定新增的派生量）。
 * 用途：`#FFFFFF` / `#000000` / `#808080` 这类零彩度主色派生出的三层色与界面中性面
 * （墨色 / 边框 / 灰底）在**语义上属于同一层级**，阶段色会失去「可编码」的意义 ⇒ 出警告。
 * 该函数不改动任何既有颜色算法，只服务 `deriveAndValidate()` 的 `warnings`。
 */
export function labChroma(hex: string): number {
  const [, a, b] = toLab(hex);
  return Math.sqrt(a * a + b * b);
}

/**
 * 脚本 `de()`（:66-68）：**CIE76**（Lab 空间欧氏距离）。
 * 不要换成 CIEDE2000 —— 公式复杂度数倍且本场景无收益，且会与脚本校验段的口径不一致。
 */
export function deltaE76(aHex: string, bHex: string): number {
  const la = toLab(aHex);
  const lb = toLab(bHex);
  return Math.sqrt(
    (la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2,
  );
}

/** 脚本 `de()` 的别名 */
export const de = deltaE76;

/** 一组颜色里离 `hex` 最近的一个（V5 / V9 的报告用；空集返回 `null`） */
export function nearestByDeltaE(
  hex: string,
  others: readonly string[],
): { hex: string; deltaE: number } | null {
  let best: { hex: string; deltaE: number } | null = null;
  for (const other of others) {
    const d = deltaE76(hex, other);
    if (best === null || d < best.deltaE) best = { hex: other, deltaE: d };
  }
  return best;
}

/* ------------------------------------------------------------------ 混色 */

/**
 * 脚本 `mix()`（:83-85）：**sRGB 逐通道线性插值 + 取整**。
 * `mix(c, other, t) = c*(1-t) + other*t`，逐通道算完再 `to_hex`。
 *
 * ⚠️ 严禁改成 HSL / OKLab 插值：本函数是九色锚点的核心，换空间会立刻全红。
 */
export function mix(hex: string, other: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex([0, 1, 2].map((i) => a[i] * (1 - t) + b[i] * t));
}

/** 脚本 `scale()`（:88-89）：逐通道乘 k 后取整（用于"同色相深色/浅色"） */
export function scale(hex: string, k: number): string {
  const a = hexToRgb(hex);
  return rgbToHex(a.map((v) => v * k));
}
