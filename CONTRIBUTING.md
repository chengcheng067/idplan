# Contributing · 持久化与桌面层铁律

> ⚖️ **许可以仓库根 `LICENSE`（MIT）为唯一权威出处。** 本项目以 MIT 许可开源：
> 任何人可自由使用、复制、修改、合并、发布、分发、再授权、销售本软件（含商用），
> 唯一条件是保留版权与许可声明。**向本仓库提交 PR，即表示同意你的贡献以与本项目
> 相同的 MIT 许可并入**（inbound=outbound）。商用无需另行授权，也不收费。
>
> ⚠️ 注意：下方「架构铁律」是**工程纪律**（违反即事故，守卫见
> `tests/arch-boundary.spec.ts`），与许可无关——铁律约束的是「怎么改才不坏」，
> 许可回答的是「你能不能改」。两者都不排除你按 MIT 的权利自行分发。

> 本文件收录**违反即事故**的架构铁律。改代码前必读；Code Review 按此逐条核对。
> 守卫落地：`tests/arch-boundary.spec.ts`（CI 全量测试必跑，违规即红）。

## 1. 持久化层边界（P1-1）

| 规则 | 允许范围 | 守卫 |
| --- | --- | --- |
| `dexie` 只允许一个文件 import | `src/core/repositories/local/dexie.database.ts`（表定义 / version 迁移 / `dumpLegacyTables` 的**唯一**入口） | arch-boundary.spec |
| `electron` 不进 `src/` | 渲染进程零 Electron 绑定；桌面能力只经 `preload.cjs` 桥接（`src/lib/desktopBridge.ts` 判别） | arch-boundary.spec |
| `better-sqlite3` 只在 `server/` | 服务端专属依赖，渲染进程绝无 | arch-boundary.spec |
| 仓储访问 | UI / store 一律走 `IRepositoryBundle`（`useRepos()`），**不直接触碰 Dexie 或 fetch** | — |

> 为什么：换壳期权。核心逻辑（stores / services / repositories）保持纯 TS +
> 平台无关，未来打包为纯 Web 应用 / 换其它桌面壳时零改码。
> （提醒：架构可移植性与许可无关——MIT 已授予你再分发的权利，「换壳」只是工程期权。）

## 2. 永不引入 `electron-updater`（P1-2，架构红线）

**本项目永不引入 `electron-updater`**，包括其任何封装（electron-builder 自带的
autoUpdater 通道同样禁用）。

理由：

1. **强绑定**：autoUpdater 把「打包格式（NSIS/appimage）、更新源（GitHub/
   自建 latest.yml）、签名校验」全部锁死在 Electron 生态——一旦引入，换壳
   期权（Tauri / 纯 Web / MSIX）即报废，重写成本高于重做。
2. **更新通道自主权**：ID Plan 的更新检测由 Electron **主进程**比对 GitHub
   Release API —— 版本比较 / 拉取 / 推送全部在 `electron/main.cjs`：
   `UPDATE_API`（`:31`）→ 带 `User-Agent` 的 HTTPS 拉取（`:74`，无 UA 会被 GitHub
   403）→ 启动 8s 后 `update:available` 推给渲染进程（`:148`）；
   比对基准是 **四段号**（`x.y.z.build`，来源仓库根 `version.json`，`:28`，
   注意与 `package.json` 的 semver `version` 是两个东西）。
   渲染进程的 `src/hooks/useUpdateCheck.ts` **不读 version.json、不碰 GitHub**，
   只做 `window.idplan.checkUpdate()` / `onUpdateAvailable()` 的桥接。
   提示后由用户手动下载。这保持了「本地软件、用户自管」的产品人格。
3. **安全面**：autoUpdater 静默替换二进制 = 一个远程代码执行通道。单人开发
   者项目不值得为此背签名基础设施与供应链审计成本。

若未来需要应用内升级：先改本文件（架构决策变更），再评估「下载器 + 用户
确认安装」的最小通道——仍然不是 electron-updater。

## 3. 持久化层编码铁律（P1-5）

### 3.1 键序铁律

以下字段的**键顺序**，在各落点必须**逐字一致**（落在错的位置不会报错，只会让
`backup.roundtrip.spec` 的 JSON.stringify 逐表 diff 失败，且报错信息极难定位）。

Task 的四个**基础落点**（Project / Stage 链另有自己的第 ③ 处，见下表）：

