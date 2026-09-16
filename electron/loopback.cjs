/**
 * ID Plan · 本机 Agent loopback（v1.0 · P0 第一优先）。
 *
 * ── 为什么存在 ──
 * 外部写入方（WorkBuddy 等）要把排期 payload 直接写进**正在运行**的 ID Plan，
 * 替代「手动复制粘贴 JSON」。但 Dexie 活在**渲染进程**，主进程起再漂亮的 HTTP server
 * 也写不到渲染进程的库。故 loopback 是**三段式**：
 *   外部 HTTP 请求 → 主进程 server（绑 127.0.0.1:17788）
 *     → main 经 IPC 转发给渲染进程 → 渲染进程用现有 payload.apply + 自己的 repos 落库
 *     → 结果沿 IPC 回传 → HTTP 响应。
 *
 * ── 约束（派单硬要求）──
 *   1. 用 Node 内置 `node:http`，**不引 fastify**（避免把它拖进 Electron 主进程 / 打包产物）。
 *   2. 严格绑 `127.0.0.1:17788`，**绝不绑 `0.0.0.0`**（不对外暴露）。
 *   3. 端口被占用 → 优雅失败：记录原因、不崩溃、不影响应用启动。
 *   4. 鉴权：`Authorization: Bearer <token>`，token 由渲染进程经 IPC 告知主进程
 *      （主进程**只留着比对，绝不回传原文**）；**未配置 token 时拒绝写入**并返回 401。
 *   5. 转发：每请求生成 requestId，`webContents.send('agent:import-request', ...)` 发给渲染
 *      进程，等 `ipcMain.on('agent:import-result')` 回传，带 10s 超时；超时 / 渲染未就绪
 *      → 明确 HTTP 错误，**不静默挂起**。
 *   6. 只收 `application/json`，body 上限 2MB，超出 413。
 *
 * ── token 的内存 / 持久化取舍 ──
 *   token 只存主进程**内存**（经 IPC 设置）。不写磁盘：token 的持久化唯一出处是
 *   渲染进程的 `localStorage`（`idplan.agentToken`）——授予「绝不回显原文」纪律的同一条
 *   链。主进程崩溃/重启后由渲染进程重新 `setAgentToken` 即可，无状态恢复负担。
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { BrowserWindow } = require('electron');

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = 17788;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const REQUEST_TIMEOUT_MS = 10000;
/** 探活超时：远短于写入超时，health 不该让调用方等 10s */
const PING_TIMEOUT_MS = 1500;
const APP_VERSION = require('../version.json').version;

/** token 只存比对，绝不回传原文 */
let configuredToken = null;
/** 挂起的转发请求：requestId → { resolve, reject, timer } */
const pending = new Map();
/** 探活在途表（与落库在途表分开，见 resolveLoopbackPong） */
const pendingPings = new Map();

let server = null;

/** 取一个可用渲染窗口（主进程转发落库请求的出口） */
function getMainWindow() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) return win;
  }
  return null;
}

/** 渲染进程经 IPC 告知 token（仅比对，绝不回传原文） */
function setLoopbackToken(token) {
  configuredToken = typeof token === 'string' ? token : null;
}

/** 渲染进程经 IPC 回传某个请求的结果 / 错误 */
function resolveLoopbackResult(requestId, payload) {
  if (!requestId) return;
  const entry = pending.get(requestId);
  if (!entry) return; // 已超时或未知请求：忽略
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(payload);
}

/**
 * 渲染进程回 ping（探活专用）。
 *
 * ★ 与落库回传**分开一张表**：ping 的语义只是「监听器活着吗」，不携带 ApplyResult。
 *   混用会让一次 ping 把一个空 result 当成导入结果 resolve 掉。
 */
function resolveLoopbackPong(requestId) {
  if (!requestId) return;
  const entry = pendingPings.get(requestId);
  if (!entry) return; // 已超时：忽略
  clearTimeout(entry.timer);
  pendingPings.delete(requestId);
  entry.resolve(true);
}

/**
 * 探活：主进程发 `agent:ping`，渲染侧 `useAgentLoopbackReceiver` **立即回 pong、不碰数据库**。
 *
 * ── 为什么 health 不能只看「窗口在不在」 ──
 * 旧写法 `win ? 'ready' : 'unavailable'` 只看 BrowserWindow 存在与否。落库监听器上提为
 * 常驻之前，监听器挂在 Agent 看板页：用户在首页时窗口在、监听器不在 ⇒ 面板显示
 * 「可连通 · 数据层就绪」，外部 POST 却要等满 10s 才 503 —— 正是本项目反复禁止的假阳性。
 * 故改为**真实探测**：1.5s 内收到 pong 才算 ready。
 */
function pingRenderer() {
  return new Promise((resolve) => {
    const win = getMainWindow();
    if (!win) {
      resolve(false);
      return;
    }
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingPings.delete(requestId);
      resolve(false);
    }, PING_TIMEOUT_MS);
    pendingPings.set(requestId, { resolve, timer });
    try {
      win.webContents.send('agent:ping', { requestId, kind: 'ping' });
    } catch {
      clearTimeout(timer);
      pendingPings.delete(requestId);
      resolve(false);
    }
  });
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function makeError(httpStatus, code, userMessage) {
  const e = new Error(userMessage);
  e.httpStatus = httpStatus;
  e.code = code;
  e.userMessage = userMessage;
  return e;
}

