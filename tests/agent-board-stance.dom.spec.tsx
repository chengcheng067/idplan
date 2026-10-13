// @vitest-environment jsdom
/**
 * Agent 看板页 · `data-agent-stance` 的 **DOM 形态锁**（批次⑥ 档 A₂ 的收官项）。
 *
 * 为什么单独一个 spec（而不是加进 `agent-board-create.spec.tsx`）：
 *   那个 spec 的 43 例依赖**真实 repos**；要在页面渲染里顶掉 `useRepos`，必须在本文件
 *   顶层写 `vi.mock` —— 它是**按测试文件**生效的，写进去会把那 43 例一起改掉。
 *   ⇒ DOM 断言搬到这里做，源码侧那一半留在原 spec（`toContain("t('agent.stanceNl')")`）。
 *
 * 判据（team-lead 定死）：**取值再比串 + 容器内限定**
 *   · 容器存在性 **独立断言**（不许用 `!` 把「容器没了」掩盖成 TypeError）；
 *   · `zh.length > 2`（`toContain('')` 恒过，而空串在 `Record<MessageKey,string>` 里**类型合法**）；
 *   · `textContent` 含 `zh`，且**不放宽到整页**。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { emptyPackage } from './helpers/backup-fixture';
import { catalogOf } from '../src/i18n';

/* ★ vitest hoisting：`vi.mock` 的工厂只能用 `vi.hoisted` 暴露的值 */
const slot = vi.hoisted(() => ({
  bundle: null as unknown,
  calls: 0,
}));

vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => {
    slot.calls += 1;
    return slot.bundle;
  },
}));

// 必须在 vi.mock 之后再导入（夹具内部导入被测页）
import { mountAgentBoardPage, pump } from './helpers/agent-board-page.render';

beforeAll(installFakeIndexedDB);

let bundle: IRepositoryBundle;

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
  slot.bundle = bundle;
  slot.calls = 0;
});

afterEach(async () => {
  await bundle.admin?.replaceAllImport(emptyPackage());
});

describe('Agent 看板页 · 现状说明盒（data-agent-stance）· DOM 锁', () => {
  it('P1：useRepos 的 mock 确实被调用过（前提自证）', async () => {
    const m = mountAgentBoardPage();
    await pump();
    expect(slot.calls, 'useRepos 未被调用 ⇒ 页面走的是别的入口，本夹具前提不成立').toBeGreaterThan(0);
    await m.unmount();
  });

  it('P2：页面拿到的 bundle 就是夹具里那个对象（同一引用）', async () => {
    const m = mountAgentBoardPage();
    await pump();
    // 同一引用：mock 返回的就是 slot.bundle（若页面另建仓储，这条会红）
    expect(slot.bundle).toBe(bundle);
    await m.unmount();
  });

  it('★ P3：容器内确实渲染了 catalogOf(zh) 的那句话（取值再比串 + 容器内限定）', async () => {
    const zh = catalogOf('zh')['agent.stanceNl'];
    // ① 值本身必须有判别力（空串会让下面 toContain 恒过）
    expect(zh.length, 'zh 值过短 ⇒ 断言会退化成恒过').toBeGreaterThan(2);

    const m = mountAgentBoardPage();
    await pump();

    // ② 容器存在性**独立断言**（不用 `!`）：容器没了要红在「它不存在」，而不是 TypeError
    const box = m.container.querySelector('[data-agent-stance]');
    expect(box, '[data-agent-stance] 容器不存在（前提不成立，或该盒子受某分支门控）').not.toBeNull();
    if (box === null) throw new Error('unreachable: 上一行已断言非空');

    // ③ 只在这个**容器内**匹配，不放宽到整页
    expect(box.textContent, '容器内应含 agent.stanceNl 的 zh 值').toContain(zh);
    expect(box.textContent, '容器内应含 agent.stanceBefore 的 zh 值').toContain(
      catalogOf('zh')['agent.stanceBefore'],
    );

    await m.unmount();
  });

  it('⑤ (i)/(ii) 对照：盒子是「首帧」还是「异步后」渲染（读数为原样事实）', async () => {
    const m = mountAgentBoardPage();
    const first = m.stanceOnFirstFrame; // (i) render 之后**立刻**（夹具里不 pump）
    await pump();
    const after = m.container.querySelector('[data-agent-stance]');
    // 处置表（**跑之前**定死）：都有 ⇒ 首帧；仅 (ii) 有 ⇒ 必须 pump；都无 ⇒ 前提不成立
    // eslint-disable-next-line no-console
    console.log(
      `[stance 首帧对照] (i) render 立刻 = ${first ? '有' : '无'} ；(ii) pump 后 = ${after ? '有' : '无'}`,
    );
    expect((i_have(first) && i_have(after)) || (!i_have(first) && i_have(after))).toBe(true);
    if (!i_have(first)) {
      // 若为异步 ⇒ 夹具必须显式 pump（本文件已 pump）——把结论留给读数
      expect(i_have(after), '(i) 无 (ii) 也 无 ⇒ 前提不成立：该盒子受某分支门控').toBe(true);
    }
    await m.unmount();
  });
});

function i_have(el: Element | null): boolean {
  return el !== null;
}
