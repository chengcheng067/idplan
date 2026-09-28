/**
 * loopback **进程内直调** spec（路由 / CORS / 鉴权 / query 契约全覆盖）。
 *
 * ══════════════════════ 为什么从「真起 HTTP server」改为直调 handle（9-28 止损） ══════════════════════
 * 本 spec 原版真起 http server + 真 fetch/裸 http。在用户机器的 vitest worker 里它呈现
 * **event-loop 级不稳定**：socket connect-ok、但 HTTP 请求永无响应、setTimeout 兜底
 * 也不触发（裸 node server 同机对照正常）。排查过程数出并修掉了三处真实的跨 spec
 * 污染（agent-loopback-channel 裸赋 fetch 未还原 / remote-executions.e2e 与
 * execution-two-ends-parity 的 stubGlobal fetch 不还原 / nodeRequire 共享 CJS 缓存与
 * 端口互撞）——那些是真战果，但修完主症状依旧，继续挖是沉没成本。
 *
 * 止损方案：loopback.cjs 导出路由本体 `handle`（纯函数形状：req/res 进出），
 * 本 spec **进程内直调**——不起 socket、不等 timer、不碰 globalThis.fetch，
 * 覆盖度与原版逐条等价（路由分支/CORS 头/鉴权/query 解析/错误映射全在 handle 内；
 * 渲染回传改同步触发）。真 HTTP 层的补充证据：`agent-loopback-e2e.spec.ts`
 * （渲染侧落库半程）+ 0009 实机六步实测（deliverables/gstack/live-evidence-2026-09-27.md）。
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';

/** 捕获到的转发事件：[事件名, 负载] */
let sent: Array<[string, any]> = [];
/** 渲染侧回传策略（同步执行——本 spec 零 timer 依赖） */
let replyWith: ((req: any) => any) | null = null;

const nodeRequire = createRequire(import.meta.url);
const NodeModule = nodeRequire('node:module') as unknown as { _load: Function };
const origLoad = NodeModule._load;
NodeModule._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') {
    return {
      BrowserWindow: {
        getAllWindows: () => [
          {
            isDestroyed: () => false,
            webContents: {
              isDestroyed: () => false,
              send: (ch: string, payload: any) => {
                sent.push([ch, payload]);
                // 同步回传：ping 走 pong 通道（与真实 IPC 回程同一条解挂路径），
                // 其余走 result 通道（replyWith 策略决定回什么）
                if (ch === 'agent:ping') {
                  lb.resolveLoopbackPong(payload.requestId);
                  return;
                }
                const result = replyWith
                  ? replyWith(payload)
                  : { requestId: payload.requestId, result: {} };
                lb.resolveLoopbackResult(payload.requestId, result);
              },
            },
          },
        ],
      },
    };
  }
  return origLoad.call(this, request, ...rest);
};

// ★ 清 CJS 缓存再 require（9-28）：nodeRequire 跨 spec 共享 CJS 缓存
const LOOPBACK_PATH = nodeRequire.resolve('../electron/loopback.cjs');
delete nodeRequire.cache[LOOPBACK_PATH];
const lb = nodeRequire('../electron/loopback.cjs') as {
  handle(req: unknown, res: unknown): void;
  CORS_HEADERS: Record<string, string>;
  setLoopbackToken(t: string): void;
  resolveLoopbackResult(id: string, payload: unknown): void;
  resolveLoopbackPong(id: string): void;
};

const TOKEN = 'idp_test_token_loopback_server';

/* ---------------- 进程内 HTTP 替身（mock req/res，直调 handle） ---------------- */

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function call(
  method: string,
  pathAndQuery: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Captured> {
  const captured: Captured = { status: 0, headers: {}, body: '' };
  const raw = opts.body === undefined ? '' : JSON.stringify(opts.body);
  // readBody 是事件式（req.on('data'/'end')）——mock 必须用同一协议
  const req = {
    method,
    url: pathAndQuery,
    headers: { host: '127.0.0.1:17788', ...(opts.headers ?? {}) },
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === 'data' && raw) setImmediate(() => cb(Buffer.from(raw, 'utf8')));
      if (event === 'end') setImmediate(() => cb());
      if (event === 'error') {
        /* 不触发：正常路径 */
      }
      return req;
    },
  };
  const res = {
    headersSent: false,
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      // 真实 Node server 会把 header 键小写化（HTTP/1.1 语义）——mock 照做，
      // 否则断言 'access-control-allow-origin' 永远 undefined（9-28 踩过）
      captured.headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
      );
      (res as unknown as { headersSent: boolean }).headersSent = true;
      return res;
    },
    end(data?: string) {
      if (data !== undefined) captured.body = data;
    },
    on: () => undefined,
  };
  // handle 是同步函数（内部 await 链自发完成）——不能 .catch
  void lb.handle(req, res);
  // handle 内部是 await 链（readBody/forward）——等两个宏 task 收尾
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve(captured);
    }, 50),
  );
}

