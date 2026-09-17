// @vitest-environment jsdom
/**
 * v0.7 · T03-B **接线**验收：把 `AgentIngressPanel` 真正接进 Agent 看板（任务 #29）。
 *
 * ── 为什么单独一个 spec（T03-A 已经有一个）──
 * `tests/v07-t03a-ingress.spec.tsx` 锁的是**面板自身**（直挂组件、喂 props）。
 * 本文件锁的是**接线**：面板有没有被页面渲染出来、页面有没有把正确的值喂进去、
 * 两个入口有没有被合并。T03-A 全绿而接线是坏的，正是"建好了却无人引用"（P0-9 剩余部分）
 * 那一整类事故 —— 两个文件回答的是不同问题，不能合并。
 *
 * ── 本文件锁什么 ──
 * ① **页侧门控**：成员 / 未进入身份（role=null）点「导入任务」→ 接入面板**整块不进
 *    渲染树**。★ 断言落在 **Modal 底座**（`[role="dialog"][aria-label="接入外部写入方"]`）
 *    而不是 `[data-agent-ingress-panel]`：面板内部的 `useRoleGuard()` 自己也会 return null，
 *    故"面板标记不存在"在**页侧门控被删掉**的实现下**照样全绿**（假绿）。底座在不在，
 *    才是"页侧 `isAdmin &&` 有没有生效"的唯一判别式。
 * ② **管理员正对照**：面板渲染 + 档位/地址/令牌状态齐全（没有这条，把整个入口删掉也能让 ① 变绿）。
 * ③ **★ token 不回显原文**：保存后 `document.body` 任意角落查不到原文；且**页面传给面板的
 *    props 里没有任何一个字段的值是原文** —— 后者是本文件唯一能钉死"直接传原文"的判别式
 *    （DOM 断言对 `tokenConfigured={'<secret>'}` 这类实现是**看不见**的：非空字符串为真值，
 *    渲染出的仍是「已配置」三个字）。因此本文件把面板包了一层 **props 记录器**。
 * ④ **两个入口不合并**（主 PRD §4.1）：点「改为手动粘贴排期文件」→ 接入面板关闭、
 *    `ApplyPayloadPanel` 打开（标志物 = 它的粘贴框 `textarea`）。
 * ⑤ **诚实传值**：`status={null}` → 面板显示"还没有同步记录"（页面**绝不编造**同步记录）。
 * ⑥ **探测真的出海**：点「一键探测」→ 真的请求 `http://127.0.0.1:17788/api/agent/health`
 *    （本机档位的地址映射写错会去探一个空地址，表现为"永远不可连通"，用户以为是自己配错了）。
 * ⑦ **`transport.http.ts` 的四条错误路径**：200 / 401 / 500 / 网络异常（fake fetch，无真网络）。
 *
 * ── 本文件**不**锁什么（诚实边界）──
 * 圆角 / 尺寸 / 断点一律不在此断言：jsdom 不加载 Tailwind 产物，`getComputedStyle` 对
 * Tailwind 类恒返回空值。几何归真 Chromium 的 `v07-dline-shell.spec.ts`。
 *
 * ── 与真实实现的差异（显式声明，避免"测的不是上线的东西"）──
 *   · `useRepos` 被 `vi.mock` 顶掉（本文件只关心渲染出的 DOM，不装配 Dexie）；
 *   · `useProjectsStore.pushToast` 被换成记录器（真实实现挂 `setTimeout(…, 2000)` 自动消失，
 *     会在用例结束后于 act 之外触发 setState，制造与本任务无关的噪声）。
 *     记录器让"保存令牌后给了用户反馈"这条**可断言**，覆盖面反而更宽；
 *   · 面板被**包了一层 props 记录器**，但**不改行为**：记录后原样调用真组件，
 *     故下面所有 DOM 断言测的仍是真面板。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

/* act 环境开关由 `tests/setup.ts` 统一置位（本文件不再自行置位/还原）——
 * 逐文件置位会让同进程的下游 spec 连坐，理由详见 setup.ts 的注释。 */

/* --------------------------------- 夹具容器（供 vi.mock 工厂读取） ---------------------------------
 * `vi.mock` 工厂被提升到 import 之前，不能引用模块顶层 `let/const`。
 * `vi.hoisted` 的值同样在工厂之前就绪，故它是这里唯一合法的共享通道。 */
