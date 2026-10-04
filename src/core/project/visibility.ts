/**
 * Agent 数据隔离的**单一谓词出口**（v0.8 · 设计 §7.1 / §7.2 / §7.5）。
 *
 * ══════════════════════════ 这个文件为什么必须存在 ══════════════════════════
 *
 * v0.8 把「Agent 看板」做成与人类项目**完全物理隔离**的独立工作区。隔离的正确性
 * 不能靠"每个页面都记得过滤"——那种做法今天对、明天有人加第 28 个页面就漏了，
 * 而且漏的表现是**静默的**（Agent 数据出现在人类首页，不报错、不崩、tsc 不管）。
 *
 * 所以要有一个**唯一漏斗**：谁想拿"人类侧该看的数据"，都必须经过本文件。
 * 于是"漏过滤"这件事从一个**分散的、无法被机器发现的**错误，变成两种
 * **可被机器发现**的错误：
 *   ① 有人绕过漏斗直接读 store ⇒ `tests/isolation-guard.spec.ts` 静态守卫红；
 *   ② 有人用了漏斗但用错了 kind ⇒ `tests/isolation-census.spec.ts` 表驱动断言红。
 *
 * ── 三条纪律（违反任何一条都会让上面两层的保护失效）──
 *   1. **页面/组件禁止直接读 `useProjectsStore(s => s.projects)`**（PRD B5）。
 *      一律用本文件的 hooks。本文件是**全仓唯一**允许原始读 store.projects 的地方。
 *   2. **全量 projects 的写入点唯一**：`src/hooks/useRepos.ts` 的
 *      `bootstrapAllStores()`（外加 `useProjectsStore` 自身的 action）。
 *      典型反例（v0.8 修掉的）：`AgentBoardPage.loadAll()` 曾把全量项目
 *      `setState` 进 store —— 它会让 §7.2 的 27 项接线**全部白做**（设计 §7.5）。
 *   3. **凡是"喂给人类侧"的派生，必须显式传 `'human'`**；不传 kind 的派生函数
 *      视为可疑，由守卫测试标红。
 *
 * ── 为什么谓词的核心是 `projectId` 集合，而不是"过滤 projects" ──
 *   设计 §7.2 里有 4 项（#4 首页「本周到期任务」、#6「本月完工」、#14 我的任务页、
 *   #15 成员看板）的数据源是 **`stages` / `tasks`，不是 projects** ——
 *   PRD 自己给 #4 标了「★派生自 stages，不是 projects ⇒ 最容易漏」。
 *   只做一个 `visibleProjectsFor()` 一定会漏掉它们。以 `projectId` 集合为漏斗核心，
 *   `stages` / `tasks` / `logs` 就都能复用同一个出口。
 *
 * ── 消费方式（正/反例）──
 *   ✅ `const active = useHumanProjects().filter(p => p.status === 'active');`
 *   ✅ `const visibleStages = useHumanStages();`   // 统计卡 / 月历 / 成员看板
 *   ❌ `const projects = useProjectsStore(s => s.projects);`  // 守卫会红
 *   ❌ `visibleProjectsFor('human', useProjectsStore.getState().projects)` // 同上
 *
 * ── 与 `Project.kind` 的关系 ──
 *   `kind` 是 v0.8 T01 新增的字段（`'human' | 'agent'`）。老库没有这列 ⇒
 *   归一函数落 `DEFAULT_PROJECT_KIND`（'human'），本文件的 `projectKindOf`
 *   保持**同一口径**的读时回落（见其注释：只认字面量 `'agent'`）。
 */

import { useMemo } from 'react';

import { useProjectsStore } from '../../store/useProjectsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { Project, Stage, Task } from '../types/entities';
import { DEFAULT_PROJECT_KIND, projectKindOf, type ProjectKind } from '../types/enums';

// 对外仍是「唯一出处」：实现 import 进作用域后 re-export（见下方 export 行）
import type { StageTemplateDomain } from '../types/dto';
import { DEFAULT_PROJECT_DOMAIN, resolveProjectDomain } from '../template/stage-fallback';

/* ══════════════════════════════ 纯函数（可测、无 IO） ══════════════════════════════ */

/**
 * 读时回落判 kind 的**唯一出处**——实现已迁到 `src/core/types/enums.ts`
 * （2026-09-24：服务端也要同一口径，而本文件经 import 图带 react/store，
 * 服务端 tsconfig 不能纳入）。此处 re-export，既有消费方零改动；
 * 判定语义与"为什么只认字面量 agent"的完整论证见 enums.ts 的实现注释。
 */
