// @vitest-environment node
/**
 * 方案 3 · reschedule_stages 命令（v0.8.5）· 契约 + 行为 spec。
 *
 * 钉七条：
 *   ① schema 校验（命令形状/±365 封顶）；
 *   ② **归属门**：人类项目/不存在 → ProjectUnresolved（与导入通道同门，
 *      复用 assertAgentWritableProject——不是第二张皮）；
 *   ③ dryRun **零写入**且返回正确预览（含 from/to 平移值）；
 *   ④ 实写走既有 reschedule service（逐段、留痕名「Agent 通道」）；
 *   ⑤ **completed 阶段不平移**（历史不篡改）且 skippedCompleted 计数；
 *   ⑥ stageKeys 过滤 + unmatchedKeys 反馈（拼错不静默）；
 *   ⑦ visible=false 的段不参与（隐藏段不被命令翻出来）。
 */
import { describe, it, expect } from 'vitest';

import { runRescheduleStages, validateAgentCommand } from '../src/core/agent/commands';
import type { RescheduleResult, RescheduleDryRun } from '../src/core/agent/commands';
import { ChangxiaErrorCode, StageStatus } from '../src/core/types/enums';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import type { Project, Stage } from '../src/core/types/entities';

function fakeRepos(opts: {
  project?: Project | null;
  stages?: Stage[];
  onReschedule?: (stageId: string, startAt: string, endAt: string) => void;
}): IRepositoryBundle {
  return {
    projects: {
      get: async (id: string) => (opts.project && opts.project.id === id ? opts.project : (opts.project ?? null)),
    },
    stages: {
      listByProject: async () => opts.stages ?? [],
      reschedule: async (id: string, startAt: string, endAt: string) => {
        opts.onReschedule?.(id, startAt, endAt);
        return { id, startAt, endAt } as unknown as Stage;
      },
    },
  } as unknown as IRepositoryBundle;
}

const humanProject = { id: 'proj_human', name: '人类项目', kind: 'human' } as unknown as Project;
const agentProject = { id: 'proj_agent', name: 'Agent 看板', kind: 'agent' } as unknown as Project;

function stage(
  id: string,
  orderIndex: number,
  status: StageStatus,
  templateKey: string | null,
  startAt: string,
  endAt: string,
  visible = true,
): Stage {
  return {
    id,
    projectId: 'proj_agent',
    orderIndex,
    templateKey,
    status,
    startAt,
    endAt,
    visible,
    name: `段${orderIndex}`,
    colorIndex: 1,
  } as unknown as Stage;
}

const A = ['2026-10-05', '2026-10-11'] as const;
const B = ['2026-10-12', '2026-10-18'] as const;
const C = ['2026-09-01', '2026-09-07'] as const;

const base = { command: 'reschedule_stages', projectId: 'proj_agent' } as const;

/** 联合窄化（RescheduleResult 两态；dryRun 断言点过不了就是契约坏了） */
function asDry(r: RescheduleResult): RescheduleDryRun {
  if (r.mode !== 'dry_run') throw new Error('expected dry_run mode');
  return r;
}

