/**
 * i18n · 「一句话被拆成多段」的拼接守卫（**纯函数**，catalog 由调用方注入）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 上游出处（这条规则从哪来 —— 不是我想出来的约定）
 * ══════════════════════════════════════════════════════════════════════
 * 为了让一句话里的某个短语加粗，界面代码只能把它拆开写：
 *
 *     <span>
 *       {t('agent.stanceBefore')}
 *       <strong className="text-ink">{t('agent.stanceStrong')}</strong>
 *       {t('agent.stanceNl')}
 *     </span>
 *
 * 而 **JSX 不会在这些相邻的表达式容器/元素之间插入任何空白**。实测（esbuild
 * `--loader=tsx --jsx=automatic`，与 `vite build` 同一个转换器）：
 *
 *     {t('a')}<strong>…</strong>{t('c')}  ⇒  jsxs("span", { children: [t("a"), …, t("c")] })
 *                                            ← 三个子项之间**一个空格字符串都没有**
 *     现在可<strong>手动粘贴</strong>排期文件。⏎Windows 版本
 *                                        ⇒  jsxs("span", { children: [
 *                                             "现在可", …, "排期文件。 Windows 版本" ] })
 *                                            ← **同一个 JSXText 内部的换行**被折成一个空格
 *
 * ⇒ 两条推论，就是本守卫的全部判据：
 *   ① **段与段之间的空格，中文不需要、英文需要** ⇒ 只能写进 en 取值里（惯例：尾随
 *      空格，见 `src/i18n/messages/en.ts` 文件头 ⑤）；
 *   ② **句与句之间的空格中英都要** ⇒ 必须用 `{' '}` 显式写出来（写在 JSX 里，
 *      两种语言都生效）。
 *
 * 为什么必须机器守：中文没有这个问题（「Agent 看板目前只承接…」粘在一起是对的），
 * 所以**中文看稿、中文验收、中文截图全绿**，只有切到 EN 才看得见
 * `The Agent board currentlyonly carries schedules from external writers(local auto-import…`。
 * 2026-10-14 一次实测就在已交付的 6 个文件里量到 11 处（详见交付报告），全部是
 * 「中文态完全正常、英文态两个词粘在一起」。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 下游后果（你要是绕过它，会发生什么 —— 如实写在前面）
 * ══════════════════════════════════════════════════════════════════════
 *   · 你若**给某处加豁免**：中文态与英文态的差异不会因此消失，只是「没人再报」；
 *     发布出去的是粘在一起的英文句子，而反馈会以「英文看不懂」的形态回来 ——
 *     那时没人会想到去查「`{t('a')}` 与 `{t('b')}` 之间少了空格」。
 *   · 你若**觉得它太严**：先把 `needsSpace` 的判据读一遍（下面的 `LEFT_OPEN` /
 *     `RIGHT_ATTACH` 就是为「`, click` / `. Save` / `in (` 这些**本来就不该有空格**
 *     的接缝」留的口子）。若还有误报，改判据 + 在
 *     `tests/i18n-jsx-space.spec.ts` 补一条夹具，**别在调用点加豁免**。
 *
 * ── 判据（零容差，命中即红）──
 *   A. `glued`：同一段文本流里，相邻两段的渲染值**都没有空白**，且右段不是以左贴
 *      标点开头、左段也不是以右贴标点结尾 ⇒ 英文态会出现「两个词粘在一起」。
 *      zh 侧只判**拉丁-拉丁**相撞（中文之间不加空格是正确的，不算问题）。
 *   B. `mixed-cjk`：**同一段文本流里既有 `t()` 取值、又有硬编码 CJK 字面量**
 *      ⇒ 那句中文在英文态会原样露出来。只在这个形状下报 —— 整块中文（还没翻的
 *      页面，如打印路由页）与 `t()` 不同流，不算命中，免得把「有意保留中文」的
 *      文件扫红。
 *
 * ── 为什么用 esbuild 而不是自己实现空白折叠 ──
 *   `vite build` 用的就是 esbuild 的 JSX 转换。**直接读它产出的 children 数组**
 *   等于读「React 真正收到的东西」，不是我的复刻。代价：`esbuild` 在本仓是
 *   `vite` 的传递依赖（`package.json` 未直接声明）—— 若将来它消失或换转换器，
 *   本 spec 会**直接导入失败而报错**（不是静默通过），届时改用与产物同源的转换器。
 *
 * ── 边界（如实登记）──
 *   · **不透明边界一律不判**：`{cond ? a : b}`、`{变量}`、`<div>`/`<p>` 这类块级容器、
 *     自定义组件 —— 它们会切断文本流（React 渲染时它们各自成块），跨过它们判空格
 *     就是误报。故只判 `INLINE` 白名单标签内部与同一 children 数组内的接缝。
 *   · 行号是**回溯近似**：由「左段键在源码中第一次出现」定位，供人找代码用。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

import { transformSync } from 'esbuild';
import * as ts from 'typescript';

import type { Lang } from '../../src/i18n';

/** 文本流**透明**的行内标签：只有它们的内部接缝可以跨着判空格 */
const INLINE_TAGS = new Set([
  'strong',
  'b',
  'em',
  'i',
  'code',
  'span',
  'small',
  'u',
  's',
  'mark',
  'sub',
  'sup',
  'abbr',
  'time',
  'kbd',
  'samp',
  'var',
  'bdi',
]);
/** 片段（`<>…</>`）也是透明的 */
const FRAGMENTS = new Set(['_Fragment', 'Fragment']);
const JSX_FACTORIES = new Set(['jsx', 'jsxs', 'jsxDEV', '_jsx', '_jsxs', '_jsxDEV']);

