/**
 * 内置插件 · Agent 看板（v0.8.6 阶段 2 · 她 10-04 拍板「Agent 功能独立成插件」）
 *
 * ── 这个插件装的是什么 ──
 * Agent 看板的**界面层**：工作区页（/agent）、执行记录页（/agent/executions）、
 * 侧栏 Agent 段及其子项。关掉它 = 这三块入口全部消失（数据一字不动）。
 *
 * ── 为什么不留在宿主的（她拍板的原话：「其实就是把现在的 Agent 功能独立出去，
 *    变成一个插件」）──
 * 独立之后：① 新功能照样往宿主加，Agent 相关改动走插件目录（201 文件的宿主
 * 不再继续膨胀）；② 她能在设置里一键关停整套 Agent 界面（不需要的人不必看见）；
 * ③ 为后续「成员自装插件」立一个真标本——第一个插件必须是最复杂的那个，
 * 否则骨架等于没被验证过（产品官原话）。
 *
 * ── 边界：什么必须留宿主（产品官 D2，硬约束）──
 * 以下**不进插件**，因为它们是审计面/写入面，卸载插件不能让它们失效：
 *   · 提案审批的**数据供给与落定**（`core/agent/*`、executions 仓储）——
 *     审批是审计动作；插件只提供 UI（ProposalReviewPanel 所在的展示层）
 *   · `payload.apply` / `commands.ts` 共享内核、transport 契约、loopback/NAS
 *     接入（`di/agent-loopback`、`server/agent.routes.ts`）
 *   · Agent 看板的**数据**（`kind==='agent'` 的项目、执行单、事件、提案）
 * 插件关掉后这些全部照常工作——**只有界面入口消失**。这是「可停用」与
 * 「可卸载」的区别，v1 只做可停用。
 *
 * ── 为什么 defaultEnabled: true ──
 * 这是**已上线功能**的插件化，不是新功能上线。默认关会让所有人升级后突然
 * 看不到 Agent 看板（看起来像坏了吗）。默认开 + 她随时可关，才是升级友好。
 */

import { AgentBoardPage } from '../../pages/AgentBoardPage';
import { AgentExecutionConsolePage } from '../../pages/AgentExecutionConsolePage';
import type { PluginManifest } from '../../core/plugin/types';

export const agentBoardManifest: PluginManifest = {
  id: 'agent-board',
  name: 'Agent 看板',
  summary: 'AI 代理的工作区：接入外部 Agent、执行单与写回提案审批、AI 规划向导',
  version: '1.0.0',
  source: 'builtin',
  // 已上线功能的插件化 ⇒ 默认开；她可按需在 设置 → 插件 一键关停
  defaultEnabled: true,
  routes: [
    // 顺序与宿主态一致：'agent' 在前、'agent/executions' 紧随（嵌套路由依赖）
    { path: 'agent', element: <AgentBoardPage /> },
    { path: 'agent/executions', element: <AgentExecutionConsolePage /> },
  ],
  nav: [
    // group:'agent' ⇒ 侧栏「Agent 段」由宿主渲染（含子项展开/收起态），
    // 插件只声明段标题与目标路由——**渲染权在宿主**，插件不自己画 UI。
    { to: '/agent', label: 'Agent 工作区', icon: 'bot', group: 'agent' },
  ],
};
