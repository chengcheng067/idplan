// @vitest-environment node
/**
 * 提案理由/置信度写入侧校验（v0.8.6 · 两端同口径唯一出处的契约）。
 *
 * 钉六条：reason 归一/空串→null/超长拒（非截断）；confidence 有限数 0..1
 * （越界/NaN/非数拒——**非夹取**，夹取=伪造 agent 自报）；两端同函数。
 */
import { describe, it, expect } from 'vitest';
import { normalizeProposalReason, normalizeProposalConfidence } from '../src/core/agent-execution/proposal-fields';

describe('提案字段校验（两端共享口径）', () => {
  it('① reason：去空白归一', () => {
    expect(normalizeProposalReason('  甲方延后  ')).toBe('甲方延后');
  });
  it('② reason：null/空串→null', () => {
    expect(normalizeProposalReason(null)).toBeNull();
    expect(normalizeProposalReason('   ')).toBeNull();
  });
  it('③ reason：超 200 字拒（不截断）', () => {
    expect(() => normalizeProposalReason('x'.repeat(201))).toThrow();
  });
  it('④ confidence：0/1 边界合法', () => {
    expect(normalizeProposalConfidence(0)).toBe(0);
    expect(normalizeProposalConfidence(1)).toBe(1);
    expect(normalizeProposalConfidence(0.42)).toBe(0.42);
  });
  it('⑤ confidence：越界/NaN/非数拒（非夹取）', () => {
    expect(() => normalizeProposalConfidence(1.2)).toThrow();
    expect(() => normalizeProposalConfidence(-0.1)).toThrow();
    expect(() => normalizeProposalConfidence(Number.NaN)).toThrow();
    expect(() => normalizeProposalConfidence('0.9' as unknown as number)).toThrow();
  });
  it('⑥ confidence：null/undefined→null', () => {
    expect(normalizeProposalConfidence(null)).toBeNull();
    expect(normalizeProposalConfidence(undefined)).toBeNull();
  });
});
