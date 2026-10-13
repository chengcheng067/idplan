/**
 * 测试定位解耦 · 守卫的**判别力夹具**（批次⑥）。
 *
 * 为什么单独一个文件：`tests/helpers/cjk-locator-guard.ts` 是纯函数，它的判别力
 * **只能靠离散夹具证明** —— 「扫一遍打印报告」式的守卫无法证明它真的会红。
 * 这里两组夹具零容差：**正的必中、负的必不中**。团队内复核者会用变异体实测本组。
 *
 * ⚠️ 全仓扫描（`scanRepo`）**故意还没接进断言**：接通时机 = 所有中文定位锚点换完之后
 *   （team-lead 裁决：守卫要「一出生就是绿的、零豁免」）。在此之前把它接成断言只会
 *   得到一条长期的红 —— 而长期红会被当成噪音，等于没有闸门。
 *   现在这一步交付的是**底座 + 判别力证明**；接通是 ⑥ 的最后一步。
 */
import { describe, it, expect } from 'vitest';

import { scanCjkLocators, maskComments } from './helpers/cjk-locator-guard';

/** 正的夹具：**必须**命中（拿中文当定位契约） */
const MUST_HIT: Array<{ why: string; code: string }> = [
  {
    why: 'locator 里用 aria-label="中文" 定位（本仓最常见的哑雷形态）',
    code: `await page.locator('button[aria-label="打开导航菜单"]').click();`,
  },
  {
    why: 'querySelector 里用 aria-label="中文" 定位（qa-batch-a-verify:862 那种形态）',
    code: `document.querySelector<HTMLButtonElement>('button[aria-label="打开导航菜单"]')?.click();`,
  },
  {
    why: 'waitForSelector 里用 aria-label="中文" 定位',
    code: `await page.waitForSelector('[role="tablist"][aria-label="成员看板视图切换"]');`,
  },
  {
    why: 'getByRole 的 name 用中文（fixture 形态，当前全仓 31 处）',
    code: `await page.getByRole('button', { name: '打开导航菜单' }).click();`,
  },
  {
    why: 'getByLabel 用中文（当前全仓 0 处，但守卫要先立着）',
    code: `screen.getByLabel('关闭当日清单');`,
  },
  {
    why: 'getByPlaceholder 用中文（当前全仓 0 处）',
    code: `screen.getByPlaceholder('搜索项目、任务或客户…');`,
  },
  {
    why: 'getByTitle 用中文（当前全仓 0 处）',
    code: `screen.getByTitle('内测版本');`,
  },
];

/** 负的夹具：**不许**命中（对内容本身的断言 / 按可见文案定位 / 注释里的举例） */
const MUST_NOT_HIT: Array<{ why: string; code: string }> = [
  {
    why: '断言可访问名（对内容本身的断言，锁它会把整套扫红）',
    code: `expect(src).toContain('aria-label="ID Plan 首页"');`,
  },
  {
    why: '期望 aria 名的白名单数组（v07-dline-shell:106 那种）',
    code: `const TOPBAR_LABELS = ['打开导航菜单', '更多操作'];`,
  },
  {
    why: '按可见文案定位 getByText（有意不锁：既是定位也是内容断言）',
    code: `expect(page.getByText('我的任务')).toBeVisible();`,
  },
  {
    why: '按可见文案定位 hasText',
    code: `await page.locator('button', { hasText: '先四处看看' }).click();`,
  },
  {
    why: '文本内容断言 textContent.toContain（渲染态「取值再比串」那类正确写法）',
    code: `expect(h.textContent).toContain('该项目的阶段与你无关');`,
  },
  {
    why: '注释里举例说明「原本是 button[aria-label="中文"]」——剥注释后必须不命中',
    code: `// 原本是 button[aria-label="打开导航菜单"]，已换 data 钩子`,
  },
  {
    why: '纯中文文案常量（消息表取值/zh 表本身，与定位无关）',
    code: `const zh = catalogOf('zh')['mobile.moreAria']; // '更多操作'`,
  },
];

describe('中文定位守卫 · 判别力夹具（零容差）', () => {
  it.each(MUST_HIT)('★ 正夹具必中：$why', ({ code }) => {
    expect(scanCjkLocators(code).length, `应当命中但漏了：${code}`).toBeGreaterThan(0);
  });

  it.each(MUST_NOT_HIT)('○ 负夹具必不中：$why', ({ code }) => {
    expect(scanCjkLocators(code), `不应当命中但误报了：${code}`).toEqual([]);
  });

  it('剥注释是守卫的自我保护：注释里引用旧选择器不许被当成命中', () => {
    const src = [
      '// 这一段注释里写着 page.locator(\'button[aria-label="打开导航菜单"]\') 的旧写法',
      '/* 块注释里也一样：querySelector(\'button[aria-label="更多操作"]\') */',
      "await page.locator('[data-mobile-more-trigger]').click();",
    ].join('\n');
    expect(scanCjkLocators(src), '注释被当成代码 = 守卫会误伤，必须剥').toEqual([]);
    // 反向自证：把注释剥掉这个动作本身有效（否则上面那条会变成「全过」的假绿）
    expect(maskComments(src)).not.toContain('打开导航菜单');
    expect(maskComments(src), '剥的是注释、不是代码').toContain('[data-mobile-more-trigger]');
  });
});
