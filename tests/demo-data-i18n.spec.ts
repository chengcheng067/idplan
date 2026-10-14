// @vitest-environment node
/**
 * demo 演示数据 · **「有意不翻」的反向锁**（英文补齐批 · 段 5 之七 · 照 K21 形态）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这条锁在防什么
 * ══════════════════════════════════════════════════════════════════════
 * `src/core/demo/demoDataFactory.ts` 里的中文串（项目名 / 客户名 / 地址 / 成员名 / 预设名）
 * **有意不进消息表**（英文补齐批 · **裁 1**）。判定理由是**去路**，不是"看着像数据"：
 *   · 它们被打进 `buildDemoBackup()` 的 `BackupPackage`，过与真实备份同一套 zod 校验后**落库**；
 *     用户可以把它**导出成 JSON 抄进自己的数据** ⇒ **翻它等于让同一份演示数据在不同界面语言下内容不同**
 *     （导出、比对、像素回归全都会漂）。
 *   · `DEMO_PRESETS[].label` 更进一步：**生产侧零消费**（只有 tests 读）⇒ 翻它是标准的**假绿**。
 *
 * ⚠️ **「不翻」必须有会红的断言**（本批纪律，同族先例 = `tests/custom-library-hints-i18n.spec.ts`
 * 的 K21：那人那 7 串也是"有意不翻"，同样配了反向锁）。
 * 没有这条锁，下一个人扫到中文只会得出一个结论：**"漏翻了"**，然后重报一遍 —— 那是纯损耗。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 四条判据（前三条防"翻"，第四条防"上一屏就变界面文案"）
 * ══════════════════════════════════════════════════════════════════════
 *   ① **登记注释必须在**（删了 ⇒ 「不翻」变回口头约定）；
 *   ② **三类串仍是中文原值**（在**真产物** `buildDemoBackup()` 上断言，不是读源码字面量）；
 *   ③ **它们真的进了数据**（这条是②的**理由**被机器化：证明"是数据"不是自说自话）；
 *   ④ `DEMO_PRESETS[].label` **生产侧零消费**（AST 扫描 `src/**`，只有 tests 引用）——
 *      一旦有人把它接上界面，这条先红，那时它才真的需要翻。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep, posix } from 'node:path';
import ts from 'typescript';

import { buildDemoBackup, DEMO_PRESETS, demoPresetReadiness } from '../src/core/demo/demoDataFactory';

const ROOT = resolve(__dirname, '..');
const FACTORY = 'src/core/demo/demoDataFactory.ts';
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** 登记注释的**锚句**（改文案可以，但这句不许删 —— 它是「不翻是决定」的凭据） */
const REGISTRATION_ANCHOR = '本文件的中文**有意不翻**';

/* ══════════════ ① 登记注释在 ══════════════ */

describe('demo 数据 · ① 「有意不翻」的登记注释必须在（删了 = 又变口头约定）', () => {
  it('★ 文件头有登记锚句，且写清了判据是**去路**（「是数据不是界面文案」）', () => {
    const src = readFileSync(join(ROOT, FACTORY), 'utf-8');
    expect(src, `登记注释被删了（锚句：${REGISTRATION_ANCHOR}）`).toContain(REGISTRATION_ANCHOR);
    // 判据必须写的是「去路」而不是「它看起来像数据」
    expect(src, '登记没写「落库/可导出」这条去路判据').toContain('BackupPackage');
    expect(src, '没有指向反向锁 —— 下一个人找不到断言').toContain('tests/demo-data-i18n.spec.ts');
  });
});

/* ══════════════ ② 仍是中文原值（在真产物上断言） ══════════════ */

