/**
 * i18n · 拆句拼接守卫的**判别力夹具**（2026-10-14）。
 *
 * 与 `tests/cjk-locator-guard.spec.ts` 同一套纪律：核心是纯函数，判别力**只能靠离散
 * 夹具证明**（正的必中、负的必不中）；再加一条**变异自证**证明全仓扫描真的走在那些接缝上。
 *
 * 判据与边界写在 `tests/helpers/i18n-jsx-space.ts` 的文件头，这里只钉行为。
 */
import { describe, it, expect } from 'vitest';

import { catalogOf } from '../src/i18n';
import { checkJsxSpacing, needsSpaceEn, scanRepoJsxSpacing } from './helpers/i18n-jsx-space';

/** 夹具用的小消息表（键名与取值都刻意做得像真句子） */
const FIX: Record<string, string> = {
  a: 'The Agent board currently',
  b: 'only carries schedules from external writers',
  c: 'This area is being redefined.',
  d: 'Status: local auto-import works',
  e: 'NAS remote write is not enabled yet',
};

const wrap = (...lines: string[]): string =>
  ['export function F({ t }: { t: (k: string) => string }) {', '  return (', ...lines, '  );', '}'].join(
    '\n',
  );

describe('拆句拼接 · 空格规则本身（`needsSpace`）', () => {
  it('英文：两个词字符相撞 ⇒ 需要空格', () => {
    expect(needsSpaceEn('currently', 'only carries')).toBe(true);
    expect(needsSpaceEn('writers', '(local auto-import')).toBe(true);
    // 闭合引号 + 词：`…“My Projects”.` + `You can` —— 也要空格
    expect(needsSpaceEn('never mixed with “My Projects”.', 'You can')).toBe(true);
  });

  it('英文：接缝落在标点上 ⇒ 不需要空格（这是「不误报」的口子）', () => {
    expect(needsSpaceEn('local mode', ', click below')).toBe(false);
    expect(needsSpaceEn('with no undo', '. Save a backup first.')).toBe(false);
    expect(needsSpaceEn('the token is', ') ')).toBe(false);
    expect(needsSpaceEn('On Windows, in ', 'local mode')).toBe(false);
    expect(needsSpaceEn('everything a writer needs (', 'address / token')).toBe(false);
  });
});

describe('拆句拼接 · 渲染文本流（读 esbuild 真产出的 children）', () => {
  const en = catalogOf('en');

  it('① 相邻表达式容器之间 **没有任何空白**（这就是缺陷的来源）', () => {
    const src = wrap('    <span>', "      {t('a')}", '      <strong>{t(\'b\')}</strong>', '    </span>');
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.runs[0]?.text).toBe(FIX['a'] + FIX['b']);
  });

  it('② 同一个 JSXText 内部的换行 **被折成一个空格**（中文现状就靠它）', () => {
    const src = wrap('    <span>', '      排期文件。', '      Windows 版本还支持', '    </span>');
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: {}, lang: 'zh' });
    expect(r.runs[0]?.text, '换行折成空格 —— 中文态的句间空格就是这么来的').toBe(
      '排期文件。 Windows 版本还支持',
    );
  });

  it('③ `{\' \'}` 显式空格：两种语言都生效（句间衔接用）', () => {
    const src = wrap(
      '    <span>',
      "      {t('a')}",
      "      {' '}",
      "      {t('d')}",
      '    </span>',
    );
    for (const lang of ['zh', 'en'] as const) {
      const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang });
      expect(r.issues, `${lang} 侧不该有命中`).toEqual([]);
    }
  });

  it('④ 行内嵌套（span > strong）照样判：内层接缝也在同一条文本流里', () => {
    const src = wrap(
      '    <span>',
      "      {t('a')}",
      "      <strong>{t('b')}{t('e')}</strong>",
      '    </span>',
    );
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    const pairs = r.issues.filter((i) => i.kind === 'glued').map((i) => `${i.leftKey}|${i.rightKey}`);
    expect(pairs, '`{t(a)}{t(b)}` 与 `{t(b)}{t(e)}` 两处都要命中（且不重复报）').toEqual([
      'a|b',
      'b|e',
    ]);
  });
});