const H = vi.hoisted(() => ({
  projects: [] as unknown[],
  members: [] as unknown[],
  stages: [] as unknown[],
  tasks: [] as unknown[],
  /** 面板每次渲染收到的 props（★ token 安全判别的证据来源） */
  panelProps: [] as Array<Record<string, unknown>>,
  /** 被顶掉的 pushToast 收到的调用 */
  toasts: [] as Array<{ kind: string; message: string }>,
}));

/* --------------------------------- 顶掉仓储（不装配 Dexie） --------------------------------- */
vi.mock('../src/hooks/useRepos', () => {
  const ok = async (): Promise<void> => undefined;
  const bundle = {
    projects: {
      list: async () => H.projects,
      get: async () => null,
      insert: ok,
      update: ok,
      archive: ok,
      remove: ok,
    },
    stages: {
      listByProject: async () => H.stages,
      get: async () => null,
      bulkInsert: ok,
      update: ok,
      reschedule: ok,
    },
    tasks: {
      list: async () => H.tasks,
      listByProject: async () => H.tasks,
      listByAssignee: async () => [],
      get: async () => null,
      bulkInsert: ok,
      insert: ok,
      update: ok,
      remove: ok,
      upsertByExternalId: async () => ({ created: 0, updated: 0 }),
      claim: ok,
    },
    members: {
      list: async () => H.members,
      get: async () => null,
      insert: ok,
      update: ok,
      verifyCredentials: async () => false,
    },
    logs: {
      appendStageLog: ok,
      listStageLogsByStage: async () => [],
      listStageLogsByProject: async () => [],
      appendAssignment: ok,
      listAssignmentsByTask: async () => [],
    },
    contracts: {
      insert: ok,
      get: async () => null,
      linkProject: ok,
      saveConfirmedPayload: ok,
      list: async () => [],
    },
    settings: {
      get: async () => null,
      set: ok,
      all: async () => [],
      replaceAll: ok,
    },
  };
  /* ★ 必须是**同一个对象引用**：`AgentBoardPage` 的 `loadAll` 用 `useCallback(…, [])`，
   *   装载效应的依赖里有 `repos`；每次渲染返回新对象会让效应无限重跑。 */
  return { useRepos: (): unknown => bundle };
});

/* ------------------------------ ★ props 记录器（包住真组件，不替换它） ------------------------------
 * 为什么必须包：要证明"页面**没有**把 token 原文交给面板"，只能看**传进来的是什么**。
 * DOM 层看不见这件事 —— `tokenConfigured` 收到非空字符串时渲染结果与 `true` 完全一致
 * （都是「已配置」），故只看 DOM 的断言对"直接传原文"是**盲的**（假绿）。 */
vi.mock('../src/components/agent/AgentIngressPanel', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/components/agent/AgentIngressPanel')>();

  function RecordingAgentIngressPanel(props: AgentIngressPanelProps): JSX.Element | null {
    H.panelProps.push({ ...props } as unknown as Record<string, unknown>);
    return actual.AgentIngressPanel(props);
  }

  return { ...actual, AgentIngressPanel: RecordingAgentIngressPanel };
});

import { LOOPBACK_ORIGIN } from '../src/components/agent/AgentIngressPanel';
import type { AgentIngressPanelProps } from '../src/components/agent/AgentIngressPanel';
import {
  AgentBoardPage,
  AGENT_BASE_URL_STORAGE_KEY,
  AGENT_TOKEN_STORAGE_KEY,
} from '../src/pages/AgentBoardPage';
import {
  AGENT_HEALTH_PATH,
  AGENT_IMPORT_PATH,
  AGENT_TOKEN_HEADER,
  importTasks,
  probe,
} from '../src/core/agent/transport.http';
import {
  ChangxiaError,
  ChangxiaErrorCode,
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
} from '../src/core/types/enums';
import type { Member, Project } from '../src/core/types/entities';
import { useAgentStore } from '../src/store/useAgentStore';
import { useLayoutStore } from '../src/store/useLayoutStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useSettingsStore } from '../src/store/useSettingsStore';

/* ================================================================================================
 * 夹具
 * ================================================================================================ */

