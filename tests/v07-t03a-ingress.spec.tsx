// @vitest-environment jsdom
/**
 * v0.7 T03-A · 接入配置面板（`AgentIngressPanel`）—— 纯展示层，jsdom 判得了的那半。
 *
 * ── 本文件锁什么 ──
 * ① **权限门控**（§5.4 #16）：成员 / 未进入身份（role=null）**看不到**面板；
 * ② **地址**：本机档位只读展示 `127.0.0.1:17788`；NAS 档位可编辑；
 * ③ **★ token 安全**：写入后只回显「已配置」+ 复制按钮，**DOM 里查不到原文**；
 * ④ **服务状态 / 最近同步记录**：值由 props 传入（空态 / 有值 / `dataLayer='unavailable'` 告警）；
 * ⑤ **两个入口不合并**：面板只提供 `onOpenManual` 跳转回调，不内嵌手动粘贴；
 * ⑥ **纯度守卫**：面板源码内**零网络、零仓储**（本批硬约束）。
 *
 * ── 本文件**不**锁什么（诚实边界）──
 * 圆角 / 尺寸一律不在此断言：jsdom 不加载 Tailwind 产物，`getComputedStyle` 对
 * Tailwind 类恒返回空值，在此断言「r12」只能是自欺（本项目已因此栽过一次）。
 * 几何事实归真 Chromium 几何 spec；本文件只判 DOM 结构、属性、文本、回调。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import {
  AgentIngressPanel,
  LOOPBACK_ORIGIN,
  type AgentIngressPanelProps,
} from '../src/components/agent/AgentIngressPanel';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';
import type { Member } from '../src/core/types/entities';

/* act 环境开关由 `tests/setup.ts` 统一置位（本文件不再自行置位/还原）——
 * 逐文件置位会让同进程的下游 spec 连坐，理由详见 setup.ts 的注释。 */

/* --------------------------------- 夹具 --------------------------------- */