/**
 * 让元素**自成一块 / 脱离行内流**的布局类（Tailwind 原子类，逐 token 精确比）。
 *
 * 为什么需要它（2026-10-14 · 笔 1-⑤ 实测踩到的误报）：
 *   本核原先把「哪里切断文本流」**只按标签名**判（`<div>`/`<p>` 不透明，见下方
 *   `INLINE_TAGS` 的反面）。但**同一个 `<span>` 加一个 `block` 类同样是块级
 *   格式化上下文** —— 它与相邻兄弟**不共行**，跨过去判「缺空格」是误报。
 *   现场（`RestPolicyRecalcDialog.tsx` 的到期日对齐勾选块）：
 *
 *       <span>
 *         <span className="font-medium text-ink">{t('…align.label')}</span>
 *         <span className="mt-0.5 block text-xs text-mist">{t('…align.hint')}</span>
 *       </span>
 *
 *   中文态看不出问题（原先两侧都是中文字面量，`keys.length === 0` 直接不判），
 *   两侧改走 `t()` 之后这条接缝才被判 —— **报出来的却是视觉上并不存在的一行**。
 *   ⇒ 判据补上「class 里带块级/脱流 token 的子项 = 文本流边界」，与既有夹具
 *     「块级容器（`<div>`/`<p>`）切断文本流 ⇒ 不跨着判」**同一条理由**，不是新豁免。
 *
 * ⚠️ 三处边界（免得下一个人以为它管得比实际宽）：
 *   · **只看字符串字面量 className**；模板串 / 表达式一律当未知 ⇒ **不切断**
 *     （保守方向：宁可多判，不少判）。
 *   · **不含** `inline-block` / `inline-flex` / `inline-grid` —— 它们仍在行内流里，
 *     与相邻文字共行 ⇒ 那里的接缝该判。
 *   · **不含** `contents`（子项参与父级流，不构成边界）。
 */
const BLOCK_LAYOUT = new Set([
  'block',
  'flex',
  'grid',
  'table',
  'flow-root',
  'list-item',
  'absolute',
  'fixed',
]);

