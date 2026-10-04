/**
 * Agent 执行域**存储边界强制层**单测（第一切片补强）。
 *
 * 目标：状态机不再是「只活在纯函数层」——`LocalExecutionsRepository` 的写路径
 * 必须在事务内闭合校验，且**拒绝时零写入**（不能只看抛没抛，必须断言库未变）。
 *
 * 覆盖（team-lead 验收清单）：
 *   1. updateExecutionStatus → completed（无 applied 提案）→ 抛错 + 行未变；
 *   2. 终态出边（cancelled → running / failed → completed）→ 抛错；
 *   3. 未确认时 → queued / → running → 抛错（确认门槛）；
 *   4. 连续两次 createAttempt({status:'running'}) → 第二次抛错 + 仅 1 条活 attempt；
 *   5. 调用方传入错误 attemptNo → 抛错；
 *   6. appendEvent 乱序 seq → 抛错 + 事件数未增。
 *   另含正向用例：条件齐备时 completed / queued→running 放行，证明门槛不误杀。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  ExecutionStatus,
  WritebackProposalStatus,
  type ExecutionConfirmation,
} from '../src/core/types/agent-execution';
import type { Execution } from '../src/core/types/entities';
import { ChangxiaError, ChangxiaErrorCode } from '../src/core/types/enums';
import { ProjectStatus, ScheduleBasis } from '../src/core/types/enums';
import { BackupService } from '../src/core/services/backup.service';
import {
  assertExecutionConfirmed,
} from '../src/core/execution/execution-state';
import { computePlanHash } from '../src/core/execution/plan-hash';

let bundle: IRepositoryBundle;

const CONFIRMATION: ExecutionConfirmation = {
  confirmedAt: '2026-08-01T00:00:00.000Z',
  confirmedBy: 'u1',
  // planHash 占位：调用方一律经 setStatus，由该 helper 用 computePlanHash(真实执行单) 覆写。
  planHash: '',
  planRevision: 1,
};

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      // ★ v0.8 隔离补齐（2026-09-20）：执行域只属于 Agent 看板 —— 仓储层 createExecution /
      //   createProposal 现在强制 projectId 指向 kind='agent' 的项目。夹具里的 p1 因此
      //   必须是 agent 板（此前 projects 为空数组，p1 是幻影 id，现在会被关卡拒）。
      projects: [
        {
          id: 'p1',
          name: 'Agent 看板',
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          plannedStartAt: '2026-08-01',
          plannedEndAt: '2026-12-31',
          coverColor: null,
          shortLabel: null,
          stagePresetKey: 'indoor_full',
          stageTemplateVersion: 2,
          scheduleBasis: ScheduleBasis.Calendar,
          domain: 'indoor',
          kind: 'agent',
          // v0.8.6 归属人（null = 公共板；这些 spec 不测归属）
          ownerMemberId: null,
          status: ProjectStatus.Active,
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      stages: [],
      tasks: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
      executions: [],
      executionAttempts: [],
      executionEvents: [],
      writebackProposals: [],
    },
  });
});

async function newExecution(): Promise<string> {
  const created = await bundle.executions.createExecution({
    projectId: 'p1',
    source: 'project-task',
    objective: 'x',
    idempotencyKey: `exec:${Math.random()}`,
  });
  return created.id;
}

/** 构造一条「全字段」的执行单（供纯函数层 computePlanHash / assertExecutionConfirmed 使用） */
function makeExecution(
  id: string,
  status: ExecutionStatus,
  plan: Partial<Execution> = {},
): Execution {
  return {
    id,
    projectId: 'p1',
    taskId: null,
    source: 'project-task',
    objective: 'x',
    agentMemberId: null,
    channelKind: null,
    inputSnapshotHash: null,
    status,
    confirmation: null,
    idempotencyKey: `exec:${id}`,
    currentAttemptNo: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
    ...plan,
  };
}

/** 用「真实执行单」算出的确认快照（planHash 必须 == computePlanHash(exec) 才能过门槛） */
function confirmationFor(exec: Execution, overrides: Partial<ExecutionConfirmation> = {}): ExecutionConfirmation {
  return {
    confirmedAt: '2026-08-01T00:00:00.000Z',
    confirmedBy: 'u1',
    planHash: computePlanHash(exec),
    planRevision: 1,
    ...overrides,
  };
}