describe('demo 数据 · ② 三类串仍是中文原值（在**真产物** `buildDemoBackup()` 上断言）', () => {
  const pkg = buildDemoBackup();

  it('★ 5 个项目名 = 演示项目1..5（中文原值，翻了即红）', () => {
    expect(pkg.data.projects.map((p) => p.name).sort()).toEqual([
      '演示项目1',
      '演示项目2',
      '演示项目3',
      '演示项目4',
      '演示项目5',
    ]);
    for (const p of pkg.data.projects) expect(p.name, '演示项目名被翻了').toMatch(CJK);
  });

  it('★ 5 个客户名仍含中文且是中性化后的原值（不再出现真实甲方）', () => {
    const clients = pkg.data.projects.map((p) => p.clientName ?? '').filter((x) => x.length > 0);
    expect(clients.length).toBe(5);
    for (const c of clients) {
      expect(c, '客户名被翻了').toMatch(CJK);
      expect(c, '客户名不是中性化后的形态').toMatch(/^演示客户公司[甲乙丙丁戊]$/);
    }
  });

  it('★ 地址仍是「（演示地址）」——不出现任何真实街道/园区', () => {
    for (const p of pkg.data.projects) expect(p.address).toBe('（演示地址）');
  });

  it('★ 成员名仍是「角色 + 天干」形态（中文，且首字两两不同 —— 头像取 name[0]）', () => {
    const names = pkg.data.members.map((m) => m.name);
    for (const n of names) {
      expect(n, '成员名被翻了').toMatch(CJK);
      expect(n, `成员名不是「角色+天干」形态：${n}`).toMatch(/^[^演].+[甲乙丙丁戊]$/);
    }
    expect(new Set(names.map((n) => n[0])).size, '成员名首字有重复 ⇒ 五个头像字一样').toBe(names.length);
  });

  it('★ 预设名仍是那 5 个中文原值', () => {
    expect(DEMO_PRESETS.map((p) => p.label)).toEqual([
      '软件开发',
      '市场活动',
      '影视制作',
      '旅游出行',
      '室内设计',
    ]);
  });
});

/* ══════════════ ③ 「是数据」这条理由被机器化 ══════════════ */

describe('demo 数据 · ③ ★ 它们**真的进了数据**（这条是②的理由：不是"看着像数据"）', () => {
  it('★ 这些串出现在 `BackupPackage` 里 ⇒ 会被落库、可被用户导出抄进自己的 JSON', () => {
    const pkg = buildDemoBackup();
    // 项目名/客户名/地址落在 projects 上（= 落库字段，不是渲染期拼的）
    expect(pkg.data.projects.length).toBe(5);
    expect(pkg.data.projects.every((p) => typeof p.name === 'string' && p.name.length > 0)).toBe(true);
    // 成员名落在 members 上
    expect(pkg.data.members.length).toBeGreaterThan(0);
    // ⇒ 结论：翻它 = 同一份演示数据在不同界面语言下**内容不同**（导出/比对/像素回归都会漂）
  });
});

/* ══════════════ ④ 生产侧零消费（一旦接上界面，这条先红） ══════════════ */

describe('demo 数据 · ④ ★ `DEMO_PRESETS[].label` 生产侧**零消费**（接上界面时这里先红）', () => {
  it('★ AST 扫描 `src/**`：没有任何生产文件引用 `DEMO_PRESETS` 或 `demoPresetReadiness`', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) walk(abs);
        else if (/\.(ts|tsx)$/.test(name)) files.push(abs.slice(ROOT.length + 1).split(sep).join(posix.sep));
      }
    };
    walk(join(ROOT, 'src'));

    const consumers: string[] = [];
    for (const rel of files) {
      if (rel === FACTORY) continue; // 定义处自己不算消费
      const abs = join(ROOT, rel);
      const sf = ts.createSourceFile(
        abs,
        readFileSync(abs, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
        rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      let hit = false;
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && (n.text === 'DEMO_PRESETS' || n.text === 'demoPresetReadiness')) hit = true;
        ts.forEachChild(n, visit);
      };
      visit(sf);
      if (hit) consumers.push(rel);
    }

    expect(
      consumers,
      '有人把 demo 预设名接上界面了 ⇒ 它从「数据」变成「界面文案」，**该翻** —— ' +
        '那时请来改这条锁（而不是让它在英文界面上印中文）',
    ).toEqual([]);
    // 反向自证：判据不是恒真 —— 它在自己的定义文件里认得出这两个标识符
    const self = readFileSync(join(ROOT, FACTORY), 'utf-8');
    expect(self).toContain('DEMO_PRESETS');
    expect(self).toContain('demoPresetReadiness');
    // 且 `demoPresetReadiness()` 的返回值里确实带 label（将来若有人接它，④ 会红）
    expect(demoPresetReadiness()[0]).toHaveProperty('label');
  });
});
