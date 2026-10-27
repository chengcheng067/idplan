// @vitest-environment jsdom
/**
 * 管理员密码闸（2026-10-27 · 权限修复 2 · 过渡方案，B 多工作区另立版本）。
 *
 * ═══════════════════════ 本文件锁什么（G 段四条） ═══════════════════════
 *   G1 老库无密码 ⇒ 「以管理员身份新建」确认后出现**设置密码**表单（setup 态）；
 *   G2 setup 校验与成功：
 *      · 提交按钮空密码时禁用；
 *      · 过短（<4 位）报「至少 4 位」、两次不一致报「不一样」，各自都不插库；
 *      · 成功 ⇒ 新插入的管理员带 passwordHash 且对原明文 verifyPassword 通过；
 *        **现有管理员们也被写上同一密码**（库级闸）；currentMemberId 指向新管理员。
 *   G3 已有密码 ⇒ verify 态：输错 ⇒ 报「密码不对」**不插库**、可重试；
 *      输对 ⇒ 插入并进入（新管理员继承同一密码）。
 *   G4 普通成员进入路径回归：命中已有成员 ⇒ 直接进入，全程不碰密码闸、不插库。
 *
 * ═══════════════════════ mock 设计 ═══════════════════════
 *   与 tests/identity-create-admin.spec.tsx 同源（vi.hoisted mock useRepos），
 *   但 members.insert / members.update 在 mock 内部调用**真实的**
 *   `hashPassword`（src/lib/password.ts 的 WebCrypto PBKDF2）——这样「verify 通过」
 *   的断言验的是真算法，不是 mock 自己陪跑。jsdom 的 globalThis.crypto 由
 *   Node 提供，PBKDF2 可用。
 *
 * ⚠️ 本文件是密码闸的**主锁**；tests/identity-create-admin.spec.tsx 的 ④ 只锁
 *    「确认 → 出表单、未插库」这一段，两文件分工见那边的注释。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/* `vi.hoisted`：`vi.mock` 工厂会被提升到文件顶部，普通顶层 const 此刻还在 TDZ 里 */
const h = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock('../src/hooks/useRepos', async () => {
  /* 工厂内动态 import：mock 的 insert/update 走**真实** PBKDF2 哈希（见文件头） */
  const { hashPassword } = await import('../src/lib/password');
  const { useMembersStore } = await import('../src/store/useMembersStore');
  return {
    useRepos: () => ({
      members: {
        insert: async (input: Record<string, unknown>) => {
          const { password, ...rest } = input;
          const row = {
            ...rest,
            id: `mem_created_${h.inserted.length + 1}`,
            active: true,
            passwordHash: password ? await hashPassword(password as string) : null,
          };
          h.inserted.push(row);
          return row;
        },
        update: async (id: string, cmd: Record<string, unknown>) => {
          /* 真实 repo.update 返回**合并后的完整行**（store.upsert 整行替换），
             mock 必须同形 —— 从 store 读现有成员做基底，否则会把该成员冲成残行。 */
          const existing =
            useMembersStore.getState().members.find((m) => m.id === id) ?? null;
          const { password, ...restCmd } = cmd;
          return {
            ...(existing ?? {}),
            ...restCmd,
            id,
            passwordHash:
              password !== undefined
                ? password
                  ? await hashPassword(password as string)
                  : null
                : (existing?.passwordHash ?? null),
          };
        },
        verifyCredentials: async () => false,
      },
    }),
  };
});

/* 审计日志会写 store / localStorage，与本文件判据无关 —— 静音以免噪声 */
vi.mock('../src/core/services/log.service', () => ({
  logUser: vi.fn(),
  logError: vi.fn(),
}));

import { IdentityDialog } from '../src/components/layout/IdentityDialog';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { verifyPassword } from '../src/lib/password';
import type { Member } from '../src/core/types/entities';
import { MemberRoleKind } from '../src/core/types/enums';

/** 老库管理员：**无密码**（fixture 保持与 identity-create-admin.spec 同形） */
const ADMIN: Member = {
  id: 'mem_existing_admin',
  name: '杨老板',
  role: '负责人',
  contact: null,
  avatarColor: '#88A293',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
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

/**
 * 提交链路里有**真实的** WebCrypto PBKDF2（210k 迭代，跨 macrotask），
 * `click` 的一次 `Promise.resolve()` flush 不完 ⇒ 轮询等条件成立（同 waitForGone 手法）。
 */
async function waitFor(predicate: () => boolean, what: string, budgetMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
  expect(predicate(), `等待超时：${what}`).toBe(true);
}

function renderDialog(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<IdentityDialog />));
}

