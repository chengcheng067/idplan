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

/** 与 helper 内同口径的 CJK 判据（夹具自证用，独立写一份以免「用被测对象自证」） */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
/** 中文注释探针串：出现在夹具的**注释**里，剥完后必须看不见 */
const CN_PROBE = '打开导航菜单';

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

/* ══════════════════════════════════════════════════════════════════════
 * maskComments · Token 形态夹具（2026-10-14 修两处「从某行起再也不剥注释」）
 *
 * ⚠️ 这组夹具的**形状**是刻意的，别简化：
 *   每一例都是「一行会打乱旧状态机的**代码**」+「紧跟其后的一行中文注释」。
 *   判据是**两个方向都要成立** ——
 *     ① 那行代码必须**一字不动**（防「判错成注释、把活代码抹了」）；
 *     ② 其后那行注释里的中文必须**一个都看不见**（防「引号状态卡死、从此不再剥注释」）。
 *   只查一个方向都不够：旧实现在 `/\//` 那一例上恰好**方向①红、方向②绿**
 *   （它把正则后面的**半行代码**当注释抹了，于是"注释也顺便被抹"）——
 *   若只断言②，这条夹具会**假绿**。（第一版夹具就是这么写的，被自己证伪后改的。）
 * ══════════════════════════════════════════════════════════════════════ */
