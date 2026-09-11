import { useEffect } from 'react';

import { X } from 'lucide-react';

import type { Member, Stage, Task } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { useProjectsStore, createProjectActions } from '../../store/useProjectsStore';
import { useMembersStore } from '../../store/useMembersStore';
import { useUiStore } from '../../store/useUiStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useRepos } from '../../hooks/useRepos';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { StatusPill } from '../common/StatusPill';
import { Modal } from '../common/Modal';
import { TaskChecklist } from './TaskChecklist';
import { DelayHistoryTimeline } from './DelayHistoryTimeline';
import { ResourcePathButton } from './ResourcePathButton';

/**
 * 阶段详情侧滑抽屉壳：
 *   上区 状态胶囊切换 + 起止日期行内编辑（改期必经 reschedule 闸门——日历变更直接调弹窗语义，
 *   此处完成后移日期使用同一 RescheduleStageCmd，原因后移时必填）
 *   中区 A 任务清单 / 中区 B 资料入口
 *   下区 延期档案（append-only 渲染）
 */
export function StageDrawer({
  projectId,
  members,
}: {
  projectId: string;
  members: Member[];
}): JSX.Element | null {
  const stageId = useUiStore((s) => s.stageDrawerStageId);
  const close = useUiStore((s) => s.closeStageDrawer);

  const stage = useProjectsStore((s) => s.stages.find((x) => x.id === stageId));
  const tasks = useProjectsStore((s) =>
    s.tasks.filter((t) => t.stageId === stageId).sort((a, b) => a.orderIndex - b.orderIndex),
  );
  const logs = useProjectsStore((s) => (stageId ? s.stageLogs[stageId] : undefined));
  // 注意：该 hook 必须与其余 hook 同段、无条件执行。
  // 若放到下方 `if (!stageId) return null` 之后，点击甘特图彩条（stageId 由 null 变非空）
  // 会多执行 1 个 hook，触发 React error #310（Rendered more hooks than during the previous render）白屏。
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId));
  const repos = useRepos();
  const { isAdmin } = useRoleGuard();

  useEffect(() => {
    if (stageId) {
      void createProjectActions(repos).loadStageLogs(stageId);
    }
  }, [stageId, repos]);

  if (!stageId) return null;
  if (!stage) {
    return (
      <DrawerFrame onClose={close} title="阶段详情">
        <p className="text-sm text-mist">该阶段不存在或已被移除。</p>
      </DrawerFrame>
    );
  }

  return (
    <Modal open onClose={close} placement="right" ariaLabel={`阶段详情：${stage.name}`}>
      <aside className="flex h-full w-full flex-col border-l border-line bg-paper shadow-raised-lg rounded-l-3xl dark:rounded-l-2xl sm:max-w-[520px]">
        {/* 手机端顶部抓手横条（提示可手势下滑关闭区域；平板以上隐藏） */}
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-sand sm:hidden" aria-hidden />
        {/* 头（画板 05：标题列 阶段名 18/600 + 副标题 13 mist + 关闭 36×36 sunken 圆角12） */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="font-display text-display-md">
              <span className="mr-2 text-mist">{stage.orderIndex}.</span>
              {stage.name}
            </h2>
            <p className="mt-1 text-[13px] text-mist">
              {project?.name ?? '项目'} · 第 {stage.orderIndex} 阶段
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭抽屉"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sunken text-mist transition-colors hover:bg-sand"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* 阶段流转/改期是管理员操作（权限矩阵 #11）；成员保留查看任务清单/资料路径/延期档案 */}
          {isAdmin && <StatusRow stage={stage} projectId={projectId} />}
          {isAdmin && <DateRow stage={stage} />}

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-medium">本阶段该做</h3>
            <TaskChecklist stage={stage} tasks={tasks} members={members} />
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-medium">备注与资料</h3>
            <ResourcePathButton stage={stage} />
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-medium">延期档案（只增不改）</h3>
            <DelayHistoryTimeline logs={logs ?? []} />
          </section>
        </div>
      </aside>
    </Modal>
  );
}

function DrawerFrame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose(): void;
}): JSX.Element {
  return (
    <Modal open onClose={onClose} placement="right" ariaLabel={title}>
      <aside className="flex h-full w-full flex-col border-l border-line bg-paper p-6 shadow-raised-lg rounded-l-3xl dark:rounded-l-2xl sm:max-w-[520px]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-display-md">{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sunken text-mist transition-colors hover:bg-sand">
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </Modal>
  );
}

/* ------------------------------- 上区：状态 + 日期 ------------------------------ */

function StatusRow({ stage }: { stage: Stage; projectId: string }): JSX.Element {
  const repos = useRepos();
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const members = useMembersStore((s) => s.members);
  const operatorName = members.find((m) => m.id === currentMemberId)?.name ?? '设计师本人';

  const set = async (next: StageStatus): Promise<void> => {
    const actions = createProjectActions(repos);
    const hint = await actions.transitionStage(stage.id, next, operatorName);
    if (hint?.nextStageName) {
      useProjectsStore
        .getState()
        .pushToast('info', `可提醒下一阶段「${hint.nextStageName}」的成员开工`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.values(StageStatus) as StageStatus[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => void set(s)}
          className={`transition-opacity ${stage.status === s ? 'opacity-100' : 'opacity-60 hover:opacity-90'}`}
          title={`切换为 ${labelOf(s)}`}
        >
          <StatusPill status={s} />
        </button>
      ))}
    </div>
  );
}

function DateRow({ stage }: { stage: Stage }): JSX.Element {
  const repos = useRepos();
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const members = useMembersStore((s) => s.members);
  const operatorName = members.find((m) => m.id === currentMemberId)?.name ?? '设计师本人';

  const applyRange = async (newStart: string, newEnd: string): Promise<void> => {
    const postponed =
      new Date(newEnd).getTime() > new Date(stage.endAt.slice(0, 10)).getTime();
    let reason: string | null = null;
    if (postponed) {
      reason = window.prompt('截止日后移需要填写延期原因（将完整留痕）：') ?? '';
      if (!reason.trim()) {
        useProjectsStore.getState().pushToast('error', '未填写延期原因，已取消保存。');
        return;
      }
    }
    const actions = createProjectActions(repos);
    await actions.rescheduleStage(stage.id, {
      newStartAt: `${newStart}T00:00:00Z`,
      newEndAt: `${newEnd}T23:59:59Z`,
      reason: reason?.trim() || null,
      operatorName,
    });
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-mist">开始</span>
        <input
          type="date"
          value={stage.startAt.slice(0, 10)}
          onChange={(e) => void applyRange(e.target.value, stage.endAt.slice(0, 10))}
          className="rounded-md border border-line bg-paper px-2 py-1 tabular-nums outline-none focus:border-pine"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-mist">截止</span>
        <input
          type="date"
          value={stage.endAt.slice(0, 10)}
          onChange={(e) => void applyRange(stage.startAt.slice(0, 10), e.target.value)}
          className="rounded-md border border-line bg-paper px-2 py-1 tabular-nums outline-none focus:border-pine"
        />
      </label>
    </div>
  );
}

/* --------------------------------- 内部工具 --------------------------------- */

function labelOf(s: StageStatus): string {
  return s === StageStatus.NotStarted
    ? '未开始'
    : s === StageStatus.InProgress
      ? '进行中'
      : s === StageStatus.Completed
        ? '已完成'
        : '延期';
}

export type { Task };
