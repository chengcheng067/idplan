/**
 * 项目「外观」解析层（v0.7 · B1 侧栏折叠态增强）。
 *
 * 职责：把两个纯展示字段（`Project.shortLabel` / `Project.coverColor`）
 * 从「库里的原始值」解析为「界面要用的东西」，并在此处集中处理**老数据回落**。
 * 组件只做取值，不各自写回落分支——否则侧栏折叠态 / 展开态 / 项目卡 / 编辑弹窗
 * 四处会各有一套 `?? 项目名首字`，改一处口径必然漏三处。
 *
 * ── 为什么 coverColor 用 CSS 变量而不是 Tailwind 类名 ──
 *   1) `coverColor` 存的是**数据**（token 名，见 entities.Project 注释），
 *      运行时要按值取色。用类名就必须维护「值 → 类名」字符串映射，
 *      而 Tailwind 是静态文本扫描（BUG-05：模板字符串拼类名一条 CSS 都不生成）；
 *   2) 走 `rgb(var(--x-rgb))` 与 tailwind.config.ts 的 `c()` 助手**同源**，
 *      因此 `<html data-theme="dark">` 换肤时本文件自动跟随，无需 dark: 分支；
 *   3) 全文件**零 hex**——值域唯一来源仍是 src/styles/global.css（与
 *      src/components/timeline/stageColors.ts 同一纪律）。
 *   ⚠️ 故本文件的产物是**内联 style 值**，调用方写 `style={{ backgroundColor }}`；
 *      不要试图把它塞进 className。
 */
import { t } from '../i18n';

/**
 * 折叠态侧栏那枚 40×36 方块能显示的简称最大字数。
 * 40px 宽 − 竖条 4px − gap ≈ 24px 可写区 → 12px 字号最多两个字。
 */
export const PROJECT_SHORT_LABEL_MAX_LENGTH = 2;

/**
 * 可选的封面 token 白名单（= 写入侧的值域，同时驱动编辑器的色板顺序）。
 * `css` 为取色表达式，仅在渲染时使用；库里存的是 `key`。
 *
 * ⚠️ **`label` 是 getter，不是普通字面量**（i18n 笔 misc）：
 *   色号名（靛蓝/琥珀/…）是**展示名**，落库的是 `key` ⇒ 该随语言走；但本表是
 *   **模块级常量**，写成 `label: t('…')` 会把语言冻在 import 那一刻。
 *   而本表的类型是 `readonly label: string`（消费者只用 `token.label` 上屏），
 *   改成「键表 + 取词函数」要动 `ProjectAppearanceDialog`（不在本笔边界内）
 *   ⇒ getter 是就地可用的等价形态：每次读都按当前语言重算。
 *   ✅ 反应性已核：唯一消费方 `ProjectAppearanceDialog` 已 `useLang()` 订阅
 *     （切语言即重渲染 ⇒ 重读 `token.label` ⇒ 拿到新语言）。**新增消费方时也必须
 *     订阅**，否则色卡名会停在上一种语言。写入侧不读 `label`（只有 `key` / `css`）。
 *   ⚠️ 另：本表**不可被浅拷贝**（`{...token}` 会把 getter 拍平）。
 */
export const PROJECT_COVER_TOKENS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly css: string;
}> = [
  {
    key: 'pine',
    get label() {
      return t('project.cover.pine');
    },
    css: 'rgb(var(--pine-rgb))',
  },
  {
    key: 'amber',
    get label() {
      return t('project.cover.amber');
    },
    css: 'rgb(var(--amber-rgb))',
  },
  {
    key: 'clay',
    get label() {
      return t('project.cover.clay');
    },
    css: 'rgb(var(--clay-rgb))',
  },
  {
    key: 'moss',
    get label() {
      return t('project.cover.moss');
    },
    css: 'rgb(var(--moss-rgb))',
  },
  {
    key: 'mist',
    get label() {
      return t('project.cover.mist');
    },
    css: 'rgb(var(--mist-rgb))',
  },
  {
    key: 'cream',
    get label() {
      return t('project.cover.cream');
    },
    css: 'rgb(var(--cream-rgb))',
  },
];

