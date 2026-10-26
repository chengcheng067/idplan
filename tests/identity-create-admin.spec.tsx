// @vitest-environment jsdom
/**
 * 未进入身份时的「新建管理员」出口（2026-10-27）
 *
 * ══════════════════ 用户原话（一字不改） ══════════════════
 *   「如果说我退出了所有的登录信息，就是我没有办法在这个情况下我新建我是一个管理员，
 *     那如果说新用户进入到这个地方的话，他怎么去创建管理员呢？就算哪怕这台电脑上
 *     已经出现过管理员，那我可不可以新建一个身份进去呢？」
 *
 * ══════════════════ 修前的死胡同（本文件就是它的反面） ══════════════════
 *   `MemberIdentityPicker.onEnterIdentity()` 是 `hasAdmin ? name_input(false) : admin_prompt`，
 *   而 `name_input(adminIntent === false)` 这条**只匹配已有成员**：未命中就
 *   `setIdentityFlow('mismatch')` + 「名单中没有找到你的名字，请联系管理员添加后重试」。
 *   ⇒ 有管理员 + 全部退出 = 只能进已有成员，**无法新建任何身份**；
 *     而"联系管理员"在一台只有他自己的电脑上是个走不出去的建议。
 *
 * ══════════════════ 本文件锁什么（五条交互 + 两条反向保护） ══════════════════
 *   ① 未命中 ⇒ **仍停在 name_input**，出现「以管理员身份新建」按钮（不是 mismatch 屏）；
 *   ② 点它 ⇒ 弹告知 + 二次确认，正文含**已有管理员姓名**与这次要新建的名字；
 *   ③ 取消 ⇒ 成员数不变、`currentMemberId` 仍为空、**身份对话框还在**（不退回死胡同）；
 *   ④ 确认 ⇒ 新增 1 条 `roleKind='admin'`、`currentMemberId` 指向它、身份流关闭；
 *   ⑤ `hasAdmin === false` + 未命中 ⇒ **直接建号、不弹告知**（库里没有管理员可告知）。
 *   反向保护（防这次改动把原路径带坏）：
 *     R1 命中已有成员 ⇒ 仍直接进入，且**不调用** `members.insert`；
 *     R2 `adminIntent === true` 那一态**不渲染**这枚按钮（那条路的主按钮本身就会建号）。
 *
 * ⚠️ 本文件用 `vi.mock` 替掉 `useRepos`（库层）—— 身份对话框的全部副作用就是
 *    `repos.members.insert` + 两个 store 的写入，jsdom 里没有 Dexie/HTTP 的必要。
 *    这与 `tests/first-run-guide.spec.tsx` 的做法同源（mock 数据出口，不 mock 被测组件）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/* `vi.hoisted`：`vi.mock` 工厂会被提升到文件顶部，普通顶层 const 此刻还在 TDZ 里 */
const h = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>> }));

vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => ({
    members: {
      insert: async (input: Record<string, unknown>) => {
        const row = { ...input, id: `mem_created_${h.inserted.length + 1}`, active: true };
        h.inserted.push(row);
        return row;
      },
      verifyCredentials: async () => true,
    },
  }),
}));

/* 审计日志会写 store / localStorage，与本文件判据无关 —— 静音以免噪声 */
vi.mock('../src/core/services/log.service', () => ({
  logUser: vi.fn(),
  logError: vi.fn(),
}));

import { IdentityDialog } from '../src/components/layout/IdentityDialog';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import type { Member } from '../src/core/types/entities';
import { MemberRoleKind } from '../src/core/types/enums';

const ADMIN: Member = {
  id: 'mem_existing_admin',
  /*
   * ⚠️ 姓名**刻意不用**「已有管理员」这类与告知句同形的词：那会让
   * `toContain('已有管理员')` 只验到句子骨架、验不到"名字真的填进去了"
   * —— 变异自证时实测过：把正文里的姓名删掉，断言仍然通过（假绿）。
   */
  name: '杨老板',
  role: '负责人',
  contact: null,
  avatarColor: '#88A293',
  active: true,
  roleKind: MemberRoleKind.Admin,
} as Member;

