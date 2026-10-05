/**
 * 第三方样板插件 · manifest（v0.8.6 阶段 3）
 *
 * 与随包插件（`agent-board`）的唯一区别是 **`source: 'member'`**：它不进
 * 打包白名单、不由宿主维护、由用户自己选择装不装。视觉上由此获得「来源分层」
 * （设计师规范：左竖条 + 底色退档，不贴徽章、不给红）。
 *
 * `defaultEnabled: false` —— 第三方插件**默认关**。要用户明确点头才启用：
 * 这是「装」和「开」两件事，混为一个按钮是最常见的插件设计错误（用户装完发现
 * 自己没打算开的东西已经在跑了）。
 */

import type { PluginManifest } from '../../core/plugin/types';
import { WeeklyReportPanel } from './WeeklyReportPanel';

export const weeklyReportManifest: PluginManifest = {
  id: 'weekly-report',
  name: '项目周报',
  summary: '一页看完本周全部项目的阶段/任务/逾期（只读）',
  version: '1.0.0',
  // ★ 这一行是它全部的特殊之处：非随包分发
  source: 'member',
  // 只读 ⇒ 不需要任何能力声明；写能力要等 F8/capability 落地（安全官红线）
  capabilities: ['data.read'],
  defaultEnabled: false,
  routes: [{ path: 'weekly-report', element: <WeeklyReportPanel /> }],
  nav: [{ to: '/weekly-report', label: '项目周报', icon: 'fileText', group: 'main' }],
};
