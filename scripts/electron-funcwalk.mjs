/**
 * ID Plan · Windows 功能走查（Electron 实机驱动，功能层）
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 这个脚本解决什么问题
 * ══════════════════════════════════════════════════════════════════════════
 * 姊妹脚本 `electron-walkthrough.mjs` 只验「原生层」（窗口几何 / 叠加层高度 /
 * 主题下发 / 单实例锁 / 外链）。本脚本补上「功能层」——也就是纯靠浏览器/NAS
 * 端 **永远测不出来**、只有真实 Electron 进程才暴露的 Windows 行为：
 *
 *   · B1  app:// 子路由 F5 不白屏（SPA 回退是否真的接住了 deep link）
 *   · B2  顶栏拖拽区是否吞掉可点控件（用 elementFromPoint 几何真判据，
 *         不查 className——本项目有过 toContain('rounded-xl') 恒真的先例）
 *   · B3  备份导出下载事件 + 项目名含 Windows 非法字符时是否静默失败
 *   · B4  备份导入 → window.location.reload() 不白屏（导入会清库重建）
 *   · B10 跨重启持久化（暗色 + 侧栏折叠，现有走查只测了实时切换，没测跨重启）
 *   · B12 Control+K 聚焦搜索
 *   · B7  离线更新检测不卡死
 *
 * 这些在浏览器里跑不起来（app:// 协议、window.print 原生对话框、Dexie 用户数据目录
 * 都是 Electron 专属）。这正是「为什么必须实机驱动」。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★ 运行前必读（与 electron-walkthrough.mjs 同源的陷阱）
 * ══════════════════════════════════════════════════════════════════════════
 * 1) 本机 agent shell 预设 `ELECTRON_RUN_AS_NODE=1`，会让 electron.exe 以纯 Node 运行，
 *    playwright `_electron.launch` 报含糊的 "Process failed to launch!"。本脚本在
 *    launch 前自动剔除该变量（见 cleanEnv）。
 * 2) Electron 44 没有 `win.getTitleBarOverlay()`，本脚本不碰它。
 * 3) 任何时刻只跑一个 Electron 实例：应用有单实例锁（main.cjs:329-339），源码树与
 *    打包产物共用同一份 userData，会互相顶掉。B10 跨重启那条务必等第一次完全退出再起。
 *
 * 4) ★★★ userData 隔离（本脚本最重要的安全约束，源于一次真实事故）★★★
 *    本应用源码树与打包产物 **共用同一份 userData** ：`app.getName()` 读 `productName`，
 *    而 userData 目录 = `appData/getName()`，故两者都落在 `%APPDATA%\ID Plan`。
 *    而本脚本的 B4 会 **整库替换**（importAndReplace 走 Dexie 事务清库重建），
 *    若直接用真实 userData，每次走查都等于把开发数据 / 打包版真实备份全清掉。
 *    这是 **实测事故**（上一轮 B4 真的动到了打包版应用的数据），不是理论风险。
 *    故默认给 launch 传 `--user-data-dir` 指向本仓库内的临时目录
 *    `tmp/funcwalk/userdata/<tag>/`（tag = source|packed），所有写操作只落临时目录。
 *    保留 `--use-real-profile` 显式开关（默认关）：开启才会用真实共享 userData——
 *    仅在你需要特意验证「污染真实数据」的回归场景时手动加，走查默认绝不开。
 *
 * 5) 全新 userData 下 **没有任何成员**，应用会走首启闸门 `admin_prompt`
 *    （src/hooks/useFirstRunGate.ts:33）。本脚本不绕过：检测不到管理员时，
 *    走真实 UI 点「我是管理员」→ 输入姓名 → 确认为管理员，把首个管理员建出来。
 *
 * 6) 不测 B5（真实打印对话框会卡死渲染进程）、B8（单实例锁会互扰）、B11（高 DPI 留人工）。
 *    `window.print` 一律在 init script 里替换成置标志位，避免路过打印代码时卡死。
 *
 * 7) ★★★ 真实数据污染断言（机器断言，非人眼）★★★
 *    每次跑完，对比 `%APPDATA%\ID Plan\IndexedDB\` 下全部文件的 mtime 前后是否变化。
 *    隔离生效 → 真实 IndexedDB 未动 → PASS（附前后 mtime 对比）；
 *    隔离失效（如发现真实库被改写）→ FAIL（这正是我们要抓的回归）。
 *
 * 用法：
 *   node scripts/electron-funcwalk.mjs                 # 源码树（node_modules electron），临时 userData 隔离
 *   node scripts/electron-funcwalk.mjs --packed        # 打包产物（release-<代号>/win-unpacked），临时 userData 隔离
 *   node scripts/electron-funcwalk.mjs --shots DIR     # 截图目录
 *   node scripts/electron-funcwalk.mjs --use-real-profile  # 危险：用真实共享 userData（默认关）
 * 退出码：0 = 无 FAIL；1 = 有 FAIL；2 = 环境前置缺失（build-dist 不在）
 */
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());
const DIST_INDEX = join(ROOT, 'build-dist', 'index.html');
const ARGS = process.argv.slice(2);
const USE_PACKED = ARGS.includes('--packed');
// ★ 默认关：只有显式 --use-real-profile 才会用真实共享 userData（%APPDATA%\ID Plan）。
//   开启即放弃隔离，B4 整库替换会直接污染真实开发/打包数据——仅用于刻意验证污染的回归。
const USE_REAL_PROFILE = ARGS.includes('--use-real-profile');
const shotsIdx = ARGS.indexOf('--shots');
const SHOTS = shotsIdx >= 0 && ARGS[shotsIdx + 1]
  ? resolve(ARGS[shotsIdx + 1])
  : join(ROOT, 'tmp', 'funcwalk');

// ★ userData 隔离目录：源码树与打包各一份临时目录，所有读写只落这里，
//   与真实 %APPDATA%\ID Plan 彻底分离（见文件头第 4 条事故说明）。
//   tag 区分 source/packed，避免两种形态互相顶掉单实例锁或残留数据互扰。
const UD_TAG = USE_PACKED ? 'packed' : 'source';
const USER_DATA_DIR = join(ROOT, 'tmp', 'funcwalk', 'userdata', UD_TAG);
// ★ 走查期下载落盘目录（隔离）：用于证明「下载不只是发起，而是真的写出了文件」。
const DL_DIR = join(ROOT, 'tmp', 'funcwalk', 'dl', UD_TAG);