describe('拆句拼接 · 该红的红、不该红的不红', () => {
  it('★ 正例：英文取值没有尾随空格 ⇒ 命中 `glued`', () => {
    const src = wrap('    <span>', "      {t('a')}", '      <strong>{t(\'b\')}</strong>', '    </span>');
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.issues.map((i) => i.kind)).toEqual(['glued']);
    expect(r.issues[0]?.leftKey).toBe('a');
    expect(r.issues[0]?.rightKey).toBe('b');
    expect(r.issues[0]?.left, '整段左值都带出来，便于人眼确认拼接结果').toBe(FIX['a']);
    // 报错文案里的片段**截断到 32 字**（免得刷屏），故这里用 startsWith 关系判
    expect(FIX['b']!.startsWith(r.issues[0]!.right)).toBe(true);
  });

  it('★ 负例：同一段话，英文取值补上尾随空格 ⇒ 不命中', () => {
    const src = wrap('    <span>', "      {t('a')}", '      <strong>{t(\'b\')}</strong>', '    </span>');
    const fixed = { ...FIX, a: `${FIX['a']} ` };
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: fixed, lang: 'en' });
    expect(r.issues).toEqual([]);
  });

  it('★ 负例：中文态同样的接缝 **不该红**（中文之间不加空格是对的）', () => {
    const src = wrap('    <span>', "      {t('a')}", '      <strong>{t(\'b\')}</strong>', '    </span>');
    const zhFix = { a: 'Agent 看板目前', b: '只承接外部写入方的排期' };
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: zhFix, lang: 'zh' });
    expect(r.runs[0]?.text, '拼接结果确实是粘在一起的').toBe('Agent 看板目前只承接外部写入方的排期');
    expect(r.issues, '中文之间不加空格 ⇒ 不是问题').toEqual([]);
  });

  it('★ 正例：中文态里 **拉丁-拉丁** 相撞仍要红（两个英文词粘在一起）', () => {
    const src = wrap('    <span>', "      {t('a')}", '      <strong>{t(\'b\')}</strong>', '    </span>');
    const zhFix = { a: 'ID Plan', b: 'Pro 版' };
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: zhFix, lang: 'zh' });
    expect(r.issues.map((i) => i.kind)).toEqual(['glued']);
  });

  it('★ 负例：中文态里「中文接拉丁」**不红**（`WorkBuddy 通道` 这种混排不加空格是对的）', () => {
    const src = wrap('    <span>', "      {t('a')}", '      <strong>{t(\'b\')}</strong>', '    </span>');
    const zhFix = { a: '当前选中的', b: 'WorkBuddy 通道' };
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: zhFix, lang: 'zh' });
    expect(r.issues).toEqual([]);
  });

  it('★ 负例：块级容器（`<div>`/`<p>`）切断文本流 ⇒ 不跨着判（不误报）', () => {
    const src = wrap(
      '    <div>',
      "      <p>{t('a')}</p>",
      "      <p>{t('d')}</p>",
      '    </div>',
    );
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.issues, '两块之间视觉上各成一行，判它缺空格是误报').toEqual([]);
    expect(r.unchecked, '但要**透明地报出来**：这两处没判').toBeGreaterThan(0);
  });

  it('★ 负例：条件表达式/变量切断文本流 ⇒ 不判', () => {
    const src = wrap('    <span>', "      {t('a')}", '      {flag ? 1 : 2}', "      {t('d')}", '    </span>');
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.issues).toEqual([]);
  });

  /*
    ★ 块级边界 · **按 class 判**（2026-10-14 · 笔 1-⑤ 实测踩出来的误报，配对夹具）
    现场：`RestPolicyRecalcDialog.tsx` 的到期日对齐勾选块 ——
        <span>
          <span className="font-medium text-ink">{t('…label')}</span>
          <span className="mt-0.5 block text-xs text-mist">{t('…hint')}</span>
        </span>
    上方那条既有夹具只按**标签名**判块级（`<p>`/`<div>`）；而**同一个 `<span>` 加一个
    `block` 类**同样是块级格式化上下文 ⇒ 两个子项不共行，跨过去判「缺空格」是误报。
    中文态原先看不见它（两侧都是中文字面量 ⇒ `keys.length === 0` 直接不判），
    **两侧改走 `t()` 之后才被判出来** —— 所以这两条必须成对：
      ① 带 `block` ⇒ 必须不红（否则现场那条会一直假红）；
      ② 把 `block` 去掉、形状其余全同 ⇒ **必须红**（否则 ① 是个空过判据，
         将来有人把边界写宽了也没人发现）。
  */
  it('★ 负例：`class="… block …"` 的子项 = 块级边界 ⇒ 跨它的接缝不判（不误报）', () => {
    const src = wrap(
      '    <span>',
      "      <span className=\"font-medium\">{t('a')}</span>",
      "      <span className=\"mt-0.5 block text-xs\">{t('b')}</span>",
      '    </span>',
    );
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.issues, '两块视觉上各成一行，判它缺空格是误报').toEqual([]);
    expect(r.unchecked, '但要**透明地报出来**：这条接缝没判').toBeGreaterThan(0);
  });

  it('★ 判别力：同一形状**去掉 block** ⇒ 必须红（否则上一条是空过判据）', () => {
    const src = wrap(
      '    <span>',
      "      <span className=\"font-medium\">{t('a')}</span>",
      "      <span className=\"mt-0.5 text-xs\">{t('b')}</span>",
      '    </span>',
    );
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.issues.map((i) => i.kind)).toEqual(['glued']);
    expect(r.issues[0]?.leftKey).toBe('a');
    expect(r.issues[0]?.rightKey).toBe('b');
  });

  /*
    ★ 边界 · **正向夹具**（team-lead 批 (A) 时的护栏第 3 条）：
      「不含 inline-block / inline-flex / contents」这句**不能只写在注释里** ——
      要变成**会红的断言**。否则以后有人顺手把某个类加进 `BLOCK_LAYOUT`，
      **没有任何东西会红**，而那正是本表腐化成白名单的第一步。
    判据：这几个类**都不脱流**（`inline-*` 仍在行内流里与相邻文字共行；
    `contents` 让子项参与父级流）⇒ 跨它们的接缝**该判**（`glued`）。
  */
  for (const cls of ['inline-block', 'inline-flex', 'inline-grid', 'contents']) {
    it(`★ 边界：\`${cls}\` **不算**块级边界（不脱流 ⇒ 那里的接缝该判）`, () => {
      const src = wrap(
        '    <span>',
        `      <span className="${cls}">{t('a')}</span>`,
        `      <span className="${cls}">{t('b')}</span>`,
        '    </span>',
      );
      const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
      expect(r.issues.map((i) => i.kind), `${cls} 被误当成块级边界 ⇒ 接缝漏判`).toEqual(['glued']);
    });
  }
});

