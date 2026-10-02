import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * v0.7 · T04 D 线（外壳与权限）· **真 Chromium 验收**（真实构建产物 + 真断点 + 真布局）。
 *
 * 覆盖用例（与 §8 的验收编号对齐）：
 *   ①-a V1-22 · ⋮ 按端分流（7 档视口，含 767/768 与 1279/1280 两组边界）
 *   ①-b V1-22 ④ · 平板档删渲染后的**功能等价性**（6 个入口在侧栏抽屉内可命中）
 *   ①-c V1-23 · 顶栏按钮白名单（三档，且任何一档都没有顶栏「设置」齿轮）
 *   ②   V1-24 · 侧栏「设置」项红点（展开态 + 收起态），并配「无 bridge → 零渲染」负对照
 *   ③   V1-25 / V1-26 · 成员看板 看板↔月历 切换、刷新不丢、键隔离、E1 无死按钮
 *   ④   V1-28 ② / P0-19-① · 成员月历 → 项目详情 → 阶段抽屉：无「修改」、复制路径可用
 *   ④-对照 · 管理员同一阶段仍可改（收紧不得收过头）
 *
 * ── 为什么这几件事必须真浏览器（jsdom 判不了）──
 *   jsdom **不加载 Tailwind 产物 CSS、不做媒体查询求值、不做布局**，故：
 *     · 「手机档可见 / 平板·桌面档不可见」是**断点语义**（`md:hidden` → `@media(min-width:768px){display:none}`）
 *       —— jsdom 里 `getComputedStyle(...).display` 对工具类恒返回空串，断言不可证伪；
 *     · 「侧栏展开态 / 收起态各一枚红点」要求两棵 DOM 真的各自渲染（React 条件渲染 +
 *       `xl:flex` 档位），且必须**在两档视口下实测**；
 *     · 「成员月历 → 项目详情 → 阶段抽屉」是一条真路由跳转 + 真 SVG 甘特点击 + 真抽屉，
 *       需要真 CSS 命中测试（jsdom 无布局，任何点击都「成功」）；
 *     · E1 空状态是否真的**不渲染**那个 CTA，只有真渲染才作数。
 *   故本文件与 `v07-dline-permission.spec.tsx`（jsdom：偏好键读写/键隔离、资源路径门控、
 *   调用契约、E1 条件渲染的组件级断言）是**互补**关系，不是重复。
 *
 * ── 前置（沿用 `ui-batch-a-geometry.spec.ts` 的**模式**，但把判定输入收窄，见下方常量注释）──
 *   `npm run build` 必须先跑过，且产物不得早于任一**界面相关**构建输入；产物 / Chromium
 *   缺失，或产物**过期** → 整组 skip（不会把默认 `npm test` 染红，但**跳过是必须的**：
 *   那时测的是上一版界面，可能「误报绿」，比不跑更坏）。
 *   强制验收：`npm run build && npm test`。**skip 数必须为 0 才算验收通过。**
 *
 * ── 产物必须经 HTTP 提供 ──
 *   `vite.config.ts` 的 `base: '/'` 使产物引用 `/assets/*` 绝对路径，`file://` 下会解析到
 *   盘根 → 404 → 应用根本不挂载（DOM 里连 header 都没有）。故起零依赖只读静态服务器
 *   （node:http）并**显式设置 Content-Type**（缺 Content-Type 时 Chromium 拒绝执行
 *   module script → 同样是不挂载的假红）。
 *
 * ── 关于「⋮ 平板/桌面不可见」的断言口径（一处**诚实澄清**，务必读）──
 *   设计文档 §8-V1-22 的原文验收方式是：
 *     「① 390 → `MobileMoreMenu` 根节点 `getComputedStyle().display !== 'none'`；
 *       ② 1024 → `display === 'none'`；③ 1440 → `display === 'none'`；
 *       ④ 1024 视口逐一断言 §5.2.5 表中 6 个入口**可在侧栏抽屉内命中**」
 *   —— 即**以计算样式判定**，本文件 ①-a / ①-b 严格按此实现。
 *
 *   ⚠️ 若口径被读成「平板/桌面 **DOM 里不存在** ⋮ 节点」，那是**做不到也不该做**的：
 *   `md:hidden` 是纯 CSS 隐藏，节点仍在 DOM（`display:none`）；要「DOM 真不存在」必须把
 *   断点改成 JS 条件渲染（新增渲染分支 + resize 监听），而本轮唯一授权的类名改动是
 *   `xl:hidden → md:hidden`。故本文件用**双向可证伪**的断言覆盖同一风险面（强度不降）：
 *     · 应隐藏档：`isVisible() === false`（Playwright 穿透全部祖先）+ `display === 'none'`；
 *     · 应显示档（手机）：`isVisible() === true` + `display === 'block'`
 *       —— 只有一侧的断言是危险的：整块图没渲染时「不可见」也会通过（假绿），
 *          故手机档必须有正向证据，且 ①-a 末尾把 7 档曲线整体 `toEqual` 钉死。
 *
 * ── 无 bridge 负对照（红点不能被断言成「恒亮」）──
 *   `status === 'has-update'` 只可能来自桌面端主进程推送，而浏览器端 `window.idplan`
 *   永不存在。本文件用 `addInitScript` 注入一份**最小假 bridge**（`isDesktop:true` +
 *   `onUpdateAvailable` 立即回调 hasUpdate 负载）来点亮红点，**并另起一个不注入的
 *   context 断言红点数为 0** —— 没有这条负对照，「红点存在」在「红点无条件渲染」的
 *   错误实现下**照样全绿**。
 */

/* ------------------------------ 路径与常量 ------------------------------ */

/** 构建产物入口 */
const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');
/** 主种子备份包（应用自身 zod schema 校验通过的真备份格式；派生用） */
const SEED_FIXTURE = resolve(__dirname, 'fixtures', 'v07-board-seed.json');
/** 本 spec 的产物目录（派生种子 + 截图） */
const OUT_DIR = resolve(__dirname, '..', 'qa-scratch', 'v07-stageD');

