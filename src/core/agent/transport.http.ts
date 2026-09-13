/**
 * Agent 导入通道 · **NAS（HTTP）形态**的浏览器端客户端（v0.7 · T03-B · 设计文档 §3.1/§3.2/§3.4）。
 *
 * ── 本文件解决什么 ──
 * `AgentIngressPanel` 是**纯展示**（收 props、发回调）。它需要的那几个「外部事实」
 * ——服务是否活着、版本号、席位占用、项目数——必须由**真的发一次请求**才能得到。
 * 本文件就是那次请求：把 `server/routes/agent.routes.ts` 的三个端点包成
 * `probe()` / `importTasks()` 两个函数，供页面调用。
 *
 * ── 为什么放在 `src/core/agent/` 而不是 `src/lib/` ──
 *   1. 与 `transport.contract.ts`（T01 冻结的通道契约注册表）**同一层**：
 *      契约描述「通道长什么样」，本文件是「NAS 形态的那一份实现」；
 *   2. 本文件零 DOM 依赖（不碰 `window` / `document` / `localStorage`），
 *      因此满足 `src/core/agent/**` 的**共享内核纯净性守卫**
 *      （`tests/arch-boundary.spec.ts`：内核不得出现浏览器/Node 专属 API）。
 *      ★ token 的**持久化**刻意不在本文件——那是页面的事。本文件只接受 token 入参，
 *      不经手任何存储，既守住内核纯净性，也让「token 存哪」只有一个出处。
 *
 * ── 只依赖原生 fetch（零新增依赖，§8.1）──
 * 仓库不引入 axios 之类；`fetch` 在浏览器与 Node18+ 均为内置全局。
 *
 * ── ⚠️ 为什么用 `getFetch()` 从 `globalThis` 取，而不是直接写 `fetch(...)` ──
 * `server/tsconfig.json` 的 `include` **显式纳入 `../src/core/agent/**`**，且其
 * `lib` 只有 `ES2020`（**无 DOM**）。若这里直接引用裸全局 `fetch`，本文件在
 * **服务端**类型检查下会取决于 `@types/node` 的版本是否声明了该全局——一旦某个
 * 环境没声明，`npm run typecheck:server` 就会红，而前端全绿，属于"只在另一端暴露"的
 * 事故（与 arch-boundary 守卫要防的正是同一类）。显式从 `globalThis` 取 + 声明**本模块
 * 自己需要的最小形状**，两端 lib 差异就完全不影响本文件。同理，`AbortController` /
 * `AbortSignal` 也**不写类型名**（那是 DOM 类型），只按结构取构造器。
 *
 * ── 错误语义（两条通道**刻意不同**，别"统一"）──
 *   · `probe()` —— **永不抛**。探活是"问一句在不在"，答"不在"是**正常结果**
 *     （返回 `{ ok:false }`），不是异常。若它抛，页面就得为"服务没开着"这种
 *     日常情况写 try/catch，迟早会漏一处 → 白屏。V1-13「假无响应」要防的正是
 *     "点了探测什么都没发生"。
 *   · `importTasks()` —— **映射后抛 `ChangxiaError`**。写库失败必须让调用方
 *     知道并展示原因；静默返回一个空结果是不可接受的（调用方会以为写成功了）。
 *     四个 HTTP 类别（200/400/401/500）+ 网络异常全部有明确去向。
 */

import { ChangxiaError, ChangxiaErrorCode } from '../types/enums';
import type { AgentImportQuery, ApplyResult } from '../types/agent-payload';

/* ============================================================================================
 * 一、跨 lib 安全的 fetch 最小适配
 * ============================================================================================ */

/** 本模块真正用到的响应形状（只取三个成员，不依赖 DOM lib 的 `Response`） */
interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** `fetch` 第二参数的最小形状；`signal` 声明为 `unknown`，避免写 DOM 的 `AbortSignal` 类型名 */
interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
}

type FetchLike = (input: string, init?: RequestInitLike) => Promise<HttpResponseLike>;

/** 取全局 `fetch`；运行环境没有（极老环境/被裁剪的宿主）→ 返回 null，由调用方降级 */
function getFetch(): FetchLike | null {
  const f = (globalThis as { fetch?: unknown }).fetch;
  return typeof f === 'function' ? (f as FetchLike) : null;
}

