// @vitest-environment jsdom
/**
 * 行业板块显示名 · **语言契约**（英文补齐批 · 段 5 之五）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 形态：core 一个字不动，界面按 **domain id** 取词
 * ══════════════════════════════════════════════════════════════════════
 * `DOMAIN_LABELS`（`src/core/template/stage-library.ts`）住在 **core** 里，而 `src/core/**`
 * **不许 import i18n**（会把 `lang.ts` 的 `document` 拖进无 DOM 的服务端 program ⇒
 * `typecheck:server` TS2584）⇒ core 那张表继续当**载荷口径**的中文出处，
 * 屏幕侧由 `src/i18n/labels.ts` 的 `DOMAIN_LABEL_KEYS` / `domainLabelKey()` 按 id 映射。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 本条的判据比「插件名」那条更强，原因写在这里
 * ══════════════════════════════════════════════════════════════════════
 * 板块名**只有一种来源**（core 那张表），不牵涉「作者自带文案」，所以不存在「一半一半」。
 * 唯一的风险是**漏登记**（新增领域忘了加一行 ⇒ 英文界面上仍是中文）。
 * ⇒ 故键表类型写成 `Record<StageTemplateDomain, MessageKey>`（**不是** `Record<string, …>`）：
 *   `dto.ts` 的联合多一个成员，那个文件就**编译不过**，不会静默漏翻。
 *   本文件再补一条**运行期**的集合相等（表 ⟺ `DOMAIN_LABELS`），两处都钉。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 两处「不靠人记」的守卫（落点是本条最容易腐化的地方）
 * ══════════════════════════════════════════════════════════════════════
 * ⑥ **全仓扫描 `domainLabel(` 的调用点，断言只剩 1 处**（= `PlanningWizardDialog.tsx` 里
 *    那句拼给**外部 Agent** 的 prompt）。这条是"清单会腐化"的解药：本次普查时团队给的
 *    屏幕侧清单写了 4 个文件，实测是 **8 个文件 / 16 处**（漏了项目卡、项目详情、
 *    板块确认、行业库设置四处）。人工清单漏一次，剩下的就永远显示中文；
 *    把"还剩几处、剩在哪"钉成断言，下一步加新屏幕点时**这里先红**。
 * ⑦ **反应性守卫**：`domainLabelKey()` 是模块级函数、**不订阅语言** ⇒ 调用它的文件
 *    必须自己调 `useLang()`。漏订阅的表现是"切英文后板块名还是中文，而界面其它地方是英文"
 *    —— 本批最怕的那类假绿。这条按文件扫，成本近零。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep, posix } from 'node:path';
import ts from 'typescript';

import { DOMAIN_LABEL_KEYS, domainLabelKey, setLang, t } from '../src/i18n';
import { zh as coreZh, en as coreEn } from '../src/i18n/messages/parts/core';
import { DOMAIN_LABELS, domainLabel, getUsableDomains } from '../src/core/template/stage-library';

const ROOT = resolve(__dirname, '..');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const zhTable = coreZh as Record<string, string>;
const enTable = coreEn as Record<string, string>;

/** 唯一的**故意不改**处：拼给外部 Agent 的 prompt 载荷（读者是对方的模型，不是界面） */
const PAYLOAD_SITE = 'src/components/agent/PlanningWizardDialog.tsx';

beforeEach(() => setLang('zh'));
afterEach(() => setLang('zh'));

/* ────────────────────────── 全仓扫描工具 ────────────────────────── */

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(ts|tsx)$/.test(name)) out.push(abs.slice(ROOT.length + 1).split(sep).join(posix.sep));
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

/** 全仓收集某个**被调用**的标识符的位置（AST 级：看的是调用，不是文本出现 ⇒ 注释天然不算） */
function callSitesOf(name: string): Array<{ file: string; line: number }> {
  const out: Array<{ file: string; line: number }> = [];
  for (const rel of srcFiles()) {
    const abs = join(ROOT, rel);
    const sf = ts.createSourceFile(
      abs,
      readFileSync(abs, 'utf-8'),
      ts.ScriptTarget.Latest,
      true,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
        out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** `domainLabel(...)` 的调用点 */
const domainLabelCallSites = (): Array<{ file: string; line: number }> => callSitesOf('domainLabel');

/* ══════════════════ ①②③ 三表不漂 + 默认中文零变化 + 英文真能取到 ══════════════════ */

describe('板块名 · ① 键表按 domain id，且与 core 的 `DOMAIN_LABELS` 集合相等', () => {
  it('★ id 集两两相等（core 那张表 ⟺ 键表）—— 漏一个领域 = 英文界面上它还是中文', () => {
    expect(Object.keys(DOMAIN_LABEL_KEYS).sort()).toEqual(Object.keys(DOMAIN_LABELS).sort());
    expect(Object.keys(DOMAIN_LABEL_KEYS).length, '领域数变了').toBe(10);
  });

  it('★ 键名恒为 `domain.<id>`（与 id 一一对应，不另造别名）', () => {
    for (const id of Object.keys(DOMAIN_LABEL_KEYS)) {
      expect(DOMAIN_LABEL_KEYS[id as keyof typeof DOMAIN_LABEL_KEYS]).toBe(`domain.${id}`);
    }
  });

  it('★ 分片 zh/en 都有这 10 个键（漏一个英文 = 编译错，这里再钉一次运行期）', () => {
    const keys = Object.values(DOMAIN_LABEL_KEYS).slice().sort();
    expect(Object.keys(zhTable).filter((k) => k.startsWith('domain.')).sort()).toEqual(keys);
    expect(Object.keys(enTable).filter((k) => k.startsWith('domain.')).sort()).toEqual(keys);
  });

  it('★ zh 取值逐字等于 core `DOMAIN_LABELS`（「默认中文」零变化的机器保证）', () => {
    setLang('zh');
    for (const id of Object.keys(DOMAIN_LABELS) as Array<keyof typeof DOMAIN_LABELS>) {
      expect(zhTable[`domain.${id}`], `${id} 的两处中文不一致`).toBe(DOMAIN_LABELS[id]);
      expect(domainLabelKey(id), `${id} 在 zh 下与 core 口径不一致`).toBe(domainLabel(id));
    }
  });

  it('★ en 取值非空、不含汉字、且与中文不同（同一形态的「翻了没有」自证）', () => {
    setLang('en');
    for (const id of Object.keys(DOMAIN_LABELS) as Array<keyof typeof DOMAIN_LABELS>) {
      const en = domainLabelKey(id);
      expect(en.length, `${id} 的英文为空`).toBeGreaterThan(0);
      expect(en, `${id} 在英文下仍是中文`).not.toMatch(CJK);
      expect(en, `${id} 的英文与中文相同 ⇒ 等于没翻`).not.toBe(DOMAIN_LABELS[id]);
    }
  });

  it('★ 回落语义与 core 的 `domainLabel()` 同义：运行期冒出的未登记 id 两边都给 id 本身', () => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang);
      const ghost = 'ghost-domain' as never;
      expect(domainLabelKey(ghost)).toBe(String(ghost));
      expect(domainLabel(ghost)).toBe(String(ghost));
    }
  });
});

