import { useEffect, useRef, useState } from 'react';
import { CalendarRange, MoreHorizontal, Archive, Trash2 } from 'lucide-react';

import type { Member, Project, Stage, Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { PROJECT_TYPE_LABELS, ProjectType } from '../../core/types/enums';
import { useRoleGuard, isRestrictedView, taskAssigneeIds } from '../../hooks/useRoleGuard';
import { currentStageOf, computeProjectPercent, computeProjectStatus } from '../../lib/progress';
import { useRepos } from '../../hooks/useRepos';
import { createProjectActions } from '../../store/useProjectsStore';
import { useNavigate } from 'react-router-dom';
import { AvatarStack } from '../common/AvatarStack';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ImeInput } from '../common/ImeInput';
import { Modal } from '../common/Modal';
import { cn } from '../../lib/cn';

/**
 * 项目卡片（严格对齐参考稿 §卡片）：
 *   glass / 圆角16 / padding16 / gap12；
 *   信息架构 = 项目名(15/600) → 客户(12 次级) → 阶段 tag(圆角8) → 进度(6px 细条 + 百分比) →
 *   footer(截止日 12/500 + 成员头像组 26px)。
 * 状态语义色（进行中 pine / 逾期 clay / 完成 stage.s1 / 未开始 mist）全部走 token，禁止裸 hex。
 * 选中态 = 参考稿蓝紫描边 + 双层光晕 + 亮底（最近打开的项目）。
 *
 * v0.x · ⋯ 更多菜单（产品调研结论后实现）：
 *   - 修复交互结构：卡片原为 <button>，HTML 禁止嵌套交互元素 → 改为 div[role=button] + keydown 可达，
 *     ⋯ 触发器是独立 <button> 并 stopPropagation（否则点菜单误触打开项目）。
 *   - 菜单项（仅 admin 可见卡片场景渲染）：重命名 / 导出日程表 / 归档（复用已有后端与路由）。
 *   - 重命名：复用 store updateProject(id,{name})；归档：复用 setArchived；均走统一 Modal / ConfirmDialog。
 */

const CIRCLED = '①②③④⑤⑥⑦⑧⑨';

/** 状态 → 语义色 token（tag 文字 / tag 底 / 进度条填充 / 日期文字） */
const STATUS_TONE = {
  in_progress: { text: 'text-pine', soft: 'bg-pine-soft', fill: 'bg-pine' },
  completed: { text: 'text-stage-s1', soft: 'bg-stage-s1/15', fill: 'bg-stage-s1' },
  overdue: { text: 'text-clay', soft: 'bg-clay-soft', fill: 'bg-clay' },
  not_started: { text: 'text-mist', soft: 'bg-sand', fill: 'bg-mist' },
} as const;

function daysBetween(fromIso: string, toIso: string): number {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / MS);
}