/** 取全局 `AbortController`（超时用）；同样不写 DOM 类型名 */
function newAbortController(): { signal: unknown; abort(): void } | null {
  const Ctor = (
    globalThis as {
      AbortController?: new () => { signal: unknown; abort(): void };
    }
  ).AbortController;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/* ============================================================================================
 * 二、常量（单一出处）
 * ============================================================================================ */

/**
 * 探活 / 导入的超时（毫秒）。
 *
 * 为什么必须有：NAS 地址**由用户手输**，打错一个字符就会连到一个黑洞地址，
 * 浏览器会一直挂着（TCP 层面可能几十秒才放弃）。没有超时，用户点了「一键探测」
 * 会看到按钮永远"没反应"——正是 V1-13 要防的假无响应。
 * 8s：比局域网正常往返（<200ms）宽出两个数量级，又短到用户还愿意等。
 */
export const AGENT_HTTP_TIMEOUT_MS = 8000;

/** 探活端点（§3.2） */
export const AGENT_HEALTH_PATH = '/api/agent/health';
/** 导入端点（§3.1） */
export const AGENT_IMPORT_PATH = '/api/agent/import';

/**
 * 鉴权头名（与 `server/lib/agent-auth.ts` 的 `extractToken` **逐字对齐**）。
 * 服务端两种头都收（`X-Agent-Token` / `Authorization: Bearer`），此处用前者——
 * 它是服务端 401 文案里**明确让用户配**的那一个，两边指同一处才不会让人排查错方向。
 */
export const AGENT_TOKEN_HEADER = 'X-Agent-Token';

/** 探活失败时 `version` 的展示占位（不编造版本号：显示"—"比显示一个假号诚实） */
const UNKNOWN_VERSION = '—';

/* ============================================================================================
 * 三、探测结果的**展示视图**
 * ============================================================================================ */

/**
 * 探活结果的展示视图。
 *
 * ⚠️ 字段与 `AgentIngressPanel` 的 `IngressProbeView`（同名字段）**必须结构兼容**。
 * 本文件**刻意不 import 那个类型**：`AgentIngressPanel.tsx` 是组件（含 JSX），
 * 而 `server/tsconfig.json` 会 type-check `src/core/agent/**`——一旦这里 import 了 .tsx，
 * 组件就会被拉进**没有配 `jsx` 选项**的服务端编译单元，`typecheck:server` 当场红。
 * 故两处形状的一致性由**页面**的那一行赋值兜底（见 `AgentBoardPage`：
 * `const probe: IngressProbeView | null = …`，字段一漂移该行即编译失败）。
 */
export interface AgentProbeView {
  ok: boolean;
  version: string;
  /** 数据层是否就绪（§3.2 本机 loopback 形态附加；NAS HTTP 形态**没有**这个字段，故不填） */
  dataLayer?: 'ready' | 'unavailable';
  seatUsed?: number;
  seatLimit?: number;
  projectCount?: number;
}

/* ============================================================================================
 * 四、纯函数：URL 归一 / 响应映射（可单测，不含 IO）
 * ============================================================================================ */

/**
 * 归一化 base URL：补协议、去尾斜杠、去空白。
 *
 * `127.0.0.1:17788`（面板的 `LOOPBACK_ORIGIN` 就是**不带协议**的形态）必须补成
 * `http://127.0.0.1:17788`——否则浏览器会把 `127.0.0.1:17788/api/...` 当成
 * **相对路径**拼到当前页面下，请求发到一个根本不存在的地址，表现为"永远连不上"。
 * 判定用 `scheme://` 而非"含冒号"：`127.0.0.1:17788` 也含冒号，用后者会漏补。
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/** 拼端点 URL（`base` 假定已归一；空 base 返回空串，由调用方判空） */
export function buildEndpointUrl(base: string, path: string): string {
  return base ? `${base}${path}` : '';
}

/**
 * `GET /api/agent/health` 的响应体 → 展示视图。
 *
 * 逐字对齐 `agent.routes.ts:344-349` 的实际响应：
 *   `{ ok: true, version, projects: [{id,name}], agentSeats: { used, limit } }`
 *
 * 防御式读取：本函数**绝不抛**。服务端字段缺失（版本读不到、或响应被中间层
 * 改写）时，宁可少显示一个数字，也不能让探活面板整块崩掉。
 * `ok` 只认**严格 `true`**——把 `"true"` / `1` 当成功会掩盖契约漂移。
 */
export function mapHealthResponse(body: unknown): AgentProbeView {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, version: UNKNOWN_VERSION };
  }
  const b = body as {
    ok?: unknown;
    version?: unknown;
    projects?: unknown;
    agentSeats?: unknown;
  };
  if (b.ok !== true) return { ok: false, version: UNKNOWN_VERSION };

  const seats =
    typeof b.agentSeats === 'object' && b.agentSeats !== null
      ? (b.agentSeats as { used?: unknown; limit?: unknown })
      : null;
  const used = typeof seats?.used === 'number' ? seats.used : undefined;
  const limit = typeof seats?.limit === 'number' ? seats.limit : undefined;

  return {
    ok: true,
    version:
      typeof b.version === 'string' && b.version.length > 0 ? b.version : UNKNOWN_VERSION,
    ...(used !== undefined ? { seatUsed: used } : {}),
    ...(limit !== undefined ? { seatLimit: limit } : {}),
    ...(Array.isArray(b.projects) ? { projectCount: b.projects.length } : {}),
  };
}