/**
 * 逐字节读 body，超限抛特定码（→ 413）。
 * 注意：超限后**绝不** `req.destroy()` —— 立即销毁 socket 会抢在 413 响应刷回客户端之前
 * 断连，客户端（undici fetch）只能拿到 ECONNRESET。正确做法是置 overflow 标志、拒绝 Promise，
 * 让 handleImport 的 catch 把 413 真正写回；'data' 后续分片直接丢弃，'end'/'error' 在 overflow
 * 时已不会发生有用结果，一律忽略。
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > maxBytes) {
        overflow = true;
        reject(makeError(413, 'too_large', 'payload 超过 2MB 上限。'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!overflow) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (!overflow) reject(makeError(400, 'bad_request', '读取请求体失败。'));
    });
  });
}

/** 把写入请求转发到渲染进程并等待回传（10s 超时） */
function forwardToRenderer(request) {
  return new Promise((resolve, reject) => {
    const win = getMainWindow();
    if (!win) {
      reject(makeError(503, 'data_layer_unavailable', 'ID Plan 渲染窗口未就绪，无法写入。'));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(request.requestId);
      reject(makeError(504, 'gateway_timeout', '外部写入等待渲染进程响应超时（10s）。'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(request.requestId, { resolve, reject, timer });
    try {
      win.webContents.send('agent:import-request', request);
    } catch {
      clearTimeout(timer);
      pending.delete(request.requestId);
      reject(makeError(503, 'data_layer_unavailable', '无法将写入请求转发到渲染进程。'));
    }
  });
}

async function handleHealth(_req, res) {
  // ★ 真实判定：发 ping 等 pong（1.5s）。窗口在但监听器没挂 ⇒ unavailable，
  //   绝不给「可连通」的假阳性（面板据此显示「数据层不可用」并提示打开应用）。
  const reachable = await pingRenderer();
  sendJson(res, 200, {
    ok: true,
    version: APP_VERSION,
    dataLayer: reachable ? 'ready' : 'unavailable',
  });
}

async function handleImport(req, res, url) {
  // 1) content-type 必须是 application/json
  const ct = req.headers['content-type'] || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return sendJson(res, 415, {
      error: { code: 'invalid_content_type', userMessage: '仅接受 application/json。' },
    });
  }

  // 2) 鉴权：Bearer token；未配置 token 一律拒绝（fail-closed）
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const provided = m ? m[1].trim() : '';
  if (!configuredToken) {
    return sendJson(res, 401, {
      error: {
        code: 'unauthorized',
        userMessage: '未配置访问令牌，拒绝写入。请在 ID Plan 接入面板配置令牌。',
      },
    });
  }
  if (!provided || provided !== configuredToken) {
    return sendJson(res, 401, {
      error: { code: 'unauthorized', userMessage: '令牌无效，拒绝写入。' },
    });
  }

  // 3) body（含 2MB 上限）
  let body;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch (e) {
    const err = e;
    return sendJson(res, err.httpStatus || 400, {
      error: { code: err.code || 'bad_request', userMessage: err.userMessage || '读取请求体失败。' },
    });
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return sendJson(res, 400, {
      error: { code: 'invalid_json', userMessage: 'payload 不是合法 JSON。' },
    });
  }

  // 4) query 参数
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';
  const projectId = url.searchParams.get('project') || undefined;
  const stageName = url.searchParams.get('stageName') || undefined;
  const requestId = crypto.randomUUID();

  // 5) 转发渲染进程并等待回传
  let forwarded;
  try {
    forwarded = await forwardToRenderer({ requestId, dryRun, projectId, stageName, payload });
  } catch (e) {
    const err = e;
    return sendJson(res, err.httpStatus || 504, {
      error: { code: err.code || 'gateway', userMessage: err.userMessage || '转发失败。' },
    });
  }

  if (forwarded && forwarded.error) {
    const fe = forwarded.error;
    return sendJson(res, typeof fe.httpStatus === 'number' ? fe.httpStatus : 400, {
      error: { code: fe.code || 'apply_failed', userMessage: fe.userMessage || '写入失败。' },
    });
  }
  sendJson(res, 200, forwarded.result);
}

function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`);
  } catch {
    return sendJson(res, 400, { error: { code: 'bad_request', userMessage: '非法请求 URL。' } });
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/health') {
    return handleHealth(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/import') {
    return handleImport(req, res, url);
  }
  return sendJson(res, 404, { error: { code: 'not_found', userMessage: '未知端点。' } });
}

/**
 * 启动 loopback server。
 * @returns Promise<boolean> 成功绑定返回 true；端口被占用（EADDRINUSE）等优雅失败返回 false。
 */
function startLoopbackServer() {
  if (server) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    server = http.createServer((req, res) => {
      try {
        handle(req, res);
      } catch {
        if (!res.headersSent) {
          sendJson(res, 500, { error: { code: 'internal', userMessage: '服务器内部错误。' } });
        }
      }
    });
    server.once('error', (err) => {
      // 端口被占用 / 权限不足：优雅失败，不影响应用启动
      server = null;
      finish(false);
    });
    server.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
      finish(true);
    });
  });
}

/** 停止 server，并拒绝所有挂起请求（避免泄漏） */
function stopLoopbackServer() {
  if (!server) return Promise.resolve();
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(makeError(503, 'server_stopping', 'loopback server 正在关闭。'));
  }
  pending.clear();
  for (const entry of pendingPings.values()) {
    clearTimeout(entry.timer);
  }
  pendingPings.clear();
  return new Promise((resolve) => {
    const s = server;
    server = null;
    s.close(() => resolve());
  });
}

module.exports = {
  LOOPBACK_HOST,
  LOOPBACK_PORT,
  setLoopbackToken,
  resolveLoopbackResult,
  resolveLoopbackPong,
  startLoopbackServer,
  stopLoopbackServer,
};
