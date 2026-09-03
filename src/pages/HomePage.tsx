import { useNavigate } from 'react-router-dom';

import { ProjectCard } from '../components/project/ProjectCard';
import { StatCard } from '../components/project/StatCard';
import { ArchiveListRow } from '../components/project/ArchiveListRow';
import { MembersPageSection } from '../components/member/MembersPageSection';
import { MonthlyCalendarView } from '../components/calendar/MonthlyCalendarView';
import { useProjectsStore } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useUiStore } from '../store/useUiStore';
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

/**
 * 首页（严格对齐参考稿 §统计概览行 + §四列 Kanban）：
 *   概览行 = 4 张指标玻璃卡（进行中 / 本周到期 / 逾期风险 / 本月完工，数据全部派生、不伪造趋势）；
 *   主体 = 看板（待启动 + 所属行业声明的阶段列），列头 = 语义色圆点 + 列名 + 数量徽章。
 * 列定义自 v2 起由阶段模板的 domains 段给出（见 deriveColumns），不再写死「设计/深化/施工」——
 * 室内/景观/建筑三行业沿用旧列名，跨行业项目（软件、影视、活动、婚礼、咨询）用自己的流程列。
 * 列归属优先取当前阶段项声明的 kanbanColumn；老数据（templateKey 为 null）回退按 orderIndex 均分落段。
 * 视图开关已上移到 TopBar（参考稿应用栏形态），全局搜索按项目名 / 客户名过滤。
 */