/**
 * 服务端错误体 → `ChangxiaError`。
 *
 * 契约形状（`agentUnauthorizedBody()` / 本作用域错误处理器）恒为
 * `{ error: { code, userMessage } }`。取不到 `userMessage` 时**用兜底文案**，
 * 不把原始 body 抖给用户（可能含内部细节）；但 `code` 会保留在 message 里便于排查。
 *
 * 状态码 → 错误码的映射（`ChangxiaErrorCode` 没有 Auth 一档，故 401 归 Validation）：
 *   401 → Validation · token 是**用户输入**，配错了就得改，重试无用。
 *                     归 Network 会误导用户"再试一次"，而真正要做的是去服务端配 env。
 *   400 → Validation · 契约里 400 的四种 code（Validation / invalid_field /
 *                      project_unresolved / too_large）全都是"请求内容要改"。
 *   404 → NotFound   · 端点在目标服务上不存在（版本不匹配 / 地址指到了别的服务）。
 *   其余 → Storage   · 5xx 等：传输成功了、服务端自己失败。归 Storage 而非 Network
 *                      ——`Network` 在本仓语义是"传输没完成"，5xx 是**完成了**的响应。
 */
export function mapHttpError(status: number, body: unknown): ChangxiaError {
  const parsed =
    typeof body === 'object' && body !== null
      ? (body as { error?: { code?: unknown; userMessage?: unknown } }).error
      : undefined;
  const serverMessage =
    typeof parsed?.userMessage === 'string' && parsed.userMessage.length > 0
      ? parsed.userMessage
      : null;
  const serverCode = typeof parsed?.code === 'string' ? parsed.code : undefined;

  const fallback = `Agent 通道请求失败（HTTP ${status}${serverCode ? ` · ${serverCode}` : ''}）。`;

  if (status === 401) {
    return new ChangxiaError(ChangxiaErrorCode.Validation, serverMessage ?? fallback);
  }
  if (status === 400) {
    return new ChangxiaError(ChangxiaErrorCode.Validation, serverMessage ?? fallback);
  }
  if (status === 404) {
    return new ChangxiaError(ChangxiaErrorCode.NotFound, serverMessage ?? fallback);
  }
  if (status === 409) {
    return new ChangxiaError(ChangxiaErrorCode.Conflict, serverMessage ?? fallback);
  }
  return new ChangxiaError(ChangxiaErrorCode.Storage, serverMessage ?? fallback);
}

/** 安全解析 JSON（非 JSON / 空 body → null，不抛） */
export function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** `AgentImportQuery` → query string（只带**有值**的键；空串一律不发） */
export function buildImportQuery(query: AgentImportQuery | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value.trim().length > 0) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/* ============================================================================================
 * 五、IO：探活 / 导入
 * ============================================================================================ */