describe('maskComments · Token 形态（正则字面量 / 模板替换段）', () => {
  /** 每例：head 是那段「会打乱状态机」的代码；keep 是其中必须**原样保留**的片段 */
  const TOKEN_CASES: Array<{ why: string; head: string; keep: readonly string[] }> = [
    // ── 缺陷 A · 正则字面量（TaskDrawer.tsx 的真实形态）──
    {
      why: '正则里含双引号 /"/g（TaskDrawer.tsx 的真实形态）',
      head: `const s = x.replace(/"/g, '&quot;');`,
      keep: [`/"/g`, `'&quot;'`],
    },
    {
      why: "正则里含单引号 /'/g",
      head: `const s = x.replace(/'/g, '&#39;');`,
      keep: [`/'/g`, `'&#39;'`],
    },
    {
      why: '正则里的转义斜杠 /\\//（不得被当成行注释起点）',
      head: `const p = x.split(/\\//).filter(Boolean);`,
      keep: [`/\\//`, ').filter(Boolean);'],
    },
    {
      why: '正则里的字符类含引号 /["\']/',
      head: `const s = String(x).replace(/["']/g, '');`,
      keep: [`/["']/g`, 'String(x).replace'],
    },
    {
      why: '正则后紧跟多字符 flags /"/gimsy',
      head: `const re = /"/gimsy;`,
      keep: ['/"/gimsy;'],
    },
    {
      why: '正则出现在 = 之后',
      head: `const re = /"/g;`,
      keep: ['/"/g;'],
    },
    {
      why: '正则出现在 , 之后（数组 / 实参位）',
      head: `const a = [/"/g, /'/g];`,
      keep: ['[/"/g,', "/'/g];"],
    },
    {
      why: '正则出现在 => 之后',
      head: `const g = (x) => /"/g.test(x);`,
      keep: ['=> /"/g.test(x);'],
    },
    {
      why: '正则出现在 return 之后（关键字位）',
      head: `function f(x) { return /"/g.test(x); }`,
      keep: ['/"/g.test(x);'],
    },
    {
      why: '正则出现在 typeof 之后（关键字位）',
      head: `const b = typeof /"/g;`,
      keep: ['typeof /"/g;'],
    },
    // ── 缺陷 B · 模板字面量的 `${ }` 替换段（Modal.tsx 的真实形态）──
    {
      why: '模板替换段里的注释必须被剥（Modal.tsx 的三元形态）',
      head: 'const c = `a ${x ? // 这里的中文注释\n  1 : 2} b`;',
      keep: ['`a ${x ?', '1 : 2} b`;'],
    },
    {
      why: '模板替换段里嵌正则（嵌套不得把反引号认错）',
      head: 'const t = `${x.replace(/"/g, "&quot;")}`;',
      keep: ['`${x.replace(/"/g, "&quot;")}`;'],
    },
    {
      why: '模板替换段里的对象字面量花括号必须配对（不得提前弹栈）',
      head: 'const o = `a ${ f({ k: 1 }) } b`;',
      keep: ['f({ k: 1 }) } b`;'],
    },
    // ── 不能误伤：字符串里的注释标记仍是普通字符 ──
    {
      why: '字符串里的 // 与 /* 不是注释起点',
      head: `const u = 'http://a/*b'; const v = 1; // `,
      keep: ["'http://a/*b'", 'const v = 1;'],
    },
  ];

  it.each(TOKEN_CASES)('★ ① 活代码原样保留：$why', ({ head, keep }) => {
    const masked = maskComments(`${head}\n// 中文注释占位\n`);
    for (const k of keep) {
      expect(masked, `活代码被误抹（判错成注释）：${k}`).toContain(k);
    }
    expect(masked.length, '长度恒等（保行号/列位的前提）').toBe(
      `${head}\n// 中文注释占位\n`.length,
    );
  });

  it.each(TOKEN_CASES)('★ ② 其后的中文注释必须被剥：$why', ({ head }) => {
    const src = `${head}\n// 这行注释里的中文必须被剥：打开导航菜单\n`;
    const masked = maskComments(src);
    expect(masked, '漏剥注释 ⇒ 注释里的中文会污染守卫读数').not.toContain(CN_PROBE);
    // 行级复核：注释那一行剥完后不许再有任何 CJK
    expect(CJK.test(masked.split('\n')[1] ?? ''), '注释行仍含中文').toBe(false);
  });

  /**
   * ★ 缺了这条本缺陷会复发 —— 它是 team-lead 点名的**必须红的反例**：
   *   构造含 `.replace(/"/g, '&quot;')` 的源码，其后再写一行中文注释 ⇒ 剥完必须看不到那句中文。
   * 这条与上面 ② 的区别：这里的 head 是**本仓真实文件里的原话**（TaskDrawer.tsx），
   *   不是为夹具造的抽象形态 —— 缺陷正是从这个真实文件被发现的。
   */
  it('★ 必须红的反例：.replace(/"/g, \'&quot;\') 之后的中文注释不得残留', () => {
    const src = [
      `export function esc(s: string): string {`,
      `  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');`,
      `}`,
      `// 下面这段是说明性注释：打开导航菜单 的中文定位写法已换成 data 钩子`,
      `await page.locator('[data-nav-trigger]').click();`,
      ``,
    ].join('\n');
    const masked = maskComments(src);
    // ① 活代码一字不动
    expect(masked).toContain(`s.replace(/"/g, '&quot;')`);
    expect(masked).toContain(`[data-nav-trigger]`);
    // ② 注释里的中文必须消失（旧实现从这里开始就永久卡死）
    expect(masked, '正则里的引号把状态机卡死了 ⇒ 注释没被剥').not.toContain('打开导航菜单');
    expect(masked).not.toContain('说明性注释');
    expect(CJK.test(masked.split('\n')[3] ?? ''), '第 4 行（注释行）仍含中文').toBe(false);
  });

  /**
   * 同一反例的**模板形态**（缺陷 B 的必须红项）：Modal.tsx 的泄漏就长这样。
   */
  it('★ 必须红的反例：模板 ${ } 替换段里的中文注释不得残留', () => {
    const src = [
      'const cls = `base ${',
      `  placement === 'center'`,
      `    ? 'bg-a'`,
      `    : placement === 'fullscreen'`,
      `      ? // 0.8.4 打印预览：层级压过一切 Modal`,
      `        'bg-b'`,
      `      : 'bg-c'`,
      '}`;',
    ].join('\n');
    const masked = maskComments(src);
    expect(masked).toContain(`placement === 'center'`);
    expect(masked).toContain(`'bg-b'`);
    expect(masked, '模板替换段里的注释没被剥').not.toContain('打印预览');
    expect(masked, '替换段里的引号状态串味了').not.toContain('层级压过');
  });
});

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
/* 2026-08-27：115 → **110** —— ⑤b 翻成员看板页时，标题行返回钮的 aria 走了消息表
 * （`topbar.backAria`），于是 `tests/member-board-back.spec.ts` 里 5 处
 * `button[aria-label="返回上一页"]` **必须**换成 `button[data-member-board-back]`
 * （页面同笔加了该钩子）：中文 aria 当选择器在英文模式下会**静默失配**（找不到元素），
 * 正是守卫要防的那类哑雷。实测 110（member-board-back 贡献由 5 → 0）。 */