const PROJECT_ID = 'proj_t03b';
const ADMIN_ID = 'm-t03b-admin';
const MEMBER_ID = 'm-t03b-member';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '某茶空间',
  address: '城区某路 1 号',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-01-01T00:00:00Z',
  plannedEndAt: '2026-03-01T23:59:59Z',
  coverColor: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  /*
   * ★ v0.8（T04-B）：夹具必须声明 `kind: 'agent'`。
   *
   * 本 spec 把 `PROJECT` 挂在 **`/agent`（AgentBoardPage）** 上，而 v0.8 的隔离
   * 让 `visibility.ts::projectKindOf` 对**缺列**的项目回落 `'human'`（老库兼容口径）。
   * 于是旧夹具（无 `kind`）在 Agent 页会被**正确地**过滤掉 → `currentProjectId` 被清空
   * → `applyOpen && currentProjectId` 不成立 → 「手动粘贴」面板永不渲染，本用例假红。
   *
   * 这不是行为回归，而是**夹具语义随 v0.8 更新**：一块要被 Agent 页展示的看板，
   * 其 `kind` 就该是 `'agent'`。改夹具比放宽页面的过滤条件正确得多——
   * 后者会把 v0.8 要修的那条（Agent 页列出人类项目）重新放回来。
   */
  kind: 'agent',
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeMember(id: string, name: string, roleKind: MemberRoleKind): Member {
  return {
    id,
    name,
    role: roleKind === MemberRoleKind.Admin ? '项目负责人' : '协作成员',
    contact: null,
    avatarColor: null,
    active: true,
    roleKind,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/* --------------------------------- DOM 锚点（稳定选择器，不靠中文文案） --------------------------------- */

/** 工具行按钮：`termFor('applyPayload', 'human')` = 「导入任务」 */
const IMPORT_LABEL = '导入任务';
/** 接入面板的 **Modal 底座** —— 页侧 `isAdmin &&` 门控的唯一判别式 */
const INGRESS_DIALOG = '[role="dialog"][aria-label="接入外部写入方"]';
/** 面板自身的根标记（面板内部还有一道门控，故它**不能**单独用作页侧判别式） */
const INGRESS_PANEL = '[data-agent-ingress-panel]';
/** 手动粘贴面板的 Modal 底座（ariaLabel 与工具行按钮同词，但角色限定为 dialog） */
const MANUAL_DIALOG = `[role="dialog"][aria-label="${IMPORT_LABEL}"]`;

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** 受控 input 的「真输入」：必须走原生 setter 再派发 input 事件，React 才认 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 按文本找按钮（工具行按钮的唯一判定；`textContent` 里 svg 图标不贡献文本） */
function findButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    ) ?? null
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** 冲干净挂起的微任务（装载项目 / 探测回填都是 Promise 链） */
async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

type Actor = 'admin' | 'member' | 'none';

/**
 * 装配一次看板页。
 *
 * 身份三件（members / currentMemberId / hydrated）**在渲染前就写好**：看板的 `loadAll`
 * 是异步的，若只靠它回填，首帧的 `isAdmin` 恒为 false，门控断言会退化成"测试自己制造的
 * 未进入身份"，而不是"成员"。
 *
 * `stored` 用于模拟"本机已存有令牌 / NAS 地址"的既有状态：必须在**渲染前**写入——
 * 页面在 `useState` 初始化器里读一次存储，渲染后再写就太晚了。
 */
async function mountBoard(
  actor: Actor,
  stored: { token?: string; baseUrl?: string } = {},
): Promise<void> {
  localStorage.clear();
  H.panelProps = [];
  H.toasts = [];

  const admin = makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin);
  const member = makeMember(MEMBER_ID, '协作者乙', MemberRoleKind.Member);

  H.projects = [PROJECT];
  H.members = actor === 'member' ? [admin, member] : [admin];
  H.stages = [];
  H.tasks = [];

  if (stored.token !== undefined) localStorage.setItem(AGENT_TOKEN_STORAGE_KEY, stored.token);
  if (stored.baseUrl !== undefined) localStorage.setItem(AGENT_BASE_URL_STORAGE_KEY, stored.baseUrl);

  useProjectsStore.setState({
    projects: [PROJECT],
    stages: [],
    tasks: [],
    // 记录器取代真实 pushToast（理由见文件头"与真实实现的差异"）
    pushToast: (kind, message) => {
      H.toasts.push({ kind, message });
      return 0;
    },
  });
  useMembersStore.getState().setAll(H.members as Member[]);
  useSettingsStore.setState({
    currentMemberId: actor === 'admin' ? ADMIN_ID : actor === 'member' ? MEMBER_ID : null,
    hydrated: true,
  });
  useAgentStore.setState({ currentProjectId: PROJECT_ID, drawerTaskId: null });
  useLayoutStore.setState({ agentBoardMode: 'human' });

  host = document.createElement('div');
  document.body.appendChild(host);
  const localRoot = createRoot(host);
  root = localRoot;

  await act(async () => {
    localRoot.render(
      <MemoryRouter initialEntries={['/agent']}>
        <AgentBoardPage />
      </MemoryRouter>,
    );
  });
  await flush();
}

