/**
 * StageService 补充测试（QA 补充轮次）：
 *   - F7/P0 延期闸门：截止日后移 reason 必填，空串/空白同样拒绝；
 *     被拒时不得有任何写入（阶段数据与流水均不动）；
 *   - 平移/提前 reason 可空；延期成功状态联动 delayed（完成态除外）并留痕；
 *   - 四态流转：completed 仅可重开为 in_progress；解锁提示信号指向下一阶段。
 *
 * 采用 fake-indexeddb + 本地适配器做薄集成：闸门语义必须连同「写流水」一起验证，
 * mock 掉仓储会漏掉"拒绝路径零副作用"这一验收关键点。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { StageService } from '../src/core/services/stage.service';
import { ProjectService } from '../src/core/services/project.service';
import { previewSplit } from '../src/core/template/split';
import { ChangxiaError, ChangxiaErrorCode, StageLogType, StageStatus } from '../src/core/types/enums';
import { dayjs } from '../src/lib/date';
import type { Stage } from '../src/core/types/entities';

let bundle: IRepositoryBundle;
let svc: StageService;
let firstStage: Stage;
let secondStage: Stage;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  const projects = new ProjectService({ projects: bundle.projects, bundle });
  const drafts = previewSplit({ startAt: '2026-08-01', endAt: '2026-12-31' });
  const project = await projects.createProjectFromContract(
    {
      projectName: '延期闸门测试项目',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      startAt: '2026-08-01',
      endAt: '2026-12-31',
      stageOverrides: {},
      createdByManual: true,
      sourceFileName: null,
      rawTextDigest: '',
      parsedResultJsonSnapshot: '{}',
    },
    drafts,
  );
  const stages = await bundle.stages.listByProject(project.id);
  expect(stages).toHaveLength(9);
  firstStage = stages[0]!; // 提案
  secondStage = stages[1]!; // 测量
  svc = new StageService({ stages: bundle.stages, logs: bundle.logs });
});

const isoDay = (v: string | dayjs.Dayjs): string => dayjs(v).format('YYYY-MM-DD');

async function logCountOf(stageId: string): Promise<number> {
  return (await bundle.logs.listStageLogsByStage(stageId)).length;
}

describe('stage.service reschedule：延期原因强制闸门（PRD 硬规则）', () => {
  it('截止日后移且 reason=null → 拒绝（validation），阶段与流水零写入', async () => {
    const before = (await bundle.stages.get(firstStage.id))!;
    const oldLogs = await logCountOf(firstStage.id);

    await expect(
      svc.reschedule(firstStage.id, {
        newStartAt: isoDay(before.startAt),
        newEndAt: '2026-09-30', // 原止约 2026-08 中旬，显著后移
        reason: null,
        operatorName: '测试员',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const after = (await bundle.stages.get(firstStage.id))!;
    expect(isoDay(after.endAt)).toBe(isoDay(before.endAt));
    expect(after.revision).toBe(before.revision);
    expect(after.status).toBe(before.status);
    expect(await logCountOf(firstStage.id)).toBe(oldLogs);
  });

  it('reason 为空白字符串（纯空格）→ 同样拒绝', async () => {
    await expect(
      svc.reschedule(firstStage.id, {
        newStartAt: isoDay(firstStage.startAt),
        newEndAt: '2026-10-15',
        reason: '    ',
        operatorName: '测试员',
      }),
    ).rejects.toBeInstanceOf(ChangxiaError);
  });

  it('延期 + 有效 reason → 保存成功、状态联动 delayed、revision+1、留痕完整', async () => {
    const before = (await bundle.stages.get(firstStage.id))!;
    const oldLogs = await logCountOf(firstStage.id);

    const updated = await svc.reschedule(firstStage.id, {
      newStartAt: isoDay(before.startAt),
      newEndAt: '2026-10-20',
      reason: '业主方案确认延迟两周',
      operatorName: '许工',
    });

    expect(updated.status).toBe(StageStatus.Delayed);
    expect(updated.revision).toBe(before.revision + 1);
    expect(isoDay(updated.endAt)).toBe('2026-10-20');

    const logs = await bundle.logs.listStageLogsByStage(firstStage.id);
    expect(logs.length).toBe(oldLogs + 1);
    const last = logs[logs.length - 1]!;
    expect(last.type).toBe(StageLogType.Rescheduled);
    expect(last.reason).toBe('业主方案确认延迟两周');
    expect(last.operatorName).toBe('许工');
    expect(last.oldEndAt).toBe(before.endAt);
    expect(last.newEndAt).toBe(updated.endAt);
  });

  it('同日起止平移（end 不变）→ reason 可空、状态不变、照常留痕', async () => {
    const updated = await svc.reschedule(firstStage.id, {
      newStartAt: isoDay(firstStage.startAt),
      newEndAt: isoDay(firstStage.endAt),
      reason: null,
      operatorName: '许工',
    });
    expect(updated.status).not.toBe(StageStatus.Delayed);

    const logs = await bundle.logs.listStageLogsByStage(firstStage.id);
    const last = logs[logs.length - 1]!;
    expect(last.type).toBe(StageLogType.Rescheduled);
    expect(last.reason).toBeNull();
  });

  it('截止日提前（改早）→ 无需 reason 即可保存', async () => {
    const updated = await svc.reschedule(firstStage.id, {
      newStartAt: isoDay(firstStage.startAt),
      newEndAt: isoDay(dayjs(firstStage.endAt).subtract(2, 'day')),
      reason: null,
      operatorName: '许工',
    });
    expect(isoDay(updated.endAt)).toBe(isoDay(dayjs(firstStage.endAt).subtract(2, 'day')));
  });

  it('已 completed 阶段延后收尾 → 状态保持 completed 不被降级', async () => {
    await svc.transition(secondStage.id, StageStatus.Completed, '许工');
    const updated = await svc.reschedule(secondStage.id, {
      newStartAt: isoDay(secondStage.startAt),
      newEndAt: isoDay(dayjs(secondStage.endAt).add(5, 'day')),
      reason: '竣工验收顺延',
      operatorName: '许工',
    });
    expect(updated.status).toBe(StageStatus.Completed);
  });
});

describe('stage.service reschedule：入参防御', () => {
  it('新截止日早于新开始日 → validation 拒绝', async () => {
    await expect(
      svc.reschedule(firstStage.id, {
        newStartAt: '2026-09-10',
        newEndAt: '2026-09-01',
        reason: null,
        operatorName: 'x',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });
  });

  it('非法日期字符串 → validation 拒绝', async () => {
    await expect(
      svc.reschedule(firstStage.id, {
        newStartAt: 'not-a-date',
        newEndAt: '2026-09-01',
        reason: null,
        operatorName: 'x',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });
  });

  it('不存在的阶段 id → not_found', async () => {
    await expect(
      svc.reschedule('stg_does-not-exist', {
        newStartAt: '2026-09-01',
        newEndAt: '2026-09-02',
        reason: null,
        operatorName: 'x',
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.NotFound });
  });
});

describe('stage.service transition：四态流转与解锁信号', () => {
  it('未开始 → 进行中：留痕 status_changed', async () => {
    const { stage } = await svc.transition(firstStage.id, StageStatus.InProgress, '许工');
    expect(stage.status).toBe(StageStatus.InProgress);

    const logs = await bundle.logs.listStageLogsByStage(firstStage.id);
    const last = logs[logs.length - 1]!;
    expect(last.type).toBe(StageLogType.StatusChanged);
    expect(last.fromStatus).toBe(StageStatus.NotStarted);
    expect(last.toStatus).toBe(StageStatus.InProgress);
  });

  it('进行中 → 已完成：unlockHint 指向下一阶段（测量）', async () => {
    await svc.transition(firstStage.id, StageStatus.InProgress, '许工');
    const { stage, unlockHint } = await svc.transition(firstStage.id, StageStatus.Completed, '许工');
    expect(stage.status).toBe(StageStatus.Completed);
    expect(unlockHint.nextStageId).toBe(secondStage.id);
    expect(unlockHint.nextStageName).toBe(secondStage.name);
  });

  it('已完成 → 未开始：直接拒绝（conflict）', async () => {
    await svc.transition(firstStage.id, StageStatus.Completed, '许工');
    await expect(svc.transition(firstStage.id, StageStatus.NotStarted, '许工')).rejects.toMatchObject({
      code: ChangxiaErrorCode.Conflict,
    });
  });

  it('已完成 → 进行中：允许重开', async () => {
    await svc.transition(firstStage.id, StageStatus.Completed, '许工');
    const { stage } = await svc.transition(firstStage.id, StageStatus.InProgress, '许工');
    expect(stage.status).toBe(StageStatus.InProgress);
  });

  it('操作人名称缺省（空串）→ 流水里落「未知操作人」兜底', async () => {
    await svc.transition(firstStage.id, StageStatus.InProgress, '');
    const logs = await bundle.logs.listStageLogsByStage(firstStage.id);
    const last = logs[logs.length - 1]!;
    expect(last.operatorName).toBe('未知操作人');
  });
});
