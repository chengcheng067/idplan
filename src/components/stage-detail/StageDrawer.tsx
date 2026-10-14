import { useEffect } from 'react';

import { X } from 'lucide-react';

import type { Member, Stage, Task } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { useProjectsStore, createProjectActions } from '../../store/useProjectsStore';
import { useProjectById, useProjectStages, useProjectTasks } from '../../core/project/visibility';
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
import { stageStatusLabel, useLang } from '../../i18n';

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
  /* 取词 + 订阅语言变化（抽屉内的全部文案随语言变） */
  const { t } = useLang();
  const stageId = useUiStore((s) => s.stageDrawerStageId);
  const close = useUiStore((s) => s.closeStageDrawer);

  /*
    ★ v0.8 T04-A · 阶段抽屉的读点收口。

    抽屉是 `ProjectDetailPage` 的**子视图**，所以它天然属于 §7.3 #27「单项目直达」
    那一族：收窄口径必须是「**这个 projectId 名下**」而不是「人类侧」——
    若这里用 `useHumanStages()`，Agent 看板的阶段抽屉会变成"该阶段不存在"
    （用户点了甘特彩条却弹出一个空抽屉，比不弹更糟）。

    变化（相对改造前）：
      · `stage`   ：原先按 `stageId` **全库**找，现在先按 `projectId` 收窄再 find。
        语义更紧：抽屉本来就只服务于"当前这个项目里的阶段"，全库 find 会让一个
        不属于本项目的 stageId（理论上不该发生）也能渲染出来。
      · `tasks`   ：同上，先按 `projectId` 收窄再按 `stageId` 筛。
      · `project` ：`useProjectById(projectId)`（不分 kind，理由同详情页）。
      · `logs`    ：**保持原样**（`s.stageLogs[stageId]`）。它不是"列表"而是按
        stageId 单取的缓存字典，既不属于 §7.2 的 27 项、也不构成跨看板枚举；
        隔离守卫只盯 `projects` / `stages` / `tasks` 三份**数据切片**。

    ⚠️ 下方既有注释（hook 必须无条件执行）在改造后**依然成立且更需注意**：
       `useProjectStages` / `useProjectTasks` 都是真 hook，绝不能被挪到
       `if (!stageId) return null` 之后 —— 那会重演 BUG-1 的 React error #310 白屏
       （stageId 由 null 变非空时 hook 数量不一致）。本文件有专门的回归 spec 守着。
  */
  const stage = useProjectStages(projectId).find((x) => x.id === stageId);
  const tasks = useProjectTasks(projectId)
    .filter((t) => t.stageId === stageId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const logs = useProjectsStore((s) => (stageId ? s.stageLogs[stageId] : undefined));
  // 注意：该 hook 必须与其余 hook 同段、无条件执行。
  // 若放到下方 `if (!stageId) return null` 之后，点击甘特图彩条（stageId 由 null 变非空）
  // 会多执行 1 个 hook，触发 React error #310（Rendered more hooks than during the previous render）白屏。
  const project = useProjectById(projectId);
  const repos = useRepos();
  const { isAdmin } = useRoleGuard();

  useEffect(() => {
    if (stageId) {
      void createProjectActions(repos).loadStageLogs(stageId);
    }
  }, [stageId, repos]);

  /*
   * ★ F6-B：`stageId` 有值、但在**本项目**里找不到对应阶段 ⇒ **直接把抽屉合上**。
   *
   * 修前这里渲染的是一句「该阶段不存在或已被移除。」—— 但那个画面**用户从来没有
   * 主动要走进去**。它只由两种情况产生，两种都不该让用户看见一个错误的抽屉：
   *   ① 换页遗留：`stageDrawerStageId` 住在全局 store，离开项目页时没人清，
   *      再进任意项目详情页抽屉自动弹出；换到别的项目就是「阶段不存在」
   *      （真正的复位点已补在 `AppShell` 的路由 effect，本效果是**第二道**）；
   *   ② 抽屉开着时该阶段被删/被移除（并发编辑）—— 你正看着的东西没了，
   *      合上抽屉是唯一有意义的反应，让用户自己去关一个写着「已移除」的空壳没有价值。
   *
   * ⚠️ 位置在**所有 hook 之后、下方 `if (!stageId) return null` 之前**：本文件有
   * `tests/stage-drawer-hook-order.spec.tsx` 守着的 React #310 回归（hook 数量在
   * `stageId` null↔非空之间必须恒定），这个 effect 无条件执行，不参与那个开关。
   */
  useEffect(() => {
    if (stageId && !stage) close();
  }, [stageId, stage, close]);

  if (!stageId) return null;
  /**
   * `stageId` 指向的阶段不在本项目里：交给上面的 effect 合上抽屉，本帧先**不渲染
   * 任何东西**。为什么不是「渲染一句提示、等 effect 再关」——那会先闪一帧
   * 「该阶段不存在或已被移除」再消失，正是要消灭的那个画面。
   */
  if (!stage) return null;

  return (
    <Modal
      open
      onClose={close}
      placement="right"
      ariaLabel={t('stageDrawer.ariaWithName', { name: stage.name })}
    >
      {/*
        ★ 语言无关定位钩子（笔 3-D）：`ariaLabel` 已改走消息表（`stageDrawer.ariaWithName`），
        英文态形如 `Stage details: X` —— 拿「阶段详情」当选择器的（`[aria-label^="阶段详情"]`）
        会**静默失配**。取「这是阶段抽屉」请用本钩子（放在抽屉内容根上，语义即「抽屉本体」）。
      */}
      <aside
        data-stage-drawer=""
        className="flex h-full w-full flex-col border-l border-line bg-paper shadow-raised-lg rounded-l-3xl dark:rounded-l-2xl sm:max-w-[520px]"
      >
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
              {t('stageDrawer.subtitle', {
                project: project?.name ?? t('common.untitledProject'),
                n: stage.orderIndex,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('stageDrawer.closeAria')}
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
            <h3 className="mb-2 text-sm font-medium">{t('stageDrawer.tasksTitle')}</h3>
            <TaskChecklist stage={stage} tasks={tasks} members={members} />
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-medium">{t('stageDrawer.resourcesTitle')}</h3>
            <ResourcePathButton stage={stage} />
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-medium">{t('stageDrawer.delayArchiveTitle')}</h3>
            <DelayHistoryTimeline logs={logs ?? []} />
          </section>
        </div>
      </aside>
    </Modal>
  );
}

/* ------------------------------- 上区：状态 + 日期 ------------------------------ */

function StatusRow({ stage }: { stage: Stage; projectId: string }): JSX.Element {
  /* 取词 + 订阅语言变化（切换提示 / 下一阶段 toast 随语言变） */
  const { t } = useLang();
  const repos = useRepos();
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const members = useMembersStore((s) => s.members);
  const operatorName = members.find((m) => m.id === currentMemberId)?.name ?? '当前用户';

  const set = async (next: StageStatus): Promise<void> => {
    const actions = createProjectActions(repos);
    const hint = await actions.transitionStage(stage.id, next, operatorName);
    if (hint?.nextStageName) {
      useProjectsStore
        .getState()
        .pushToast('info', t('stageDrawer.nextStageToast', { name: hint.nextStageName }));
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
          title={t('stageDrawer.switchTo', { status: stageStatusLabel(s) })}
        >
          <StatusPill status={s} />
        </button>
      ))}
    </div>
  );
}