/** 打开接入面板（内含前置：工具行按钮必须存在 —— 否则"面板不存在"是空过） */
async function openIngress(): Promise<void> {
  const btn = findButton(IMPORT_LABEL);
  expect(btn, '工具行必须渲染「导入任务」按钮（否则下面的门控断言是空过）').not.toBeNull();
  await act(async () => {
    click(btn!);
  });
}

afterEach(() => {
  if (root) {
    const r = root;
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;

  // store 复位也放进 act：它同样是"触发 React 更新"的来源
  act(() => {
    useMembersStore.setState({ members: [] });
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
    useProjectsStore.setState({ projects: [], stages: [], tasks: [] });
    useAgentStore.setState({ currentProjectId: null, drawerTaskId: null });
  });
  localStorage.clear();
  vi.unstubAllGlobals();
});

/* ================================================================================================
 * ① 页侧门控 + ② 管理员正对照
 * ================================================================================================ */

describe('T03-B ① 页侧门控：接入面板只有管理员能打开', () => {
  it('② 对照组 · 管理员点「导入任务」→ 面板在 Modal 内渲染，档位/地址/令牌状态齐全', async () => {
    await mountBoard('admin');
    await openIngress();

    expect(
      document.querySelector(INGRESS_DIALOG),
      '管理员必须看到接入面板的 Modal 底座',
    ).not.toBeNull();

    const panel = document.querySelector(INGRESS_PANEL);
    expect(panel, '面板真组件必须渲染（记录器只是包了一层）').not.toBeNull();

    // 档位：默认本机，且分段控件如实反映（aria-selected 是读屏与验收共用的锚点）
    expect(panel!.querySelector('[data-ingress-mode="local"]')!.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(panel!.querySelector('[data-ingress-mode="nas"]')!.getAttribute('aria-selected')).toBe(
      'false',
    );

    // 地址：本机档位 = 主进程写死的事实，只读且恰为 loopback origin
    const addr = panel!.querySelector<HTMLInputElement>('[data-ingress-address]');
    expect(addr!.value).toBe(LOOPBACK_ORIGIN);
    expect(addr!.readOnly).toBe(true);

    // 令牌：初始未配置（localStorage 已清空）——页面只喂布尔，故这里是「未配置」而非空串
    expect(panel!.querySelector('[data-ingress-token-state]')!.textContent).toBe('未配置');

    // ⑤ 诚实：本轮没有"最近一次同步"的数据源 → 页面如实传 null，面板显示空态
    expect(
      panel!.querySelector('[data-ingress-sync-empty]'),
      'status 必须如实传 null（绝不编造一条同步记录把面板填满）',
    ).not.toBeNull();
    expect(panel!.querySelector('[data-ingress-sync-at]')).toBeNull();
    expect(panel!.querySelector('[data-ingress-sync-summary]')).toBeNull();

    // 未探测过 → 空态（页面不得预填一个假的"可连通"）
    expect(panel!.querySelector('[data-ingress-probe-empty]')).not.toBeNull();
    expect(panel!.querySelector('[data-ingress-probe-state]')).toBeNull();
  });

  it('① ★ 成员点「导入任务」→ 面板**整块不进渲染树**（不是"渲染了但禁用"）', async () => {
    await mountBoard('member');
    await openIngress();

    // 判别式落在 **Modal 底座**：面板内部的 useRoleGuard 也会 return null，
    // 只看 [data-agent-ingress-panel] 的话，页侧 isAdmin 门控被删掉也照样绿（假绿）。
    expect(
      document.querySelector(INGRESS_DIALOG),
      '成员不得看到接入 Modal —— 页侧 {isAdmin && …} 必须生效',
    ).toBeNull();
    expect(document.querySelector(INGRESS_PANEL)).toBeNull();
    // 面板层从未被渲染过（记录器为空 = 连 props 都没送到）
    expect(H.panelProps).toHaveLength(0);
  });

  it('① ★ 未进入身份（role=null）→ 同上，不得被当成管理员（BUG-1 教训）', async () => {
    await mountBoard('none');
    await openIngress();

    expect(document.querySelector(INGRESS_DIALOG)).toBeNull();
    expect(document.querySelector(INGRESS_PANEL)).toBeNull();
    expect(H.panelProps).toHaveLength(0);
  });

  it('门控判定只经 useRoleGuard（页面不自行比对 roleKind）', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AgentBoardPage.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('useRoleGuard');
    expect(code).not.toContain('roleKind');
    // 页侧门控的存在性（行为断言在上一组；这里锁"它就是写在渲染处"）
    expect(code).toContain('isAdmin && ingressOpen');

    /* 守卫自身有效：证明"剥注释"真的生效。
     * （本文件是**运行期**断言，不是自证——不校验的话，将来若正则失手把整个文件剥成空串，
     *   上面两条 `not.toContain` 会一起变成"全过"的假绿。） */
    expect(source).toContain('/*'); // 原文确实有块注释
    expect(code).not.toContain('/*'); // 剥完之后不剩
    expect(code.length).toBeLessThan(source.length); // 真的少了东西
    expect(code.length).toBeGreaterThan(1000); // 但没被剥成空串
  });
});

/* ================================================================================================
 * ③ ★ token 安全：原文既不进 DOM，也不进面板 props
 * ================================================================================================ */

describe('T03-B ③ ★ token：写入后不回显原文', () => {
  const SECRET = 'idplan-agent-token-T03B-SECRET-abcdef123456';

  it('★ 保存后：原文只在 localStorage，DOM 与面板 props 里都查不到', async () => {
    await mountBoard('admin');
    await openIngress();

    const input = document.querySelector<HTMLInputElement>('[data-ingress-token-input]');
    expect(input).not.toBeNull();
    expect(input!.type, '令牌输入框必须是 password 型（防肩窥）').toBe('password');

    await act(async () => {
      setInputValue(input!, SECRET);
    });
    await act(async () => {
      click(document.querySelector('[data-ingress-token-save]')!);
    });
    await flush(1);

    // ① 唯一落点：localStorage（键取自页面的导出常量，避免测试把键名写成第二份真相）
    expect(AGENT_TOKEN_STORAGE_KEY).toBe('idplan.agentToken');
    expect(localStorage.getItem(AGENT_TOKEN_STORAGE_KEY)).toBe(SECRET);

    // ② ★ DOM 任意角落都查不到原文（Modal 挂在 document.body，故查整个 body）
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent ?? '').not.toContain(SECRET);
    // 输入框已清空（原文不留在组件 state）
    expect(input!.value).toBe('');

    // ③ ★ 面板只收到布尔 —— 这条是本文件唯一能钉死"直接传原文"的判别式
    const last = H.panelProps[H.panelProps.length - 1]!;
    expect(
      typeof last.tokenConfigured,
      'tokenConfigured 必须是布尔；传原文（非空字符串）在此处必红',
    ).toBe('boolean');
    expect(last.tokenConfigured).toBe(true);
    // 任何一次投递的任何字段，值里都不得出现原文
    expect(JSON.stringify(H.panelProps)).not.toContain(SECRET);

    // ④ 布尔真的被用上（不是恒 false 之类的"看起来安全"）：徽标翻成「已配置」
    const state = document.querySelector('[data-ingress-token-state]');
    expect(state!.getAttribute('data-ingress-token-state')).toBe('configured');
    expect(state!.textContent).toBe('已配置');

    // ⑤ 反馈走全站既有 toast 通道（不另造提示条）
    expect(H.toasts.some((t) => t.message.includes('访问令牌'))).toBe(true);
  });

  it('已有存盘令牌 → 打开面板即显示「已配置」，但原文依旧不进 DOM', async () => {
    const PRE = 'preexisting-token-value';
    await mountBoard('admin', { token: PRE });
    await openIngress();

    const state = document.querySelector('[data-ingress-token-state]');
    expect(state!.getAttribute('data-ingress-token-state')).toBe('configured');
    expect(state!.textContent).toBe('已配置');
    expect(document.body.innerHTML).not.toContain(PRE);
    expect(JSON.stringify(H.panelProps)).not.toContain(PRE);
  });

  it('NAS 地址持久化 + 改档位/改地址都作废旧探测结果', async () => {
    await mountBoard('admin', { baseUrl: 'https://old.example.com:7788' });
    await openIngress();

    // 切到 NAS 档位 → 地址框转为可编辑，并展示存盘地址
    await act(async () => {
      click(document.querySelector('[data-ingress-mode="nas"]')!);
    });
    const addr = document.querySelector<HTMLInputElement>('[data-ingress-address]');
    expect(addr!.readOnly).toBe(false);
    expect(addr!.value).toBe('https://old.example.com:7788');

    await act(async () => {
      setInputValue(addr!, 'https://nas.example.com:7788');
    });
    expect(localStorage.getItem(AGENT_BASE_URL_STORAGE_KEY)).toBe('https://nas.example.com:7788');

    // 旧探测结果必须被清掉（否则显示的是**另一个地址**的结论，误导用户）
    expect(document.querySelector('[data-ingress-probe-empty]')).not.toBeNull();
    expect(document.querySelector('[data-ingress-probe-state]')).toBeNull();
  });
});