/*
 * ── 2026-10-14 · maskComments 修 Token 形态后**复核**：110 → 110（**不下调**） ──
 * 预期落空，如实登记：修 `maskComments`（正则字面量 + 模板 `${}` 替换段）之前，
 * 本守卫的输入是**漏剥注释**的源码 ⇒ 「注释里的中文会被算进来」（真实泄漏：
 * 全仓含中文行 12837 → 12251，`tests/isolation-census.spec.ts` 283 → 136）——
 * 由此**推出**「棘轮活值必然下降」。**实测否定**了这一步外推：
 *   旧剥法 scanRepo = 110 行 / 110 处；新剥法 scanRepo = **110 行 / 110 处**，
 *   且两次命中的 **`文件:行` 集合逐条相同**（只有旧/只有新 各 0 处）。
 * ⇒ 结论：漏剥的中文**行**确实很多，但那些行里**没有一条**构成「中文定位契约」
 *   （它们只是散文注释，不带 `locator(...)` / `getByRole(...)` 形态）；
 *   反过来旧剥法误抹活代码的地方（如 `agent-takeover.spec.tsx` 里那两处**删除式剥法
 *   自身**的正则字面量）也没有藏住任何一条命中。
 * ⇒ 故基线**保持 110**：棘轮只许变小，但「没变小」时**不许**为了交付好看而硬改小 ——
 *   凭空下调一格 = 凭空多出一格余量，正好够下一条新错溜过去（本文件上一段的原话）。
 *   ⚠️ 这条记录的存在理由：下一个读到「修了剥注释、棘轮怎么没动」的人，
 *     能在**三十秒内**看到「已实测、不是忘了改」。
 */
/*
 * ── 2026-10-14 · i18n 笔 1-④：110 → **108**（−2，归属清楚） ──
 * 本笔把 `tests/custom-library-section.spec.tsx` 里 **2 处「拿中文 aria 当定位」**
 * 换成与语言无关的 `data-testid`（组件同笔加了 `library-export-{name}` 等钩子）：
 *   · `expect(container.querySelector('button[aria-label="导出行业包 新库"]')).toBeTruthy();`
 *   · `const exportBtn = container.querySelector('button[aria-label="导出行业包 已有库X"]') …`
 * ⇒ 这两处是**真哑雷**：`aria-label` 的取值已改走 `t('library.exportAria')`，
 *   切英文即变 `Export industry library …`，选择器**静默失配**（失败会伪装成「按钮不存在」）。
 *
 * **实测（不是推算）**：
 *   · 同一文件、同一扫描核：`2f417d3` = **2 处** → `8f66501` = **0 处**（`scanCjkLocators` 逐条印出，见提交信息）；
 *   · 全仓 `scanRepo`：`2f417d3` 之后 = **108**，而基线当时是 110 ⇒ 差额恰好 −2，
 *     与上面那两处**一一对应**（本批其余改动都没碰中文 aria 定位：笔 1-⑤ 动的是
 *     `print-logo.spec.ts` 的 esbuild 调用与 `i18n-jsx-space.*` 的英文夹具，笔 1-⑥ 只动 src）。
 *   · 与 `d0b60ef`（修 `maskComments`）的复核结论叠加**仍是净 −2** —— 那笔已实测「剥注释
 *     前后命中的 `文件:行` 集合逐条相同」（见上方 110 → 110 那段），不是同一格。
 *
 * ⚠️ 口径复用本文件上一段：**棘轮只许变小，但「没变小」时不许硬改小** ——
 *   这次是**真的转换了锚点**（−2 有逐条出处），才允许下调。
 */
