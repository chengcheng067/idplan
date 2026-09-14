/**
 * 自定义阶段色的**运行时注入注册表**（v0.8 · T02；设计 §2.4.3 决策 3）。
 *
 * ── 要解决的核心矛盾 ──
 * 内置 9 色的唯一变量源是 `global.css` 的**静态** CSS 变量（`--stage-sN` / `--stage-band-sN` /
 * `--stage-ink-sN`），而用户主色是**运行时数据**：静态变量换不了运行时值；
 * 把派生出的 hex 写进 inline style 又会**丢掉主题感知**（inline 只有一个值，无法随
 * `<html data-theme>` 切换，也无法被 `.print-root` 锁回浅色）。
 *
 * ── 本文件的做法：注入**同结构**的变量，而不是 inline style ──
 *   ① 每个自定义色 → 一个稳定 key：`sc-<hash36>`（`stageColorKey()`，纯函数、幂等）
 *   ② 把该 key 的三层值写进一张**运行时 `<style>`**，一次注入三条规则：
 *        [data-stage-key="sc-x"]                              { 亮色三层 }
 *        :root[data-theme='dark'] [data-stage-key="sc-x"]      { 暗色三层 }
 *        :root[data-theme='dark'] .print-root [data-stage-key="sc-x"] { 亮色三层 }
 *   ③ 渲染时元素只挂属性 `<rect data-stage-key="sc-x" />`，取色出口返回
 *      `var(--stage-local-solid / -band / -ink)`（见 timeline/stageColors.ts）
 *   ④ **打印自动正确**：亮色规则与 `.print-root` 共享同一份值。
 *
 * ── 第三条规则的**特异性**为什么必须写成 `:root[data-theme='dark'] .print-root …` ──
 *   与 global.css 的机制不同：global.css 是把整套令牌声明在 `.print-root` **元素自身**上，
 *   靠"就近继承"压过 `<html>` 的暗色值；而本表的值必须挂在**带属性元素自身**上
 *   （同一个变量名要承载 20 套不同值），于是"元素自身声明"反而会让暗色值在打印子树里胜出。
 *   所以这里用**选择器特异性**解决：亮(0,1,0) < 暗(0,3,0) < 打印(0,4,0)，
 *   且打印规则声明在暗色规则**之后**（同特异性时后者胜）。**顺序不可调换。**
 *   这条由 `tests/isolation-browser.spec.ts` 在**真 Chromium** 里断言（jsdom 不解析层叠，
 *   看不到这类错误 —— BUG-05 的教训）。
 *
 * ── 为什么不会重演 BUG-05（全站阶段色不显色）──
 *   BUG-05 的根因是 `bg-stage-band-s${n}` 这类**动态拼出的 Tailwind 类名**：Tailwind 是纯静态
 *   文本扫描，构建期不知道 n，**一条 CSS 都不生成**。本通路**完全不经过 Tailwind**：
 *   `data-*` 属性 ＋ CSS 自定义属性，规则由运行时 CSSOM 插入，与扫描器无关。
 *   且这里新增的属性名/变量名都是**字面量常量**，不存在拼接。
 */

import type { Stage } from '../types/entities';
import { normalizeHex } from './contrast';
import { deriveStageColors, type DerivedStageColors } from './derive-stage-colors';

/** 稳定 key 的载体属性名（组件只挂这一个属性；取色仍走 var()） */
export const STAGE_COLOR_KEY_ATTR = 'data-stage-key';

/** 稳定 key 前缀（让 key 在 HTML 里自解释，且永远是合法 CSS 标识符） */
export const STAGE_COLOR_KEY_PREFIX = 'sc-';

/** 运行时注入表的 `<style>` 元素 id（调试/测试可据此定位；重复注入时复用同一元素） */
export const STAGE_COLOR_STYLE_ID = 'stage-color-registry';

/** 三层局部变量名（与内置色的 `--stage-sN / --stage-band-sN / --stage-ink-sN` 同构） */
export const STAGE_LOCAL_VAR = {
  solid: '--stage-local-solid',
  band: '--stage-local-band',
  ink: '--stage-local-ink',
  /** ⚠️ `-rgb` 三元组**必须一起注入**：`stageBandOutline()` 用
   *  `rgb(var(--stage-ink-sN-rgb) / α)` 画发丝描边（BUG-04 的修复），
   *  漏了它 ⇒ 新通路上描边会**静默消失**。这是本任务最容易漏的一处。 */
  inkRgb: '--stage-local-ink-rgb',
} as const;

/** key → 派生结果（memo：同一主色只算一次） */
const colorsByKey = new Map<string, DerivedStageColors>();
/** 归一化 hex → key（幂等：同一主色永远得到同一个 key） */
const keyByHex = new Map<string, string>();
/** key → 归一化 hex（碰撞检测用） */
const hexByKey = new Map<string, string>();

/**
 * 稳定 key（纯函数）：`sc-` + FNV-1a(32bit) 的 base36。
 *
 * 为什么不用 hex 本身做 key：`#` 不是合法标识符字符，且**下划线/数字开头**在 CSS 选择器里
 * 需要转义；用哈希还能顺带获得"零 hex 出现在属性值里"的整洁度。
 * 32 位散列在 ≤20 个色上碰撞概率可忽略；`registerStageColor()` 仍做了碰撞兜底（见下）。
 */