function makeMember(
  partial: Partial<Member> & { id: string; name: string; roleKind: MemberRoleKind },
): Member {
  return {
    role: 'designer',
    contact: null,
    avatarColor: '#888888',
    active: true,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

/** 把当前身份设成指定角色（`null` = 未进入身份） */
function setRole(roleKind: MemberRoleKind | null): void {
  if (roleKind === null) {
    useMembersStore.setState({ members: [] });
    useSettingsStore.setState({ currentMemberId: null, hydrated: true });
    return;
  }
  const m = makeMember({ id: 'm-ingress-test', name: '接入测试身份', roleKind });
  useMembersStore.setState({ members: [m] });
  useSettingsStore.setState({ currentMemberId: m.id, hydrated: true });
}

function defaultProps(overrides: Partial<AgentIngressPanelProps> = {}): AgentIngressPanelProps {
  return {
    mode: 'local',
    onModeChange: vi.fn(),
    address: '',
    onAddressChange: vi.fn(),
    tokenConfigured: false,
    onSaveToken: vi.fn(),
    onCopyToken: vi.fn(),
    // 2026-09-23 重设计新增（本机档主入口）
    ingressFile: null,
    onGenerateIngress: vi.fn(),
    onCopyIngressPath: vi.fn(),
    onCopyIngressInstruction: vi.fn(),
    probeResult: null,
    onProbe: vi.fn(),
    status: null,
    onOpenManual: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** 卸载当前挂载的树（同一用例内多次 render 时必须先收掉前一棵，否则旧树仍订阅 store，
 *  后续 setState 会在「未挂载完成」的时机触发更新 → act 噪声 + 潜在的假绿断言）。 */
function unmountCurrent(): void {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

function render(node: React.ReactElement): HTMLDivElement {
  unmountCurrent(); // 防御：同一用例内重复 render 不泄漏前一棵树
  host = document.createElement('div');
  document.body.appendChild(host);
  const localHost = host;
  root = createRoot(localHost);
  act(() => {
    root!.render(node);
  });
  return localHost;
}

/** 受控 input 的「真输入」模拟：必须走原生 setter 再派发 input 事件，React 才认 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

afterEach(() => {
  unmountCurrent();
  // store 复位也放进 act：它同样是「触发 React 更新」的来源
  act(() => {
    useMembersStore.setState({ members: [] });
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
});

/* ========================= ① 权限门控（§5.4 #16）========================= */

describe('① 权限门控：成员 / 未进入身份看不到接入面板', () => {
  it('管理员（admin）→ 面板渲染', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(<AgentIngressPanel {...defaultProps()} />);

    expect(el.querySelector('[data-agent-ingress-panel]')).not.toBeNull();
  });

  it('★ 成员（member）→ 整块不渲染（不是「渲染了但禁用」）', () => {
    setRole(MemberRoleKind.Member);
    const el = render(<AgentIngressPanel {...defaultProps()} />);

    expect(el.querySelector('[data-agent-ingress-panel]')).toBeNull();
    expect(el.textContent).toBe('');
  });

  it('★ 未进入身份（role=null）→ 同样不渲染（不得被当成管理员，BUG-1 教训）', () => {
    setRole(null);
    const el = render(<AgentIngressPanel {...defaultProps()} />);

    expect(el.querySelector('[data-agent-ingress-panel]')).toBeNull();
  });
});

/* ========================= ② 地址 ========================= */

describe('② 服务地址：本机只读 / NAS 可编辑', () => {
  it('本机档位：只读展示 127.0.0.1:17788 且 readOnly=true', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(<AgentIngressPanel {...defaultProps({ mode: 'local' })} />);
    const input = el.querySelector<HTMLInputElement>('[data-ingress-address]');

    expect(input).not.toBeNull();
    expect(input!.value).toBe(LOOPBACK_ORIGIN);
    expect(LOOPBACK_ORIGIN).toBe('127.0.0.1:17788');
    expect(input!.readOnly).toBe(true);
  });

  it('NAS 档位：可编辑，展示传入地址，且改动回调出海', () => {
    setRole(MemberRoleKind.Admin);
    const onAddressChange = vi.fn();
    const el = render(
      <AgentIngressPanel
        {...defaultProps({
          mode: 'nas',
          address: 'https://nas.example.com:7788',
          onAddressChange,
        })}
      />,
    );
    const input = el.querySelector<HTMLInputElement>('[data-ingress-address]');

    expect(input!.readOnly).toBe(false);
    expect(input!.value).toBe('https://nas.example.com:7788');

    act(() => {
      setInputValue(input!, 'https://nas2.example.com:7788');
    });
    expect(onAddressChange).toHaveBeenCalledWith('https://nas2.example.com:7788');
  });

  it('档位切换按钮触发 onModeChange', () => {
    setRole(MemberRoleKind.Admin);
    const onModeChange = vi.fn();
    const el = render(<AgentIngressPanel {...defaultProps({ mode: 'local', onModeChange })} />);

    act(() => {
      click(el.querySelector('[data-ingress-mode="nas"]')!);
    });
    expect(onModeChange).toHaveBeenCalledWith('nas');
  });
});

/* ========================= ③ 本机档 · 接入文件（2026-09-23 重设计的主入口）========================= */

describe('③ 本机档 · 接入信息：生成 / 轮换 / 路径复制（旧「粘贴令牌」死链的替代）', () => {
  it('未生成 → 「生成接入信息」可点；复制路径 / 复制指令禁用；无路径展示', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(
      <AgentIngressPanel {...defaultProps({ mode: 'local', tokenConfigured: false, ingressFile: null })} />,
    );

    expect(el.querySelector('[data-ingress-generate]')).not.toBeNull();
    // 未配置时没有「重新生成」（轮换是显式动作，不该诱导首次用户）
    expect(el.querySelector('[data-ingress-regenerate]')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-ingress-copy-path]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-ingress-copy-instruction]')!.disabled).toBe(true);
    expect(el.querySelector('[data-ingress-file-path]')).toBeNull();
    expect(el.textContent).toContain('尚未生成');
  });

  it('★ 点击生成 → onGenerateIngress(false)：无令牌时自动生成（治旧死锁的那一步）', () => {
    setRole(MemberRoleKind.Admin);
    const onGenerateIngress = vi.fn();
    const el = render(
      <AgentIngressPanel {...defaultProps({ mode: 'local', tokenConfigured: false, onGenerateIngress })} />,
    );

    act(() => {
      click(el.querySelector('[data-ingress-generate]')!);
    });
    expect(onGenerateIngress).toHaveBeenCalledTimes(1);
    // rotate=false：有令牌则沿用、无则生成——不是默认强制轮换
    expect(onGenerateIngress).toHaveBeenCalledWith(false);
  });

  it('已配置 → 「重新生成」出现且走 rotate=true（换新令牌，旧令牌即失效）', () => {
    setRole(MemberRoleKind.Admin);
    const onGenerateIngress = vi.fn();
    const el = render(
      <AgentIngressPanel
        {...defaultProps({ mode: 'local', tokenConfigured: true, onGenerateIngress })}
      />,
    );

    const regen = el.querySelector('[data-ingress-regenerate]');
    expect(regen).not.toBeNull();
    act(() => {
      click(regen!);
    });
    expect(onGenerateIngress).toHaveBeenCalledWith(true);
  });

  it('★ 写入成功后：路径原样展示（机器可读），两个复制按钮均可用', () => {
    setRole(MemberRoleKind.Admin);
    const onCopyIngressPath = vi.fn();
    const onCopyIngressInstruction = vi.fn();
    const el = render(
      <AgentIngressPanel
        {...defaultProps({
          mode: 'local',
          tokenConfigured: true,
          ingressFile: { path: 'C:\\Users\\x\\Documents\\ID Plan\\agent-ingress.json' },
          onCopyIngressPath,
          onCopyIngressInstruction,
        })}
      />,
    );

    const pathBox = el.querySelector('[data-ingress-file-path]');
    expect(pathBox!.textContent).toBe('C:\\Users\\x\\Documents\\ID Plan\\agent-ingress.json');

    act(() => {
      click(el.querySelector('[data-ingress-copy-path]')!);
    });
    expect(onCopyIngressPath).toHaveBeenCalledTimes(1);
    act(() => {
      click(el.querySelector('[data-ingress-copy-instruction]')!);
    });
    expect(onCopyIngressInstruction).toHaveBeenCalledTimes(1);
  });

  it('★ 安全不变式延续：令牌原文在面板 DOM 里任何角落都不出现（本机档连输入框都没有）', () => {
    setRole(MemberRoleKind.Admin);
    const SECRET = 'idp_0123456789abcdef0123456789abcdef';
    const el = render(
      <AgentIngressPanel
        {...defaultProps({
          mode: 'local',
          tokenConfigured: true,
          ingressFile: { path: 'C:\\x\\agent-ingress.json' },
        })}
      />,
    );

    // 本机档没有任何 token 输入框（自动生成，无需粘贴）——比旧形态更彻底
    expect(el.querySelector('[data-ingress-token-input]')).toBeNull();
    // 面板只暴露布尔 + 文件路径；原文靠 localStorage / 接入文件 / 剪贴板传递
    expect(el.innerHTML).not.toContain(SECRET);
    expect(el.textContent).not.toContain(SECRET);
    expect(el.outerHTML).not.toContain(SECRET);
    // 状态徽标仍只有布尔语义
    const state = el.querySelector('[data-ingress-token-state]');
    expect(['configured', 'unset']).toContain(state!.getAttribute('data-ingress-token-state'));
  });
});

/* ========================= ③' NAS 档 · 服务端令牌（粘贴，原文不回显）========================= */

describe("③' NAS 档 · 访问令牌：写入后只回显「已配置」，DOM 里查不到原文", () => {
  const SECRET = 'idplan-agent-token-SECRET-abc123XYZ';

  it('未配置 → 显示「未配置」，复制按钮禁用', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(<AgentIngressPanel {...defaultProps({ mode: 'nas', tokenConfigured: false })} />);

    const state = el.querySelector('[data-ingress-token-state-nas]');
    expect(state!.textContent).toBe('未配置');
    expect(state!.getAttribute('data-ingress-token-state-nas')).toBe('unset');
    expect(el.querySelector<HTMLButtonElement>('[data-ingress-token-copy]')!.disabled).toBe(true);
  });

  it('已配置 → 显示「已配置」且复制按钮可用', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(<AgentIngressPanel {...defaultProps({ mode: 'nas', tokenConfigured: true })} />);

    const state = el.querySelector('[data-ingress-token-state-nas]');
    expect(state!.textContent).toBe('已配置');
    expect(state!.getAttribute('data-ingress-token-state-nas')).toBe('configured');
    expect(el.querySelector<HTMLButtonElement>('[data-ingress-token-copy]')!.disabled).toBe(false);
  });

  it('★ 保存后：原文不在 DOM、不在输入框、回调拿到的是原文', () => {
    setRole(MemberRoleKind.Admin);
    const onSaveToken = vi.fn();
    const el = render(<AgentIngressPanel {...defaultProps({ mode: 'nas', onSaveToken })} />);
    const input = el.querySelector<HTMLInputElement>('[data-ingress-token-input]');

    // 输入框是 password 型（防肩窥 / 防浏览器自动填充）
    expect(input!.type).toBe('password');
    expect(input!.autocomplete).toBe('off');

    act(() => {
      setInputValue(input!, SECRET);
    });
    act(() => {
      click(el.querySelector('[data-ingress-token-save]')!);
    });

    // 回调确实拿到了原文（只有这一条出海路径）
    expect(onSaveToken).toHaveBeenCalledTimes(1);
    expect(onSaveToken).toHaveBeenCalledWith(SECRET);

    // ★ 核心安全断言：保存后 DOM 任何角落都查不到原文
    expect(el.innerHTML).not.toContain(SECRET);
    expect(el.textContent).not.toContain(SECRET);
    expect(el.outerHTML).not.toContain(SECRET);
    // 输入框已清空（原文不留在组件 state）
    expect(input!.value).toBe('');
  });

  it('★ 即使 tokenConfigured=true，面板里也没有任何承载原文的节点', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(<AgentIngressPanel {...defaultProps({ mode: 'nas', tokenConfigured: true })} />);

    // 面板只暴露布尔事实：state 只有 configured / unset 两个取值
    const state = el.querySelector('[data-ingress-token-state-nas]');
    expect(['configured', 'unset']).toContain(state!.getAttribute('data-ingress-token-state-nas'));
    // 唯一承载用户输入的 token 输入框是空的（只有地址框会有值，且那是既定事实非机密）
    expect(el.querySelector<HTMLInputElement>('[data-ingress-token-input]')!.value).toBe('');
    // React 会给受控 input 落一个空的 value 属性（`""`），这同样不含原文；
    // 断言「属性为空」而非「属性不存在」——两者都安全，后者是 React 的实现细节。
    expect(
      el.querySelector('[data-ingress-token-input]')!.getAttribute('value') ?? '',
    ).toBe('');
  });

  it('复制按钮走回调取件（不从 DOM 读值）', () => {
    setRole(MemberRoleKind.Admin);
    const onCopyToken = vi.fn();
    const el = render(
      <AgentIngressPanel {...defaultProps({ mode: 'nas', tokenConfigured: true, onCopyToken })} />,
    );

    act(() => {
      click(el.querySelector('[data-ingress-token-copy]')!);
    });
    expect(onCopyToken).toHaveBeenCalledTimes(1);
  });

  it('空草稿不触发保存（避免写入空令牌）', () => {
    setRole(MemberRoleKind.Admin);
    const onSaveToken = vi.fn();
    const el = render(<AgentIngressPanel {...defaultProps({ mode: 'nas', onSaveToken })} />);

    expect(el.querySelector<HTMLButtonElement>('[data-ingress-token-save]')!.disabled).toBe(true);
    act(() => {
      click(el.querySelector('[data-ingress-token-save]')!);
    });
    expect(onSaveToken).not.toHaveBeenCalled();
  });
});