// ★ 真实 IndexedDB 路径：本脚本 B4 若隔离失效就会改写它，是污染断言的监测对象。
const REAL_INDEXEDDB = join(
  process.env.APPDATA || process.env.LOCALAPPDATA || '',
  'ID Plan',
  'IndexedDB',
);

/** 计分：ok=true PASS / false FAIL / 'warn' WARN */
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'WARN';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}
/** 截图存档（每条 FAIL 附一张，供人工核对真实像素） */
async function snap(win, label) {
  if (!win) return;
  try {
    const f = join(SHOTS, `${label}.png`);
    writeFileSync(f, await win.screenshot());
    return f;
  } catch {
    return null;
  }
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

/** 取文件 mtime（用于「装上去的确实是这次构建」的身份证据） */
function mtimeOf(p) {
  try {
    return new Date(statSync(p).mtimeMs).toISOString();
  } catch {
    return '(无法读取)';
  }
}

/**
 * 真实 IndexedDB 的「内容 mtime 指纹」：文件数 + 全部文件里最新的 mtimeMs。
 * 为什么不用目录自身 mtime：部分文件系统下，目录内文件被改写时目录 mtime 不更新，
 * 会漏判污染。故取「所有文件的最大 mtime」作为判据——B4 整库替换一旦落到真实库，
 * 这里必然前移。返回 { count, maxMtimeMs }；目录不存在时 count=0 / maxMtimeMs=0。
 */
function indexedDbMtimeSig() {
  if (!existsSync(REAL_INDEXEDDB)) return { count: 0, maxMtimeMs: 0 };
  let count = 0;
  let maxMtimeMs = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      try {
        if (e.isDirectory()) walk(p);
        else {
          count += 1;
          const m = statSync(p).mtimeMs;
          if (m > maxMtimeMs) maxMtimeMs = m;
        }
      } catch {
        /* 权限/竞态跳过 */
      }
    }
  };
  walk(REAL_INDEXEDDB);
  return { count, maxMtimeMs };
}

/** 最小合法备份包（zod 全量校验口径见 src/core/services/backup.service.ts）：
 *  所有必填项齐备、可选字段靠 .default() 补齐；空数组表也允许。导入会清库重建。 */
function minimalBackupJson() {
  const now = new Date().toISOString();
  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: now },
    data: {
      projects: [
        {
          id: 'p_funcwalk',
          name: '走查导入项目',
          type: 'other',
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          plannedStartAt: '2026-01-01',
          plannedEndAt: '2026-12-31',
          coverColor: null,
          status: 'active',
          revision: 0,
          updatedAt: now,
        },
      ],
      stages: [
        {
          id: 's_funcwalk',
          projectId: 'p_funcwalk',
          orderIndex: 1,
          name: '阶段一',
          ratioPercent: 100,
          startAt: '2026-01-01',
          endAt: '2026-12-31',
          status: 'in_progress',
          ownerId: null,
          visible: true,
          resourcePath: null,
          revision: 0,
          updatedAt: now,
        },
      ],
      tasks: [
        {
          id: 't_funcwalk',
          projectId: 'p_funcwalk',
          stageId: 's_funcwalk',
          title: '任务一',
          done: false,
          assigneeId: null,
          dueDate: null,
          orderIndex: 0,
          revision: 0,
          updatedAt: now,
        },
      ],
      members: [
        {
          id: 'm_funcwalk',
          name: '走查导入管理员',
          role: '设计师',
          contact: null,
          avatarColor: '#3D6B5B',
          active: true,
          revision: 0,
          updatedAt: now,
        },
      ],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
    },
  };
}

/** 等一个 locator 出现（带超时的 count>0 轮询） */
async function waitForVisible(win, selector, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const n = await win.locator(selector).count();
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * 在文本含 substr 的按钮里，挑「几何上可点」的那个（center 命中自身或其子孙）再点。
 * 为什么：建档弹窗同时存在两个含「建档」文本的按钮——一个被滚动容器盖住的 tab、
 * 一个真正可提交的「建档（按所选 9 个阶段切分）」按钮。`.first()` 会命中被盖住的，
 * 导致点击被容器拦截、弹窗卡死、后续断言全失败（实测根因）。故用 elementFromPoint 真判据
 * 选可点的那个，必要时兜底 force 点第一个。
 */
async function clickButtonByText(win, substr, timeout = 8000) {
  const idx = await win.evaluate((s) => {
    const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').includes(s));
    for (let i = 0; i < btns.length; i++) {
      const r = btns[i].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && (hit === btns[i] || btns[i].contains(hit) || hit.contains(btns[i]))) return i;
    }
    return -1;
  }, substr);
  if (idx >= 0) {
    await win.locator(`button:has-text("${substr}")`).nth(idx).click({ timeout });
    return true;
  }
  await win.locator(`button:has-text("${substr}")`).first().click({ timeout, force: true });
  return false;
}

/**
 * 确保处于管理员身份（B1/B3/B4 都是管理员专属入口）。
 * 返回 true=已为管理员（侧栏出现「保存备份」按钮）；false=无法取得，相关项转 WARN。
 * 为什么这么测：身份闸门是首启自动弹 admin_prompt（useFirstRunGate.ts），
 * 走的是真实 UI，不能用 setAttribute 伪造。
 *
 * 全新 userData（本脚本默认隔离目录）下没有任何成员 → 一定走 admin_prompt：
 * 这里就走真实 UI 把首个管理员建出来（点「我是管理员」→ 填姓名 → 确认），不绕过。
 */
