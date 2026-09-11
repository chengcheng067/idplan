import { Navigate } from 'react-router-dom';

import { useRoleGuard, homeRouteTarget } from '../../hooks/useRoleGuard';
import { HomePage } from '../../pages/HomePage';

/**
 * `/` 索引路由守卫（权限矩阵 3.5 #1，主防线）：
 *   isMember → 重定向 **`/member-board`**（成员看不到项目全貌）
 *   其余     → 正常渲染首页
 * 注意：isMember 推导基于 currentMemberId → member.roleKind，
 *       未进入身份（role=null）视为非成员，仍可看首页（first-run 引导前）。
 *
 * ⚠️ 陈旧注释更正（v0.7 T04）：此前的类注释写的是「重定向 `/my-tasks`」，
 *    **与实现反向** —— 真实落点是 `homeRouteTarget(true)`（`useRoleGuard.ts`）= `/member-board`
 *    （成员落地页是「我的相关项目看板」，不是「我的任务」）。行为未改，只改注释。
 *
 * ⚠️ P0-18 说明：成员的**月历**入口不在这里放开 —— 放开首页会连带暴露全局统计/项目网格/
 *    成员管理（范围远超用户决策）。月历以「成员看板页内的视图切换」形态提供，
 *    见 `MemberBoardPage.tsx` 的 `memberBoardView`。故本守卫**行为保持原样**。
 */
export function HomeRouteGuard(): JSX.Element {
  const { isMember } = useRoleGuard();

  if (isMember) {
    return <Navigate to={homeRouteTarget(true)} replace />;
  }
  return <HomePage />;
}