function DateRow({ stage }: { stage: Stage }): JSX.Element {
  /* 取词 + 订阅语言变化（开始/截止标签 + window.prompt + toast 随语言变） */
  const { t } = useLang();
  const repos = useRepos();
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const members = useMembersStore((s) => s.members);
  const operatorName = members.find((m) => m.id === currentMemberId)?.name ?? '当前用户';

  const applyRange = async (newStart: string, newEnd: string): Promise<void> => {
    const postponed =
      new Date(newEnd).getTime() > new Date(stage.endAt.slice(0, 10)).getTime();
    let reason: string | null = null;
    if (postponed) {
      reason = window.prompt(t('stageDrawer.postponePrompt')) ?? '';
      if (!reason.trim()) {
        useProjectsStore.getState().pushToast('error', t('stageDrawer.postponeCancelled'));
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
        <span className="text-mist">{t('timeline.dateEdge.start')}</span>
        <input
          type="date"
          value={stage.startAt.slice(0, 10)}
          onChange={(e) => void applyRange(e.target.value, stage.endAt.slice(0, 10))}
          className="rounded-md border border-line bg-paper px-2 py-1 tabular-nums outline-none focus:border-pine"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-mist">{t('timeline.dateEdge.end')}</span>
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

/*
 * 原 `labelOf(s)` 已退役（笔 3-D）：它手写的四态取值与 `stageStatusLabel`
 * （键 `stageStatus.*`）**逐字相同** ⇒ 改走既有键，不新建第二份「未开始/进行中/
 * 已完成/延期」（那正是本仓禁的「两份真相」）。
 * ⚠️ 保留这条注释是为了让「四态文案的出处」只有一个可查：`src/i18n/labels.ts`。
 */

export type { Task };