/** 左贴标点：右段以它们开头时**不需要**空格 */
const RIGHT_ATTACH = /^[,.;:!?)\]}"'’”…%]/;
/** 右贴标点：左段以它们结尾时**不需要**空格 */
const LEFT_OPEN = /[([{“‘]$/;
/** CJK 汉字与 CJK 标点 / 全角符号（`。，（）：` …） */
const CJK_ANY = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
/** 单字符判断（`String.at(-1)` 可能是 undefined） */
const isCjkChar = (c: string | undefined): boolean => c !== undefined && CJK_ANY.test(c);

/** 文本流里的一段（渲染时会按顺序拼起来） */
export interface SpaceUnit {
  /** 实际渲染出来的文字 */
  text: string;
  /** 取自消息表的键；硬编码字面量为 null */
  key: string | null;
}

export type SpaceIssueKind = 'glued' | 'mixed-cjk';

export interface SpaceIssue {
  kind: SpaceIssueKind;
  file: string;
  /** 回溯近似行号 */
  line: number;
  left: string;
  right: string;
  leftKey: string | null;
  rightKey: string | null;
}

export interface SpaceRun {
  file: string;
  line: number;
  /** 该文本流渲染出来的完整文字 */
  text: string;
  keys: string[];
}

export interface SpaceCheckResult {
  runs: SpaceRun[];
  issues: SpaceIssue[];
  /** 因不透明边界而**没有判**的接缝数（透明地报出来，免得被当成"已覆盖"） */
  unchecked: number;
}

/**
 * 英文：两个非空白相邻即需要一个空格，除非接缝落在标点上。
 *
 * ⚠️ 两条「中文侧豁免」不是放水，是**第一版实测踩出来的误报**（2026-08-27 首跑全仓
 *   报出 57 处，全部是还没翻的页面里的纯中文字面量，例如
 *   `「阶段」+「旧结束日」`、`「IDPLAN_AGENT_TOKEN」+「（UGOS：…」`）：
 *   · 中文与中文相邻本就不加空格；
 *   · 中文（或全角标点）接在拉丁词后面同样不加空格（`TOKEN（UGOS` 是对的）。
 *   真正该报的是「英文句子被中文打断」那类 —— 那由 `mixed-cjk` 负责报。
 */
export function needsSpaceEn(left: string, right: string): boolean {
  if (/\s$/.test(left) || /^\s/.test(right)) return false;
  if (RIGHT_ATTACH.test(right)) return false;
  if (LEFT_OPEN.test(left)) return false;
  if (isCjkChar(right[0])) return false;
  if (isCjkChar(left.at(-1))) return false;
  return true;
}

/** 中文：只有「拉丁-拉丁」相撞才算问题（中文之间不加空格是对的） */
export function needsSpaceZh(left: string, right: string): boolean {
  if (/\s$/.test(left) || /^\s/.test(right)) return false;
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

export function needsSpace(lang: Lang, left: string, right: string): boolean {
  return lang === 'en' ? needsSpaceEn(left, right) : needsSpaceZh(left, right);
}

/* ─────────────────────────── AST 侧（esbuild 产物） ─────────────────────────── */

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

function objectProp(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name) {
      return p.initializer;
    }
  }
  return null;
}

/**
 * 一个子项 → **一个** 文本流单元；解释不了（不透明）返回 null。
 * ⚠️ 行内元素在这里**折成一个单元**（文字 = 它内部拼起来的结果，键取内部第一个键），
 *   不是展开成多个单元 —— 展开会让「外层接缝」与「内层接缝」被判两遍（同一处重复报）。
 *   内层的接缝由内层那次 jsx 调用自己判（扫描器会走到它）。
 */
function compositeUnit(node: ts.Node, catalog: Record<string, string>): SpaceUnit | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { text: node.text, key: null };
  }
  if (ts.isParenthesizedExpression(node)) return compositeUnit(node.expression, catalog);
  if (!ts.isCallExpression(node)) return null;

  const name = calleeName(node.expression);
  const args = node.arguments;
  const first = args[0];

  // t('key') —— 消息表取值
  if (name === 't' && first && ts.isStringLiteral(first)) {
    const key = first.text;
    return { text: catalog[key] ?? `<缺键 ${key}>`, key };
  }

  // jsx / jsxs：元素本身；只有 INLINE 标签才透明
  if (name && JSX_FACTORIES.has(name) && first) {
    let tag: string;
    if (ts.isStringLiteral(first)) tag = first.text;
    else if (ts.isIdentifier(first)) tag = first.text;
    else return null;
    if (!INLINE_TAGS.has(tag) && !FRAGMENTS.has(tag)) return null;

    const children = childUnitsOf(node, catalog);
    if (children === null) return null;
    return {
      text: children.map((u) => u.text).join(''),
      key: children.find((u) => u.key !== null)?.key ?? null,
    };
  }
  return null;
}

/**
 * 该子项是不是**块级/脱流**元素（class 里带 `BLOCK_LAYOUT` 的 token）？
 * 只认字符串字面量 className —— 见 `BLOCK_LAYOUT` 的边界说明。
 */
function isBlockLevel(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const name = calleeName(node.expression);
  if (!name || !JSX_FACTORIES.has(name)) return false;
  const props = node.arguments[1];
  if (!props || !ts.isObjectLiteralExpression(props)) return false;
  const cls = objectProp(props, 'className');
  if (!cls || !ts.isStringLiteral(cls)) return false;
  return cls.text.split(/\s+/).some((tok) => BLOCK_LAYOUT.has(tok));
}

/** 一次 jsx 调用的 **直接子项**（每个子项一个单元）；有一个解释不了就整条不判 */
function childUnitsOf(call: ts.CallExpression, catalog: Record<string, string>): SpaceUnit[] | null {
  const name = calleeName(call.expression);
  if (!name || !JSX_FACTORIES.has(name)) return null;
  const props = call.arguments[1];
  if (!props || !ts.isObjectLiteralExpression(props)) return null;
  const children = objectProp(props, 'children');
  if (!children) return null;
  const list = ts.isArrayLiteralExpression(children) ? Array.from(children.elements) : [children];
  const out: SpaceUnit[] = [];
  for (const c of list) {
    // 块级/脱流子项 = 文本流边界：跨过它的接缝**不共行**，判它缺空格是误报。
    // 与 `<div>`/`<p>` 那条既有判据同理由（见 BLOCK_LAYOUT 注释）。
    if (isBlockLevel(c)) return null;
    const u = compositeUnit(c, catalog);
    if (u === null) return null;
    out.push(u);
  }
  return out;
}

