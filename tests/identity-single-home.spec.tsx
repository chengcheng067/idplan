// @vitest-environment jsdom
/**
 * 身份显示去重（2026-10-12 用户 21:43）：身份控件**全站只剩一处** —— 侧栏最下方那行。
 *
 * ⚠️ 措辞注意：代码/文案里一律说「侧栏最下方 / 左侧导航最下方」，**不说「左下角」** ——
 *   侧栏 ≥1280 才常驻，1024–1279 收在左上角汉堡的抽屉里（`useLayoutStore` 的 D3 纪律：
 *   `defaultExpanded()` = matchMedia('(min-width:1280px)')），「左下角」在那一档不成立。
 *
 * ══════════════════ 用户原话（一字不改） ══════════════════
 *   「这两处功能是重复的：
 *     1. 只保留左下角的"登录人是谁"显示在这里，切换身份也在左下角。
 *     2. 右上角的取消掉。」
 *
 * ══════════════════ 本文件锁什么 ══════════════════
 * ① **几何**：侧栏身份行改成按钮之后，尺寸/配色必须与原来那个纯展示 div 逐字一致
 *    （h-52 / sunken 底 / 圆角 12 / 头像 28 / 姓名 13 + 角色 11）。这是"只是从展示变可点"
 *    的硬约束 —— 一旦有人顺手加上 padding 或改圆角，界面上是"那一行莫名变胖"，没人会往
 *    "上轮把 div 换成 button"上想。
 * ② **两态都有入口**：展开态与收起态、已进入与未进入，四个组合都要有可点的身份控件。
 *    尤其是「未进入」——原实现被 `currentMember &&` 门控，顶栏一删就断链
 *    （见 Sidebar.tsx 里那句"点侧栏最下方的身份行"提示，它本身也在侧栏里）。
 * ③ **「点击进入」四个字是载荷**：6 个 spec 与真机助手都按这四个字全页搜按钮
 *    （calendar-anchor / f3-sidebar-identity / helpers/board-env / member-board-layout /
 *    overlay-stack-browser / settings-zones）。改文案等于同时改六个文件。
 * ④ **唯一实现**：侧栏**不得**自带一份 `role="menu"` 菜单（那就是把 portal / 锚定 /
 *    Esc 栈顶 / chrome 档位 / 外点判定整套复制成第二份孪生实现，下次只会改到一份）。
 * ⑤ **旧入口确实下线**：`TopBar.tsx` 不再 import / 不再渲染身份控件，且引导文案
 *    不再指向"右上角 / 顶栏"。
 *
 * ⚠️ 本文件是 jsdom ⇒ **量不到几何、也没有 hit-test**（`elementFromPoint` 不可用）。
 *    所以这里锁的是**类名声明与接线**；"菜单真的在上方弹出、真的不越出视口、
 *    真的盖住遮罩"必须由真 Chromium 断（见 `tests/identity-rail-browser.spec.ts`）。
 *    类名断言只能证明"声明在"，证明不了"生效且赢了" —— 两层各司其职，别互相顶替。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MemberIdentityPicker,
  type IdentityPickerVariant,
} from '../src/components/layout/MemberIdentityPicker';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import type { Member } from '../src/core/types/entities';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';
import { catalogOf } from '../src/i18n';

const ROOT = resolve(__dirname, '..');

/** 去掉注释后的源码 —— 静态锁一律看"活代码"，别被解释性注释误伤 */
function code(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const ADMIN: Member = {
  id: 'mem_rail_admin',
  name: '左栏负责人',
  role: '负责人',
  contact: null,
  avatarColor: '#88A293',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function unmountCurrent(): void {
  const r = root;
  if (r !== null) act(() => r.unmount());
  host?.remove();
  root = null;
  host = null;
}

function mount(variant: IdentityPickerVariant): HTMLElement {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <MemoryRouter>
        <MemberIdentityPicker variant={variant} />
      </MemoryRouter>,
    );
  });
  return h;
}

