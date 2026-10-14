// @vitest-environment node
/**
 * 消息表**分片**（英文补齐批的并行写入口）—— 注册守卫。
 *
 * ══════════════════════ 为什么有分片 ══════════════════════
 * 所有键都必须写进 `messages/{zh,en}.ts` ⇒ 物理上只能一个写者 ⇒ 剩余 700+ 条只能串行。
 * 分片后 4 个 worker 各写各的文件，**永不碰公共文件**。
 *
 * ══════════════════════ 本文件守住的三条安全网 ══════════════════════
 *   ① `Record<MessageKey, string>`（漏一个英文键 = **编译错**）对分片继续生效；
 *   ② `keyof typeof zhMessages` 仍是**字面量联合**（不是 `string`）；
 *   ③ 分片键**真的进了主表** —— 这一条是补 ② 的漏：
 *      分片若被注解成 `Record<string, string>`，TS 会在对象 spread 里**丢掉**下标签名
 *      ⇒ `keyof` **不会**退化成 `string`（所以「断言 keyof 不是 string」是**假锁**，实测不响），
 *      真实后果是那些键被**静默吞掉**、`en.ts` 也不再要求它们。
 *      编译期那一半钉在 `src/i18n/messages/zh.ts` 末尾的 `_ShardKeysLiteral`（变异 M2a/M2b 实测会红）；
 *      这里的运行时断言是另一半（本文件「每个键都真的进了主表」那条）。
 *
 * 变异自证（四条，实测读数见提交说明）：
 *   M1 分片 zh 加键、en 不加      → `en.ts` TS2741 缺键       ✅
 *   M2a 空分片加 `Record<…>` 注解 → `zh.ts` TS2322 never      ✅
 *   M2b 注解 + 有键               → `zh.ts` TS2322 never      ✅
 *   M3 正解 `as const` + 有键     → `en.ts` TS2741 缺键       ✅
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MESSAGE_KEYS, catalogOf } from '../src/i18n';
import { maskComments } from './helpers/cjk-locator-guard';
import { en as coreEn, zh as coreZh } from '../src/i18n/messages/parts/core';
import { en as miscEn, zh as miscZh } from '../src/i18n/messages/parts/misc';
import { en as printEn, zh as printZh } from '../src/i18n/messages/parts/print-ui';
import { en as uiEn, zh as uiZh } from '../src/i18n/messages/parts/ui';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/** 4 个分片（**恰好 4 个**；顺序即 spread 顺序，别改） */
const SHARDS = [
  { id: 'ui', rel: 'src/i18n/messages/parts/ui.ts', zh: uiZh, en: uiEn },
  { id: 'print-ui', rel: 'src/i18n/messages/parts/print-ui.ts', zh: printZh, en: printEn },
  { id: 'core', rel: 'src/i18n/messages/parts/core.ts', zh: coreZh, en: coreEn },
  { id: 'misc', rel: 'src/i18n/messages/parts/misc.ts', zh: miscZh, en: miscEn },
] as const;

const ZH = 'src/i18n/messages/zh.ts';
const EN = 'src/i18n/messages/en.ts';

/** 主表**内联**键（分片键不住在这两个文件里）。形状：行首**正好两个空格** + `'键':` */
function inlineKeys(rel: string): string[] {
  return [...read(rel).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]!);
}

describe('分片注册 · 4 片齐、两列齐、职责与目录对应', () => {
  it('★ 恰好这 4 个分片（增删分片要同批看本文件与 zh.ts 的 spread 顺序）', () => {
    expect(SHARDS.map((s) => s.id)).toEqual(['ui', 'print-ui', 'core', 'misc']);
    for (const s of SHARDS) expect(read(s.rel).length, `${s.id} 分片不存在或为空`).toBeGreaterThan(0);
  });

  it('★ 每个分片都导出 `zh` 与 `en` 两个对象', () => {
    for (const s of SHARDS) {
      expect(typeof s.zh, `${s.id}.zh`).toBe('object');
      expect(typeof s.en, `${s.id}.en`).toBe('object');
    }
  });

  it('★ 每个分片：zh 键集 === en 键集（一片之内两列必须齐）', () => {
    for (const s of SHARDS) {
      expect(Object.keys(s.en).sort(), `${s.id} 分片 zh/en 键集不一致`).toEqual(
        Object.keys(s.zh).sort(),
      );
    }
  });

  it('★ 分片源码形态：一律 `as const`、不许 `Record<string, …>` 宽注解', () => {
    for (const s of SHARDS) {
      // 剥注释后再判：分片头部**故意**写了 `Record<string, string>` 当反面教材，
      // 不剥注释的话守卫会被自己的说明文字绊倒（本仓既有坑，见 maskComments 的用法纪律）
      const code = maskComments(read(s.rel));
      expect(code, `${s.id} 分片少了 as const`).toMatch(/as const;/);
      expect(
        code,
        `${s.id} 分片出现宽注解 —— 键会被 spread 静默吞掉，「漏一个英文键=编译错」对该片失效`,
      ).not.toMatch(/Record<\s*string\s*,/);
    }
  });
});

describe('分片注册 · 键的完整性（三条：进了表 / 没吞 / 没撞）', () => {
  it('★ 分片里的每个键都**真的进了** `zhMessages`（防「注解把键静默吞掉」）', () => {
    const table = new Set<string>(MESSAGE_KEYS);
    for (const s of SHARDS) {
      const lost = Object.keys(s.zh).filter((k) => !table.has(k));
      expect(lost, `${s.id} 分片里有键没进 zhMessages（多半是给分片加了宽注解）`).toEqual([]);
    }
  });

  it('★ 分片里的每个 en 键都**真的进了** `enMessages`', () => {
    const table = new Set(Object.keys(catalogOf('en')));
    for (const s of SHARDS) {
      const lost = Object.keys(s.en).filter((k) => !table.has(k));
      expect(lost, `${s.id} 分片里有 en 键没进 enMessages`).toEqual([]);
    }
  });

  it('★ 分片之间不许撞键（撞了 = 后 spread 的静默覆盖，界面上看不出来）', () => {
    const all = SHARDS.flatMap((s) => Object.keys(s.zh));
    const dup = all.filter((k, i) => all.indexOf(k) !== i);
    expect(dup, '两个分片写了同一个键 —— 按「同一个词只建一个键」合并到一片里去').toEqual([]);
  });

  it('★ 分片不许与主表内联键撞键（同样是静默覆盖）', () => {
    const inline = new Set([...inlineKeys(ZH), ...inlineKeys(EN)]);
    expect(inline.size, '内联键扫描面空了 ⇒ 这条会空过').toBeGreaterThan(100);
    for (const s of SHARDS) {
      const dup = Object.keys(s.zh).filter((k) => inline.has(k));
      expect(dup, `${s.id} 分片与主表内联键重名`).toEqual([]);
    }
  });

  it('★ 装配没漏没重：`主表键集` === `内联键 ∪ 4 片键`', () => {
    const inline = new Set([...inlineKeys(ZH), ...inlineKeys(EN)]);
    const shard = new Set(SHARDS.flatMap((s) => Object.keys(s.zh)));
    const union = new Set([...inline, ...shard]);
    expect(union.size, '内联与分片有交集 ⇒ 有键被静默覆盖').toBe(inline.size + shard.size);
    expect(union.size, '主表键数与「内联 ∪ 分片」对不上 ⇒ 分片没被 spread 进表').toBe(
      MESSAGE_KEYS.length,
    );
  });
});
