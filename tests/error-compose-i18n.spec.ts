// @vitest-environment jsdom
/**
 * 两条「参数本身就是 core 中文」的错误 · **整句合成的语言契约**（英文补齐批 · 段 5 之六）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这两条为什么不能靠 `resolveErrorText` 一条路走通
 * ══════════════════════════════════════════════════════════════════════
 * `resolveErrorText(err, t)` 只把**模板**换语言，`{参数}` 是 core 直接给的；而这两条的参数
 * **本身就是 core 写的中文**（core 拿不到界面语言）：
 *   · `coreErr.task.transitionNotAllowed` —— `{from}` / `{to}` 取自 `TASK_STATUS_LABELS`（中文状态名）
 *   · `coreErr.execution.completeRejected` —— `{reason}` 取自 `canComplete()` 的**整句中文**
 * ⇒ 英文界面上会印出半中半英（比全中文更像坏掉，与本批反复消灭的「一半一半」同族）。
 *
 * 形态（team-lead 定死，不许扩）：**core 一个字不改**，参数在**渲染层**（`labels.ts`）换语言，
 * 由 `resolveErrorTextForUi()` 统一入口合成整句；**只换那两处消费点**（见 ⑥）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 本文件最要紧的一条：**zh 下合成结果必须与 `resolveErrorText` 逐字节相同**
 * ══════════════════════════════════════════════════════════════════════
 * 这一条是「中文界面零变化」的机器证明 —— 否则我这次「翻英文」会顺手把中文改掉，
 * 而那正是本批最不能出的错（中文是回归基线）。见 ①。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ `reason` 是「按中文反查」，但**不许静默**
 * ══════════════════════════════════════════════════════════════════════
 * core 的 `canComplete().reason` 是 `string`（**没有机器码**），而本批不许改 core
 * ⇒ 不反查就没有别的出口。它与「界面层写 `=== 'marketing'`」的区别在**有没有守卫**：
 * ④ 直接调 `canComplete()` 走**每一条真实分支**，断言每条 reason 都被模式表命中、
 *   且表里**没有多余项** ⇒ core 改文案 ⇒ **这里先红**，不会静默退回中文。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  resolveErrorTextForUi,
  setLang,
  t,
  taskTransitionText,
  executionCompleteRejectedText,
} from '../src/i18n';
import { zh as coreZh, en as coreEn } from '../src/i18n/messages/parts/core';
import {
  ChangxiaError,
  ChangxiaErrorCode,
  TASK_STATUS_LABELS,
  TaskStatus,
  coreError,
  resolveErrorText,
} from '../src/core/types/enums';
import { CORE_ERROR_TEXT, coreErrorText } from '../src/core/types/core-error-text';
import { canComplete } from '../src/core/execution/execution-state';
import { ExecutionStatus } from '../src/core/types/agent-execution';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const zhTable = coreZh as Record<string, string>;
const enTable = coreEn as Record<string, string>;

beforeEach(() => setLang('zh'));
afterEach(() => setLang('zh'));

/** ① 的样本：`草稿 → 已完成`（真实的非法流转，UI 只给合法选项 ⇒ 这条是兜底/竞态路径） */
const transitionErr = (from: TaskStatus, to: TaskStatus): ChangxiaError =>
  coreError(ChangxiaErrorCode.Validation, 'coreErr.task.transitionNotAllowed', {
    from: TASK_STATUS_LABELS[from],
    to: TASK_STATUS_LABELS[to],
  });

/** ② 的样本：`running → completed` + `canComplete()` 的真 reason */
function completeRejectedErr(): ChangxiaError {
  const r = canComplete({ id: 'ex1', status: ExecutionStatus.Running }, []);
  expect(r.ok).toBe(false);
  return coreError(ChangxiaErrorCode.Validation, 'coreErr.execution.completeRejected', {
    from: 'running',
    to: 'completed',
    reason: String(r.reason),
  });
}

/* ══════════════════ ① ★ zh 逐字节不变（本文件最要紧的一条） ══════════════════ */

