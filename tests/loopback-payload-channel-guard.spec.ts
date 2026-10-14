// @vitest-environment node
/**
 * 回环通道「载荷口径 vs 界面口径」分界守卫 —— `src/hooks/useAgentLoopbackReceiver.ts` 的
 * `userMessage` 出现点恰好 **9 处（4 读 + 5 写）**，一处不多、一处不少。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这条锁在防什么（两个方向都会真实发生）
 * ══════════════════════════════════════════════════════════════════════
 * `useAgentLoopbackReceiver` 是**常驻壳层 hook**，它拦下 Agent 看板写请求后，用
 * `{ requestId, error: { code, httpStatus, userMessage } }` 这种形状**回给外部 Agent**
 * —— HTTP 响应体是**机器协议**，不是界面。
 *
 *   ① **多了一处**：有人把一段**界面文案**顺手塞进这个响应体
 *      ⇒ 某个 `err.userMessage` 读点其实该走 `resolveErrorText(err, t)`
 *      ⇒ 那句话在英文界面下**永远不翻**（用户看不见英文，且没有任何测试会红）。
 *   ② **少了一处**：有人把这 4 个读点「统一」改成 `resolveErrorText(err, t)`
 *      ⇒ 外发给 Agent 的 `userMessage` 会**随界面语言变**：同一套 Agent 协议，
 *        在英文界面的机器上回英文、中文界面回中文 —— **协议字段被 UI 偏好污染**。
 *      这正是本批（英文补齐）最危险的越界：把「界面该翻」和「协议不许翻」当成同一件事。
 *
 * 所以本文件锁的不是「有没有翻」，而是**这 9 个点一个都不许动**：
 * 谁要动，必须先来这里把数字改掉 —— 那一刻是**有意识的协议变更**，不是顺手重构。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 判据是 AST 级的，不是行 grep（团队裁定的第一个条件）
 * ══════════════════════════════════════════════════════════════════════
 * 不用 `grep -c userMessage`：那样注释里写一句 `userMessage` 就多一处，字符串字面量里
 * 带一个也误伤，而**真正要区分的是「读属性」和「写属性名」两类节点**。
 * 故按 TS 编译器 API 分两类收：
 *   · **读点** = `PropertyAccessExpression`，`name.text === 'userMessage'`（即 `err.userMessage`）
 *   · **写点** = `PropertyAssignment`，属性名 `'userMessage'`（即 `{ …, userMessage: … }`）
 * 另加一条**结构**判据：每个读点必须处在 `X instanceof ChangxiaError ? X.userMessage : …`
 * 的 `ConditionalExpression` 的**真分支**上（「真因透传」的形状）。裸读
 * （`e.userMessage` 不在 instanceof 三元里）单独计数 ⇒ **加一处裸读也会红**，
 * 而只数总数是抓不到这种的（总数 4 可以靠「加一处裸读 + 删一处受保护读」凑平）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 自证是「三态变异」的，且在**内存里**做（团队裁定的第二个条件）
 * ══════════════════════════════════════════════════════════════════════
 * 光断言「现在等于 4/5」证明不了这条锁有判别力 —— 一个恒返回 `{reads:4,writes:5}` 的
 * 假函数也能过。故把判据抽成纯函数 `census(sourceText)`，再用**改过的源码文本**喂它：
 *   · 原样              ⇒ 4 / 5 / 裸读 0（绿）
 *   · 删一处读点        ⇒ 3（若不红，说明这条锁根本没在看读点）
 *   · 加一处**裸**读点  ⇒ 裸读 1（若不红，说明结构判据没生效）
 *   · 改成界面口径      ⇒ 3（若不红，说明协议被污染时这条锁不会叫）
 * 三态都只改**内存字符串**，不落盘 —— 仓库里不留被改坏的源码（团队纪律 D）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '..');
/** 被锁的文件（常驻壳层 hook；回环通道的唯一出口） */
const TARGET = resolve(ROOT, 'src/hooks/useAgentLoopbackReceiver.ts');

/** ★ 现状基线：改动前 `grep -n userMessage src/hooks/useAgentLoopbackReceiver.ts` 共 9 行 */
const EXPECTED_READS = 4;
const EXPECTED_WRITES = 5;
const EXPECTED_TOTAL = 9;
/** 裸读（不在 `instanceof ChangxiaError` 三元里的读点）：现状 0，多一个就是「有文案绕过了三分支」 */
const EXPECTED_UNGUARDED = 0;

interface Census {
  /** `err.userMessage` 这类**读属性** */
  reads: number;
  /** `{ …, userMessage: … }` 这类**协议字段写入** */
  writes: number;
  /** 其中**不在** `instanceof ChangxiaError` 真分支上的读点 */
  unguarded: number;
  /** 明细（行号 + 片段），供失败信息能直接指到那一行 */
  readAt: string[];
}

/**
 * ★ 判据本体（纯函数：只吃源码文本，不碰磁盘）——
 * 抽成纯函数是「三态变异自证」的前提：能拿改过的文本喂它，才能证明它有判别力。
 */
