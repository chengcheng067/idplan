import { useMembersStore } from '../store/useMembersStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { Member, Stage, Task } from '../core/types/entities';
import { MemberRoleKind } from '../core/types/enums';

/**
 * 角色集中收口（v0.2 核心决策 4）：权限判断一律经本 hook 取 isAdmin/isMember，
 * 禁止组件直接读 members 比对 roleKind（否则权限规则散落各处，未来改规则要全改）。
 *
 * 角色是「members store + settings store」两个 store 的派生数据：
 *   members 已全量装载（bootstrap 同步就绪），currentMemberId 在 settings，
 *   一个 hook 订阅即可，无需 Context / Provider 树改造（最小变更）。
 *
 * 返回：
 *   role          : 'admin' | 'member' | null（未进入）
 *   isAdmin       : role === 'admin'
 *   isMember      : role === 'member'
 *   isEntered     : role !== null
 *   currentMember : 当前身份成员对象（active 且 id 匹配）
 *   hasAdmin      : members 中是否存在 active 且 roleKind==='admin'（first-run 判定）
 *   hydrated      : bootstrap 是否完成（首启闸门用）
 */

export interface RoleGuardState {
  role: MemberRoleKind | null;
  isAdmin: boolean;
  isMember: boolean;
  isEntered: boolean;
  currentMember: Member | null;
  hasAdmin: boolean;
  hydrated: boolean;
}

/** 纯函数：角色派生（供 useRoleGuard 复用 + role-guard.spec 单测） */
export function deriveRoleGuardState(
  members: Member[],
  currentMemberId: string | null,
  hydrated: boolean,
): RoleGuardState {
  const currentMember =
    members.find((m) => m.id === currentMemberId && m.active) ?? null;
  const role = currentMember?.roleKind ?? null;
  const hasAdmin = members.some(
    (m) => m.active && m.roleKind === MemberRoleKind.Admin,
  );
  return {
    role,
    isAdmin: role === MemberRoleKind.Admin,
    isMember: role === MemberRoleKind.Member,
    isEntered: role !== null,
    currentMember,
    hasAdmin,
    hydrated,
  };
}

export function useRoleGuard(): RoleGuardState {
  const members = useMembersStore((s) => s.members);
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const hydrated = useSettingsStore((s) => s.hydrated);
  return deriveRoleGuardState(members, currentMemberId, hydrated);
}

/* ------------------------------ 纯逻辑辅助 ------------------------------ */

/**
 * 有效参与人读取集中收口（v0.3 变更 C 核心决策 2）：
 * `assigneeIds.length > 0 ? assigneeIds : assigneeId ? [assigneeId] : []`。
 * - 输入允许 assigneeIds 缺省（旧数据/旧备份/既有测试），回落行为与 v0.2 完全一致；
 * - 收口纪律：所有权限/可见性判断一律走本函数，禁止散落读取两个字段
 *   （否则旧数据回落逻辑将来改一处漏十处）。
 */
export function taskAssigneeIds(
  task: Pick<Task, 'assigneeId'> & { assigneeIds?: string[] },
): string[] {
  const ids = task.assigneeIds;
  if (Array.isArray(ids) && ids.length > 0) return [...ids];
  return task.assigneeId ? [task.assigneeId] : [];
}

/** 去重后集合相等（顺序无关、重复去重；空集与空集相等）——集合级指派流水去重判定 */
export function sameAssigneeSet(a: string[], b: string[]): boolean {
  const norm = (xs: string[]): string[] => [...new Set(xs)].sort();
  const na = norm(a);
  const nb = norm(b);
  return na.length === nb.length && na.every((x, i) => x === nb[i]);
}

/**
 * active 管理员计数（v0.3 变更 A 降级保护）：
 * 口径与 hasAdmin 一致——只统计 active 且 roleKind==='admin'（停用不算）。
 * 唯一 active 管理员时「取消管理员」按钮 disabled + 确认回调双保险拒绝。
 */
export function countActiveAdmins(members: Member[]): number {
  return members.filter((m) => m.active && m.roleKind === MemberRoleKind.Admin).length;
}

