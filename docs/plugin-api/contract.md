# 契约：manifest / 数据出口 / 贡献点 / 禁令 / 样式

本文件是插件 API 的**规范本体**。所有 `文件:行号` 引用以仓库当前 HEAD 为准
（ID Plan v0.8.6.0002）。

## 1 插件是什么：三句话

1. **插件是编译期内置的功能包**：宿主在构建期 import 它的代码，用户可以随时在「设置 → 插件」里启用/停用（`PluginRegistryProvider.tsx:46-50`）。停用是**真开关**：它的路由从不进入 router 数组、侧栏入口从不渲染（`registry.ts:54-79`）。
2. **插件是声明式数据**：manifest 只有「我是谁、我要什么能力、我贡献哪些路由/入口/设置区块」，**没有回调宿主的能力**——没有 `activate(hooks)` 之类的活口，那是绕过审计的唯一入口（`types.ts:12-14`）。
3. **v1 插件是只读的**：能读人类侧项目数据，读不了仓储、写不了库（`types.ts:26-37`）。这一条的坦诚说明见 §1.2.3。

## 2 manifest 契约

### 2.1 字段总表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | ✅ | 稳定 id，小写中划线（如 `meeting-room-board`）。**发布后不可更改**——它是设置里启用状态的键名（`plugin.enabled.<id>`，`types.ts:94-96`） |
| `name` | `string` | ✅ | 显示名（设置列表与文档用） |
| `summary` | `string` | ✅ | 一句话说明，设置里直接展示 |
| `version` | `string` | ✅ | semver。首次提交写 `1.0.0` |
| `source` | `'builtin' \| 'member'` | ✅ | 随包分发 / 成员自装。**唯一目的是可信度的视觉区分**，与能力轴正交（`types.ts:39-40`） |
| `defaultEnabled` | `boolean` | ✅ | 没动过的插件的默认态。**第三方一律 `false`**——「装」与「开」是两件事（`weekly-report/manifest.tsx:18`） |
| `capabilities` | `readonly PluginCapability[]` | ⬜ | 申请的能力。缺省 = 纯展示/工具类，不碰数据 |
| `routes` | `RouteObject[]` | ⬜ | 贡献的子页面（相对 AppShell 的 path，见 §1.4.1） |
| `nav` | `PluginNavItem[]` | ⬜ | 侧栏入口（见 §1.4.2，注意 v1 的现状限制） |
| `settingsSlot` | `ComponentType` | ⬜ | 设置区块，渲染在「设置 → 插件」的详情里 |
| `recommends` | `string[]` | ⬜ | 软推荐搭配。**只提示、不强制**（强制会让「关一个」变成级联失效） |

### 2.2 最小 manifest（直接可抄）

```tsx
// src/plugins/hello-board/manifest.tsx
import type { PluginManifest } from '../../core/plugin/types';
import { HelloBoardPanel } from './HelloBoardPanel';

export const helloBoardManifest: PluginManifest = {
  id: 'hello-board',
  name: '你好看板',
  summary: '演示最小插件：一页只读的本周项目概览',
  version: '1.0.0',
  source: 'member',
  capabilities: ['data.read'],
  defaultEnabled: false,
  routes: [{ path: 'hello-board', element: <HelloBoardPanel /> }],
  nav: [{ to: '/hello-board', label: '你好看板', icon: 'fileText', group: 'main' }],
};
```

加一行到装配清单即可（路由/侧栏/设置三处装配全部从清单派生，**不需要**改别处）：

```tsx
// src/core/plugin/PluginRegistryProvider.tsx（示意）
const BUILTIN_MANIFESTS: readonly PluginManifest[] = [
  ...PLUGIN_MANIFESTS,
  sampleProjectsManifest,
  weeklyReportManifest,
  // + helloBoardManifest,
];
```

### 2.3 capabilities：v1 为什么只有 `data.read`（坦诚说明）

v1 的能力集合**只有一个值**：`'data.read'`（`types.ts:37`）。

为什么这么小，说三句实话：

1. **只读插件的爆炸半径 = 它能读到的数据**，而它能读到的只有宿主愿意通过 `visibility.ts` 那几个**已按 kind/归属收窄过**的出口给它的东西。它拿不到仓储、拿不到 `window.idplan`（`third-party-plugin-readonly.spec.ts:69-94` 静态钉死）。
2. **写能力不是「加一个字符串」的事**：10-04 的架构评审裁定过，写能力的前置是归属门下沉到仓储层（F8）+ 操作人身份不可伪造（D15）+ 提案字段白名单（D14）。那三件没落地之前，任何「能写数据的第三方插件」都等于在没有边界的沙箱里跑别人的代码（`plugin-arch-decision-2026-10-04.md` §4、F8-F10）。
3. **声明 ≠ 授权**：`capabilities` 是上限请求。管理员将来可用「能力上限策略」整体关掉某能力（`types.ts:73-79`）。所以规范里写「我需要 data.read」，不等于「我必须装完就能用」。

