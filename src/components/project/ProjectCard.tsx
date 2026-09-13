import { useEffect, useRef, useState } from 'react';
import { CalendarRange, MoreHorizontal, Archive, Palette, Trash2 } from 'lucide-react';

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
import { Tag } from '../ui/Tag';
import { STAGE_BAR_COLORS } from '../timeline/stageColors';
import { ProjectAppearanceDialog } from './ProjectAppearanceDialog';
import { cn } from '../../lib/cn';

/**
 * 项目卡片（规格 §2.5 项目卡片网格 + 画板 02）：
 *   bg-paper + shadow-raised；桌面 圆角24 / 高185，平板 圆角12 / 高124（flex-wrap，不写死列数）；
 *   信息架构 = 项目名(15/600) → 委托方(13 次级) → 阶段进度轨道(高8，多段按比例拼接，槽 sunken) →
 *   底部元信息行(周期 11 + 阶段标签 + 成员头像组)。
 * 阶段色走 STAGE_BAR_COLORS（实心块 main 色），阶段标签走 Tag（stageIndex 取 lightBar + lightText）。
 * 状态语义色全部走 token，禁止裸 hex。选中态 = 主色环。
 *
 * ⋯ 更多菜单（仅 admin）：重命名 / 导出日程表 / 归档 / 删除，复用既有 Modal / ConfirmDialog。
 * 卡片原 <button> 改 div[role=button] + keydown 可达，⋯ 触发器独立 <button> 并 stopPropagation。
 *
 * ── v0.7-D：成员导出日程表入口 ──
 *   用户已拍板「放开成员打印（只读导出）」，故成员侧需有自己的入口。管理员的 ⋯ 菜单
 *   **整体保持 admin-only**（内含重命名 / 侧栏方块外观 / 归档 / 删除四个**写操作**，
 *   放开容器等于把四个写口一起暴露给成员），因此这里为成员单独渲染一个图标按钮，
 *   只做「新窗口打开 /project/:id/schedule-print」（与详情页「日程表」按钮同目标）。
 *   判据用 `isMember`（= role === 'member'，useRoleGuard 的既有导出）：
 *   未进入身份（role=null）**不**渲染，与打印页守卫的「未进入不放行」同档。
 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';

/** 状态 → 文字语义色（用于进度百分比与逾期日期文字） */
const STATUS_TONE = {
  in_progress: { text: 'text-pine' },
  completed: { text: 'text-stage-s1' },
  overdue: { text: 'text-clay' },
  not_started: { text: 'text-mist' },
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
  const { role, isAdmin, isMember } = useRoleGuard();
  const memberView = isRestrictedView(role);
  const repos = useRepos();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** v0.7 B1：侧栏方块外观（简称 + 自定义色）编辑弹窗 */
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const actions = createProjectActions(repos);

  const cur = currentStageOf(stages, todayIso);
  const percent = computeProjectPercent(stages);
  const status = computeProjectStatus(project, stages, todayIso);
  const tone = STATUS_TONE[status];

  // 参与人：当前阶段未完成任务的执行人 + 阶段负责人（沿用 v0.3 口径，成员受限时 mask 姓名）
  const stageMembers = members.filter((m) => m.active && (!cur?.ownerId || m.id === cur.ownerId));
  const activeMemberIds = new Set(
    tasks
      .filter((t) => cur && t.stageId === cur.id && !taskIsDone(t))
      .flatMap((t) => taskAssigneeIds(t)),
  );
  const cardMembers = members.filter(
    (m) => activeMemberIds.has(m.id) || (cur?.ownerId && m.id === cur.ownerId),
  );

  const typeLabel = PROJECT_TYPE_LABELS[project.type as ProjectType] ?? '未分类';
  const clientText = !memberView && project.clientName
    ? `${typeLabel} · ${project.clientName}`
    : typeLabel;

  const stageLabel = cur ? `${CIRCLED[cur.orderIndex - 1] ?? cur.orderIndex} ${cur.name}` : '全部完成';
  const dueIso = cur?.endAt.slice(0, 10) ?? project.plannedEndAt;
  const dueMd = dueIso.slice(5).replace('-', '-');
  const overdueDays = daysBetween(dueIso, todayIso);
  const dueText = overdueDays > 0 ? `逾期 ${overdueDays} 天` : `${dueMd} 到期`;

  // 阶段进度轨道：可见阶段按工期占比拼接多段（实心块 main 色）
  const visibleStages = stages.filter((s) => s.visible !== false);
  const ordered = [...visibleStages].sort((a, b) => a.orderIndex - b.orderIndex);
  const segs = ordered.map((s) => {
    const s0 = Date.parse(s.startAt ?? '');
    const e0 = Date.parse(s.endAt ?? '');
    const dur = Number.isFinite(s0) && Number.isFinite(e0) ? Math.max(e0 - s0, 1) : 1;
    return { dur, color: STAGE_BAR_COLORS[s.orderIndex] ?? STAGE_BAR_COLORS[9] };
  });
  const total = segs.reduce((a, s) => a + s.dur, 0) || 1;

  /**
   * 本项目当前阶段色 —— 侧栏方块「跟随阶段色」时的取值（v0.7 B1）。
   * 与 Sidebar 折叠态方块的回落口径一致：取最早可见阶段的实心块色。
   * 本文件既有 segs 也用 `STAGE_BAR_COLORS[s.orderIndex]`，故此处沿用同一口径，
   * 不额外引入 resolveStageColorIndex（避免同一文件出现两套取色约定）。
   */
  const stageAccentColor = STAGE_BAR_COLORS[ordered[0]?.orderIndex ?? 1] ?? STAGE_BAR_COLORS[9];

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
        // Soft UI 卡片：bg-paper + shadow-raised；Cloud Float 悬浮上浮 + 选中态主色环
        'group flex w-full min-w-0 cursor-pointer flex-col bg-paper shadow-raised',
        'rounded-md p-4 gap-[10px] h-[124px]',
        'md:w-[calc(50%-10px)]',
        // 桌面列宽：规格 §2.5 明确写「卡片宽 365、高 185」，并注明
        // 「365 是 1440 下的固定稿宽，实现时用 flex: 1 1 340px 让列数随容器自适应」。
        // 这个 340 的基准是**精确校准过的**：内容区 = 1440 − 侧栏 240 − 内边距 64 = 1136，
        //   3 张：340×3 + gap 20×2 = 1060 ≤ 1136 → 放下，且各自伸展到 (1136−40)/3 = 365.3 ✓
        //   4 张：340×4 + gap 20×3 = 1420 > 1136 → 放不下，自动换行
        // 所以 1440 下恰好是 3 列 × 365。若写成 flex-1（= flex: 1 1 0%），
        // 基准宽度变 0、四张卡全挤进一行各 279px，与规格差一整列 —— 这是曾经的实现。
        'xl:w-auto xl:flex-[1_1_340px] xl:h-[185px] xl:rounded-3xl xl:p-6 xl:gap-3',
        'transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-raised-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/50',
        selected && 'ring-2 ring-pine/50',
      )}
    >
      {/* 标题行：项目名 + ⋯ 更多菜单（独立 button + stopPropagation） */}
      <div className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink group-hover:text-pine">
          {project.name}
        </span>
        {/* v0.7-D：成员（role==='member'）的「导出日程表」入口——只读导出，与详情页同目标。
            stopPropagation 必需：外层 role=button 的 onClick 会跳详情页，不拦就变成"点导出跳详情"。 */}
        {isMember && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/project/${project.id}/schedule-print`, '_blank');
            }}
            aria-label="导出日程表"
            title="导出日程表（新窗口，只读导出）"
            className="shrink-0 rounded-full p-1.5 text-mist transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:bg-sunken hover:text-pine"
          >
            <CalendarRange size={16} aria-hidden />
          </button>
        )}
        {isAdmin && (
          <div ref={menuRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={openMenu}
              aria-label="项目更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded-full p-1.5 text-mist transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:bg-sunken hover:text-pine"
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
                  data-project-appearance-trigger=""
                  onClick={() => {
                    setMenuOpen(false);
                    setAppearanceOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-sunken"
                >
                  <Palette size={14} className="text-mist" aria-hidden />
                  侧栏方块外观
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

      {/* 委托方（成员受限视图隐藏客户名，沿用既有语义） */}
      <span className="w-full truncate text-[13px] text-mist">{clientText}</span>

      {/* 阶段进度轨道：高 8，槽 sunken，多段按工期占比拼接（实心块 main 色） */}
      <div className="flex w-full flex-col gap-1">
        <div className="flex w-full items-center justify-between text-[12px]">
          <span className="text-mist">进度</span>
          <span className={cn('font-medium', tone.text)}>{Math.round(percent)}%</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken">
          {segs.map((s, i) => (
            <div
              key={i}
              className="h-full"
              style={{ width: `${(s.dur / total) * 100}%`, backgroundColor: s.color }}
            />
          ))}
        </div>
      </div>

      {/* 底部元信息行：周期 + 阶段标签 + 成员头像组 */}
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] text-mist">{dueText}</span>
          {cur && (
            <Tag stageIndex={cur.orderIndex - 1}>{stageLabel}</Tag>
          )}
        </div>
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
              className="soft-btn-ghost rounded-2xl px-5 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out hover:-translate-y-0.5"
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

      {/* 侧栏方块外观编辑（v0.7 B1）：简称 + 自定义方块色，独立弹窗（刻意与重命名分开） */}
      <ProjectAppearanceDialog
        open={appearanceOpen}
        project={project}
        stageAccentColor={stageAccentColor}
        onClose={() => setAppearanceOpen(false)}
        onSave={(patch) => void actions.updateProject(project.id, patch)}
      />

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
