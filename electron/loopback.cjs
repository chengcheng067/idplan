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
/**
 * loopback 端口（运行时读取，默认 17788——接入文件/指令块里的地址就是它，
 * **生产不改**）。为什么是函数而非常量：测试要真起 server 做路由/CORS 断言，
 * 而用户正在运行的应用占着 17788；常量在 require 时冻结，测试只能靠
 * 「import 前设 env」且撞 PID 复用/TIME_WAIT（9-28 实测：整族 500 无尸首）。
 * 运行时读取让 spec 能先探明空闲端口再起服。
 */
function loopbackPort() {
  return Number(process.env.IDPLAN_LOOPBACK_PORT) || 17788;
}
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

/**
 * CORS 头（2026-09-24 补；用户实测「一键探测」显示不可连通的根因）。
 *
 * 面板里的探测是**渲染页面发起的跨源 fetch**（页面 origin 是自定义协议
 * idplan:// 或 dev 的 localhost:5173，目标是 127.0.0.1:17788）——没有
 * Access-Control-Allow-Origin 时浏览器直接拦响应，curl 能通、面板却「不可连通」。
 * 为什么 `*` 可接受：本服务严格绑 127.0.0.1（不对外暴露）且写操作有令牌门，
 * CORS 在这里防的不是「外部站点偷数据」而是浏览器同源策略的机械拦截；
 * 放开 `*` 只是让本机页面能读到自己机器的响应，不新增攻击面。
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Token',
};

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...CORS_HEADERS,
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
/**
 * 转发渲染进程并等回传（泛化：import / boards / tasks 三类请求共用同一在途表与超时）。
 * `eventName` 决定渲染侧哪条监听器接活；回传一律走 `agent:import-result`
 * （渲染侧 runAgent* 系列统一回这个事件，主进程按 requestId 解挂）。
 */