describe('合成 · ① ★ zh 下合成结果 === `resolveErrorText` 的取值（逐字节，「中文界面零变化」）', () => {
  it('★ 任务非法流转：合成整句与默认路径**逐字节相同**', () => {
    const e = transitionErr(TaskStatus.Draft, TaskStatus.Done);
    expect(resolveErrorTextForUi(e, t), 'zh 下被改动了 ⇒ 中文回归基线被破坏').toBe(
      resolveErrorText(e, t),
    );
    // 与**载荷原文**也一致（协议/日志口径 = 界面口径，中文下本就该一致）
    expect(resolveErrorTextForUi(e, t)).toBe(e.userMessage);
  });

  it('★ 执行非法进完成态：同上（reason 走的是我在表里手抄的那两句）', () => {
    const e = completeRejectedErr();
    expect(resolveErrorTextForUi(e, t)).toBe(resolveErrorText(e, t));
    expect(resolveErrorTextForUi(e, t)).toBe(e.userMessage);
  });

  it('★ 7×7 全网格：任何一个状态对的 zh 合成都与默认路径相同（不是只测了 1 对）', () => {
    const all = Object.keys(TASK_STATUS_LABELS) as TaskStatus[];
    for (const from of all) {
      for (const to of all) {
        const e = transitionErr(from, to);
        expect(resolveErrorTextForUi(e, t), `${from} → ${to}`).toBe(resolveErrorText(e, t));
      }
    }
  });

  it('★ 表里那两句 reason 的 zh 取值**逐字节等于** core `canComplete()` 的真实输出', () => {
    const reasons = [
      String(canComplete({ id: 'ex1', status: ExecutionStatus.Running }, []).reason),
      String(canComplete({ id: 'ex1', status: ExecutionStatus.AwaitingReview }, []).reason),
    ];
    // 手工把 `{status}` 还原成实际值再比（模板 → 渲染结果）
    const rendered = [
      zhTable['execution.reason.notAwaitingReview']!.replace('{status}', 'running'),
      zhTable['execution.reason.noAppliedProposal'],
    ];
    expect(rendered).toEqual(reasons);
  });
});

/* ══════════════════ ② en 下真的是英文（防假绿） ══════════════════ */

describe('合成 · ② en 下整句不含汉字，且用英文状态名', () => {
  it('★ 任务非法流转：`Draft → Done`，无汉字', () => {
    const e = transitionErr(TaskStatus.Draft, TaskStatus.Done);
    setLang('en');
    const out = resolveErrorTextForUi(e, t);
    expect(out).not.toMatch(CJK);
    expect(out).toContain(t('taskStatus.draft'));
    expect(out).toContain(t('taskStatus.done'));
    // 反向：这两个取值在 en 下确实**不是**中文（否则上一条是空的）
    expect(t('taskStatus.draft')).not.toBe(TASK_STATUS_LABELS[TaskStatus.Draft]);
  });

  it('★ 执行非法进完成态：整句无汉字（含 reason 那一截）', () => {
    const e = completeRejectedErr();
    setLang('en');
    const out = resolveErrorTextForUi(e, t);
    expect(out, 'reason 那一截还是中文').not.toMatch(CJK);
    expect(out).toContain('awaiting_review');
  });

  it('★ en 下合成结果**不等于**默认路径（否则等于没合成，这条是反向自证）', () => {
    const e = completeRejectedErr();
    setLang('en');
    expect(resolveErrorTextForUi(e, t)).not.toBe(resolveErrorText(e, t));
  });
});

/* ══════════════════ ③ 认不出 ⇒ 回落，不编 ══════════════════ */

describe('合成 · ③ 参数认不出时**回落**默认路径（宁可印 core 中文，也不编一个状态名）', () => {
  it('★ `from` 是未知串 ⇒ 两个入口取值相同（回落可见，不是静默改成别的）', () => {
    const e = coreError(ChangxiaErrorCode.Validation, 'coreErr.task.transitionNotAllowed', {
      from: '不存在的状态',
      to: TASK_STATUS_LABELS[TaskStatus.Done],
    });
    expect(taskTransitionText(e)).toBeNull();
    expect(resolveErrorTextForUi(e, t)).toBe(resolveErrorText(e, t));
    expect(resolveErrorTextForUi(e, t)).toContain('不存在的状态');
  });

  it('★ `reason` 是未知句 ⇒ 回落（不抛、不编）', () => {
    const e = coreError(ChangxiaErrorCode.Validation, 'coreErr.execution.completeRejected', {
      from: 'running',
      to: 'completed',
      reason: 'core 换了文案但没人更新模式表',
    });
    expect(executionCompleteRejectedText(e)).toBeNull();
    expect(resolveErrorTextForUi(e, t)).toBe(resolveErrorText(e, t));
  });

  it('★ 别的键**不走**合成（入口对其它消息键是透明转发）', () => {
    const e = coreError(ChangxiaErrorCode.NotFound, 'coreErr.member.notFound');
    expect(taskTransitionText(e)).toBeNull();
    expect(executionCompleteRejectedText(e)).toBeNull();
    expect(resolveErrorTextForUi(e, t, '兜底')).toBe(resolveErrorText(e, t, '兜底'));
    expect(resolveErrorTextForUi(new Error('boom'), t, '兜底')).toBe('兜底');
  });
});

/* ══════════════════ ④ ★ 模式表不许静默腐化 ══════════════════ */

