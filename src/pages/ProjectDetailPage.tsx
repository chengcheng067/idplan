import { useEffect, useMemo, useState } from 'react';

import { Link, useParams } from 'react-router-dom';

import { ArrowLeft, Archive, ArrowRightLeft, Bot, CalendarRange } from 'lucide-react';

import { useAgentStore } from '../store/useAgentStore';
import { createProjectActions } from '../store/useProjectsStore';
import { useUiStore } from '../store/useUiStore';
import { useMembersStore } from '../store/useMembersStore';
import { useRepos } from '../hooks/useRepos';
import {
  needsDomainConfirm,
  projectKindOf,
  effectiveDomainOf,
  useProjectById,
  useProjectStages,
  useProjectTasks,
  useHumanProjects,
  useHumanStages,
  useHumanTasks,
} from '../core/project/visibility';
import { domainLabel } from '../components/contract-wizard/DomainCascade';
import { TravelItineraryPanel } from '../components/travel/TravelItineraryPanel';
import { ProjectSourceBadge } from '../components/project/ProjectSourceBadge';
import { DomainConfirmPrompt } from '../components/project/DomainConfirmPrompt';
import {
  TransferDialog,
  type TransferCommand,
  type TransferOutcome,
} from '../components/agent/TransferDialog';
import { useRoleGuard, isRestrictedView, computeRelatedStageIds } from '../hooks/useRoleGuard';
import { TimelineView, pickActiveStage } from '../components/timeline/TimelineView';
import { MobileStageList } from '../components/timeline/MobileStageList';
import { StageDrawer } from '../components/stage-detail/StageDrawer';
import { CompletionRing } from '../components/common/CompletionRing';
import { CountdownNumber } from '../components/common/CountdownNumber';
import { Badge } from '../components/common/Badge';
import type { Stage } from '../core/types/entities';
import { totalDaysInclusive } from '../lib/date';

/**
 * 项目详情主视图：顶条信息环 + 九阶段时间轴 + 阶段抽屉。
 * v0.2 增量：
 *   - T05：移除旧折叠「备份」按钮（备份统一收敛顶栏 BackupMenu，仅管理员）；
 *   - T06：非管理员（含未进入身份）隐藏敏感字段（clientName / address / contractAmount——顶条只留类型/工期/倒计时/完成环）；
 *   - T07：非管理员仅渲染与自己相关的阶段（stage.ownerId===me 或该阶段存在我参与的任务
 *          ——taskAssigneeIds(task) 包含 me，v0.3 多人参与语义），
 *          完全无关 → 「该项目的阶段与你无关」空态。
 *
 * BUG-1 修复（QA 严过关）：受限判定统一为「非管理员即受限」——memberView = !isAdmin，
 * 而不是 isMember。未进入身份（role=null）时 isMember=false 但绝不能获得管理员级读
 * （敏感字段/全量阶段）与写（拖拽改期/归档）权限；未进入且无 currentMember → 无任何
 * 相关阶段 → 直接受限空态。
 */