/**
 * 姓名匹配（成员进入主路径）：全名精确匹配（trim 归一）；只匹配 active 成员；
 * 重名取首个（已知边界，见增量架构待明确事项 5）。
 */
export function matchActiveMemberByName(
  members: Member[],
  input: string,
): Member | null {
  const name = input.trim();
  if (!name) return null;
  return members.find((m) => m.active && m.name.trim() === name) ?? null;
}

/**
 * 成员勾选权限：任何参与人均可勾选（taskAssigneeIds 包含语义）。
 * admin 由调用方 isAdmin 短路放行；未进入（memberId=null）不可勾选。
 */
export function canMemberToggleTask(
  memberId: string | null,
  task: Pick<Task, 'assigneeId'> & { assigneeIds?: string[] },
): boolean {
  return memberId !== null && taskAssigneeIds(task).includes(memberId);
}

/** 落地页路由决策：isMember → /member-board（成员项目看板，仅自己相关项目）；否则首页看板 */
export function homeRouteTarget(isMember: boolean): string {
  return isMember ? '/member-board' : '/';
}

/* -------------------- 成员看板「看谁」的解析（0.8.6.0002 反馈 #5） -------------------- */

/**
 * `/member-board` 的**观看对象**解析结果（纯函数，供 MemberBoardPage 复用 + spec 单测）。
 *
 * 背景（她的原话）：「我搜索了'朴彩英'，那我肯定就想看这个成员的任务排表……
 * 我在成员面板点击了成员，那是否也会显示这个看板」。落地形态是路由参数
 * `?member=<id>`（而不是新全局状态）：深链可分享、浏览器返回键自然、
 * 刷新不丢，且不需要给 zustand 加「当前查看的成员」这种一刷新就错的瞬态。
 *
 * 四条语义（按优先级）：
 *   `self`   —— 无参数：看**自己**（= today 的行为，逐字不变；成员身份落地页正是它）
 *   `member` —— 有参数且**是管理员**且 id 命中：看该成员（含停用成员：历史任务仍在库里，
 *               管理员要能回看；隐私边界只由 isAdmin 把守，不与 active 耦合）
 *   `denied` —— 有参数但**不是管理员**：成员身份不放行（隐私边界，不是功能缺失），
 *               调用方应重定向回无参 `/member-board`（落到她自己）
 *   `missing`—— 有参数、是管理员、但 id 查无此人（删成员后的陈旧深链）：显式空态，
 *               **不静默回落自己**（回落会把「看别人的板」骗成「看自己的板」）
 */
export type MemberBoardSubject =
  | { kind: 'self'; memberId: string | null }
  | { kind: 'member'; member: Member }
  | { kind: 'missing' }
  | { kind: 'denied' };

/** 见 {@link MemberBoardSubject} 的四条语义。空串/空白参数视同「无参数」。 */
export function resolveMemberBoardSubject(opts: {
  memberParam: string | null;
  isAdmin: boolean;
  currentMemberId: string | null;
  members: Member[];
}): MemberBoardSubject {
  const param = opts.memberParam?.trim() ?? '';
  if (!param) return { kind: 'self', memberId: opts.currentMemberId };
  if (!opts.isAdmin) return { kind: 'denied' };
  const member = opts.members.find((m) => m.id === param);
  if (!member) return { kind: 'missing' };
  return { kind: 'member', member };
}

/** 「看某成员的看板」链接（URL 参数唯一构造点，避免各处手拼 query 漂移） */
export function memberBoardHref(memberId: string): string {
  return `/member-board?member=${encodeURIComponent(memberId)}`;
}

/**
 * 搜索成员命中（0.8.6.0002 反馈 #5）：**active** 成员、姓名包含查询词（trim + 大小写不敏感）。
 *
 * 两条纪律：
 *   ① 只匹配 active 成员 —— 与 `matchActiveMemberByName`（进入主路径）同口径，
 *      停用成员不该被搜出来当入口；
 *   ② 本函数**不做角色门控** —— 「是否出现成员条目」由调用方按 `isAdmin` 决定
 *      （成员身份搜不到别人，这是隐私边界）。
 */