/** 源码里 `t('key')` 第一次出现的行号（回溯用） */
function lineOfKey(source: string, key: string): number {
  const re = new RegExp(`t\\((['"])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1\\)`);
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i]!)) return i + 1;
  return 0;
}

/** 判一个文件：返回它的全部文本流与其中的问题 */
export function checkJsxSpacing(opts: {
  file: string;
  source: string;
  catalog: Record<string, string>;
  lang: Lang;
}): SpaceCheckResult {
  const { file, source, catalog, lang } = opts;
  const code = transformSync(source, {
    loader: 'tsx',
    jsx: 'automatic',
    format: 'esm',
    target: 'esnext',
    sourcefile: file,
  }).code;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

  const runs: SpaceRun[] = [];
  const issues: SpaceIssue[] = [];
  let unchecked = 0;
  const seen = new Set<string>();

  const consider = (units: SpaceUnit[]): void => {
    if (units.length === 0) return;
    const text = units.map((u) => u.text).join('');
    const keys = units.filter((u) => u.key).map((u) => u.key!) as string[];
    const firstKey = keys[0] ?? null;
    const line = firstKey ? lineOfKey(source, firstKey) : 0;
    runs.push({ file, line, text, keys });

    // B. 同一条文本流里既取词又硬编码 CJK（英文态会露出中文）
    if (lang === 'en' && keys.length > 0) {
      for (const u of units) {
        if (u.key === null && CJK_ANY.test(u.text)) {
          const fp = `mixed|${u.text}`;
          if (seen.has(fp)) continue;
          seen.add(fp);
          issues.push({
            kind: 'mixed-cjk',
            file,
            line,
            left: '',
            right: u.text,
            leftKey: null,
            rightKey: null,
          });
        }
      }
    }

    // A. 相邻两段都没有空白、又不在标点上 ⇒ 英文态两个词粘在一起。
    //    ⚠️ **只在「这条文本流里有 t() 取值」时判**：整块还是中文的页面（还没翻的，
    //    如打印路由页）不该被本守卫扫红 —— 它们的中文本来就会原样渲染，句间不加空格
    //    是对的。首跑实测：不加这条门，全仓会报 57 处纯中文字面量的"粘连"（全是误报）。
    if (keys.length === 0) return;
    for (let i = 1; i < units.length; i++) {
      const l = units[i - 1]!;
      const r = units[i]!;
      if (!needsSpace(lang, l.text, r.text)) continue;
      const fp = `${l.key ?? l.text}|${r.key ?? r.text}|${line}`;
      if (seen.has(fp)) continue;
      seen.add(fp);
      issues.push({
        kind: 'glued',
        file,
        line,
        left: l.text.slice(-32),
        right: r.text.slice(0, 32),
        leftKey: l.key,
        rightKey: r.key,
      });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const units = childUnitsOf(node, catalog);
      if (units) consider(units);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // 不透明边界计数：children 数组里出现「非本模型能解释的子项」的接缝
  const countOpaque = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && JSX_FACTORIES.has(name)) {
        const props = node.arguments[1];
        if (props && ts.isObjectLiteralExpression(props)) {
          const children = objectProp(props, 'children');
          if (children && ts.isArrayLiteralExpression(children)) {
            for (const c of children.elements) {
              // 块级子项也算「没判」——它自己就是边界，跨它的接缝不进判据（见 BLOCK_LAYOUT）
              if (compositeUnit(c, catalog) === null || isBlockLevel(c)) unchecked++;
            }
          }
        }
      }
    }
    ts.forEachChild(node, countOpaque);
  };
  countOpaque(sf);

  return { runs, issues, unchecked };
}

/* ══════════════════════════ 全仓扫描（守卫用） ══════════════════════════ */

/** 递归收集 `src/**` 下的 .tsx（跳过测试与被排除目录） */
export function tsxFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.tsx')) out.push(abs.slice(repoRoot.length + 1).split(sep).join(posix.sep));
    }
  };
  walk(join(repoRoot, 'src'));
  return out.sort();
}

/** 全仓扫一遍（空 = 干净） */
export function scanRepoJsxSpacing(
  repoRoot: string,
  catalog: Record<string, string>,
  lang: Lang,
): SpaceIssue[] {
  const out: SpaceIssue[] = [];
  for (const file of tsxFiles(repoRoot)) {
    const source = readFileSync(join(repoRoot, file), 'utf-8');
    out.push(...checkJsxSpacing({ file, source, catalog, lang }).issues);
  }
  return out;
}