- `src/core/types/entities.ts`（interface 声明）
- `src/core/services/backup.service.ts`（zod schema + normalize 返回字面量）
- `src/core/repositories/local/local.tasks.repo.ts`（insert 行字面量）
- `src/core/services/project.service.ts`（建档 taskRows）

> ⚠️ **第 5 个隐性落点**：`src/core/agent/payload.apply.ts` 的 `rows.push({...})`
> 也按同一键序建 Task 行（Agent payload 导入通道）。现存注释口径一律写「四处 /
> 五处」而**没有把它计入**——改 Task 字段时请把这一处一并同步，否则
> payload 导入的行与手动建的行键序不一致。

| 字段 | 版本 | 代码注释明写的落点数 | 位置 / 位置差异 |
| --- | --- | --- | --- |
| `Task` 的 9 个新字段（`source` / `externalId` / `agentId` / `status` / `description` / `dependsOn` / `artifacts` / `startAt` / `claimedAt`） | v0.6 | 4 | 就是上面四个基础落点；插在 `dueDate` 之后、`orderIndex` 之前 |
| `Member` 2 个新字段（`actorKind` / `agentKind`） | v0.6 | 3 | entities / backup memberSchema / `local.members.repo` insert 字面量；插在 `passwordHash` 之后、`revision` 之前。Member 无 project.service 落点 |
| `Task.taskNo` | v0.7 | **5** | 四个基础落点 **+ `project.service` 里还有一处独立注释**（见 `backup.service.ts:188` 注释，明写「五处逐字同序」）。⚠️ 常见疏漏：补了四处、漏了第五处；它紧接 `id` 之后 |
| `Task.assigneeIds` | v0.3 | 3（+project.service 默认字面量） | 插在 `assigneeId` 之后、`dueDate` 之前 |
| Project 链 `domain` / `kind` | v0.8 | 4 | entities.Project / backup projectSchema / **`local.projects.repo` insert 字面量** / `stage-fallback.normalizeProjectRow`（后两处分别在 `src/core/repositories/local/local.projects.repo.ts` 与 `src/core/template/stage-fallback.ts`） |
| Stage 链 `customColor`（连同 `templateKey` / `colorIndex`） | v0.8 | 4 | entities.Stage / backup stageSchema / **`project.service.stageRows` 字面量** / `stage-fallback.normalizeStageRow`（`src/core/template/stage-fallback.ts`）。⚠️ 第 ③ 处**不是 repo**，与 Project 链不同 |
| `Task.itineraryDate` | v0.9 旅游二期（代码注释口径） | 4 | 四个基础落点 + `payload.apply.ts`（隐性第 5 处）；插在 `dueDate` 之后、v0.6 九个字段之前 |

> ⚠️ 三条最易踩的非对称性：
> ① Project 链第 ③ 处走 **repo**（`local.projects.repo`），Stage 链第 ③ 处走
> **service**（`project.service.stageRows`）—— 不要照抄；
> ② `taskNo` 是**五处**，其余是四处、Member 是三处。新增字段时**先数落点，再插入**；
> ③ `payload.apply.ts` 是任何 Task 字段的隐性落点。

### 3.2 Dexie `stores()` 是整体替换

`version(n).stores()` **不是增量合并**——省写任何一个既有索引 = 静默丢索引
（不报错，未来 `.where()` 全表扫）。规则：

- **不要直接编辑 `DEXIE_STORES`**。现行做法是「**每个新版本只写增量**
  `DEXIE_V{N}_STORES`，再由 `DEXIE_STORES` 展开合并」——见
  `src/core/schema/current.ts`：

  ```ts
  export const DEXIE_STORES = {
    ...DEXIE_V1_STORES, ...DEXIE_V2_STORES, ...DEXIE_V3_STORES,
    itineraries: DEXIE_V4_STORES.itineraries,
    executions: DEXIE_V5_STORES.executions, /* …其余三张 v5 表… */
  };
  ```

  即：**新增版本 N** 的步骤是 ① 在 `dexie.database.ts` 加一行
  `this.version(N).stores(DEXIE_VN_STORES)`；② 在 `current.ts` 新增
  `DEXIE_VN_STORES` 并在 `DEXIE_STORES` 里展开；③ bump `SCHEMA_VERSION`。
  **历史版本的 `DEXIE_V{1..N-1}_STORES` 一律原样冻结，永不删除、永不改写。**
- 某个增量版本只列「相对上一版**索引有变化**的表」；未列出的表 Dexie 自动继承
  旧定义（写进来反而是易漂移的冗余）。凡是列出的表，其索引串必须**逐字包含**
  该表在全部历史版本里的索引项（v1 原串重写 + 新增项）。