export { projectKindOf };

/**
 * 给定 kind，算出"该 kind 该看到哪些项目 id"。
 *
 * 这是整个隔离机制的**漏斗核心**：`stages` / `tasks` / `logs` 都只有 `projectId`，
 * 先拿到这个集合再 `filterByProjectKind`，就复用了同一个出口（设计 §5.1）。
 */
export function visibleProjectIds(
  kind: ProjectKind,
  all: readonly Project[],
): Set<string> {
  const ids = new Set<string>();
  for (const p of all) {
    if (projectKindOf(p) === kind) ids.add(p.id);
  }
  return ids;
}

/**
 * 给定 kind，筛出该 kind 的项目（保持入参顺序）。
 *
 * v0.8.6 起第三个参数 `viewerMemberId` = **归属收窄**（她 10-04 拍板「成员每个人
 * 都能有自己的 Agent 看板」的落地处）。三条口径：
 *   ① **不传 / 传 null ⇒ 不收窄**——既有全部消费方（首页、侧栏、统计卡）零改动；
 *   ② `ownerMemberId == null` 的板 = **公共板**，人人可见（存量数据/历史板）；
 *   ③ 只有「有主的板」才按人收窄 ⇒ **老库读起来与今天逐字一致**（零回归）。
 *
 * 为什么收窄放在这个纯函数里而不是各页面自己 filter：漏斗必须是**单一出口**——
 * 页面各写一份必然漂移，漂移的表现就是「同一个成员在 A 页看到自己的板、B 页看不到」。
 */
export function visibleProjectsFor(
  kind: ProjectKind,
  all: readonly Project[],
  viewerMemberId?: string | null,
): Project[] {
  return all.filter((p) => {
    if (projectKindOf(p) !== kind) return false;
    // viewerMemberId 缺省（undefined）⇒ 完全不看 owner 字段（纯 kind 行为）
    if (viewerMemberId === undefined) return true;
    if (viewerMemberId === null) return true; // 未登录态：只按 kind（与今天一致）
    return p.ownerMemberId == null || p.ownerMemberId === viewerMemberId;
  });
}

/**
 * 用 `projectId` 集合筛任何"挂在项目下"的行（stages / tasks / logs 通用）。
 *
 * 泛型约束只要求 `{ projectId: string }`，因此 Stage / Task / StageLog 都能直接用，
 * 不需要每个实体各写一份过滤。
 */
export function filterByProjectKind<T extends { projectId: string }>(
  rows: readonly T[],
  ids: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => ids.has(row.projectId));
}

/**
 * TBD-10：存量「自定义阶段」项目的主板块待确认判定（设计 §3.2.1）。
 *
 * 背景：`stagePresetKey === 'custom'` 的存量项目，`getPreset('custom')` 返回 `null`
 * ⇒ 回落链最终落到 `'indoor'` ⇒ 它们被塞进首页「室内」列。用户看到的是**错的板块**，
 * 但我们**不能猜**它属于哪个板块（无依据）。
 *
 * 裁决：**只提示、不自动写**。所以这里是一个**纯读时派生**：
 *   · **不改实体、不进键序链、不落库**（放进 `normalizeProjectRow` 会多出一个
 *     `ProjectRowInput` 字段并触碰 T01 的键序纪律，得不偿失）；
 *   · **未确认时行为与今天逐字一致**（仍回落 `indoor`）⇒ 零回归；
 *   · 文案中性（「待确认」而非「错误」），且**不做阻塞式引导**
 *     （用户可能永远不想确认，不能因此挡住主场流程）。
 */
export function needsDomainConfirm(p: Pick<Project, 'domain' | 'stagePresetKey'>): boolean {
  return p.domain == null && p.stagePresetKey === 'custom';
}

