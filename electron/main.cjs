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
  resolveLoopbackPong,
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
//
// 解法演进（2026-09-23 二次重构，勿再回头用 titleBarOverlay）：
//   ① 第一版：titleBarStyle:'hidden' + **原生叠加层** titleBarOverlay 画三键，
//      颜色由渲染进程 'theme:set' IPC 实时下发。
//   ② 它修不好用户投诉的「弹窗一开、背景压暗，三键亮度不变像贴上去的」——
//      原因是结构性的：原生层由系统合成器画在网页之上，DOM 遮罩盖不住它；
//      压暗只能是近似（0.55× 乘出来的灰 ≠ 遮罩实际合成的灰，仍是两块色）。
//   ③ 现行：**自绘三键**（DOM 按钮，见 src/components/layout/TopBar.tsx 的
//      WindowControls）。三键与内容同层同源，随主题/遮罩自然变暗，一类问题整类消失。
//      本文件只保留窗口控制 IPC；拖拽所需的 titleBarStyle:'hidden' 保留，
//      拖拽区由 CSS 提供（global.css 的 .app-titlebar-drag / .app-no-drag）——
//      叠加层时代拖拽靠原生栏，自绘后必须显式声明，否则窗口无法移动。

/** 是否启用自绘窗口三键。仅 Windows：macOS 走系统红绿灯（自绘会破坏原生手势），
 *  Linux 走系统装饰。与 TopBar 的 usesSelfDrawnWindowControls 同源判定。 */
const USE_SELF_DRAWN_WINDOW_CONTROLS = process.platform === 'win32';

/** 窗口控制 IPC（自绘三键的宿主）：三个动作 + 最大化态查询与变更推送。 */
if (USE_SELF_DRAWN_WINDOW_CONTROLS) {
  const winOf = (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && !win.isDestroyed() ? win : null;
  };
  ipcMain.on('window:minimize', (event) => {
    winOf(event)?.minimize();
  });
  ipcMain.on('window:toggle-maximize', (event) => {
    const win = winOf(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (event) => {
    winOf(event)?.close();
  });
  ipcMain.handle('window:is-maximized', (event) => winOf(event)?.isMaximized() ?? false);
  // 最大化态变更推送：按钮图标要在「最大化 ⇄ 还原」之间切换（用户双击标题栏
  // 或按系统快捷键时同样走这条推送，否则图标与实际状态不一致）。
  const broadcastMaximize = (win) => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximize-change', win.isMaximized());
  };
  app.whenReady().then(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.on('maximize', () => broadcastMaximize(win));
      win.on('unmaximize', () => broadcastMaximize(win));
    }
  });
}

// ── 本机 Agent loopback 接线（v1.0 · P0） ──
// 渲染进程把 token 告知主进程（仅比对，绝不回传原文）
ipcMain.on('agent:token:set', (_event, token) => {
  setLoopbackToken(token);
});

// ── Agent 接入文件（v0.8 · T04-B「接入外部写入方」重设计） ──
// 外部写入方（如 WorkBuddy）读这一个文件即完成接入：地址 / 令牌 / 端点 / payload
// schema / 用法全在里面。固定路径是设计的核心——零传递成本，令牌轮换后重新生成、
// 写方重读即可。渲染进程不碰 fs（sandbox preload 也不能），落盘只在此处。
// ★ 形状门与路径是**共享 CJS 模块**（electron/ingress-file.cjs）而非内联：
//   内联版曾读错字段路径（扁平 payload.token，实际是嵌套 auth.token）把合法
//   请求判死，且无任何测试覆盖得到；共享后有契约测试钉死。
const { writeIngressFile, ingressFilePath } = require('./ingress-file.cjs');

ipcMain.handle('agent-ingress:path', () => ingressFilePath(app.getPath('documents')));

ipcMain.handle('agent-ingress:write', (_event, payload) =>
  writeIngressFile(app.getPath('documents'), payload),
);

// 渲染进程把「落库结果 / 错误」回传给挂起的 HTTP 请求
ipcMain.on('agent:import-result', (_event, payload) => {
  if (payload && typeof payload.requestId === 'string') {
    resolveLoopbackResult(payload.requestId, payload);
  }
});

// 渲染进程回 ping（health 的 dataLayer 真实判定；只证明监听器活着，不碰数据库）
ipcMain.on('agent:pong', (_event, payload) => {
  if (payload && typeof payload.requestId === 'string') {
    resolveLoopbackPong(payload.requestId);
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
    // 自绘标题栏（仅 Windows）：隐藏原生栏，三键由 DOM 自绘（TopBar.WindowControls）。
    // 注意：这里**不再有** titleBarOverlay——叠加层是系统画在网页之上的，DOM 遮罩
    // 盖不住它（用户投诉「弹窗一开三键像贴上去的」根因），自绘后随主题/遮罩自然变暗。
    // 拖拽因此必须由 CSS 声明（global.css 的 .app-titlebar-drag），不是原生栏附赠。
    // 非 Windows 不传该组键，保持系统原生标题栏（红绿灯 / 各桌面环境自绘）。
    ...(USE_SELF_DRAWN_WINDOW_CONTROLS ? { titleBarStyle: 'hidden' } : {}),
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