async function setStatus(id: string, status: ExecutionStatus, confirmation?: ExecutionConfirmation) {
  // ★ 若传了确认快照，用「真实执行单」重算 planHash 以通过 stale-approval 绑定门槛
  //   （测试夹具不再手抄 hash，避免「形状校验永远绿」）。
  let actual = confirmation;
  if (confirmation) {
    const exec = await bundle.executions.getExecution(id);
    if (!exec) throw new Error(`fixture: execution ${id} 不存在`);
    actual = confirmationFor(exec, { ...confirmation, planHash: computePlanHash(exec) });
  }
  return bundle.executions.updateExecutionStatus(
    id,
    actual ? { status, confirmation: actual } : { status },
  );
}

/** 合法推进到终态 cancelled */
async function toCancelled(id: string) {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Cancelled);
}

/** 合法推进到终态 failed（需先确认才能进 queued） */
async function toFailed(id: string) {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);
  await setStatus(id, ExecutionStatus.Failed);
}

/** 合法推进到 awaiting_review（completed 的前置态） */
async function toAwaitingReview(id: string) {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);
  await setStatus(id, ExecutionStatus.Running);
  await setStatus(id, ExecutionStatus.AwaitingReview);
}

describe('updateExecutionStatus：completed 强约束', () => {
  it('awaiting_review 无 applied 提案 → completed 抛错且行未变', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);

    await expect(setStatus(id, ExecutionStatus.Completed)).rejects.toBeInstanceOf(ChangxiaError);

    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.AwaitingReview); // 零写入：状态未推进
  });

  it('awaiting_review 有 applied 提案 → completed 放行', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);

    const proposal = await bundle.executions.createProposal({
      executionId: id,
      projectId: 'p1',
      taskId: 't1',
      operations: [{ field: 'task.status', before: 'review', after: 'done' }],
      idempotencyKey: `wb:${id}:t1:task.status`,
    });
    await bundle.executions.updateProposal(proposal.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });

    const updated = await setStatus(id, ExecutionStatus.Completed);
    expect(updated.status).toBe(ExecutionStatus.Completed);
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.Completed);
  });
});

describe('updateExecutionStatus：终态出边一律拒绝', () => {
  it('cancelled → running 抛错（终态不可转移）', async () => {
    const id = await newExecution();
    await toCancelled(id);

    await expect(setStatus(id, ExecutionStatus.Running)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.Cancelled); // 零写入
  });

  it('failed → completed 抛错（终态不可转移）', async () => {
    const id = await newExecution();
    await toFailed(id);

    await expect(setStatus(id, ExecutionStatus.Completed)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.Failed); // 零写入
  });
});

