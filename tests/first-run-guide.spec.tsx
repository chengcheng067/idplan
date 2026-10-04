// @vitest-environment jsdom
/**
 * 0.8.3 条目2 · 首启三幕第二幕（FirstRunGuide）行为钉。
 *
 * 三态：
 *   ① 空库 + 未见过 → 卡出现，两出口（示例/空库）都在；
 *   ② 任一出口后写 flag → 卡不再出现（会话内 + 刷新后都不弹）；
 *   ③ 有项目（老用户/已载示例）→ 不出现。
 * 另钉：示例按钮与侧栏同链（loadDemo 调用）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const projectsState = { value: [] as unknown[] };
vi.mock('../src/core/project/visibility', () => ({
  useHumanProjects: () => projectsState.value,
}));

import { FirstRunGuide } from '../src/components/layout/FirstRunGuide';

/** 0.8.5 P0：欢迎卡示例按钮的 isAdmin 门控（产品官评审发现口径洞，spec 钉死） */
const roleState = { isAdmin: true };
vi.mock('../src/hooks/useRoleGuard', () => ({
  useRoleGuard: () => roleState,
}));

// ★ 必须 async：组件里是 `void loadDemo().finally(...)`，即**契约要求它返回 Promise**。
//   原先 `vi.fn()` 返回 undefined ⇒ `undefined.finally` 抛 unhandled TypeError，
//   长期挂在全量输出的「Errors 1」里（vitest 自己警告「might cause false
//   positive tests」——它会掩盖真实错误）。真实 useBackupIo.loadDemo 就是
//   `() => Promise<void>`，所以修 mock 兑现契约，**不改组件**。
const loadDemoSpy = vi.fn(async () => {
  /* 覆盖式导入的副作用不在本 spec 范围 */
});
vi.mock('../src/components/layout/useBackupIo', () => ({
  useBackupIo: () => ({
    loadDemo: loadDemoSpy,
    fileInput: null,
    confirmDialog: null,
  }),
}));

async function renderInto(el: HTMLElement): Promise<void> {
  await act(async () => {
    const { createRoot } = await import('react-dom/client');
    createRoot(el).render(<FirstRunGuide />);
  });
}

describe('FirstRunGuide（0.8.3 首启三幕·第二幕）', () => {
  let container: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    // 身份流完成态（currentMemberId 落定）——0.8.3 起欢迎卡等 IdentityDialog
    // 走完才出现（双卡叠弹修复），默认用例在这个前提下测欢迎卡本身
    localStorage.setItem('changxia.currentMemberId', 'm-spec');
    loadDemoSpy.mockClear();
    projectsState.value = [];
    // 上一用例 render 的 Modal portal 还挂在 body（未 unmount）——先清场，
    // 否则「卡不出现」的断言读到的是上一条用例的残留 DOM。
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('① 空库 + 未见过：欢迎卡出现，示例入口与空库入口都在', async () => {
    await renderInto(container);
    expect(document.body.textContent).toContain('欢迎使用 ID Plan');
    // v0.8.5 B：单按钮 → 行业分流三卡（她反馈 #2）——示例入口=行业卡
    expect(document.body.textContent).toContain('想先看看哪个行业的样子？');
    expect(document.body.textContent).toContain('先四处看看');
  });

  it('② 示例按钮 → loadDemo + flag 落盘（确认弹窗无论确认与否都不再重弹）', async () => {
    await renderInto(container);
    const demoBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.getAttribute('data-first-run-card') === 'indoor',
    );
    await act(async () => {
      demoBtn?.click();
    });
    expect(loadDemoSpy).toHaveBeenCalled();
    expect(localStorage.getItem('idplan.firstRunGuideSeen')).toBe('1');
  });

  it('②b 「先四处看看」也写 flag（关卡=看过，不扰老用户）', async () => {
    await renderInto(container);
    const skipBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      /先四处看看/.test(b.textContent ?? ''),
    );
    await act(async () => {
      skipBtn?.click();
    });
    expect(localStorage.getItem('idplan.firstRunGuideSeen')).toBe('1');
  });

  it('③ 有过项目（老用户/已载示例）：卡不出现', async () => {
    projectsState.value = [{ id: 'p1' }];
    await renderInto(container);
    expect(document.body.textContent).not.toContain('欢迎使用 ID Plan');
  });


  it('②c ★ 成员身份：示例按钮不渲染（覆盖式导入=全库替换，与侧栏版同口径，0.8.5 P0）', async () => {
    roleState.isAdmin = false;
    await renderInto(container);
    expect(document.body.textContent).toContain('欢迎使用 ID Plan');
    const demoBtn = document.querySelector('[data-first-run-card="indoor"]') as HTMLButtonElement | null;
    // v0.8.5 B：三卡版成员身份 = 卡片渲染但 **disabled**（不是不渲染——列形态预览
    //   对所有身份有信息价值；不可触发覆盖式导入是权限边界）。
    expect(demoBtn, '室内卡渲染（行业预览对所有身份可见）').toBeTruthy();
    expect(demoBtn!.disabled, '成员身份下示例卡必须禁用').toBe(true);
    // 「先四处看看」不受影响
    expect(document.body.textContent).toContain('先四处看看');
    roleState.isAdmin = true;
  });

  it('②d 管理员身份：示例按钮在（对照组，防门控加秃）', async () => {
    roleState.isAdmin = true;
    await renderInto(container);
    const demoBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.getAttribute('data-first-run-card') === 'indoor',
    );
    expect(demoBtn).toBeTruthy();
  });

  it('③c 身份流未完成（currentMemberId 未落定）：卡不出现（等 IdentityDialog，防双卡叠弹）', async () => {
    localStorage.removeItem('changxia.currentMemberId');
    await renderInto(container);
    expect(document.body.textContent).not.toContain('欢迎使用 ID Plan');
  });

  it('③b 已看过（刷新后）：卡不出现', async () => {
    localStorage.setItem('idplan.firstRunGuideSeen', '1');
    await renderInto(container);
    expect(document.body.textContent).not.toContain('欢迎使用 ID Plan');
  });
});
