/**
 * 分界表笔（第一段）· 裁 1（示例数据不翻）+ 裁 2（六串走 `id` 当键）的**语言契约**（新 spec）。
 *
 * ══════════════════ 两份裁定的机器化 ══════════════════
 * **裁 1**：G1 的 7 串示例数据**有意不翻**（它们会被用户抄进自己的 JSON ⇒ 是数据不是界面文案）
 *   ⇒ 配套 **K21 反向断言**：那 7 串必须**仍是中文原值**（翻了即红）。
 * **裁 2**：G8 六串 ⇒ `CustomLibraryErrorHint` **只留 `id`**（`id` 就是现成的键），
 *   文案在消息表（键 `customLibrary.hint.<id>.title` / `.fix`）。
 *   硬线：**6 条 zh 取值必须与改动前的 `title` / `fix` 中文逐字相同** ——
 *   下表里的期望值是**改前从源码抄下来的原值**做基准（不是改后重算；重算只能证明「自己等于自己」）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CUSTOM_LIBRARY_ERROR_HINTS,
  CUSTOM_LIBRARY_MINIMAL_EXAMPLE,
  type CustomLibraryErrorHintId,
} from '../src/core/template/custom-library.prompt';
import { CUSTOM_LIBRARY_KEY_PREFIX } from '../src/core/template/custom-library.schema';
import {
  CUSTOM_LIBRARY_HINT_KEYS,
  catalogOf,
  customLibraryHintLabel,
  type InterpolationVars,
} from '../src/i18n';
import { maskComments } from './helpers/cjk-locator-guard';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');
const PROMPT = 'src/core/template/custom-library.prompt.ts';

/* ══════════ 裁 2 · zh 逐字：**改前基准**（下面 right 一列是改前从源码抄下来的原值） ══════════ */

const BASELINE: ReadonlyArray<{
  id: CustomLibraryErrorHintId;
  part: 'title' | 'fix';
  vars?: InterpolationVars;
  before: string;
}> = [
  // ── 改前：id:'json-only', title/fix 两个字段（`custom-library.prompt.ts` 旧版 :293-294）──
  { id: 'json-only', part: 'title', before: 'Agent 多输出了说明文字，不是纯 JSON' },
  {
    id: 'json-only',
    part: 'fix',
    before: '回到 Agent 回复里，从第一个 { 复制到最后一个 }，存成 .json 再导入。',
  },
  // ── 改前：id:'key-prefix'（:298-299）；fix 是模板串，改前**渲染结果**带前缀 `usr.` ──
  { id: 'key-prefix', part: 'title', before: '阶段 key 忘了 usr. 前缀' },
  {
    id: 'key-prefix',
    part: 'fix',
    vars: { prefix: CUSTOM_LIBRARY_KEY_PREFIX },
    before: '所有 key 都要以 usr. 开头，如 usr.site。',
  },
  // ── 改前：id:'dangling-reference'（:303-304）──
  { id: 'dangling-reference', part: 'title', before: '套餐引用了本包没有的阶段 key' },
  {
    id: 'dangling-reference',
    part: 'fix',
    before: '检查每个套餐 itemKeys 里的 key，是否都写进了同一个文件的阶段里。',
  },
];

describe('裁 2 · 六串 zh 与**改前原值**逐字相同（硬线：界面零变化）', () => {
  it.each(BASELINE)('$id.$part → «$before»', ({ id, part, vars, before }) => {
    expect(customLibraryHintLabel(id, part, vars)).toBe(before);
  });

  it('★ 字面大括号没被 `t()` 当占位符（`json-only.fix` 里那对 `{ }` 必须原样渲染）', () => {
    const text = customLibraryHintLabel('json-only', 'fix');
    expect(text).toContain('从第一个 { 复制到最后一个 }');
  });

  it('★ 前缀是**参数**（换一个前缀值 ⇒ 取值跟着换，而不是写死在文案里）', () => {
    expect(customLibraryHintLabel('key-prefix', 'fix', { prefix: 'zz.' })).toBe(
      '所有 key 都要以 zz. 开头，如 zz.site。',
    );
  });
});

/* ══════════ 裁 2 · 双向集合相等（K12 + K14） ══════════ */

/** 三张卡在结构里注册的 id（从**结构**反推，不是手抄） */
const structuralIds = CUSTOM_LIBRARY_ERROR_HINTS.map((h) => h.id).sort();
/** 键表的 id 集 */
const tableIds = Object.keys(CUSTOM_LIBRARY_HINT_KEYS).sort();
/** zh 表里 `customLibrary.hint.*` 键反解出的 id（`customLibrary.hint.<id>.<part>`） */
const catalogIds = [
  ...new Set(
    Object.keys(catalogOf('zh'))
      .filter((k) => k.startsWith('customLibrary.hint.'))
      .map((k) => k.slice('customLibrary.hint.'.length).replace(/\.(title|fix)$/, '')),
  ),
].sort();