describe('updateExecutionStatus：人工确认门槛（未确认绝不进入 queued/running）', () => {
  it('AwaitingConfirmation → queued 未带 confirmation → 抛错', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation); // 合法、无需确认

    // AwaitingConfirmation → Queued 本身是合法边，但确认门槛应拦下（无 confirmation）。
    await expect(setStatus(id, ExecutionStatus.Queued)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.AwaitingConfirmation); // 零写入
  });

  it('已确认：Queued(confirmation) → Running 放行（门槛不误杀合法路径）', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION); // 带确认进入 queued
    const updated = await setStatus(id, ExecutionStatus.Running); // 确认已就位 → 放行
    expect(updated.status).toBe(ExecutionStatus.Running);
  });

  it('纯函数 assertExecutionConfirmed：未确认 next=running 抛错、确认且 hash 匹配放行', async () => {
    const exec = makeExecution('e1', ExecutionStatus.Queued);
    const confirmed = confirmationFor(exec);
    // 本组只验**绑定比对**（门槛的第二关）；「调用方是否当场写入凭据」的授予点限制
    // 是另一关，由下面的仓储级/纯函数用例单独覆盖，故此处统一声明「本调用未写入凭据」。
    const pure = { confirmationWrittenByCaller: false };
    // 未确认 → 抛
    expect(() =>
      assertExecutionConfirmed({ ...exec, confirmation: null }, ExecutionStatus.Running, pure),
    ).toThrow(ChangxiaError);
    expect(() =>
      assertExecutionConfirmed({ ...exec, confirmation: null }, ExecutionStatus.Queued, pure),
    ).toThrow(ChangxiaError);
    // 确认且 hash 匹配 → 不抛
    expect(() =>
      assertExecutionConfirmed({ ...exec, confirmation: confirmed }, ExecutionStatus.Running, pure),
    ).not.toThrow();
    expect(() =>
      assertExecutionConfirmed({ ...exec, confirmation: confirmed }, ExecutionStatus.Queued, pure),
    ).not.toThrow();
    // ★ 确认但 hash 不匹配（计划被改）→ 抛（stale approval 收紧的核心）
    const tampered = { ...exec, objective: '已被改动的计划', confirmation: confirmed };
    expect(() =>
      assertExecutionConfirmed(tampered, ExecutionStatus.Running, pure),
    ).toThrow(ChangxiaError);
    // 非 queued/running 的态不受门槛约束
    expect(() =>
      assertExecutionConfirmed({ ...exec, confirmation: confirmed }, ExecutionStatus.Cancelled, pure),
    ).not.toThrow();
  });

  // ── 授予点限制（规格 §224 点名的缺口）──────────────────────────────────
  // 缺口 C 的本质：调用方能在**任何**合法迁移上塞一份新确认快照，而校验看的正是
  // 「它自己刚塞进来的那个值」——用提交者提供的凭据证明提交者的正当性。
  // 故：确认对象**只能在授予点写入**，其余一律拒绝。

  it('授予点限制：paused → running 自带新确认快照 → 抛错且零写入（规格 §224 点名的那条边）', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION); // ← 授予点，合法写入
    await setStatus(id, ExecutionStatus.Running);
    await setStatus(id, ExecutionStatus.Paused);
    const before = await bundle.executions.getExecution(id);

    await expect(setStatus(id, ExecutionStatus.Running, CONFIRMATION)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });

    const after = await bundle.executions.getExecution(id);
    expect(after?.status).toBe(ExecutionStatus.Paused); // 状态零写入
    expect(after?.confirmation).toEqual(before?.confirmation); // 凭据未被改写
  });

  it('授予点限制：queued → running 自带确认快照同样被拒（只能用已落库那份）', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);

    await expect(setStatus(id, ExecutionStatus.Running, CONFIRMATION)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.Queued);
  });

  it('纯函数：同一条 paused execution —— 写凭据被拒、复用已存凭据放行', () => {
    const exec = makeExecution('e1', ExecutionStatus.Paused);
    const confirmed = confirmationFor(exec);
    // 调用方当场写入 → 非授予点 → 拒（正是缺口 C）
    expect(() =>
      assertExecutionConfirmed(
        { ...exec, confirmation: confirmed },
        ExecutionStatus.Running,
        { confirmationWrittenByCaller: true },
      ),
    ).toThrow(ChangxiaError);
    // 未写入（复用已落库凭据）→ 授予点限制不介入，交由绑定比对把关 → 放行
    expect(() =>
      assertExecutionConfirmed(
        { ...exec, confirmation: confirmed },
        ExecutionStatus.Running,
        { confirmationWrittenByCaller: false },
      ),
    ).not.toThrow();
  });

  // ── 审计：审批必须 append-only（规格 §38）────────────────────────────

  it('授予审计：成功授予恰好落一条 confirmation_granted，且 reason 留下 planHash 与 confirmedBy', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);

    const granted = (await bundle.executions.listEvents(id)).filter(
      (e) => e.type === 'confirmation_granted',
    );
    expect(granted).toHaveLength(1);
    expect(granted[0]!.actor).toBe('user');
    // ExecutionEvent 没有 payload 字段，故「批准的是哪一版计划」只能落在 reason 里
    expect(granted[0]!.reason).toContain('planHash=');
    expect(granted[0]!.reason).toContain('confirmedBy=u1');
  });

  it('授予审计：被拒的授予零写入且不落任何事件（不能只留半条流水）', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);

    // planHash 空 → 绑定比对拒绝
    await expect(
      bundle.executions.updateExecutionStatus(id, {
        status: ExecutionStatus.Queued,
        confirmation: { ...CONFIRMATION },
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    expect((await bundle.executions.getExecution(id))?.status).toBe(
      ExecutionStatus.AwaitingConfirmation,
    );
    expect(await bundle.executions.listEvents(id)).toHaveLength(0);
  });

  it('授予审计：显式清空确认（null）不算「授予」→ 不落审计事件', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);
    const afterGrant = (await bundle.executions.listEvents(id)).length; // 授予审计 1 条

    await bundle.executions.updateExecutionStatus(id, {
      status: ExecutionStatus.Cancelled,
      confirmation: null,
    });

    expect((await bundle.executions.getExecution(id))?.confirmation).toBeNull();
    expect(await bundle.executions.listEvents(id)).toHaveLength(afterGrant); // 无新增
  });

  // ── 决策⑥：确认绑定的是**计划**，不是 attempt ──────────────────────────

  it('同一计划重试：needs_attention 上计划未变 → 复用旧确认可重回 running（不需要重新确认）', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);
    await setStatus(id, ExecutionStatus.Running);
    await setStatus(id, ExecutionStatus.NeedsAttention);
    const stored = await bundle.executions.getExecution(id);

    // 不携带新凭据 → 授予点限制不介入；计划未变 → 绑定比对通过
    const back = await setStatus(id, ExecutionStatus.Running);
    expect(back.status).toBe(ExecutionStatus.Running);
    expect((await bundle.executions.getExecution(id))?.confirmation).toEqual(stored?.confirmation);
  });

  // ── 存储边界确实执行了绑定比对（而不是只活在纯函数层）────────────────────
  // 本项目踩过的坑：撤掉服务端适配层的白名单后测试曾全绿，因为路由层先拦住了、
  // 适配器层校验在测试上完全不可见 —— 于是那层成了「装饰性存在」。
  // 故这里必须有一条用例，把校验**经由仓储真实写路径**验一遍。

  it('存储边界：计划被外部改写（备份导入整库替换绕过校验）→ 旧确认失效，queued → running 被拒且零写入', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION); // 授予：绑定「当时那一版」计划

    // 真实存在的绕过路径：备份导入是整库替换，不做任何状态/绑定校验。
    // 用它把「计划被改写」落到库里 —— 这正是 stale approval 要防的场景。
    const svc = new BackupService(bundle);
    const pkg = await svc.exportAll();
    const patched = {
      ...pkg,
      data: {
        ...pkg.data,
        executions: pkg.data.executions.map((e) =>
          e.id === id ? { ...e, objective: '被改写后的另一版计划' } : e,
        ),
      },
    };
    await svc.importAndReplace(patched as typeof pkg);

    const tampered = await bundle.executions.getExecution(id);
    expect(tampered?.objective).toBe('被改写后的另一版计划'); // 前提成立
    expect(tampered?.confirmation).not.toBeNull(); // 旧凭据仍在（导入侧不做绑定校验）
    expect(tampered?.status).toBe(ExecutionStatus.Queued); // 兜底只收敛 running，不碰 queued

    // 旧确认绑的是上一版计划 → 存储边界必须拒绝，且**零写入**
    await expect(setStatus(id, ExecutionStatus.Running)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.Queued);
  });

  // ── 关卡②字段级覆盖（对抗式验证 report M3/M3b 的遗留补救）────────────────
  // 背景：`assertExecutionConfirmed` 关卡②对 confirmedAt / confirmedBy / planHash
  // 的逐字段非空检查曾零变异覆盖（删光它们全量测试全绿）。以下用例的构造纪律：
  //   · planHash 一律 == computePlanHash(exec)（否则被关卡③先行拒绝，测的不是②）；
  //   · confirmationWrittenByCaller: false（否则踩关卡①的授予点限制）。
  // 每条用例在「删掉对应字段检查」的变异下必须变红。

  it('纯函数：planHash 匹配但 confirmedAt 为空 → 拒（关卡②字段级覆盖）', () => {
    const exec = makeExecution('e1', ExecutionStatus.Queued);
    const pure = { confirmationWrittenByCaller: false };
    expect(() =>
      assertExecutionConfirmed(
        { ...exec, confirmation: confirmationFor(exec, { confirmedAt: '' }) },
        ExecutionStatus.Running,
        pure,
      ),
    ).toThrow(ChangxiaError);
  });

  it('纯函数：planHash 匹配但 confirmedBy 为空 → 拒（关卡②字段级覆盖）', () => {
    const exec = makeExecution('e1', ExecutionStatus.Queued);
    const pure = { confirmationWrittenByCaller: false };
    expect(() =>
      assertExecutionConfirmed(
        { ...exec, confirmation: confirmationFor(exec, { confirmedBy: '' }) },
        ExecutionStatus.Running,
        pure,
      ),
    ).toThrow(ChangxiaError);
  });

  it('存储边界：库里存着畸形确认（planHash 匹配但 confirmedBy / confirmedAt 空）→ queued → running 被拒且零写入', async () => {
    // 与上面「计划被改写」用例同款路径：备份导入是整库替换、零校验，
    // 用它把畸形确认种进真实存储，再走 updateExecutionStatus 写路径。
    for (const field of ['confirmedBy', 'confirmedAt'] as const) {
      const id = await newExecution();
      await setStatus(id, ExecutionStatus.AwaitingConfirmation);
      await setStatus(id, ExecutionStatus.Queued, CONFIRMATION); // 合法授予（planHash 匹配）

      const svc = new BackupService(bundle);
      const pkg = await svc.exportAll();
      const patched = {
        ...pkg,
        data: {
          ...pkg.data,
          executions: pkg.data.executions.map((e) => {
            if (e.id !== id) return e;
            const c = e.confirmation!;
            return {
              ...e,
              confirmation:
                field === 'confirmedBy'
                  ? { ...c, confirmedBy: '' }
                  : { ...c, confirmedAt: '' },
            };
          }),
        },
      };
      await svc.importAndReplace(patched as typeof pkg);

      const tampered = await bundle.executions.getExecution(id);
      expect(tampered?.status).toBe(ExecutionStatus.Queued); // 导入不改状态
      const stored = tampered?.confirmation;
      expect(stored).not.toBeNull();
      expect(stored![field]).toBe(''); // 前提：畸形确认已落库
      // planHash 未被导入改动 → 关卡③不掩盖，拒绝只能来自关卡②
      expect(stored!.planHash).toBe(computePlanHash(tampered!));

      await expect(setStatus(id, ExecutionStatus.Running)).rejects.toMatchObject({
        code: ChangxiaErrorCode.Validation,
      });
      expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.Queued); // 零写入
    }
  });
});

