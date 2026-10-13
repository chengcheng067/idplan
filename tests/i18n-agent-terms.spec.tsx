// @vitest-environment jsdom
/**
 * #354 · Agent 术语表接 i18n 的**守卫**（三件，都是「会报 + 不误报」两条自证）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这份 spec 为什么必须存在（不是配套）
 * ══════════════════════════════════════════════════════════════════════
 * ① **反应性**：`termFor` 不是 React hook、不订阅语言（`src/i18n/labels.ts` 文件头纪律 ②）。
 *    凡调用它的组件**必须同时调 `useLang()`**，否则切语言后那几处**不刷新** ——
 *    用户可感知，且**中文态完全看不出来**（与 05:0x 查出的「拆句粘连」同族：
 *    只有切到 EN 才看得见）。**写这份 spec 前我手查过一遍，当场查出两条真缺陷**：
 *    `TaskDrawer.tsx`（3 处术语位）与 `HandoffPanel.tsx`（5 处）**全文件没有 `useLang()`**
 *    —— 它们是本 spec 第一条用例的第一个被抬出来的违规，已随本笔修掉。
 * ② **不变量逐语言成立**：「两类读者取值必须不同」的意图是「**在这门语言下**两类读者
 *    确实拿到不同措辞」。它在中国语下 12/13 成立、在英文下 8/13 成立，重合的必须
 *    **显式登记并写理由**（`MODE_COLLAPSED_KEYS`），且登记表**两个方向都要管**：
 *    没登记的重合要报（否则可以偷偷重合），登记了却并不重合的也要报（否则登记表
 *    会腐化成一张只增不减的豁免清单）。
 * ③ **真 EN 渲染**：上面两条都是源码/数据层。还有一件只有渲染才证明得了的事：
 *    这两处的标题**切到英文后渲染出来的确实是英文**（不是恰好中文表被读到了）。
 *
 * ⚠️ 本文件在本批**未执行**：team-lead 于 05:2x 下令（到开窗为止）禁止跑任何 vitest
 *    （一次跑批会污染判据集与产物代）。⇒ 三条自证是**写下来的判据**，读数留待冻结窗口
 *    首跑；我不把「写好了」说成「跑绿了」。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep, posix } from 'node:path';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { emptyPackage } from './helpers/backup-fixture';
import {
  AGENT_TERM_KEYS,
  MODE_COLLAPSED_KEYS,
  catalogOf,
  setLang,
} from '../src/i18n';
import {
  findStaleRegistrations,
  findUnregisteredCollapses,
  normTerm,
  scanTermReactivity,
  type Catalog,
  type KeyTable,
} from './helpers/agent-term-guard';

/* ★ vitest hoisting：`vi.mock` 工厂只能用 `vi.hoisted` 暴露的值（同 agent-board-stance） */
const slot = vi.hoisted(() => ({ bundle: null as unknown, calls: 0 }));

vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => {
    slot.calls += 1;
    return slot.bundle;
  },
}));

// 必须在 vi.mock 之后再导入（夹具内部导入被测页）
import { mountAgentBoardPage, pump } from './helpers/agent-board-page.render';
import { ApplyPayloadPanel } from '../src/components/agent/ApplyPayloadPanel';

const ROOT = resolve(__dirname, '..');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** 递归收集 src/** 的 ts/tsx（posix 风格相对路径，便于豁免规则书写） */
function collectSrc(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) collectSrc(abs, acc);
    else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(abs.slice(ROOT.length + 1).split(sep).join(posix.sep));
    }
  }
  return acc;
}

const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/* ═══════════════ ① 反应性：termFor( 的文件必须 useLang( ═══════════════ */

