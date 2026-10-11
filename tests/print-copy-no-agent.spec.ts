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
 * ── 扫什么：**纸面文案节点**，而不是「字符串字面量」 ──
 * `src/print/**` 的 `.ts/.tsx` 里，能变成纸上文字的只有三类节点：
 *   · `StringLiteral` / 模板串静态段（`title: '…'`、``${n} 人` ``、JSX 属性 `caption="…"`）
 *   · **`JsxText`**（`<p>口径：…</p>` 这种**直接写在标签之间的正文**）
 * 教训是现成的：本锁第一版只扫字面量，于是 `ArtifactIndexPage.tsx` 里那句
 * `<p className="ei-note">口径：来源 = 任务的产生方（human / Agent）</p>` **整句漏网**
 * ——它压根不是字面量，是 JSX 文本节点。所以扫面必须含 `JsxText`（同一次修正里
 * `MemberIndexPage.tsx` 的 `<strong>agentKind 为开放字符串…</strong>` 也是这么找出来的）。
 * **豁免**：模块路径字面量（`import` / `export` / `import()` / `require()` 的参数，
 * 如 `'./AgentPosterDocument'`）是**代码路径不是文案** —— 按节点父级精确豁免，
 * 不用文件级白名单（白名单会把整个文件的文案一起放过）。
 *
 * ── 为什么判据是「含中日韩字符」+「含大写字母」两种筛子，而不是「渲染文本」──
 * ① 纸面文案一定是中文（本仓打印层没有纯英文正文），而 `MemberActorKind.Agent`、
 *    `r.isAgent`、`agentKind`、`key: 'agent'`、`data-agent` 这些是**标识符 / 判别值**，
 *    绝不含中文 ⇒ 用「含中日韩字符」当筛子，闸门精确、不误伤标识符。
 * ② 但**筛选面①漏掉了「整串没有中文」的纸面标签**（`.ei-row__kind` 的 `'Agent'`、
 *    `.gm-grid__agent-tag` 的 `'Agent'`…）⇒ 门② 用「整串恰为 `Agent`」补上。
 * ③ 还漏掉了**英文副标题层**（`en: 'AGENTS'` 会随 H 成员栏头一起上纸）⇒ 门⑤ 用
 *    「含大写字母的 Agent 词」补上：本仓判别值一律小写 `'agent'`，纸面词才有大小写
 *    形态（`Agent` / `AGENTS` / `AGENT DECLARATION`），判别值因此天然豁免。
 * ④ **不能**写成「渲染文本里不含 Agent」：H / E / 通用三套夹具里都有一位成员**就叫
 *    `小 Agent`**（`tests/print-a4-visual-h.spec.ts:650` 正着断言它必须出现），
 *    那是**测试数据不是产品文案**，按渲染文本扫必然假红。
 * ⑤ 伪元素里的文案（CSS `content:`）绕过上面所有 JS/JSX 扫描面 ⇒ 门③ 单独扫打印 CSS。
 * ⑥ 三份 document 的 `Record<PrintPageKind, …>` 是**全量键类型契约**，必须为
 *    `agent-declaration` / `execution-status` / `writeback-proposals` 留页题 ⇒ 那三条
 *    是「留着但上不了纸」的**死文案**；门⑥ 把这个前提**机器化**（谁把 M10/M11 接回
 *    能力表，这里先红，而不是等产品负责人在纸上再看见一次字样）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

import { PRINT_MODULE_IDS, enabledSheetsOf } from '../src/components/print/print-templates';
import type { PrintModuleId, PrintTemplateId } from '../src/components/print/print-templates';

const ROOT = resolve(__dirname, '..');
const PRINT_DIR = resolve(ROOT, 'src/print');

/** 中日韩：平假名 / 片假名 / 扩展 A / 基本区 / 兼容表意 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** Agent 词（不限大小写；门① 用） */
const AGENT_WORD = /[Aa]gent/;
/** 含大写字母的 Agent 词（判别值一律小写 ⇒ 命中的必是纸面词；门⑤ 用） */
const AGENT_WORD_CASED = /Agent|AGENT/;

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

/** 模块路径字面量（代码路径，非文案）：`import` / `export` / `import()` / `require()` 的参数 */
function isModuleSpecifier(n: ts.Node): boolean {
  const p = n.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportEqualsDeclaration(p)) return true;
  if (ts.isCallExpression(p)) {
    const callee = p.expression;
    return (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === 'require')
    );
  }
  return false;
}

/** 该文件里全部**纸面文案节点**的文本 + 行号（字面量 + 模板串静态段 + JSX 文本） */
function copyNodes(file: string): { text: string; line: number }[] {
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
    if (ts.isJsxText(n)) push(n.text, n);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!isModuleSpecifier(n)) push(n.text, n);
    } else if (ts.isTemplateExpression(n)) {
      push(n.head.text, n.head);
      for (const span of n.templateSpans) push(span.literal.text, span.literal);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** 扫 `src/print/**` 的纸面文案节点 */