describe('createAttempt：单活 attempt + attemptNo 计算', () => {
  it('连续两次 createAttempt({status:"running"}) → 第二次抛错且只有 1 条活 attempt', async () => {
    const id = await newExecution();
    const first = await bundle.executions.createAttempt({ executionId: id, status: 'running' });
    expect(first.attemptNo).toBe(1);
    expect(first.status).toBe('running');

    await expect(
      bundle.executions.createAttempt({ executionId: id, status: 'running' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Conflict });

    const attempts = await bundle.executions.listAttempts(id);
    expect(attempts).toHaveLength(1); // 第二次零写入
    expect(attempts[0]!.status).toBe('running');
  });

  it('调用方传入错误 attemptNo（与计算值不一致）→ 抛错', async () => {
    const id = await newExecution();
    // 先放一条「终态」attempt，使下次可新开且计算值为 2。
    await bundle.executions.createAttempt({ executionId: id, status: 'succeeded' });

    await expect(
      bundle.executions.createAttempt({ executionId: id, attemptNo: 99, status: 'queued' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const attempts = await bundle.executions.listAttempts(id);
    expect(attempts).toHaveLength(1); // 错误 attemptNo 未落库
  });

  it('不传 attemptNo 时由仓储单调分配', async () => {
    const id = await newExecution();
    const a1 = await bundle.executions.createAttempt({ executionId: id, status: 'succeeded' });
    const a2 = await bundle.executions.createAttempt({ executionId: id, status: 'running' });
    expect(a1.attemptNo).toBe(1);
    expect(a2.attemptNo).toBe(2);
  });
});

describe('appendEvent：seq 严格单调', () => {
  it('乱序 seq（期望 2 却传 3）→ 抛错且事件数未增', async () => {
    const id = await newExecution();
    await bundle.executions.appendEvent({
      executionId: id,
      attemptId: null,
      seq: 1,
      type: 'created',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });

    await expect(
      bundle.executions.appendEvent({
        executionId: id,
        attemptId: null,
        seq: 3, // 期望 2
        type: 'status_changed',
        actor: 'system',
        fromStatus: null,
        toStatus: null,
        reason: null,
        idempotencyKey: null,
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const events = await bundle.executions.listEvents(id);
    expect(events).toHaveLength(1); // 乱序事件零写入
  });

  it('顺序 seq（1 → 2）正常落库', async () => {
    const id = await newExecution();
    await bundle.executions.appendEvent({
      executionId: id,
      attemptId: null,
      seq: 1,
      type: 'created',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });
    await bundle.executions.appendEvent({
      executionId: id,
      attemptId: null,
      seq: 2,
      type: 'confirmation_granted',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });
    const events = await bundle.executions.listEvents(id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });
});

/** 建一条 draft 写回提案（可选覆盖状态，用于验证「创建即终态」被拒） */
async function newProposal(executionId: string, status?: WritebackProposalStatus) {
  return bundle.executions.createProposal({
    executionId,
    projectId: 'p1',
    taskId: 't1',
    operations: [{ field: 'task.status', before: 'review', after: 'done' }],
    idempotencyKey: `wb:${executionId}:task.status`,
    ...(status ? { status } : {}),
  });
}

describe('写回提案：审批权威必须在数据上成立', () => {
  it('createProposal 不允许创建即 applied → 抛错且零写入', async () => {
    const id = await newExecution();
    await expect(newProposal(id, WritebackProposalStatus.Applied)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    expect(await bundle.executions.listProposals(id)).toHaveLength(0);
  });

  it('createProposal 不允许创建即 rejected → 抛错且零写入', async () => {
    const id = await newExecution();
    await expect(newProposal(id, WritebackProposalStatus.Rejected)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    expect(await bundle.executions.listProposals(id)).toHaveLength(0);
  });

  it('落定 applied 缺 decidedBy → 抛错，状态与 decidedAt 均未变', async () => {
    const id = await newExecution();
    const p = await newProposal(id);

    await expect(
      bundle.executions.updateProposal(p.id, { status: WritebackProposalStatus.Applied }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const rows = await bundle.executions.listProposals(id);
    expect(rows[0]!.status).toBe(WritebackProposalStatus.Draft); // 零写入
    expect(rows[0]!.decidedBy).toBeNull();
    expect(rows[0]!.decidedAt).toBeNull();
  });

  it('落定 applied 带 decidedBy → 放行且 decidedAt 由仓储盖上', async () => {
    const id = await newExecution();
    const p = await newProposal(id);

    const updated = await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });
    expect(updated.status).toBe(WritebackProposalStatus.Applied);
    expect(updated.decidedBy).toBe('u1');
    expect(updated.decidedAt).toBeTruthy();
  });

  it('已 applied 的提案不可再改（含换 operations）→ Conflict 且内容未变', async () => {
    const id = await newExecution();
    const p = await newProposal(id);
    await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });

    await expect(
      bundle.executions.updateProposal(p.id, {
        operations: [{ field: 'task.status', before: 'review', after: 'archived' }],
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Conflict });

    const rows = await bundle.executions.listProposals(id);
    expect(rows[0]!.operations[0]!.after).toBe('done'); // 审批后换内容被拦
    expect(rows[0]!.status).toBe(WritebackProposalStatus.Applied);
  });

  it('已 rejected 的提案不可再改状态 → Conflict', async () => {
    const id = await newExecution();
    const p = await newProposal(id);
    await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Rejected,
      decidedBy: 'u1',
    });

    await expect(
      bundle.executions.updateProposal(p.id, { status: WritebackProposalStatus.Applied, decidedBy: 'u2' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Conflict });

    const rows = await bundle.executions.listProposals(id);
    expect(rows[0]!.status).toBe(WritebackProposalStatus.Rejected);
  });

  it('draft → proposed 仍放行（合法路径不被误杀）', async () => {
    const id = await newExecution();
    const p = await newProposal(id);
    const updated = await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Proposed,
    });
    expect(updated.status).toBe(WritebackProposalStatus.Proposed);
    expect(updated.decidedAt).toBeNull(); // 未落定，不算审批
  });
});

describe('updateAttempt：attempt 状态机强制', () => {
  it('succeeded → running → 抛错且状态未变', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'succeeded' });

    await expect(
      bundle.executions.updateAttempt(a.id, { status: 'running' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const rows = await bundle.executions.listAttempts(id);
    expect(rows[0]!.status).toBe('succeeded'); // 终态不可复活
  });

  it('failed → running → 抛错且状态未变', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'failed' });

    await expect(
      bundle.executions.updateAttempt(a.id, { status: 'running' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    expect((await bundle.executions.listAttempts(id))[0]!.status).toBe('failed');
  });

  it('queued → running 放行（合法边不被误杀）', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'queued' });
    const updated = await bundle.executions.updateAttempt(a.id, { status: 'running' });
    expect(updated.status).toBe('running');
  });

  it('running → succeeded 放行且盖上 finishedAt', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'running' });
    const updated = await bundle.executions.updateAttempt(a.id, { status: 'succeeded' });
    expect(updated.status).toBe('succeeded');
    expect(updated.finishedAt).toBeTruthy(); // 终态必须有结束时间
  });
});

