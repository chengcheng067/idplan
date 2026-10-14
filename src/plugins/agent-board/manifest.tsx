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
 *
 * ── v1.0：本插件的**设置**也归它自己（`settingsSlot`）──
 * 她的原话：「每一个插件都应该有自己对应的设置，它应该是在自己的板块里面」。
 * Agent 席位与本地库 / 自然语言通道 / Agent 看板入口这三块因此从宿主设置抽屉
 * 搬进 `AgentSettingsPanel`，挂在这里——主机侧不再有一份「Agent 该有哪些设置」
 * 的名单（原先那份名单是设置抽屉里的 `PLUGIN_SUBS` 两段子导航，已删）。
 * 可视化结果：设置 → 插件 → 「Agent 看板」卡上的齿轮 → 这三块；
 * 关掉本插件 ⇒ 齿轮置灰、设置随 slot 一起消失。
 */

import { AgentBoardPage } from '../../pages/AgentBoardPage';
import { AgentExecutionConsolePage } from '../../pages/AgentExecutionConsolePage';
import type { PluginManifest } from '../../core/plugin/types';
import { t } from '../../i18n';
import { AgentSettingsPanel } from './AgentSettingsPanel';

/*
 * ★ i18n 笔 misc：`name` / `summary` / `nav[].label` 改成 **getter**（不是普通字面量）。
 *
 * 为什么不能用「模块顶层 `t('键')` 存成常量」：manifest 是**模块级声明式数据**，
 * 顶层求值只在 import 那一刻算一次 ⇒ 用户在设置里切语言后，侧栏入口与插件卡
 * 仍停在上一种语言（`useLang.ts` 头注释第 ② 条禁的正是这个形状）。
 * 为什么也不能改成「函数形态的标签表」：`PluginManifest` 的字段类型是 `string`
 * （`src/core/plugin/types.ts`），本批不许改共享内核的契约。
 * ⇒ getter 是等价且就地可行的形态：**每次读**都以当前语言重算，而消费方
 *   （`SidebarNav` / `PluginsSection`）本来就 `useLang()` 订阅、切语言会重渲染，
 *   于是读到新值。`t` 取模块级（不订阅）在此**不是**缺陷 —— 订阅由消费方负责。
 *   ⚠️ 因此本文件的 manifest 对象**不能被浅拷贝**（`{...manifest}` 会把 getter 拍平成
 *     求值那一刻的字符串）：`core/plugin/installed.ts::mergeInstalledManifests`
 *     对内置清单是 `[...builtins]` 传引用（已核），别处也不要加拷贝。
 */
export const agentBoardManifest: PluginManifest = {
  id: 'agent-board',
  /* 插件名 = 「整个工作区的名字」⇒ 复用 `agentTerm.board.human`（该词条的唯一出处，
     见 `src/i18n/labels.ts` 里对该键的说明），不另建同值键。 */
  get name() {
    return t('agentTerm.board.human');
  },
  get summary() {
    return t('plugin.agentBoard.summary');
  },
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
    {
      to: '/agent',
      get label() {
        return t('nav.agentAreaAria');
      },
      icon: 'bot',
      group: 'agent',
    },
  ],
  // 本插件自己的设置（设置 → 插件 → 「Agent 看板」卡的齿轮就地展开）。
  // 全员可见：与搬家前一致（原二级子导航没有 adminOnly 门控），不在此加管理员墙。
  settingsSlot: AgentSettingsPanel,
};