/** 统一发一次请求并读回文本；网络异常/超时 → 抛 `ChangxiaError(Network)` */
async function requestText(
  url: string,
  init: RequestInitLike,
): Promise<{ ok: boolean; status: number; text: string }> {
  const doFetch = getFetch();
  if (!doFetch) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Network,
      '当前运行环境不提供 fetch，无法访问 Agent 通道。',
    );
  }

  const controller = newAbortController();
  const timer: ReturnType<typeof setTimeout> | null = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          /* 忽略：已在完成态中止 */
        }
      }, AGENT_HTTP_TIMEOUT_MS)
    : null;

  try {
    const res = await doFetch(url, controller ? { ...init, signal: controller.signal } : init);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === 'AbortError';
    throw new ChangxiaError(
      ChangxiaErrorCode.Network,
      aborted
        ? `连接超时（${AGENT_HTTP_TIMEOUT_MS / 1000}s）：请检查地址是否可达、服务是否已启动。`
        : '无法连接到该地址：请检查地址、网络与服务是否已启动。',
      err,
    );
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * 探活：`GET {baseUrl}/api/agent/health`（带 token）。
 *
 * ★ **永不抛**（见文件头「错误语义」）：网络不通 / 401 / 非 2xx / 响应畸形
 *   一律返回 `{ ok:false, version:'—' }`，页面据此渲染「不可连通」。
 *   `baseUrl` 为空（用户还没填地址）同样返回 `ok:false`，不发请求。
 *
 * @param baseUrl NAS 地址或 `127.0.0.1:17788`（内部会补协议）
 * @param token   访问令牌；空串表示未配置（服务端 fail-closed → 401 → ok:false）
 */
export async function probe(baseUrl: string, token: string): Promise<AgentProbeView> {
  const base = normalizeBaseUrl(baseUrl);
  const url = buildEndpointUrl(base, AGENT_HEALTH_PATH);
  if (!url) return { ok: false, version: UNKNOWN_VERSION };

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token.trim()) headers[AGENT_TOKEN_HEADER] = token.trim();

  try {
    const res = await requestText(url, { method: 'GET', headers });
    if (!res.ok) return { ok: false, version: UNKNOWN_VERSION };
    return mapHealthResponse(parseJsonSafe(res.text));
  } catch {
    // 探活的"答不上来"是正常结果，不是异常 → 一律吞成 ok:false
    return { ok: false, version: UNKNOWN_VERSION };
  }
}

/**
 * 导入：`POST {baseUrl}/api/agent/import`（带 token；落点名走 query，见 §3.1 决策 2）。
 *
 * ★ 与 `probe` 相反：失败**必须抛** `ChangxiaError`（见文件头「错误语义」）。
 *   200/400/401/404/409/5xx/网络异常全部有明确去向，**没有静默分支**。
 *
 * `dryRun` 语义**原样透传**，本函数不替调用方翻转：`AgentImportQuery.dryRun` 只允许
 * `'1'`，字段缺省即实写。仓库既有纪律是"不静默降级"——替调用方把实写改成 dryRun
 * 会让对方以为写进去了，比起把 dryRun 误当实写更难排查（后者至少看得见）。
 *
 * @returns 服务端原样回执 `ApplyResult`（四键恒定，§3.1「回执不加工」）
 */
export async function importTasks(
  baseUrl: string,
  token: string,
  payload: unknown,
  query?: AgentImportQuery,
): Promise<ApplyResult> {
  const base = normalizeBaseUrl(baseUrl);
  const url = buildEndpointUrl(base, AGENT_IMPORT_PATH);
  if (!url) {
    throw new ChangxiaError(ChangxiaErrorCode.Validation, '请先填写 Agent 服务地址。');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token.trim()) headers[AGENT_TOKEN_HEADER] = token.trim();

  const res = await requestText(`${url}${buildImportQuery(query)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const body = parseJsonSafe(res.text);
  if (!res.ok) throw mapHttpError(res.status, body);
  if (body === null) {
    throw new ChangxiaError(
      ChangxiaErrorCode.ParseFailed,
      '服务端返回的不是合法 JSON，无法确认导入结果。',
    );
  }
  return body as ApplyResult;
}