describe('端到端：completed 的真实防线是「有审批人落定的 applied 提案」', () => {
  it('缺 decidedBy 的 applied 提案无法凑出 → 执行单停在待验收', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);
    const p = await newProposal(id);

    // 1) 试图不带审批人直接落定 applied → 被拒（这就是本次新增的核心防线）
    await expect(
      bundle.executions.updateProposal(p.id, { status: WritebackProposalStatus.Applied }),
    ).rejects.toBeInstanceOf(ChangxiaError);
    // 2) 制造 applied 失败后，completed 前置仍不成立
    await expect(setStatus(id, ExecutionStatus.Completed)).rejects.toBeInstanceOf(ChangxiaError);

    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.AwaitingReview); // 零写入，没假装完成
  });

  it('带审批人正常落定后 completed 可达（门槛不误杀合法路径）', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);
    const p = await newProposal(id);
    await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });

    const done = await setStatus(id, ExecutionStatus.Completed);
    expect(done.status).toBe(ExecutionStatus.Completed);
  });
});

/**
 * 执行域归属关卡（v0.8 隔离补齐 · 2026-09-20）：本地 Dexie 侧与服务端
 * `sqlite.bundle.ts` 的同名关卡**逐字同义**。
 *
 * 覆盖：人类项目 / 幻影 id 两条创建路径（执行单 + 提案）均被拒且零写入；
 * agent 板放行（上方全部存量用例已在证明——它们的 p1 现在是 agent 板）。
 * 拒绝理由可分辨：不存在 → NotFound；存在但 kind 非 agent → Validation。
 */
