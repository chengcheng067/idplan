/**
 * ID Plan · Windows 实机走查（Electron 原生层自动化）
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 这个脚本解决什么问题
 * ════════════════════════════════════════════════════════════════════════════
 * 项目里长期记着一条假设：「Electron 原生层无法自动化验证，只能装包人工目检」。
 * 实测证明**这条假设是错的**：`playwright-core` 自带 `_electron`，可以驱动真实
 * Electron 进程，并从主进程侧读窗口状态、从渲染进程侧读 DOM。
 *
 * 但**能力边界必须说清**（否则会用它去验不该验的东西）：
 *   ✅ 能自动验：启动链路 / preload 桥 / 窗口几何与最小尺寸 / 断点↔叠加层高度
 *      一致性 / 主题换肤的配色下发 / 单实例锁 / 外链不劫持 / 生产下无应用菜单
 *   ❌ 不能自动验：原生三键（最小化/最大化/关闭）的指针悬停态与 Windows 主题
 *      下的实际绘制、真窗口拖拽手感、NSIS 安装向导、安装后快捷方式与卸载。
 *      ⚠️ 尤其注意：Electron 44 **没有 `win.getTitleBarOverlay()`**
 *      （实测 `typeof` 为 undefined），所以「叠加层当前是什么颜色」读不到——
 *      只能通过 hook `setTitleBarOverlay` 记录**入参**来间接验证。本脚本就是这么做的。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ 运行前必读：本机有一枚环境变量会静默毁掉一切
 * ════════════════════════════════════════════════════════════════════════════
 * 本机（agent shell）预设 `ELECTRON_RUN_AS_NODE=1`。它让 electron.exe **以纯 Node 运行**：
 *   - `--version` 打印内嵌 Node 版本（v24.19.0）而非 Electron 版本（v44.1.0）
 *   - `require('electron')` 不返回 electron API（`ipcMain` 为 undefined）
 *   - 于是 playwright 的 _electron 协商失败，报含糊的 "Process failed to launch!"
 *
 * 实测判据（同一二进制，只差这一个变量）：
 *   ELECTRON_RUN_AS_NODE=1 electron.exe --version       → v24.19.0   ← 假象
 *   env -u ELECTRON_RUN_AS_NODE electron.exe --version  → v44.1.0   ← 真相
 * 而该 exe 与官方缓存 `electron-v44.1.0-win32-x64.zip` 内的 electron.exe
 * **sha256 逐字节相同**，故二进制无损坏 —— 千万不要据此断定「安装包坏了」。
 * 本脚本已在 launch 时自动剔除该变量（见 cleanEnv）。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 用法
 * ════════════════════════════════════════════════════════════════════════════
 *   node scripts/electron-walkthrough.mjs                  # 跑源码树（node_modules 的 electron）
 *   node scripts/electron-walkthrough.mjs --packed         # 跑打包产物（release-代号/win-unpacked）
 *   node scripts/electron-walkthrough.mjs --shots DIR      # 指定截图目录
 *
 * 前置：`npm run build` 已跑过（存在 build-dist/index.html）；
 *       `--packed` 还需先出过一次 `electron-builder --dir`。
 * 退出码：0 = 全部通过；1 = 有失败项（会逐条打印原因）。
 */
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const DIST_INDEX = join(ROOT, 'build-dist', 'index.html');
const ARGS = process.argv.slice(2);
const USE_PACKED = ARGS.includes('--packed');
const shotsIdx = ARGS.indexOf('--shots');
const SHOTS = shotsIdx >= 0 && ARGS[shotsIdx + 1]
  ? resolve(ARGS[shotsIdx + 1])
  : join(ROOT, 'tmp', 'win-walkthrough');

/** 本项目的 xl 断点（与 tailwind.config.ts 的 screens.xl 严格一致，不得引入 lg=1024） */
const XL_MIN_WIDTH = 1280;
/** TopBar `h-14` */
const TOPBAR_COMPACT = 56;
/** TopBar `xl:h-16` */
const TOPBAR_DESKTOP = 64;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'WARN';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 定位打包产物里的 exe（取最新的 release-代号/win-unpacked） */
function findPackedExe() {
  const dirs = readdirSync(ROOT)
    .filter((n) => n.startsWith('release') && !n.endsWith('.exe'))
    .sort()
    .reverse();
  for (const d of dirs) {
    const unpacked = join(ROOT, d, 'win-unpacked');
    if (!existsSync(unpacked)) continue;
    const exe = readdirSync(unpacked).find((f) => f.endsWith('.exe') && !f.includes('uninstall'));
    if (exe) return { exe: join(unpacked, exe), dir: d };
  }
  return null;
}