async function ensureAdmin(win) {
  // 已为管理员：侧栏直接渲染「保存备份」（Sidebar.tsx:294 仅 isAdmin 时渲染）
  if (await waitForVisible(win, 'button[aria-label="保存备份"]', 5000)) return true;

  // 首启闸门：点「我是管理员」→ 姓名输入 → 确认为管理员（IdentityDialog.tsx）
  // 给 8s 等闸门渲染（全新库首次启动可能稍慢）。
  if (await waitForVisible(win, 'button:has-text("我是管理员")', 8000)) {
    await win.locator('button:has-text("我是管理员")').first().click();
    await win.waitForSelector('input[placeholder="你的姓名"]', { timeout: 6000 });
    await win.locator('input[placeholder="你的姓名"]').fill('走查管理员');
    await win.locator('button:has-text("确认为管理员")').first().click();
    // 等成员写入 + 侧栏重渲染
    await new Promise((r) => setTimeout(r, 1200));
  }

  // 兜底：可能落在其它身份流（如「点击进入」）。给一次机会等侧栏按钮出现。
  return await waitForVisible(win, 'button[aria-label="保存备份"]', 15000);
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    console.error(`✗ 缺少构建产物 ${DIST_INDEX}，请先 npm run build`);
    process.exit(2);
  }
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(join(ROOT, 'tmp', 'funcwalk'), { recursive: true });

  const packed = USE_PACKED ? findPackedExe() : null;
  if (USE_PACKED && !packed) {
    console.error('✗ 未找到 release-*/win-unpacked/*.exe，请先 electron-builder --dir');
    process.exit(2);
  }
  const execPath = packed ? packed.exe : electronPath;
  const args = packed ? [] : ['.'];

  // ★ userData 隔离：默认用临时目录，绝不碰真实 %APPDATA%\ID Plan。
  //   一旦 --use-real-profile，整库替换（B4）会直接污染真实数据——默认坚决不开。
  //
  //   ⚠️ 每一轮都必须从**全新空目录**起步（2026-09-17 实测事故）：
  //     上一轮留在 `userdata/packed/` 里的库是旧 schema（v3），而当前应用是 v4，
  //     于是应用启动后**卡在「需要先导出升级前备份」的迁移闸门**上 ——
  //     窗口起来了、进程活着、`window.idplan` 也在（preload 已注入），
  //     但**一个 header 都不渲染**。外部表现与「产品白屏」完全一样，
  //     实测把本脚本误导成 5 条 FAIL + 4 条 WARN（截图 tmp/funcwalk/B12-focus.png 可复核）。
  //     真实用户不会遇到（他们只会遇到一次升级闸门），这是**夹具陈旧**，不是产品缺陷。
  //   删不掉时（本机 CLI 有批量删除守卫）降级为改名挪走，保证「干净」由**构造**保证，
  //   不依赖删除成功 —— 与 verify-package.cjs 同一套降级策略。
  if (!USE_REAL_PROFILE) {
    let fresh = USER_DATA_DIR;
    if (existsSync(fresh)) {
      try {
        renameSync(fresh, `${fresh}-stale-${Date.now()}`);
      } catch (err) {
        console.warn(`  [提示] 旧隔离目录挪不动（${err?.code || err}），改用新目录`);
        fresh = `${USER_DATA_DIR}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      }
    }
    mkdirSync(fresh, { recursive: true });
    // Electron 解析 --user-data-dir 作为 Chromium 用户数据目录（IndexedDB 即落此处），
    // 与默认 appData/getName() 彻底隔离。本应用 main.cjs 未调用 setPath('userData')，
    // 故此开关足以把数据重定向到临时目录。
    args.push(`--user-data-dir=${fresh}`);
  }

  // ★ 机器断言前置：拍真实 IndexedDB 的 mtime 指纹（跑完再拍一次对比）。
  const realBefore = indexedDbMtimeSig();

  // ★ 必须剔除：ELECTRON_RUN_AS_NODE=1 会让 electron.exe 退化成纯 Node
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  console.log(`\n═══ ID Plan Windows 功能走查 ═══`);
  console.log(`目标：${packed ? `打包产物 ${packed.dir}` : '源码树（node_modules electron）'}`);
  console.log(`exe ：${execPath}`);
  console.log(`mtime：${mtimeOf(execPath)}`);
  console.log(
    `隔离：${USE_REAL_PROFILE ? '⚠ 已用真实共享 userData（--use-real-profile，危险）' : `临时 userData=${(args.find((a) => a.startsWith('--user-data-dir=')) || '').replace('--user-data-dir=', '')}`}`,
  );
  console.log(`截图：${SHOTS}\n`);

  let app;
  let win;
  try {
    const t0 = Date.now();
    app = await electron.launch({
      executablePath: execPath,
      args,
      cwd: ROOT,
      env: cleanEnv,
      timeout: 30000,
    });
    record('0. 应用启动', true, `${Date.now() - t0}ms`);

    win = await app.firstWindow({ timeout: 30000 });
    await win.waitForLoadState('domcontentloaded').catch(() => {});
    // 路过打印代码也不卡死：把 window.print 换成置标志位（不弹原生对话框）。
    // 本脚本不主动进打印路由，但加装保险以防万一。
    // 同时桩住导出下载的关键 API，用于区分「导出逻辑是否执行」与「下载是否真的被捕获」。
    // ⚠️ 下载的**权威观测在主进程**（session 的 will-download，见 resetDownloadObserver），
    //   不是渲染层的那个 <a> 桩 —— 渲染层桩只能证明「点了 anchor」。
    const initScript = () => {
      window.print = () => {
        window.__printCalled = true;
      };
      const _coo = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (...a) => {
        window.__lastBlobUrl = String((a[0] && a[0].size) ?? '?');
        return _coo(...a);
      };
      const _click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) {
          window.__lastDownload = { download: this.download, href: (this.href || '').slice(0, 40) };
          // 把 blob URL 的内容读回来，供断言「导出内容确实是合法备份包」——
          // 这样即便 detached <a> 不触发 Playwright 可捕获的下载事件，也能独立证明导出逻辑正确。
          try {
            const u = this.href;
            if (u && u.startsWith('blob:')) {
              fetch(u)
                .then((r) => r.text())
                .then((t) => {
                  window.__lastBlobText = t;
                })
                .catch(() => {});
            }
          } catch {
            /* 忽略读取失败 */
          }
        }
        return _click.apply(this, arguments);
      };
    };
    await win.addInitScript(initScript);
    await win.waitForSelector('header', { timeout: 20000 }).catch(() => {});

    /**
     * 关闭当前进程并以相同参数（含 --user-data-dir 隔离）重新拉起一个干净窗口。
     * 用于：① 打包形态下 B3 触发了原生「另存为」对话框需清场；② B10 跨重启持久化。
     * 重新注入 initScript（桩），并重走一次 ensureAdmin（隔离 userData 内管理员已持久，
     * 故通常直接通过；若仍无管理员，说明隔离首启闸门这次没建成功）。
     */
    async function relaunchApp() {
      if (app) await app.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 1200)); // 等单实例锁释放
      app = await electron.launch({
        executablePath: execPath,
        args,
        cwd: ROOT,
        env: cleanEnv,
        timeout: 30000,
      });
      win = await app.firstWindow({ timeout: 30000 });
      await win.addInitScript(initScript);
      await win.waitForLoadState('domcontentloaded').catch(() => {});
      await win.waitForSelector('header', { timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
    }

    // ── 身份：确保管理员（B1/B3/B4 前置） ──────────────────────────────
    const isAdmin = await ensureAdmin(win);
    record('0a. 取得管理员身份', isAdmin, isAdmin ? '侧栏「保存备份」可见' : '未能进入管理员，B1/B3/B4 将转 WARN');

    // ── B12 · Control+K 聚焦搜索（成本极低，先跑） ───────────────────────
    // 为什么这么测：焦点态这类交互只有真实键盘事件能触发，且只验证几何焦点
    // （document.activeElement 落在 header 内的 input），不查 className。
    try {
      await win.keyboard.press('Control+k');
      await new Promise((r) => setTimeout(r, 400));
      const ae = await win.evaluate(() => {
        const el = document.activeElement;
        return {
          tag: el?.tagName || null,
          inHeader: !!(el && el.closest && el.closest('header')),
          ph: el?.getAttribute?.('placeholder') || '',
        };
      });
      const ok = ae.tag === 'INPUT' && ae.inHeader;
      record('B12. Control+K 聚焦搜索框', ok, `activeElement=${ae.tag} inHeader=${ae.inHeader} placeholder="${ae.ph}"`);
      if (!ok) await snap(win, 'B12-focus');
    } catch (e) {
      record('B12. Control+K 聚焦搜索框', false, String(e && e.message));
      await snap(win, 'B12-focus');
    }

    // ── B7 · 离线更新检测不卡死 ────────────────────────────────────────
    // 为什么这么测：checkUpdate 走主进程 fetch GitHub（8s 超时）。离线/被墙时应
    // 快速 reject 而非挂死；用 Promise.race 12s 上限判定「是否卡死」，并确认进程还活着。
    try {
      const r = await win.evaluate(async () => {
        const t0 = Date.now();
        try {
          const p = await Promise.race([
            window.idplan.checkUpdate(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('__timeout__')), 12000)),
          ]);
          return { ok: true, ms: Date.now() - t0, payload: p || null };
        } catch (e) {
          return { ok: false, ms: Date.now() - t0, err: String((e && e.message) || e) };
        }
      });
      const hung = r.ms >= 12000 && /__timeout__/.test(r.err || '');
      const alive = !!app.process();
      const ok = !hung && alive;
      record(
        'B7. 离线更新检测不卡死',
        ok,
        `耗时 ${r.ms}ms hung=${hung} 进程存活=${alive}` +
          (r.payload ? ` 返回 current=${r.payload.current}` : ` 拒绝原因=${r.err || '无'}`),
      );
      if (!ok) await snap(win, 'B7-update');
    } catch (e) {
      record('B7. 离线更新检测不卡死', false, String(e && e.message));
      await snap(win, 'B7-update');
    }

    // ── B2 · 顶栏拖拽区是否吞掉可点控件（几何真判据） ─────────────────
    // 为什么这么做：header 带 `app-titlebar-drag`（-webkit-app-region:drag），
    // 内部控件必须 no-drag 才能点。只查 className 会漏判（本项目有过先例），
    // 故用 elementFromPoint 在每个控件中心做真实命中测试，断言命中的是控件自身
    // 或其子节点，而不是被某个祖先/遮罩（含拖拽区）盖住。
    async function runB2(label) {
      const b2 = await win.evaluate(() => {
        const header = document.querySelector('header');
        if (!header) return { error: 'no-header' };
        const drag = header.classList.contains('app-titlebar-drag');
        const els = [...header.querySelectorAll('button, a, input, [role="button"], [tabindex]')].filter(
          (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          },
        );
        const rows = [];
        for (const el of els) {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          const isSelfOrChild = el === hit || el.contains(hit) || (hit && hit.contains(el));
          // 被拖拽区盖住：命中元素在 header 内、且不是该控件及其子孙
          const coveredByDrag =
            !!hit &&
            hit !== el &&
            !el.contains(hit) &&
            !(hit && hit.contains(el)) &&
            header.contains(hit);
          rows.push({
            tag: el.tagName,
            aria: el.getAttribute('aria-label') || '',
            cx: Math.round(cx),
            cy: Math.round(cy),
            topIsControl: isSelfOrChild,
            coveredByDrag,
            hitTag: hit ? hit.tagName : null,
            hitCls: hit ? (hit.getAttribute('class') || '').slice(0, 40) : '',
          });
        }
        return { drag, count: rows.length, rows };
      });
      if (b2.error) {
        record(`B2.${label} 顶栏控件未被拖拽区吞没`, false, b2.error);
        await snap(win, `B2-${label}`);
        return;
      }
      const bad = b2.rows.filter((x) => !x.topIsControl || x.coveredByDrag);
      const ok = b2.count > 0 && bad.length === 0;
      const detail = `header.drag=${b2.drag} 控件数=${b2.count}` +
        (bad.length
          ? ` 命中异常：${bad
              .map((x) => `${x.tag}[${x.aria}]@${x.cx},${x.cy}→${x.hitTag}.${x.hitCls}`)
              .join(' | ')}`
          : ' 全部命中自身');
      record(`B2.${label} 顶栏控件未被拖拽区吞没`, ok, detail);
      if (!ok) await snap(win, `B2-${label}`);
    }
    await runB2('宽档1400');
    // 窄档覆盖汉堡（<1280 才出现），顺带验证缩窗后顶栏控件仍不被吞
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 760), 1000);
    await new Promise((r) => setTimeout(r, 600));
    await runB2('窄档1000');
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 900), 1400);
    await new Promise((r) => setTimeout(r, 400));

    // ── B1 · app:// 子路由 F5 不白屏（最高优先级） ─────────────────────
    // 为什么这么测：main.cjs:214-244 的 SPA 回退是「deep link + reload 不白屏」的
    // 唯一保障。浏览器里没有 app:// 永远测不出；打包后若回退被裁剪，reload 直接白屏。
    if (!isAdmin) {
      record('B1. app:// 子路由 F5 不白屏', 'warn', '缺管理员身份，无法建项目拿真实 id，跳过');
    } else {
      try {
        // 走 UI 建项目（侧栏「新建项目」仅管理员 + 项目页可见，Sidebar.tsx:320）
        await win.locator('button[aria-label="新建项目"]').first().click();
        const opened = await waitForVisible(win, 'div[aria-label="手动建档"]', 8000);
        record('B1a. 打开手动建档表单', opened, opened ? '' : '未出现建档弹窗');
        if (opened) {
          await win.locator('input[placeholder="如「XX餐饮·室内设计」"]').fill('功能走查临时项目');
          /*
            ★ 反馈 #5 之后必须**显式选主板块**，否则后面那步点不动：
              手动建档首开不预设任何行业/主板块 ⇒ 阶段池为空（0 段）⇒
              「建档」按钮是 `disabled`（ManualFallbackForm 的 stageItems.length < MIN_STAGE_COUNT）。
              实测报错就是 `locator resolved to <button disabled …>`，
              而 Playwright 会一直等「enabled」直到 8s 超时 —— 表现成 B1 红，
              根因却是夹具没跟上 UI 契约（真实用户点一次板块就带出套餐了）。
          */
          const domainSelect = win.locator('select[aria-label="主板块"]').first();
          if ((await domainSelect.count()) > 0) {
            await domainSelect.selectOption('indoor');
            await new Promise((r) => setTimeout(r, 400));
          }
          // 竣工日为必填；开始日已默认今天，竣工填一个晚于今天的日期
          await win.locator('input[type="date"]').nth(1).fill('2026-12-31');
          // 注意：建档弹窗有两个含「建档」的按钮，须用几何真判据挑可点的那个（见 clickButtonByText）
          await clickButtonByText(win, '建档');
          // 等导航到 /project/:id
          let pid = null;
          const t1 = Date.now();
          while (Date.now() - t1 < 12000) {
            const u = win.url();
            const m = /\/project\/([^/]+)/.exec(u);
            if (m) {
              pid = m[1];
              break;
            }
            await new Promise((r) => setTimeout(r, 300));
          }
          record('B1b. 建档并拿到真实项目 id', !!pid, pid ? `id=${pid}` : '未导航到 /project/:id');
          if (pid) {
            // 关键：在子路由 reload，验证 SPA 回退
            await win.reload({ timeout: 20000 });
            await win.waitForLoadState('domcontentloaded').catch(() => {});
            const bodyKids = await win.evaluate(() => document.body.children.length);
            const url = win.url();
            const headerOk = await waitForVisible(win, 'header', 10000);
            const ok = bodyKids > 0 && headerOk && /\/project\//.test(url);
            record(
              'B1c. 子路由 F5 后非白屏',
              ok,
              `url=${url} body子元素=${bodyKids} header=${headerOk}`,
            );
            if (!ok) await snap(win, 'B1-reload');
          } else {
            record('B1c. 子路由 F5 后非白屏', 'warn', '无项目 id，无法 reload 子路由');
          }
        } else {
          record('B1b. 建档并拿到真实项目 id', 'warn', '建档表单未打开，无法继续');
          record('B1c. 子路由 F5 后非白屏', 'warn', '建档未成功，无法继续');
        }
      } catch (e) {
        record('B1. app:// 子路由 F5 不白屏', false, String(e && e.message));
        await snap(win, 'B1-reload');
      }
    }

    /**
     * ★★ 下载观察器（主进程级真判据）★★
     *
     * 为什么放弃 `win.waitForEvent('download')`：Electron 的下载由**主进程**处理
     * （webContents → session 的 `will-download`）。Playwright 的 page/context 级
     * download 事件在 Electron 下收不到 —— 这不是导出功能坏了，是**捕获层级选错了**。
     *
     * 实证链（三条独立证据，勿再回到旧解释）：
     *   1. 挂载式 anchor 修复（commit ce74d9f）确已进包 —— 可在 `build-dist` 里抠到
     *      `appendChild→click→removeChild→setTimeout(revoke,0)` 字节；
     *   2. 修复后本断言**仍恒红** → 说明「detached <a> 抓不到」不是根因，该解释已作废；
     *   3. 打包形态实测**弹出 OS 原生「另存为」对话框** → 反证下载确实发起了，
     *      只是走主进程路径，page 级事件永远看不到。
     *
     * 本函数从**测试侧**挂 `will-download`（不改任何产品代码），并 `setSavePath` 落临时目录：
     *   - 记录真实文件名/URL/完成状态 → 作为「下载已捕获」的硬证据；
     *   - `setSavePath` 抑制原生对话框 → 后续断言不再被 OS 对话框阻塞（无需 relaunch 清场）。
     */
    async function resetDownloadObserver(electronApp) {
      mkdirSync(DL_DIR, { recursive: true });
      // ⚠️ 保存路径由 Node 侧算好**传入**，不要在 evaluate 里 require —— 该上下文不保证有
      //   require（踩过：require 抛错被 try/catch 吞掉 → setSavePath 静默未执行 →
      //   下载停在原生「另存为」对话框 → done 永不触发，表现为「已发起但从未完成」、
      //   临时目录里也没有文件。这是个假象，会让人误判成产品 bug）。
      await electronApp.evaluate(({ session }, saveDirWithSep) => {
        const g = globalThis;
        g.__dlObserved = [];
        if (g.__dlHooked) return;
        g.__dlHooked = true;
        session.defaultSession.on('will-download', (_event, item) => {
          const rec = {
            filename: item.getFilename(),
            url: String(item.getURL() || '').slice(0, 48),
            done: null,
          };
          g.__dlObserved.push(rec);
          // 抑制原生「另存为」：交给隔离目录（仅测试侧拦截，不改产品行为）
          try {
            const p = saveDirWithSep + item.getFilename();
            item.setSavePath(p);
            rec.savePath = p;
          } catch (e) {
            rec.savePathError = String((e && e.message) || e);
          }
          item.once('done', (_e, st) => {
            rec.done = st;
          });
        });
      }, DL_DIR + sep);
    }

    async function readDownloadObserver(electronApp) {
      const list = await electronApp.evaluate(() => globalThis.__dlObserved || []);
      return Array.isArray(list) && list.length ? list[list.length - 1] : null;
    }

    // ── B3 · 备份导出下载事件（+ 项目名含非法字符对照） ────────────────
    if (!isAdmin) {
      record('B3. 备份导出下载事件', 'warn', '缺管理员身份，跳过');
      record('B3*. 非法字符项目名导出', 'warn', '缺管理员身份，跳过');
    } else if (USE_PACKED) {
      // ===== 打包形态 B3：主进程 will-download 观察 =====
      // 判据与源码树同源（见 resetDownloadObserver）。打包形态的额外价值：
      // 这里本来就是「下载走主进程」最容易暴露的地方（实测会弹 OS 原生另存为），
      // 现在从主进程看就不再是盲区。
      try {
        win.on('dialog', (d) => d.dismiss().catch(() => {}));
        await resetDownloadObserver(app);
        await win.evaluate(() => {
          window.__lastDownload = null;
          window.__lastBlobUrl = null;
          window.__lastBlobText = null;
        });
        await win.locator('button[aria-label="保存备份"]').first().click();
        // 等主进程 will-download 记录（最多 10s；不再有原生对话框阻塞问题）
        let obs = null;
        const tp = Date.now();
        while (Date.now() - tp < 10000) {
          obs = await readDownloadObserver(app);
          if (obs) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        // 同源码树轮：再等 done，避免只证明「已发起」
        if (obs && !obs.done) {
          const td = Date.now();
          while (Date.now() - td < 5000) {
            const cur = await readDownloadObserver(app);
            if (cur && cur.done) {
              obs = cur;
              break;
            }
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        const evFired = !!obs;
        // 等桩把 blob 内容取回（最多 3s）
        let blobText = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 3000) {
          blobText = await win.evaluate(() => window.__lastBlobText || null);
          if (blobText) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        const stub = await win.evaluate(() => ({
          download: window.__lastDownload,
          blob: window.__lastBlobUrl,
        }));
        const logicRan = !!stub.download && !!stub.blob;
        // 内容正确性（桩信号）
        let contentOk = false;
        let contentDetail = '';
        if (blobText) {
          try {
            const pkg = JSON.parse(blobText);
            contentOk =
              pkg?.meta?.app === 'changxia' &&
              Array.isArray(pkg?.data?.projects) &&
              Array.isArray(pkg?.data?.members);
            contentDetail = `meta.app=${pkg?.meta?.app} projects=${pkg?.data?.projects?.length} members=${pkg?.data?.members?.length}`;
          } catch (e) {
            contentDetail = `JSON 解析失败：${String(e && e.message)}`;
          }
        }
        record('B3 导出内容正确性(打包)', contentOk, contentDetail || '未取到导出内容');

        record(
          'B3 下载事件已捕获(打包·主进程)',
          obs && obs.done === 'completed' ? true : evFired ? 'warn' : false,
          evFired
            ? `主进程 will-download 命中：filename=${obs.filename} url=${obs.url} 完成状态=${obs.done}` +
              (obs.done === 'completed' ? '' : '（已发起但未观测到 completed，需人工复核）')
            : `主进程 will-download 未触发 —— 下载根本没有发起（导出逻辑${logicRan ? '已执行' : '未执行'}，桩 ${(stub.download || {}).download || '无'}）。` +
              `这是**产品侧**问题，不是捕获层级问题（本断言已改为主进程观察），请查 downloadBackup 与 session 下载路径。`,
        );
        // 非法字符项目名对照：源码树轮已覆盖；打包轮跳过以节省时间并显式标注。
        record(
          'B3.2/3.3.1 非法字符对照(打包)',
          'warn',
          '该对照在源码树轮已覆盖，打包轮显式跳过（非失败）',
        );
      } catch (e) {
        record('B3. 备份导出下载事件(打包)', false, String(e && e.message));
        await snap(win, 'B3-export-packed');
      }
    } else {
      /**
       * 触发一次「保存备份」并判定导出是否真的成功。
       *
       * ★ 判据（2026-09-14 修正，勿回退）★
       *   权威观测点 = **主进程 `will-download`**（resetDownloadObserver 安装）。三层判据：
       *     a) 主进程确实收到 will-download         → 下载真的发起了；
       *     b) 桩信号 __lastDownload / __lastBlobUrl → 导出逻辑真的执行了；
       *     c) 导出的 JSON 是合法备份包（meta.app==='changxia'）→ 内容真的对。
       *
       * ⚠️ **不要再用 `win.waitForEvent('download')` 当主判据**：Electron 的下载由主进程处理，
       *   Playwright 的 page 级 download 事件在 `_electron.launch` 下收不到 —— 这就是本断言
       *   历史上恒红的真因，与 `downloadBackup` 的实现无关（详见 resetDownloadObserver 注释）。
       *
       * ⚠️ **历史误判留档**：曾归因于 `downloadBackup` 用 detached `<a>`，并据此改了实现
       *   （commit ce74d9f）。该修复**确已进包**（可在 build-dist 抠到 appendChild→click→
       *   removeChild 字节），而本断言仍然红 → **归因被证伪**。ce74d9f 本身仍有价值
       *   （消除了同步 revoke 的潜在竞态），但它是「顺手修对的另一件事」，不是 B3 的解法。
       *   **教训：断言恒红时，先证明观测手段本身能观测到绿，再归因产品代码。**
       *
       * ⚠️ 另注意：本走查加载的是 **`build-dist`**（`electron/main.cjs` 的 `DIST`），而非 `src/`。
       *   源码改了但未重建时读到的是旧实现。开跑前先确认 `build-dist` 比源码新。
       */
      async function triggerExportAndCheck(label) {
        await resetDownloadObserver(app);
        await win.evaluate(() => {
          window.__lastDownload = null;
          window.__lastBlobUrl = null;
          window.__lastBlobText = null;
        });
        await win.locator('button[aria-label="保存备份"]').first().click();
        // 等主进程 will-download 记录（最多 15s）
        let obs = null;
        const tw = Date.now();
        while (Date.now() - tw < 15000) {
          obs = await readDownloadObserver(app);
          if (obs) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        // 再等 item 走到 done（最多 5s）：让证据是「已完成」而非只是「已开始」。
        // 只断言「开始了」会漏掉「下载被中断/失败」——那同样是用户拿不到文件。
        if (obs && !obs.done) {
          const td = Date.now();
          while (Date.now() - td < 5000) {
            const cur = await readDownloadObserver(app);
            if (cur && cur.done) {
              obs = cur;
              break;
            }
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        // 等桩把 blob 内容 fetch 回来（最多 3s）
        let blobText = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 3000) {
          blobText = await win.evaluate(() => window.__lastBlobText || null);
          if (blobText) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        const stub = await win.evaluate(() => ({
          download: window.__lastDownload,
          blob: window.__lastBlobUrl,
        }));
        const evFired = !!obs;
        const fn = evFired ? obs.filename : null;
        const logicRan = !!stub.download && !!stub.blob;

        // 内容正确性：导出的 JSON 是不是合法备份包（meta.app==='changxia'）
        let contentOk = false;
        let contentDetail = '';
        if (blobText) {
          try {
            const pkg = JSON.parse(blobText);
            contentOk =
              pkg?.meta?.app === 'changxia' &&
              Array.isArray(pkg?.data?.projects) &&
              Array.isArray(pkg?.data?.members);
            contentDetail = `meta.app=${pkg?.meta?.app} projects=${pkg?.data?.projects?.length} members=${pkg?.data?.members?.length}`;
          } catch (e) {
            contentDetail = `JSON 解析失败：${String(e && e.message)}`;
          }
        }
        record(`${label} 导出内容正确性`, contentOk, contentDetail || '未取到导出内容');

        if (evFired) {
          // ★ 只断言「已发起」会漏掉「下载被中断/失败」——那同样是用户拿不到文件。
          //   故完成状态不是 completed 时降级为 WARN（不假装 PASS），并写明需人工复核。
          const completed = obs.done === 'completed';
          record(
            `${label} 下载事件已捕获(主进程)`,
            completed ? true : 'warn',
            `主进程 will-download 命中：filename=${fn} url=${obs.url} 完成状态=${obs.done}` +
              (obs.savePath ? ` 落盘=${obs.savePath}` : '') +
              (obs.savePathError ? ` ⚠ setSavePath 失败=${obs.savePathError}` : '') +
              (completed ? '' : '（下载已发起但未观测到 completed，需人工复核落盘文件）'),
          );
          return fn;
        }
        // 主进程都没收到 will-download：这才是**产品侧**问题（下载真的没发起）
        record(
          `${label} 下载事件已捕获(主进程)`,
          false,
          `主进程 will-download 未触发 —— 下载根本没有发起。导出逻辑${logicRan ? '已执行' : '未执行'}` +
            `（桩 <a download="${stub.download?.download || '无'}">，blob size=${stub.blob || '无'}）。` +
            `本断言已是主进程观察，不再是「捕获层级」问题，请查 downloadBackup 与 session 下载路径。`,
        );
        await snap(win, `${label}-export`);
        return null;
      }

      try {
        const fname = await triggerExportAndCheck('B3');

        // 对照：建一个名字含 Windows 非法字符的项目，看建档是否被接受 / 导出文件名是否被污染
        await win.locator('button[aria-label="新建项目"]').first().click();
        const opened = await waitForVisible(win, 'div[aria-label="手动建档"]', 8000);
        if (opened) {
          const dirtyName = '客户A/最终:方案*?';
          await win.locator('input[placeholder="如「XX餐饮·室内设计」"]').fill(dirtyName);
          await win.locator('input[type="date"]').nth(1).fill('2026-12-31');
          // 同样用几何真判据挑可点的「建档」按钮（弹窗有两个同名按钮）
          await clickButtonByText(win, '建档');
          let dirtyOk = false;
          const t2 = Date.now();
          while (Date.now() - t2 < 12000) {
            if (/\/project\//.test(win.url())) {
              dirtyOk = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 300));
          }
          record(
            'B3.2 非法字符项目名建档',
            'warn',
            dirtyOk
              ? `项目名="${dirtyName}" 被接受并建档（url=${win.url()}）`
              : `项目名="${dirtyName}" 建档未进入 /project/（可能被拒或报错）`,
          );
          const fname2 = await triggerExportAndCheck('B3.3');
          // 设计上备份文件名固定为 id-plan-backup-<ts>.json（backup.service.ts:410），
          // 不含项目名——故非法字符不污染文件名。桩已拿到 <a download> 的真实文件名，用它核对形态。
          const stubName = await win.evaluate(() => window.__lastDownload?.download || null);
          const nameToCheck = fname2 || stubName;
          const isFixedPattern = /^id-plan-backup-\d+\.json$/.test(nameToCheck || '');
          record(
            'B3.3.1 导出文件名形态',
            isFixedPattern,
            `文件名="${nameToCheck}" 固定模式=${isFixedPattern}（导出文件名不含项目名，故非法字符不污染文件名）`,
          );
        } else {
          record('B3.2 非法字符项目名建档', 'warn', '建档表单未打开，跳过对照');
        }
      } catch (e) {
        record('B3. 备份导出下载事件', false, String(e && e.message));
        await snap(win, 'B3-export');
      }
    }

    // ── B10 · 跨重启持久化（暗色 + 侧栏折叠） ─────────────────────────
    // 为什么单独成段且放重启前：现有走查只测了「实时切换主题/折叠」，没测跨重启。
    // 主题落 localStorage('idplan-theme')、折叠落 'idplan.layout'（useLayoutStore），
    // 二者都由 initTheme/initSidebarCollapsed 在首帧前回读——本段验证「退出再起仍保持」。
    try {
      // 真实 UI 切暗色（设置弹窗 → 深色），严禁手工 setAttribute（否则不触发 apply→主进程）
      await win.locator('button[aria-label="设置"]').first().click();
      await new Promise((r) => setTimeout(r, 500));
      const dark = win.getByRole('button', { name: '深色', exact: true }).first();
      if ((await dark.count()) > 0) {
        await dark.click();
        await new Promise((r) => setTimeout(r, 700));
      }
      // 用 Escape 可靠关闭设置弹窗（不依赖某个关闭按钮的 aria-label 是否命中），
      // 否则弹窗残留会拦截后续侧栏折叠点击，造成「折叠没生效」的假 FAIL。
      await win.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 400));
      await win.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 400));

      // 诊断：折叠点击前是否还有弹窗开着
      const dialogOpen = await win.locator('[role="dialog"]').count();
      const preDialogNote = dialogOpen > 0 ? `（注意：折叠点击前仍有 ${dialogOpen} 个 dialog 未关闭）` : '';

      // 真实点击侧栏折叠：把定位收窄到持久左栏 aside#app-sidebar 内，
      // 避免命中抽屉里同名「展开侧边栏」按钮（<1280 才应出现）。
      // 注意：userData 跨运行共享，侧栏初态可能已是上轮持久化结果，故「点一次」不可靠——
      // 这里循环点击直到 dataset.sidebarCollapsed==='true'（最多 3 次），对初态鲁棒。
      const toggle = win.locator('aside#app-sidebar').getByRole('button', { name: /侧边栏/ }).first();
      const hasToggle = (await toggle.count()) > 0;
      if (hasToggle) {
        for (let i = 0; i < 3; i++) {
          const cur = await win.evaluate(() => document.documentElement.dataset.sidebarCollapsed);
          if (cur === 'true') break;
          await toggle.click();
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      const pre = await win.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        collapsed: document.documentElement.dataset.sidebarCollapsed,
      }));
      record(
        'B10a. 重启前已置暗色+折叠',
        pre.theme === 'dark' && pre.collapsed === 'true',
        `theme=${pre.theme} collapsed=${pre.collapsed} 找到折叠钮=${hasToggle}${preDialogNote}`,
      );

      // ★ 完全退出再起（单实例锁必须等释放）
      await app.close();
      await new Promise((r) => setTimeout(r, 1500));
      app = await electron.launch({
        executablePath: execPath,
        args,
        cwd: ROOT,
        env: cleanEnv,
        timeout: 30000,
      });
      win = await app.firstWindow({ timeout: 30000 });
      await win.addInitScript(initScript);
      await win.waitForLoadState('domcontentloaded').catch(() => {});
      await win.waitForSelector('header', { timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      const post = await win.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        collapsed: document.documentElement.dataset.sidebarCollapsed,
      }));
      const ok = post.theme === 'dark' && post.collapsed === 'true';
      record('B10b. 跨重启持久化', ok, `theme=${post.theme} collapsed=${post.collapsed}`);
      if (!ok) await snap(win, 'B10-persist');
    } catch (e) {
      record('B10. 跨重启持久化', false, String(e && e.message));
      await snap(win, 'B10-persist');
    }

    // ── B4 · 备份导入 → reload 不白屏（放最后：会清库重建，污染数据） ──
    // 为什么最后：importAndReplace 走 Dexie 事务清库重建（backup.service.ts:363），
    // 会覆盖前面建的项目与成员。导入成功后 window.location.reload()（useBackupIo.tsx:116），
    // 若 reload 后白屏（如导入破坏了路由/首屏），就是真 bug。
    if (!isAdmin) {
      record('B4. 备份导入 reload 不白屏', 'warn', '缺管理员身份，跳过');
    } else {
      try {
        const importJson = minimalBackupJson();
        const importPath = join(ROOT, 'tmp', 'funcwalk', 'import.json');
        writeFileSync(importPath, JSON.stringify(importJson, null, 2));
        console.log(`  · 最小合法备份已写入：${importPath}`);

        // 触发隐藏 file input（useBackupIo.tsx:130-142，accept=".json,application/json"）
        await win.locator('button[aria-label="加载备份"]').first().click();
        await new Promise((r) => setTimeout(r, 400));
        const fi = win.locator('input[type="file"][accept*="json"]').first();
        const hasInput = (await fi.count()) > 0;
        record('B4a. 隐藏文件选择器存在', hasInput, hasInput ? '' : '未找到 accept=json 的 file input');
        if (hasInput) {
          await fi.setInputFiles(importPath);
          // 预检通过 → 二次确认弹窗「确认恢复」
          const confirmShown = await waitForVisible(win, 'button:has-text("确认恢复")', 8000);
          record('B4b. 校验通过弹出确认框', confirmShown, confirmShown ? '' : '未弹出确认恢复');
          if (confirmShown) {
            await win.locator('button:has-text("确认恢复")').first().click();
            // onConfirmRestore → importAndReplace → window.location.reload()
            await win.waitForLoadState('domcontentloaded').catch(() => {});
            const headerOk = await waitForVisible(win, 'header', 15000);
            const bodyKids = await win.evaluate(() => document.body.children.length);
            const ok = headerOk && bodyKids > 0;
            record('B4c. 导入后 reload 非白屏', ok, `header=${headerOk} body子元素=${bodyKids}`);
            if (!ok) await snap(win, 'B4-reload');
          } else {
            record('B4c. 导入后 reload 非白屏', 'warn', '未弹出确认框，无法完成导入');
          }
        }
      } catch (e) {
        record('B4. 备份导入 reload 不白屏', false, String(e && e.message));
        await snap(win, 'B4-reload');
      }
    }
  } catch (err) {
    record('运行期异常', false, String(err && err.message));
    await snap(win, 'fatal');
  } finally {
    if (app) await app.close().catch(() => {});

    // ★★★ 机器断言：真实 userData 是否被污染（安全属性必须有断言兜底）★★★
    //   隔离生效 → 真实 IndexedDB 的 mtime 全程未变 → PASS（附 before/after 显式对比）。
    //   隔离失效（--user-data-dir 被漏传 / B4 整库替换落到真实库）→ mtime 前移 → FAIL。
    //   这是「安全属性」的兜底：将来若有人改了 launch 参数漏传隔离目录，
    //   脚本会立即 FAIL，而不是静默地又开始销毁真实数据（上一轮事故正是如此）。
    const realAfter = indexedDbMtimeSig();
    const fmt = (sig) =>
      sig.count === 0 ? '无(目录空/不存在)' : new Date(sig.maxMtimeMs).toISOString();
    const beforeIso = fmt(realBefore);
    const afterIso = fmt(realAfter);
    const unchanged =
      realBefore.count === realAfter.count && realBefore.maxMtimeMs === realAfter.maxMtimeMs;
    record(
      'A. 真实 userData 未被污染',
      unchanged,
      `IndexedDB 文件数 ${realBefore.count}→${realAfter.count}；` +
        `最新 mtime before=${beforeIso} after=${afterIso} 未变=${unchanged}；` +
        `监测路径=${REAL_INDEXEDDB}`,
    );

    // ★ 正向佐证：临时隔离目录的 IndexedDB 确实被写入（证明写操作落到隔离层而非真实库）。
    if (!USE_REAL_PROFILE) {
      const tmpIdx = join(USER_DATA_DIR, 'IndexedDB');
      const used = existsSync(tmpIdx) && readdirSync(tmpIdx).length > 0;
      record(
        'A+. 隔离目录已接管写入',
        used,
        used
          ? `临时 userData 的 IndexedDB 已生成（${tmpIdx}）`
          : `临时 userData 下未发现 IndexedDB（可能首启未触达 Dexie，非隔离失败）`,
      );
    }
  }

  const failed = results.filter((r) => r.ok === false);
  const passed = results.filter((r) => r.ok === true);
  const warned = results.filter((r) => r.ok === 'warn');
  console.log(
    `\n═══ 汇总：${passed.length} 通过 / ${failed.length} 失败 / ${warned.length} 跳过(WARN) / ${results.length} 项 ═══`,
  );
  if (failed.length) {
    console.log('\n失败明细：');
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail ?? ''}`);
  }
  if (warned.length) {
    console.log('\n跳过/告警明细：');
    for (const w of warned) console.log(`  ⚠ ${w.name} — ${w.detail ?? ''}`);
  }
  console.log(`\n截图已存至 ${SHOTS}\n`);
  process.exit(failed.length ? 1 : 0);
}

main();
