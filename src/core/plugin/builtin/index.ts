/**
 * 内置插件清单总表（v0.8.6 阶段 1）
 *
 * **「本构建带了哪些插件」的唯一事实源。** 成员自装插件将来也走这里（同样编译期），
 * 区别只在 manifest.source === 'member'——「能装什么」由构建决定，不由用户上传决定,
 * 这是 v1 的安全边界（安全官红线：v1 只做编译期内置、无远程加载）。
 *
 * 加新插件 = 在这里加一行 + 在同目录写一个 manifest 文件。**不需要**改路由/侧栏/
 * 设置面板的任何代码——那三处的装配都从本表派生（见 PluginRegistryProvider）。
 */

import type { PluginManifest } from '../types';
import { agentBoardManifest } from '../../../plugins/agent-board/manifest';

export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [
  // 阶段 2：Agent 看板是第一个真插件（她 10-04 拍板「Agent 功能独立成插件」）。
  // ⚠️ 顺序即侧栏/设置的展示序；agent-board 是真功能故排第一。
  agentBoardManifest,
];
