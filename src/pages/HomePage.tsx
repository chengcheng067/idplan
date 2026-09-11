import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Plus } from 'lucide-react';

import { Button } from '../components/ui/Button';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ProjectCard } from '../components/project/ProjectCard';
import { StatCard } from '../components/project/StatCard';
import { ArchiveListRow } from '../components/project/ArchiveListRow';
import { MembersPageSection } from '../components/member/MembersPageSection';
import { MonthlyCalendarView } from '../components/calendar/MonthlyCalendarView';
import { useProjectsStore } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useUiStore, type HomeViewMode } from '../store/useUiStore';
import { useRoleGuard } from '../hooks/useRoleGuard';
import { computeProjectStatus, currentStageOf } from '../lib/progress';
import { StageStatus } from '../core/types/enums';
import {
  getDomainColumns,
  getDomains,
  getItemKanbanColumn,
  getPreset,
} from '../core/template/stage-library';
import type { Project, Stage, Task } from '../core/types/entities';
import { cn } from '../lib/cn';

/**
 * 首页（严格对齐规格 §2.5 首页各块 + 画板 02「亮色首页」/ 画板 12「暗色首页」）：
 *   页面标题行 → 统计卡行 → 视图切换行 → 项目卡片网格 → 已归档折叠区。
 *   视图模式仍走 useUiStore.homeViewMode / setHomeViewMode（契约不变），
 *   但视图切换控件改用本项目的 SegmentedControl（不再渲染 layout/HomeViewTabs）。
 *   内边距由本页根节点自持（AppShell 已移除全部内边距）。
 *
 * 看板分桶逻辑（deriveColumns / groupByColumn）保留导出：
 *   成员看板页（MemberBoardPage）仍依赖它按行业派生列，契约不变，此处仅不再渲染四列看板。
 */
export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const members = useMembersStore((s) => s.members);
  const { isAdmin } = useRoleGuard();
  const homeViewMode = useUiStore((s) => s.homeViewMode);
  const setHomeViewMode = useUiStore((s) => s.setHomeViewMode);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  // 手动建档显隐统走 store（AppShell 全局挂载表单），此处仅需打开意图
  const openManual = useUiStore((s) => s.openManualForm);

  const today = new Date();
  const todayIso = localIso(today);
  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status !== 'active');

  const stagesOf = (p: Project): Stage[] => stages.filter((s) => s.projectId === p.id);
  const tasksOf = (p: Project): Task[] => tasks.filter((t) => t.projectId === p.id);

  // 全局搜索：项目名 / 客户名（成员受限视图不按客户名搜，避免绕过脱敏）
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? active.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (isAdmin && (p.clientName ?? '').toLowerCase().includes(q)),
      )
    : active;

  // 指标卡（全部派生自 stages / projects，无历史趋势数据则不显示趋势）
  const weekStart = startOfWeekIso(today);
  const weekEnd = endOfWeekIso(today);
  const monthPrefix = todayIso.slice(0, 7);
  const visibleStages = stages.filter((s) => s.visible !== false);
  const dueThisWeek = visibleStages.filter(
    (s) =>
      s.status !== StageStatus.Completed &&
      s.endAt.slice(0, 10) >= weekStart &&
      s.endAt.slice(0, 10) <= weekEnd,
  ).length;
  const overdueCount = active.filter(
    (p) => computeProjectStatus(p, stagesOf(p), todayIso) === 'overdue',
  ).length;
  const doneThisMonth = visibleStages.filter(
    (s) => s.status === StageStatus.Completed && s.endAt.slice(0, 7) === monthPrefix,
  ).length;

  const openProject = (id: string): void => {
    setSelectedProjectId(id);
    navigate(`/project/${id}`);
  };

  return (
    <div className="flex flex-col gap-6 px-8 py-6 dark:gap-4 dark:px-6 dark:py-4">
      {/* 1. 页面标题行 */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[24px] font-bold text-ink">我的项目</h1>
        <div className="flex items-center gap-3">
          <Button variant="primary" icon={<Plus size={14} aria-hidden />} onClick={openManual}>
            新建项目
          </Button>
        </div>
      </div>

      {/* 2. 统计卡行（响应式：桌面 4 列 / 平板 2×2 / 手机单列） */}
      <section className="flex flex-wrap gap-5">
        <StatCard tone="pine" value={active.length} label="进行中项目" trend={null} />
        <StatCard tone="amber" value={dueThisWeek} label="本周到期任务" trend={null} />
        <StatCard tone="clay" value={overdueCount} label="逾期风险" trend={null} />
        <StatCard tone="sage" value={doneThisMonth} label="本月完工" trend={null} />
      </section>

      {/* 3. 视图切换行（替换 HomeViewTabs，契约不变：kanban / calendar） */}
      <SegmentedControl<HomeViewMode>
        ariaLabel="首页视图切换"
        value={homeViewMode}
        onChange={setHomeViewMode}
        options={[
          { value: 'kanban', label: '看板' },
          { value: 'calendar', label: '月历' },
        ]}
      />

      {/* 4/5 条件区：月历视图 vs 项目卡片网格 + 已归档折叠 */}
      {homeViewMode === 'calendar' ? (
        <MonthlyCalendarView onManual={openManual} />
      ) : (
        <>
          {active.length === 0 ? (
            <EmptyState onManual={openManual} />
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-paper p-8 text-center">
              <p className="text-[15px] text-mist">没有匹配「{searchQuery}」的项目</p>
              <Button variant="secondary" className="mt-3" onClick={() => setSearchQuery('')}>
                清除搜索
              </Button>
            </div>
          ) : (
            <section className="flex flex-wrap gap-5">
              {filtered.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  stages={stagesOf(p)}
                  tasks={tasksOf(p)}
                  members={members}
                  todayIso={todayIso}
                  selected={selectedProjectId === p.id}
                  onOpen={() => openProject(p.id)}
                />
              ))}
            </section>
          )}

          {archived.length > 0 && (
            <ArchivedSection archived={archived} onOpen={(id) => openProject(id)} />
          )}
        </>
      )}

      {/* 成员管理（权限矩阵 #5：仅 admin；路由守卫已把成员重定向出首页，这里双保险） */}
      {isAdmin && <MembersPageSection />}
    </div>
  );
}