function census(sourceText: string): Census {
  const sf = ts.createSourceFile(TARGET, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const out: Census = { reads: 0, writes: 0, unguarded: 0, readAt: [] };
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  /** 读点是否处在 `X instanceof ChangxiaError ? X.userMessage : …` 的真分支上 */
  const isGuardedByInstanceof = (node: ts.Node): boolean => {
    let cur: ts.Node | undefined = node;
    while (cur && cur !== sf) {
      if (ts.isConditionalExpression(cur) && cur.whenTrue === node) {
        const c = cur.condition;
        return (
          ts.isBinaryExpression(c) &&
          c.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
          ts.isIdentifier(c.right) &&
          c.right.text === 'ChangxiaError'
        );
      }
      cur = cur.parent;
    }
    return false;
  };

  const visit = (n: ts.Node): void => {
    // 读点：`err.userMessage`（含 `err?.userMessage`？本仓无此形态，故不特殊处理；
    // 属性名严格等于 `userMessage`，`X.userMessageY` 不会命中）
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'userMessage') {
      out.reads += 1;
      out.readAt.push(`L${lineOf(n)}: ${n.getText(sf)}`);
      if (!isGuardedByInstanceof(n)) out.unguarded += 1;
    }
    // 写点：对象字面量里的 `userMessage: …`（含写在外层的属性名，字面量名也认）
    if (ts.isPropertyAssignment(n) && n.name.getText(sf).replace(/['"]/g, '') === 'userMessage') {
      out.writes += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const REAL = readFileSync(TARGET, 'utf-8');

/** 只动**内存字符串**的三处变异（对应三个会真实发生的坏结果） */
const MUT = {
  /** ① 删掉一处受保护的读点（那一段改回纯界面口径） */
  dropOneRead: REAL.replace(
    "err instanceof ChangxiaError ? err.userMessage : t('agentLoopback.writeFailed')",
    "t('agentLoopback.writeFailed')",
  ),
  /** ② 追加一处**裸读**（总数不变或增加，但结构判据必须抓到它） */
  addUnguardedRead: `${REAL}\nfunction __leak(err: unknown): string { return (err as ChangxiaError).userMessage; }\n`,
  /** ③ 把一处读点改成界面口径 `resolveErrorText`（协议字段被 UI 语言污染） */
  toUiResolve: REAL.replace(
    'err instanceof ChangxiaError ? err.userMessage :',
    'err instanceof ChangxiaError ? resolveErrorText(err, t) :',
  ),
};

describe('回环通道分界守卫 · `userMessage` 出现点恰好 9 处（4 读 + 5 写 / 裸读 0）', () => {
  it('★ 判据本体：现状 = 4 读 + 5 写 = 9，且 4 个读点全在 `instanceof ChangxiaError` 真分支上', () => {
    const c = census(REAL);
    expect(
      c.reads,
      `读点由 ${EXPECTED_READS} 变成 ${c.reads}。\n` +
        '多了一处：可能是一句**界面文案**被塞进了回给外部 Agent 的协议字段（那句永远不会翻）。\n' +
        '少了一处：可能有人把协议字段改成了 `resolveErrorText(err, t)`（协议随界面语言变）。\n' +
        '两个方向都必须先来这里改数字 —— 那一刻是有意识的协议变更。\n' +
        `现状读点：\n  ${c.readAt.join('\n  ')}`,
    ).toBe(EXPECTED_READS);
    expect(c.writes, `协议字段写入点由 ${EXPECTED_WRITES} 变成 ${c.writes}`).toBe(EXPECTED_WRITES);
    expect(c.reads + c.writes, `出现点合计由 ${EXPECTED_TOTAL} 变成 ${c.reads + c.writes}`).toBe(
      EXPECTED_TOTAL,
    );
    expect(
      c.unguarded,
      `有 ${c.unguarded} 处裸读 \`X.userMessage\`（不在 instanceof 三元里）——` +
        '裸读意味着它绕过了「有码 ⇒ 本地化 / 有真因 ⇒ 透传 / 都没有 ⇒ 兜底」的三分支口径',
    ).toBe(EXPECTED_UNGUARDED);
  });

  it('★ 前提：文件确实 import 了 `ChangxiaError`（否则上面那条结构判据是空转）', () => {
    expect(REAL).toMatch(/import\s*\{[^}]*\bChangxiaError\b[^}]*\}\s*from/);
  });

  /* ── 三态变异自证：证明上面那条断言**有判别力**，不是恒真 ── */

  it('★ 变异①：删掉一处读点 ⇒ 判据从 4 掉到 3（这条锁确实在看读点）', () => {
    expect(MUT.dropOneRead, '变异没生效：锚点文本已变，请按现状更新 MUT 的锚点').not.toBe(REAL);
    expect(census(MUT.dropOneRead).reads).toBe(EXPECTED_READS - 1);
  });

  it('★ 变异②：加一处**裸读** ⇒ 总数可能不变，但「裸读 = 0」这条结构判据必须红', () => {
    const c = census(MUT.addUnguardedRead);
    expect(c.unguarded).toBe(EXPECTED_UNGUARDED + 1);
  });

  it('★ 变异③：把读点改成界面口径 ⇒ 同样掉到 3（协议被 UI 语言污染时这条锁会叫）', () => {
    expect(MUT.toUiResolve, '变异没生效：锚点文本已变，请按现状更新 MUT 的锚点').not.toBe(REAL);
    const c = census(MUT.toUiResolve);
    expect(c.reads).toBe(EXPECTED_READS - 1);
    // 4 个读点里只有 1 个被换掉 ⇒ 剩下 3 个仍受保护，没有裸读
    expect(c.unguarded).toBe(EXPECTED_UNGUARDED);
  });
});