/* ================================================================================================
 * ④ 两个入口不合并（主 PRD §4.1）
 * ================================================================================================ */

describe('T03-B ④ 「手动粘贴」是另一个入口（不合并）', () => {
  it('★ 点「改为手动粘贴排期文件」→ 接入面板关闭、ApplyPayloadPanel 打开', async () => {
    await mountBoard('admin');
    await openIngress();
    expect(document.querySelector(INGRESS_DIALOG)).not.toBeNull();

    await act(async () => {
      click(document.querySelector('[data-ingress-manual]')!);
    });

    // 接入面板必须**关闭**：若把该入口接到 setIngressOpen（合并两入口），此行必红
    expect(document.querySelector(INGRESS_DIALOG), '接入面板必须关闭').toBeNull();
    expect(document.querySelector(INGRESS_PANEL), '接入面板不再渲染').toBeNull();

    const manual = document.querySelector(MANUAL_DIALOG);
    expect(manual, '手动粘贴面板必须打开（它是离线兜底，另一条通道）').not.toBeNull();
    expect(
      manual!.querySelector('textarea'),
      '手动粘贴面板的标志物 = 粘贴框（接入面板内不含 textarea，故这同时证明是另一个组件）',
    ).not.toBeNull();
  });

  it('接入面板内部不含粘贴框（它只提供跳转回调）', async () => {
    await mountBoard('admin');
    await openIngress();

    expect(document.querySelector(INGRESS_PANEL)!.querySelector('textarea')).toBeNull();
  });
});