/** 已进入身份时的触发按钮（展开态与顶栏胶囊共用这一份 title，是稳定选择器） */
function trigger(): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>('button[title="当前身份（点击切换/退出）"]');
  if (b === null) throw new Error('未找到身份触发器（前置：已进入身份）');
  return b;
}

/**
 * 收起态那枚的触发器。**它的 title 与展开态故意不同**（`姓名 · 角色（点击切换/退出）`）——
 * 64px 宽只剩一个首字，tooltip 是唯一能读出"我是谁"的地方，不能为了选择器整齐就把它
 * 换成与展开态一样的通用文案。见下方那条专门的断言。
 */
function collapsedTrigger(): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (x) => (x.getAttribute('title') ?? '').startsWith(`${ADMIN.name} · `),
  );
  if (b === null) throw new Error('未找到收起态身份控件（前置：已进入身份）');
  return b;
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="身份操作"]');
}

function openMenu(): HTMLElement {
  act(() => trigger().click());
  const p = panel();
  if (p === null) throw new Error('点击身份控件后菜单未出现');
  return p;
}

/** 全页按可见文本找按钮 —— 与那 6 个 spec 的找法同口径 */
function buttonByText(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (x) => (x.textContent ?? '').trim() === text,
    ) ?? null
  );
}

function enter(entered: boolean): void {
  act(() => {
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: entered ? ADMIN.id : null, hydrated: true });
  });
}

beforeEach(() => {
  localStorage.clear();
  unmountCurrent();
  enter(true);
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false, identityFlow: 'closed' });
  });
});

