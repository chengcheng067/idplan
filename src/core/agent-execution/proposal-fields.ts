/**
 * 提案理由/置信度写入侧校验（v0.8.6 · 两端同款口径的**唯一出处**）。
 *
 * 为什么要共享而不是两端各写：这两个字段是**审批判断的输入**——理由超长被
 * 静默截断、或置信度越界被夹到 [0,1]，两端就会给出不同结论，而用户看不出
 * 哪边在撒谎（NAS 夹了、本地拒了这类分叉最难查）。
 *
 * 口径：
 *   · reason：去首尾空白后 ≤200 字；空串→null；超长→Validation（**不截断**，
 *     截断=悄悄改掉 agent 的话）；
 *   · confidence：有限数且 0..1；越界/NaN/非数→Validation（**不夹取**，
 *     夹取=伪造 agent 自报的值）。
 */

import { coreError, ChangxiaErrorCode } from '../types/enums';

export function normalizeProposalReason(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    throw coreError(ChangxiaErrorCode.Validation, 'coreErr.proposal.reasonNotString');
  }
  const t = raw.trim();
  if (t.length === 0) return null;
  if (t.length > 200) {
    throw coreError(ChangxiaErrorCode.Validation, 'coreErr.proposal.reasonTooLong', {
      length: t.length,
    });
  }
  return t;
}

export function normalizeProposalConfidence(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw coreError(ChangxiaErrorCode.Validation, 'coreErr.proposal.confidenceInvalid');
  }
  return raw;
}
