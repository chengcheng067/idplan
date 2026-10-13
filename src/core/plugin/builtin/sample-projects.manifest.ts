/**
 * 内置插件标本 · 示例项目（v0.8.6 阶段 1）
 *
 * 为什么第一个是它：
 *   ① **真功能不是摆设**——「一键灌入示例项目」本来就是界面上已有的独立入口
 *      （位置清单见下方「载入示例项目的调用点」一节），抽成插件零行为变化，
 *      但立刻能验证「停用后入口消失」是真开关；
 *   ② **零新数据面**——它复用备份导入路径（`useBackupIo().loadDemo`），
 *      不碰仓储、不建表，符合「插件不自带持久化数据」硬约束；
 *   ③ **默认关**——大部分用户不需要示例数据，所以它是「装了但停用」的标本，
 *      正好演示 manifest.defaultEnabled 这一档。
 */

import type { PluginManifest } from '../types';
import { SampleProjectsSettings } from '../../../components/settings/SampleProjectsSettings';

export const sampleProjectsManifest: PluginManifest = {
  id: 'sample-projects',
  name: '示例项目',
  summary: '一键灌入 5 个行业的示例项目与任务，用来熟悉看板/月历/甘特',
  version: '1.0.0',
  source: 'builtin',
  // 默认关：示例数据对老用户是噪声。装=可选用，开=要用户明确点头。
  defaultEnabled: false,
  // 无 routes / 无 nav：它是**动作**型插件，不贡献页面，也不贡献导航项。
  //
  // ── 载入示例项目的调用点：**4 处**（`grep -rn "void loadDemo()" src/` 可复核）──
  //   ① `components/layout/Sidebar.tsx`          —— 受「插件开关 ∧ isAdmin」双重门控
  //   ② `components/layout/MobileMoreMenu.tsx`   —— 同上（同一判据，逐字对齐）
  //   ③ `components/settings/SampleProjectsSettings.tsx`
  //      —— 本 manifest 的 `settingsSlot`（见文末）；停用 ⇒ `PluginSettingsSlot`
  //         返回 null，本面板**根本不挂载** ⇒ 按钮不可达；另叠 `disabled=busy||!isAdmin`。
  //   ④ `components/layout/FirstRunGuide.tsx`    —— **有意豁免**（首启引导卡的行业卡；
  //         理由写在那一行的注释里：该插件默认关闭，门控它会让新装用户点卡无反应）。
  //   现状 = **门控 3 处 + 有意豁免 1 处**。
  //
  // ⚠️ 订正（v0.8.6 阶段 2）：本行此前写「它的入口是**设置区块**（settingsSlot），不是页面」——
  //    那是**当时的**假注释：写下它时本 manifest 并没有声明 `settingsSlot`、全仓也没有
  //    挂载点，注释描述了一个并不存在的入口。该缺口后来由设置层级重做那条线补上
  //    （见文末 v1.0 段），**但「入口是设置区块」这个说法至今仍是错的** ——
  //    设置区块只是 4 处入口中的 1 处，从来不是唯一入口。
  //
  // ── 「入口数 = 门控数」由闸门钉死，别只靠本注释 ──
  //    `tests/plugin-registry.spec.ts` ⑩-b 逐**调用点**校验：src/ 里 `loadDemo(` 的
  //    调用点集合必须与它登记的清单严格一致（新增一处就红），每个未豁免调用点
  //    所在的条件作用域里必须出现 `usePluginEnabled('sample-projects')`，
  //    豁免点必须带得出可读理由。⇒ 改这里之前先看那条闸门。
  //
  // v1.0（设置层级重做）· 上面那句悬着的「是否要开设置区块」当场兑现：
  //    她的口径是「每一个插件都应该有自己对应的设置，它应该是在自己的板块里面」，
  //    于是每个插件都得拿得出自己的设置来。本插件拿出的就是它自己那件事本身——
  //    载入示例项目（与侧栏/⋮ 菜单入口**同一链路、同一 isAdmin 门槛**，
  //    见 `SampleProjectsSettings.tsx`）。它是**第 3 处**受管入口，不是第 3 处以上
  //    全部入口（第 4 处在首启卡片，有意豁免）。
  //
  //    停用之后的行为，**准确说法**如下（别写成「齿轮置灰、面板消失」——那是错的，
  //    而且与 `PluginsSection.tsx` 的实现及其注释直接矛盾；以那边为准）：
  //      · **齿轮不因停用而置灰**：它的 `disabled` 判据**只有**「本插件有没有声明
  //        `settingsSlot`」，与启用态无关。`PluginsSection.tsx` 的注释写死了理由：
  //        把「这个插件没有自有设置」与「这个插件停用了」压进同一个灰，
  //        是把两个不同的事实混为一谈；
  //      · **面板壳仍在**：停用时渲染的是一句「「示例项目」当前是停用状态——启用它
  //        之后，它自己的设置会出现在这里」，只有 `settingsSlot` 组件本身不渲染
  //        （`PluginSettingsSlot` 自判启用态后返回 null）。
  settingsSlot: SampleProjectsSettings,
};