export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const members = useMembersStore((s) => s.members);
  const { isAdmin } = useRoleGuard();
  const homeViewMode = useUiStore((s) => s.homeViewMode);
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

  // 看板分桶（列随项目所属行业派生，见 deriveColumns）
  const { columns, buckets } = groupByColumn(filtered, stagesOf, todayIso);

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
    <div className="flex flex-col gap-4">
      {homeViewMode === 'calendar' ? (
        <MonthlyCalendarView onManual={openManual} />
      ) : (
        <>
          {/* 统计概览行（参考稿 §统计概览行）：手机单列、平板双列、桌面四列） */}
          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard icon="▣" tone="pine" value={active.length} label="进行中项目" trend={null} />
            <StatCard icon="▢" tone="amber" value={dueThisWeek} label="本周到期任务" trend={null} />
            <StatCard icon="▲" tone="clay" value={overdueCount} label="逾期风险" trend={null} />
            <StatCard icon="✓" tone="sage" value={doneThisMonth} label="本月完工" trend={null} />
          </section>

          {/* 四列看板 */}
          {active.length === 0 ? (
            <EmptyState onManual={openManual} />
          ) : filtered.length === 0 ? (
            <div className="glass-light rounded-[16px] border border-dashed border-sand p-6 text-center sm:p-10">
              <p className="font-display text-display-md text-mist">没有匹配「{searchQuery}」的项目</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3 rounded-md border border-pine px-4 py-2 text-sm text-pine hover:bg-pine-soft"
              >
                清除搜索
              </button>
            </div>
          ) : (
            <section
              /* 列数由行业决定（设计 3 列、影视 4 列、软件 5 列…），不能再写死 grid-cols-4。
                 用 auto-fit + minmax 让浏览器按可用宽度排：手机 1 列、平板 2 列、桌面尽量铺开。
                 注意：注释必须放在 JSX 属性位置——三元括号内直接写花括号注释是表达式位，会编译错。 */
              className="grid items-start gap-3 sm:gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}
            >
              {columns.map((col) => {
                const items = buckets[col.key] ?? [];
                return (
                    <div
                    key={col.key}
                    className="glass-light flex flex-col gap-3 rounded-3xl p-3.5"
                  >
                    {/* 列头：语义色圆点 + 列名 + 数量徽章 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${col.dot}`} aria-hidden />
                        <span className="text-sm font-semibold text-ink">{col.label}</span>
                      </div>
                      <span
                        className={`rounded-[10px] px-2.5 py-0.5 text-[12px] font-medium ${col.chip}`}
                      >
                        {items.length}
                      </span>
                    </div>

                    {/* 卡片列表 */}
                    <div className="flex flex-col gap-2.5">
                      {items.map((p) => (
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
                      {items.length === 0 && (
                        <p className="px-1 py-2 text-xs text-mist">暂无项目</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {/* 成员管理（权限矩阵 #5：仅 admin；路由守卫已把成员重定向出首页，这里双保险） */}
      {isAdmin && <MembersPageSection />}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-display-md text-mist">已归档 · {archived.length}</h2>
          <div className="glass-light rounded-[16px] border border-sand px-3 py-1 shadow-soft">
            {archived.map((p) => (
              <ArchiveListRow key={p.id} project={p} onOpen={() => openProject(p.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------ 列定义与分桶 ------------------------------ */

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
 * 模板 JSON 只存 token 名（pine / stage-s3 …），不携带 UI 框架的实现细节——
 * 否则模板数据会和 Tailwind 版本绑死，第三方模板作者也没法写。
 */
const TONE_CLASSES: Record<string, { dot: string; chip: string }> = {
  mist: { dot: 'bg-mist', chip: 'bg-sand text-mist' },
  pine: { dot: 'bg-pine', chip: 'bg-pine-soft text-pine' },
  amber: { dot: 'bg-amber', chip: 'bg-amber-soft text-amber' },
};
for (let i = 1; i <= 9; i += 1) {
  TONE_CLASSES[`stage-s${i}`] = {
    dot: `bg-stage-s${i}`,
    chip: `bg-stage-s${i}/15 text-stage-s${i}`,
  };
}
const FALLBACK_TONE = TONE_CLASSES.mist;

function toneOf(tone: string): { dot: string; chip: string } {
  return TONE_CLASSES[tone] ?? FALLBACK_TONE;
}

/**
 * 按当前项目集合派生看板列：
 *   todo 固定在最前，其后是这些项目所属行业在模板里声明的列（去重、按模板声明顺序）。
 *
 * 为什么是「派生」而不是固定四列：v2 起各行业自带列定义（软件是 规划→开发→测试→发布，
 * 影视是 前期→拍摄→后期→交付），把室内那套 设计/深化/施工 硬套在别的行业上，列名就是错的。
 * 单一行业的用户看到的列数与改造前完全一致；混用行业时列自然变多，项目不会无处可放。
 */
export function deriveColumns(projects: Project[]): KanbanColumn[] {
  const used = new Set<string>();
  for (const p of projects) {
    const preset = p.stagePresetKey ? getPreset(p.stagePresetKey) : null;
    if (preset) used.add(preset.domain);
  }
  // 老项目可能没有 stagePresetKey（或套餐已下架）→ 回退室内列，保证看板不空
  if (used.size === 0) used.add('indoor');

  const columns: KanbanColumn[] = [
    { key: TODO_COLUMN, label: '待启动', ...toneOf('mist') },
  ];
  const seen = new Set<string>([TODO_COLUMN]);
  for (const [domainKey] of getDomains()) {
    if (!used.has(domainKey)) continue;
    for (const c of getDomainColumns(domainKey)) {
      if (seen.has(c.key)) continue; // 不同行业可能用同名列（如 design），只渲染一次
      seen.add(c.key);
      columns.push({ key: c.key, label: c.label, ...toneOf(c.tone) });
    }
  }
  return columns;
}

/**
 * 项目 → 看板列：
 *   未开始 → todo；
 *   进行中 → 当前阶段项声明的 kanbanColumn（v2 起由模板声明，不再按 orderIndex 数字硬分桶）；
 *   老数据（templateKey 为 null）→ 回退所属行业，按 orderIndex 均分落段，
 *     对室内九段 + 三列的结果与改造前逐项一致（①②③→1 列，④⑤⑥→2 列，⑦⑧⑨→3 列）。
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
    // 兜底：列键不在当前集合中（如项目行业未参与派生）→ 并入最后一列，绝不静默丢项目
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

/* ------------------------------ 空状态 ------------------------------ */

function EmptyState({ onManual }: { onManual(): void }): JSX.Element {
  return (
    <div className="glass-light rounded-[16px] border border-dashed border-sand p-6 text-center sm:p-10">
      <p className="font-display text-display-md text-mist">还没有进行中的项目</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-mist">
        点击左上角「新建项目」创建你的第一个项目；项目名称与竣工日为必填，其余可在进入后随时补充。
      </p>
      <p className="mx-auto mt-3 max-w-md rounded-[16px] bg-cream px-4 py-3 text-xs leading-5 text-mist">
        你的数据自动保存在本机浏览器中，关闭浏览器不会丢失；如需换电脑或留档，点击顶栏「保存备份」导出文件，随时可再恢复。
      </p>
      <button
        type="button"
        onClick={onManual}
        className="mt-4 rounded-md border border-pine px-4 py-2 text-sm text-pine hover:bg-pine-soft"
      >
        直接手动建档
      </button>
    </div>
  );
}
