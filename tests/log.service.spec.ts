import { describe, it, expect, beforeEach } from 'vitest';

import {
  write,
  logError,
  logWarn,
  logInfo,
  logUser,
  dump,
  clearLogs,
  buildLogExport,
  logExportFileName,
} from '../src/core/services/log.service';

/** 每条日志的稳定字段校验 */
function assertEntryShape(e: unknown): void {
  const entry = e as { seq: number; ts: string; type: string; source: string; message: string };
  expect(typeof entry.seq).toBe('number');
  expect(typeof entry.ts).toBe('string');
  expect(['error', 'warn', 'info', 'user']).toContain(entry.type);
  expect(typeof entry.source).toBe('string');
  expect(typeof entry.message).toBe('string');
  expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
}

describe('log.service（前端日志系统）', () => {
  beforeEach(() => {
    clearLogs();
    // 复位内部的 seq 计数（每条测试独立）
    // write 会自增 seq，但 clearLogs 只清数组不清计数；这里通过重新导入保证稳定——
    // 直接调用 clearLogs 后 seq 可能保留，但不影响断言（我们只断言字段存在与类型）。
  });

  it('write 记录一条完整日志（含时间戳/类型/来源/消息）', () => {
    const e = write({ type: 'info', source: '测试', message: 'hello' });
    assertEntryShape(e);
    expect(e.type).toBe('info');
    expect(e.source).toBe('测试');
    expect(e.message).toBe('hello');
  });

  it('便捷封装 logError 记录错误并附带堆栈', () => {
    const err = new Error('boom');
    const e = logError('模块', '出错了', err);
    assertEntryShape(e);
    expect(e.type).toBe('error');
    expect(e.stack).toContain('boom');
  });

  it('logError 接受裸字符串消息', () => {
    const e = logError('模块', '出错了', 'plain string');
    expect(e.type).toBe('error');
    expect(e.stack).toBe('plain string');
  });

  it('四种类型辅助函数正确映射', () => {
    expect(logWarn('s', 'w').type).toBe('warn');
    expect(logInfo('s', 'i').type).toBe('info');
    expect(logUser('s', 'u').type).toBe('user');
  });

  it('dump 返回全部日志（副本），clearLogs 清空', () => {
    write({ type: 'info', source: 'a', message: '1' });
    write({ type: 'warn', source: 'b', message: '2' });
    expect(dump().length).toBe(2);
    clearLogs();
    expect(dump().length).toBe(0);
  });

  it('buildLogExport 组装含元信息的导出包', () => {
    write({ type: 'info', source: 'a', message: '1' });
    const pkg = buildLogExport(new Date('2026-09-01T00:00:00.000Z'));
    expect(pkg.app).toBe('ID Plan');
    expect(pkg.version).toBe('0.3.0.0018');
    expect(pkg.channel).toBe('local');
    expect(pkg.exportedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(Array.isArray(pkg.entries)).toBe(true);
    expect(pkg.entries.length).toBe(1);
    assertEntryShape(pkg.entries[0]);
  });

  it('logExportFileName 生成带时间戳的文件名（分钟精度，与备份一致）', () => {
    const name = logExportFileName(new Date('2026-09-01T12:34:56.000Z'));
    expect(name).toBe('id-plan-log-202609011234.log');
  });
});