describe('执行域归属关卡：本地存储边界（只属于 Agent 看板）', () => {
  /** 另种一个 kind='human' 的项目，作为「打错归属」的拒绝对象 */
  async function seedHumanProject(): Promise<void> {
    await bundle.projects.insert({
      id: 'p_human',
      name: '人类项目',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-12-31',
      coverColor: null,
      shortLabel: null,
      stagePresetKey: 'indoor_full',
      stageTemplateVersion: 2,
      scheduleBasis: ScheduleBasis.Calendar,
      domain: 'indoor',
      kind: 'human',
      // v0.8.6 归属人（null = 公共板；这些 spec 不测归属）
      ownerMemberId: null,
    });
  }

  it('createExecution：人类项目 → Validation 且零写入', async () => {
    await seedHumanProject();
    await expect(
      bundle.executions.createExecution({
        projectId: 'p_human',
        source: 'project-task',
        objective: 'x',
        idempotencyKey: 'gate:local:human:1',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });
  });

  it('createExecution：幻影 id（项目不存在）→ NotFound', async () => {
    await expect(
      bundle.executions.createExecution({
        projectId: 'no_such_project',
        source: 'project-task',
        objective: 'x',
        idempotencyKey: 'gate:local:ghost:1',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.NotFound });
  });

  it('createProposal：写回目标指向人类项目 → Validation 且零写入', async () => {
    await seedHumanProject();
    const id = await newExecution(); // 执行单在 p1（agent 板）上，合法
    await expect(
      bundle.executions.createProposal({
        executionId: id,
        projectId: 'p_human',
        taskId: 't1',
        operations: [{ field: 'task.status', before: 'review', after: 'done' }],
        idempotencyKey: 'gate:local:proposal:human',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });
    expect(await bundle.executions.listProposals(id)).toHaveLength(0);
  });

  it('createProposal：写回目标是幻影 id → NotFound 且零写入', async () => {
    const id = await newExecution();
    await expect(
      bundle.executions.createProposal({
        executionId: id,
        projectId: 'no_such_project',
        taskId: 't1',
        operations: [{ field: 'task.status', before: 'review', after: 'done' }],
        idempotencyKey: 'gate:local:proposal:ghost',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.NotFound });
    expect(await bundle.executions.listProposals(id)).toHaveLength(0);
  });

  it('拒否文案带实际 kind（排错不用翻库）', async () => {
    await seedHumanProject();
    await expect(
      bundle.executions.createExecution({
        projectId: 'p_human',
        source: 'project-task',
        objective: 'x',
        idempotencyKey: 'gate:local:msg:1',
      }),
    ).rejects.toThrow(/kind="human"/);
  });
});