/* ================================================================================================
 * ⑥ 探测真的出海（本机档位的地址映射 + 结果如实回填）
 * ================================================================================================ */

describe('T03-B ⑥ 「一键探测」真的打通道', () => {
  it('★ 管理员点探测 → 请求本机 loopback 的健康端点，成功结果如实回填', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            version: '0.7.0.0001',
            projects: [
              { id: 'p1', name: 'P1' },
              { id: 'p2', name: 'P2' },
            ],
            agentSeats: { used: 1, limit: 3 },
          }),
      };
    });

    await mountBoard('admin');
    await openIngress();

    await act(async () => {
      click(document.querySelector('[data-ingress-probe-action]')!);
    });
    await flush();

    // 本机档位必须探 loopback（映射写错 → 探空地址 → 永远"不可连通"）
    expect(urls[0]).toBe(`http://${LOOPBACK_ORIGIN}${AGENT_HEALTH_PATH}`);
    expect(urls[0]).toBe('http://127.0.0.1:17788/api/agent/health');

    const state = document.querySelector('[data-ingress-probe-state]');
    expect(state!.getAttribute('data-ingress-probe-state')).toBe('ok');
    expect(state!.textContent).toBe('可连通');
    expect(document.body.textContent ?? '').toContain('0.7.0.0001');
    expect(document.body.textContent ?? '').toContain('项目 2 个');
  });

  it('★ 探测失败（网络异常）→ 面板显示「不可连通」，页面不崩（V1-13 假无响应）', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    await mountBoard('admin');
    await openIngress();

    await act(async () => {
      click(document.querySelector('[data-ingress-probe-action]')!);
    });
    await flush();

    const state = document.querySelector('[data-ingress-probe-state]');
    expect(state, '探测失败也必须有结论（不许"点了没反应"）').not.toBeNull();
    expect(state!.getAttribute('data-ingress-probe-state')).toBe('fail');
    expect(state!.textContent).toBe('不可连通');
    expect(document.querySelector(INGRESS_PANEL)).not.toBeNull();
  });
});

