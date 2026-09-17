/**
 * 内置「给外部 Agent 的提示词」（反馈 #9）· 契约同源性验收。
 *
 * ── 用户的原话 ──
 *   「这个导入任务的部分不好用，看不懂……是不是可以内置一个 skill 或 prompt，
 *     让用户提供给 WorkBuddy 或 Codex，生成之后再复制粘贴进来？」
 *
 * ── 这份测试在防什么（这是它存在的全部理由）──
 *   内置提示词最大的风险**不是没人用，而是用错了**：提示词教 Agent 输出一个
 *   校验器根本不接受的格式，用户复制回来的东西一条都进不去，还以为是软件坏了。
 *   所以这里不满足于「源码里有一段字符串」：
 *     ① 把提示词里那段**参考骨架原样抠出来**，喂给真实校验器 `validateAgentPayload`；
 *        必须通过 —— 提示词与契约**同源**才算数（契约改了而提示词没跟 ⇒ 立刻变红）。
 *     ② 骨架必须覆盖 tasks[] 的全部字段（用户拿到的是能直接用的例子，不是片段）。
 *     ③ 提示词里**不得出现令牌/token** 字样或值：它是要贴进聊天窗口的公开文本，
 *        混进访问令牌等于主动泄漏（令牌属于「接入配置」那条通道）。
 *     ④ 提醒用户「令牌不在提示词里」的说明文案必须真的在组件里（否则用户还是会去贴）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { PROMPT_TEMPLATE } from '../src/components/agent/ApplyPayloadPanel';
import {
  AGENT_PAYLOAD_SCHEMA_ID,
  validateAgentPayload,
} from '../src/core/types/agent-payload';
import type { AgentPayloadTask } from '../src/core/types/agent-payload';

/**
 * 从提示词里抠出「参考骨架」的 JSON 文本。
 *
 * 判据：`参考骨架：` 之后**第一个** `{` 起，到与之配平的 `}` 为止。
 * 刻意不用正则贪婪匹配 —— 提示词里还有别的花括号（字段说明），贪婪会把它们卷进来。
 */
function extractSkeleton(): string {
  const anchor = PROMPT_TEMPLATE.indexOf('参考骨架：');
  expect(anchor, '提示词里必须保留「参考骨架：」这一节').toBeGreaterThan(-1);

  const start = PROMPT_TEMPLATE.indexOf('{', anchor);
  expect(start, '参考骨架必须是 JSON 对象').toBeGreaterThan(-1);

  let depth = 0;
  for (let i = start; i < PROMPT_TEMPLATE.length; i += 1) {
    const ch = PROMPT_TEMPLATE[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return PROMPT_TEMPLATE.slice(start, i + 1);
    }
  }
  throw new Error('参考骨架的花括号不配平，提示词可能被改坏了');
}

describe('内置提示词 · 与契约同源', () => {
  it('参考骨架是合法 JSON，且能被真实校验器直接接受（提示词不能教出废格式）', () => {
    const skeleton = extractSkeleton();
    const parsed = JSON.parse(skeleton) as unknown;

    // 关键断言：喂给**真实**校验入口。契约改了、提示词没跟 ⇒ 这里立刻红
    const payload = validateAgentPayload(parsed);
    expect(payload.schema).toBe(AGENT_PAYLOAD_SCHEMA_ID);
    expect(payload.tasks).toHaveLength(1);
    // projectId / stageId 必须是 null：导入时由用户在界面上选落点，不由 Agent 指定
    expect(payload.projectId).toBeNull();
    expect(payload.stageId).toBeNull();
  });

  it('骨架覆盖 tasks[] 的全部字段（用户拿到的是可直接用的例子，不是片段）', () => {
    const task = validateAgentPayload(JSON.parse(extractSkeleton())).tasks[0]!;
    const expectedKeys: Array<keyof AgentPayloadTask> = [
      'externalId',
      'title',
      'description',
      'status',
      'assigneeAgentKind',
      'assigneeHuman',
      'dependsOnExternal',
      'startAt',
      'dueDate',
      'artifacts',
    ];
    for (const key of expectedKeys) {
      expect(Object.keys(task), `骨架缺字段 ${key}`).toContain(key);
    }
    // 幂等键的纪律：不含 runId（含了等于每次同步都新建一份重复任务）
    expect(task.externalId).not.toContain('run-');
  });

  it('提示词把「不含令牌」说清楚，且正文里不出现任何令牌字样/值', () => {
    // ① 文本层面：不得出现 token / 令牌 —— 这是要贴进聊天窗口的公开文本
    expect(PROMPT_TEMPLATE).not.toMatch(/token/i);
    expect(PROMPT_TEMPLATE).not.toContain('令牌');

    // ② 组件层面：必须有一句「提示词里不含访问令牌」的说明（否则用户还是会去贴）
    const panelSrc = readFileSync(
      resolve(__dirname, '..', 'src/components/agent/ApplyPayloadPanel.tsx'),
      'utf8',
    );
    expect(panelSrc).toContain('不含访问令牌');
    expect(panelSrc).toContain('不要贴进给 Agent 的聊天窗口');
  });

  it('提示词给全了 Agent 必须知道的取值口径（schema id / 状态枚举 / 日期格式）', () => {
    expect(PROMPT_TEMPLATE).toContain(AGENT_PAYLOAD_SCHEMA_ID);
    for (const status of ['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done']) {
      expect(PROMPT_TEMPLATE).toContain(status);
    }
    expect(PROMPT_TEMPLATE).toContain('YYYY-MM-DD');
    // 「只输出 JSON 本体」这句必须留着：否则 Agent 会带上解释文字，用户还得手工裁剪
    expect(PROMPT_TEMPLATE).toContain('只输出 JSON 本体');
  });
});
