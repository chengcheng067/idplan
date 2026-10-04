// @vitest-environment node
/**
 * F1 归属漏斗守卫（v0.8.6 · 她 10-04 拍板「成员每个人都能有自己的 Agent 看板」）
 *
 * 守的是 `src/core/project/visibility.ts` 的**双漏斗谓词**：
 *   `visibleProjectsFor(kind, all, viewerMemberId)` = kind 收窄 **×** 归属收窄。
 *
 * ── 为什么必须有这个 spec（而不是靠「反正看起来对」）──
 * 它守的是**用户可见语义**，不是实现细节：
 *   · 成员看不到别人的 Agent 看板（归属生效）
 *   · 但公共板（owner=null）人人可见（存量/历史数据不被一刀切）
 *   · 老库（没这一列）行为与改造前逐字一致（零回归）
 * 这三条任何一条被未来的「顺手优化」改掉，**表现都是静默的**：
 * 成员少看板 = 功能失效但没人报障；成员多看板 = 越权但没人发现。
 *
 * ── 纪律（沿本仓既有惯例）──
 * ① 变异组**真改源码跑过**：把谓词里的 owner 判定改成恒真，必须变红；
 * ② 不写假绿断言——参照 `plugin-server-task-no-unique.spec.ts` 的方向判据：
 *    「证明洞存在」型断言被污染会变红（安全），本 spec 两类都有，方向已核。
 */

import { describe, it, expect } from 'vitest';

import { visibleProjectsFor } from '../src/core/project/visibility';
import { normalizeProjectRow } from '../src/core/template/stage-fallback';
import type { Project } from '../src/core/types/entities';
import { ScheduleBasis } from '../src/core/types/enums';

/** 造一块板（字段取最小必要集；键序对齐实体，便于人读） */
function board(id: string, kind: 'human' | 'agent', ownerMemberId: string | null): Project {
  return {
    id,
    name: `板 ${id}`,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: 'indoor',
    kind,
    ownerMemberId,
    status: 'active',
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Project;
}

describe('F1 归属漏斗 · visibleProjectsFor', () => {
  const DATA = [
    board('mine', 'agent', 'm_me'),
    board('hers', 'agent', 'm_other'),
    board('shared', 'agent', null), // 公共板（存量/历史）
    board('human-mine', 'human', 'm_me'), // 归属对，但 kind 不对
    board('legacy', 'agent', null), // 又一块公共板
  ];

  it('① 归属收窄：只看得到自己的 + 公共板', () => {
    const out = visibleProjectsFor('agent', DATA, 'm_me');
    expect(out.map((p) => p.id).sort()).toEqual(['legacy', 'mine', 'shared']);
  });

  it('② 别人的板不进列表（一条都不行）', () => {
    const out = visibleProjectsFor('agent', DATA, 'm_me');
    expect(out.some((p) => p.id === 'hers')).toBe(false);
  });

  it('③ 第三个人：各自视角互不串', () => {
    const other = visibleProjectsFor('agent', DATA, 'm_other').map((p) => p.id).sort();
    expect(other).toEqual(['hers', 'legacy', 'shared']);
  });

  it('④ 未登录（null）⇒ 回落纯 kind（与改造前逐字一致）', () => {
    const out = visibleProjectsFor('agent', DATA, null);
    expect(out).toHaveLength(4); // 四块 agent 板全在（含 hers——因为还没登录）
  });

  it('⑤ 不传第三参 ⇒ 完全不看 owner 字段（既有消费方零改动）', () => {
    const out = visibleProjectsFor('agent', DATA);
    expect(out).toHaveLength(4);
  });

  it('⑥ kind 收窄仍然优先：人类项目永不出现在 agent 列表', () => {
    const out = visibleProjectsFor('agent', DATA, 'm_me');
    expect(out.some((p) => p.id === 'human-mine')).toBe(false);
    const humanSide = visibleProjectsFor('human', DATA, 'm_me');
    expect(humanSide.map((p) => p.id)).toEqual(['human-mine']);
  });
});

describe('F1 归属 · normalizeProjectRow 的三条不变量', () => {
  const base = {
    id: 'p_x',
    name: 'X',
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    status: 'active',
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('⑦ 缺键（老备份/老库）⇒ null（公共板），不抛错', () => {
    const row = normalizeProjectRow({ ...base } as never);
    expect(row.ownerMemberId).toBeNull();
  });

  it('⑧ 显式 null ⇒ null', () => {
    const row = normalizeProjectRow({ ...base, ownerMemberId: null } as never);
    expect(row.ownerMemberId).toBeNull();
  });

  it('⑨ 有值 ⇒ 原样带过（**不推断、不改写**）', () => {
    const row = normalizeProjectRow({ ...base, ownerMemberId: 'm_someone' } as never);
    expect(row.ownerMemberId).toBe('m_someone');
  });
});
