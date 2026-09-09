import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Navigate,
  RouteObject,
  RouterProvider,
  createBrowserRouter,
} from 'react-router-dom';

import { RepoProvider } from './di/repository.provider';
import { initTheme } from './hooks/useTheme';
import { installGlobalLogCatchers, logInfo } from './core/services/log.service';
import './styles/global.css';
import { AppShell } from './components/layout/AppShell';
import { HomeRouteGuard } from './components/layout/HomeRouteGuard';
import { MyTasksPage } from './pages/MyTasksPage';
import { MemberBoardPage } from './pages/MemberBoardPage';
import { AgentBoardPage } from './pages/AgentBoardPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { SchedulePrintPage } from './pages/SchedulePrintPage';
import { CalendarPrintPage } from './pages/CalendarPrintPage';

/**
 * 应用路由表：
 *   /                          首页·项目列表（HomeRouteGuard：isMember 重定向 /my-tasks）
 *   /project/:id               项目详情·九阶段时间轴主视图
 *   /project/:id/schedule-print 日程表打印视图（v0.3 变更 E；页内 isAdmin 守卫，复用 stores 零新查询）
 *   /project/:id/calendar-print 月历打印/导出视图（v0.5）
 *   /my-tasks                  我的任务（成员视角）
 *   /agent                     Agent Board（v0.6 · Agent 任务看板，所有角色可见）
 *
 * 底座：绿联 Docker 应用是 IP:端口直连（根路径 /），不走系统网关、无 /<proxy_path>/ 前缀
 * （proxy_path 是原生应用专用字段）。故无需 basename，路由直接挂根路径。
 */
export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <HomeRouteGuard /> },
        { path: 'member-board', element: <MemberBoardPage /> },
        { path: 'project/:id', element: <ProjectDetailPage /> },
        { path: 'project/:id/schedule-print', element: <SchedulePrintPage /> },
        { path: 'project/:id/calendar-print', element: <CalendarPrintPage /> },
        { path: 'my-tasks', element: <MyTasksPage /> },
        // Agent Board：放在 my-tasks 之后、* 通配之前（设计文档 T10 要点 7）
        { path: 'agent', element: <AgentBoardPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ] satisfies RouteObject[],
    },
  ],
);

/**
 * 应用装配点：
 *   RepoProvider —— 启动时经工厂 createRepositories(readEnvConfig) 创建一次数据源适配器，
 *                    经 Context 下发 IRepositoryBundle（业务代码唯一取数入口）。
 *   Router —— 三页面 SPA 路由。
 *   StrictMode —— 开发期放大副作用信号（离线应用首屏数据装载均为幂等操作，双调无害）。
 */
// 主题必须在首帧渲染前落到 <html data-theme>。
// index.html 里的同步内联脚本已经防过一次首屏闪白，这里再跑一次是为了接管系统偏好监听；
// 两者读同一份 localStorage，结果一致，不会打架。
initTheme();

// 全局前端日志：捕获运行时错误/未捕获 Promise 异常/console.error·warn，
// 写入本地日志，设置界面可一键导出。必须在 React 渲染前挂载，才能网住首帧异常。
installGlobalLogCatchers();

// 启动埋点：每次页面加载记一条，让用户至少能确认日志系统在工作（否则正常浏览 0 条，导出总是"暂无日志"）。
logInfo('应用', '页面加载完成');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RepoProvider>
      <RouterProvider router={router} />
    </RepoProvider>
  </React.StrictMode>,
);