/** 视口 <lg(1024px) 判定：手机/平板竖屏用纵向阶段卡片流，平板横屏/桌面用横向时间轴 */
function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const onChange = (): void => setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function ProjectDetailPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const repos = useRepos();
  /*
    ★ v0.8 T04-A · §7.3 #27「单项目直达」特判（**唯一允许穿越的通道**）。

    这一处**故意不按 kind 收窄**，是把 §7.3 的裁决落到实处：
      · `useProjectById(id)`  —— 不分 kind 地取该项目。若改成从 `useHumanProjects()`
        里 find，Agent 看板的详情页会**永远打不开**（"未找到该项目"）；
        而设计明示详情页是**唯一允许穿越**的通道，PRD 也说 Agent 看板必须能点开看。
      · `useProjectStages/Tasks(id)` —— 同理，按 `projectId` 收窄而**不**按 kind。
        注意这三者与 `useHumanProjects/Stages/Tasks` 的分工：前者回答
        「**看的是哪一个**」，后者回答「**给谁看**」。

    ── 那么"不按 kind"为什么不是漏洞？靠三道结构性防线，而不是靠本页自觉 ──
      ① **入口侧**：人类项目列表（首页 #1 / 侧栏 #11）经 P 收口后**根本不会出现**
         Agent 看板 ⇒ 用户没有"从列表误入"的路径（PRD B19 要求的正是这条）。
      ② **来源可见**：真有深链/收藏夹直达时，正文顶部渲染 `ProjectSourceBadge`
         （下方 `ProjectSourceBadge`）——用户**知道**自己在一块 AI 看板上。
      ③ **人类 chrome 仍走 P**：面包屑用 `useHumanProjects()`（见 TopBar 注释）、
         侧栏高亮用 `useHumanProjects()` ⇒ 即使正文在 Agent 看板，导航链也不会
         把 Agent 看板名带进人类侧的 DOM。

    ⚠️ 本页内任何"相关项目/兄弟项目"推荐、面包屑回跳、侧栏高亮，将来都必须走 P 出口
       —— 这是 §7.3 #27 点名的「最容易在详情页里顺手带出来的地方」。
  */
  const project = useProjectById(id);
  const stages = useProjectStages(id);
  const tasks = useProjectTasks(id);
  const members = useMembersStore((s) => s.members);
  const { role, currentMember } = useRoleGuard();
  const memberView = isRestrictedView(role);
  const isNarrow = useIsNarrowViewport();

  /*
   * ★ v0.8 T04-B · 接管弹窗的数据源（PRD B11 / B12 / D5）。
   *
   * 三份数据全部走**隔离漏斗的合法出口**，不直读 store.projects：
   *   · `useHumanProjects()` —— 目标候选（只能是人类项目；把任务搬进另一块
   *     Agent 看板是无意义搬运，那种错误由漏斗在调用点挡住）；
   *   · `useHumanStages()` / `useHumanTasks()` —— 候选项目的阶段与任务。
   *     bootstrap 时已全量入 store，这里按 kind 收窄取人类侧；
   *     TransferDialog 内部再按选中目标过滤（阶段属于项目，预览的
   *     "将更新 Y"要比对目标项目内的 externalId）。
   */
  const humanProjects = useHumanProjects();
  const humanStages = useHumanStages();
  const humanTasks = useHumanTasks();
  const [transferOpen, setTransferOpen] = useState(false);

  // 相关阶段：管理员 → null（全量）；成员 → 自己相关阶段；未进入 → 空集（受限空态）
  const relatedStageIds = useMemo(
    () =>
      computeRelatedStageIds({
        memberView,
        currentMemberId: currentMember?.id ?? null,
        stages,
        tasks,
      }),
    [memberView, currentMember, stages, tasks],
  );

  const visibleStages = relatedStageIds
    ? stages.filter((s) => relatedStageIds.has(s.id))
    : stages;

  if (!project) {
    return (
      // px-8 与正文根节点的 p-8 同口径（画板 04 内容区 pad=32），下同
      <div className="px-8 py-16 text-center text-mist">
        <p className="mb-3">未找到该项目（可能已被归档或删除）。</p>
        <Link to="/" className="text-pine underline underline-offset-2">
          ← 返回项目列表
        </Link>
      </div>
    );
  }

  // 非管理员且无任何相关阶段 → 受限空态（未进入用户同样命中：currentMember=null → 空集）
  if (memberView && visibleStages.length === 0) {
    return (
      <div className="px-8 py-16 text-center text-mist">
        <p className="mb-3">
          {currentMember ? '该项目的阶段与你无关。' : '请先点击右上角「进入身份」，再查看项目。'}
        </p>
        <Link
          to={currentMember ? '/my-tasks' : '/'}
          className="text-pine underline underline-offset-2"
        >
          ← {currentMember ? '返回我的任务' : '返回首页'}
        </Link>
      </div>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const activeId = pickActiveStage(visibleStages, todayIso);
  const activeStage: Stage | undefined = visibleStages.find((s) => s.id === activeId);

  // 完成度：已完成阶段数 / 可见阶段数
  const doneCount = visibleStages.filter((s) => s.visible !== false && s.status === 'completed').length;
  const percent = visibleStages.length ? (doneCount / visibleStages.length) * 100 : 0;

  const countdownTarget =
    activeStage?.endAt.slice(0, 10) ?? project.plannedEndAt.slice(0, 10);

  const actions = createProjectActions(repos);

  return (
    /*
      内容区内边距由本页根节点自持（AppShell 的 <main> 已移除全部内边距）。
      值取 **32**，出处是画板 04「项目详情 · 阶段时间轴」：
        内容区  [col gap=20 pad=32]
        顶栏    [row gap=16 pad=24]
      即「顶栏 24 / 正文 32」是设计稿**刻意不同的两档**，不是没对齐。
      为什么必须补：本页根节点原先无任何内边距，正文第一行贴在顶栏下沿 0 间距，
      用户读作「过于靠近上沿、没有上下居中」（实为整行贴顶）。gap=20 由下方
      信息环的 mb-5（20px）承担，与画板 col gap=20 同值。
    */
    <div className="p-8">
      {/*
        操作行（日程表 / Agent Board / 归档）—— **右对齐、无左侧返回链接**。

        ⚠️ v0.7 增量：这里原有一个「← 全部项目 / ← 我的任务」文字链接，**已删除**。
        依据：画板 04 顶栏只有「返回与面包屑块」（36×36 返回按钮 + 面包屑「项目 /
        {项目名}」），正文区里**根本没有这条二级栏返回行**。返回入口统一收敛到
        TopBar 的面包屑（TopBar.tsx 的 Breadcrumbs：返回箭头 + 项目 / 我的项目 / {项目名}）。
        保留两个返回箭头会指向同一目的地（原链接与面包屑的「我的项目」都 navigate('/')），
        用户原话读作「是否重复？而且它们没有对齐」——不对齐的根因是顶栏有 px-4/xl:px-6
        而本页为 0，补上 p-8 后错位自然消失。

        ⚠️ 成员视角可达性（已读码逐条核实，不是想当然）：
          · 面包屑在 TopBar 里是 `hidden min-w-0 md:flex`，即 **≥768 才渲染**。
          · ≥768 的成员：面包屑「我的项目」按钮 `navigate('/')` → HomeRouteGuard 判
            isMember 后 <Navigate to="/member-board">（homeRouteTarget(true)），
            落点是成员看板而非首页；返回箭头是 `navigate(-1)`。
            两条都在，member 仍有回程（目的地由守卫决定，不是首页）。
          · <768 的成员：面包屑整块不渲染，本页**没有**行内返回入口，
            回程只剩顶栏汉堡 → 侧栏抽屉的导航项（成员的「看板 / 我的任务」）。
          · 另外本页两处早退分支（未找到项目 / 受限空态）各自保留了专属返回链接，
            这两种情况下 member 仍有明确的回程，不受本次删除影响。
      */}
      <div className="mb-3 flex items-center justify-end">
        <div className="flex items-center gap-2 text-sm">
          {/* v0.7-D · 打印/导出入口对「已进入身份」开放（管理员 + 成员）：
              用户已拍板「放开成员打印」——成员可查看并打印/导出（只读导出），不放开编辑。
              条件是 `role !== null`（不是 `!isAdmin`、更不是 `!memberView`）：
              未进入身份（role=null）**不**渲染此入口——该档在页首已走受限空态（无可见范围），
              此处是双保险，避免「未进入」被误并进允许档。 */}
          {/*
            ★ §7.3 #17/#18 的**入口侧**收口：「**不给 Agent 看板任何打印入口**（UI 层隐藏），
            但路由本身仍可打开」（删路由会破坏既有深链）。

            为什么入口侧要单独收这一道（正文的 `ProjectSourceBadge` 不是已经够了？）：
            不够。两者解决的是**不同**问题 ——
              · 隐藏入口 = **主动阻断**"无意中把 Agent 看板做成客户稿"这条误操作路径；
              · 来源标识   = 深链直达（收藏夹/历史/别人发来的链接）时的**事后告知**。
            只做后者，用户会在不知情的情况下把 Agent 看板印出来（打印稿本身没有
            来源徽章，那是给屏幕看的）；只做前者，深链仍然直达。两条都要。

            条件与上方 `role !== null` **叠加**（不是替换）：`role !== null` 管"谁"，
            `projectKindOf(project) !== 'agent'` 管"哪一个"。用 `projectKindOf` 而不是
            裸 `project.kind === 'agent'`：读时回落只允许有一个出处（老库无该列）。
          */}
          {role !== null && projectKindOf(project) !== 'agent' && (
            <button
              type="button"
              onClick={() => window.open(`/project/${project.id}/schedule-print`, '_blank')}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand"
              title="打开日程表打印视图（新窗口）"
            >
              <CalendarRange size={14} /> 日程表
            </button>
          )}
          {!memberView && (
            <>
              {/*
                ★ v0.8 T04-A · 「跳 Agent 工作区」入口的 kind 门控（PRD 第 27 行 / 设计 §7.3 #27）。

                ── 为什么这个按钮原来缺一道门，以及缺了会怎样 ──
                  v0.6 · T13 要点 9 加它时的语义是「**在 Agent Board 中查看本项目任务**」：
                  那时 Agent Board 与人类项目**共用一套**数据，人类项目上这个按钮是通的。
                  v0.8 把 Agent 工作区做成**物理隔离**的独立工作区之后，这个语义**不再成立** ——
                  Agent 工作区里只装 `kind === 'agent'` 的看板，人类项目在那里**根本不存在**。
                  于是人类项目详情页上的这个按钮变成一个死入口：点下去锚定的是人类 id，
                  落到 `/agent` 后 `currentProjectId` 指向一个 Agent 侧查不到的项目，
                  页面表现为「选中了一个配不上任何看板的下拉项」（缺陷，非设计）。

                ── 与打印按钮的对照（同一段上方 24 行） ──
                  `:206` 的打印入口是 `role !== null && projectKindOf(project) !== 'agent'`
                  （**人类**项目才给），本按钮恰好相反是 `projectKindOf(project) === 'agent'`
                  （**Agent** 看板才给）。两条门互补，共同实现 §7.3 #17/#18 与 #27 的
                  「入口侧结构性关闭」：人类侧既不能把 Agent 看板印出来，也不会被误导去
                  一个不存在的工作区里找人类项目。

                ── 「允许穿越」到底允许什么（本次的关键澄清） ──
                  PRD 第 27 行：「单项目 | **允许打开**（唯一允许穿越的通道，且**单向**：
                  人类侧永不出现 Agent 内容）」；§7.3 #27：「允许打开 Agent 看板详情」。
                  ⇒「穿越」指的是**Agent 看板详情页本身可被打开**（从 `/agent` 点进去，
                    或深链直达），所以本按钮在 `kind === 'agent'` 时**必须在**。
                    而「单向」指的是**人类侧永不出现 Agent 内容** —— 这条与本按钮无关
                    （本按钮在人类项目上出现时泄露的不是 Agent 内容，而是一个坏入口）。

                ── 为什么是嵌套而不是 `!memberView && …` 平铺 ──
                  本 `<>` 片段里还有一个 `归档` 按钮，它是**写操作**、仍限管理员且
                  **不按 kind 区分**（Agent 看板也能归档）。若把 kind 门提到片段外层，
                  归档会被一并关掉 —— 那是回归。两个条件**叠加**作用在本按钮上，
                  `!memberView`（管"谁"）由外层负责，`projectKindOf(project) === 'agent'`
                  （管"哪一个"）由本行负责，与上方打印按钮同一套写法（用 `projectKindOf`
                  而非裸 `project.kind`：读时回落只允许有一个出处，老库无该列）。
              */}
              {projectKindOf(project) === 'agent' && (
                <button
                  type="button"
                  onClick={() => {
                    useAgentStore.getState().setCurrentProject(project.id);
                    window.location.assign('/agent');
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand"
                  title="在该 Agent 工作区中打开"
                >
                  <Bot size={14} /> Agent Board
                </button>
              )}
              {/*
                ★ v0.8 T04-B · 「接管」入口（PRD B11 / B12 / D5 / §7.3 #27）。
                TransferDialog 的**宿主接线**（此前组件建好但没有任何页面引用它，
                tests/agent-board-create.spec.tsx 的未覆盖备注即指此）。

                三道门叠在这颗按钮上（缺一不可）：
                  · `!memberView` —— 外层片段已拦（D5：接管仅 admin；未进入身份同样不可见）；
                  · `projectKindOf(project) === 'agent'` —— 只有 Agent 看板需要接管
                    （人类项目本来就是人类侧的，没有"接管"语义）；
                  · TransferDialog 内部还有一层 `useRoleGuard()` 双门（UI 隐藏不是
                    安全边界，服务端 assert 才是——见该组件文件头）。

                为什么放在详情页而不是 AgentBoardPage：#27 明示详情页是 Agent 看板
                "唯一允许穿越的通道"，用户深链/收藏夹直达的第一落点就是这里；
                且接管要选**人类项目**做目标，详情页的人类 chrome（面包屑等）
                正好提供"我现在在哪"的方位感。
              */}
              {projectKindOf(project) === 'agent' && (
                <button
                  type="button"
                  data-transfer-open=""
                  onClick={() => setTransferOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand"
                  title="转为正式项目，或把任务搬进人类项目"
                >
                  <ArrowRightLeft size={14} /> 接管
                </button>
              )}
              {/* 归档是**写操作**，仍限管理员（v0.7-D 只放开打印，未放开任何写） */}
              <button
                type="button"
                disabled={project.status !== 'active'}
                onClick={() => void actions.setArchived(project.id, true)}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand disabled:opacity-40"
                title={project.status !== 'active' ? '已归档' : '归档后从首页列表隐藏'}
              >
                <Archive size={14} /> 归档
              </button>
            </>
          )}
        </div>
      </div>

      {/*
        ★ v0.8 T04-A · TBD-10 板块确认入口（设计 §3.2.1 第 3 处落点：「详情页」）。

        传 `[project]`（单元素）而不是项目列表：本页语境就是**这一个**项目，
        提示条在这里必须自解释（"此项目板块待确认"），而不是变成第二个看板。
        `needsDomainConfirm(project)` 为假时组件自己返回 null，所以这行的显隐
        完全由**读时派生**决定，不引入任何额外的 state / 落库字段。

        与首页提示条的**唯一差别**是受众：首页只有 admin 能到（成员被
        `HomeRouteGuard` 重定向到 `/member-board`），而本页成员可达 ⇒
        提示条对成员**只显示文字、不显示按钮**（组件内按 `isAdmin` 门控，
        与归档/改期同档：`domain` 是项目级写入）。成员看到的是事实陈述，
        不是可点的操作 —— 既没有越权路径，也不会让成员困惑"为什么我点不动"。
      */}
      <DomainConfirmPrompt
        projects={needsDomainConfirm(project) ? [project] : []}
        className="mb-3"
      />

      {/* 顶条信息环（v0.3 玻璃化；非管理员视角隐藏 clientName/address 等敏感字段） */}
      <div className="glass-medium mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line p-4 shadow-soft sm:gap-x-8 sm:p-5">
        <div>
          {/*
            ★ §7.3 #27 的「来源标识」：当且仅当 `projectKindOf(project) === 'agent'` 时
            渲染（组件内部判，人类侧**零渲染** —— 验收 8 要求 kind 在人类侧不产生
            任何新的视觉痕迹）。放标题行右侧而不是页脚：来深链的用户第一眼就该知道
            自己打开的是哪个工作区的东西，而不是滚到底才发现。
          */}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-display-lg">{project.name}</h1>
            <ProjectSourceBadge project={project} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mist">
            <Badge tone="pine">{domainLabel(effectiveDomainOf(project))}</Badge>
            {!memberView && project.clientName && <span>客户：{project.clientName}</span>}
            {!memberView && project.address && <span>· {project.address}</span>}
            <span>
              · 总工期 {totalDaysInclusive(project.plannedStartAt.slice(0, 10), project.plannedEndAt.slice(0, 10))} 天
            </span>
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3 sm:gap-6">
          <CountdownNumber target={countdownTarget} todayIso={todayIso} />
          <CompletionRing percent={percent} size={52} />
          <div className="text-xs leading-5 text-mist">
            <p>
              {project.plannedStartAt.slice(0, 10)} — {project.plannedEndAt.slice(0, 10)}
            </p>
            <p>
              当前：<b className="text-pine-deep">{activeStage ? `${activeStage.orderIndex}. ${activeStage.name}` : '—'}</b>
            </p>
          </div>
        </div>
      </div>

      {/* 旅游项目：每日行程面板（v0.9 旅游二期）—— 挂在时间轴之上，非旅游项目零渲染 */}
      {effectiveDomainOf(project) === 'travel' && (
        <div className="mb-5">
          {/*
            ★ 反馈 #6：客户行程单入口（只读打印页，新窗口打开）。
            与「日程表」入口同款行为；只对 travel 项目渲染 —— 非旅游项目没有行程单可打。
          */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs text-mist">
              客户行程单按天列出交通、住宿、安排与费用，可直接发给客户或打印。
            </span>
            <button
              type="button"
              data-itinerary-print-open=""
              onClick={() => window.open(`/project/${project.id}/itinerary-print`, '_blank')}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-mist hover:bg-sand"
              title="打开客户行程单（新窗口，只读导出）"
            >
              <CalendarRange size={14} aria-hidden /> 客户行程单
            </button>
          </div>
          <TravelItineraryPanel project={project} />
        </div>
      )}

      {/* 时间轴：平板横屏/桌面(≥lg)用横向时间轴；手机/平板竖屏(<lg)用纵向阶段卡片流（阶段 C） */}
      {isNarrow ? (
        <MobileStageList
          stages={visibleStages}
          tasks={tasks}
          members={members}
          todayIso={todayIso}
          onOpen={(sid) => useUiStore.getState().openStageDrawer(sid)}
        />
      ) : (
        <TimelineView
          project={project}
          stages={visibleStages}
          members={members}
          memberView={memberView}
          tasks={tasks}
        />
      )}

      <StageDrawer projectId={project.id} members={members} />

      {/*
        「接管」弹窗（PRD B11 / B12）。与入口按钮同三道门：本行 `!memberView` 决定
        进不进渲染树（TransferDialog 内部还会再判一次 admin）；`projectKindOf` 保证
        只有 Agent 看板能打开它。数据全部来自隔离漏斗出口（见上方 humanProjects 注释）。
      */}
      {transferOpen && !memberView && projectKindOf(project) === 'agent' && (
        <TransferDialog
          open
          onClose={() => setTransferOpen(false)}
          sourceBoard={{ id: project.id, name: project.name }}
          tasks={tasks}
          candidates={humanProjects}
          targetStages={humanStages}
          targetTasks={humanTasks}
          onConfirm={async (cmd: TransferCommand): Promise<TransferOutcome> => {
            if (cmd.mode === 'convert') {
              await actions.takeoverConvert(cmd.sourceBoardId);
              return { movedTaskCount: 0 };
            }
            const outcome = await actions.takeoverMove({
              boardId: cmd.sourceBoardId,
              targetProjectId: cmd.targetProjectId ?? '',
              stageId: cmd.stageId ?? '',
              taskIds: cmd.taskIds,
            });
            return { movedTaskCount: outcome.created + outcome.updated };
          }}
        />
      )}
    </div>
  );
}
