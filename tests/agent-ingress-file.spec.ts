/**
 * Agent 接入文件 / 接入指令的**契约测试**（v0.8 · T04-B 接入重设计）。
 *
 * 这两个构建器是**写入方（如 WorkBuddy）的接入契约**：端点路径、schema 名、
 * 鉴权头格式错一个，写入方就接不上，且现象是远端 401/404，极难回头查。
 * 故形状必须被单测钉死——IO（落盘 / 剪贴板）在调用方，此处只算内容。
 */

import { describe, it, expect } from 'vitest';

import {
  AGENT_PAYLOAD_SCHEMA,
  INGRESS_FILE_SCHEMA,
  buildIngressInstructionBlock,
  buildIngressPayload,
  generateAgentToken,
} from '../src/core/agent/ingress-file';

describe('generateAgentToken：共享暗号的形状', () => {
  it('idp_ 前缀 + 32 位十六进制（128bit 随机，本机 loopback 足够）', () => {
    const t = generateAgentToken();
    expect(t).toMatch(/^idp_[0-9a-f]{32}$/);
  });

  it('连续生成不重复（碰撞即接入错方，必须零概率）', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateAgentToken()));
    expect(set.size).toBe(200);
  });
});

describe('buildIngressPayload：接入文件形状（写入方按它接入）', () => {
  it('schema / origin / auth / endpoints / payloadSchema / notes 六件齐，origin 去尾斜杠', () => {
    const payload = buildIngressPayload({
      origin: 'http://127.0.0.1:17788/',
      token: 'idp_abc',
      generatedAt: '2026-09-23T00:00:00.000Z',
    });

    expect(payload.schema).toBe(INGRESS_FILE_SCHEMA);
    expect(payload.schema).toBe('idplan-agent-ingress/v1');
    expect(payload.generatedAt).toBe('2026-09-23T00:00:00.000Z');
    expect(payload.origin).toBe('http://127.0.0.1:17788'); // 尾斜杠被剥
    expect(payload.auth).toEqual({ type: 'bearer', token: 'idp_abc' });
    expect(payload.payloadSchema).toBe(AGENT_PAYLOAD_SCHEMA);
    expect(payload.payloadSchema).toBe('idplan-agent-payload/v1');

    // 四个端点与 server/routes/agent.routes.ts 逐字对应（少一个 = 写入方接不上）
    expect(payload.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /api/agent/health',
      'POST /api/agent/boards',
      'POST /api/agent/import',
      'GET /api/agent/tasks',
      // v0.8.5 方案 3：结构化命令端点（reschedule_stages）
      'POST /api/agent/commands',
    ]);
    for (const e of payload.endpoints) expect(e.summary.length).toBeGreaterThan(0);

    // notes 讲清两条硬边界（隔离是结构性的，别让写入方把 400 当 bug 报）
    expect(payload.notes.join('\n')).toContain('人类项目');
    expect(payload.notes.join('\n')).toContain('taskNo');
  });

  it('generatedAt 缺省取当前时间（ISO 可解析）', () => {
    const payload = buildIngressPayload({ origin: 'http://x', token: 'idp_x' });
    expect(Number.isNaN(new Date(payload.generatedAt).getTime())).toBe(false);
  });
});

describe('buildIngressInstructionBlock：兜底指令（人肉可读 + 机器可抄）', () => {
  const payload = buildIngressPayload({
    origin: 'http://127.0.0.1:17788',
    token: 'idp_secret_value',
    generatedAt: '2026-09-23T00:00:00.000Z',
  });

  it('文件路径在前（优先引导读文件），明文令牌在后（兜底）', () => {
    const block = buildIngressInstructionBlock({
      filePath: 'C:\\Users\\x\\Documents\\ID Plan\\agent-ingress.json',
      payload,
    });
    expect(block.indexOf('agent-ingress.json')).toBeGreaterThan(0);
    expect(block.indexOf('agent-ingress.json')).toBeLessThan(block.indexOf('idp_secret_value'));
  });

  it('地址 / 鉴权头 / 四端点 / payload schema / 隔离警示 全在块内', () => {
    const block = buildIngressInstructionBlock({ filePath: 'C:\\x\\agent-ingress.json', payload });
    expect(block).toContain('http://127.0.0.1:17788');
    expect(block).toContain('Authorization: Bearer idp_secret_value');
    expect(block).toContain('POST /api/agent/import');
    expect(block).toContain('GET /api/agent/tasks');
    expect(block).toContain('idplan-agent-payload/v1');
    expect(block).toContain('人类项目一律拒绝');
    // 端点带缩进（粘进聊天窗口也能看出层级）
    expect(block).toMatch(/\n {4}POST \/api\/agent\/boards/);
  });
});
