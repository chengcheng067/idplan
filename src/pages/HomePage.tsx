import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

import { Button } from '../components/ui/Button';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ProjectCard } from '../components/project/ProjectCard';
import { StatCard } from '../components/project/StatCard';
import { ArchiveListRow } from '../components/project/ArchiveListRow';
import { MembersPageSection } from '../components/member/MembersPageSection';
import { MonthlyCalendarView } from '../components/calendar/MonthlyCalendarView';
import { DomainConfirmPrompt } from '../components/project/DomainConfirmPrompt';
import { useMembersStore } from '../store/useMembersStore';
import { useUiStore, type HomeViewMode } from '../store/useUiStore';
import { useRoleGuard } from '../hooks/useRoleGuard';
import {
  effectiveDomainOf,
  useHumanProjects,
  useHumanStages,
  useHumanTasks,
} from '../core/project/visibility';
import { computeProjectStatus, currentStageOf } from '../lib/progress';
import { StageStatus } from '../core/types/enums';
import {
  getDomainColumns,
  getDomains,
  getItemKanbanColumn,
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
 *
 * 建档入口（v0.7 增量 · 用户要求去重）：
 *   本页页头**不再**渲染「新建项目」按钮。全站建档入口收敛为三处，全部带
 *   `isAdmin && onProjectPage` 门槛：侧栏底部展开态（Sidebar.tsx）、侧栏底部收起态、
 *   手机档 ⋮ 更多菜单（MobileMoreMenu.tsx）。
 *
 *   ⚠️⚠️ 本页仍有两条**无身份门槛**的建档触发点，这是**有意保留**，不是漏洞，勿「修」：
 *     ① 空态的「直接手动建档」（EmptyState）
 *     ② 月历视图的 `onManual`（MonthlyCalendarView）
 *   决策口径（team-lead 已拍板）：**未进入身份可走引导，member 不可建档**。
 *   能到达这两处的用户恰好是「首启、还没进入身份」的人 —— 那就是「第一个项目怎么建」
 *   的唯一引导路径；给它们加 `isAdmin` 门会把首次使用彻底堵死。
 *   成员到不了：`HomeRouteGuard` 判 `isMember` 后整页重定向到 `/member-board`。
 */
export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  /*
    ★ v0.8 T04-A · §7.2 接线（#1/#2/#3/#5/#7/#9/#10/#16）
    ⚠️ 本页**禁止**直接读 store（设计 §7.1 纪律 1）。三行全部改为经
       `src/core/project/visibility.ts` 这个**唯一漏斗** —— 于是「Agent 看板漏进人类首页」
       这件事在**本页根本不可能发生**，而不是"记得过滤就没事"。

    为什么三行分别是 P / Pid / Pid：
      · `projects` → **P**：`visibleProjectsFor('human')`，供项目网格（#1）/归档区（#2）/
        统计卡「进行中项目」（#3）/「逾期风险」（#5）/搜索（#9）/空态（#10）共用；
      · `stages`   → **Pid**：数据源是 `stages` 而非 projects，先取 `visibleProjectIds('human')`
        再按 `projectId` 收窄。这是 PRD 自标「★最容易漏」的 #4「本周到期」与 #6「本月完工」——
        只做一个 `visibleProjectsFor()` 一定会漏掉它们（设计 §5.1）。
      · `tasks`    → **Pid**：同理（本页 tasks 只用于 `ProjectCard` 的完成度，同样必须收窄）。
  */
  const projects = useHumanProjects();
  const stages = useHumanStages();
  const tasks = useHumanTasks();
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
      {/*
        1. 页面标题行 —— 画板 02「页面标题行」`[row gap=16 pad=0]`，
        内含「标题文字列」`[col gap=4 pad=0]` = 页面主标题（24/Bold）+ 页面副标题（13/Regular mist，`#6B7280` = mist）。
        本行结构（col gap-1 = 4px）即按该画板落位。

        右端**刻意留空**（v0.7 增量 · 用户要求去重）：画板此处原本画着「+ 新建项目」按钮，本页已删除 ——
          · 同一动作在侧栏底部（展开态 / 收起态各一处）与手机档 ⋮ 菜单里都已存在，
            三处都带 `isAdmin && onProjectPage` 门槛，用户读作「重复入口」；
          · 而这个页头按钮**没有任何身份门槛**——非管理员也能点。
            删掉它同时收敛了「非管理员可建档」这个权限漏口（见 commit message）。
        外层行保留（不删容器），因为副标题就落在这里；行内已无残留空容器。

        ── 副标题的数值口径（与画板原文案有一处**刻意的、已备案的**偏差）──
        画板 02 副标题原文：「12 个进行中 · 3 个临期 · 1 个逾期」。
        本实现的三个数字**全部复用本页已有的既有派生值**，不新造第二套口径：
          · 进行中   = `active.length`        —— 与下方「进行中项目」统计卡**同一个表达式**
          · 本周到期 = `dueThisWeek`          —— 与下方「本周到期任务」统计卡**同一个表达式**
          · 逾期     = `overdueCount`         —— 与下方「逾期风险」统计卡**同一个表达式**
        ⚠️ 中间一项文案是「本周到期」而**不是**画板写的「临期」：本页**没有**「临期」口径。
        （「临期」目前只以「项目级：进行中且距 plannedEndAt ≤ 7 天」的形态**内联**在
        `Sidebar.tsx` 的 `projectStatusDotClass` 里，未抽成可复用的唯一出处。）
        为了句面上对齐画板而把「本周到期」的数字标成「临期」，等于把两个不同粒度的量
        （stage 级 vs project 级）混为一谈 —— 宁可改文案，不改数字的含义。
        若日后要严格对齐画板文案：需先把「临期」口径从 Sidebar 抽到 `src/lib/` 作唯一出处，
        再由本页引用（属独立小任务，本轮未做）。
      */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-bold text-ink">我的项目</h1>
          <p data-home-subtitle="" className="text-[13px] text-mist">
            {active.length} 个进行中 · {dueThisWeek} 个本周到期 · {overdueCount} 个逾期
          </p>
        </div>
      </div>

      {/* 2. 统计卡行（响应式：桌面 4 列 / 平板 2×2 / 手机单列） */}
      <section className="flex flex-wrap gap-5">
        <StatCard tone="pine" value={active.length} label="进行中项目" trend={null} />
        <StatCard tone="amber" value={dueThisWeek} label="本周到期任务" trend={null} />
        <StatCard tone="clay" value={overdueCount} label="逾期风险" trend={null} />
        <StatCard tone="sage" value={doneThisMonth} label="本月完工" trend={null} />
      </section>

      {/* 3. 视图切换行（画板 02 L143 · A4）
          切换控件按画板规格做成 lg 档（容器 r16/pad4/gap4/高36，项 84×28/r12/13号字）；
          homeViewMode 已持久化（见 useUiStore），刷新不再回落「看板」——
          这是「找不到日历看板入口」的正面解法（画板确认月历是首页视图，非独立导航项）。 */}
      <div className="flex items-center">
        <SegmentedControl<HomeViewMode>
          size="lg"
          ariaLabel="首页视图切换"
          value={homeViewMode}
          onChange={setHomeViewMode}
          options={[
            { value: 'kanban', label: '看板' },
            { value: 'calendar', label: '月历' },
          ]}
        />
      </div>

      {/* 4/5 条件区：月历视图 vs 项目卡片网格 + 已归档折叠 */}
      {homeViewMode === 'calendar' ? (
        <MonthlyCalendarView onManual={openManual} />
      ) : (
        <>
          {/*
            ★ v0.8 T04-A · TBD-10 板块确认入口（设计 §3.2.1 第 2 处落点）。

            位置与理由（为什么不放在别处）：
              · 放在**看板档的项目网格之上**，而不是月历档：月历没有"列"的概念，
                "板块待确认"提示在月历语境里没有可归位的目标；而且月历档的
                `MonthlyCalendarView` 自己是一棵完整子树，插进去会打乱它的空状态判定。
              · 传 `active`（**已经经过 `useHumanProjects()` 收窄**）而不是全量 projects：
                提示条只该关心人类侧 —— Agent 看板没有"主板块确认"这回事（它的 domain
                由 Agent 通道建板时给定），把 Agent 看板列进来会给出一个**无意义的
                「确认」按钮**，点了还会真的去改它的 domain。
              · 未确认的项目**不换列**（仍落室内列），这是刻意的零回归（见组件头注释）。
                所以提示条只加一行，正文网格与今天**逐字一致**。

            顺序纪律提醒：本行的存在**依赖**上方 `deriveColumns` 已经改读
            `effectiveDomainOf(p)`。若谁把那次修复回滚了，这里的提示条会开始替那个
            bug 背锅（"看起来在待确认"），两处必须同进同退。
          */}
          <DomainConfirmPrompt projects={active} />

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
 *
 * ── ★ v0.8 T04-A：这里改读 `effectiveDomainOf(p)`（设计 §7.2 #8 ＋ 纠错③）──
 *
 * **老代码（已修掉）**：
 *   `const preset = p.stagePresetKey ? getPreset(p.stagePresetKey) : null;`
 *   `if (preset) used.add(preset.domain);`
 *
 * 它在 `stagePresetKey === 'custom'` 的项目上**整体失效**：`getPreset('custom')` 返回
 * `null`（`stage-library.ts`），于是 `if (preset)` 里的 `used.add` **一次都不执行** ——
 * 这类项目（v0.8 之前建的「自定义阶段」项目，以及 Agent 通道建的声明名看板）
 * 对**列集合**毫无贡献。表现是首页看板**凭空少列或多列**：
 *   · 库里只有 custom 项目 ⇒ `used.size === 0` ⇒ 退化成只按 `indoor` 兜底出列；
 *   · 库里同时有 indoor 与 custom 项目 ⇒ custom 那份被塞进 indoor 列（因为列集合里
 *     没有它的板块），于是"落错列"且**不报错、不崩、tsc 不管**。
 *
 * **新读法**：`effectiveDomainOf(p)` = 「项目**实际展示**在哪个板块」——
 * `domain` 有值就用它（用户建档时选的 / TBD-10 确认过的），否则按 `stagePresetKey`
 * 反查套餐 domain，反查不到退 `indoor`。它是**消费侧主板块的唯一出口**
 * （`visibility.ts`），阶段抽屉、打印页、成员看板列都走它 —— 一处漂移就会让
 * "同一个项目在不同页面被算进不同板块"。
 *
 * ⚠️ 顺序纪律（设计 §8 T04「已知坑」）：**必须先修本函数，再加 TBD-10 提示条**。
 *    反过来的话，`custom` 项目的"落错列"会被提示条**掩盖**成"正在待确认"，
 *    其中一部分项目永远不会被修正。本文件的两次改动按此顺序落盘。
 */
export function deriveColumns(projects: Project[]): KanbanColumn[] {
  const used = new Set<string>();
  for (const p of projects) {
    used.add(effectiveDomainOf(p));
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
    // 落列用的板块口径与 `deriveColumns` **必须同源**（同一个 `effectiveDomainOf`）——
    // 否则会出现"派生了一列，但没有项目能落进去"或"项目落进了不存在的列（走兜底）"。
    const domainKey = effectiveDomainOf(p);
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