/**
 * 消费侧的**主板块唯一出口**（设计 §7.2 #8 / 纠错③）。
 *
 * 语义 = 「项目**实际展示**在哪个板块」，不是「项目存了什么」：
 *   · `domain` 有值（含用户确认过的）⇒ 用它；
 *   · `domain == null` ⇒ 按 `stagePresetKey` **反查**套餐 domain，反查不到退 `indoor`。
 *
 * 为什么必须有一个统一出口、而不是各处写 `resolveProjectDomain(...)`：
 *   `deriveColumns`（首页看板列）、阶段抽屉、打印页都要这个值；各写一份必然漂移，
 *   而漂移的表现就是"同一个项目在不同页面被算进不同板块"。
 *
 * 与 `needsDomainConfirm` 的关系：反查使得**未确认**的项目仍落在原板块
 * （`custom` 套餐反查不到 ⇒ 退 `indoor`），行为与今天一致 ——
 * 提示条只负责"告诉用户这里可能不对"，**不负责换列**。
 */
export function effectiveDomainOf(
  p: Pick<Project, 'domain' | 'stagePresetKey'>,
): StageTemplateDomain {
  return resolveProjectDomain(p.stagePresetKey, p.domain) ?? DEFAULT_PROJECT_DOMAIN;
}

/* ══════════════════════════════ React hooks（唯一原始读点） ══════════════════════════════
 *
 * ⚠️ 下面三个 `pick*` 是本仓**唯一**允许直接读 `store.projects / stages / tasks` 的地方。
 * `tests/isolation-guard.spec.ts` 的白名单里只有本文件（外加 store 自身与 bootstrap）。
 *
 * 为什么用「模块级稳定 selector + useMemo」而不是让调用方自己 `useMemo`：
 *   如果 selector 每次返回新数组（如 `s => s.projects.filter(...)`），zustand v4 的
 *   `useSyncExternalStore` 会认为快照每次都变了 ⇒ **无限重渲染**。
 *   `pickProjects` 直接返回 store 里那个数组引用（store 不变它就不变），
 *   过滤放在 `useMemo` 里按引用做依赖 ⇒ 既安全又不会多算。
 */

const pickProjects = (s: { projects: Project[] }): Project[] => s.projects;
const pickStages = (s: { stages: Stage[] }): Stage[] => s.stages;
const pickTasks = (s: { tasks: Task[] }): Task[] => s.tasks;

/**
 * ⚠️ 内部用：`kind` 参数的泛型版。页面请优先用下面语义化的那几个 hooks
 * （`useHumanProjects` / `useAgentProjects` …），让"这一处喂给谁"在调用点一眼可见。
 */
export function useProjectsOfKind(kind: ProjectKind): Project[] {
  const projects = useProjectsStore(pickProjects);
  return useMemo(() => visibleProjectsFor(kind, projects), [kind, projects]);
}

/** 人类侧项目列表。首页（#1/#2/#3/#5/#9/#10/#16）、侧栏（#11）、顶栏搜索（#13）等。 */
export function useHumanProjects(): Project[] {
  return useProjectsOfKind('human');
}

/**
 * Agent 侧看板列表（#20 项目下拉 / #21 统计卡 / AgentBoardPage / 侧栏）。
 *
 * v0.8.6：从本 hook 起**按归属收窄**——「成员每个人都能有自己的 Agent 看板」
 * （她 10-04 拍板）。因为侧栏与 Agent 页都走这一个出口，收窄做在这里 ⇒
 * 两边口径**不可能不一致**（若在各页面各收一份，漂移是必然的）。
 *
 * 未登录 ⇒ `currentMemberId` 为空 ⇒ 谓词回落纯 kind（与改造前观感逐字一致）。
 */
export function useAgentProjects(): Project[] {
  const projects = useProjectsStore(pickProjects);
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  return useMemo(
    () => visibleProjectsFor('agent', projects, currentMemberId || null),
    [projects, currentMemberId],
  );
}

/**
 * `kind` 侧可见的**阶段**。数据源是 `stages`，靠 `projectId` 集合收窄 —— 即 §7.2 的
 * **Pid** 接法。覆盖 #4 首页「本周到期任务」、#6「本月完工」、#15 成员看板（★★ 关键漏点：
 * AI 把任务 `assigneeHuman` 指给成员时，若不按项目收窄，该 Agent 看板会漏进成员看板）。
 */
export function useVisibleStages(kind: ProjectKind): Stage[] {
  const projects = useProjectsStore(pickProjects);
  const stages = useProjectsStore(pickStages);
  return useMemo(() => {
    const ids = visibleProjectIds(kind, projects);
    return filterByProjectKind(stages, ids);
  }, [kind, projects, stages]);
}