/*
 * ── 2026-10-14 · i18n 笔 3-A：108 → **107**（−1，归属清楚） ──
 * 本笔把 `calendar/DayItemsPopover` 的关闭钮 `aria-label="关闭当日清单"` 改走
 * `t('calendar.dayPopover.closeAria')` ⇒ `tests/calendar-day-popover.spec.tsx` 里
 * **那一条** `querySelector('button[aria-label="关闭当日清单"]')` 必须换掉
 * （批次⑥ 早就为它落了 `data-day-popover-close` 钩子，本次才把最后一处换成它）：
 *   · 定位改用 `[data-day-popover-close]`（与语言无关）；
 *   · 可见名单独断言成**消息表里那句**（表里有这句 **且** 页面确实消费该键）。
 * 同笔顺手把两处同形状的 `getAttribute('aria-label') !== '关闭当日清单'` 过滤
 * （`agenda-view-v3.spec.tsx` / 同文件）也换成 `!hasAttribute('data-day-popover-close')`
 * —— 它们**不在**本守卫的判据面内（不在 locator 调用行上），但同属「拿中文 aria 当定位」
 * 的哑雷：英文态那两个过滤会**一个都不排除**，把 ✕ 当成条目行。
 *
 * **实测**：改前 `scanRepo` = 108（`calendar-day-popover.spec.tsx` 占 1 处），
 * 改后 = **107**，且该文件已从命中清单里消失 ⇒ 差额与上面那一条**一一对应**。
 * 口径同上一段：**真的转换了锚点**才允许下调。
 */
/*
 * ── 2026-10-14 · i18n 笔 3-B：107 → **106**（−1，归属清楚） ──
 * 本笔把月历日期格整条 `aria-label` 改走消息表（`calendar.cell.*`），
 * 因而 `MonthDayCell` 的条目钮 `aria-label` 由写死的 `` `打开项目 ${name}` ``
 * 变成 `t('calendar.cell.openProject', { name })` ⇒ `tests/v07-dline-shell.spec.ts`
 * 里那条 `page.locator(\`[aria-label="打开项目 ${PROJECT_NAME}"]\`)` **必须**换掉
 * （英文态取值为 `Open project X`，选择器静默失配）。
 *   · 定位改用钩子 `[data-entry-open][data-entry-name="…"]`（与语言无关）；
 *   · 另在**新 spec** `tests/calendar-month-cell-i18n.spec.tsx` 里把
 *     「aria 的人话 = 消息表那句」逐条断言回头（钩子只证结构，证明不了页面消费了哪个键）。
 *
 * **实测**：改前 `scanRepo` = 107（`v07-dline-shell.spec.ts:1027` 占 1 处），
 * 改后 = **106**，两次命中的 `文件:行` 集合**逐条相同，只少了上面那一行**
 * （该文件 20 → 19 处；仓内其余文件计数一字未动）⇒ 差额一一对应。
 *
 * ⚠️ 同笔还顺手拆掉了一批**不在本守卫判据面内**的中文 aria 依赖（`aria-label^="…"` /
 *   从 aria 文案里正则抠数 —— 判据只认 `aria-label=` 精确形态，`^=` 一律看不见）：
 *   共 20 处换成 `data-day-today` / `data-day-count` / `data-entry-open` /
 *   `data-entry-name` / `data-day-expand`。它们**不影响本数字**（本来就没被算进来），
 *   但同属「英文态静默失配」的哑雷 —— 登记在此，免得下一个人以为本笔只改了 1 处。
 *   口径同上一段：**真的转换了锚点**才允许下调。
 */