describe('裁 2 · id ↔ 键表 ↔ 消息表：三处集合两两相等（少一个 id ⇒ 卡渲染成码；多一个键 ⇒ 死词条）', () => {
  it('★ 结构里的 id 集 === 键表的 id 集', () => {
    expect(structuralIds, '结构里新增了卡但键表没跟上 / 键表里有没人用的卡').toEqual(tableIds);
  });

  it('★ 键表反解出的 id 集 === zh 表里 `customLibrary.hint.*` 的 id 集', () => {
    expect(catalogIds).toEqual(tableIds);
  });

  it('每个 id 都同时有 `.title` 与 `.fix` 两条键（不许只翻一半）', () => {
    const zh = catalogOf('zh');
    for (const id of structuralIds) {
      for (const part of ['title', 'fix'] as const) {
        const key = CUSTOM_LIBRARY_HINT_KEYS[id]?.[part];
        expect(key, `${id} 缺 ${part} 键`).toBeTruthy();
        expect(zh[key!]?.length ?? 0, `${id}.${part} 的 zh 取值为空`).toBeGreaterThan(0);
      }
    }
  });

  it('三张卡都是静态的（导入失败时同时出现）——id 顺序保持不变', () => {
    expect(CUSTOM_LIBRARY_ERROR_HINTS.map((h) => h.id)).toEqual([
      'json-only',
      'key-prefix',
      'dangling-reference',
    ]);
  });
});

/* ══════════ 裁 1 · K21 反向断言：7 串示例数据仍是中文原值 ══════════ */

describe('裁 1 · 示例数据 7 串**有意不翻**（K21：不翻的决定要有会红的断言）', () => {
  it('★ 7 串仍是中文原值（谁把它们翻了/改成英文 ⇒ 当场红）', () => {
    expect(CUSTOM_LIBRARY_MINIMAL_EXAMPLE.name).toBe('我的茶空间流程');
    expect(CUSTOM_LIBRARY_MINIMAL_EXAMPLE.items.map((i) => i.name)).toEqual(['选址', '开业筹备']);
    expect(CUSTOM_LIBRARY_MINIMAL_EXAMPLE.items[0]?.defaultTasks).toEqual(['看场', '谈租金']);
    expect(CUSTOM_LIBRARY_MINIMAL_EXAMPLE.presets.map((p) => p.name)).toEqual(['茶空间全流程']);
    expect(CUSTOM_LIBRARY_MINIMAL_EXAMPLE.presets[0]?.description).toBe('从选址到开业的最小闭环');
  });

  it('源码里留着「有意不翻」的登记注释（含牵片面：industry-neutral-copy 那条锁）', () => {
    // 用**原文**断言（maskComments 会把注释抹白）
    const src = read(PROMPT);
    expect(src, '登记注释被删了 ⇒ 「不翻」又变回口头约定').toContain('有意不翻（载荷示例数据）');
    expect(src, '牵片面（industry-neutral-copy）必须写在注释里').toContain('industry-neutral-copy');
  });
});

/* ══════════ 裁 2 · 结构锁：core 只留 id（不许把文案搬进 core） ══════════ */

describe('裁 2 · 结构锁：core 侧只留结构、零 i18n', () => {
  const code = maskComments(read(PROMPT));

  it('★ 预告卡结构里**没有** `title` / `fix` 字段（只剩 `id`）', () => {
    expect(code, 'core 里又长出文案字段了').not.toMatch(/title:\s*'/);
    expect(code, 'core 里又长出文案字段了').not.toMatch(/fix:\s*'/);
  });

  it('★ core 侧零 i18n：没有 `t(` 调用、也没有 i18n import', () => {
    expect(code, 'core 里出现了取词调用').not.toMatch(/[^.\w]t\(/);
    expect(code).not.toMatch(/from\s+'[^']*i18n/);
    expect(code).not.toMatch(/require\([^)]*i18n/);
  });

  it('★ 组件用 `customLibraryHintLabel(h.id, …)` 渲染（调用形状，不是「文件里出现过某字面量」）', () => {
    const ui = maskComments(read('src/components/settings/CustomLibrarySection.tsx'));
    expect(ui).toMatch(/customLibraryHintLabel\(h\.id, 'title'\)/);
    expect(ui).toMatch(/customLibraryHintLabel\(h\.id, 'fix'/);
    expect(ui, '前缀必须当参数传（不许在文案里写死）').toMatch(
      /customLibraryHintLabel\(h\.id, 'fix'[\s\S]{0,60}?prefix:\s*CUSTOM_LIBRARY_KEY_PREFIX/,
    );
  });

  it('未知 id 原样回显 id（**不写中文兜底**）', () => {
    expect(customLibraryHintLabel('nope-unknown', 'title')).toBe('nope-unknown');
  });

  it('en 侧 6 条都有取值、且不含汉字', () => {
    const en = catalogOf('en');
    for (const id of structuralIds) {
      for (const part of ['title', 'fix'] as const) {
        const key = CUSTOM_LIBRARY_HINT_KEYS[id]![part];
        expect(en[key].length, `${key} 英文为空`).toBeGreaterThan(0);
        expect(/[\u4e00-\u9fff]/.test(en[key]), `${key} 英文里混了汉字`).toBe(false);
      }
    }
  });
});
