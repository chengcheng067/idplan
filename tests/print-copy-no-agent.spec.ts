// @vitest-environment node
/**
 * 打印纸面文案锁 · 纸面不出现「Agent」字样（2026-10-11 产品负责人拍板：**改词保栏**）。
 *
 * ── 这条锁在防什么 ──
 * 产品负责人原话是「改词保栏」：**栏 / 结构 / 分组 / 版式一个不删，只换载荷文字**
 * （`Agent 执行体` → `执行体`、独立 `Agent` → `执行体`、`不登 agentKind` →
 * `不登执行体类型`、`Agent 产出者` → `执行体产出者`）。范围由 team-lead 裁决，
 * 从 H 扩到**全部打印纸面**——否则同一份数据会 H 说「执行体」、E/通用名册说
 * 「Agent 执行体」，下一轮必被挑出来。改完若没有锁，下一批 PR 就会把字样写回去。
 *
 * ── 为什么判据是「含中日韩字符的字面量」而不是「渲染文本」──
 * ① 纸面文案一定是中文（本仓打印层没有纯英文正文），而 `MemberActorKind.Agent`、
 *    `r.isAgent`、`agentKind`、`key: 'agent'`、`data-agent` 这些是**标识符 / 判别值**，
 *    绝不含中文 ⇒ 用「含中日韩字符」当筛子，闸门精确、不误伤标识符。
 * ② **不能**写成「渲染文本里不含 Agent」：H / E / 通用三套夹具里都有一位成员**就叫
 *    `小 Agent`**（`tests/print-a4-visual-h.spec.ts:650` 正着断言它必须出现），
 *    那是**测试数据不是产品文案**，按渲染文本扫必然假红。
 *
 * ── 为什么用 TS 编译器取字面量，而不是「剥注释后 regex 扫」──
 * 本仓有过三次「源码级扫描不剥注释 ⇒ 抓到注释里的字样假红」的教训，所以共享口径是
 * **剥注释**（`tests/industry-neutral-copy.spec.ts:23-26` 的 `stripComments`）。
 * 本文件更进一步：把源码喂给 `ts.createSourceFile`，只取**字符串字面量节点**
 * （`StringLiteral` / `NoSubstitutionTemplateLiteral` / 模板串的各静态段），
 * 注释与标识符**在构造上就进不来** —— 不依赖 regex 剥注释的正确性。文档注释里保留的
 * 「Agent 行 / Agent 章」这类**代码语义**用词因此天然豁免（只有纸面文案才叫「执行体」）。
 *
 * ── 尚未覆盖的一层（有意留白，已上报）──
 * 大写英文副标题（`en: 'AGENTS'`、`en: 'AGENT DECLARATION'`）是 Latin 层，不含中文；
 * 其中 `AGENTS` 会随 H 成员栏头**一起上纸**。换词需要产品负责人选英文词（建议
 * `EXECUTORS`），故本轮**未动**、也未纳入本闸门（纳进来会误伤合法的英文标题层）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '..');
const PRINT_DIR = resolve(ROOT, 'src/print');

/** 中日韩：平假名 / 片假名 / 扩展 A / 基本区 / 兼容表意 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const AGENT_WORD = /[Aa]gent/;

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** 递归收集 `dir` 下匹配 `re` 的文件 */
function collect(dir: string, re: RegExp, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, re, acc);
    else if (re.test(name)) acc.push(p);
  }
  return acc;
}

/** 该文件里全部**字符串字面量**（含模板串各静态段）的文本 + 行号 */
function stringLiterals(file: string): { text: string; line: number }[] {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, 'utf-8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: { text: string; line: number }[] = [];
  const push = (text: string, node: ts.Node): void => {
    out.push({ text, line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1 });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) push(n.text, n);
    else if (ts.isTemplateExpression(n)) {
      push(n.head.text, n.head);
      for (const span of n.templateSpans) push(span.literal.text, span.literal);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** 扫 `src/print/**` 的字面量 */
function scan(predicate: (text: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const file of collect(PRINT_DIR, /\.tsx?$/)) {
    for (const { text, line } of stringLiterals(file)) {
      if (predicate(text)) {
        hits.push({ file: file.replace(ROOT, ''), line, text: text.replace(/\s+/g, ' ') });
      }
    }
  }
  return hits;
}

const show = (hits: Hit[]): string => hits.map((h) => `${h.file}:${h.line}  「${h.text}」`).join('\n');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8');

describe('打印纸面文案锁 · 纸面不出现 Agent 字样（2026-10-11 产品拍板「改词保栏」）', () => {
  it('① 含中日韩字符的字面量里零 Agent/agent（注释与标识符天然豁免）', () => {
    const hits = scan((t) => CJK.test(t) && AGENT_WORD.test(t));
    expect(
      hits.length,
      `纸面文案又出现 Agent 字样，请按「改词保栏」换成「执行体」：\n${show(hits)}`,
    ).toBe(0);
  });

  it('② 不存在「整串恰为 Agent」的字面量（锁住不含中文的那几枚纸面标签）', () => {
    // 为什么单开一条：行类型签 / 文字签这类标签**整串没有中文**，① 的筛子看不见它们，
    // 但它们确实上纸（`.ei-row__kind`、`.ei-row__agent-tag`、`.gm-grid__agent-tag`、
    // `.gm-block-row__state`、E 的 `taskSourceLabel`）。本仓判别值一律小写 `'agent'`，
    // 大写 `'Agent'` 只可能是展示文案 ⇒ 整串恰为 'Agent' 可硬禁，无假红风险。
    const hits = scan((t) => t === 'Agent');
    expect(hits.length, `整串 'Agent' 字面量（纸面标签）应为 0：\n${show(hits)}`).toBe(0);
  });

  it('③ 打印 CSS 的 content: 文案里也不出现 Agent（文案可能藏在伪元素里）', () => {
    const hits: string[] = [];
    for (const file of collect(PRINT_DIR, /\.css$/)) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/content\s*:/.test(line) && AGENT_WORD.test(line)) {
            hits.push(`${file.replace(ROOT, '')}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(hits, `CSS 伪元素文案含 Agent：\n${hits.join('\n')}`).toEqual([]);
  });

  it('④ 正向锚点：新措辞**确实在**（防止用「删掉文案」把闸门弄绿）', () => {
    // H：图例 / 口径行 / 脚注
    expect(read('src/print/pages/agent-poster/shared.ts')).toContain('橙标签=执行体');
    expect(read('src/print/pages/agent-poster/shared.ts')).toContain('不登执行体类型');
    expect(read('src/print/pages/agent-poster/shared.ts')).toContain('执行体产出者');
    // E 原生：成员目录章标签 + 阶段目录的「执行体」文字签
    expect(read('src/print/pages/editorial-index/MemberIndexPage.tsx')).toContain("label: '执行体'");
    expect(read('src/print/pages/editorial-index/StageIndexPage.tsx')).toContain(
      'ei-row__agent-tag">执行体<',
    );
    // 通用（A/D/E/H 四套共用）：章标签 + 类型签 + grid 文字签
    expect(read('src/print/pages/generic/shared.ts')).toContain("label: '执行体'");
    expect(read('src/print/pages/generic/MemberRosterModule.tsx')).toContain("r.isAgent ? '执行体'");
    expect(read('src/print/pages/generic/StageListModule.tsx')).toContain('gm-grid__agent-tag">执行体<');
  });
});