describe('身份去重 · 侧栏身份行是唯一身份控件（variant="rail"）', () => {
  it('已进入身份：身份行是菜单触发器，且几何与原来的纯展示行逐字一致', () => {
    mount('rail');
    const btn = trigger();

    /*
     * ① 几何逐字保持（原 `Sidebar.tsx` 的 div：
     *    `flex h-[52px] items-center gap-2 rounded-md bg-sunken px-2`）
     */
    const cls = btn.className;
    for (const c of ['flex', 'h-[52px]', 'items-center', 'gap-2', 'rounded-md', 'bg-sunken', 'px-2']) {
      expect(cls, `身份行几何逐字保持：缺了 \`${c}\``).toContain(c);
    }
    // ② button 默认 text-align:center ⇒ 必须有 text-left，否则姓名/角色会被居中
    expect(cls, 'button 默认居中，缺 text-left 就不是"逐字保持"').toContain('text-left');

    // 头像 28（h-7 w-7 圆）+ 姓名 13 + 角色 11
    const avatar = btn.querySelector('span[aria-hidden]');
    expect(avatar?.className, '头像 28 圆').toContain('h-7');
    expect(avatar?.className).toContain('w-7');
    expect(avatar?.className).toContain('rounded-full');
    expect(avatar?.textContent, '头像是首选字').toBe('左');

    const name = Array.from(btn.querySelectorAll('span')).find(
      (s) => (s.textContent ?? '').trim() === '左栏负责人',
    );
    expect(name?.className, '姓名 13').toContain('text-[13px]');
    expect(name?.className).toContain('text-ink');
    const roleEl = Array.from(btn.querySelectorAll('span')).find(
      (s) => (s.textContent ?? '').trim() === '管理员',
    );
    expect(roleEl?.className, '角色 11').toContain('text-[11px]');
    expect(roleEl?.className).toContain('text-mist');

    // ③ 它必须**自报家门**是菜单触发器（F10 的语义不能因为换外观而丢）
    expect(btn.getAttribute('aria-haspopup'), 'rail 触发器同样要声明菜单').toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('已进入身份：点身份行能开出菜单，Esc 关闭、外点关闭三件事都还在', () => {
    mount('rail');
    openMenu();
    expect(trigger().getAttribute('aria-expanded'), '展开后 aria-expanded 翻转').toBe('true');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel(), 'Esc 关闭').toBeNull();

    openMenu();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(panel(), '外点关闭').toBeNull();
  });

  it('未进入身份：**同一位置**给「点击进入」入口，文本逐字（6 个 spec 的载荷）', () => {
    enter(false);
    mount('rail');

    const btn = buttonByText('点击进入');
    expect(btn, '未进入身份时侧栏身份行必须给「点击进入」——否则顶栏一删就全站无入口').not.toBeNull();
    // 与已进入态占据同一行高：底部固定区不许因此抖一下
    expect(btn?.className, '未进入态占同一行高 52').toContain('h-[52px]');

    expect(useSettingsStore.getState().identityFlow, '前置：还没进入任何流程').toBe('closed');
    act(() => {
      btn?.click();
    });
    // 库里有管理员 ⇒ 直达姓名输入（与顶栏原来同一口径），不是 admin_prompt
    expect(useSettingsStore.getState().identityFlow, '点「点击进入」应走到 name_input').toBe(
      'name_input',
    );
  });

  it('未进入身份且库里没有管理员：走 admin_prompt（口径与顶栏原来一致）', () => {
    act(() => {
      useMembersStore.getState().setAll([]);
      useSettingsStore.setState({ currentMemberId: null, hydrated: true });
    });
    mount('rail');
    act(() => {
      buttonByText('点击进入')?.click();
    });
    expect(useSettingsStore.getState().identityFlow, '无管理员 ⇒ 先确立管理员').toBe(
      'admin_prompt',
    );
  });
});

describe('身份去重 · 收起态（variant="rail-collapsed"）', () => {
  it('已进入身份：是身份控件而**不再是回首页的 Link**（有意的行为变更）+ 菜单能开', () => {
    const host = mount('rail-collapsed');
    const btn = collapsedTrigger();
    /*
     * 原实现是 `<Link to="/">`（点头像回首页）；现在头像改成身份控件。
     * ⚠️ 断言**只在这个隔离宿主内**取（`host`），不查整个 document ——
     *   真实壳层里侧栏 Logo 自己就是一个 `a[href="/"]`，用 document 级查询会
     *   在将来有人把本 spec 改成挂整壳时变成一条假红/假绿。
     *   「收起态回首页仍可达」这件事由真机断言在 `identity-rail-browser.spec.ts` 里证。
     */
    expect(host.querySelector('a'), '这枚头像不该再是链接').toBeNull();
    expect(btn.tagName, '应是 button').toBe('BUTTON');
    // 收起态唯一能读出"我是谁"的地方就是 tooltip
    expect(btn.getAttribute('title'), 'tooltip 保留姓名 · 角色').toContain('左栏负责人');
    expect(btn.getAttribute('title')).toContain('点击切换/退出');
    expect(btn.className, '几何沿用原 Link：h-8 w-8 圆 + mt-1').toContain('h-8');
    expect(btn.className).toContain('w-8');
    expect(btn.className).toContain('rounded-full');
    expect(btn.className).toContain('mt-1');
    act(() => btn.click());
    expect(panel(), '收起态也要能开菜单').not.toBeNull();
  });

  it('收起态的 title 与展开态**故意不同**：别为了选择器整齐把"我是谁"换掉', () => {
    mount('rail-collapsed');
    const collapsedTitle = collapsedTrigger().getAttribute('title') ?? '';
    unmountCurrent();
    mount('rail');
    const railTitle = trigger().getAttribute('title') ?? '';

    expect(railTitle, '展开态用的是 4 个 spec 的载荷选择器').toBe('当前身份（点击切换/退出）');
    expect(collapsedTitle, '收起态必须带上姓名（那里只剩一个首字，tooltip 是唯一出口）').toContain(
      '左栏负责人',
    );
    expect(collapsedTitle, '收起态也要提示可点').toContain('点击切换/退出');
    expect(collapsedTitle, '两者若被"统一"成同一个，说明有人顺手改掉了收起态的可读性').not.toBe(
      railTitle,
    );
  });

  it('未进入身份：给一枚可点的进入入口，且「点击进入」四个字**在 DOM 里**', () => {
    enter(false);
    mount('rail-collapsed');
    /*
     * ★ 这条锁的是一个真机踩过的断链：`useLayoutStore.defaultExpanded()` 是
     *   `matchMedia('(min-width: 1280px)')` ⇒ **1024–1280 侧栏默认收起态**。
     *   收起态只有 32px，放不下四个字，视觉是图标；但那四个字必须留在 DOM 里
     *   （`sr-only`），否则该宽度档"按文案找身份入口"的所有路径集体失效
     *   （实测：member-board-layout M-02 / calendar-anchor C-01 两例在 1152×864 超时）。
     *   允许改视觉，**不允许把文本从这个按钮上拿走**。
     */
    const btn = buttonByText('点击进入');
    expect(
      btn,
      '★ 收起态未进入身份也必须有「点击进入」的文本（1024–1280 那一档靠它）',
    ).not.toBeNull();
    expect(
      btn?.querySelector('.sr-only')?.textContent,
      '视觉是图标、文本用 sr-only 承载（图标按钮本该有文字替代）',
    ).toBe('点击进入');
    act(() => {
      btn?.click();
    });
    expect(useSettingsStore.getState().identityFlow).toBe('name_input');
  });
});

describe('身份去重 · 唯一实现（不许把菜单逻辑复制到侧栏）', () => {
  it('三态共用同一个 portal 面板：挂在 body 上、用 chrome 档（79）', () => {
    mount('rail');
    const p = openMenu();
    // portal 到 body：面板的父级是 body，不在宿主 div 里
    expect(p.parentElement, '面板应 portal 到 document.body').toBe(document.body);
    expect(p.className, 'chrome 档位来自 Modal 的静态映射表，不手写').toContain('z-[79]');
    // 顶栏胶囊那份同为 79（同一查表结果）—— 档位不许各写各的
    unmountCurrent();
    mount('topbar');
    const p2 = openMenu();
    expect(p2.className).toContain('z-[79]');
  });

  it('Sidebar 只是**挂载**身份控件，自己不得再写一份菜单（role="menu"）', () => {
    const sidebar = code('src/components/layout/Sidebar.tsx');
    expect(sidebar, 'Sidebar 应挂 variant="rail"').toContain('variant="rail"');
    expect(sidebar, 'Sidebar 应挂 variant="rail-collapsed"').toContain('variant="rail-collapsed"');
    expect(sidebar, 'Sidebar 不得自建菜单（那就是第二份孪生实现）').not.toContain('role="menu"');
    // 原来那两段内联的纯展示实现（div / Link）必须已经不在了
    expect(sidebar, '展开态那段纯展示 div 应已删除').not.toContain('flex h-[52px] items-center gap-2 rounded-md bg-sunken px-2"');
  });

  it('★ 收起态「回首页」仍有承载：头像改成身份控件之后不曾失联', () => {
    /*
     * team-lead 裁决 ② 的前置：先证「收起态回首页」不是只由那枚头像承载。
     * 查证结果 —— 收起态**有两处**回首页，都不经那头像：
     *   ① 收起态顶部 Logo `<Link to="/">`（aria-label="ID Plan 首页"）；
     *      展开侧栏是**另一枚** `SidebarCollapseToggle`，不是这个 Logo。
     *   ② 导航首项：管理员 → `/`（「项目」）；成员 → `/member-board`（「看板」）。
     * ⇒ 把这枚头像改成身份控件**没有删掉任何唯一的回首页路径**，可以照改。
     * 真机实证见 `identity-rail-browser.spec.ts`：点收起态 Logo 与首枚导航 ⇒ 都落到 `/`。
     */
    const sidebar = code('src/components/layout/Sidebar.tsx');
    /*
     * ★ 2026-10-13 判据形态升级（语言切换批 2a，team-lead 批准）：原来的判据是
     *   「Sidebar 源码里出现字面量 aria-label="ID Plan 首页"」。文案搬进 i18n
     *   消息表后源码里不再有中文字面量 ⇒ 改为**同时锁两件事**：
     *     ① 接线存在：收起态 Logo 的 A11y 名确实经 t('nav.homeAria') 取；
     *     ② 文案不变：zh 表里该键的值仍是「ID Plan 首页」。
     *   原意（回首页承载① 可被读屏辨识，且名字是「ID Plan 首页」）**一个字没改**；
     *   判据强度不降（多钉了一条「值」，少了一条「源码里的中文」）。
     *   下面两行仍在，一起构成「它是指向 / 的 Link」这条原意。
     */
    expect(sidebar, '收起态 Logo 的 A11y 名必须经 i18n 取词').toContain("t('nav.homeAria')");
    expect(
      catalogOf('zh')['nav.homeAria'],
      'A11y 名的中文值必须仍是「ID Plan 首页」',
    ).toBe('ID Plan 首页');
    expect(sidebar, 'Logo 不得被改成「展开侧栏”的开关（那是另一枚 SidebarCollapseToggle）').toContain(
      'SidebarCollapseToggle',
    );
    // 导航首项（回首页承载②）：管理员支是 `/`
    const nav = code('src/components/layout/SidebarNav.tsx');
    expect(nav, '管理员支导航首项应指向 /').toMatch(/to:\s*'\/'/);
    expect(nav, '成员支导航首项应指向 /member-board').toContain("'/member-board'");
  });

  it('TopBar 不再 import / 不再渲染身份控件；手机档入口 MobileMoreMenu 仍在', () => {
    const topbar = code('src/components/layout/TopBar.tsx');
    expect(topbar, 'TopBar 不许再 import 身份控件').not.toContain('MemberIdentityPicker');
    expect(topbar, 'TopBar 不许再渲染身份控件').not.toContain('<MemberIdentityPicker');
    expect(topbar, '手机档唯一入口不得被一起删掉').toContain('<MobileMoreMenu');

    // 手机档那枚仍是自带菜单的独立实现（本轮**不动**它）：还在，且还只在 <768 渲染
    const more = code('src/components/layout/MobileMoreMenu.tsx');
    expect(more, 'MobileMoreMenu 仍是手机档唯一入口').toContain('md:hidden');
    expect(more).toContain('role="menu"');
  });
});

describe('身份去重 · 指向旧入口的文案已下线', () => {
  it('我的任务页 / 项目详情页不再说「右上角「进入身份」」，且措辞两档都成立', () => {
    for (const f of ['src/pages/MyTasksPage.tsx', 'src/pages/ProjectDetailPage.tsx']) {
      const src = code(f);
      expect(src, `${f} 仍指向已删除的右上角入口`).not.toContain('右上角「进入身份」');
      /*
       * ★ 措辞纪律（team-lead 裁决 ①）：侧栏 ≥1280 才常驻，1024–1279 收在左上角汉堡的
       *   抽屉里 ⇒「左下角」在窄窗上**不成立**，不许出现在这两句引导语里。
       *   必须用「左侧导航最下方」这种两档都真的说法。
       */
      expect(src, `${f} 用了只在常驻侧栏成立的「左下角」说法`).not.toContain('左下角');
      expect(src, `${f} 应改指左侧导航最下方`).toContain('左侧导航最下方');
    }
  });

  it('侧栏内那句提示也不写「左下角」（它同时出现在常驻侧栏与抽屉两种形态里）', () => {
    const sidebar = code('src/components/layout/Sidebar.tsx');
    expect(sidebar).not.toContain('点顶栏的身份标识');
    /*
     * ★ 2026-10-13 判据形态升级（同上）：这句提示的**位置描述**是判据的核心原意
     *   （措辞必须两档都真，不许写「左下角」）。文案搬进消息表后改为：
     *     ① 源码里确实用 t('sidebar.noIdentityHint') 渲染这句；
     *     ② zh 值里确实含「点侧栏最下方的身份行」。
     *   原意（提示指向侧栏最下方的身份行）与强度均不变。
     */
    expect(sidebar, '无身份提示必须经 i18n 取词').toContain("t('sidebar.noIdentityHint')");
    expect(
      catalogOf('zh')['sidebar.noIdentityHint'],
      '提示的措辞必须仍指向「侧栏最下方的身份行」（位置描述是本条的原意）',
    ).toContain('点侧栏最下方的身份行');
  });
});
