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
import { t } from '../../i18n';
import { WeeklyReportPanel } from './WeeklyReportPanel';

/*
 * ★ i18n 笔 misc：三个展示字段走 **getter**，理由与形状同
 * `plugins/agent-board/manifest.tsx`（模块顶层 `t()` 会被冻在 import 那一刻，
 * 而 `PluginManifest` 的字段类型是 `string`、本批不许改共享内核契约）。
 */
export const weeklyReportManifest: PluginManifest = {
  id: 'weekly-report',
  get name() {
    return t('plugin.weeklyReport.name');
  },
  get summary() {
    return t('plugin.weeklyReport.summary');
  },
  version: '1.0.0',
  // ★ 这一行是它全部的特殊之处：非随包分发
  source: 'member',
  // 只读 ⇒ 不需要任何能力声明；写能力要等 F8/capability 落地（安全官红线）
  capabilities: ['data.read'],
  defaultEnabled: false,
  routes: [{ path: 'weekly-report', element: <WeeklyReportPanel /> }],
  nav: [
    {
      to: '/weekly-report',
      get label() {
        return t('plugin.weeklyReport.name');
      },
      icon: 'fileText',
      group: 'main',
    },
  ],
};