function json<T>(c: Captured): T {
  return JSON.parse(c.body) as T;
}

beforeAll(() => {
  lb.setLoopbackToken(TOKEN);
});

afterEach(() => {
  replyWith = null;
  sent = [];
});

/* ================================ CORS ================================ */

describe('loopback · CORS（面板探测「不可连通」的回归钉）', () => {
  it('★ 全响应带 Access-Control-Allow-Origin: *（跨源 fetch 不再被浏览器拦）', async () => {
    const res = await call('GET', '/api/agent/health');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('★ OPTIONS 预检 → 204 + CORS 三头（带 Authorization 的跨源写必触发预检）', async () => {
    const res = await call('OPTIONS', '/api/agent/import');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('错误响应同样带 CORS 头（401 也要能被浏览器读到）', async () => {
    const res = await call('POST', '/api/agent/import', {
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: {},
    });
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

/* ================================ 鉴权 ================================ */

describe('loopback · 鉴权（fail-closed）', () => {
  it('无令牌 → 401；health 免令牌（探活语义）', async () => {
    const noAuth = await call('POST', '/api/agent/import', {
      headers: { 'content-type': 'application/json' },
      body: {},
    });
    expect(noAuth.status).toBe(401);

    const health = await call('GET', '/api/agent/health');
    expect(health.status).toBe(200);
  });

  it('★ X-Agent-Token 头单独带即通过（CORS 曾广告它却不收 = 假承诺）', async () => {
    replyWith = (req) => ({ requestId: req.requestId, result: { created: 0, updated: 0, rejected: [] } });
    const res = await call('POST', '/api/agent/import?project=p_a', {
      headers: { 'content-type': 'application/json', 'x-agent-token': TOKEN },
      body: {
        schema: 'idplan-agent-payload/v1',
        producedBy: { agentKind: 'wb', agentName: 'WB', runId: 'r' },
        tasks: [{ externalId: 'e', title: 't', status: 'draft' }],
      },
    });
    expect(res.status).toBe(200);
  });
});

/* ================================ 四端点路由 ================================ */

const validBody = {
  schema: 'idplan-agent-payload/v1',
  producedBy: { agentKind: 'wb', agentName: 'WB', runId: 'r' },
  tasks: [{ externalId: 'e', title: 't', status: 'draft' }],
};

describe('loopback · 四端点路由（承诺 = 能力）', () => {
  it('★ POST /api/agent/boards → 转发 create-board 事件，回传后 201 + 镜像体', async () => {
    replyWith = (req) => ({
      requestId: req.requestId,
      result: { projectId: 'p_new', name: '板', stages: [] },
    });
    const res = await call('POST', '/api/agent/boards', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: { name: '板', plannedStartAt: '2026-10-01', plannedEndAt: '2026-10-31', presetKey: 'indoor_full' },
    });
    expect(res.status).toBe(201);
    expect(sent.map(([ch]) => ch)).toContain('agent:create-board-request');
    expect(json<{ projectId: string }>(res).projectId).toBe('p_new');
  });

  it('★ boards 带 projectId / projectName → 400 且不转发（只新建的形状纪律）', async () => {
    const res = await call('POST', '/api/agent/boards', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: { name: 'x', projectId: 'p_human' },
    });
    expect(res.status).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('invalid_field');
    expect(sent).toEqual([]);
  });

  it('★ GET /api/agent/tasks → 转发 list-tasks 事件，回传后 200 + tasks 体', async () => {
    replyWith = (req) => ({
      requestId: req.requestId,
      result: { tasks: [{ externalId: 'e1', taskNo: 1, title: 't', status: 'draft', dueDate: null, dependsOnExternal: [] }] },
    });
    const res = await call('GET', '/api/agent/tasks', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(sent.map(([ch]) => ch)).toContain('agent:list-tasks-request');
    expect(json<{ tasks: unknown[] }>(res).tasks).toHaveLength(1);
  });

  it('★ tasks 带 projectId 透传给渲染侧（归属门在渲染侧判，主进程不重判）', async () => {
    await call('GET', '/api/agent/tasks?projectId=p_human', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const req = sent.find(([ch]) => ch === 'agent:list-tasks-request');
    expect(req).toBeTruthy();
    expect(req![1].projectId).toBe('p_human');
  });

  it('POST /api/agent/import 仍走 import-request（既有通道不回退）', async () => {
    replyWith = (req) => ({ requestId: req.requestId, result: { created: 0, updated: 0, rejected: [] } });
    const res = await call('POST', '/api/agent/import?project=p_agent', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: validBody,
    });
    expect(res.status).toBe(200);
    expect(sent.map(([ch]) => ch)).toContain('agent:import-request');
  });

  it('未知路由 → 404（路由集没有悄悄膨胀）', async () => {
    const res = await call('GET', '/api/agent/nope', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it('渲染侧回错误 → HTTP 状态按 error.httpStatus 映射（400 不吞成 200）', async () => {
    replyWith = (req) => ({
      requestId: req.requestId,
      error: { code: 'project_unresolved', httpStatus: 400, userMessage: '不是 Agent 看板。' },
    });
    const res = await call('POST', '/api/agent/import?project=p_human', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: validBody,
    });
    expect(res.status).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('project_unresolved');
  });
});

/* ================================ query 契约 ================================ */

describe('loopback · query 契约（2026-09-28 修复回归）', () => {
  function captureImport(query: string, body: unknown): Promise<Captured> {
    replyWith = (req) => ({ requestId: req.requestId, result: { created: 0, updated: 0, rejected: [] } });
    return call('POST', `/api/agent/import${query}`, {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body,
    });
  }

  it('★ dryRun 真值矩阵：非 \'\'/\'0\'/\'false\' 一律预览（安全偏向）', async () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', '2']) {
      sent = [];
      await captureImport(`?project=p_a&dryRun=${v}`, validBody);
      const fwd = sent.find(([ch]) => ch === 'agent:import-request')![1];
      expect(fwd.dryRun, `dryRun=${v} 应判定为预览`).toBe(true);
    }
    for (const v of ['0', 'false']) {
      sent = [];
      await captureImport(`?project=p_a&dryRun=${v}`, validBody);
      const fwd = sent.find(([ch]) => ch === 'agent:import-request')![1];
      expect(fwd.dryRun, `dryRun=${v} 应判定为实写`).toBe(false);
    }
  });

  it('★ 落点参数：projectId 为契约名；project 为历史别名；同传不同值 → 400', async () => {
    sent = [];
    let res = await captureImport('?projectId=p_a', validBody);
    expect(res.status).toBe(200);
    expect(sent.find(([ch]) => ch === 'agent:import-request')![1].projectId).toBe('p_a');

    sent = [];
    res = await captureImport('?project=p_b', validBody);
    expect(sent.find(([ch]) => ch === 'agent:import-request')![1].projectId).toBe('p_b');

    res = await captureImport('?project=p_a&projectId=p_b', validBody);
    expect(res.status).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('invalid_field');
  });

  it('落点参数出现但空 → 400 invalid_field（不当作未声明）', async () => {
    const res = await captureImport('?project=', validBody);
    expect(res.status).toBe(400);
  });

  it('★ stageName/createStageIfMissing 同义别名；同传不同值 → 400', async () => {
    sent = [];
    await captureImport('?project=p_a&createStageIfMissing=测量', validBody);
    expect(sent.find(([ch]) => ch === 'agent:import-request')![1].stageName).toBe('测量');

    const res = await captureImport('?project=p_a&stageName=测量&createStageIfMissing=提案', validBody);
    expect(res.status).toBe(400);
  });

  it('★ stageId 透传进 payload（旧版完全忽略 ⇒ 静默落错批）；与 stageName 互斥 400', async () => {
    sent = [];
    let res = await captureImport('?project=p_a&stageId=stg_target', validBody);
    expect(res.status).toBe(200);
    expect(sent.find(([ch]) => ch === 'agent:import-request')![1].payload.stageId).toBe('stg_target');

    res = await captureImport('?project=p_a&stageName=测量&stageId=stg_target', validBody);
    expect(res.status).toBe(400);
  });

  it('tasks ?source= 透传渲染侧（仅 agent/human 生效）', async () => {
    await call('GET', '/api/agent/tasks?source=human', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(sent.find(([ch]) => ch === 'agent:list-tasks-request')![1].source).toBe('human');

    sent = [];
    await call('GET', '/api/agent/tasks?source=nope', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(sent.find(([ch]) => ch === 'agent:list-tasks-request')![1].source).toBeUndefined();
  });
});