/*
 * ── 2026-10-14 · i18n 笔 3-D：106 → **102**（−4，逐行归属） ──
 * 本笔把**阶段抽屉**的 `aria-label` 改走消息表（`stageDrawer.ariaWithName`），并把
 * 「删除条目」钮的 aria 改走 `taskChecklist.removeEntryAria`，同笔落两个语言无关钩子：
 *   · `data-stage-drawer`（挂在抽屉内容根 `<aside>` 上）
 *   · `data-task-remove`（挂在删除钮上）
 * ⇒ 判据面内那 4 处**必须**换掉（中文 aria 在英文态静默失配、失败伪装成「控件不存在」）：
 *   · `tests/v07-c2-member-readonly.spec.tsx:311 / :321`（`[aria-label="删除条目"]` ×2）
 *   · `tests/v07-dline-shell.spec.ts:1037 / :1100`（`[aria-label="阶段详情：X"]` ×2）
 *
 * **实测**：改前 `scanRepo` = 106 → 改后 = **102**；两次命中的 `文件:行` 集合
 * **只少上面那四行**（`v07-dline-shell` 19 → 17、`v07-c2-member-readonly` 2 → 0，
 * 其余文件计数一字未动）⇒ 差额逐行一一对应。
 *
 * ⚠️ 同笔还拆掉 5 处**不在判据面内**的同类哑雷（`aria-label^="阶段详情"` ×5：
 *    `tests/qa-batch-a-verify.spec.ts` 4 处 + `overlay-stack-browser.spec.ts` 1 处；
 *    判据只认 `aria-label=` 精确形态，`^=` 一律看不见）—— 它们**不影响本数字**，
 *    但同属「英文态静默失配」，登记在此。
 * 口径同前两段：**真的转换了锚点**才允许下调。
 */
/*
 * ── 2026-10-15 · i18n-EN 英文补齐批（分片 `ui`，负责区 `src/components/**`）：102 → **96** ──
 * `MemberIdentityPicker` 的菜单可访问名 `aria-label="身份操作"` 改走消息表
 * （`ui.identity.menuAria`）—— 它是**中文界面文案**，英文态下按它定位会静默失配。
 * 同批把**判据面内**的这些调用点换成既有钩子 `[data-identity-menu]`（该钩子 2026-10-14 已立好）：
 *   · `tests/overlay-stack.spec.tsx`（5 处 `[role="menu"][aria-label="身份操作"]`）
 *   · `tests/identity-single-home.spec.tsx:127`
 *   · `tests/settings-zones.spec.ts:341`
 *   · `tests/overlay-stack-browser.spec.ts:151` 是 `const IDENTITY_MENU = '…'` **赋值**形态
 *     （不在 locator 调用行上）⇒ 本来就**不被判据面命中**；改它是为了同源，**不构成本次差额**。
 * **实测**：改前 102 → 改后 **96**（−6；判据面内 7 处里只有 6 处真的计入 —— 判据按**行**判
 * 且要求命中行落在 locator 调用上，赋值/跨行写法看不见，见本文件开头的「已知局限」）。
 * ⚠️ 同族还有 **6 处判据面看不见**的中文锚点（`button[title="当前身份（点击切换/退出）"]`
 *    与「全页搜『点击进入』文本」的载荷，散在 16 个 spec 里）**本笔未转换**，已登记在交付报告；
 *    组件侧已同批补好 `data-identity-trigger` / `data-identity-enter` 两个钩子，换起来是机械活。
 */
