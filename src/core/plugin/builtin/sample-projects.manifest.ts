/**
 * 内置插件标本 · 示例项目（v0.8.6 阶段 1）
 *
 * 为什么第一个是它：
 *   ① **真功能不是摆设**——「一键灌入示例项目」本来就是设置里的独立入口，
 *      抽成插件零行为变化，但立刻能验证「停用后入口消失」是真开关；
 *   ② **零新数据面**——它复用备份导入路径（`useBackupIo().loadDemo`），
 *      不碰仓储、不建表，符合「插件不自带持久化数据」硬约束；
 *   ③ **默认关**——大部分用户不需要示例数据，所以它是「装了但停用」的标本，
 *      正好演示 manifest.defaultEnabled 这一档。
 */

import type { PluginManifest } from '../types';

export const sampleProjectsManifest: PluginManifest = {
  id: 'sample-projects',
  name: '示例项目',
  summary: '一键灌入 5 个行业的示例项目与任务，用来熟悉看板/月历/甘特',
  version: '1.0.0',
  source: 'builtin',
  // 默认关：示例数据对老用户是噪声。装=可选用，开=要用户明确点头。
  defaultEnabled: false,
  // 无 routes / 无 nav：它的入口是**设置区块**（settingsSlot），不是页面。
  // 这同时验证「插件的贡献点不止路由一种」。
};