describe('reschedule_stages 命令（方案 3 第一命令）', () => {
  it('① schema：合法命令过校验；shiftDays 超 365 拒绝', () => {
    const ok = validateAgentCommand({ ...base, shiftDays: 14 });
    expect(ok.shiftDays).toBe(14);
    expect(() => validateAgentCommand({ ...base, shiftDays: 400 })).toThrow();
    expect(() => validateAgentCommand({ command: 'bogus', projectId: 'p', shiftDays: 1 })).toThrow();
  });

  it('② 归属门：人类项目 → ProjectUnresolved（与导入通道同门）', async () => {
    const repos = fakeRepos({ project: humanProject, stages: [] });
    await expect(
      runRescheduleStages(
        { repos, rescheduleStage: async () => ({}) },
        { ...base, projectId: 'proj_human', shiftDays: 7 },
      ),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.ProjectUnresolved });
  });

  it('②b 归属门：不存在的项目 → ProjectUnresolved', async () => {
    const repos = fakeRepos({ project: null });
    await expect(
      runRescheduleStages(
        { repos, rescheduleStage: async () => ({}) },
        { ...base, projectId: 'nope', shiftDays: 7 },
      ),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.ProjectUnresolved });
  });

  it('③ dryRun：零写入 + 预览 from/to 正确', async () => {
    const writes: string[] = [];
    const repos = fakeRepos({
      project: agentProject,
      stages: [
        stage('s1', 1, StageStatus.InProgress, 'k1', A[0], A[1]),
        stage('s2', 2, StageStatus.NotStarted, 'k2', B[0], B[1]),
      ],
      onReschedule: (id) => writes.push(id),
    });
    const r = asDry(
      await runRescheduleStages(
        { repos, rescheduleStage: async () => ({}) },
        { ...base, shiftDays: 14 },
        { dryRun: true },
      ),
    );
    expect(r.wouldShift).toHaveLength(2);
    expect(r.wouldShift[0]!.from).toEqual({ startAt: '2026-10-05', endAt: '2026-10-11' });
    expect(r.wouldShift[0]!.to).toEqual({ startAt: '2026-10-19', endAt: '2026-10-25' });
    expect(writes).toEqual([]);
  });

  it('④ 实写：逐段调 reschedule（留痕名 Agent 通道）', async () => {
    const calls: Array<{ id: string; start: string; end: string; op: string }> = [];
    const repos = fakeRepos({
      project: agentProject,
      stages: [stage('s1', 1, StageStatus.InProgress, 'k1', A[0], A[1])],
    });
    const r = await runRescheduleStages(
      {
        repos,
        rescheduleStage: async (id, cmd) => {
          calls.push({ id, start: cmd.newStartAt, end: cmd.newEndAt, op: cmd.operatorName });
        },
      },
      { ...base, shiftDays: -3, reason: '甲方前置' },
    );
    if (r.mode !== 'applied') throw new Error('expected applied mode');
    expect(r.shifted).toBe(1);
    expect(calls).toEqual([{ id: 's1', start: '2026-10-02', end: '2026-10-08', op: 'Agent 通道' }]);
  });

  it('⑤ completed 阶段不平移（历史不篡改）+ skippedCompleted 计数', async () => {
    const repos = fakeRepos({
      project: agentProject,
      stages: [
        stage('s1', 1, StageStatus.Completed, 'k1', C[0], C[1]),
        stage('s2', 2, StageStatus.InProgress, 'k2', A[0], A[1]),
      ],
    });
    const r = asDry(
      await runRescheduleStages(
        { repos, rescheduleStage: async () => ({}) },
        { ...base, shiftDays: 14 },
        { dryRun: true },
      ),
    );
    expect(r.wouldShift.map((x) => x.stageId)).toEqual(['s2']);
    expect(r.skippedCompleted).toBe(1);
  });

  it('⑥ stageKeys 过滤 + unmatchedKeys 反馈（拼错不静默）', async () => {
    const repos = fakeRepos({
      project: agentProject,
      stages: [
        stage('s1', 1, StageStatus.InProgress, 'soft.dev', A[0], A[1]),
        stage('s2', 2, StageStatus.InProgress, 'soft.qa', B[0], B[1]),
      ],
    });
    const r = asDry(
      await runRescheduleStages(
        { repos, rescheduleStage: async () => ({}) },
        { ...base, shiftDays: 7, stageKeys: ['soft.dev', 'soft.nope'] },
        { dryRun: true },
      ),
    );
    expect(r.wouldShift.map((x) => x.stageId)).toEqual(['s1']);
    expect(r.unmatchedKeys).toEqual(['soft.nope']);
  });

  it('⑦ visible=false 的段不参与（隐藏段不被命令翻出来）', async () => {
    const repos = fakeRepos({
      project: agentProject,
      stages: [
        stage('s1', 1, StageStatus.InProgress, 'k1', A[0], A[1], true),
        stage('s2', 2, StageStatus.InProgress, 'k2', B[0], B[1], false),
      ],
    });
    const r = asDry(
      await runRescheduleStages(
        { repos, rescheduleStage: async () => ({}) },
        { ...base, shiftDays: 7 },
        { dryRun: true },
      ),
    );
    expect(r.wouldShift.map((x) => x.stageId)).toEqual(['s1']);
  });
});