- 当前版本的真实落点示例：v5 的增量写在 `DEXIE_V5_STORES`
  （executions / executionAttempts / executionEvents / writebackProposals 四张表，
  纯增量不动既有表）。
- 表集合完整性由 `tests/dexie-schema.guard.spec.ts` 守卫（13 张表一张不少 + 逐字
  比对含顺序）；
- `dexie.database.ts` 顶部注释为铁律原文。

### 3.3 序列化纪律（§9.2，本期最危险的坑）

| 字段类型 | 服务端 SQLite 通道 |
| --- | --- |
| `string[]`（assigneeIds / dependsOn） | `serializeJson` / `parseJsonArray<string>` |
| **对象数组（artifacts）** | **`serializeJson` / `parseJsonArray<TaskArtifact>`** |

**硬禁令**：对象/数组字段绝不经过任何含 `filter(x => typeof x === 'string')`
的函数——对象元素会被静默滤光写入 `'[]'`，无报错、无日志、数据无声消失。

守卫：`tests/arch-boundary.spec.ts` 断言 `serializeAssigneeIds` 调用行必须作用于
assignee 字段。⚠️ **扫描范围已从 `src/` 改为 `server/`**（spec `:113` 遍历
`server/`），白名单是 `server/lib/json-columns.ts`（spec `:112`）——因为
`serializeAssigneeIds` 现在定义在 **`server/lib/json-columns.ts:50`**
（内部已是 `serializeJson` 薄包装，但仍保留 string filter，故仍是硬禁令对象），
不在 `src/`。改这条守卫时别去 `src/` 里找。

### 3.4 `agentKind` 开放字符串铁律

`Member.agentKind` 是**开放字符串**：禁 `enum`、禁 `z.enum`、禁任何封闭枚举。
Harness 迭代极快，封闭结构 = 每接一个新 Agent 都要发版。UI 侧只提供 datalist
建议值（`AGENT_KIND_SUGGESTIONS`），输入框恒可自由填写。

### 3.5 `status` 唯一事实源

- 读：一律 `taskIsDone(t)`，禁止读取 `t.done`；
- 写：经 `withStatus(row, next)` 或 repo/route 内 `done = status === 'done'`，
  禁止单独写 `done`；
- UI 手动流转走 `task.service.assertTransition`（严格通道白名单）；
- payload 导入走宽松通道（直落 Agent 给定 status），此例外已在代码注释写明。

## 铁律：布局容器禁 `transition-all`（v0.8.5 立，排障手实测教训）

`transition-all` 会把 **width / height / margin / padding 全部纳入过渡**。定尺寸小控件
（按钮、色点）用它无害；但**布局容器**（随断点/内容变宽的卡片、面板）用它 = 跨断点
缩放时容器尺寸动画滞后于窗口，实测观感即「UI 挤在一起再回弹」（v0.8.5 她截图反馈）。

- 布局容器的过渡一律**显式列属性**：`transition-[transform,box-shadow]`（hover 悬浮载体）
  或 `transition-colors`（只变色的条带）。
- 2026-10-01 首个实例：`ProjectCard.tsx:287` 卡片本体（xl:flex-[1_1_340px] 变宽）。
  全仓其余 7 处 `transition-all` 经普查均为定尺寸小控件，保留。

## 铁律：新增用户可见内容须过行业中立化检查（v0.8.5 立）

ID Plan 是**全行业**排程工具（9 主板块 / 29 套套餐）。从单行业工具演进过来的
历史遗留（室内本位话术 / 示例 / 默认值）已由 `tests/industry-neutral-copy.spec.ts`
五锁盯防——但锁只覆盖已出现的坑，新文案靠这条纪律：

- **新增 / 修改**以下内容前，先问「这句话换个行业还成立吗」：
  UI 文案与 placeholder、示例数据、元数据（index.html / package.json）、
  安装文档、引导流程默认值
- 示例一律中性（「某某项目・第一阶段」，不写具体行业场景）；行业名本身
  （室内设计 / 软件开发…）作为合法名称可用，**行业本位定位话术不可**
  （「设计师的工具」「餐饮坪效」这类默认读者是某一行的表述）
- README 缘起叙事（从室内设计日常工作长出来）是已批准的例外，写死在 spec 注释
- 验收：`npx vitest run tests/industry-neutral-copy.spec.ts` 必须绿
