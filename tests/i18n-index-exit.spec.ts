/**
 * i18n · **`src/i18n/index.ts` 这条装配出口**的锁（2026-10-15 · 分片复核补）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 分工（2026-10-15 拆开，**两边各留一句，免得住一处静默不覆盖**）
 * ══════════════════════════════════════════════════════════════════════
 *   本文件核的是**取词出口与真相源**（`catalogOf` 是不是同一份引用、`MESSAGE_KEYS` 与
 *   `catalogOf('zh')` 是否逐序相等、`MessageKey` 有没有退化成 `string`）；
 *   **分片装配**（四片齐不齐 / 键进没进主表 / 两片撞不撞 / 每片 zh↔en 成不成对）另见
 *   `tests/i18n-messages-parts.spec.ts` —— 那三条**全绿也不能推出本文件这三条**，
 *   反之亦然。**改任一侧前请先看另一侧。**
 *
 * 为什么单独一个文件：`tests/i18n-messages-parts.spec.ts` 是**四个分片 worker 共用**的文件
 * （本批纪律 C：同一文件一个写者，不得顺手改），且「出口」与「装配」是两件事 ——
 * 混在一处会让「哪条红说明什么」变模糊。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么这条出口此前没人核、以及为什么不能只靠「读源码」
 * ══════════════════════════════════════════════════════════════════════
 * 分片机制有**三条**出口链，前两条已有人钉：
 *   ① `messages/zh.ts` 的 spread 与 `_ShardKeysLiteral` 断言 —— 钉在 `zh.ts` 自己；
 *   ② `messages/en.ts` 的 `Record<MessageKey, string>` 完整性 —— 钉在 `en.ts` 自己 +
 *      `tests/i18n-messages-parts.spec.ts`（每片 zh 键集 === en 键集，@:68）。
 *   ③ **`src/i18n/index.ts`**（`catalogOf` / `MESSAGE_KEYS` / `MessageKey`）—— 直到
 *      2026-10-15 的独立复核才发现**这条没人核**：它是全仓唯一的取词出口，
 *      若它与总表脱钩（返回副本、返回别的表、或 `MessageKey` 退化成 `string`），
 *      上面两条**都照样绿**。
 *
 * ⚠️ 且这条出口**不能靠「读源码看到 `export { … } from './translate'`」证明** ——
 *    那只能证明「有这个重导出」，证明不了「拿到的就是总表本身」。
 *    本题用**运行期真表**比对（引用同一性 + 键集/取值逐键相等），
 *    并用**编译期断言**钉 `MessageKey` 没有退化。
 *    为什么另开一个文件而不是改 `tests/i18n-messages-parts.spec.ts`：那是四个分片
 *    worker 共用的文件（同一文件一个写者），本批纪律不许顺手改。
 *
 * 三件事各一条断言，缺一不可：
 *   a. `catalogOf('zh')` 与 `zhMessages` **是同一份引用**（不是副本 ⇒ 没有第三个真相源）；
 *   b. `MESSAGE_KEYS` 与 `catalogOf('zh')` 的键**逐序相等**，且 `catalogOf('en')` 的键集相等；
 *   c. `MessageKey` **未退化成 `string`**（编译期断言；退化了本文件直接编译不过）。
 */
import { describe, it, expect } from 'vitest';

import { MESSAGE_KEYS, catalogOf, isMessageKey, t, type MessageKey } from '../src/i18n';
import { zhMessages } from '../src/i18n/messages/zh';
import { enMessages } from '../src/i18n/messages/en';

/* ────────────────────────── c. 编译期断言：MessageKey 仍是字面量联合 ──────────────────────────
 *
 * 与 `zh.ts` 末尾 `_ShardKeysLiteral` 同一手法（**故意**不写成「运行时看一看」）：
 *   · 若 `MessageKey` 退化成 `string` ⇒ `string extends MessageKey` 为真 ⇒ 结果是 `never`
 *     ⇒ `const x: never = true` 当场编译错；
 *   · 正常形态结果是 `true`，赋 `true` 合法。
 * ⚠️ 它只在 `npx tsc --noEmit -p tsconfig.tests.json`（或 `typecheck:all`）里生效 ——
 *    本仓 `tsconfig.json` 的 include 是 `["src","templates"]`、**exclude 含 `tests`**
 *    ⇒ 只跑 `npm run typecheck` **看不见**本断言（这条口径 2026-10-15 复核时登记过）。
 */
type _LiteralUnion<T extends string> = string extends T ? never : true;
const _keyofNotString: _LiteralUnion<MessageKey> = true;
void _keyofNotString;

/* ────────────────────────── 运行期断言 ────────────────────────── */

describe('i18n 装配出口 · index.ts（`catalogOf` / `MESSAGE_KEYS` / `MessageKey`）', () => {
  it('a. `catalogOf` 返回的就是总表本身（引用同一 ⇒ 不存在第三个真相源）', () => {
    expect(catalogOf('zh'), '`catalogOf("zh")` 必须是 `zhMessages` 本体，不许是副本').toBe(zhMessages);
    expect(catalogOf('en'), '`catalogOf("en")` 必须是 `enMessages` 本体，不许是副本').toBe(enMessages);
  });

  it('b1. `MESSAGE_KEYS` 与 `catalogOf("zh")` 的键**逐序相等**（顺序即声明序，也是 `MESSAGE_KEYS` 的契约）', () => {
    expect(MESSAGE_KEYS).toEqual(Object.keys(catalogOf('zh')));
    expect(MESSAGE_KEYS.length, '空表会本断言恒过 ⇒ 先钉住非空下界').toBeGreaterThan(1000);
  });

  it('b2. 两列键集完全相等（多一个 / 少一个都红，且点名键）', () => {
    const zh = new Set<string>(MESSAGE_KEYS);
    const en = new Set(Object.keys(catalogOf('en')));
    const missingInEn = [...zh].filter((k) => !en.has(k));
    const excessInEn = [...en].filter((k) => !zh.has(k));
    expect(missingInEn, 'en 少键（tsc 会先报，这里是运行期第二道）').toEqual([]);
    expect(excessInEn, 'en 多键 —— ← 这一支 **tsc 抓不到**（spread 进来的属性不过 excess 检查）').toEqual([]);
  });

  it('b3. `isMessageKey` 与真表一致（正反两态，防它退化成「恒 true」）', () => {
    const keys = Object.keys(catalogOf('zh'));
    for (const k of [keys[0]!, keys[Math.floor(keys.length / 2)]!, keys[keys.length - 1]!]) {
      expect(isMessageKey(k), `${k} 应在表内`).toBe(true);
    }
    expect(isMessageKey('一定不存在的键'), '不存在的键必须为 false').toBe(false);
    expect(isMessageKey(''), '空串必须为 false').toBe(false);
  });

  it('b4. 抽样键：zh / en 两侧都取得到**非空**取值（防「键在表里但值是空串」）', () => {
    const keys = Object.keys(catalogOf('zh'));
    const idx = [0, Math.floor(keys.length * 0.25), Math.floor(keys.length * 0.5), Math.floor(keys.length * 0.75), keys.length - 1];
    for (const k of [...new Set(idx)].map((i) => keys[i]! as MessageKey)) {
      expect(t(k).length, `${k} 的 zh 取值非空`).toBeGreaterThan(0);
      expect(catalogOf('en')[k]!.length, `${k} 的 en 取值非空`).toBeGreaterThan(0);
    }
  });
});
