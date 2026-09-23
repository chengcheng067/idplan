/**
 * loopback **服务端**路由 / CORS / 鉴权的真起测试（2026-09-24 桌面通道补齐后新增）。
 *
 * ══════════════════════ 为什么此前没有这份测试 ══════════════════════
 * `electron/loopback.cjs` 的路由逻辑此前**只在用户机器上被真跑过**——单测只覆盖
 * 渲染侧客户端（agent-loopback-channel.spec.ts）。后果实测可见：
 *   · 接入文件承诺四端点、loopback 只路由两个（404 缺口，报告第一节）；
 *   · 面板探测「不可连通」：CORS 头从未存在，跨源 fetch 被浏览器拦（报告截图）。
 * 两条都是「HTTP 层的事实」，渲染侧单测永远摸不到。故本 spec **真起 server**
 * （独立端口，不碰用户正在运行的 17788 实例），用 fetch 打真实 HTTP。
 *
 * ══════════════════════ 加载方式：createRequire + Module._load 钩子 ══════════════════════
 * loopback.cjs 是 CJS、内部 `require('electron')`。vitest 把 .cjs 转成 ESM interop
 * 后，`vi.mock('electron')` **到不了**那个 require（实测：health 挂死、转发全 504）。
 * 故这里走**真 CJS 路径**：`createRequire` 拿 require，再钩 `Module._load` 替掉
 * 'electron'——与 `node -e` 直跑验证通过的姿势逐字一致（该直跑先于本 spec 证明
 * 服务端逻辑本身全绿：health 200 / boards 201 / 转发事件名正确）。
 *
 * ══════════════════════ electron 依赖怎么替 ══════════════════════
 * loopback.cjs 只从 electron 取 `BrowserWindow.getAllWindows()`（转发出口）。
 * 假窗口的 `webContents.send` 捕获事件名与负载，测试按 requestId 经
 * `resolveLoopbackResult` / `resolveLoopbackPong` 回传——与真实渲染进程回传
 * 走的是**同一条 IPC 解挂路径**，不是另造一套。
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const TEST_PORT = 17999;
// env 必须在 loopback.cjs 模块作用域读端口**之前**就位（模块只读一次）
process.env.IDPLAN_LOOPBACK_PORT = String(TEST_PORT);

/** 捕获到的转发事件：[事件名, 负载] */
let sent: Array<[string, any]> = [];
/** 渲染侧回传策略：按请求负载回什么（null = 回空 result） */
let replyWith: ((req: any) => any) | null = null;

const wins = [
  {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (ch: string, payload: any) => {
        sent.push([ch, payload]);
        setTimeout(() => {
          if (ch === 'agent:ping') {
            lb.resolveLoopbackPong(payload.requestId);
            return;
          }
          const result = replyWith
            ? replyWith(payload)
            : { requestId: payload.requestId, result: {} };
          lb.resolveLoopbackResult(payload.requestId, result);
        }, 0);
      },
    },
  },
];

// 钩掉 'electron'：只替 BrowserWindow（loopback.cjs 唯一用到的导出）
const nodeRequire = createRequire(import.meta.url);
const Module = nodeRequire('node:module') as typeof import('node:module');
const origLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') return { BrowserWindow: { getAllWindows: () => wins } };
  return (origLoad as (...a: unknown[]) => unknown).call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lb = nodeRequire('../electron/loopback.cjs') as {
  LOOPBACK_PORT: number;
  setLoopbackToken(t: string): void;
  resolveLoopbackResult(id: string, payload: unknown): void;
  resolveLoopbackPong(id: string): void;
  startLoopbackServer(): Promise<boolean>;
  stopLoopbackServer(): Promise<void> | void;
};

const BASE = `http://127.0.0.1:${TEST_PORT}`;
const TOKEN = 'idp_test_token_loopback_server';

beforeAll(async () => {
  expect(lb.LOOPBACK_PORT, '端口覆盖未生效（会打到用户正在运行的实例上！）').toBe(TEST_PORT);
  lb.setLoopbackToken(TOKEN);
  const ok = await lb.startLoopbackServer();
  if (!ok) throw new Error(`loopback server 启动失败（端口 ${TEST_PORT} 被占？）`);
});

afterAll(async () => {
  await lb.stopLoopbackServer();
});

afterEach(() => {
  replyWith = null;
  sent = [];
});