/*
 * ── 2026-10-15 · i18n-EN 英文补齐批（同伴笔）：96 → **86** ──
 * ⚠️ **这 −10 不是上一条（`ui` 分片）造成的** —— 如实归属，免得下次核对时对不上账：
 *   · `ui` 分片那笔（`30553dd`）转换的是 `[role="menu"][aria-label="身份操作"]` 与
 *     `button[title=…]` / 全页按文本找。**后两类不在判据面内** ⇒ 该笔只带来 −6（102→96），
 *     「96 → 86」这十格是**之后**由同伴的锚点转换造成的。
 *   · 差额逐文件核对（与 96 那次的按文件分布比对，只有这两个文件变了）：
 *       `tests/v08-stage-wizard.spec.tsx`    7 → **0**（−7）
 *       `tests/v08-intake-two-paths.spec.tsx` 4 → **1**（−3）
 *     两处都随 `663b373`（建档向导 · `ManualFallbackForm` + `StageSelectPanel` 定位钩子）而来 ——
 *     即 `contract-wizard/**` 那族的中文 `aria-label^="套餐 |行业 |关联板块 |选择阶段 "` 锚点换成了钩子。
 *   · 其余 22 个文件的计数**一字未动**（`v07-dline-shell` 仍 17、`v07-board-acceptance` 仍 11、
 *     `print-selector-modules` 仍 7 …），所以这 −10 逐条可归因、不是「扫宽了」。
 * **实测**：改前 96 → 改后 **86**（team-lead 2026-10-15 复核时量到 86，本次下调即照此）。
 *   复跑：`npx tsx -e "import('./tests/helpers/cjk-locator-guard.ts').then(m=>console.log(
 *     m.scanRepo(process.cwd()).filter(h=>h.file!=='tests/i18n-browser.spec.ts').length))"` ⇒ 86
 * 口径同前几段：**真的转换了锚点**才允许下调；「绿着不下调」= 凭空留出 N 格让新错溜过去。
 * ⚠️ 本文件仍有一批**判据面看不见**的同族哑雷（`aria-label^=` 与跨行写法），
 *    它们的规模与归属**不体现在这个数字里**，别把「数字降了」读成「都转换完了」。
 *
 * ── 2026-10-15（i18n-EN 英文补齐批 · `i18n-ui` 的「活哑雷」普查笔）──
 * **实测**：改前 86 → 改后 **83**（−3）。
 *   · 逐条归因（**只有** `tests/v07-dline-print-access.spec.tsx` 变了，3 → **0**）：
 *       `button[aria-label="导出日程表"]`（:603）与 `button[aria-label="项目更多操作"]`
 *       （:705 反向、:738 正向）共 3 处 ⇒ 换成 `data-project-card-export-schedule` /
 *       `data-project-card-more-trigger`（组件侧同批补的钩子，见 `ProjectCard.tsx`）。
 *   · 按文件分布**逐条核对**（同一命令对比 86 那次）：`v07-dline-shell` 仍 17、
 *     `v07-board-acceptance` 仍 11、`print-selector-modules` 仍 7、`qa-batch-a-verify` 仍 7、
 *     `proposal-review-panel` 仍 5 …—— 除 `v07-dline-print-access` 外**一份都没动**，
 *     所以这 −3 是「真转换」，不是「扫窄了」。
 *   · ★ **同一笔里另有 3 处转换，不体现在这个数字里**（写下来免得下一个人对不上账）：
 *     `tests/agent-board-create.spec.tsx` 的 `input[aria-label="看板名称"/"开始日期"/"结束日期"]`
 *     换成了 `data-create-agent-board-*`。它们**本来就没进过本闸** —— 原写法
 *     `named<HTMLInputElement>('input[aria-label="…"]', …)` 不在
 *     `locator / querySelector / waitForSelector` 调用里，判据面看不见（守卫的已知边界：
 *     它按**调用形态**认，不按属性本身认）。⇒「改了 6 处、数字只降 3」是**对的**，
 *     不等于另外 3 处没改。给那 3 处补的判据是**同源断言**（aria 文案 === `tRaw(<键>)`），
 *     不是棘轮 —— 见该 spec 里「三个字段的 aria 名取自消息表」那条。
 *   · **本批通用读数纪律（建议沿用）**：棘轮数字**只用来对账「判据面内」的转换**；
 *     判据面外的同族哑雷要**另立台账**，否则「数字没动」会被误读成「没干活」。
 *     ⚠️ 别把两套数字相减当「漏报数」：普查脚本（`tools/i18n-ui-selector-census-nocomment.mjs`）
 *     口径**更宽**（引号紧邻即认；且含守卫自身夹具 11 处、`print-selector-modules` 7 处等），
 *     实测活代码 114 处。两者是「找人」与「上闸」两种用途，不是同一把尺。
 *   复跑：`npx vitest run tests/cjk-locator-guard.spec.ts --reporter=verbose` 读测试名里的
 *     「当前 N / 基线 M」（或把 `BASELINE` 临时置 0，失败文案会直接印出**按文件分布**）⇒ 83
 */
const BASELINE = 83;

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