/** token 名 → 取色表达式（由上表派生，保持单一事实源，禁止再抄一份） */
const COVER_COLOR_CSS: Readonly<Record<string, string>> = PROJECT_COVER_TOKENS.reduce<
  Record<string, string>
>((acc, t) => {
  acc[t.key] = t.css;
  return acc;
}, {});

/** 是否为白名单内的封面 token（写入侧校验 + 编辑器的选中判定共用） */
export function isProjectCoverToken(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COVER_COLOR_CSS, value);
}

/**
 * 封面 token → 取色表达式。未设置 / 非白名单值（如 v0.6 老数据里可能残留的裸 hex）
 * 一律返回 `null`，由调用方回落到阶段色——**不抛错、不静默改写数据**。
 */
export function projectCoverColorCss(coverColor: string | null | undefined): string | null {
  return isProjectCoverToken(coverColor) ? COVER_COLOR_CSS[coverColor] : null;
}

/**
 * ★ 项目色块的**唯一**取色入口（侧栏展开态彩条 + 折叠态竖条共用）。
 *
 * 覆盖式语义（B1 明确要求）：`coverColor` 有值且合法 → 用它；否则 → 用阶段色。
 * 阶段色由调用方算好传入（`STAGE_BAR_COLORS[resolveStageColorIndex(...)]`），
 * 本函数刻意**不 import** stageColors——保持零依赖的纯函数，可单测、无循环引用。
 */
export function resolveProjectAccentColor(
  coverColor: string | null | undefined,
  stageFallback: string,
): string {
  return projectCoverColorCss(coverColor) ?? stageFallback;
}

/**
 * ★ 折叠态方块文字的**唯一**取值入口：`shortLabel` 优先，否则项目名首字。
 *
 * - trim 后为空的 `shortLabel` 视同未设置（用户删空输入框 = 回到首字回落）；
 * - 按**码点**截断而非 `slice(0,2)`：后者会把 emoji / 代理对从中间劈开，
 *   渲染出半个字符（Replacement Character）；
 * - 项目名也为空（理论不可达，name 有非空校验）→ 返回 '·'，
 *   保证方块上永远有可见文字，不会出现「空白方块」这种无法定位的 UI。
 */
export function resolveProjectShortLabel(
  name: string,
  shortLabel?: string | null,
): string {
  const custom = typeof shortLabel === 'string' ? shortLabel.trim() : '';
  if (custom) return codePoints(custom).slice(0, PROJECT_SHORT_LABEL_MAX_LENGTH).join('');
  const first = codePoints(typeof name === 'string' ? name.trim() : '')[0];
  return first ?? '·';
}

/**
 * 写入侧归一：trim 后为空 → `null`（清除），超长按码点截断。
 * 编辑器与 store 必须都过这里，保证库里永远只有「null 或 1..2 字的简称」。
 */
export function normalizeProjectShortLabel(input: string | null | undefined): string | null {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return null;
  return codePoints(text).slice(0, PROJECT_SHORT_LABEL_MAX_LENGTH).join('');
}

/**
 * 写入侧归一：非白名单值 → `null`。
 *
 * ⚠️ 已记录的取舍：v0.6 老数据 / 测试夹具里可能残留裸 hex（如 `#3D6B5B`）。
 *   本函数会把它归一为 `null`。这是**刻意的清理**——该字段当前没有任何
 *   历史渲染消费方（v0.7 才首次上屏），归一后行为等价于「跟随阶段色」，
 *   不丢任何用户可见信息。编辑器只在用户**实际改动色板**时才回写，
 *   不做「打开弹窗即擦除」（见 ProjectCard 的 colorTouched 闸门）。
 */
export function normalizeProjectCoverColor(input: string | null | undefined): string | null {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return null;
  return isProjectCoverToken(text) ? text : null;
}

/** 按 Unicode 码点切分（代理对安全的 Array.from 语义，显式命名以免被当成普通 split） */
function codePoints(text: string): string[] {
  return Array.from(text);
}