describe('loopback 服务端 · CORS（面板探测「不可连通」的回归钉）', () => {
  it('★ health 响应带 Access-Control-Allow-Origin: *（跨源 fetch 不再被浏览器拦）', async () => {
    const res = await fetch(`${BASE}/api/agent/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('★ OPTIONS 预检 → 204 + CORS 三头（带 Authorization 的跨源写必触发预检）', async () => {
    const res = await fetch(`${BASE}/api/agent/import`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('错误响应同样带 CORS 头（401 也要能被浏览器读到，否则面板只显示网络错）', async () => {
    const res = await fetch(`${BASE}/api/agent/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('loopback 服务端 · 鉴权（fail-closed）', () => {
  it('无令牌 → 401；health 免令牌（探活语义）', async () => {
    const noAuth = await fetch(`${BASE}/api/agent/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(noAuth.status).toBe(401);

    const health = await fetch(`${BASE}/api/agent/health`);
    expect(health.status).toBe(200);
  });
});

describe('loopback 服务端 · 四端点路由（承诺 = 能力的回归钉）', () => {
  it('★ POST /api/agent/boards → 转发 agent:create-board-request，回传后 201 + 镜像体', async () => {
    replyWith = (req) => ({
      requestId: req.requestId,
      result: { projectId: 'p_new', name: 'WorkBuddy 自测板', stages: [] },
    });
    const res = await fetch(`${BASE}/api/agent/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        name: 'WorkBuddy 自测板',
        plannedStartAt: '2026-10-01',
        plannedEndAt: '2026-10-31',
        presetKey: 'indoor_full',
      }),
    });
    expect(res.status).toBe(201);
    expect(sent.map(([ch]) => ch)).toContain('agent:create-board-request');
    const body = (await res.json()) as { projectId: string };
    expect(body.projectId).toBe('p_new');
  });

  it('★ boards 带 projectId / projectName → 400 且不转发（只新建的形状纪律）', async () => {
    const res = await fetch(`${BASE}/api/agent/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'x', projectId: 'p_human' }),
    });
    expect(res.status).toBe(400);
    expect(sent).toEqual([]); // 零转发 = 渲染侧零写入
  });

  it('★ GET /api/agent/tasks → 转发 agent:list-tasks-request，回传后 200 + tasks 体', async () => {
    replyWith = (req) => ({
      requestId: req.requestId,
      result: {
        tasks: [
          { externalId: 'e1', taskNo: 1, title: 't', status: 'draft', dueDate: null, dependsOnExternal: [] },
        ],
      },
    });
    const res = await fetch(`${BASE}/api/agent/tasks`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(sent.map(([ch]) => ch)).toContain('agent:list-tasks-request');
    const body = (await res.json()) as { tasks: Array<{ externalId: string }> };
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].externalId).toBe('e1');
  });

  it('★ tasks 带 projectId 透传给渲染侧（归属门在渲染侧判，主进程不重判）', async () => {
    await fetch(`${BASE}/api/agent/tasks?projectId=p_human`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const listReq = sent.find(([ch]) => ch === 'agent:list-tasks-request');
    expect(listReq).toBeTruthy();
    expect(listReq![1].projectId).toBe('p_human');
  });

  it('POST /api/agent/import 仍走 agent:import-request（既有通道不回退）', async () => {
    replyWith = (req) => ({
      requestId: req.requestId,
      result: { created: 0, updated: 0, rejected: [] },
    });
    const res = await fetch(`${BASE}/api/agent/import?project=p_agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ schema: 'idplan-agent-payload/v1', producedBy: 'wb', tasks: [] }),
    });
    expect(res.status).toBe(200);
    expect(sent.map(([ch]) => ch)).toContain('agent:import-request');
  });

  it('未知路由 → 404（路由集没有悄悄膨胀）', async () => {
    const res = await fetch(`${BASE}/api/agent/nope`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it('渲染侧回错误 → HTTP 状态按 error.httpStatus 映射（400 不吞成 200）', async () => {
    replyWith = (req) => ({
      requestId: req.requestId,
      error: { code: 'project_unresolved', httpStatus: 400, userMessage: '不是 Agent 看板。' },
    });
    const res = await fetch(`${BASE}/api/agent/import?project=p_human`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ schema: 'idplan-agent-payload/v1', producedBy: 'wb', tasks: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('project_unresolved');
  });
});