/* ========================= ④ 服务状态 / 同步记录 ========================= */

describe('④ 服务状态与最近同步记录（值由 props 传入，本批不自行探测）', () => {
  it('未探测 → 空态文案，且不渲染状态徽标', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(<AgentIngressPanel {...defaultProps({ probeResult: null })} />);

    expect(el.querySelector('[data-ingress-probe-empty]')).not.toBeNull();
    expect(el.querySelector('[data-ingress-probe-state]')).toBeNull();
  });

  it('探测成功（dataLayer=ready）→ 可连通 + version + 席位/项目数', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(
      <AgentIngressPanel
        {...defaultProps({
          probeResult: {
            ok: true,
            version: '0.7.0.0001',
            dataLayer: 'ready',
            seatUsed: 1,
            seatLimit: 3,
            projectCount: 4,
          },
        })}
      />,
    );

    const state = el.querySelector('[data-ingress-probe-state]');
    expect(state!.textContent).toBe('可连通');
    expect(state!.getAttribute('data-ingress-probe-state')).toBe('ok');
    expect(el.textContent).toContain('0.7.0.0001');
    expect(el.querySelector('[data-ingress-datalayer="ready"]')).not.toBeNull();
    expect(el.textContent).toContain('1 / 3');
    expect(el.textContent).toContain('项目 4 个');
  });

  it('★ V1-13：dataLayer=unavailable → 显式告警「ID Plan 未运行」，绝不静默失败', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(
      <AgentIngressPanel
        {...defaultProps({
          probeResult: { ok: true, version: '0.7.0.0001', dataLayer: 'unavailable' },
        })}
      />,
    );

    expect(el.querySelector('[data-ingress-datalayer="unavailable"]')).not.toBeNull();
    const alert = el.querySelector('[role="alert"]');
    expect(alert, '不可用时应给出 role=alert 的显式提示').not.toBeNull();
    expect(alert!.textContent).toContain('ID Plan 未运行');
  });

  it('探测失败（ok=false）→ 不可连通', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(
      <AgentIngressPanel
        {...defaultProps({ probeResult: { ok: false, version: '—' } })}
      />,
    );

    const state = el.querySelector('[data-ingress-probe-state]');
    expect(state!.getAttribute('data-ingress-probe-state')).toBe('fail');
    expect(state!.textContent).toBe('不可连通');
  });

  it('「一键探测」按钮触发 onProbe', () => {
    setRole(MemberRoleKind.Admin);
    const onProbe = vi.fn();
    const el = render(<AgentIngressPanel {...defaultProps({ onProbe })} />);

    act(() => {
      click(el.querySelector('[data-ingress-probe-action]')!);
    });
    expect(onProbe).toHaveBeenCalledTimes(1);
  });

  it('无同步记录 → 空态；有记录 → 展示 lastSyncAt / lastSyncSummary', () => {
    setRole(MemberRoleKind.Admin);
    const empty = render(<AgentIngressPanel {...defaultProps({ status: null })} />);
    expect(empty.querySelector('[data-ingress-sync-empty]')).not.toBeNull();

    const withData = render(
      <AgentIngressPanel
        {...defaultProps({
          status: { lastSyncAt: '2026-09-11T08:30:00.000Z', lastSyncSummary: '新增 3 条，更新 1 条' },
        })}
      />,
    );
    expect(withData.querySelector('[data-ingress-sync-at]')!.textContent).toBe(
      '2026-09-11T08:30:00.000Z',
    );
    expect(withData.querySelector('[data-ingress-sync-summary]')!.textContent).toBe(
      '新增 3 条，更新 1 条',
    );
  });

  it('同步记录字段为空 → 归一为「—」，不渲染 null / Invalid Date', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(
      <AgentIngressPanel {...defaultProps({ status: { lastSyncAt: null, lastSyncSummary: null } })} />,
    );

    expect(el.querySelector('[data-ingress-sync-at]')!.textContent).toBe('—');
    expect(el.querySelector('[data-ingress-sync-summary]')!.textContent).toBe('—');
    expect(el.textContent).not.toContain('null');
    expect(el.textContent).not.toContain('Invalid Date');
  });

  it('坏时间戳 → 「—」（不抛异常、不渲染 Invalid Date）', () => {
    setRole(MemberRoleKind.Admin);
    const el = render(
      <AgentIngressPanel
        {...defaultProps({ status: { lastSyncAt: 'not-a-date', lastSyncSummary: 'x' } })}
      />,
    );

    expect(el.querySelector('[data-ingress-sync-at]')!.textContent).toBe('—');
  });
});