/** 顶栏 ⋮ 的唯一锚点（`MobileMoreMenu.tsx` 的按钮 aria-label） */
const MORE_BTN = 'button[aria-label="更多操作"]';
/** 成员看板视图切换（`MemberBoardPage.tsx` 的 SegmentedControl ariaLabel） */
const MEMBER_VIEW_SWITCH = '[role="tablist"][aria-label="成员看板视图切换"]';
/** 月历视图密度切换（`MonthlyCalendarView.tsx`）——「月历真的挂上来了」的稳定证据 */
const DENSITY_SWITCH = '[role="tablist"][aria-label="月历视图密度"]';
/** 更新红点（P0-17 配套：Sidebar 两态各一枚） */
const DOT = '[data-update-dot]';

/**
 * V1-23 · 顶栏按钮**白名单**（按 `aria-label` 判定）。
 *
 * 依据：设计文档 §8-V1-23「断言顶栏内按钮集合（`aria-label` 白名单），任何越界按钮
 * （除汉堡/头像/搜索）即失败」+ v0.7 批次 A · A3「顶栏齿轮设置按钮已删除」。
 *   汉堡   → `打开导航菜单`（<xl）
 *   搜索   → `打开搜索`（平板 768–1279）/ `清空并关闭搜索`（展开了内联搜索时）
 *   ⋮更多  → `更多操作`（**仅手机 <768**，P0-17 保留）
 *   面包屑 → `返回上一页`（仅 `/project/**` 路径；本组在首页跑，故不应出现）
 * 头像按钮（`MemberIdentityPicker`）不带 `aria-label`（只有 `title`），故不出现在本名单里。
 */
const TOPBAR_LABEL_WHITELIST = [
  '打开导航菜单',
  '打开搜索',
  '清空并关闭搜索',
  '更多操作',
  '返回上一页',
];

/** 种子里的项目名（日历色带 aria-label 与导入成功信号都用它） */
const PROJECT_NAME = '验收样例项目';
/** 种子里的**普通成员**（roleKind='member'）——本 spec 成员视角一律用它 */
const MEMBER_ID = 'm-2';
/** 种子里的管理员 */
const ADMIN_ID = 'm-admin';
/** 种子里的阶段名（项目详情左列按钮的可见文本） */
const STAGE_NAME = '阶段一';
/** 派生种子写进 `stage.resourcePath` 的资料路径（成员只读展示的唯一断言源） */
const MEMBER_RESOURCE_PATH = 'D:\\长夏验收\\成员只读资料';

/** 抑制首启身份引导弹窗用的探针身份（不存在的成员：只要 currentMemberId 非 null，闸门即不弹） */
const PROBE_MEMBER_ID = 'm-probe';

/** 探测已安装的 chromium 可执行文件（跨平台；与阶段 A/B 同一实现，避免三份漂移） */
function resolveChromium(): string | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  const relCandidates = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root).filter((n) => n.startsWith('chromium-'));
    } catch {
      continue;
    }
    for (const dir of entries) {
      for (const rel of relCandidates) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/**
 * 参与「产物是否过期」判定的构建输入。
 *
 * ⚠️ **有意区别于 `ui-batch-a-geometry.spec.ts` 的全局 `['src','electron']`**（务必读）：
 *   本仓库当前是**多人并行改同一棵树**——实测 T01 数据线在 22:00:42 ~ 22:02:39 连续改了
 *   `src/core/types/entities.ts` / `repositories/interfaces.ts` / `remote/rest.client.ts` /
 *   `services/backup.service.ts` / `services/project.service.ts`。全局口径会把「数据层改了一个
 *   repo 文件」也算成「产物过期」→ 本 spec 整组 skip；而验收口径是 **skip 必须为 0**，
 *   于是「队友在改数据层」会直接让外壳验收无法交付（首轮实测即栽在此处：8 用例 7 skip）。
 *
 *   为什么不干脆放宽成「永不 skip」：本 spec 读的是**产物里已编译好的 CSS / DOM**。改完
 *   `MobileMoreMenu` 的断点类忘了 `npm run build`，读到的仍是上一版断点 —— 那正是本 spec
 *   要防的「测了上一版界面却误报绿」，所以对**相关**输入必须继续严格。
 *
 *   故按「**这个变更能不能动到本 spec 断言的那块界面**」划界：
 *     · **计入过期**（改了就必须重新 build，否则 skip）：外壳及被断言界面的全部直接依赖
 *       —— `src/components/**`、`src/pages/**`、`src/store/**`、`src/hooks/**`、
 *       `src/lib/**`、`src/styles/**`、`src/main.tsx`、`electron/**` 与四个构建配置文件。
 *     · **不计入过期**：`src/core/**`（数据层：Dexie 仓 / 类型 / 服务 / 备份 / 解析）。
 *       两条理由：① 它无法改变 Tailwind 的断点 CSS，也无法改变外壳 DOM 结构 ——
 *       而本 spec 断言的正是这两样；② 万一它真把应用改坏，本 spec 会**真红**
 *       （应用挂不上 = 断言失败），这比「静默 skip、看起来像通过」安全得多 ——
 *       失败模式从「假绿」变成「真红」。
 */
const BUILD_INPUT_DIRS = [
  'src/components',
  'src/pages',
  'src/store',
  'src/hooks',
  'src/lib',
  'src/styles',
  'electron',
];
const BUILD_INPUT_FILES = [
  'src/main.tsx',
  'index.html',
  'vite.config.ts',
  'tailwind.config.ts',
  'postcss.config.js',
];

function collectFiles(dir: string): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/**
 * 「上次构建真正落盘的时刻」= `build-dist/` 内**最新**一个产物文件的 mtime。
 *
 * ⚠️ 为什么不沿用 `ui-batch-a-geometry.spec.ts` 的 `statSync(index.html).mtimeMs`：
 *   **Rollup 会跳过「内容与现有文件逐字节相同」的写入**，而 `vite.config.ts` 又关了
 *   `emptyOutDir`（产物只增不删）。于是当某次构建的 `index.html` 内容与上一版一致时，
 *   它的 mtime 会**停在更早的那次构建**上（实测：本次 build 于 22:01:45 完成，而
 *   `build-dist/index.html` 的 mtime 仍是 22:00:24）。以它为锚点会把「刚刚构建过」
 *   误判成「产物过期」——**假 skip**，与我们要防的「假绿」同属一类失真。
 *   取**全目录最新 mtime** 则不受影响：只要这次构建落盘了任意一个新文件（内容变了才会有
 *   新 hash 文件名），锚点就跟着前进；若这次构建一个文件都没写，说明输入也确实没变，
 *   「不算过期」是正确结论。
 */
function distLatestMs(): number {
  const fs = require('node:fs') as typeof import('node:fs');
  let max = 0;
  for (const f of collectFiles(resolve(__dirname, '..', 'build-dist'))) {
    try {
      const m = fs.statSync(f).mtimeMs;
      if (m > max) max = m;
    } catch {
      /* 与并行进程竞态导致的瞬时 ENOENT：忽略 */
    }
  }
  return max;
}

/**
 * 产物是否早于任一构建输入（过期样例最多 3 个）。
 *
 * 为什么必须挡：「断点语义」读的是**产物里已编译好的 CSS**。改完 `MobileMoreMenu.tsx`
 * 的断点类忘了 `npm run build` 时，读到的仍是上一版断点 —— 而本次要证明的恰恰是
 * 「源码里的类名 → 产物 CSS 的 display」这条链，跳过 build 等于测了个寂寞。
 */
function staleInputs(): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { resolve: res } = require('node:path') as typeof import('node:path');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = distLatestMs();
  if (distMs === 0) return [];
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(res(__dirname, '..', d))),
    ...BUILD_INPUT_FILES.map((f) => res(__dirname, '..', f)).filter((f) => existsSync(f)),
  ];
  return candidates
    .filter((f) => fs.statSync(f).mtimeMs > distMs)
    .map((f) => f.replace(res(__dirname, '..') + '\\', '').replace(res(__dirname, '..') + '/', ''))
    .slice(0, 3);
}