function scan(predicate: (text: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const file of collect(PRINT_DIR, /\.tsx?$/)) {
    for (const { text, line } of copyNodes(file)) {
      if (predicate(text)) {
        hits.push({ file: file.replace(ROOT, ''), line, text: text.trim().replace(/\s+/g, ' ') });
      }
    }
  }
  return hits;
}

const show = (hits: Hit[]): string => hits.map((h) => `${h.file}:${h.line}  「${h.text}」`).join('\n');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8');

describe('打印纸面文案锁 · 纸面不出现 Agent 字样（2026-10-11 产品拍板「改词保栏」）', () => {
  it('① 含中日韩字符的纸面文案里零 Agent/agent（注释与标识符天然豁免）', () => {
    const hits = scan((t) => CJK.test(t) && AGENT_WORD.test(t));
    expect(
      hits.length,
      `纸面文案又出现 Agent 字样，请按「改词保栏」换成「执行体」：\n${show(hits)}`,
    ).toBe(0);
  });

  it('② 不存在「整串恰为 Agent」的纸面文案（锁住不含中文的那几枚纸面标签）', () => {
    // 为什么单开一条：行类型签 / 文字签这类标签**整串没有中文**，① 的筛子看不见它们，
    // 但它们确实上纸（`.ei-row__kind`、`.ei-row__agent-tag`、`.gm-grid__agent-tag`、
    // `.gm-block-row__state`、E 的 `taskSourceLabel`）。本仓判别值一律小写 `'agent'`，
    // 大写 `'Agent'` 只可能是展示文案 ⇒ 整串恰为 'Agent' 可硬禁，无假红风险。
    const hits = scan((t) => t.trim() === 'Agent');
    expect(hits.length, `整串 'Agent' 纸面文案应为 0：\n${show(hits)}`).toBe(0);
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
    // H：栏头英文副标题 / 图例 / 口径行 / 脚注
    expect(read('src/print/pages/agent-poster/shared.ts')).toContain("en: 'EXECUTORS'");
    expect(read('src/print/pages/agent-poster/shared.ts')).toContain('橙标签=执行体');
    expect(read('src/print/pages/agent-poster/shared.ts')).toContain('不登执行体类型');
    expect(read('src/print/pages/agent-poster/shared.ts')).toContain('执行体产出者');
    // E 原生：成员目录章标签 + 类型签（两枚） + 阶段目录文字签 + 产出物册口径
    expect(read('src/print/pages/editorial-index/MemberIndexPage.tsx')).toContain("label: '执行体'");
    expect(read('src/print/pages/editorial-index/MemberIndexPage.tsx')).toContain(
      "{isAgent ? '执行体' : '人类'}",
    );
    expect(read('src/print/pages/editorial-index/StageIndexPage.tsx')).toContain(
      'ei-row__agent-tag">执行体<',
    );
    expect(read('src/print/pages/editorial-index/ArtifactIndexPage.tsx')).toContain(
      '（人类 / 执行体）',
    );
    expect(read('src/print/pages/editorial-index/shared.ts')).toContain("'执行体' : '人类'");
    // 通用（A/D/E/H 四套共用）：章标签 + 类型签 + 两处状态签
    expect(read('src/print/pages/generic/shared.ts')).toContain("label: '执行体'");
    expect(read('src/print/pages/generic/MemberRosterModule.tsx')).toContain("{row.isAgent ? '执行体' : '人类'}");
    expect(read('src/print/pages/generic/MemberRosterModule.tsx')).toContain("{r.isAgent ? '执行体' : '人类'}");
    expect(read('src/print/pages/generic/StageListModule.tsx')).toContain('gm-grid__agent-tag">执行体<');
    // 三份 document 的 legacy 页题英文（不可达，但字面量不留 AGENT）
    for (const doc of ['AgentPoster', 'DataEditorial', 'EditorialIndex']) {
      expect(read(`src/print/documents/${doc}Document.tsx`)).toContain("en: 'EXECUTION DECLARATION'");
    }
  });

  it('⑤ 任意纸面文案里不得出现**含大写字母**的 Agent 词（锁住英文副标题层）', () => {
    // 这一道是补门的：门① 只筛「含中文」的文案，于是 `en: 'AGENTS'`（H 成员栏头的
    // 英文副标题，**会随栏头一起上纸**）从缝里漏了过去。判别值一律小写 `'agent'`，
    // 所以「含大写」这个筛子不会误伤 `key: 'agent'` / `{ kind: 'agent' }` / `data-agent`。
    const hits = scan((t) => AGENT_WORD_CASED.test(t));
    expect(
      hits.length,
      `纸面文案里有含大写的 Agent 词（英文副标题层）：\n${show(hits)}`,
    ).toBe(0);
  });

  it('⑥ 三个 Agent 页 kind 在任何模板下都出不了纸（可达性锁 · 兜底页题文案的前提）', () => {
    // 为什么要有这条：三份 document 的 `Record<PrintPageKind, …>` 是**全量键类型契约**，
    // 必须为 `agent-declaration` / `execution-status` / `writeback-proposals` 留页题
    // ⇒ 这三条文案是「留着但上不了纸」的死文案。本门把这个前提**机器化**，
    // 而不是只写在注释里（哪天有人把 M10/M11 接回能力表，这里先红）。
    const DEAD_KINDS = ['agent-declaration', 'execution-status', 'writeback-proposals'];
    const DEAD_MODULES: readonly PrintModuleId[] = ['agent-execution', 'writeback-proposals'];
    const TEMPLATES: PrintTemplateId[] = [
      'classic',
      'swiss-schedule',
      'data-editorial',
      'editorial-index',
      'agent-poster',
    ];
    const report: string[] = [];
    for (const t of TEMPLATES) {
      // ① 把 11 个模块**全勾上**也不产出这三个 kind
      const all = enabledSheetsOf(t, PRINT_MODULE_IDS);
      const leaked = all.filter((s) => s.type === 'native' && DEAD_KINDS.includes(s.page));
      report.push(`${t}: 全勾 ${all.length} sheet / 命中 ${leaked.length}`);
      expect(leaked, `${t} 全勾模块也不得产出 Agent 页：${JSON.stringify(leaked)}`).toEqual([]);
      // ② 单独勾这两个 Agent 模块 ⇒ 空集（能力表里根本没有它们 ⇒ stale prefs 静默忽略）
      expect(
        enabledSheetsOf(t, DEAD_MODULES),
        `${t} 勾 M10/M11 应得空集（capability 表无此模块）`,
      ).toEqual([]);
    }
    // eslint-disable-next-line no-console
    console.log(`[Agent 页可达性实测] ${report.join('｜')}`);
  });
});