describe('#354 术语反应性 · 调 termFor 的文件必须订阅语言', () => {
  it('★ 全仓零违规（实测 6 个消费文件，全部已订阅）', () => {
    const files = collectSrc(join(ROOT, 'src')).map((path) => ({ path, source: read(path) }));
    expect(files.length, '扫到 0 个文件 ⇒ 这条锁是空的').toBeGreaterThan(100);
    const offenders = scanTermReactivity(files);
    expect(
      offenders,
      '这些文件调了 termFor 却没调 useLang ⇒ 切语言后那几处不刷新（中文态看不出来）：\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('★ 会报：剥注释后仍有 termFor( 而缺 useLang( ⇒ 必须命中（反例自证）', () => {
    const offenders = scanTermReactivity([
      {
        path: 'src/components/agent/__counter_example__.tsx',
        source: "import { termFor } from '../../i18n';\nconst x = termFor('board', 'human');\n",
      },
    ]);
    expect(offenders).toEqual(['src/components/agent/__counter_example__.tsx']);
  });

  it('★ 不误报之一：注释里的 termFor( 不算调用（store 里那句注释就是现成反例）', () => {
    /*
     * `src/store/useLayoutStore.ts:88` 的注释原文是「调用点 `termFor(key, mode)` 的
     * mode 参数是同一联合」—— 该文件**没有** `useLang()`（它不是渲染点）。
     * 不剥注释的实现会在这里**误报**；剥注释的实现必须放过它。
     */
    const real = { path: 'src/store/useLayoutStore.ts', source: read('src/store/useLayoutStore.ts') };
    expect(scanTermReactivity([real]), '注释里的 termFor( 被当成了调用 ⇒ 判据过宽').toEqual([]);
  });

  it('★ 不误报之二：同时有 useLang( ⇒ 命中面必须为空', () => {
    const offenders = scanTermReactivity([
      {
        path: 'src/components/agent/__ok__.tsx',
        source:
          "import { termFor, useLang } from '../../i18n';\n" +
          'function C() { useLang(); return termFor(\'board\', \'human\'); }\n',
      },
    ]);
    expect(offenders).toEqual([]);
  });

  it('★ 豁免面：src/i18n/**（定义处）与 src/constants/**（类型处）不在此判据内', () => {
    const offenders = scanTermReactivity([
      { path: 'src/i18n/labels.ts', source: "export function termFor(k: string) { return k; }\n" },
      { path: 'src/constants/agentTerms.ts', source: '// 说明：termFor( 已搬走\n' },
    ]);
    expect(offenders, '豁免面被当成违规 ⇒ 这条锁会在定义处自己打自己').toEqual([]);
  });
});

/* ═══════════ ② 不变量：重合必须登记（两个方向都管）═══════════ */

describe('#354 术语不变量 · 重合必须登记，登记必须真重合', () => {
  const catalogs = (): Record<string, Catalog> => ({
    zh: catalogOf('zh'),
    en: catalogOf('en'),
  });

  it('★ 不误报：真 zh / en 两表跑出来零违规（登记表与实际重合逐项一致）', () => {
    const findings = findUnregisteredCollapses(
      AGENT_TERM_KEYS as unknown as KeyTable,
      catalogs(),
      MODE_COLLAPSED_KEYS,
    );
    expect(
      findings.map((f) => `${f.lang}:${f.key}`),
      '出现未登记的重合 —— 要么改取值，要么在 MODE_COLLAPSED_KEYS 登记 + 写一行理由',
    ).toEqual([]);
  });

  it('★ 不误报：登记表里的每一项都真的重合（防「只增不减的豁免清单」）', () => {
    const stale = findStaleRegistrations(
      AGENT_TERM_KEYS as unknown as KeyTable,
      catalogs(),
      MODE_COLLAPSED_KEYS,
    );
    expect(
      stale.map((f) => `${f.lang}:${f.key}`),
      '登记了却并不重合 ⇒ 这行登记已是债，删掉它（或取值确实想不同就保持不同）',
    ).toEqual([]);
  });

  it('★ 会报之一：登记表之外故意造一个重合 ⇒ 扫描必须命中（反例自证）', () => {
    const en = { ...catalogOf('en') } as Record<string, string>;
    const table = AGENT_TERM_KEYS as unknown as KeyTable;
    // 把 stage 的 tech 取值篡改成与 human 完全相同（stage 不在任何登记表里）
    en[table.stage!.tech] = en[table.stage!.human]!;
    const findings = findUnregisteredCollapses(table, { zh: catalogOf('zh'), en }, MODE_COLLAPSED_KEYS);
    expect(findings.map((f) => `${f.lang}:${f.key}`)).toEqual(['en:stage']);
  });

  it('★ 会报之二：登记项实际并不重合 ⇒ 反向扫描必须命中（反例自证）', () => {
    const en = { ...catalogOf('en') } as Record<string, string>;
    const table = AGENT_TERM_KEYS as unknown as KeyTable;
    // `board` 是登记在案的 en 重合项；把 tech 改成不同 ⇒ 登记变成陈旧
    en[table.board!.tech] = 'Agent Board (tech)';
    const stale = findStaleRegistrations(table, { zh: catalogOf('zh'), en }, MODE_COLLAPSED_KEYS);
    expect(stale.map((f) => `${f.lang}:${f.key}`)).toEqual(['en:board']);
  });

  it('zh 侧登记项恰 1 个（onsite 两列同为「现场」，v0.7 起的事实，取值未动）', () => {
    expect([...MODE_COLLAPSED_KEYS.zh]).toEqual(['onsite']);
    expect(catalogOf('zh')[AGENT_TERM_KEYS.onsite.human]).toBe('现场');
    expect(catalogOf('zh')[AGENT_TERM_KEYS.onsite.tech]).toBe('现场');
  });

  /**
   * ★ 覆盖面自证（team-lead 2026-08-27 点名的第四条）——**分母不许手写**。
   *
   * 为什么必须有这一条：旧 `agent-ui-terms.spec.ts:52` 的双模式断言是**手写 9 个 key 的清单**，
   * 而术语 key 有 13 个 ⇒ 它从第一天起就只覆盖 9/13，**新增的 key 自动豁免**，
   * 且**永远不会红**（这正是「登记表腐化」的同一个洞，只是它一开始就是宽的）。
   * 本 spec 的判据改成**遍历 `AGENT_TERM_KEYS` 全集**（分母来自表本身），
   * 于是「第 14 个 key」不可能静默溜过；再加下面这条把「覆盖」本身断言出来：
   * 每个 key 至少要在**某一种语言下**属于「两列取值不同」或「登记在案」二者之一 ——
   * 若某 key 在 zh 与 en 下都重合、又没登记，它就是**第三类**（既不在不变量里、也不在登记表里）。
   */
  it('★ 覆盖面：13 个 key 每一个都落在「取值不同 or 登记在案」里，没有第三类', () => {
    const keys = Object.keys(AGENT_TERM_KEYS) as Array<keyof typeof AGENT_TERM_KEYS>;
    const uncovered = keys.filter((key) => {
      const pair = AGENT_TERM_KEYS[key];
      return !(['zh', 'en'] as const).some((lang) => {
        const table = catalogOf(lang);
        const differs = normTerm(table[pair.human]) !== normTerm(table[pair.tech]);
        const registered = (MODE_COLLAPSED_KEYS[lang] as readonly string[]).includes(key);
        return differs || registered;
      });
    });
    expect(
      uncovered,
      '这些 key 既没被不变量盖到、也没登记 ⇒ 新增 key 会静默豁免（本仓踩过一次的洞）',
    ).toEqual([]);
    expect(keys.length, '术语 key 数变了 ⇒ 本条与 agent-ui-terms 的 13 必须同批复核').toBe(13);
  });
});

/* ═══════════ ③ 真 EN 渲染：两处标题切 EN 后确实是英文 ═══════════ */

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
  setLang('zh'); // 语言是模块级全局状态 ⇒ 每条用例后复位，避免污染后续用例
});

describe('#354 真 EN 渲染 · 术语位切语言必须跟着变', () => {
  it('★ AgentBoardPage 的页面标题：zh「Agent 看板」/ en「Agent Board」（同一棵树，只换语言）', async () => {
    setLang('zh');
    const m = mountAgentBoardPage();
    await pump();
    const h1 = m.container.querySelector('h1');
    expect(h1, '页面标题 h1 不存在 ⇒ 本用例的前提不成立（不是断言放宽）').not.toBeNull();
    expect(h1!.textContent).toBe(catalogOf('zh')[AGENT_TERM_KEYS.board.human]);

    setLang('en');
    await pump();
    const h1en = m.container.querySelector('h1');
    expect(h1en, '切语言后 h1 消失').not.toBeNull();
    expect(h1en!.textContent, '切到 EN 后标题仍是中文 ⇒ 术语位没跟着语言走').toBe(
      catalogOf('en')[AGENT_TERM_KEYS.board.human],
    );
    expect(CJK.test(h1en!.textContent ?? ''), '英文态标题里还有汉字').toBe(false);
    await m.unmount();
  });

  it('★ ApplyPayloadPanel 的面板标题：zh「导入任务」/ en「Import task」', async () => {
    setLang('zh');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => {
      root.render(
        createElement(ApplyPayloadPanel, {
          projectId: null,
          onClose: () => {},
          onCommitted: () => {},
        }),
      );
    });
    await pump();
    const h2 = host.querySelector('h2');
    expect(h2, '面板标题 h2 不存在 ⇒ 前提不成立').not.toBeNull();
    expect(h2!.textContent).toBe(catalogOf('zh')[AGENT_TERM_KEYS.applyPayload.human]);

    setLang('en');
    await pump();
    const h2en = host.querySelector('h2');
    expect(h2en!.textContent, '切到 EN 后面板标题仍是中文').toBe(
      catalogOf('en')[AGENT_TERM_KEYS.applyPayload.human],
    );
    expect(CJK.test(h2en!.textContent ?? '')).toBe(false);
    act(() => root.unmount());
    document.body.removeChild(host);
  });
});