describe('合成 · ④ ★ `canComplete()` 的**每一条**真实 reason 都被模式表命中，且表无多余项', () => {
  it('★ 走遍两条真实分支：reason 各不相同，且都能被合成（= 表没漏）', () => {
    const reasons = [
      String(canComplete({ id: 'ex1', status: ExecutionStatus.Running }, []).reason),
      String(canComplete({ id: 'ex1', status: ExecutionStatus.AwaitingReview }, []).reason),
    ];
    expect(new Set(reasons).size, '两条分支的 reason 撞了 —— 模式表该合并成一条').toBe(2);
    for (const reason of reasons) {
      const e = coreError(ChangxiaErrorCode.Validation, 'coreErr.execution.completeRejected', {
        from: 'running',
        to: 'completed',
        reason,
      });
      expect(executionCompleteRejectedText(e), `reason 未被模式表命中（core 改文案了？）：${reason}`).not.toBeNull();
      // 且在 en 下不含汉字（= 真的被换掉了，不是原样端出去）
      setLang('en');
      expect(executionCompleteRejectedText(e), `reason 没被换成英文：${reason}`).not.toMatch(CJK);
      setLang('zh');
    }
  });

  it('★ 反向：表里**没有**多余项（每条模式都能被某条真实 reason 命中）', () => {
    const reasons = [
      String(canComplete({ id: 'ex1', status: ExecutionStatus.Running }, []).reason),
      String(canComplete({ id: 'ex1', status: ExecutionStatus.AwaitingReview }, []).reason),
    ];
    // 每条真实 reason ⇒ 恰好一条模式命中（不是 0，也不是 2）
    for (const reason of reasons) {
      const hits = [
        /^完成要求 execution 处于 awaiting_review 态（当前为 (.+)）$/,
        /^完成要求存在由人工决策（decidedBy 非空）的 applied 写回提案（执行成功不等于业务完成）$/,
      ].filter((re) => re.test(reason));
      expect(hits.length, `reason 命中了 ${hits.length} 条模式（应为 1）：${reason}`).toBe(1);
    }
  });
});

/* ══════════════════ ⑤ 载荷口径一字未动 ══════════════════ */

describe('合成 · ⑤ ★ 载荷（`userMessage` / `message`）一字未动，且本层不修改错误对象', () => {
  it('★ 调用合成前后，`userMessage` / `message` / `params` 都原样（无副作用）', () => {
    const e = completeRejectedErr();
    const before = { um: e.userMessage, msg: e.message, p: JSON.stringify(e.params) };
    resolveErrorTextForUi(e, t);
    setLang('en');
    resolveErrorTextForUi(e, t);
    setLang('zh');
    expect({ um: e.userMessage, msg: e.message, p: JSON.stringify(e.params) }).toEqual(before);
  });

  it('★ `userMessage` 仍逐字节等于 core 载荷表的渲染结果（本层没趁机改 core 口径）', () => {
    const e = transitionErr(TaskStatus.Draft, TaskStatus.Done);
    const expected = coreErrorText('coreErr.task.transitionNotAllowed', {
      from: TASK_STATUS_LABELS[TaskStatus.Draft],
      to: TASK_STATUS_LABELS[TaskStatus.Done],
    });
    expect(e.userMessage).toBe(expected);
    expect(e.userMessage).toBe(CORE_ERROR_TEXT['coreErr.task.transitionNotAllowed'].replace('{from}', '草稿').replace('{to}', '已完成'));
  });

  it('★ 分片 zh 与载荷表在这两个键上逐字相等（三表不漂那条的局部复核）', () => {
    // 本笔**没有**给 error 表加键（合成用的是现有键 + 两个新 reason 键）⇒ 表键集不变
    expect(zhTable['execution.reason.notAwaitingReview']).toContain('{status}');
    expect(enTable['execution.reason.notAwaitingReview']).toContain('{status}');
    expect(Object.keys(zhTable).filter((k) => k.startsWith('execution.reason.')).sort()).toEqual([
      'execution.reason.noAppliedProposal',
      'execution.reason.notAwaitingReview',
    ]);
  });
});

/* ══════════════════ ⑥ ★ 消费点（只换两处，且不许扩散） ══════════════════ */

describe('合成 · ⑥ ★ 只换了**两处**消费点（防止有人把它当万能入口去替换全部 30 处）', () => {
  it('★ 全仓用 `resolveErrorTextForUi` 的文件恰好 2 个（AST 级：看的是调用）', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, resolve, sep, posix } = await import('node:path');
    const ts = (await import('typescript')).default;
    const ROOT = resolve(__dirname, '..');

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

    const callers: string[] = [];
    for (const rel of files) {
      const abs = join(ROOT, rel);
      const sf = ts.createSourceFile(
        abs,
        readFileSync(abs, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
        rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      let hit = false;
      const visit = (n: import('typescript').Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === 'resolveErrorTextForUi'
        ) {
          hit = true;
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      if (hit) callers.push(rel);
    }
    expect(callers.sort(), '消费点变了 —— 只有这两条错误需要合成，多出来的要复核是不是误用').toEqual([
      'src/pages/AgentExecutionConsolePage.tsx',
      'src/store/useAgentStore.ts',
    ]);
  });
});