let container: HTMLDivElement;
let root: Root;

/** 受控输入框的 jsdom 写法：绕过 React 的 value 缓存，再派发 input */
function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function q<T extends Element>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

async function click(el: Element | null): Promise<void> {
  expect(el, '被点击的元素必须存在').not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
    await Promise.resolve();
  });
}

/** Modal 走 `usePresence` 有退场动画 ⇒ 关闭后 DOM 不会立刻消失，要轮询等它真的走 */
async function waitForGone(sel: string, budgetMs = 1500): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    if (q(sel) === null) return true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
  return q(sel) === null;
}

function renderDialog(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<IdentityDialog />));
}

/** 进入「成员入口 + 已存在管理员」这一态（就是原来那个死胡同） */
function enterMemberFlow(members: Member[]): void {
  useMembersStore.getState().setAll(members);
  useSettingsStore.setState({
    currentMemberId: null,
    adminIntent: false,
    identityFlow: 'name_input',
    pendingMemberId: null,
  });
}

beforeEach(() => {
  h.inserted.length = 0;
  enterMemberFlow([ADMIN]);
  renderDialog();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('未进入身份 · 新建管理员出口', () => {
  it('① 姓名未命中 ⇒ 停在输入屏并给出「以管理员身份新建」，不再是 mismatch 死胡同', async () => {
    const input = q<HTMLInputElement>('[data-identity-name-input]');
    expect(input, 'name_input 屏应有姓名输入框').not.toBeNull();
    setInputValue(input!, '新来的同事');

    // 成员入口的主按钮是「下一步」（`data-identity-submit="next"`）
    await click(q('[data-identity-submit="next"]'));

    // 还在输入屏 —— 这条是「不再被送去 mismatch」的直接证据
    expect(q('[data-identity-name-input]'), '未命中不得离开姓名输入屏').not.toBeNull();
    // 出路就在手边（未命中前后都在；空输入时禁用，见下一例）
    const createBtn = q('[data-identity-create-admin]');
    expect(createBtn, '未命中必须能看到「以管理员身份新建」').not.toBeNull();
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
    // 反向：旧口径那句"请联系管理员"不得再出现
    expect(document.body.textContent ?? '').not.toContain('请联系管理员添加后重试');
    // 也还没有建号
    expect(h.inserted).toHaveLength(0);
  });

  it('①-b 姓名为空时该按钮禁用（建号必须有名字）', () => {
    const createBtn = q<HTMLButtonElement>('[data-identity-create-admin]');
    expect(createBtn).not.toBeNull();
    expect(createBtn!.disabled).toBe(true);
  });

  it('② 点它 ⇒ 弹出告知 + 二次确认，正文含已有管理员姓名与本次要新建的姓名', async () => {
    setInputValue(q<HTMLInputElement>('[data-identity-name-input]')!, '新来的同事');
    await click(q('[data-identity-create-admin]'));

    const dialog = q('[data-identity-create-admin-confirm]');
    expect(dialog, '必须出现二次确认（告知），不能一键建号').not.toBeNull();
    const text = dialog!.textContent ?? '';
    expect(text, '必须告知这次要新建的姓名').toContain('新来的同事');
    /* ⚠️ 断言的是**已有管理员的真实姓名**（夹具里叫「杨老板」），不是「已有管理员」那四个字
       —— 后者是句子骨架的一部分，删掉姓名也能通过（变异自证实测过这个假绿）。 */
    expect(text, '必须点名已有的管理员是谁').toContain(ADMIN.name);
    expect(text, '必须告知后果（能看到全部项目/成员/备份）').toContain('备份');
    // 此刻还没建号
    expect(h.inserted).toHaveLength(0);
  });

  it('③ 取消 ⇒ 不建号、仍是未进入、且身份对话框还在（不退回死胡同）', async () => {
    setInputValue(q<HTMLInputElement>('[data-identity-name-input]')!, '新来的同事');
    await click(q('[data-identity-create-admin]'));
    await click(q('[data-identity-create-admin-confirm] [data-confirm-cancel]'));

    expect(h.inserted, '取消不得建号').toHaveLength(0);
    expect(useSettingsStore.getState().currentMemberId).toBeNull();
    expect(useMembersStore.getState().members).toHaveLength(1);
    // 身份对话框原样还在，姓名也还在输入框里（用户可改名重试）
    const input = q<HTMLInputElement>('[data-identity-name-input]');
    expect(input, '取消确认框后身份对话框必须还在').not.toBeNull();
    expect(input!.value).toBe('新来的同事');
    /* 确认框要走完退场动画才从 DOM 摘掉（Modal 的 `usePresence`），故轮询等它消失 */
    expect(
      await waitForGone('[data-identity-create-admin-confirm]'),
      '取消后确认框应当关闭',
    ).toBe(true);
  });

  it('④ 确认 ⇒ 新增一条 admin、currentMemberId 指向它、身份流关闭', async () => {
    setInputValue(q<HTMLInputElement>('[data-identity-name-input]')!, '新来的同事');
    await click(q('[data-identity-create-admin]'));
    await click(q('[data-identity-create-admin-confirm] [data-confirm-ok]'));

    expect(h.inserted, '确认后必须真的建号').toHaveLength(1);
    expect(h.inserted[0].roleKind, '新建的必须是管理员').toBe(MemberRoleKind.Admin);

    const members = useMembersStore.getState().members;
    expect(members).toHaveLength(2);
    const created = members.find((m) => m.name === '新来的同事');
    expect(created, '成员表里应有新管理员').toBeTruthy();
    expect(created!.roleKind).toBe(MemberRoleKind.Admin);

    expect(useSettingsStore.getState().currentMemberId).toBe(created!.id);
    expect(useSettingsStore.getState().identityFlow, '建号成功后身份流应关闭').toBe('closed');
  });

  it('R1 命中已有成员 ⇒ 仍直接进入，且不调用 insert（原路径不许被带坏）', async () => {
    setInputValue(q<HTMLInputElement>('[data-identity-name-input]')!, ADMIN.name);
    await click(q('[data-identity-submit="next"]'));

    expect(useSettingsStore.getState().currentMemberId).toBe(ADMIN.id);
    expect(useSettingsStore.getState().identityFlow).toBe('closed');
    expect(h.inserted, '命中已有成员时绝不该建号').toHaveLength(0);
    expect(q('[data-identity-create-admin-confirm]')).toBeNull();
  });

  it('R2 adminIntent 那一态不渲染这枚按钮（那条路的主按钮本身就会建号）', () => {
    act(() => root.unmount());
    container.remove();

    useSettingsStore.setState({
      currentMemberId: null,
      adminIntent: true,
      identityFlow: 'name_input',
      pendingMemberId: null,
    });
    renderDialog();

    expect(q('[data-identity-name-input]')).not.toBeNull();
    expect(q('[data-identity-create-admin]'), '管理员确立态不得出现同义按钮').toBeNull();
  });
});

describe('未进入身份 · 库里没有管理员时', () => {
  it('⑤ 未命中 ⇒ 直接确立为管理员，不弹告知', async () => {
    // 覆盖 beforeEach 的态：成员表为空 ⇒ hasAdmin === false
    act(() => root.unmount());
    container.remove();
    enterMemberFlow([]);
    renderDialog();

    setInputValue(q<HTMLInputElement>('[data-identity-name-input]')!, '第一个管理员');
    await click(q('[data-identity-submit="next"]'));

    expect(q('[data-identity-create-admin-confirm]'), '没有管理员可告知 ⇒ 不弹确认').toBeNull();
    expect(h.inserted, '应直接建号').toHaveLength(1);
    expect(h.inserted[0].roleKind).toBe(MemberRoleKind.Admin);
    expect(useSettingsStore.getState().currentMemberId).toBe('mem_created_1');
    expect(useSettingsStore.getState().identityFlow).toBe('closed');
  });
});
