import { describe, expect, it } from 'vitest';

import { createId, looksLikeId } from '../src/lib/id';
import type { IdPrefix } from '../src/lib/id';

const ALL_PREFIXES: readonly IdPrefix[] = ['proj', 'stg', 'tsk', 'mem', 'log', 'ctt', 'art', 'cst'];

/**
 * 回归锁：looksLikeId 曾写死 `value.slice(5)`，而只有 `proj_` 是 5 字符、
 * 其余前缀（stg_ / tsk_ / mem_ / log_ / ctt_ / art_ / cst_）都是 4 字符，
 * 导致除 proj_ 外的所有 ID 都被切掉 UUID 首位、必然判为非法。
 */
describe('looksLikeId：ID 前缀校验', () => {
  it('每个前缀生成的 ID 都能通过校验（含 4 字符前缀）', () => {
    for (const prefix of ALL_PREFIXES) {
      expect(looksLikeId(createId(prefix)), `前缀 ${prefix}_ 应通过`).toBe(true);
    }
  });

  it('拒绝无前缀 / 未知前缀的裸 UUID', () => {
    expect(looksLikeId(crypto.randomUUID())).toBe(false);
    expect(looksLikeId('xxx_123e4567-e89b-12d3-a456-426614174000')).toBe(false);
  });

  it('拒绝前缀正确但 UUID 形状非法的串', () => {
    expect(looksLikeId('stg_not-a-uuid')).toBe(false);
    expect(looksLikeId('tsk_123')).toBe(false);
  });

  it('拒绝空串', () => {
    expect(looksLikeId('')).toBe(false);
  });
});
