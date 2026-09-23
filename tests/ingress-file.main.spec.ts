/**
 * 主进程侧接入文件模块的**契约测试**（2026-09-24 事故的回归钉）。
 *
 * ══════════════════════ 这份 spec 为什么存在 ══════════════════════
 * 0007 包实测 bug：点「生成接入信息」报「接入信息不完整（缺地址或令牌）」。
 * 根因：形状门内联在 main.cjs 的 IPC handler 里，**读错了字段路径**——接入文件
 * payload 的令牌是嵌套的 `auth.token`（ingress-file.ts 的 IngressPayload），
 * handler 却读扁平的 `payload.token`，把合法请求判死。内联在 main.cjs 的逻辑
 * 没有任何测试覆盖得到它，所以错到家也没人发现。
 * 修法：门抽成共享 CJS 模块（electron/ingress-file.cjs），本 spec 用**真实的
 * 渲染侧构建器输出**喂它——将来任何人再改错任一侧的字段路径，这里立刻红。
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CJS 主进程模块（node 环境直require）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ingress = require('../electron/ingress-file.cjs') as {
  INGRESS_DIR_NAME: string;
  INGRESS_FILE_NAME: string;
  ingressFilePath(documentsDir: string): string;
  validateIngressPayload(payload: unknown): { ok: boolean; reason?: string };
  writeIngressFile(
    documentsDir: string,
    payload: unknown,
  ): { ok: boolean; path: string; reason?: string };
};
import { buildIngressPayload } from '../src/core/agent/ingress-file';

describe('主进程接入文件形状门：与渲染侧构建器同构（0007 事故回归）', () => {
  it('★ 渲染侧构建器的真实输出必须过门（令牌在 auth.token，嵌套）', () => {
    // 这就是 0007 被打死的那一条：扁平 payload.token 读不到嵌套 auth.token
    const payload = buildIngressPayload({
      origin: 'http://127.0.0.1:17788',
      token: 'idp_0123456789abcdef0123456789abcdef',
      generatedAt: '2026-09-24T00:00:00.000Z',
    });
    expect(ingress.validateIngressPayload(payload).ok).toBe(true);
  });

  it('扁平 payload.token（旧错误形状）不过门——门没被改成永真', () => {
    expect(
      ingress.validateIngressPayload({ origin: 'http://127.0.0.1:17788', token: 'idp_x' }).ok,
    ).toBe(false);
  });

  it('缺 origin / 缺 auth.token / auth.token 非字符串 / 整体非对象 → 全部拒绝', () => {
    const base = {
      schema: 'idplan-agent-ingress/v1',
      origin: 'http://127.0.0.1:17788',
      auth: { type: 'bearer', token: 'idp_x' },
    };
    expect(ingress.validateIngressPayload({ ...base, origin: '' }).ok).toBe(false);
    expect(ingress.validateIngressPayload({ ...base, origin: '   ' }).ok).toBe(false);
    expect(ingress.validateIngressPayload({ ...base, auth: { type: 'bearer' } }).ok).toBe(false);
    expect(ingress.validateIngressPayload({ ...base, auth: { type: 'bearer', token: 42 } }).ok).toBe(
      false,
    );
    expect(ingress.validateIngressPayload(null).ok).toBe(false);
    expect(ingress.validateIngressPayload('nope').ok).toBe(false);
  });
});

describe('writeIngressFile：落盘到固定路径', () => {
  it('固定路径 = documents/ID Plan/agent-ingress.json', () => {
    expect(ingress.ingressFilePath('C:\\Users\\x\\Documents')).toContain('ID Plan');
    expect(ingress.ingressFilePath('C:\\Users\\x\\Documents')).toContain('agent-ingress.json');
  });

  it('★ 通过门的 payload 落盘成功，内容原样 round-trip（含嵌套 auth.token）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idplan-ingress-'));
    try {
      const payload = buildIngressPayload({
        origin: 'http://127.0.0.1:17788',
        token: 'idp_roundtrip_secret',
        generatedAt: '2026-09-24T00:00:00.000Z',
      });
      const res = ingress.writeIngressFile(dir, payload);
      expect(res.ok).toBe(true);
      expect(res.path).toBe(
        join(dir, ingress.INGRESS_DIR_NAME, ingress.INGRESS_FILE_NAME),
      );
      const back = JSON.parse(readFileSync(res.path, 'utf8'));
      expect(back.schema).toBe('idplan-agent-ingress/v1');
      expect(back.auth).toEqual({ type: 'bearer', token: 'idp_roundtrip_secret' });
      expect(back.origin).toBe('http://127.0.0.1:17788');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('★ 门不过 → 不写文件、返回 ok:false + 原因（用户看得见为什么）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idplan-ingress-'));
    try {
      const res = ingress.writeIngressFile(dir, { origin: 'http://x' }); // 缺 auth.token
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('缺地址或令牌');
      expect(existsSync(res.path)).toBe(false); // 一字未落
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
