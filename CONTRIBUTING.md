# Contributing · 持久化与桌面层铁律

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

## 2. 永不引入 `electron-updater`（P1-2，架构红线）

**本项目永不引入 `electron-updater`**，包括其任何封装（electron-builder 自带的
autoUpdater 通道同样禁用）。

理由：

1. **强绑定**：autoUpdater 把「打包格式（NSIS/appimage）、更新源（GitHub/
   自建 latest.yml）、签名校验」全部锁死在 Electron 生态——一旦引入，换壳
   期权（Tauri / 纯 Web / MSIX）即报废，重写成本高于重做。
2. **更新通道自主权**：ID Plan 的更新检测走自有 GitHub Release 比对
   （`src/hooks/useUpdateCheck.ts`，读 `version.json` 四段号），提示后由用户
   手动下载。这保持了「本地软件、用户自管」的产品人格。
3. **安全面**：autoUpdater 静默替换二进制 = 一个远程代码执行通道。单人开发
   者项目不值得为此背签名基础设施与供应链审计成本。

若未来需要应用内升级：先改本文件（架构决策变更），再评估「下载器 + 用户
确认安装」的最小通道——仍然不是 electron-updater。

## 3. 持久化层编码铁律（P1-5）

### 3.1 键序铁律

`Task` 9 个新字段（v0.6）与 `Member` 2 个新字段的**键顺序**，在以下位置必须
**逐字一致**：

- `src/core/types/entities.ts`（interface 声明）
- `src/core/services/backup.service.ts`（zod schema + normalize 返回字面量）
- `src/core/repositories/local/local.tasks.repo.ts`（insert 行字面量）
- `src/core/services/project.service.ts`（建档 taskRows）

违反后果：`backup.roundtrip.spec` 的 JSON.stringify 逐表 diff 失败，且报错
信息极难定位。新增字段时四处同步插入同一位置。

### 3.2 Dexie `stores()` 是整体替换

`version(n).stores()` **不是增量合并**——省写任何一个既有索引 = 静默丢索引
（不报错，未来 `.where()` 全表扫）。规则：

- 改索引必须改 `src/core/schema/current.ts` 的 `DEXIE_STORES`（单一出处），
  同时**逐字保留**上一个版本索引串的全部内容；
- 表集合完整性由 `tests/dexie-schema.guard.spec.ts` 守卫；
- `dexie.database.ts` 顶部注释为铁律原文。

### 3.3 序列化纪律（§9.2，本期最危险的坑）

| 字段类型 | 服务端 SQLite 通道 |
| --- | --- |
| `string[]`（assigneeIds / dependsOn） | `serializeJson` / `parseJsonArray<string>` |
| **对象数组（artifacts）** | **`serializeJson` / `parseJsonArray<TaskArtifact>`** |

**硬禁令**：对象/数组字段绝不经过任何含 `filter(x => typeof x === 'string')`
的函数——对象元素会被静默滤光写入 `'[]'`，无报错、无日志、数据无声消失。
守卫：arch-boundary.spec 断言 `serializeAssigneeIds` 调用行必须作用于 assignee
字段。

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