export function searchMemberHits(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return members.filter((m) => m.active && m.name.toLowerCase().includes(q));
}

/* -------------------- 受限视图判定（BUG-1 修复的核心语义） -------------------- */

/**
 * 受限视图判定：非管理员即受限——**未进入身份（role=null）同样受限**。
 *
 * BUG-1 背景：ProjectDetailPage 曾用 isMember（role==='member'）判定受限，
 * 导致未进入用户（role=null）isMember=false 被当作管理员，可见敏感字段并可写
 * （拖拽改期/归档）。正确语义是「不是管理员就不给管理员权限」，即 !isAdmin。
 * 本函数是组件判定的唯一出口，组件不得再自行写 `!isMember` 之类的派生。
 */
export function isRestrictedView(role: MemberRoleKind | null): boolean {
  return role !== MemberRoleKind.Admin;
}

/**
 * 项目详情「相关阶段」计算（纯函数，供 ProjectDetailPage 复用 + spec 单测）：
 *   - 管理员（memberView=false）→ null（全量渲染）；
 *   - 成员（memberView=true 且已进入）→ 自己负责（ownerId）或存在自己参与任务（taskAssigneeIds 包含）的阶段；
 *   - 未进入（memberView=true 但 currentMemberId=null）→ 空集（受限空态，无任何相关阶段）。
 */
export function computeRelatedStageIds(opts: {
  memberView: boolean;
  currentMemberId: string | null;
  stages: Stage[];
  tasks: Task[];
}): Set<string> | null {
  if (!opts.memberView) return null;
  if (!opts.currentMemberId) return new Set<string>();
  const me = opts.currentMemberId;
  const myTaskStageIds = new Set(
    opts.tasks
      .filter((t) => taskAssigneeIds(t).includes(me))
      .map((t) => t.stageId),
  );
  return new Set(
    opts.stages
      .filter(
        (s) => s.ownerId === me || myTaskStageIds.has(s.id),
      )
      .map((s) => s.id),
  );
}

/* ------------------------------ 旧数据迁移：roleKind 归一（LOW-2） ------------------------------ */

/**
 * 旧成员行 roleKind 归一（v0.3 LOW-2 边界迁移，bootstrap 一次性调用，幂等）：
 *
 * 背景：v0.2 引入 roleKind 之前创建的成员行（旧身份）roleKind 为 undefined，
 * 运行时 deriveRoleGuardState 会把 undefined 当作 role=null → isEntered=false / isAdmin=false，
 * 导致旧管理员在日程表打印页等管理员守卫处被静默挡回首页。
 *
 * 归一规则（与备份导入 zod `.default('member')` 口径一致）：
 *   1. roleKind===undefined → 默认 'member'；
 *   2. 管理员恢复：系统当前无 active 管理员（hasAdmin=false）且 currentMemberId 指向的
 *      正是这条旧行且 active 时，该当前用户即「设计师本人」（旧单机无权限模型时代的唯一进入者），
 *      恢复为 'admin'——避免旧管理员被降级为 member 而丧失管理入口。
 *      仅当不存在显式 admin 时才提权（绝不凭空新增第二个 admin）。
 */
export function normalizeLegacyMemberRoles(
  members: Member[],
  currentMemberId: string | null,
): Member[] {
  const hasExplicitAdmin = members.some(
    (m) => m.active && m.roleKind === MemberRoleKind.Admin,
  );
  const currentLegacy = currentMemberId
    ? members.find((m) => m.id === currentMemberId && m.roleKind === undefined)
    : undefined;
  const restoreAdminId =
    !hasExplicitAdmin && currentLegacy?.active ? currentLegacy.id : null;

  return members.map((m) => {
    if (m.roleKind !== undefined) return m;
    const roleKind =
      m.id === restoreAdminId ? MemberRoleKind.Admin : MemberRoleKind.Member;
    return { ...m, roleKind };
  });
}
