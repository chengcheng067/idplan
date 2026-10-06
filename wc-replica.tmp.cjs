/**
 * wc-replica.tmp.cjs —— 一次性复刻窗口（跑完即删）。
 * 用与 main.cjs 相同的 BrowserWindow 选项（titleBarStyle:'hidden'、frame 默认、sandbox preload），
 * 页面 1:1 复刻 TopBar 的自绘三键（fixed top-0 right-0 z-[85]、3×46、高 calc+1px）+ 同款 modal 遮罩。
 * 三键 onClick 只记录 window.__wc，不做任何真实窗口操作 → 可安全反复真实点击。
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

ipcMain.on('wc:noop', () => {});
ipcMain.on('wc:toggle', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'ID Plan',
    backgroundColor: '#f8fafc',
    titleBarStyle: 'hidden', // 与 main.cjs 的 USE_SELF_DRAWN_WINDOW_CONTROLS 分支相同
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'wc-replica-preload.tmp.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:sans-serif}
    .app-titlebar-drag{-webkit-app-region:drag}
    .app-no-drag{-webkit-app-region:no-drag}
    header{position:relative;z-index:40;display:flex;height:56px;border-bottom:1px solid #ccc;background:#fff}
    .row{display:flex;height:56px;width:100%;align-items:center;gap:12px;padding:0 24px}
    .spacer{flex-shrink:0}
    .wc{position:fixed;right:0;top:0;z-index:85;display:flex;height:calc(56px + 1px);align-items:stretch;border-bottom:1px solid #ccc;background:#fff}
    .wc button{flex:none;width:46px;height:100%;display:flex;align-items:center;justify-content:center;border:0;background:transparent;font-size:14px;color:#666;cursor:pointer}
    .wc button:hover{background:#eee;color:#111}
    .overlay{position:fixed;inset:0;z-index:70;background:rgba(20,22,26,.45)}
    .panel{position:relative;margin:120px auto;width:480px;height:300px;background:#fff;border-radius:12px}
    .content{height:3000px;background:linear-gradient(#fff,#ddd)}
  </style></head><body>
    <div id="root" style="min-height:100vh">
      <header class="app-titlebar-drag">
        <div class="row">
          <div style="flex:1;min-width:0">breadcrumb</div>
          <div class="app-no-drag" style="display:flex;gap:12px;align-items:center">
            <button id="avatar" style="height:32px">avatar</button>
          </div>
          <div class="spacer" style="width:138px"></div>
        </div>
      </header>
      <main><div class="content" id="content">page content (tall)
        <button id="controlBtn" style="display:block;margin:400px auto;width:300px;height:200px;font-size:24px">CONTROL</button>
      </div>
        <button id="openModal" style="position:relative;z-index:10">open modal</button>
      </main>
      <div class="wc" id="wc" data-window-controls role="group" aria-label="窗口控制">
        <button data-window-control="minimize" aria-label="最小化">—</button>
        <button data-window-control="maximize" aria-label="最大化">▢</button>
        <button data-window-control="close" aria-label="关闭">✕</button>
      </div>
      <div class="overlay" id="overlay" style="display:none"><div class="panel">modal panel</div></div>
    </div>
    <script>
      window.__ev = [];
      window.__wc = [];
      for (const t of ['mousedown','mouseup','click']) {
        document.addEventListener(t, (e) => {
          const p = e.composedPath().slice(0,3).map(n => n && n.nodeType===1 ? (n.nodeName.toLowerCase() + (n.getAttribute && n.getAttribute('data-window-control') ? '['+n.getAttribute('data-window-control')+']' : '')) : String(n));
          window.__ev.push({ t, x: Math.round(e.clientX), y: Math.round(e.clientY), p });
        }, true);
      }
      document.querySelectorAll('[data-window-control]').forEach(b => {
        b.addEventListener('click', () => {
          const key = b.getAttribute('data-window-control');
          window.__wc.push(key);
          if (key === 'minimize') window.idplan.windowControls.minimize();
          if (key === 'maximize') window.idplan.windowControls.toggleMaximize();
          if (key === 'close') window.idplan.windowControls.close();
        });
      });
      document.getElementById('controlBtn').addEventListener('click', () => window.__wc.push('CONTROL'));
      document.getElementById('openModal').addEventListener('click', () => {
        document.getElementById('overlay').style.display = 'block';
      });
      document.getElementById('overlay').addEventListener('mousedown', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
      });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('overlay').style.display = 'none'; });
    <\/script>
  </body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});