/** 进入「成员入口 + 已存在管理员」态，把姓名填好、点出二次确认并确认（密码闸入口） */
async function openGateAs(members: Member[], name: string): Promise<void> {
  useMembersStore.getState().setAll(members);
  useSettingsStore.setState({
    currentMemberId: null,
    adminIntent: false,
    identityFlow: 'name_input',
    pendingMemberId: null,
  });
  renderDialog();
  setInputValue(q<HTMLInputElement>('[data-identity-name-input]')!, name);
  await click(q('[data-identity-create-admin]'));
  await click(q('[data-identity-create-admin-confirm] [data-confirm-ok]'));
}

beforeEach(() => {
  h.inserted.length = 0;
  useMembersStore.getState().setAll([]);
  useSettingsStore.setState({
    currentMemberId: null,
    adminIntent: false,
    identityFlow: 'closed',
    pendingMemberId: null,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('管理员密码闸 · 老库首次（setup）', () => {
  it('G1 确认后出现设置密码表单，此时不插库', async () => {
    await openGateAs([ADMIN], '新来的同事');

    expect(q('[data-identity-pw-gate="setup"]'), '老库无密码 ⇒ 必须是 setup 态').not.toBeNull();
    expect(
      q<HTMLInputElement>('[data-identity-pw-input]'),
      'setup 态应有密码输入框',
    ).not.toBeNull();
    expect(q<HTMLInputElement>('[data-identity-pw-confirm]'), 'setup 态应有确认密码框').not.toBeNull();
    expect(h.inserted, '表单提交前绝不该建号').toHaveLength(0);
  });

  it('G2-a 空密码提交按钮禁用；过短报「至少 4 位」；两次不一致报「不一样」——都不插库', async () => {
    await openGateAs([ADMIN], '新来的同事');

    // 空密码：按钮禁用（不填这一态被按钮挡住）
    expect(
      (q<HTMLButtonElement>('[data-identity-pw-submit]') as HTMLButtonElement).disabled,
      '空密码时提交必须禁用',
    ).toBe(true);

    // 过短：3 位
    setInputValue(q<HTMLInputElement>('[data-identity-pw-input]')!, 'abc');
    setInputValue(q<HTMLInputElement>('[data-identity-pw-confirm]')!, 'abc');
    await click(q('[data-identity-pw-submit]'));
    expect(document.body.textContent ?? '').toContain('密码至少 4 位');
    expect(h.inserted, '过短不得建号').toHaveLength(0);

    // 不一致：4 位但两框不同
    setInputValue(q<HTMLInputElement>('[data-identity-pw-input]')!, 'abcd');
    setInputValue(q<HTMLInputElement>('[data-identity-pw-confirm]')!, 'abcdx');
    await click(q('[data-identity-pw-submit]'));
    expect(document.body.textContent ?? '').toContain('两次输入的密码不一样');
    expect(h.inserted, '不一致不得建号').toHaveLength(0);
    expect(useSettingsStore.getState().identityFlow, '校验失败不得离开身份流').toBe(
      'name_input',
    );
  });

  it('G2-b 成功 ⇒ 新管理员带 passwordHash 且 verify 通过；现有管理员被写上同一密码；进入新身份', async () => {
    await openGateAs([ADMIN], '新来的同事');
    setInputValue(q<HTMLInputElement>('[data-identity-pw-input]')!, '牌局密码');
    setInputValue(q<HTMLInputElement>('[data-identity-pw-confirm]')!, '牌局密码');
    await click(q('[data-identity-pw-submit]'));
    await waitFor(() => h.inserted.length === 1 && useSettingsStore.getState().identityFlow === 'closed', 'setup 完成建号并关流');

    expect(h.inserted, '应建号').toHaveLength(1);
    const created = h.inserted[0];
    expect(created.roleKind, '新建的必须是管理员').toBe(MemberRoleKind.Admin);

    const hash = created.passwordHash as string;
    expect(hash, '新管理员必须带哈希').toBeTruthy();
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/, '存储格式应为 saltHex:hashHex');
    expect(
      await verifyPassword('牌局密码', hash),
      '哈希必须对原明文验证通过（真 PBKDF2，不是 mock 陪跑）',
    ).toBe(true);

    // 库级闸：现有管理员也被升级到同一密码（mock update 返回的行经 upsert 进 store）
    const members = useMembersStore.getState().members;
    const existing = members.find((m) => m.name === ADMIN.name);
    expect(existing, '现有管理员仍在').toBeTruthy();
    expect(
      await verifyPassword('牌局密码', existing!.passwordHash),
      '现有管理员必须被写上同一密码',
    ).toBe(true);

    const createdInStore = members.find((m) => m.name === '新来的同事');
    expect(createdInStore, '成员表里应有新管理员').toBeTruthy();
    expect(
      useSettingsStore.getState().currentMemberId,
      '建号成功后必须进入新身份',
    ).toBe(createdInStore!.id);
    expect(useSettingsStore.getState().identityFlow, '身份流应关闭').toBe('closed');
  });
});

describe('管理员密码闸 · 已有密码（verify）', () => {
  /** 给老库管理员设一个**真实**哈希（verify 分支的比对基准） */
  async function seedAdminWithPassword(plain: string): Promise<void> {
    const { hashPassword } = await import('../src/lib/password');
    useMembersStore.getState().setAll([{ ...ADMIN, passwordHash: await hashPassword(plain) }]);
  }

  it('G3-a 输错 ⇒ 报「密码不对」、不插库、身份流未关（可重试，不锁定）', async () => {
    await seedAdminWithPassword('正确的密码');
    await openGateAs(useMembersStore.getState().members, '新来的同事');

    expect(
      q('[data-identity-pw-gate="verify"]'),
      '已有密码 ⇒ 必须是 verify 态（不是 setup）',
    ).not.toBeNull();
    expect(q('[data-identity-pw-confirm]'), 'verify 态只有一个输入框').toBeNull();

    setInputValue(q<HTMLInputElement>('[data-identity-pw-input]')!, '猜错的密码');
    await click(q('[data-identity-pw-submit]'));
    await waitFor(
      () => (document.body.textContent ?? '').includes('密码不对，无法新建管理员'),
      'verify 失败报错出现',
    );

    expect(document.body.textContent ?? '').toContain('密码不对，无法新建管理员');
    expect(h.inserted, '密码错误绝不该插库').toHaveLength(0);
    expect(useSettingsStore.getState().currentMemberId).toBeNull();
    expect(useSettingsStore.getState().identityFlow, '身份流未关 ⇒ 可重试').toBe('name_input');
    // 重试入口仍在（不做锁定）
    expect(q<HTMLInputElement>('[data-identity-pw-input]'), '重试输入框仍在').not.toBeNull();
  });

  it('G3-b 输对 ⇒ 插入并进入，新管理员继承同一密码', async () => {
    await seedAdminWithPassword('正确的密码');
    await openGateAs(useMembersStore.getState().members, '新来的同事');

    setInputValue(q<HTMLInputElement>('[data-identity-pw-input]')!, '正确的密码');
    await click(q('[data-identity-pw-submit]'));
    await waitFor(() => h.inserted.length === 1 && useSettingsStore.getState().identityFlow === 'closed', 'verify 通过建号并关流');

    expect(h.inserted, '验证通过后必须建号').toHaveLength(1);
    expect(
      await verifyPassword('正确的密码', h.inserted[0].passwordHash as string),
      '新管理员的哈希必须对同一密码验证通过',
    ).toBe(true);
    expect(
      useSettingsStore.getState().currentMemberId,
      '应进入新建的管理员身份',
    ).toBe('mem_created_1');
    expect(useSettingsStore.getState().identityFlow).toBe('closed');
  });
});

describe('管理员密码闸 · 成员通道回归', () => {
  it('G4 命中已有成员 ⇒ 直接进入，不弹密码闸、不插库（成员路径完全不变）', async () => {
    const member = { ...ADMIN, id: 'mem_worker', name: '小工', roleKind: MemberRoleKind.Member, passwordHash: null } as Member;
    useMembersStore.getState().setAll([ADMIN, member]);
    useSettingsStore.setState({
      currentMemberId: null,
      adminIntent: false,
      identityFlow: 'name_input',
      pendingMemberId: null,
    });
    renderDialog();

    setInputValue(q<HTMLInputElement>('[data-identity-name-input]')!, '小工');
    await click(q('[data-identity-submit="next"]'));

    expect(useSettingsStore.getState().currentMemberId, '成员应直接进入').toBe(member.id);
    expect(useSettingsStore.getState().identityFlow).toBe('closed');
    expect(h.inserted, '成员进入绝不该建号').toHaveLength(0);
    expect(
      q('[data-identity-pw-gate]'),
      '成员路径不得被密码闸拦住',
    ).toBeNull();
  });
});
