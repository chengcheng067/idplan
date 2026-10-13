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

import { scanCjkLocators, maskComments, scanRepo } from './helpers/cjk-locator-guard';

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

/* ══════════════════════════════════════════════════════════════════════
 * 守卫接通（批次⑥ 档 A₂，team-lead 裁决）
 *   形态 = **零容忍区 + 棘轮**，两者都是硬红。
 * ══════════════════════════════════════════════════════════════════════ */

/** 零容忍区：**唯一真正双语运行**的 spec ⇒ 命中即红（新增双语 spec 时同时把它加进来，加一个清一份） */
const ZERO_TOLERANCE_ZONE = ['tests/i18n-browser.spec.ts'];

/**
 * 棘轮基线：**全仓（除零容忍区）中文定位处数的上限**。
 * 首次接通（2026-10-13 档 A₂）实测 = **116**（接通前 128，档 A₁+A₂ 共转换 12 处）。
 * ⚠️ 纪律（写在代码里，不靠记忆）：**基线只许变小** —— 每次转换了锚点，
 *   同批把这个数字下调到新实测值。新增一处即红。
 * 已知弱点（team-lead 明示）：它只能**防增量**、不能强制缩减；补偿机制是每批验收
 *   时由他亲自看这个数字 —— 所以每次红灯都要把「当前 N / 基线 M」印出来。
 */
/* 2026-10-14：116 → 115 —— 本批把「身份菜单」的三处中文 aria 定位换成 `data-identity-menu` 钩子
 * （`board-env.ts` 1 处是上一笔引入的、`identity-rail-browser` 2 处是同源旧写法），实测 115。
 * 棘轮**只许降**：绿了不下调 = 凭空多出一格余量，那一格正好够下一条新错溜过去。 */
const BASELINE = 115;

describe('中文定位守卫 · 接通（零容忍区 + 棘轮）', () => {
  const hits = scanRepo(process.cwd());
  const inZone = hits.filter((h) => ZERO_TOLERANCE_ZONE.includes(h.file));
  const outside = hits.filter((h) => !ZERO_TOLERANCE_ZONE.includes(h.file));

  it('★ 零容忍区：双语运行的 spec 必须零中文定位', () => {
    expect(
      inZone.map((h) => `${h.file}:${h.line} ${h.hit.text}`),
      '零容忍区内出现中文定位 —— 该 spec 会在英文模式下静默失效',
    ).toEqual([]);
  });

  it(`★ 棘轮：全仓中文定位 ≤ 基线（当前 ${outside.length} / 基线 ${BASELINE}）`, () => {
    const delta = outside.length - BASELINE;
    /*
     * ★ 2026-10-13 失败文案补「按文件明细」：棘轮第一次真实咬人时（117 > 116，来自另一条新
     *   提交的 spec）我先做了一轮人工排查才发现是哪一处 —— 那不该由人来做。
     *   ⇒ 只要超基线，就把**每个文件各几处**直接印出来（不逐行列全部，避免刷屏；
     *     需要精确到行时跑 `scanRepo(process.cwd())`）。
     */
    const perFile = [...outside.reduce((m, h) => m.set(h.file, (m.get(h.file) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `     ${String(n).padStart(3)}  ${f}`)
      .join('\n');
    expect(
      outside.length,
      `中文定位计数超出基线：当前 ${outside.length} / 基线 ${BASELINE}` +
        (delta > 0
          ? `（新增 ${delta} 处 —— 请改用 data-* 钩子定位）\n   按文件分布（全仓，含旧账）：\n${perFile}`
          : `（可下调 ${-delta} 处 —— 转换了锚点就同批把基线改小）`),
    ).toBeLessThanOrEqual(BASELINE);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 剥法边界（2026-10-13 复核者交叉核对两条实现后量化出来的）
 *   它把注释**全抹空格**、我**保留起始标记 `/*` 与前两字符**，两者都保长保行号；
 *   差异只在「注释被替换成什么」，却会改变**被锁串形如注释标记**那类锁的判定。
 *   下面把这组边界**钉成夹具**（而不是只写在头注释里）—— 边界也必须有个会红的东西守着。
 * ══════════════════════════════════════════════════════════════════════ */
describe('maskComments · 剥法边界（保标记、保长度、抹内容）', () => {
  const src = ['const a = 1; /* 中文注释 */ const b = 2;', '// 行注释：中文', 'const c = 3;'].join('\n');
  const masked = maskComments(src);

  it('① 注释**内容**被抹掉', () => {
    expect(masked).not.toContain('中文注释');
    expect(masked).not.toContain('行注释：中文');
  });

  it('② **长度恒等**（这是它能保行号/列位的原因，也是「不能用长度自证」的原因）', () => {
    expect(masked.length).toBe(src.length);
  });

  it('③ **换行保留**（行级回溯的前提）', () => {
    expect(masked.split('\n').length).toBe(src.split('\n').length);
  });

  it('④ ⚠️ **起始标记保留** —— 故它不是「把注释删掉」的工具（本组夹具的存在理由）', () => {
    // 若这条将来变红，说明剥法被改成了「删除式」⇒ 必须同步改头注释里的边界说明，
    // 并回头检查 `tests/demo-data.spec.ts` 那条锁与复核者的判定器。
    expect(masked, '块注释起始标记 `/*` 必须仍在').toContain('/*');
    expect(masked, '且内容已抹白：只剩标记、没有正文').not.toContain('中文注释');
  });

  it('⑤ 活代码原样不动（剥的是注释，不是代码）', () => {
    expect(masked).toContain('const a = 1;');
    expect(masked).toContain('const b = 2;');
    expect(masked).toContain('const c = 3;');
  });
});