/* ══════════════════ ⑤ 真实调用点（生产入口给出来的领域） ══════════════════ */

describe('板块名 · ② 真实数据面：`getUsableDomains()` 的每个领域都能取到两种语言', () => {
  it('★ zh 下与 core 口径逐字一致；en 下不含汉字', () => {
    const domains = getUsableDomains();
    expect(domains.length, '可用领域为空 ⇒ 这条会 vacuous，先看夹具').toBeGreaterThan(0);
    setLang('zh');
    for (const d of domains) expect(domainLabelKey(d)).toBe(domainLabel(d));
    setLang('en');
    for (const d of domains) {
      expect(domainLabelKey(d), `${d} 在英文下仍是中文`).not.toMatch(CJK);
    }
  });

  it('★ 文案键真能被 `t()` 取到（不是只存在于表里）', () => {
    setLang('en');
    expect(t(DOMAIN_LABEL_KEYS.indoor)).toBe(domainLabelKey('indoor'));
    setLang('zh');
    expect(t(DOMAIN_LABEL_KEYS.indoor)).toBe('室内');
  });
});

/* ══════════════════ ⑥ 全仓清单：只剩 1 处裸调用（payload） ══════════════════ */

describe('板块名 · ③ ★ 全仓 `domainLabel(` 的调用点**恰好 1 处**（那是故意的 payload 点）', () => {
  it(`★ 唯一剩余处 = ${PAYLOAD_SITE}（发给外部 Agent 的 prompt）`, () => {
    const sites = domainLabelCallSites();
    expect(
      sites.map((s) => s.file),
      '屏幕侧出现了「没走消息表」的板块名 —— 英文界面上它会是中文。\n' +
        '新增屏幕点时请改用 `domainLabelKey()`（键表见 src/i18n/labels.ts）；\n' +
        `只有「拼给外部 Agent 的载荷」才允许继续用 \`domainLabel()\`（现登记：${PAYLOAD_SITE}）。`,
    ).toEqual([PAYLOAD_SITE]);
    expect(sites.length).toBe(1);
    expect(sites[0]!.line, '行号漂了 —— 说明那个文件被重构过，请复核仍是同一条 payload 拼接').toBeGreaterThan(0);
  });

  it('★ 该处确实是 payload 拼接（就在「所属行业：」那句 prompt 里，不是 JSX 文案）', () => {
    const src = readFileSync(join(ROOT, PAYLOAD_SITE), 'utf-8');
    expect(src).toContain('所属行业：${params.domain ? domainLabel(params.domain)');
    // 反向：该文件**没有**把 domainLabel 用在 JSX 里
    expect(src).not.toMatch(/\{[^}]*domainLabel\([^)]*\)[^}]*\}\s*</);
  });
});

/* ══════════════════ ⑦ 反应性：调用方必须自己订阅 ══════════════════ */

describe('板块名 · ④ ★ 反应性守卫：用了 `domainLabelKey` 的文件必须调 `useLang()`', () => {
  it('★ 屏幕侧全部已订阅（漏订阅 = 切英文后这块还是中文）', () => {
    /*
     * ⚠️ 判据是 **AST 级的调用点**，不是文本匹配：
     *   第一版直接 `includes('domainLabelKey(')`，把 `src/core/types/enums.ts` 里
     *   **注释中提到的**那个函数名也算成了"调用点" ⇒ 当场误报；
     *   改用 `maskComments` 后又把**定义它的** `src/i18n/labels.ts` 算了进来（多算 1 个）。
     *   ⇒ 正解是看「**被调用**」（`CallExpression` + 标识符），注释与定义天然都不算。
     */
    const consumers = [...new Set(callSitesOf('domainLabelKey').map((s) => s.file))].sort();
    expect(consumers.length, '用 domainLabelKey 的文件数变了 —— 请复核新那个是否订阅了 useLang()').toBe(8);
    const missing = consumers.filter(
      (rel) => !readFileSync(join(ROOT, rel), 'utf-8').includes('useLang()'),
    );
    expect(missing, '这些文件取词但不订阅语言变化 ⇒ 切语言时它们不重渲染').toEqual([]);
  });
});