export function ProjectCard({
  project,
  stages,
  tasks,
  members,
  todayIso,
  selected = false,
  onOpen,
}: {
  project: Project;
  stages: Stage[];
  tasks: Task[];
  members: Member[];
  todayIso: string;
  selected?: boolean;
  onOpen(): void;
}): JSX.Element {
  // useRoleGuard 只调用一次（原先调了两次，两个订阅点做同一件事）。
  // memberView 与 isAdmin 严格互补（memberView === !isAdmin，见 isRestrictedView 定义），
  // 仍保留两个名字：调用点读「受限视图该不该藏客户名」和「有没有管理权限」是两种意图，
  // 统一成一个名字反而让 JSX 里的语义变模糊。
  const { role, isAdmin } = useRoleGuard();
  const memberView = isRestrictedView(role);
  const repos = useRepos();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const actions = createProjectActions(repos);

  const cur = currentStageOf(stages, todayIso);
  const percent = computeProjectPercent(stages);
  const status = computeProjectStatus(project, stages, todayIso);
  const tone = STATUS_TONE[status];

  // 参与人：当前阶段未完成任务的执行人 + 阶段负责人（沿用 v0.3 口径，成员受限时mask姓名）
  const stageMembers = members.filter((m) => m.active && (!cur?.ownerId || m.id === cur.ownerId));
  const activeMemberIds = new Set(
    tasks
      .filter((t) => cur && t.stageId === cur.id && !taskIsDone(t))
      .flatMap((t) => taskAssigneeIds(t)),
  );
  const cardMembers = members.filter(
    (m) => activeMemberIds.has(m.id) || (cur?.ownerId && m.id === cur.ownerId),
  );

  const stageLabel = cur ? `${CIRCLED[cur.orderIndex - 1] ?? cur.orderIndex} ${cur.name}` : '全部完成';
  const dueIso = cur?.endAt.slice(0, 10) ?? project.plannedEndAt;
  const dueMd = dueIso.slice(5).replace('-', '-');
  const overdueDays = daysBetween(dueIso, todayIso);
  const dueText = overdueDays > 0 ? `逾期 ${overdueDays} 天` : `${dueMd} 到期`;

  // 外点关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const confirmRename = (): void => {
    const v = renameValue.trim();
    if (v && v !== project.name) void actions.updateProject(project.id, { name: v });
    setRenameOpen(false);
    setMenuOpen(false);
  };

  const openMenu = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setMenuOpen((v) => !v);
  };

  // 右键直接打开菜单（仅 admin 可见卡片场景）；阻止默认浏览器上下文菜单
  const openContextMenu = (e: React.MouseEvent): void => {
    if (!isAdmin) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(true);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={openContextMenu}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        // Soft UI 参考形态：.soft-card = bg-paper + 1px 极弱描边 + raised 外凸阴影
        // Cloud Float 悬浮上浮（-4px / 300ms）+ Halo Focus 光晕聚焦
        // 选中态改用主色环，取代旧版蓝紫渐变硬描边与 rgba 硬编码底色（那会盖掉暗色主题）
        'group soft-card flex w-full cursor-pointer flex-col gap-3 rounded-3xl p-4 text-left transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-raised-lg soft-focus-halo md:p-5',
        selected && 'ring-2 ring-pine/50',
      )}
    >
      {/* 标题行：项目名 + ⋯ 更多菜单（独立 button + stopPropagation） */}
      <div className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-md font-semibold text-ink group-hover:text-pine">
          {project.name}
        </span>
        {isAdmin && (
          <div ref={menuRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={openMenu}
              aria-label="项目更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded-full p-1.5 text-mist transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:bg-sunken hover:text-pine soft-press soft-focus-halo"
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="glass-medium menuFadeIn absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-line py-1.5 shadow-overlay"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRenameValue(project.name);
                    setMenuOpen(false);
                    setRenameOpen(true);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-sunken"
                >
                  项目重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    window.open(`/project/${project.id}/schedule-print`, '_blank');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-sunken"
                >
                  <CalendarRange size={14} className="text-mist" aria-hidden />
                  导出日程表
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={project.status !== 'active'}
                  onClick={() => {
                    setMenuOpen(false);
                    setArchiveOpen(true);
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Archive size={14} className="text-mist" aria-hidden />
                  归档项目
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-clay hover:bg-clay-soft"
                >
                  <Trash2 size={14} aria-hidden />
                  删除项目
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 客户（成员受限视图隐藏，沿用既有语义） */}
      <span className="w-full truncate text-[12px] text-mist">
        {PROJECT_TYPE_LABELS[project.type as ProjectType] ?? '未分类'}
        {!memberView && project.clientName ? ` · ${project.clientName}` : ''}
      </span>

      {/* 阶段 tag */}
      <span
        className={cn(
          'inline-flex max-w-full items-center truncate rounded-2xl px-3 py-1 text-[12px] font-medium',
          tone.soft,
          tone.text,
        )}
      >
        {stageLabel}
      </span>

      {/* 进度（6px 细条 + 百分比，口径 = 已完成可见阶段 / 可见阶段总数） */}
      <div className="flex w-full flex-col gap-1.5">
        <div className="flex w-full items-center justify-between text-[12px]">
          <span className="text-mist">进度</span>
          <span className={cn('font-medium', tone.text)}>{Math.round(percent)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
          <div
            className={cn('h-full rounded-full transition-all', tone.fill)}
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
      </div>

      {/* footer：截止日 + 成员头像组 */}
      <div className="flex w-full items-center justify-between gap-2">
        <span className={cn('flex items-center gap-1.5 text-[12px] font-medium', status === 'overdue' ? 'text-clay' : 'text-mist')}>
          <span aria-hidden>▦</span>
          {dueText}
        </span>
        <AvatarStack
          members={cardMembers.length > 0 ? cardMembers : stageMembers}
          maskMemberNames={memberView}
        />
      </div>

      {/* 重命名弹窗 */}
      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} ariaLabel="项目重命名">
        <div className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-3xl p-6 shadow-overlay outline-none">
          <h2 className="font-display text-display-md">项目重命名</h2>
          <p className="mt-1 text-xs text-mist">修改后将同步到项目详情与所有视图。</p>
          <ImeInput
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename();
            }}
            placeholder="输入新的项目名称"
            aria-label="新的项目名称"
            className="soft-input mt-4 w-full rounded-2xl px-4 py-3 text-sm text-ink outline-none placeholder:text-mist"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="soft-btn-ghost rounded-2xl px-5 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out hover:-translate-y-0.5 soft-press soft-focus-halo"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmRename}
              disabled={!renameValue.trim() || renameValue.trim() === project.name}
              className="soft-btn-primary rounded-2xl px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:shadow-none"
            >
              保存
            </button>
          </div>
        </div>
      </Modal>

      {/* 归档确认（danger 变体） */}
      <ConfirmDialog
        open={archiveOpen}
        title="归档项目"
        confirmText="归档"
        danger
        onConfirm={() => {
          void actions.setArchived(project.id, true);
          setArchiveOpen(false);
        }}
        onCancel={() => setArchiveOpen(false)}
      >
        确认归档「{project.name}」？归档后将从首页列表隐藏（可在「已归档」区恢复）。
      </ConfirmDialog>

      {/* 永久删除确认（danger 变体，明确不可恢复） */}
      <ConfirmDialog
        open={deleteOpen}
        title="删除项目"
        confirmText="删除"
        danger
        onConfirm={() => {
          void actions.removeProject(project.id, project.name);
          setDeleteOpen(false);
        }}
        onCancel={() => setDeleteOpen(false)}
      >
        确认删除「{project.name}」？该项目下的所有阶段、任务与操作记录将一并永久删除，{' '}
        <span className="font-medium text-clay">不可恢复</span>。建议先归档而非删除。
      </ConfirmDialog>
    </div>
  );
}