function forwardToRenderer(request, eventName = 'agent:import-request') {
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
      win.webContents.send(eventName, request);
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

/**
 * Bearer 鉴权（fail-closed）。返回 true = 通过；false = 已写好 401 响应。
 * import / boards 共用——令牌门是通道级纪律，不允许某个写端点"忘了查"。
 */
function checkBearerToken(req, res) {
  // 两种头二选一（与 server/lib/agent-auth.ts 同口径）：Authorization: Bearer <t>
  // 或 X-Agent-Token: <t>。桌面旧版只读 Authorization，而仓库自家 transport.http
  // 专用 X-Agent-Token ⇒ 自家路径拿正确令牌也吃 401「令牌无效」（走查发现 #10）。
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const fromHeader = m ? m[1].trim() : '';
  const fromAlt = typeof req.headers['x-agent-token'] === 'string' ? req.headers['x-agent-token'].trim() : '';
  const provided = fromHeader || fromAlt;
  if (!configuredToken) {
    sendJson(res, 401, {
      error: {
        code: 'unauthorized',
        userMessage: '未配置访问令牌，拒绝写入。请在 ID Plan 接入面板配置令牌。',
      },
    });
    return false;
  }
  if (!provided || provided !== configuredToken) {
    sendJson(res, 401, {
      error: { code: 'unauthorized', userMessage: '令牌无效，拒绝写入。' },
    });
    return false;
  }
  return true;
}

async function handleImport(req, res, url) {
  // 1) content-type 必须是 application/json
  const ct = req.headers['content-type'] || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return sendJson(res, 415, {
      error: { code: 'invalid_content_type', userMessage: '仅接受 application/json。' },
    });
  }

  // 2) 鉴权
  if (!checkBearerToken(req, res)) return;

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

  // 4) query 参数（2026-09-28 走查修复：桌面/service 两通道口径对齐）
  //
  // ① dryRun：**出现且非 ''/'0'/'false' 即预览**——与 api-contract.md 及服务端
  //   agent.routes.ts 逐字同口径（契约明言「偏向安全」）。旧版只认严格小写
  //   '1'/'true' ⇒ ?dryRun=yes/TRUE/2 被静默**实写**（写方以为预览、库已落数据，
  //   实机坐实的最高危偏差）。
  const dryRunRaw = url.searchParams.get('dryRun');
  const dryRun =
    dryRunRaw !== null && dryRunRaw !== '' && dryRunRaw !== '0' && dryRunRaw !== 'false';

  // ② 落点项目：契约名 `projectId`（服务端同）；桌面历史别名 `project`（v0.8 面板
  //   自带此形）继续兼容。同传不同值/出现但空 → 400（不猜测落点）。
  const hasProject = url.searchParams.has('project');
  const hasProjectId = url.searchParams.has('projectId');
  const projectRaw = url.searchParams.get('project');
  const projectIdRaw = url.searchParams.get('projectId');
  const isBlank = (v) => v === null || v.trim() === '';
  if ((hasProject && isBlank(projectRaw)) || (hasProjectId && isBlank(projectIdRaw))) {
    return sendJson(res, 400, {
      error: {
        code: 'invalid_field',
        userMessage: 'query 参数出现但值为空/仅空白：显式声明落点时不能给空（系统不当作「未声明」）。',
      },
    });
  }
  if (hasProject && hasProjectId && projectRaw.trim() !== projectIdRaw.trim()) {
    return sendJson(res, 400, {
      error: {
        code: 'invalid_field',
        userMessage:
          'query 参数 project 与 projectId 同传但取值不同：两者是同义别名（契约名 projectId），取值必须一致。',
      },
    });
  }
  const projectId = (hasProjectId ? projectIdRaw : projectRaw)?.trim() || undefined;

  // ③ 落点阶段名：主名 `stageName` + 同义别名 `createStageIfMissing`（服务端同构）。
  //    同传不同值 → 400；出现但空 → 400（都不静默降级）。
  const hasStageName = url.searchParams.has('stageName');
  const hasCreateAlias = url.searchParams.has('createStageIfMissing');
  const stageNameRaw = url.searchParams.get('stageName');
  const createAliasRaw = url.searchParams.get('createStageIfMissing');
  if ((hasStageName && isBlank(stageNameRaw)) || (hasCreateAlias && isBlank(createAliasRaw))) {
    return sendJson(res, 400, {
      error: {
        code: 'invalid_field',
        userMessage:
          'query 参数出现但值为空/仅空白：显式声明落点阶段名时不能给空名称（系统不会把它当作「未声明」）。',
      },
    });
  }
  if (hasStageName && hasCreateAlias && stageNameRaw.trim() !== createAliasRaw.trim()) {
    return sendJson(res, 400, {
      error: {
        code: 'invalid_field',
        userMessage: 'query 参数 stageName 与 createStageIfMissing 同传但取值不同：两者是同义别名，取值必须一致。',
      },
    });
  }
  const stageName = (hasStageName ? stageNameRaw : createAliasRaw)?.trim() || undefined;

  // ④ stageId（批次级覆盖）：优先于 body.stageId，直接合成进 payload——渲染侧
  //   resolve() 只认 payload.stageId，旧版桌面完全忽略此参数 ⇒ 静默落错批（实机坐实）。
  const stageIdRaw = url.searchParams.get('stageId');
  if (stageIdRaw !== null && stageIdRaw.trim() === '') {
    return sendJson(res, 400, {
      error: { code: 'invalid_field', userMessage: 'query 参数 stageId 出现但值为空/仅空白。' },
    });
  }
  const effectiveStageId = stageIdRaw?.trim() || undefined;
  const effectivePayload =
    effectiveStageId && payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, stageId: effectiveStageId }
      : payload;
  // 落点名与 stageId 互斥（query 或 body 任一）——与服务端口径一致
  const bodyStageId =
    payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.stageId === 'string'
      ? payload.stageId
      : undefined;
  if (stageName !== undefined && (effectiveStageId !== undefined || bodyStageId !== undefined)) {
    return sendJson(res, 400, {
      error: {
        code: 'invalid_field',
        userMessage:
          '落点阶段名与 stageId 互斥（?stageId 或 body.stageId 与落点名同传）：语义重叠说明调用方对落点不确定，系统报错而不是猜测。',
      },
    });
  }
  const requestId = crypto.randomUUID();

  // 5) 转发渲染进程并等待回传
  let forwarded;
  try {
    forwarded = await forwardToRenderer({
      requestId,
      dryRun,
      projectId,
      stageName,
      payload: effectivePayload,
    });
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

/**
 * POST /api/agent/boards（2026-09-24 补齐；实测报告：承诺四端点、桌面只通两个）。
 *
 * ★ 主进程**不校验、不写库**：建板的全部校验（name / 起止日期 / 阶段集合，
 *   fail fast 零写入）在渲染侧 `ProjectService.createAgentBoard`——与服务端路由
 *   同源的那份实现。主进程只转发，避免第二份校验口径（报告第四节的老病）。
 * ★ 只新建：body 出现 projectId / projectName 直接 400（与服务端同口径——
 *   把调用方的误解说清楚；建板通道的形状就决定了它碰不到已有项目）。
 */
async function handleBoards(req, res) {
  const ct = req.headers['content-type'] || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return sendJson(res, 415, {
      error: { code: 'invalid_content_type', userMessage: '仅接受 application/json。' },
    });
  }
  if (!checkBearerToken(req, res)) return;

  let body;
  try {
    body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch (e) {
    const err = e;
    if (err.httpStatus) {
      return sendJson(res, err.httpStatus, {
        error: { code: err.code || 'bad_request', userMessage: err.userMessage || '读取请求体失败。' },
      });
    }
    return sendJson(res, 400, {
      error: { code: 'invalid_json', userMessage: 'payload 不是合法 JSON。' },
    });
  }
  if (body && typeof body === 'object' && ('projectId' in body || 'projectName' in body)) {
    return sendJson(res, 400, {
      error: {
        code: 'invalid_field',
        userMessage:
          '建板通道**只新建**看板，不接受 projectId / projectName（那是导入通道的落点解析参数）。' +
          '要往已有项目写任务，请用 POST /api/agent/import。',
      },
    });
  }

  let forwarded;
  try {
    forwarded = await forwardToRenderer(
      { requestId: crypto.randomUUID(), kind: 'create-board', body },
      'agent:create-board-request',
    );
  } catch (e) {
    const err = e;
    return sendJson(res, err.httpStatus || 504, {
      error: { code: err.code || 'gateway', userMessage: err.userMessage || '转发失败。' },
    });
  }
  if (forwarded && forwarded.error) {
    const fe = forwarded.error;
    return sendJson(res, typeof fe.httpStatus === 'number' ? fe.httpStatus : 400, {
      error: { code: fe.code || 'apply_failed', userMessage: fe.userMessage || '建板失败。' },
    });
  }
  // 201 Created：与服务端 boards 端点同状态码（写入方按 2xx 判成功，201 更精确）
  sendJson(res, 201, forwarded.result);
}

/**
 * GET /api/agent/tasks（2026-09-24 补齐；只读）。
 *
 * 归属门在渲染侧（共享核心口径）：显式 projectId 非 Agent 看板 → 拒；
 * 未指定 → 只回 Agent 看板的任务（读侧隔离边界，与服务端同义）。
 * 返回字段逐字镜像服务端（externalId / taskNo / title / status / dueDate /
 * dependsOnExternal）——两端漂移会让写入方在同一份代码里得到两种形状。
 */
async function handleTasks(req, res, url) {
  if (!checkBearerToken(req, res)) return;
  const projectId = url.searchParams.get('projectId') || undefined;
  // source 透传（仅 agent/human 生效，与服务端同口径；旧版桌面完全忽略此参数）
  const sourceRaw = url.searchParams.get('source');
  const source =
    sourceRaw === 'agent' || sourceRaw === 'human' ? sourceRaw : undefined;

  let forwarded;
  try {
    forwarded = await forwardToRenderer(
      { requestId: crypto.randomUUID(), kind: 'list-tasks', projectId, source },
      'agent:list-tasks-request',
    );
  } catch (e) {
    const err = e;
    return sendJson(res, err.httpStatus || 504, {
      error: { code: err.code || 'gateway', userMessage: err.userMessage || '转发失败。' },
    });
  }
  if (forwarded && forwarded.error) {
    const fe = forwarded.error;
    return sendJson(res, typeof fe.httpStatus === 'number' ? fe.httpStatus : 400, {
      error: { code: fe.code || 'read_failed', userMessage: fe.userMessage || '读取任务失败。' },
    });
  }
  sendJson(res, 200, forwarded.result);
}

function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${LOOPBACK_HOST}:${loopbackPort()}`);
  } catch {
    return sendJson(res, 400, { error: { code: 'bad_request', userMessage: '非法请求 URL。' } });
  }

  // 预检（跨源 fetch 带 Authorization 头必触发 OPTIONS）：直接 204 + CORS 头。
  // 放在路由之前：预检不带令牌，走业务分支只会 401 把浏览器挡在门外。
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/health') {
    return handleHealth(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/import') {
    return handleImport(req, res, url);
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/boards') {
    return handleBoards(req, res);
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/tasks') {
    return handleTasks(req, res, url);
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
      if (process.env.LOOPBACK_DEBUG_REQ) process.stdout.write(`[req] ${req.method} ${req.url}
`);
      try {
        handle(req, res);
      } catch (err) {
        // ★ 500 绝不静默（仓库纪律）：把真实栈打到主进程控制台，否则「全 500」时
        //   排查者面对的是一个没有尸体的命案（9-28 全量跑实测踩过：两 spec 经
        //   nodeRequire 共享模块实例，症状是整条路由族 500、无任何线索）
        // eslint-disable-next-line no-console
        // eslint-disable-next-line no-console
        console.error('[loopback] handler error:', err);
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
    server.listen(loopbackPort(), LOOPBACK_HOST, () => {
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
    // ★ keep-alive 连接必须先断（Node 18.2+）：只 close() 会等浏览器/探针的
    //   保活连接自然超时（实测可滞留数十秒）——「服务器关了但端口还占着」
    //   会让紧随其后的重启吃 EADDRINUSE（热重载/测试连跑都踩过）。
    if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    s.close(() => resolve());
  });
}

module.exports = {
  LOOPBACK_HOST,
  loopbackPort,
  /**
   * 路由本体导出（9-28：供进程内 spec 直调）。export 它不是为了运行时——
   * main 只经 start/stop/setToken 打交道——而是让测试能**不起真 HTTP server**
   * 就覆盖路由/CORS/鉴权/query 解析（真起 server 在某些环境 event-loop 级不稳：
   * socket 可连但 HTTP 无响应、定时器不触发，见 agent-loopback-server.spec 头注）。
   * 是纯函数形状：给 req/res 即出响应，无隐藏 IO。
   */
  handle,
  CORS_HEADERS,
  setLoopbackToken,
  resolveLoopbackResult,
  resolveLoopbackPong,
  startLoopbackServer,
  stopLoopbackServer,
};