/* ------------------------------ 已归档折叠区 ------------------------------ */

function ArchivedSection({
  archived,
  onOpen,
}: {
  archived: Project[];
  onOpen(id: string): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-12 w-full items-center gap-2.5 rounded-2xl border border-line bg-paper px-4 text-left text-[13px] text-ink',
          'transition-colors hover:bg-sunken dark:rounded-md',
        )}
      >
        <ChevronDown
          size={16}
          aria-hidden
          className={cn('text-mist transition-transform', open && 'rotate-180')}
        />
        <span>已归档（{archived.length}）</span>
      </button>
      {open && (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-soft dark:rounded-md">
          {archived.map((p) => (
            <ArchiveListRow key={p.id} project={p} onOpen={() => onOpen(p.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------ 空状态（无进行中项目） ------------------------------ */

function EmptyState({ onManual }: { onManual(): void }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-paper p-10 text-center">
      <p className="text-[15px] font-semibold text-ink">还没有进行中的项目</p>
      <p className="max-w-md text-[13px] leading-6 text-mist">
        新建一个项目，把阶段排期跑起来；项目名称与竣工日为必填，其余可进入后随时补充。
      </p>
      <p className="max-w-md rounded-2xl bg-cream px-4 py-3 text-[11px] leading-5 text-mist">
        你的数据自动保存在本机浏览器中，关闭浏览器不会丢失；如需换电脑或留档，点击顶栏「保存备份」导出文件，随时可再恢复。
      </p>
      <Button onClick={onManual} className="mt-1">
        直接手动建档
      </Button>
    </div>
  );
}

/* ------------------------------ 列定义与分桶（保留导出，供 MemberBoardPage 使用） ------------------------------ */

export type ColumnKey = string;

/** 起始列：未开始的项目固定落这里（非阶段声明，故不由模板定义） */
const TODO_COLUMN = 'todo' as const;

/** 看板列（渲染用的最终形态：模板数据 + 配色类名） */
export interface KanbanColumn {
  key: ColumnKey;
  label: string;
  dot: string;
  chip: string;
}

/**
 * 配色 token → Tailwind 类名。
 * 模板 JSON 只存 token 名（pine / stage-s3 …），不携带 UI 框架的实现细节。
 *
 * ⚠️ **必须逐条写死字面量，不得用循环 + 模板字符串生成**（BUG-05）。
 * Tailwind 的 CSS 生成是静态文本扫描，`bg-stage-s${i}` 这种拼接类名在扫描期无法求值，
 * 结果是一条 CSS 都不生成 —— 阶段色点与阶段 chip 会在亮/暗两套主题下**完全不显色**，
 * 而 tsc 与单测都发现不了（只有真浏览器看构建产物才看得见）。
 * 这一段曾被写成 `for (let i = 1; i <= 9; i += 1) { TONE_CLASSES[`stage-s${i}`] = … }`。
 */
const TONE_CLASSES: Record<string, { dot: string; chip: string }> = {
  mist: { dot: 'bg-mist', chip: 'bg-sand text-mist' },
  pine: { dot: 'bg-pine', chip: 'bg-pine-soft text-pine' },
  amber: { dot: 'bg-amber', chip: 'bg-amber-soft text-amber' },
  'stage-s1': { dot: 'bg-stage-s1', chip: 'bg-stage-s1/15 text-stage-s1' },
  'stage-s2': { dot: 'bg-stage-s2', chip: 'bg-stage-s2/15 text-stage-s2' },
  'stage-s3': { dot: 'bg-stage-s3', chip: 'bg-stage-s3/15 text-stage-s3' },
  'stage-s4': { dot: 'bg-stage-s4', chip: 'bg-stage-s4/15 text-stage-s4' },
  'stage-s5': { dot: 'bg-stage-s5', chip: 'bg-stage-s5/15 text-stage-s5' },
  'stage-s6': { dot: 'bg-stage-s6', chip: 'bg-stage-s6/15 text-stage-s6' },
  'stage-s7': { dot: 'bg-stage-s7', chip: 'bg-stage-s7/15 text-stage-s7' },
  'stage-s8': { dot: 'bg-stage-s8', chip: 'bg-stage-s8/15 text-stage-s8' },
  'stage-s9': { dot: 'bg-stage-s9', chip: 'bg-stage-s9/15 text-stage-s9' },
};
const FALLBACK_TONE = TONE_CLASSES.mist;

function toneOf(tone: string): { dot: string; chip: string } {
  return TONE_CLASSES[tone] ?? FALLBACK_TONE;
}

/**
 * 按当前项目集合派生看板列：
 *   todo 固定在最前，其后是这些项目所属行业在模板里声明的列（去重、按模板声明顺序）。
 */
export function deriveColumns(projects: Project[]): KanbanColumn[] {
  const used = new Set<string>();
  for (const p of projects) {
    const preset = p.stagePresetKey ? getPreset(p.stagePresetKey) : null;
    if (preset) used.add(preset.domain);
  }
  if (used.size === 0) used.add('indoor');

  const columns: KanbanColumn[] = [{ key: TODO_COLUMN, label: '待启动', ...toneOf('mist') }];
  const seen = new Set<string>([TODO_COLUMN]);
  for (const [domainKey] of getDomains()) {
    if (!used.has(domainKey)) continue;
    for (const c of getDomainColumns(domainKey)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      columns.push({ key: c.key, label: c.label, ...toneOf(c.tone) });
    }
  }
  return columns;
}

/**
 * 项目 → 看板列：
 *   未开始 → todo；
 *   进行中 → 当前阶段项声明的 kanbanColumn（v2 起由模板声明）；
 *   老数据 → 回退所属行业，按 orderIndex 均分落段。
 */
function columnOf(
  status: ReturnType<typeof computeProjectStatus>,
  currentStage: Stage | null,
  domainKey: string | null,
): ColumnKey {
  if (status === 'not_started') return TODO_COLUMN;

  const declared = currentStage ? getItemKanbanColumn(currentStage.templateKey) : null;
  if (declared) return declared;

  const cols = getDomainColumns(domainKey ?? 'indoor');
  if (cols.length === 0) return 'build';
  if (status === 'completed') return cols[cols.length - 1].key;

  const idx = currentStage?.orderIndex ?? 9;
  const per = Math.ceil(9 / cols.length);
  const slot = Math.min(cols.length - 1, Math.floor(Math.max(idx - 1, 0) / per));
  return cols[slot].key;
}

export function groupByColumn(
  projects: Project[],
  stagesOf: (p: Project) => Stage[],
  todayIso: string,
): { columns: KanbanColumn[]; buckets: Record<ColumnKey, Project[]> } {
  const columns = deriveColumns(projects);
  const buckets: Record<ColumnKey, Project[]> = {};
  for (const c of columns) buckets[c.key] = [];

  for (const p of projects) {
    const st = stagesOf(p);
    const status = computeProjectStatus(p, st, todayIso);
    const cur = currentStageOf(st, todayIso) ?? null;
    const domainKey = (p.stagePresetKey ? getPreset(p.stagePresetKey) : null)?.domain ?? null;
    const key = columnOf(status, cur, domainKey);
    if (key in buckets) buckets[key].push(p);
    else buckets[columns[columns.length - 1].key].push(p);
  }
  return { columns, buckets };
}

/* ------------------------------ 日期工具（本地时区，避免 UTC 偏移） ------------------------------ */

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 本周一（周一为一周起点） */
function startOfWeekIso(d: Date): string {
  const day = (d.getDay() + 6) % 7;
  const s = new Date(d);
  s.setDate(d.getDate() - day);
  return localIso(s);
}

/** 本周日 */
function endOfWeekIso(d: Date): string {
  const day = (d.getDay() + 6) % 7;
  const e = new Date(d);
  e.setDate(d.getDate() + (6 - day));
  return localIso(e);
}