/** `kind` 侧可见的**任务**（#14 我的任务页 / #15 成员看板）。 */
export function useVisibleTasks(kind: ProjectKind): Task[] {
  const projects = useProjectsStore(pickProjects);
  const tasks = useProjectsStore(pickTasks);
  return useMemo(() => {
    const ids = visibleProjectIds(kind, projects);
    return filterByProjectKind(tasks, ids);
  }, [kind, projects, tasks]);
}

/** 人类侧阶段（`useVisibleStages('human')` 的语义化别名）。 */
export function useHumanStages(): Stage[] {
  return useVisibleStages('human');
}

/** 人类侧任务。 */
export function useHumanTasks(): Task[] {
  return useVisibleTasks('human');
}

/** Agent 侧阶段。 */
export function useAgentStages(): Stage[] {
  return useVisibleStages('agent');
}

/** Agent 侧任务。 */
export function useAgentTasks(): Task[] {
  return useVisibleTasks('agent');
}

/**
 * 按 id 取项目，**不按 kind 收窄** —— 专供 §7.3 的「单项目直达」特判（#27 详情页、
 * #17/#18 打印页）。
 *
 * 为什么这里不做 kind 判断是**对的**而不是漏洞：
 *   设计 §7.3 明示「详情页是**唯一允许穿越**的通道」，且打印页路由**保留独立存在**
 *   （删路由会破坏既有深链）。这两处的正确做法不是"打不开"，而是：
 *   **打开后必须渲染「AI 工作区」来源标识**（见 `ProjectSourceBadge`）。
 *   而"从人类项目列表误入打印"这条路径由 #1/#11 的 P 收口**结构性地**堵住了
 *   —— 人类列表里根本不会出现 Agent 看板，因此没有那个入口（PRD B19）。
 *
 * ⚠️ 调用方拿到的是"可能是 Agent 看板"的项目，**必须**按 §7.3 渲染来源标识。
 */
export function useProjectById(id: string | null | undefined): Project | undefined {
  // 返回值是数组里的元素引用（store 不变即引用不变）⇒ 不会触发无限重渲染
  return useProjectsStore((s) => (id ? s.projects.find((p) => p.id === id) : undefined));
}

/**
 * **单个项目**名下的阶段（按 `projectId` 收窄，**不按 kind 收窄**）。
 *
 * 用途与 `useProjectById` 完全同族：§7.3 的「单项目直达」特判（#17 日程表打印 /
 * #18 月历打印 / #27 详情页 / 阶段抽屉）。这三处**没有列表可以过滤**，它们的正确
 * 语义是「打开这个 id 名下的东西」，而不是「打开人类侧的东西」——
 * 若这里改成 `useHumanStages()`，Agent 看板的详情页会**整页空白**
 * （§7.3 明示详情页是唯一允许穿越的通道，必须能渲染出内容）。
 *
 * ⚠️ 与 `useHumanStages()` 的分工（**别用错，这是最容易搞混的一对**）：
 *   · `useHumanStages()`  → 「人类侧该看到哪些阶段」= 列表/统计/月历/成员看板 → 传 kind 过滤；
 *   · `useProjectStages(id)` → 「这个 id 名下的阶段」= 单项目直达 → 不收窄 kind。
 *   前者回答「给谁看」，后者回答「看的是哪一个」。把后者用来渲染列表 = 泄漏；
 *   把前者用来做单项目直达 = 页面空白。两者都错。
 *
 * 安全边界：调用方拿到的是「某个具体项目」的子集，看不到别的项目 ⇒ 本身不构成
 * 跨看板泄漏；真正的泄漏路径（人类列表里出现 Agent 看板）由 #1/#11 的 P 收口堵住，
 * 使得到达这里的 id 只能来自用户已经在那儿的那个项目。
 */
export function useProjectStages(projectId: string | null | undefined): Stage[] {
  const stages = useProjectsStore(pickStages);
  return useMemo(
    () =>
      projectId
        ? stages
            .filter((s) => s.projectId === projectId)
            .sort((a, b) => a.orderIndex - b.orderIndex)
        : [],
    [projectId, stages],
  );
}

/** **单个项目**名下的任务（按 `projectId` 收窄，不按 kind 收窄）。理由同 `useProjectStages`。 */
export function useProjectTasks(projectId: string | null | undefined): Task[] {
  const tasks = useProjectsStore(pickTasks);
  return useMemo(
    () => (projectId ? tasks.filter((t) => t.projectId === projectId) : []),
    [projectId, tasks],
  );
}
