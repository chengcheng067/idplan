/**
 * ID Plan · Electron 主进程
 *
 * 关键点：前端使用 createBrowserRouter（依赖 URL 路径），dist 资源为绝对路径 /assets/，
 * 直接用 loadFile 会因 file:// 协议路由 404。因此注册自定义协议 app:// 来托管 dist 静态资源，
 * 并把任意路径回退到 index.html（SPA 回退），这样前端代码与路由零改动即可在桌面运行。
 *
 * 复用 ID Aura 的 Electron 打包思路：独立窗口 + NSIS 安装 + 数据落应用独立目录。
 */
const { app, BrowserWindow, protocol, shell, Menu, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');

// 本机 Agent loopback（v1.0 · 外部写入方经 127.0.0.1:17788 直写运行中的 ID Plan）
const {
  startLoopbackServer,
  stopLoopbackServer,
  setLoopbackToken,
  resolveLoopbackResult,
} = require('./loopback.cjs');

// 单一真相源：版本号只写在仓库根 version.json（与 GitHub Release tag 严格对应，四段 x.y.z.build）。
// package.json 的 version 是合法 semver（0.3.0）供 electron-builder 用，不能写四段。
// 桌面端更新检测也以 APP_VERSION 为基准，避免与 semver 版本混淆。
const APP_VERSION = require('../version.json').version;
const REPO_OWNER = 'chengcheng067';
const REPO_NAME = 'idplan';
const UPDATE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// 渲染进程（preload）需要真实版本号——打包后 npm_package_version 不存在。
// 走 additionalArguments 而非 IPC：sendSync 会在 preload 顶层同步阻塞渲染进程，
// 且一旦主进程 handler 未注册就抛错、整个 contextBridge 失效。命令行参数零阻塞、无失败模式。

// ---- 更新检测（仅桌面端：启动 8s 后自动一次；设置面板可手动） ----
// 注意：sandbox: true 下 preload 不能 require node 模块，网络请求只能写在这里（主进程）。
// 下方比较函数是与 src/lib/version-compare.ts 行为对齐的纯 JS 副本——main 是 .cjs 无法直接吃 TS。

/** 解析四段版本号（v 前缀可选）。非四段或含非数字段 → null */
function parseVersion(raw) {
  if (!raw) return null;
  const v = raw.startsWith('v') ? raw.slice(1) : raw;
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  const segs = parts.map((p) => Number(p));
  if (segs.some((n) => !Number.isFinite(n))) return null;
  return segs;
}

/** 合法桌面版 tag 必以 'v' 开头且恰好 4 段；docker-0.3.0 / upk-images-0.3.0 等一律判为「无法判断」 */
function isValidDesktopTag(tag) {
  if (!tag || !tag.startsWith('v')) return false;
  return parseVersion(tag) !== null;
}

/** 逐段数值比较：a 新返回 >0，b 新返回 <0，相等返回 0；任一无法解析返回 null */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** 拉取 GitHub latest release（必须带 User-Agent，否则 403；8s 超时） */
function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      UPDATE_API,
      { headers: { 'User-Agent': 'id-plan-desktop', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`GitHub API ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    // 8s 超时：无网 / 被墙 / 限流都在此静默失败，不打扰用户
    req.setTimeout(8000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

/** 组装更新负载；tag 不合法（非桌面版发布）则 hasUpdate=false，绝不误报 */
async function buildUpdatePayload() {
  const data = await fetchLatestRelease();
  const tag = data.tag_name || '';
  if (!isValidDesktopTag(tag)) {
    return {
      current: APP_VERSION,
      latest: tag || null,
      hasUpdate: false,
      releaseUrl: null,
      publishedAt: null,
      notes: null,
      exeAssetUrl: null,
    };
  }
  const cmp = compareVersions(tag, APP_VERSION);
  const hasUpdate = cmp !== null && cmp > 0;
  let exeAssetUrl = null;
  if (Array.isArray(data.assets)) {
    const exe = data.assets.find((a) => typeof a.name === 'string' && a.name.endsWith('.exe'));
    if (exe) exeAssetUrl = exe.browser_download_url;
  }
  return {
    current: APP_VERSION,
    latest: tag,
    hasUpdate,
    releaseUrl: data.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${tag}`,
    publishedAt: data.published_at || null,
    notes: data.body || null,
    exeAssetUrl,
  };
}

// 渲染进程手动「检查更新」调用
ipcMain.handle('update:check', async () => buildUpdatePayload());

// 启动 8s 后自动检查一次（避开启动高峰与网络未就绪）；失败静默吞掉，绝不弹错误打扰。
// 仅打包后的正式版自动检查：开发期反复启动会实打 GitHub API，未认证限流 60 次/小时，
// 很快把自己限死，导致真正想验证时查不到。开发期仍可用设置面板的「检查更新」手动触发。
function scheduleAutoUpdateCheck(win) {
  if (!app.isPackaged) return;
  setTimeout(() => {
    buildUpdatePayload()
      .then((payload) => {
        if (payload && payload.hasUpdate && !win.isDestroyed()) {
          win.webContents.send('update:available', payload);
        }
      })
      .catch(() => {
        /* 静默：无网 / 被墙 / API 限流均不打扰用户 */
      });
  }, 8000);
}


// ---- 顶栏与主题融合（画板 02 亮色顶栏 / 画板 12 暗色顶栏） ----
// 设计稿的顶栏是「内容区的一部分」（亮 #FFFFFF / 暗 #1F2126，仅面包屑+搜索+头像三块），
// 而原生 Windows 标题栏是系统灰白，两者拼在一起就是用户说的「顶栏关闭栏与主题割裂」。
// 解法：隐藏原生标题栏（titleBarStyle:'hidden'），改用**自绘叠加层** titleBarOverlay
// 绘制最小化/最大化/关闭三键，其底色与符号色由渲染进程按当前主题实时下发（见下方
// 'theme:set'），做到「原生栏与内容区同色一体的感觉」。

/** 叠加层配色的**首帧兜底**（亮色）：与 src/styles/global.css 的 --paper / --ink 同源。
 *  运行期由 'theme:set' 用 CSS 变量的实际计算值覆盖，这里只保证
 *  「窗口创建 → 首帧 IPC 到达」之间不闪出错误颜色。 */
const TITLEBAR_FALLBACK = { color: '#ffffff', symbolColor: '#1f2937' };

/** 叠加层高度兜底（≥xl 口径，64）。渲染进程按视口宽度算实际值（<xl 为 56），
 *  与 TopBar 的 `h-14 xl:h-16` 严格一致——若两者不等，按钮会与顶栏内容错位。 */
const TITLEBAR_HEIGHT_FALLBACK = 64;

/** 是否启用自绘标题栏叠加层。仅 Windows 支持 titleBarOverlay：
 *  macOS 走系统红绿灯（自绘会破坏原生手势），Linux 不支持该 API。 */
const USE_TITLEBAR_OVERLAY = process.platform === 'win32';

/**
 * 顶栏主题下发：渲染进程写完 `<html data-theme>` 后，取 --paper / --ink 的**实际
 * 计算值**发来，主进程据此重设叠加层底色与符号色。
 * 颜色不在主进程另起一套 hex——否则 CSS 变量一改这里就漂移。
 */
ipcMain.on('theme:set', (event, payload) => {
  if (!USE_TITLEBAR_OVERLAY) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const color = payload && typeof payload.color === 'string' ? payload.color : '';
  const symbolColor = payload && typeof payload.symbolColor === 'string' ? payload.symbolColor : '';
  if (!color || !symbolColor) return;
  const height = Number.isFinite(payload.height)
    ? Math.round(payload.height)
    : TITLEBAR_HEIGHT_FALLBACK;
  try {
    win.setTitleBarOverlay({ color, symbolColor, height });
  } catch {
    /* 平台/版本不支持时静默：顶栏仍由 CSS 正常渲染，只是原生按钮区不跟随换肤 */
  }
});

// ── 本机 Agent loopback 接线（v1.0 · P0） ──
// 渲染进程把 token 告知主进程（仅比对，绝不回传原文）
ipcMain.on('agent:token:set', (_event, token) => {
  setLoopbackToken(token);
});

// 渲染进程把「落库结果 / 错误」回传给挂起的 HTTP 请求
ipcMain.on('agent:import-result', (_event, payload) => {
  if (payload && typeof payload.requestId === 'string') {
    resolveLoopbackResult(payload.requestId, payload);
  }
});

// 开发模式判定：默认加载 dist（electron:dev 需要先 npm run build）。
// 若想用 vite dev server 热更新，传 --dev-server 参数。
const useDevServer = process.argv.includes('--dev-server');
const isDev = !app.isPackaged && useDevServer;
const DIST = path.join(__dirname, '..', 'build-dist');
const PROTOCOL = 'app';

// 关键：必须在 app.whenReady() 之前注册 app:// 为 privileged scheme。
// 前端用 <script type="module"> + createBrowserRouter，非 standard 协议下
// Chromium 会以 CORS 拦截 module 脚本导致白屏；注册为 standard+secure+
// corsEnabled+supportFetchAPI 后，module 脚本与 fetch 才能正常执行。
protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** 协议处理器：安全地读取 dist 下的文件，未命中则回退 index.html（SPA 回退） */
function registerAppProtocol() {
  protocol.handle(PROTOCOL, (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    // 去掉前导斜杠，得到 dist 内相对路径
    if (pathname.startsWith('/')) pathname = pathname.slice(1);
    if (pathname === '') pathname = 'index.html';

    // 防目录穿越
    const safePath = path.normalize(path.join(DIST, pathname));
    if (!safePath.startsWith(path.normalize(DIST))) {
      return new Response('Forbidden', { status: 403 });
    }

    const mime = mimeFor(path.extname(safePath));
    try {
      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const data = fs.readFileSync(safePath);
        return new Response(data, {
          headers: { 'Content-Type': mime },
        });
      }
    } catch {
      /* 落到下方回退 */
    }
    // SPA 回退：非资源请求一律回 index.html，让前端路由接管
    const index = fs.readFileSync(path.join(DIST, 'index.html'));
    return new Response(index, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
}

/** 简易 MIME 映射（够用即可，未覆盖的落到 text/plain） */
function mimeFor(ext) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.wasm': 'application/wasm',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

/** 创建主窗口 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'ID Plan',
    // 窗口底色调成与 app 首屏底色同源（--cream 亮色 #F8FAFC）。
    // 原值 '#f5f2ec' 是改造前的旧暖白，与 v0.7 令牌不同源，会在
    // 「窗口创建 → 首帧渲染」之间闪出一块对不上的暖色。
    backgroundColor: '#f8fafc',
    // 自绘标题栏（仅 Windows）：隐藏原生栏，改用叠加层画三键，颜色随主题下发。
    // 非 Windows 不传该组键，保持系统原生标题栏（红绿灯 / 各桌面环境自绘）。
    ...(USE_TITLEBAR_OVERLAY
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: TITLEBAR_FALLBACK.color,
            symbolColor: TITLEBAR_FALLBACK.symbolColor,
            height: TITLEBAR_HEIGHT_FALLBACK,
          },
        }
      : {}),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 把真实版本号带给 preload（preload 从 process.argv 读取）
      additionalArguments: [`--idplan-version=${APP_VERSION}`],
    },
  });

  win.once('ready-to-show', () => win.show());
  // 外部链接交给系统浏览器，不劫持加载
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 开发模式用 vite dev server（热更新）；生产用自定义协议加载 dist
  if (isDev) {
    win.loadURL('http://localhost:5173').catch(() => {
      win.loadURL(`${PROTOCOL}://-/index.html`);
    });
  } else {
    win.loadURL(`${PROTOCOL}://-/index.html`);
  }
  return win;
}

app.setName('ID Plan');

// 单实例锁：避免开多个窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    if (!isDev) Menu.setApplicationMenu(null);
    const win = createWindow();
    scheduleAutoUpdateCheck(win);

    // 启动本机 Agent loopback；端口被占用时优雅失败（不阻断应用启动）
    void startLoopbackServer().then((ok) => {
      if (!ok) {
        // 端口占用：仅记录，不影响应用其余功能
        // eslint-disable-next-line no-console
        console.warn('[loopback] 127.0.0.1:17788 启动失败（端口可能被占用），外部写入方通道不可用。');
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // 非 macOS：关闭即退出
    if (process.platform !== 'darwin') app.quit();
  });

  // 退出前停掉 loopback，释放端口
  app.on('before-quit', () => {
    void stopLoopbackServer();
  });
  app.on('will-quit', () => {
    void stopLoopbackServer();
  });
}