describe('拆句拼接 · 同一条文本流里混着硬编码中文（英文态会露中文）', () => {
  it('★ 正例：`{t()}` 与硬编码中文在同一段 ⇒ 命中 `mixed-cjk`', () => {
    const src = wrap('    <span>', "      {t('a')}", '      手动粘贴或拖入', '    </span>');
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.issues.map((i) => i.kind)).toContain('mixed-cjk');
  });

  it('★ 负例：整块中文（这一段里没有 `t()`）⇒ 不命中（还没翻的页面不该被扫红）', () => {
    const src = wrap('    <span>', '      预算合计', '      实际合计', '    </span>');
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'en' });
    expect(r.issues).toEqual([]);
  });

  it('★ 负例：中文态出现中文 ⇒ 当然不命中', () => {
    const src = wrap('    <span>', "      {t('a')}", '      手动粘贴或拖入', '    </span>');
    const r = checkJsxSpacing({ file: 'f.tsx', source: src, catalog: FIX, lang: 'zh' });
    expect(r.issues).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 全仓扫描（零豁免） + 变异自证
 *   零豁免的代价是**它必须真的走在那些接缝上**，否则"零命中"可能只是没扫到。
 *   下面这条变异自证就是付这个代价：把仓库里某个**真实接缝**上的尾随空格抹掉，
 *   扫描必须从 0 变 >0，且命中的正是那个键。
 * ══════════════════════════════════════════════════════════════════════ */
describe('拆句拼接 · 全仓扫描（零豁免）', () => {
  const en = catalogOf('en') as unknown as Record<string, string>;
  const zh = catalogOf('zh') as unknown as Record<string, string>;

  const fmt = (issues: ReturnType<typeof scanRepoJsxSpacing>): string =>
    issues.map((i) => `  [${i.kind}] ${i.file}:${i.line}  「${i.left}」+「${i.right}」`).join('\n');

  it('★ en 侧：全仓零命中', () => {
    const issues = scanRepoJsxSpacing(process.cwd(), en, 'en');
    expect(issues.length, `英文态拆句拼接问题：\n${fmt(issues)}`).toBe(0);
  });

  it('★ zh 侧：全仓零命中', () => {
    const issues = scanRepoJsxSpacing(process.cwd(), zh, 'zh');
    expect(issues.length, `中文态拆句拼接问题：\n${fmt(issues)}`).toBe(0);
  });

  it('★ 变异自证：抹掉 `agent.stanceBefore` 的尾随空格 ⇒ 必须报出来', () => {
    const target = 'agent.stanceBefore';
    const fixed = en[target]!;
    const mutated = fixed.replace(/ $/, '');
    expect(mutated, '变异必须真的改动取值（否则下面那条是在自欺）').not.toBe(fixed);
    expect(mutated.length).toBe(fixed.length - 1);

    const issues = scanRepoJsxSpacing(process.cwd(), { ...en, [target]: mutated }, 'en');
    expect(issues.length, '抹掉空格后必须由「零命中」变成「有命中」').toBeGreaterThan(0);
    expect(
      issues.some((i) => i.leftKey === target),
      `命中的应是 AgentBoardPage 的那处接缝，实际：\n${fmt(issues)}`,
    ).toBe(true);
  });
});