> 已知代管桥模型（`plugin-arch-decision-2026-10-04.md` §4 安全官方案 A）落地后，能力集合预计扩为 `data.read` / `data.write.proposal`（只写提案、落库由人批）/ `file.pick` / `storage.kv`。**规范承诺前先说清楚 v1 没有**。

## 3 只读数据出口清单

全部集中在 `src/core/project/visibility.ts`。这是全仓**唯一**允许原始读 `store.projects/stages/tasks` 的地方（`visibility.ts:163-175`），也是插件唯一的数据来源——**不存在「插件看得比宿主多」的路，因为插件用的就是宿主自己在用的出口**。

| Hook | 返回 | 已内置的过滤语义 |
|---|---|---|
| `useHumanProjects()` | `Project[]` | `kind === 'human'`，不按人收窄（首页/侧栏同款，`visibility.ts:187-189`） |
| `useHumanStages()` | `Stage[]` | 人类侧项目下的全部阶段，靠 `projectId` 集合收窄（`visibility.ts:214-221,234-236`） |
| `useHumanTasks()` | `Task[]` | 同上（`visibility.ts:238-240`） |
| `useAgentProjects()` | `Project[]` | `kind === 'agent'` **且按当前成员归属收窄**（`ownerMemberId` 为空 = 公共板，`visibility.ts:200-207`） |
| `useAgentStages()` / `useAgentTasks()` | 同上族 | 同上 |

单项目直达出口（不加 kind 过滤，**跨 kind 直达是特性**，调用方自己知道打开的是哪个 id）：

| Hook | 返回 | 说明 |
|---|---|---|
| `useProjectById(id)` | `Project \| undefined` | 详情页/打印页同款（`visibility.ts:266-269`） |
| `useProjectStages(id)` | `Stage[]` | 按 `orderIndex` 排序（`visibility.ts:290-301`） |
| `useProjectTasks(id)` | `Task[]` | 按 `projectId` 筛（`visibility.ts:304-310`） |

**v1 刻意不给的出口**：成员表（含 `passwordHash`，10-04 审计 W16 的桌面端风险点）、设置 KV、备份。不是「约定了别读」，是**根本没有这个出口**——结构性避免。

字段含义（只列插件最常用字段，完整定义见 `src/core/types/entities.ts`）：

- `Project`（`entities.ts:246-333`）：`id`（`proj_xxx`）/ `name` / `clientName` / `plannedStartAt` / `plannedEndAt`（UTC ISO string，**全程 string 不见 Date 对象**）/ `status` / `domain`（主板块）/ `kind` / `ownerMemberId` / `scheduleBasis`（自然日/工作日）。
- `Stage`（`entities.ts:341-380`）：`id` / `projectId` / `orderIndex`（项目内 1..N 连续）/ `name` / `ratioPercent`（工作量占比）/ `startAt` / `endAt` / `status` / `visible`。
- `Task`（`entities.ts:49-172`）：`id` / `projectId` / `stageId` / `title` / `status`（七值，完成判定用 `taskIsDone(t)` 不要直读 `done`）/ `assigneeIds` / `dueDate`（`YYYY-MM-DD` 或空）/ `taskNo`（人读号，展示走 `formatTaskNo`）/ `artifacts`（对象数组，别用 `typeof === 'string'` 过滤）。

## 4 贡献点怎么写

### 4.1 routes：子页面，不是平铺路由

插件的页面是**宿主的子页面**：路由注册进 AppShell 那条路由的 `children`（相对 path，不带前导 `/`），由 `resolveRoutes` 统一合并（`registry.ts:54-74`）。三条硬纪律：

1. 只合并**启用中**的插件——停用的插件路由在数组里**不存在**（不是重定向、不是渲染 null）；
2. **不许摊平顶层**——宿主是「一层根 + AppShell + children」两层结构，顶层追加会让页面失去 `<main>` 外壳（这个坑阶段 2 实测栽过，`registry.ts:39-43`）；
3. **通配符自动让位**——宿主持 `path:'*'`，插件路由自动插它前面（`registry.ts:49-53`），作者不用管，但别在自己的 path 里写 `*`。

### 4.2 nav：侧栏入口

```tsx
nav: [{ to: '/hello-board', label: '你好看板', icon: 'fileText', group: 'main' }]
```