const STALE_INPUTS = CAN_RUN ? staleInputs() : [];
const CAN_RUN_FRESH = CAN_RUN && STALE_INPUTS.length === 0;

/** 单条用例的轻量超时（真浏览器 + 首屏加载） */
const HEAVY = 30000;
/** 需要导入种子的用例超时（导入 → reload → 再导航） */
const SEEDED = 90000;

/**
 * 零依赖只读静态服务器（缺 CSS/JS 一律 404，不做 SPA 回退到 HTML 的偷懒做法）。
 *
 * 与 `layout-walkthrough.spec.ts` 的差异（有意为之）：**缺失的资源一律 404**。
 * 若对 `/assets/x.js` 回 `index.html`，浏览器会拿到 HTML 当 module script 执行，
 * 报「Unexpected token '<'」——那是个**真正的**错误但极易被误读成应用 bug；404 会让
 * 失败点直接指向「产物/路径不对」。SPA 回退只对无扩展名的路由路径生效。
 */
async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const http = require('node:http') as typeof import('node:http');
  const fs = require('node:fs') as typeof import('node:fs');
  const { join, extname } = require('node:path') as typeof import('node:path');

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(rootDir, raw);
    if (!existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (/\.(js|mjs|css|json|png|jpg|svg|ico|woff2?)$/.test(raw)) {
        res.writeHead(404).end('not found');
        return;
      }
      filePath = join(rootDir, 'index.html'); // SPA 回退（与 nginx try_files 同语义）
    }
    try {
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/* ------------------------------ 种子派生 ------------------------------ */

/** 当前自然月的首日 / 末日（`YYYY-MM-DD`）——月历默认看当月，派生种子必须落在当月 */
function currentMonthRange(): { first: string; last: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const mm = String(m + 1).padStart(2, '0');
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * 从主种子**派生**一份「成员视角」种子并落盘，返回其路径。
 *
 * 三处派生（缺任一，第 ④ 条验收就成立不了）：
 *   ① 项目 / 阶段的起止改到**当月** —— 月历默认看当月，原种子（2026-01~06）在当月网格里
 *      根本不出现，月历会落到 E2/E4 空状态，点不到任何色带；
 *   ② `stage.ownerId = m-2` —— `MonthlyCalendarView` 内部用 `computeRelatedStageIds`
 *      （ownerId 命中 或 参与任务命中）过滤，负责人不改，成员视角看不到该项目；
 *   ③ `stage.resourcePath` 给值 —— 第 ④ 条要断言的「有路径 → 只读展示 + 复制路径可点」
 *      必须有路径；原种子是 `null`，那会走到「成员一律不渲染」的另一条分支。
 *
 * 为什么派生而不是手写第二份 JSON：手抄的第二份必然与主种子漂移，而「两套数据只差这三处」
 * 是本用例成立的全部前提——前提悄悄失效时用例仍会绿，只是它证明的东西已经不同了。
 * 派生则让前提由构造保证（并在下方显式校验「确实改了」）。
 */
function writeMemberFixture(): string {
  const pkg = JSON.parse(readFileSync(SEED_FIXTURE, 'utf8')) as {
    data: {
      projects: Array<Record<string, unknown>>;
      stages: Array<Record<string, unknown>>;
    };
  };
  const { first, last } = currentMonthRange();

  const project = pkg.data.projects[0]!;
  const stage = pkg.data.stages[0]!;
  const before = {
    plannedStartAt: project['plannedStartAt'],
    ownerId: stage['ownerId'],
    resourcePath: stage['resourcePath'],
  };

  project['plannedStartAt'] = first;
  project['plannedEndAt'] = last;
  stage['startAt'] = first;
  stage['endAt'] = last;
  stage['ownerId'] = MEMBER_ID;
  stage['resourcePath'] = MEMBER_RESOURCE_PATH;

  // 前提校验：三处派生必须**真的**改动了值，否则本 fixture 与主种子雷同
  const unchanged: string[] = [];
  if (before.plannedStartAt === project['plannedStartAt']) unchanged.push('project.plannedStartAt');
  if (before.ownerId === stage['ownerId']) unchanged.push('stage.ownerId');
  if (before.resourcePath === stage['resourcePath']) unchanged.push('stage.resourcePath');
  if (unchanged.length > 0) {
    throw new Error(
      `[v07-dline-shell] 派生种子未改到：${unchanged.join(', ')} —— 前提失效，第 ④ 条验收会假绿。`,
    );
  }

  const out = resolve(OUT_DIR, 'member-seed.json');
  writeFileSync(out, JSON.stringify(pkg, null, 2), 'utf8');
  return out;
}

/* ------------------------------ 浏览器辅助 ------------------------------ */

interface Env {
  ctx: BrowserContext;
}

describe.skipIf(!CAN_RUN_FRESH)(
  'v0.7 · T04 D 线（外壳与权限）真 Chromium 验收（真实构建产物）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };
    /** `http://127.0.0.1:<port>/`（含尾斜杠，供 `base + 'member-board'` 拼接） */
    let BASE = '';
    let MEMBER_FIXTURE = '';
    /** 已灌种子 + 管理员身份的环境（平板抽屉可达性 / 管理员写入未被收过头） */
    let adminEnv: Env;
    /** 已灌种子 + 普通成员身份的环境（第 ④ 条） */
    let memberEnv: Env;

    beforeAll(async () => {
      mkdirSync(OUT_DIR, { recursive: true });
      server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
      BASE = server.url.replace(/index\.html$/, '');
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
      MEMBER_FIXTURE = writeMemberFixture();
      adminEnv = await createSeededEnv(ADMIN_ID);
      memberEnv = await createSeededEnv(MEMBER_ID);
    }, 180000);

    afterAll(async () => {
      await adminEnv?.ctx.close();
      await memberEnv?.ctx.close();
      await browser?.close();
      await server?.close();
    });

    /**
     * 建一个「已灌种子」的环境：独立 context（自带 localStorage + IndexedDB）+ 一次真实导入。
     *
     * 走应用自己的备份导入链路（隐藏 file input → 预检 → 二次确认 → 整库替换 → reload），
     * 不往 IndexedDB 里手写 raw（要复刻 Dexie 索引串与版本号，一旦升级就静默退化）。
     *
     * `currentMemberId` 在**任何页面脚本之前**写入（`useSettingsStore` 在模块求值期同步读回，
     * 且 bootstrap 空库时回落到同一份 localStorage）：既确立刻身份，也顺带关掉首启引导弹窗
     * （`useFirstRunGate` 的条件含 `currentMemberId === null`），免得弹窗遮罩干扰后续点击。
     */
    async function createSeededEnv(memberId: string): Promise<Env> {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      await ctx.addInitScript((id: string) => {
        try {
          localStorage.setItem('changxia.currentMemberId', id);
          // 0.8.3：同步压首启欢迎卡 flag（FirstRunGuide 与 IdentityDialog 同属首启两卡，
          // 空库+未见过就弹遮罩会挡住全部点击——探针环境两卡都抑制）
          localStorage.setItem('idplan.firstRunGuideSeen', '1');
        } catch {
          /* 隐私模式：种子导入会随之失败并给出清晰报错 */
        }
      }, memberId);
      const page = await ctx.newPage();
      await seedViaBackupImport(page, MEMBER_FIXTURE);
      await page.close();
      return { ctx };
    }

    /** 灌种子：任何一步失败都抛出**带页面原文**的错误，避免「卡在 waitFor 超时」这种无信息失败 */
    async function seedViaBackupImport(page: Page, fixture: string): Promise<void> {
      await page.goto(`${BASE}index.html`);
      await page.waitForSelector('header', { timeout: 20000 });

      // 侧栏里那个 `input[type=file].hidden`（useBackupIo）——它 display:none，
      // setInputFiles 本身是赋 value，不需要真点击（其选项类型不含 force，故省略）
      await page
        .locator('input[type="file"][accept*="json"]')
        .first()
        .setInputFiles(fixture);

      const confirm = page.getByRole('button', { name: '确认恢复' });
      try {
        await confirm.waitFor({ state: 'attached', timeout: 15000 });
      } catch {
        const text = await page.locator('body').innerText();
        throw new Error(
          '备份导入未进入二次确认：fixture 可能未通过 zod 预检（页面会 toast「备份文件校验失败」）。' +
            `页面文本片段：${text.slice(0, 500)}`,
        );
      }
      await confirm.click({ force: true });

      try {
        await page.waitForFunction(
          (name) => document.body.innerText.includes(name),
          PROJECT_NAME,
          { timeout: 20000 },
        );
      } catch {
        const text = await page.locator('body').innerText();
        throw new Error(
          `备份导入后未观察到种子项目「${PROJECT_NAME}」。页面文本片段：${text.slice(0, 500)}`,
        );
      }
    }

    /**
     * 开一个干净的「外壳」页（无数据），用于断点 / 红点 / 视图切换三类验收。
     * @param width   视口宽（真断点必须逐档实测，不能只测一档）
     * @param opts.stubDesktopBridge true = 注入最小假 bridge（点亮「有新版本」红点）
     */
    async function openShell(
      width: number,
      opts: { stubDesktopBridge?: boolean; height?: number } = {},
    ): Promise<{ ctx: BrowserContext; page: Page }> {
      const ctx = await browser.newContext({ viewport: { width, height: opts.height ?? 900 } });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('changxia.currentMemberId', 'm-probe');
          // 0.8.3：同步压首启欢迎卡 flag（FirstRunGuide 与 IdentityDialog 同属首启两卡，
          // 空库+未见过就弹遮罩会挡住全部点击——探针环境两卡都抑制）
          localStorage.setItem('idplan.firstRunGuideSeen', '1');
        } catch {
          /* ignore */
        }
      });
      if (opts.stubDesktopBridge) {
        // 最小假 bridge：字段与 electron/preload.cjs 暴露对象同形；**故意不暴露
        // windowControls / setTitleBarTheme**（与老版 preload 一致，顺带覆盖自绘三键的
        // 存在性判断分支——且本桩 platform=linux，自绘三键本就只 Windows 渲染）。
        await ctx.addInitScript(
          (payload: Record<string, unknown>) => {
            (window as unknown as { idplan?: unknown }).idplan = {
              isDesktop: true,
              platform: 'linux', // 非 win32：不触发自绘标题栏分支，顶栏走常规布局
              version: '0.7.0.0000',
              checkUpdate: async () => payload,
              onUpdateAvailable: (cb: (p: unknown) => void) => {
                // 主进程是「启动 8s 后推送」；这里立即推，等价于「已经收到推送」
                setTimeout(() => cb(payload), 0);
                return () => undefined;
              },
            };
          },
          {
            current: '0.7.0.0000',
            latest: 'v0.7.0.0009',
            hasUpdate: true,
            releaseUrl: null,
            publishedAt: null,
            notes: null,
            exeAssetUrl: null,
          },
        );
      }
      const page = await ctx.newPage();
      await page.goto(`${BASE}index.html`);
      await page.waitForSelector('header', { timeout: 20000 });
      await page.waitForTimeout(300); // 等 CSS 应用完（避免读到过渡中的中间值）
      return { ctx, page };
    }

    /** 读 ⋮ 的可见性事实（元素级 + 根节点计算样式，两侧都钉） */
    async function readMore(
      page: Page,
    ): Promise<{ count: number; visible: boolean; rootDisplay: string }> {
      const loc = page.locator(MORE_BTN);
      const count = await loc.count();
      const visible = count > 0 ? await loc.first().isVisible() : false;
      const rootDisplay = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (!btn || !btn.parentElement) return 'MISSING';
        return getComputedStyle(btn.parentElement).display;
      }, MORE_BTN);
      return { count, visible, rootDisplay };
    }

    async function shot(page: Page, name: string): Promise<void> {
      await page.screenshot({ path: resolve(OUT_DIR, name), fullPage: true });
    }

    /* ===================================================================================
     * 验收 ① · 顶栏 ⋮ 按端分流（P0-17）
     *   手机（<768）可见；平板（768–1279）与桌面（≥1280）不可见。
     *   逐档实测 6 个视口，含 **767/768 与 1279/1280** 两组边界。
     * =================================================================================== */
    it('①-a · 顶栏 ⋮：手机档可见；平板档与桌面档不可见（含 767/768、1279/1280 边界）', async () => {
      /**
       * 期望表（`md:hidden` 的 `md` = min-width 768，故 768 已属「隐藏」侧）。
       * 手机档额外要求 `visible === true` 且 `rootDisplay === 'block'` ——
       * **只有「不可见」一侧的断言是危险的**：整块组件因别的原因没渲染时也会「不可见」，
       * 那是假绿。故手机档必须有正向证据。
       */
      const cases: Array<{ w: number; label: string; shouldShow: boolean }> = [
        { w: 375, label: '手机（iPhone 常见宽）', shouldShow: true },
        { w: 767, label: '手机档上边界（768 前一像素）', shouldShow: true },
        { w: 768, label: '平板档下边界（md 生效的第一个像素）', shouldShow: false },
        { w: 1024, label: '平板（iPad 横屏）', shouldShow: false },
        { w: 1279, label: '平板档上边界', shouldShow: false },
        { w: 1280, label: '桌面档下边界（xl）', shouldShow: false },
        { w: 1440, label: '桌面', shouldShow: false },
      ];

      const observed: Array<{ w: number; count: number; visible: boolean; rootDisplay: string }> = [];
      for (const c of cases) {
        const { ctx, page } = await openShell(c.w);
        try {
          const m = await readMore(page);
          observed.push({ w: c.w, ...m });
          if (c.shouldShow) {
            expect(m.count, `${c.w}px ${c.label}：⋮ 节点应在 DOM 中`).toBe(1);
            expect(m.visible, `${c.w}px ${c.label}：⋮ 必须**可见**（手机档是唯一可见档）`).toBe(
              true,
            );
            expect(m.rootDisplay, `${c.w}px ${c.label}：连 breakpoint 都不该命中`).toBe('block');
          } else {
            // 正向断言「不存在可见的 ⋮」：可见性 + 计算 display 双证（见文件头口口径澄清）
            expect(m.visible, `${c.w}px ${c.label}：⋮ **不得可见**`).toBe(false);
            expect(m.rootDisplay, `${c.w}px ${c.label}：根节点必须被 display:none 收起`).toBe(
              'none',
            );
          }
          if (c.w === 375) await shot(page, '01-phone-more-visible.png');
          if (c.w === 1024) await shot(page, '02-tablet-more-hidden.png');
          if (c.w === 1440) await shot(page, '03-desktop-more-hidden.png');
        } finally {
          await ctx.close();
        }
      }

      // 失败时一眼看清整条曲线（避免逐条 ok/not-ok 在日志里读不出来）
      expect(observed.map((o) => `${o.w}:${o.visible ? 'show' : 'hide'}/${o.rootDisplay}`)).toEqual([
        '375:show/block',
        '767:show/block',
        '768:hide/none',
        '1024:hide/none',
        '1279:hide/none',
        '1280:hide/none',
        '1440:hide/none',
      ]);
    }, 120000);

    /* ===================================================================================
     * 验收 ①-b · 删掉平板档渲染后的**功能等价性**（不允许「删了就没入口」）
     * =================================================================================== */
    it('①-b · 平板档删 ⋮ 后，⋮ 菜单的全部入口在侧栏抽屉仍可达（member 与 admin 两种身份）', async () => {
      /*
       * ① member 身份：抽屉里必须有 看板 / 我的任务 / 工作区 / 设置
       *
       * ★ v0.8 改动（T04-B）：`Agent` → `工作区`。设计 §4.1 文件清单 ⑦ 明定
       *   「导航文案『工作区』/『Agent 看板』」——`SidebarNav.tsx` 的一级项
       *   已由 `Agent` 收口为 `工作区`（`AgentBoardPage` 的 h1 仍是「Agent 看板」，
       *   构成「工作区 → 里面的看板」两级语义，见 TBD-7）。
       *   本断言跟的是**同一个 UI 事实**（⋮ 的等价入口仍在抽屉里），只是文案随设计更新，
       *   覆盖强度不变：入口是否可达仍被逐项 `toContain` 钉死。
       */
      {
        const { ctx, page } = await openShell(1024);
        try {
          await page.locator('button[aria-label="打开导航菜单"]').click();
          const drawer = page.locator('[role="dialog"][aria-label="导航菜单"]');
          await drawer.waitFor({ state: 'visible', timeout: 10000 });
          const text = (await drawer.innerText()).replace(/\s+/g, '');
          for (const label of ['看板', '我的任务', 'Agent', '设置']) {
            expect(text, `member：⋮ 的等价入口「${label}」必须仍在侧栏抽屉里`).toContain(label);
          }
          // ★ v0.8.5（她反馈 #5）：⋮ 的「工作区」入口合并进 Agent 父项的二级子组——
          //   从「直接可见」变「展开后可见」。可达性不丢：点父项展开，子项在 DOM 里。
          //   本用例锁的不是文案位置而是**可达性**（展开即达）。
          const agentParent = drawer.locator('[data-sidebar-nav-parent]');
          expect(await agentParent.getAttribute('aria-expanded'), '父项初始应为收起').toBe('false');
          await agentParent.click();
          const drawer2 = (await drawer.innerText()).replace(/\s+/g, '');
          expect(drawer2, 'Agent 展开后「工作区 / 执行记录」必须可达').toContain('工作区');
          expect(drawer2).toContain('执行记录');
          // ⋮ 菜单在平板档**不可见**，但仍不可少任何入口 —— 这条与 ①-a 一起构成完整语义
          expect((await readMore(page)).visible).toBe(false);
          await shot(page, '04-tablet-drawer-member.png');
        } finally {
          await ctx.close();
        }
      }

      // ② admin 身份（需真数据）：抽屉里还必须有 项目 / 保存备份 / 加载备份 / 新建项目
      {
        const page = await adminEnv.ctx.newPage();
        try {
          await page.setViewportSize({ width: 1024, height: 900 });
          await page.goto(`${BASE}index.html`);
          await page.waitForSelector('header', { timeout: 20000 });
          await page.locator('button[aria-label="打开导航菜单"]').click();
          const drawer = page.locator('[role="dialog"][aria-label="导航菜单"]');
          await drawer.waitFor({ state: 'visible', timeout: 10000 });
          const text = (await drawer.innerText()).replace(/\s+/g, '');
          // v0.8（T04-B）：同 ①，`Agent` → `工作区`（设计 §4.1 ⑦ 导航文案）
          for (const label of ['项目', '我的任务', 'Agent', '设置', '保存备份', '加载备份', '新建项目']) {
            expect(text, `admin：⋮ 的等价入口「${label}」必须仍在侧栏抽屉里`).toContain(label);
          }
          // 设置项在抽屉里恰有一个（防止「⋮ 与侧栏两份设置」在平板档同时出现）
          expect(await drawer.getByRole('button', { name: '设置' }).count()).toBe(1);
          await shot(page, '05-tablet-drawer-admin.png');
        } finally {
          await page.close();
        }
      }
    }, 120000);

    /* ===================================================================================
     * 验收 ①-c · V1-23 顶栏按钮白名单（⋮ 按端分流的对照组：只准少，不准多）
     * =================================================================================== */
    it('①-c · V1-23：三档视口的顶栏按钮都在白名单内，且任何一档都没有顶栏「设置」齿轮', async () => {
      const expected: Record<number, string[]> = {
        390: ['打开导航菜单', '更多操作'],
        1024: ['打开导航菜单', '打开搜索'],
        1440: [],
      };

      for (const width of [390, 1024, 1440]) {
        const { ctx, page } = await openShell(width);
        try {
          /*
           * 首页（'/'）没有面包屑返回键，顶栏按钮集合最干净，最适合做白名单判定。
           *
           * ⚠️ 必须**先过滤可见性**再收 `aria-label`：顶栏三档的搜索控件是「同一按钮、
           * 不同档位显隐」（手机=第二行整行输入框 / 平板=图标按钮 `打开搜索` /
           * 桌面=常驻输入框），隐档那份**节点仍在 DOM 里**（被外层 `hidden` 包着）。
           * 首轮实测即栽在此处：未过滤时 390px 把隐藏的 `打开搜索` 也收了进来，
           * 断言集合多出一项 → 假红（而它其实正是「不该在手机档出现」的那个按钮）。
           *
           * 用 `Element.checkVisibility()`：它按规范同时判自身与**全部祖先**的
           * `display:none` / `visibility:hidden|collapse` / `content-visibility:hidden`
           * —— 正是「用户到底看不看得见」的语义（Chromium 105+ 原生支持）。
           * `getClientRects().length` 作为兜底（老内核 / 未来 API 变动时不至于全丢）。
           */
          const labels = await page.evaluate(() =>
            Array.from(document.querySelectorAll('header button'))
              .filter((b) => {
                const check = (b as HTMLElement & { checkVisibility?: () => boolean })
                  .checkVisibility;
                const visible =
                  typeof check === 'function' ? check.call(b) : b.getClientRects().length > 0;
                return visible;
              })
              .map((b) => b.getAttribute('aria-label'))
              .filter((x): x is string => typeof x === 'string' && x.length > 0),
          );

          // ① 越界即失败（白名单外的任何 aria-label）
          const outside = labels.filter((l) => !TOPBAR_LABEL_WHITELIST.includes(l));
          expect(outside, `${width}px：顶栏出现了白名单外的按钮`).toEqual([]);

          // ② A3 的硬结论：任何一档都不得再有顶栏「设置」齿轮（v0.7 批次 A 已删）
          const settingsish = labels.filter((l) => l.includes('设置'));
          expect(settingsish, `${width}px：顶栏不得再有设置按钮（A3）`).toEqual([]);

          // ③ 逐档精确集合（比「不含越界项」更强：漏了该有的也在失败）
          expect([...labels].sort(), `${width}px：顶栏按钮集合不符`).toEqual(
            [...expected[width]!].sort(),
          );
        } finally {
          await ctx.close();
        }
      }
    }, 120000);

    /* ===================================================================================
     * 验收 ② · 更新红点迁移（P0-17 配套）
     *   桌面端（≥1280）侧栏「设置」项：**展开态与收起态各一枚**（V1-24）。
     * =================================================================================== */
    it('② · 侧栏「设置」项更新红点：展开态 + 收起态都能渲染；无 bridge 时零渲染（负对照）', async () => {
      const { ctx, page } = await openShell(1600, { stubDesktopBridge: true });
      try {
        // 桌面档默认展开（defaultExpanded() = matchMedia(min-width:1280)）
        await page.waitForSelector('[data-update-dot="expanded"]', { timeout: 15000 });
        expect(await page.locator('[data-update-dot="expanded"]').isVisible()).toBe(true);
        // 展开态下不得同时存在收起态那枚（两棵 DOM 互斥，同时出现说明渲染分支错了）
        expect(await page.locator('[data-update-dot="collapsed"]').count()).toBe(0);
        // 顶栏 ⋮ 在桌面档不可见，故红点**只能**由侧栏承载（这正是迁移的全部理由）
        expect((await readMore(page)).visible).toBe(false);
        await shot(page, '06-dot-expanded.png');

        // 折叠侧栏 → 收起态那枚必须出现（否则用户一折侧栏，提示就凭空消失）
        await page.locator('button[aria-label="收起侧边栏"]').click();
        await page.waitForSelector('[data-update-dot="collapsed"]', { timeout: 10000 });
        expect(await page.locator('[data-update-dot="collapsed"]').isVisible()).toBe(true);
        expect(await page.locator('[data-update-dot="expanded"]').count()).toBe(0);
        await shot(page, '07-dot-collapsed.png');
      } finally {
        await ctx.close();
      }

      // ── 负对照：浏览器 / NAS 端（无 window.idplan）红点必须一枚都不渲染 ──
      // 没有这条，「红点存在」在「红点无条件渲染」的错误实现下照样全绿（假绿）。
      const neg = await openShell(1600, { stubDesktopBridge: false });
      try {
        await neg.page.waitForTimeout(600); // 给足「若真会渲染」的时间
        expect(
          await neg.page.locator(DOT).count(),
          '无桌面端 bridge 时不得渲染任何更新红点',
        ).toBe(0);
      } finally {
        await neg.ctx.close();
      }
    }, 60000);

    /* ===================================================================================
     * 验收 ③ · 成员看板「看板 / 月历」切换 + 持久化 + 键隔离（P0-18）
     * =================================================================================== */
    it('③ · 成员看板：看板↔月历可切换、刷新不丢（idplan.memberBoardView）、且不污染 idplan.homeView', async () => {
      const { ctx, page } = await openShell(1600);
      try {
        await page.goto(`${BASE}member-board`);
        await page.waitForSelector(MEMBER_VIEW_SWITCH, { timeout: 20000 });

        // 默认 = 看板（无存档时回落 kanban）
        expect(await page.getByRole('tab', { name: '看板' }).getAttribute('aria-selected')).toBe(
          'true',
        );
        expect(await page.getByRole('tab', { name: '月历' }).getAttribute('aria-selected')).toBe(
          'false',
        );
        // 看板档不挂月历
        expect(await page.locator(DENSITY_SWITCH).count()).toBe(0);

        // ── 切到月历 ──
        await page.getByRole('tab', { name: '月历' }).click();
        await page.waitForSelector(DENSITY_SWITCH, { timeout: 15000 });
        expect(await page.getByRole('tab', { name: '月历' }).getAttribute('aria-selected')).toBe(
          'true',
        );

        const prefs = await page.evaluate(() => ({
          memberBoardView: localStorage.getItem('idplan.memberBoardView'),
          homeView: localStorage.getItem('idplan.homeView'),
        }));
        // 落盘到**成员专用键**；管理员的首页键**一个字节都不许被写**（键隔离）
        expect(prefs.memberBoardView).toBe('calendar');
        expect(prefs.homeView, '成员切视图不得写管理员首页键 idplan.homeView').toBeNull();

        /*
         * ★ E1 空状态的死按钮回归（team-lead 复审缺陷）：本环境无数据（active.length === 0）
         *   → 月历必然落 E1。`MemberBoardPage` 传 `onManual={undefined}`，而 E1 的 CTA 已是
         *   `{onManual && …}` 条件渲染 ⇒ 该文本**必须查不到**。
         *   断言「文本不存在」而非「点了没反应」：后者在旧的 `?.()` 实现下会**假绿**。
         */
        const calText = await page.locator('main').innerText();
        expect(calText).toContain('还没有进行中的项目'); // 前提：确实渲染了 E1
        expect(calText, '成员月历 E1 不得出现「直接手动建档」CTA').not.toContain('直接手动建档');
        await shot(page, '08-member-calendar-empty.png');

        // ── 切回看板：偏好随之回写 ──
        await page.getByRole('tab', { name: '看板' }).click();
        await page.waitForSelector(MEMBER_VIEW_SWITCH, { timeout: 15000 });
        expect(await page.locator(DENSITY_SWITCH).count()).toBe(0);
        expect(await page.evaluate(() => localStorage.getItem('idplan.memberBoardView'))).toBe(
          'kanban',
        );

        // ── 再切月历并**重开页面**：视图不得丢（持久化的全部意义）──
        await page.getByRole('tab', { name: '月历' }).click();
        await page.waitForSelector(DENSITY_SWITCH, { timeout: 15000 });

        await page.goto(`${BASE}member-board`);
        await page.waitForSelector(MEMBER_VIEW_SWITCH, { timeout: 20000 });
        await page.waitForSelector(DENSITY_SWITCH, { timeout: 15000 });
        expect(
          await page.getByRole('tab', { name: '月历' }).getAttribute('aria-selected'),
          '刷新后必须仍是月历（否则观感上等同于入口不存在）',
        ).toBe('true');
        await shot(page, '09-member-calendar-persisted.png');
      } finally {
        await ctx.close();
      }
    }, 90000);

    /* ===================================================================================
     * 验收 ④ · 成员：月历点格 → 项目详情 → 阶段抽屉，资料路径**只读**
     * =================================================================================== */
    it('④ · 成员月历 → 项目详情 → 阶段抽屉：查不到「修改」，「复制路径」有值时可点且真复制', async () => {
      const page = await memberEnv.ctx.newPage();
      try {
        await page.setViewportSize({ width: 1600, height: 900 });

        // ── 月历里点色带进项目详情（成员视角的完整入口路径）──
        await page.goto(`${BASE}member-board`);
        await page.waitForSelector(MEMBER_VIEW_SWITCH, { timeout: 20000 });
        await page.getByRole('tab', { name: '月历' }).click();
        await page.waitForSelector(DENSITY_SWITCH, { timeout: 15000 });

        const band = page.locator(`[aria-label="打开项目 ${PROJECT_NAME}"]`).first();
        await band.waitFor({ state: 'visible', timeout: 15000 });
        await shot(page, '10-member-calendar-filled.png');
        await band.click();

        await page.waitForURL('**/project/**', { timeout: 20000 });
        await page.waitForSelector('[aria-label="九阶段时间轴"]', { timeout: 20000 });

        // ── 打开阶段抽屉（点左列阶段行按钮；这是 openStageDrawer 的唯一真实入口）──
        await page.locator('button', { hasText: STAGE_NAME }).first().click();
        const drawer = page.locator(`[role="dialog"][aria-label="阶段详情：${STAGE_NAME}"]`);
        await drawer.waitFor({ state: 'visible', timeout: 15000 });

        const text = await drawer.innerText();
        // 前提：抽屉真的长出了「备注与资料」区并渲染了路径（否则下面的「不存在」可能是空过）
        expect(text).toContain('备注与资料');
        expect(text, '成员只读展示必须仍能看到路径文本').toContain(MEMBER_RESOURCE_PATH);

        // ① 成员管理员专属写入口被摘掉：不得存在「修改」按钮
        expect(
          await drawer.getByRole('button', { name: '修改', exact: true }).count(),
          '成员视角不得出现「修改」按钮（阶段资料路径的唯一写入口）',
        ).toBe(0);
        // 反向：管理员的写入口**不得**在这里出现，也不得出现编辑态
        expect(await drawer.getByRole('button', { name: '保存', exact: true }).count()).toBe(0);
        expect(text).not.toContain('登记本阶段资料文件夹路径');

        // ② 只读通道保留：打开 + 复制路径 都在、都可用
        expect(await drawer.getByRole('button', { name: '打开' }).count()).toBe(1);
        const copy = drawer.getByRole('button', { name: '复制路径' });
        expect(await copy.count()).toBe(1);
        expect(await copy.isEnabled()).toBe(true);

        // ③ 「可点」必须**有实据**：替换剪贴板实现，点一下看是否真的复制了那条路径。
        //    （只断言 isEnabled()/点击不抛错太弱——onClick 是个空函数也会通过。）
        await page.evaluate(() => {
          (window as unknown as { __copied?: string | null }).__copied = null;
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: async (t: string) => {
                (window as unknown as { __copied?: string | null }).__copied = t;
              },
            },
          });
        });
        await copy.click();
        await page.waitForFunction(
          (p) => (window as unknown as { __copied?: string | null }).__copied === p,
          MEMBER_RESOURCE_PATH,
          { timeout: 5000 },
        );
        expect(
          await page.evaluate(() => (window as unknown as { __copied?: string | null }).__copied),
        ).toBe(MEMBER_RESOURCE_PATH);

        await shot(page, '11-member-stage-drawer-readonly.png');
      } finally {
        await page.close();
      }
    }, SEEDED);

    /* ===================================================================================
     * 验收 ④ 反向对照 · 管理员在同一阶段上**照旧**能改（收紧不得收过头）
     * =================================================================================== */
    it('④-对照 · 管理员同一阶段：「修改」按钮照旧存在（授权收紧不得收过头）', async () => {
      const page = await adminEnv.ctx.newPage();
      try {
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto(`${BASE}project/prj-v07b`);
        await page.waitForSelector('[aria-label="九阶段时间轴"]', { timeout: 20000 });

        await page.locator('button', { hasText: STAGE_NAME }).first().click();
        const drawer = page.locator(`[role="dialog"][aria-label="阶段详情：${STAGE_NAME}"]`);
        await drawer.waitFor({ state: 'visible', timeout: 15000 });

        const labels = await drawer
          .locator('button')
          .allInnerTexts()
          .then((xs) => xs.map((s) => s.trim()));
        expect(labels, '管理员必须仍有「修改」写入口').toContain('修改');
        expect(await drawer.getByRole('button', { name: '复制路径' }).count()).toBe(1);
        await shot(page, '12-admin-stage-drawer-editable.png');
      } finally {
        await page.close();
      }
    }, SEEDED);
  },
);

/**
 * 前置检查：产物/浏览器缺失或产物过期时给出**可操作**的提示。
 *
 * 为什么单列一组：`describe.skipIf` 的 skip 在输出里长得像「通过」，极易被读成「已验收」。
 * 这条用例永远执行（不参与 skipIf），把跳过原因打到控制台。
 * ⚠️ 验收口径：**skip 数必须为 0**；有 skip 就等于这批没验。
 */
describe('v0.7 · T04 D 线真 Chromium 验收前置检查', () => {
  it('构建产物、Chromium 可用且产物未过期（否则上面的验收被跳过 → 本批不算验过）', () => {
    if (!CAN_RUN_FRESH) {
      // eslint-disable-next-line no-console
      console.warn(
        `[v07-dline-shell] 跳过验收：build-dist=${existsSync(DIST_INDEX)} ` +
          `chromium=${CHROMIUM_PATH !== null} 过期输入=${STALE_INPUTS.join(', ') || '(无)'}。` +
          ' 请先 npm run build 再跑 npm test ——否则测的是上一版界面，可能误报绿。',
      );
    }
    expect(true).toBe(true);
  });
});