/** 主进程侧：hook setTitleBarOverlay 以记录入参（Electron 44 无 getTitleBarOverlay） */
async function hookOverlay(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return 'no-window';
    if (typeof w.setTitleBarOverlay !== 'function') return 'no-api';
    globalThis.__overlayCalls = [];
    const orig = w.setTitleBarOverlay.bind(w);
    w.setTitleBarOverlay = (opts) => {
      globalThis.__overlayCalls.push({ ...opts, t: Date.now() });
      try {
        return orig(opts);
      } catch (e) {
        globalThis.__overlayCalls.push({ __error: String(e && e.message) });
      }
    };
    return 'hooked';
  });
}

/** 主进程侧：读已记录的叠加层入参 */
async function readOverlayCalls(app) {
  return app.evaluate(() => globalThis.__overlayCalls ?? []);
}

/** 渲染进程侧：读 TopBar 的实际高度 + 主题 */
async function readTopBar(win) {
  return win.evaluate(() => {
    const bar = document.querySelector('header');
    const h = bar ? Math.round(bar.getBoundingClientRect().height) : null;
    return {
      headerHeight: h,
      innerWidth: window.innerWidth,
      theme: document.documentElement.getAttribute('data-theme'),
      paperRgb: getComputedStyle(document.documentElement).getPropertyValue('--paper-rgb').trim(),
    };
  });
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    console.error(`✗ 缺少构建产物 ${DIST_INDEX}，请先 npm run build`);
    process.exit(2);
  }
  mkdirSync(SHOTS, { recursive: true });

  const packed = USE_PACKED ? findPackedExe() : null;
  if (USE_PACKED && !packed) {
    console.error('✗ 未找到 release-*/win-unpacked/*.exe，请先 electron-builder --dir');
    process.exit(2);
  }
  const execPath = packed ? packed.exe : electronPath;
  const args = packed ? [] : ['.'];

  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  console.log(`\n═══ ID Plan Windows 走查 ═══`);
  console.log(`目标：${packed ? `打包产物 ${packed.dir}` : '源码树（node_modules electron）'}`);
  console.log(`exe ：${execPath}`);
  console.log(`截图：${SHOTS}\n`);

  let app;
  const t0 = Date.now();
  try {
    app = await electron.launch({ executablePath: execPath, args, cwd: ROOT, env: cleanEnv, timeout: 30000 });
    record('1. 应用启动', true, `${Date.now() - t0}ms`);

    const win = await app.firstWindow({ timeout: 30000 });
    await win.waitForLoadState('domcontentloaded').catch(() => {});

    // ── 2. 启动链路：自定义协议 + 首屏非白屏 ──────────────────────────────
    const url = win.url();
    record('2a. 加载走自定义协议 app://', url.startsWith('app://'), url);
    const title = await win.title();
    record('2b. 窗口标题', typeof title === 'string' && title.length > 0, title);
    const bodyKids = await win.evaluate(() => document.body.children.length);
    record('2c. 首屏已渲染（非白屏）', bodyKids > 0, `body 子元素 ${bodyKids} 个`);

    // ── 3. preload 桥（contextIsolation 下唯一通路） ──────────────────────
    const bridge = await win.evaluate(() => ({
      has: typeof window.idplan === 'object' && window.idplan !== null,
      isDesktop: window.idplan?.isDesktop ?? null,
      version: window.idplan?.version ?? null,
      platform: window.idplan?.platform ?? null,
    }));
    record('3a. window.idplan 桥已注入', bridge.has === true);
    record('3b. isDesktop 为 true', bridge.isDesktop === true);
    record('3c. version 非空（走 additionalArguments 注入）', !!bridge.version, `version=${bridge.version}`);
    // 版本号必须与 version.json 一致（这是「装上去的确实是这次构建」的关键判据）
    let verJson = null;
    try {
      verJson = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8')).version;
    } catch { /* version.json 缺失时该断言自然失败 */ }
    record('3d. 版本号与 version.json 一致', !!verJson && bridge.version === verJson,
      `preload=${bridge.version} / version.json=${verJson}`);

    // ── 4. 最小尺寸约束 ───────────────────────────────────────────────────
    const geo = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { bounds: w.getBounds(), minimumSize: w.getMinimumSize(), isMaximized: w.isMaximized() };
    });
    const [minW, minH] = geo.minimumSize;
    record('4a. 最小尺寸符合设计（960×640）', minW === 960 && minH === 640, `minimumSize=[${minW},${minH}]`);
    // 真的尝试缩到比下限更小，看是否被约束（而不是只读配置）
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(600, 400));
    await new Promise((r) => setTimeout(r, 400));
    const afterShrink = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    record('4b. 拖到下限之下被真实约束', afterShrink.width >= minW && afterShrink.height >= minH,
      `请求 600×400 → 实得 ${afterShrink.width}×${afterShrink.height}`);

    // ── 5. ★ 断点 ↔ 叠加层高度一致性（本项目最可能的隐藏 bug 源） ─────────
    // 机制：渲染进程按 window.innerWidth 算高度（<1280→56 / ≥1280→64），
    // 经 preload setTitleBarTheme → 主进程 setTitleBarOverlay。
    // 若 resize 监听缺失，缩窗后原生三键高度不跟随 → 与顶栏内容纵向错位。
    const hookState = await hookOverlay(app);
    record('5a. 已 hook setTitleBarOverlay', hookState === 'hooked', `state=${hookState}`);

    for (const [label, targetW] of [['宽档 1400（≥1280）', 1400], ['窄档 1000（<1280）', 1000], ['宽档 1400 回切', 1400]]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 900), targetW);
      await new Promise((r) => setTimeout(r, 600)); // 等 resize → IPC → 主进程
      const bar = await readTopBar(win);
      const calls = await readOverlayCalls(app);
      const last = calls.length ? calls[calls.length - 1] : null;
      const expectH = bar.innerWidth >= XL_MIN_WIDTH ? TOPBAR_DESKTOP : TOPBAR_COMPACT;
      const okBar = bar.headerHeight === expectH;
      const okOverlay = last && last.height === expectH;
      record(`5b.${label} 顶栏实际高度`, okBar,
        `innerWidth=${bar.innerWidth} → 期望 ${expectH}，实测 ${bar.headerHeight}`);
      record(`5b.${label} 叠加层高度跟随`, !!okOverlay,
        last ? `setTitleBarOverlay.height=${last.height}${last.__error ? ` 抛错:${last.__error}` : ''}` : '未收到任何调用');
    }
    const allCalls = await readOverlayCalls(app);
    record('5c. 叠加层入参含实际计算色（非主进程另起 hex）',
      allCalls.some((c) => typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)),
      allCalls.length ? `${allCalls.length} 次调用，末次 color=${allCalls[allCalls.length - 1].color}` : '无');

    // ── 6. 主题换肤：★ 必须走真实 UI，不能手工 setAttribute ──────────────
    // 为什么不能手工切：syncTitleBarTheme() 只在 useTheme 的 apply() 内被调用
    // （useTheme.ts:67）。直接 `document.documentElement.setAttribute('data-theme','dark')`
    // 只改 DOM、**不触发 apply()** → 主进程收不到通知 → 会误报成「叠加层不跟随主题」。
    // （本脚本第一版就是这么写的，实测红过一次，属测试方法错误而非产品 bug。）
    //
    // 主题切换的**正式入口是设置弹窗**（SettingsDialog 主题区，浅色/深色/跟随系统三键）。
    // 注意：src/components/layout/ThemeToggle.tsx 是**死组件**——它在 src/ 内零引用
    // （grep 除自身外无命中），其注释宣称「放在顶栏最右侧控件簇里」从未落地；
    // 而 v0.7 画板的顶栏恒三项（面包屑/搜索块/头像）本就不含主题按钮，
    // 故「主题只能在设置里切」与设计稿一致，不是缺陷。走查必须按真实入口走。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
    await new Promise((r) => setTimeout(r, 400));

    const settingsBtn = win.locator('button[aria-label="设置"]').first();
    const hasSettings = (await settingsBtn.count()) > 0;
    record('6a. 侧栏底部存在「设置」入口', hasSettings, hasSettings ? 'aria-label="设置"' : '未找到');
    if (hasSettings) await settingsBtn.click();
    await new Promise((r) => setTimeout(r, 600));

    const darkOption = win.getByRole('button', { name: '深色', exact: true }).first();
    const hasDarkOption = (await darkOption.count()) > 0;
    record('6b. 设置弹窗内存在「深色」主题选项', hasDarkOption, hasDarkOption ? '' : '未找到「深色」按钮');

    if (hasDarkOption) {
      const before = await readTopBar(win);
      const callsBefore = (await readOverlayCalls(app)).length;

      await darkOption.click(); // 真实点击：apply('dark') → syncTitleBarTheme()
      await new Promise((r) => setTimeout(r, 900));

      const after = await readTopBar(win);
      const callsAfter = await readOverlayCalls(app);
      const last = callsAfter.length ? callsAfter[callsAfter.length - 1] : null;

      record('6c. 真实点击后主题已切到暗色', after.theme === 'dark', `${before.theme} → ${after.theme}`);
      record('6d. 主题切换后叠加层配色被重新下发', callsAfter.length > callsBefore,
        `setTitleBarOverlay 调用 ${callsBefore} → ${callsAfter.length}`);

      // ★ 最强断言：下发色必须等于**暗色** --paper 的实际值，而不是亮色兜底 #ffffff。
      //   这正是用户最初反馈的「顶栏关闭栏与主题割裂」是否真被修好。
      const paperHex = `#${(after.paperRgb || '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')}`;
      record('6e. 下发色 == 暗色 --paper（消灭「三键区亮 / 顶栏暗」割裂）',
        !!last && last.color === paperHex,
        `--paper-rgb=${after.paperRgb} → 期望 ${paperHex}，实发 ${last ? last.color : '无'}`);

      // 符号色也应跟着换（否则暗底上仍是深色符号，三键看不清）
      record('6f. 符号色随主题变化（非亮色兜底 #1f2937）',
        !!last && last.symbolColor !== '#1f2937',
        `实发 symbolColor=${last ? last.symbolColor : '无'}`);

      // 切回浅色并关窗，给后续截图留亮色基线
      const lightOption = win.getByRole('button', { name: '浅色', exact: true }).first();
      if ((await lightOption.count()) > 0) {
        await lightOption.click();
        await new Promise((r) => setTimeout(r, 700));
      }
      const closeBtn = win.locator('button[aria-label="关闭设置"]').first();
      if ((await closeBtn.count()) > 0) {
        await closeBtn.click();
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // ── 7. 生产形态：无应用菜单 ──────────────────────────────────────────
    const menuState = await app.evaluate(({ Menu }) => (typeof Menu.getApplicationMenu === 'function'
      ? (Menu.getApplicationMenu() === null ? 'null' : 'present')
      : 'no-api'));
    record('7. 生产形态无应用菜单', menuState === 'null' || menuState === 'no-api', `applicationMenu=${menuState}`);

    // ── 8. 截图存档（人工目检的输入） ─────────────────────────────────────
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
    await new Promise((r) => setTimeout(r, 500));
    const shotWide = join(SHOTS, 'window-1400.png');
    writeFileSync(shotWide, await win.screenshot());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760));
    await new Promise((r) => setTimeout(r, 500));
    const shotNarrow = join(SHOTS, 'window-1000.png');
    writeFileSync(shotNarrow, await win.screenshot());
    record('8. 截图已存档（供人工目检三键绘制/悬停/拖拽手感）', existsSync(shotWide) && existsSync(shotNarrow),
      `window-1400.png / window-1000.png`);

    // 顶部条区域特写（三键在右上角，人工看它是否与顶栏同色、有无错位）
    const clip = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    const topShot = join(SHOTS, 'titlebar-zone.png');
    writeFileSync(topShot, await win.screenshot({ clip: { x: Math.max(0, clip.width - 260), y: 0, width: 260, height: 80 } }));
    record('9. 标题栏三键区特写已存档', existsSync(topShot), 'titlebar-zone.png（人工核同色/无错位）');
  } catch (err) {
    record('启动/运行期异常', false, String(err && err.message));
  } finally {
    if (app) await app.close().catch(() => {});
  }

  const failed = results.filter((r) => r.ok === false);
  const passed = results.filter((r) => r.ok === true);
  console.log(`\n═══ 汇总：${passed.length} 通过 / ${failed.length} 失败 / ${results.length} 项 ═══`);
  if (failed.length) {
    console.log('\n失败明细：');
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail ?? ''}`);
  }
  console.log(`\n⚠️ 以下项**必须人工目检**（自动化能力边界）：`);
  console.log(`   · 原生三键（最小化/最大化/关闭）的实际绘制、悬停态、Windows 主题适配`);
  console.log(`   · 真窗口拖拽手感（-webkit-app-region 区域）`);
  console.log(`   · NSIS 安装向导、安装后快捷方式与卸载`);
  console.log(`   截图已存至 ${SHOTS}\n`);
  process.exit(failed.length ? 1 : 0);
}

main();