`to` 必须与 routes 里某条对得上；`icon` 是宿主白名单的 lucide 图标名（**不要 import 图标库进插件**，宿主侧映射解析，`types.ts:50-51`）；`group: 'main'`（主段）/ `'agent'`（Agent 段）。

> ✅ **已补齐（2026-10-07，commit `ba92966`）**：`group: 'main'` 现已由宿主渲染——
> 作为普通导航项插在「我的任务」之后、Agent 段之前，并带一枚 10px「插件」小标
> （设计师规范：来源分层只用小标与退档底色，**不用徽章**）。图标经宿主白名单映射表
> `PLUGIN_NAV_ICONS` 解析，未知图标回落 `Puzzle` 不报错——外部作者的规范外图标名
> 不该让侧栏崩。`SidebarNav.tsx:71` 一带 + `tests/plugin-registry.spec.ts` 的 ⑪ 钉死
> 「main 与 agent 两族都必须有消费者」。

### 4.3 settingsSlot：设置区块

`settingsSlot` 是渲染在「设置 → 插件」详情里的 React 组件，插件不自己渲染整个设置页：

```tsx
settingsSlot: HelloBoardSettings  // () => JSX.Element
```

宿主侧声明式挂载（`PluginRegistryProvider.tsx:194-202`）。适合放「不需要一整页」的轻交互（偏好开关、说明链接）。注意：**插件不自带持久化数据**（`types.ts:11`）——v1 没有插件私有存储，要存偏好请走宿主设置（由宿主代写，PR 评审时单独议）。

## 5 硬禁令（附为什么）

| 禁令 | 为什么 |
|---|---|
| 不得 import `useRepos` / `core/repositories/*` / `backup.service` / `agent-takeover` / `payload.apply` | 那是全部写能力的根（`third-party-plugin-readonly.spec.ts:69-94`）。拿到 repos 的插件可以给自己提权、整库替换、绕过归属门直写人类项目（10-04 审计 W15 实测） |
| 不得碰 `window.idplan` 之类宿主全局别名 | 那是 Electron 原生桥（窗口控制/更新/agent 入口文件写入，`preload.cjs:19-67`），不是给插件的 API。浏览器/NAS 端它根本不存在，无 Provider 时应按不存在处理 |
| 不得改宿主全局样式 | 你的页面被关掉时，你的 CSS 副作用还留在全局。只能用 Tailwind 原子类（自带作用域）或 `[data-plugin="<id>"]` 前缀的自定义 CSS；**禁止**全局元素选择器、`:root` 改写、`@import` 全站样式表 |
| 不得在模块顶层做副作用 | 不写 `console.log`、不发请求、不注册定时器、不改 `document.title`。模块顶层只做常量与组件定义——停用语义要求「代码不被执行」，顶层副作用会活过开关 |
| manifest 的 `id` 发布后不许改 | 它是用户认得出这条插件的唯一标识 + 开关状态的键名（`types.ts:60-62`） |

## 6 样式与主题约定

**唯一原则：用宿主的 token，不写一个色值。**

| Token | 语义 | 典型类名 |
|---|---|---|
| `cream` | 页面底色 | `bg-cream` |
| `paper` | 卡片/面板 | `bg-paper` |
| `sunken` | 输入框/内凹井 | `bg-sunken` |
| `sand` | hover 底纹（半透明，**不做描边**） | `hover:bg-sand` |
| `line` | 唯一描边色（1px 实色） | `border-line` |
| `ink` / `mist` | 主/次文字 | `text-ink` `text-mist` |
| `pine` / `pine-soft` | 主强调 / 品牌浅底 | `text-pine` `bg-pine-soft` |
| `amber` / `amber-soft` | 警示 / 临期底 | `text-amber` |
| `clay` / `clay-soft` | 危险 / 逾期底 | `text-clay` |
| `moss` / `moss-soft` | 成功 / 完成底 | `text-moss` |

规则：颜色一律走 Tailwind 类（`bg-paper`、`text-ink`、`border-line`），**禁止 hex、`rgb()`、`hsl()` 硬编码**；透明度修饰符（`bg-pine/20`）可用。亮暗双主题**自动成立**——token 的暗色值由 `[data-theme='dark']` 整组换掉（`global.css:321-352`），你不写死颜色就不用写第二套。**验收动作：两个主题各运行一次，各截一张图**，贴进 PR 描述。

圆弧与层次走宿主既有口味：卡片 `rounded-lg`~`rounded-xl`、1px `line` 描边、低透明度柔影（`global.css:50-70`）。不引入新的圆角档位与阴影配方。