/* ========================= ⑤ 两个入口不合并 ========================= */

describe('⑤ 「手动粘贴」是另一个入口（不合并）', () => {
  it('面板只提供跳转回调，不内嵌手动粘贴 textarea', () => {
    setRole(MemberRoleKind.Admin);
    const onOpenManual = vi.fn();
    const el = render(<AgentIngressPanel {...defaultProps({ onOpenManual })} />);

    // 面板内**不应**有粘贴输入区（那是 ApplyPayloadPanel 的职责）
    expect(el.querySelector('textarea')).toBeNull();

    act(() => {
      click(el.querySelector('[data-ingress-manual]')!);
    });
    expect(onOpenManual).toHaveBeenCalledTimes(1);
  });
});

/* ========================= ⑥ 纯度守卫（源码级）========================= */

describe('⑥ 纯度守卫：本批面板内零网络、零仓储', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/agent/AgentIngressPanel.tsx'),
    'utf8',
  );

  /**
   * 去掉块注释与行注释后的**代码**。
   *
   * 为什么必须剥注释：本组件的文件头注释**点名**了它禁止的东西
   * （「不 import `useAgentStore`」「禁止自行比对 `roleKind`」「`probe()` 的结果」）——
   * 那是**文档**，不是违规。若直接对原文断言，这些「写明了禁令」的注释反而会让守卫变红，
   * 于是后人只能删注释来取悦测试，恰好销毁了最该留的证据。
   * 故守卫只认代码：注释里怎么讲禁令都可以，代码里不许出现。
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it.each([
    ['fetch(', '原生 fetch'],
    ['XMLHttpRequest', 'XHR'],
    ['useAgentStore', 'Agent store（会触发真实 preview/commit）'],
    ['useRepos', '仓储 hook'],
    ["from '../../core/repositories", '仓储层 import'],
    ["from '../../hooks/useRepos'", '仓储 hook import'],
  ])('代码中不含 %s（%s）', (needle) => {
    expect(code).not.toContain(needle);
  });

  it('权限判定只经 useRoleGuard（代码中不自行比对角色字段）', () => {
    expect(code).toContain('useRoleGuard');
    expect(code).not.toContain('roleKind');
    expect(code).not.toContain('isMember');
  });

  it('守卫自身有效：剥注释后原文里的禁令字样确实已不在 code 内', () => {
    // 反向自检——证明「剥注释」真的起作用，否则上面的断言可能是假绿
    expect(source).toContain('useAgentStore');
    expect(source).toContain('roleKind');
    expect(code).not.toContain('useAgentStore');
    expect(code).not.toContain('roleKind');
    // 且剥完之后代码主体仍在（不是把整个文件剥成空串而「全过」）
    expect(code).toContain('useRoleGuard');
    expect(code.length).toBeGreaterThan(source.length / 4);
  });
});