/* ================================================================================================
 * ⑦ `transport.http.ts`：四条错误路径（fake fetch，零真网络）
 * ================================================================================================ */

interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

/** 桩一次响应；返回被调用记录（便于断言 URL / 头 / body 真的对） */
function stubHttp(status: number, body: unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: FetchCall['init']) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  });
  return calls;
}

/** 桩网络层失败（fetch reject） */
function stubNetworkFailure(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: FetchCall['init']) => {
    calls.push({ url, init });
    throw new TypeError('Failed to fetch');
  });
  return calls;
}

/** 取抛出物（便于断言 code / userMessage，而不是只断言"抛了"） */
async function catchError(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (err: unknown) => err,
  );
}

describe('T03-B ⑦ transport.http · probe（★ 契约：永不抛）', () => {
  const BASE = 'https://nas.example.com:7788';

  it('200 + 合法 body → ok:true，字段逐字映射（projects 长度 → projectCount）', async () => {
    const calls = stubHttp(200, {
      ok: true,
      version: '0.7.0.0001',
      projects: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      agentSeats: { used: 1, limit: 3 },
    });

    const r = await probe(BASE, 'tok-123');

    expect(r).toEqual({
      ok: true,
      version: '0.7.0.0001',
      seatUsed: 1,
      seatLimit: 3,
      projectCount: 2,
    });
    expect(calls[0]!.url).toBe(`${BASE}${AGENT_HEALTH_PATH}`);
    expect(calls[0]!.init?.method).toBe('GET');
    expect(calls[0]!.init?.headers?.[AGENT_TOKEN_HEADER]).toBe('tok-123');
  });

  it('401 → 永不抛，返回 ok:false（配错令牌是"答不上来"，不是异常）', async () => {
    stubHttp(401, { error: { code: 'unauthorized', userMessage: '缺少访问令牌。' } });

    const r = await probe(BASE, 'wrong');

    expect(r.ok).toBe(false);
    expect(r.version).toBe('—');
  });

  it('500 → 永不抛，返回 ok:false', async () => {
    stubHttp(500, { error: { code: 'internal', userMessage: '服务器内部错误。' } });

    expect((await probe(BASE, 'tok')).ok).toBe(false);
  });

  it('网络异常（fetch reject）→ 永不抛，返回 ok:false', async () => {
    stubNetworkFailure();

    expect((await probe(BASE, 'tok')).ok).toBe(false);
  });

  it('响应不是 JSON → ok:false（不抛、不渲染半个数字）', async () => {
    stubHttp(200, '<html>502 Bad Gateway</html>');

    expect((await probe(BASE, 'tok')).ok).toBe(false);
  });

  it('`ok` 只认严格 true：body.ok="true" 视为失败（防契约漂移）', async () => {
    stubHttp(200, { ok: 'true', version: '0.7.0.0001' });

    expect((await probe(BASE, 'tok')).ok).toBe(false);
  });

  it('地址为空 → 不发请求，直接 ok:false（用户还没填地址）', async () => {
    const calls = stubHttp(200, { ok: true, version: 'x' });

    const r = await probe('   ', 'tok');

    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('无协议地址自动补 http://（127.0.0.1:17788 是 loopback 的既定形态）', async () => {
    const calls = stubHttp(200, { ok: true, version: 'x' });

    await probe(LOOPBACK_ORIGIN, '');

    expect(calls[0]!.url).toBe(`http://${LOOPBACK_ORIGIN}${AGENT_HEALTH_PATH}`);
    // 空令牌不发送该头（不留一个空值头让人误以为已带鉴权）
    expect(calls[0]!.init?.headers?.[AGENT_TOKEN_HEADER]).toBeUndefined();
  });
});

describe('T03-B ⑦ transport.http · importTasks（★ 契约：失败必须抛）', () => {
  const BASE = 'https://nas.example.com:7788';
  const PAYLOAD = { schemaId: 'idplan.agent-payload', tasks: [] };

  it('200 → 原样回执（四键不加工）+ POST + 落点名走 query', async () => {
    const result = {
      created: 2,
      updated: 1,
      rejected: [],
      stage: { kind: 'resolved', stageId: 's1', stageName: '现场勘测' },
    };
    const calls = stubHttp(200, result);

    const r = await importTasks(BASE, 'tok-123', PAYLOAD, {
      stageName: '现场勘测',
      createStageIfMissing: '1',
    });

    expect(r).toEqual(result);

    const expectedQuery = new URLSearchParams({
      stageName: '现场勘测',
      createStageIfMissing: '1',
    }).toString();
    expect(calls[0]!.url).toBe(`${BASE}${AGENT_IMPORT_PATH}?${expectedQuery}`);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.headers?.[AGENT_TOKEN_HEADER]).toBe('tok-123');
    expect(calls[0]!.init?.headers?.['Content-Type']).toBe('application/json');
    expect(calls[0]!.init?.body).toBe(JSON.stringify(PAYLOAD));
  });

  it('无 query → URL 不带尾问号（空串一律不发）', async () => {
    const calls = stubHttp(200, { created: 0, updated: 0, rejected: [], stage: {} });

    await importTasks(BASE, 'tok', PAYLOAD, { stageName: '   ', projectId: '' });

    expect(calls[0]!.url).toBe(`${BASE}${AGENT_IMPORT_PATH}`);
  });

  it('401 → 抛 ChangxiaError(Validation) 并透出服务端 userMessage（不是"重试一次"）', async () => {
    stubHttp(401, {
      error: { code: 'unauthorized', userMessage: '缺少或错误的 Agent 访问令牌。' },
    });

    const err = await catchError(() => importTasks(BASE, 'wrong', PAYLOAD));

    expect(err).toBeInstanceOf(ChangxiaError);
    expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).userMessage).toContain('令牌');
  });

  it('400 → Validation；409 → Conflict；404 → NotFound（状态码各有明确去向）', async () => {
    stubHttp(400, { error: { code: 'invalid_field', userMessage: 'tasks[0].title 不能为空。' } });
    expect((await catchError(() => importTasks(BASE, 'tok', PAYLOAD)) as ChangxiaError).code).toBe(
      ChangxiaErrorCode.Validation,
    );

    stubHttp(409, { error: { code: 'conflict', userMessage: '任务已被他人认领。' } });
    expect((await catchError(() => importTasks(BASE, 'tok', PAYLOAD)) as ChangxiaError).code).toBe(
      ChangxiaErrorCode.Conflict,
    );

    stubHttp(404, { error: { code: 'not_found', userMessage: '端点不存在。' } });
    expect((await catchError(() => importTasks(BASE, 'tok', PAYLOAD)) as ChangxiaError).code).toBe(
      ChangxiaErrorCode.NotFound,
    );
  });

  it('500 → 抛 ChangxiaError(Storage)（传输完成了，是服务端自己失败）', async () => {
    stubHttp(500, { error: { code: 'internal', userMessage: '服务器内部错误。' } });

    const err = (await catchError(() => importTasks(BASE, 'tok', PAYLOAD))) as ChangxiaError;

    expect(err.code).toBe(ChangxiaErrorCode.Storage);
    expect(err.userMessage).toContain('服务器内部错误');
  });

  it('网络异常 → 抛 ChangxiaError(Network) 且带兜底文案（绝不静默返回空结果）', async () => {
    stubNetworkFailure();

    const err = await catchError(() => importTasks(BASE, 'tok', PAYLOAD));

    expect(err).toBeInstanceOf(ChangxiaError);
    expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.Network);
    expect((err as ChangxiaError).userMessage).toContain('无法连接到该地址');
  });

  it('地址为空 → Validation 且不发请求（写库不成，必须让调用方知道）', async () => {
    const calls = stubHttp(200, { created: 0, updated: 0, rejected: [], stage: {} });

    const err = (await catchError(() => importTasks('', 'tok', PAYLOAD))) as ChangxiaError;

    expect(err.code).toBe(ChangxiaErrorCode.Validation);
    expect(calls).toHaveLength(0);
  });

  it('200 但响应不是 JSON → ParseFailed（"写成功了吗"不能靠猜）', async () => {
    stubHttp(200, 'not json at all');

    const err = (await catchError(() => importTasks(BASE, 'tok', PAYLOAD))) as ChangxiaError;

    expect(err.code).toBe(ChangxiaErrorCode.ParseFailed);
  });
});