export function stageColorKey(mainHex: string): string | null {
  const hex = normalizeHex(mainHex);
  if (hex === null) return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < hex.length; i += 1) {
    hash ^= hex.charCodeAt(i);
    // FNV 素数 16777619 的 32 位乘法（用移位避免精度丢失）
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return `${STAGE_COLOR_KEY_PREFIX}${hash.toString(36)}`;
}

/**
 * 注册一个主色，返回它的稳定 key（§5.2 冻结签名）。
 *
 * 幂等 + 记忆化：同一主色重复调用只派生一次、注入表只重建一次（设计 §2.4.3 决策 2）。
 * 非法输入**抛 RangeError**（编程错误，尽早暴露）；面向组件的入口
 * （`stageColorAttr` / `stageColors.ts` 的三个取色函数）会先归一化，**不会抛**。
 */
export function registerStageColor(mainHex: string): string {
  const hex = normalizeHex(mainHex);
  if (hex === null) {
    throw new RangeError(
      `registerStageColor: 主色必须是 #RRGGBB / #RGB，收到 ${JSON.stringify(String(mainHex))}`,
    );
  }

  const existing = keyByHex.get(hex);
  if (existing !== undefined) return existing;

  let key = stageColorKey(hex)!;
  // 碰撞兜底：万一另一个色占用了同一 key，就追加序号，保证 key ↔ hex 双射
  let salt = 1;
  while (hexByKey.has(key) && hexByKey.get(key) !== hex) {
    salt += 1;
    key = `${stageColorKey(hex)!}-${salt}`;
  }

  keyByHex.set(hex, key);
  hexByKey.set(key, hex);
  colorsByKey.set(key, deriveStageColors(hex));
  syncStylesheet();
  return key;
}

/** 已注册的全部 key（按注册顺序 —— 注入表的规则顺序随之稳定） */
export function registeredStageColorKeys(): string[] {
  return [...colorsByKey.keys()];
}

/** 某个 key 的派生结果（未注册返回 `null`） */
export function stageColorsByKey(key: string): DerivedStageColors | null {
  return colorsByKey.get(key) ?? null;
}

/**
 * 商品级入口（§5.2 冻结签名）：阶段 → `data-stage-key` 属性值；**内置色返回 `null`**。
 *
 * 返回 `null` 不表示"错误"，而是明确告诉调用方「本阶段走内置 9 色通路（Tailwind 静态类
 * 镜像 / `var(--stage-sN)`），不要挂属性」。这样两条通路在调用点一眼可分。
 */
export function stageColorAttr(
  stage: Pick<Stage, 'customColor' | 'colorIndex' | 'orderIndex'>,
): string | null {
  const hex = normalizeHex(stage.customColor);
  if (hex === null) return null;
  return registerStageColor(hex);
}

function declarations(triple: DerivedStageColors['light']): string {
  return [
    `${STAGE_LOCAL_VAR.solid}:${triple.solid}`,
    `${STAGE_LOCAL_VAR.band}:${triple.band}`,
    `${STAGE_LOCAL_VAR.ink}:${triple.ink}`,
    `${STAGE_LOCAL_VAR.inkRgb}:${triple.inkRgb}`,
  ].join(';');
}

/**
 * 生成注入表的 CSS 文本（**纯函数**，便于单测与真浏览器注入）。
 *
 * 规则顺序（不可调换，理由见文件头）：
 *   每个 key 依次输出 [亮色默认] → [暗色主题] → [打印锁亮色]。
 * 不同 key 的选择器只差属性值，互不干扰，故"按 key 分组"是安全的。
 */
export function buildStageColorCss(): string {
  const blocks: string[] = [];
  for (const [key, colors] of colorsByKey) {
    const attr = `[${STAGE_COLOR_KEY_ATTR}="${key}"]`;
    blocks.push(`${attr}{${declarations(colors.light)}}`);
    blocks.push(`:root[data-theme='dark'] ${attr}{${declarations(colors.dark)}}`);
    blocks.push(`:root[data-theme='dark'] .print-root ${attr}{${declarations(colors.light)}}`);
  }
  return blocks.join('\n');
}

/**
 * 把注入表落到 `document.head`（浏览器环境才有效）。
 *
 * 非浏览器（vitest 的 node 环境 / tsx 服务端）**静默跳过** —— 派生与 CSS 文本生成
 * 都不依赖 DOM，服务端渲染与单测因此不受影响。
 */
export function ensureStageColorStyles(): void {
  if (typeof document === 'undefined' || document.head === null) return;
  const css = buildStageColorCss();
  let el = document.getElementById(STAGE_COLOR_STYLE_ID) as HTMLStyleElement | null;
  if (el === null) {
    el = document.createElement('style');
    el.id = STAGE_COLOR_STYLE_ID;
    el.setAttribute('data-owner', 'custom-color-registry');
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

function syncStylesheet(): void {
  ensureStageColorStyles();
}

/** 仅测试用：清空注册表与注入的 `<style>`（避免跨用例状态污染） */
export function __resetRegistryForTest(): void {
  colorsByKey.clear();
  keyByHex.clear();
  hexByKey.clear();
  if (typeof document !== 'undefined') {
    document.getElementById(STAGE_COLOR_STYLE_ID)?.remove();
  }
}
