# REST API 契约（api-contract.md）

> remote 适配器与服务端必须逐一对齐本契约。约定先行：前端 remote adapter（T05）与本 server/ 实现同源开发。
> 统一前缀 `/api`；除标注外均为 JSON `Content-Type`。
> 错误响应统一形状：`{ "error": { "code": string, "userMessage": string } }`，HTTP 状态码仅用于网络层语义。

## 资源命名与 ID

- 前缀规范（`src/lib/id.ts:4-15` 的 `IdPrefix` **全集**）：
  `proj_` / `stg_` / `tsk_` / `mem_` / `log_` / `ctt_` / `art_` / `cst_` + uuid 片段（客户端生成，服务端信任）。
  - `art_` = artifacts 条目；`cst_` = 自定义阶段库条目（存 settings KV `customStages`，**不新建表**）。
- ⚠️ **前缀规范的例外（对接时必须知道）**：`itineraries` 与 Agent 执行域四张表
  （`executions` / `execution_attempts` / `execution_events` / `writeback_proposals`）
  **不走 `createId`** —— 服务端直接用裸 `crypto.randomUUID()`，因此**没有** `itn_` / `exe_` 前缀
  （`server/routes/itineraries.routes.ts:71`、`:93`）。不要对这两类 id 做前缀校验：
  `looksLikeId()` 对它们返回 `false`，但它们是合法 id。

## 时间口径

- 全部时间字段为 UTC ISO 8601 字符串；日期粒度字段允许 `YYYY-MM-DD`。

---

## Projects

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/projects?status=&keyword=` | 列表，query 可选 |
| GET | `/api/projects/:id` | 详情 |
| POST | `/api/projects` | 新建（body=CreateProjectCmd & {id?}），返回完整 Project |
| PATCH | `/api/projects/:id` | 更新（body=UpdateProjectCmd 子集） |
| POST | `/api/projects/:id/archive` | body `{archived: boolean}` → `{ok:true}` |
| DELETE | `/api/projects/:id` | **永久删除**（不可恢复）：单事务级联清理 `stage_logs` / `assignments` / `tasks` / `stages` / `itineraries` 后删项目；不存在 → 404 `not_found`；否则 `{ok:true}` |

## Stages

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/projects/:projectId/stages` | 项目九阶段 |
| GET | `/api/stages/:id` | 详情 |
| POST | `/api/stages/bulk` | `{rows: Stage[]}` 批量插入（建档事务由服务端单一事务包裹） |
| PATCH | `/api/stages/:id` | UpdateStageCmd 子集 |
| POST | `/api/stages/:id/reschedule` | `{startAt,endAt,status?}` |

## Itineraries（旅游每日行程卡）

日期卡独立于任务，项目内 `date` 唯一。行形状（服务端 `rowToItinerary`）：
`{ id, projectId, date, transport, accommodation, budgetAmount, actualAmount, revision, updatedAt }`；
`transport` / `accommodation` 为 `string | null`；`budgetAmount` / `actualAmount` 为 `number | null`
（`null` / `''` / 数字字符串均可，其它一律 400）；`date` 为 `YYYY-MM-DD`。

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/projects/:projectId/itineraries` | 项目每日行程卡列表，`ORDER BY date, id`；项目不存在返回 `[]`（**不 404**） |
| POST | `/api/projects/:projectId/itineraries/ensure` | body `{startDate, endDate}`：按日逐日 `INSERT OR IGNORE` 补卡，**只补不删**（已存在的日期原样保留，含其已有内容）；起止日期非法或 `startDate > endDate` → 400 `validation`；成功返回该项目**全量**卡列表 |
| POST | `/api/projects/:projectId/itineraries` | 新建单日卡（body：`date` 必填，`transport` / `accommodation` / `budgetAmount` / `actualAmount` 可选）；`date` 非 `YYYY-MM-DD` → 400 `validation`；金额非法 → 400 `validation`；该日期已有卡 → **409** `conflict` |
| PATCH | `/api/itineraries/:id` | 可改 `transport` / `accommodation` / `budgetAmount` / `actualAmount`；每次改动 `revision + 1` 且刷新 `updatedAt`；不存在 → 404 `not_found`；金额非法 → 400 `validation`。**`date` 与 `projectId` 不可改** |
| DELETE | `/api/itineraries/:id` | 删除（**不校验存在性**），响应 `{ ok: true }`；删项目时由 `DELETE /api/projects/:id` 级联清理 |

> **旅游二期归档结论（2026-09-30 · 0.8.4）**：曾有两种二期候选——① 放宽 20 段上限；
> ② 行程卡模式。裁决：**维持行程卡模式，不动 20 段上限**。理由：20 段是 9 色色板 +
> 时间轴可读性的真实约束（v0.8 PRD §7），为长行程放宽它会让甘特整体退化；长行程的
> 正确形态是**行程卡按日承载**（每日一张 `date` 唯一卡，`ensure` 只补不删），它与
> 阶段时间轴是两个正交维度——阶段管合同工期，行程卡管每日执行。将来若做「按周汇总」，
> 以 `ensure` 之上的**读取侧聚合**实现，不改写入模型。

## Tasks

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/tasks?projectId=&stageId=&assigneeId=&done=&source=&agentId=&status=&externalId=` | 组合过滤（v0.6 扩展；`status` 支持逗号分隔多值） |
| GET | `/api/tasks/:id` | 单条任务（v0.6；404 → 统一错误体） |
| POST | `/api/tasks/bulk` | `{rows: Task[]}` |
| POST | `/api/tasks` | CreateTaskCmd → Task |
| POST | `/api/tasks/upsert` | **v0.6 幂等批量写入**：`{rows: TaskUpsertRow[]}` → `{created, updated}`。按 `externalId` 先查后写，单事务；**绝不接受请求体的 done**（恒由 status 派生）；`orderIndex` 仅新建语义 |
| PATCH | `/api/tasks/:id` | UpdateTaskCmd 子集 |
| POST | `/api/tasks/:id/claim` | **v0.6 原子认领**：`{actorMemberId}` → Task。仅 `status='ready'` 且 `claimedAt=null` 可认领；冲突/非就绪 → **HTTP 409**（客户端翻译为 `ChangxiaError(Conflict)`） |
| DELETE | `/api/tasks/:id` | 删除单条任务 |

## Members

| Method | Path | 说明 |
| --- | --- | -- |
| GET | `/api/members?includeInactive=1` | 列表 |
| GET | `/api/members/:id` | 详情 |
| POST | `/api/members` | CreateMemberCmd → Member |
| PATCH | `/api/members/:id` | UpdateMemberCmd 子集 |
| POST | `/api/members/verify` | 密码校验：body `{memberId, password}` → 200 `{ok:true, memberId}`；无此成员 / 已停用 / 密码为空 / 校验失败 → **401** `unauthorized`（统一文案「密码错误」，避免枚举成员）。**哈希不出库**，比对在服务端 scrypt 完成 |

## Logs（append-only）

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/logs/stage` | append StageLog（body 无 id/createdAt，服务端补） |
| GET | `/api/stages/:stageId/logs` | 按阶段查流水 |
| GET | `/api/projects/:projectId/logs` | 按项目查流水 |
| POST | `/api/logs/assignments` | append AssignmentLog |
| GET | `/api/tasks/:taskId/assignments` | 按任务查指派流水 |

## Contracts

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/contracts` | insert（body 可含 id） |
| GET | `/api/contracts/:id` | 详情 |
| POST | `/api/contracts/:id/link-project` | `{projectId}` |
| POST | `/api/contracts/:id/confirmed-payload` | `{confirmedJson}` |
| GET | `/api/contracts` | 全量列表 |

## Settings

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/settings` | 全量 KV |
| GET | `/api/settings/:key` | 单键 valueJson |
| PUT | `/api/settings/:key` | `{valueJson: unknown}` upsert |
| POST | `/api/settings/replace-all` | 备份导入用整表替换 |

## Backup / Bootstrap

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/backup` | 导出 BackupPackage JSON：`{ meta: { app:'changxia', schemaVersion:3, exportedAt }, data: { …9 张表 } }`（导入侧同时接受 1/2/3，**导出恒为 3**） |
| POST | `/api/backup/import` | 服务端整库替换（单事务）；body `{ data: { <表名>: rows[] } }`；响应 `{ok, renumbered}`（见下） |
| POST | `/api/bootstrap` | 启动全量装载：一次性返回**同样那 9 张表**（等价本地 Dexie 全表扫描），**不鉴权**（V1 待纳入） |

### ⚠️ 「全量」只覆盖 9 张表 —— 两侧不对称，按文档对接前必读

`GET /api/backup`（`meta.routes.ts:398-407`）与 `POST /api/bootstrap`（`:417-425`）的 dump 清单**逐字一致**，
只有这 9 张表：`projects` / `stages` / `tasks` / `itineraries` / `members` / `assignments` /
`logs`（实际表名为 `stage_logs`）/ `contracts` / `settings`。

**不在**清单里的四张表：`executions` / `execution_attempts` / `execution_events` / `writeback_proposals`。

- 现状：这四张表在 `server/schema.sql`（L187 起，含索引）**已建表**，但服务端**没有任何 `/api/` 端点**操作它们。
  Agent 执行域第一切片**只落地本地 Dexie 适配器**，远端适配器 `RemoteExecutionsRepository`
  （`src/core/repositories/remote/rest.client.ts:365` 起）逐方法抛明确的「尚未实现」错误。
- **后果（真实的两侧不对称）**：remote（NAS）模式下这四张表的数据**只存在本地 Dexie**，
  既不进 `/api/backup`，也不进 `/api/bootstrap`。**不要假定 NAS 备份是全量的** ——
  执行域数据在服务端落地前，只随本地库存在，换机/清库即丢。
- 未来为执行域补服务端 REST 端点时，**必须同时**把这四张表加进上面两处 dump 清单，
  并复刻本地适配器的存储边界强制（否则状态机只在前端成立）—— 见 `rest.client.ts` 该桩的注释。
- ⚠️ **与 `docs/backup-format.md` 的口径差异（不是矛盾，是两条不同通道）**：
  本地导出的 zip 备份包（`schemaVersion` 5，`backup.service.ts`）**含**执行域四表；
  而本文件的 `/api/backup`（服务端 NAS 通道）**不含**。对接时先分清走的是哪条通道。

## Agent 通道（`/api/agent/*`）—— 已实现

**四个端点，全部由 `requireAgentToken()` 守门**（`server/lib/agent-auth.ts:138`），
env 为 **`IDPLAN_AGENT_API_TOKEN`**（`AGENT_API_TOKEN_ENV`，`agent-auth.ts:107`），
与备份通道的 `IDPLAN_AGENT_TOKEN` **相互独立、可分别轮换/吊销**。鉴权规则与备份通道同语义：
请求头 `X-Agent-Token` 或 `Authorization: Bearer <token>` 二选一、常量时间比较、
**fail-closed**（env 未配置 → 四个端点全部 401，启动日志打印 `[IDPLAN-SECURITY]` 告警）。

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/agent/import` | 幂等导入 Agent payload（`requireAgentToken`；`agent.routes.ts:246`）。query 契约见下 |
| GET | `/api/agent/health` | 探活（`agent.routes.ts:419`）：`{ ok:true, version, projects, agentSeats: {used, limit} }`。`version` 读 **`version.json` 的四段号**（不取 `package.json` 的 semver；读失败回落 `'unknown'` 而不 500）；`projects` **只列 `kind='human'`**；`agentSeats.limit` = `AGENT_SEAT_LIMIT`（当前 **3**） |
| GET | `/api/agent/tasks` | 只读任务流（`agent.routes.ts:438`）：query `?projectId=&source=`；响应 `{ tasks: [{ externalId, taskNo, title, status, dueDate, dependsOnExternal }] }`。详见下 |
| POST | `/api/agent/boards` | 建 Agent 看板（`kind='agent'`）含阶段骨架（`agent.routes.ts:530`），**只新建**；成功 → **201**。详见下 |
| POST | `/api/agent/commands?dryRun=1` | 结构化命令通道（v0.8.5 方案 3）：当前 `reschedule_stages` 调期。详见下 |
| POST | `/api/agent/nl-execute?dryRun=1` | 自然语言通道（v0.8.5 方案 2，opt-in）：三 env 配齐才启用，fail-closed。详见下 |

### `POST /api/agent/import` —— query 契约与错误码

- body 为 `idplan-agent-payload/v1` schema（**不因通道改动**）；落点名走 query 而非 body，
  正是为了让仓外既有 Skill 的产物继续可用（改 body schema 会让它们在严格校验下失效）。
- query：`stageName`（落点阶段名，同义别名 **`createStageIfMissing`**）、`stageId`（**批次级覆盖**，
  优先于 body.stageId）、`projectId`、`projectName`、`dryRun`。
- 互斥与「出现但空」：**落点名与 `stageId` 不可同传** → 400 `invalid_field`；
  `stageName` / `createStageIfMissing` 出现但为空或纯空白 → 400 `invalid_field`
  （**绝不静默降级为「未声明」**，否则调用方的 bug 会被掩盖成「任务落到了别的阶段」）；
  两个别名同传且**取值不同** → 400 `invalid_field`（同值则接受）。
- 项目解析（fail-closed）：body.projectId 与 `?projectId` 同传且**不一致** → 400 `Validation`，
  **绝不发生任何写入**；两者一致或仅一方给出 → 取该 id；都未给出 → 走 `?projectName`
  （先精确匹配，再「去空白 + 忽略大小写」）；仍解析不到、或 id 在库里不存在 → 400 `project_unresolved`，
  响应体**额外**带 `projects` 候选清单（只列 `kind='human'`）。
- `?dryRun` 判定**偏向安全**：出现且不是 `'0'` / `'false'` 即按「只算不写」处理（`?dryRun=true` 也算预览）。
- 回执**原样转发** `ApplyResult`（与前端手动粘贴通道共用同一份 `payload.apply.ts`），
  服务端不做二次加工 —— 保证 NAS 与本地两条通道得到同一答案。
- body 超过 `bodyLimit` → 400 `too_large`（本作用域错误处理器把 HTTP 413 映射为契约的 400）。
- 错误码集合：`Validation`（payload schema / 项目解析）、`invalid_field`（query 契约）、
  `project_unresolved`、`too_large`、`internal`；401 为 `Unauthorized`。

### `GET /api/agent/tasks` —— 只读任务流

- `?projectId=` 与 `?source=`：只有 `source === 'agent'` 或 `'human'` 才会作为过滤条件透传，
  **其它值（含 `all`）与缺省一律不过滤**；内部委托既有 `GET /api/tasks`（`app.inject` 进程内派发），
  故过滤口径与行→实体映射与 `/api/tasks` **完全一致**（不抄第二份映射）。
- `dependsOnExternal` 给的是依赖任务的 **externalId**（库内 `dependsOn` 存的是 Task.id，
  服务端做一次反查）；解析不到 externalId 的依赖（人工任务没有幂等键）**从结果里剔除**。
  `externalId` / `taskNo` 在人工任务或老数据上可能为 `null`。
- 委托返回非 2xx → 500 `internal`（不把上游状态码直接透出）。

### `POST /api/agent/boards` —— 建板契约（只新建）

- 请求体：`{ name, plannedStartAt, plannedEndAt, presetKey?, stageNames? }`。
- **只新建**：出现 `projectId` / `projectName` → 400 `invalid_field`（要往已有项目写任务请用 `/api/agent/import`）。
  「写进人类项目」在本端点**没有代码路径**：新看板 id 由既有 `POST /api/projects` 在服务端生成（本 handler 不传 id）。
- 校验顺序（fail fast，全部通过才开始写，失败路径零残留）：token → 401；`name` 缺失/空白 → 400；
  起止日期缺失/空白 → 400（**绝不替你猜一个日期**）；`presetKey` 与 `stageNames` 都没给或都为空 → 400；
  `presetKey` 库里查不到 → 400；展开后阶段数 > `MAX_STAGE_COUNT`（**20**）→ 400。
- 阶段来源的**唯一数据源** = `templates/stage-library.json`（当前 version 3，**29 套套餐 / 74 个阶段项**，
  另有 9 个 domain、7 个 industryGroup）。`presetKey` 先展开套餐骨架（并以套餐声明的 `domain` 作为项目主板块），
  再追加 `stageNames` 声明的名字；名字不在库 → 自定义阶段（`templateKey` 落 `null`，**不伪造 key**）；
  请求内按 `normalizeStageName` 去重，保留首次出现（归一值**只用于判重、绝不入库**）。
- 阶段起止日一律取**项目基线**（本端点不声明阶段级日期，凭空切分属于猜测）；建板**不建** `defaultTasks`
  （任务由后续导入通道喂进来）。纯 `stageNames` 建板时 `domain` / `stagePresetKey` 落 `null`（不猜）。
- 响应（**201**）：`{ projectId, name, stages: [{ id, name, templateKey }] }`。
- ⚠️ 代价（如实记录）：建项目走 `app.inject`（异步）无法并入 better-sqlite3 的同步事务，
  故「建项目 → 建阶段」**不是单事务**；阶段写入失败返回 500 时可能残留一个无阶段的空 agent 看板，
  **不影响任何人类项目**。

## 备注

1. 服务端不实现"切分算法"端点——切分是纯函数驻留前端。**建档（含 Agent 建板）的阶段数据源**是
   `templates/stage-library.json`（version 3：**29 套套餐 / 74 个阶段项**，另含 9 个 domain 与 7 个 industryGroup），
   服务端消费点 `agent.routes.ts:69-74`（`getPreset` / `getPresetItems` / `getStageLibraryItems` / `getStageLibraryVersion`）。
   同包的 `templates/nine-stages.default.json` **仍保留**，但只作为老数据 `templateKey` 的反查源
   （`src/core/template/stage-fallback.ts:48`），**不再是建档主力数据源**。
   ⚠️ 套餐/阶段项数以该 JSON 文件为准：`agent.routes.ts` 文件头注释里的「18 套餐 / 56 阶段项」**已过时**。
2. 认证本期为局域网信任；rest.client.ts 已预留 `Authorization` header 位。
3. revision 由服务端写路径统一 bump；updatedAt 为 UTC ISO string。

## v0.6 错误码映射（rest.client.request）

| HTTP | ChangxiaErrorCode | 场景 |
| --- | --- | --- |
| 404 | `NotFound` | 资源不存在（GET /tasks/:id 由适配器回落 null） |
| 409 | `Conflict` | 认领争抢 / 非 ready 认领 / 幂等键冲突 |
| 其余 4xx/5xx | `Network` | 保持既有行为 |

## tasks 表 v0.6 新增字段（同步 payload 导入）

`source('human'|'agent')` / `externalId`(幂等键，唯一) / `agentId` / `status`(7 值，
唯一事实源，done 恒 = status==='done') / `description` / `dependsOn`(JSON 数组，
与 assignee_ids 同走 JSON 列序列化) / `artifacts`(对象数组 JSON 列) / `startAt` /
`claimedAt` / **`taskNo`** / **`itineraryDate`**。Agent 幂等写入唯一出口 = `POST /api/tasks/upsert`。

- `taskNo`：`INTEGER`，**仓储分配字段**（展示用 + 全量归约求最大值；刻意无索引）。
  请求体里带的 `taskNo` **一律被忽略**，号由服务端分配；老数据可能为 `null`。
- `itineraryDate`：`YYYY-MM-DD` 或 `null` —— **旅游行程归属日**（`src/core/types/entities.ts:91-96`），
  仅 travel 项目使用；`null` = 普通任务或尚未排入某日。与 `dueDate` **分工严格区分**：
  `itineraryDate` 决定「行程第几天」，`dueDate` 仍是任务截止日。

## 备份通道鉴权（v0.6 · T14，Q9）

| 端点 | 鉴权 | 脱敏 |
| --- | --- | --- |
| `GET /api/backup` | ✅ `X-Agent-Token` 或 `Authorization: Bearer`（值 = 服务端 env `IDPLAN_AGENT_TOKEN`，常量时间比较） | 默认 members 脱敏：`passwordHash=null` + `hasPassword` 布尔；`?includeSecrets=1` 持 token 才下发真实哈希（NAS→NAS 整机迁移专用） |
| `POST /api/backup/import` | ✅ 同上 | —（导入不回传敏感值） |
| `POST /api/bootstrap` | ❌ 本期不鉴权（前端启动全量装载依赖它；**V1 必须纳入鉴权**，§10-R7） | ✅ members 同规则脱敏（Q-D 拍板） |

- **fail-closed**：服务端未配置 `IDPLAN_AGENT_TOKEN` 时，`/api/backup*` 全部 401。启动日志有醒目告警。
- 前端 remote 模式配置 `VITE_API_TOKEN`（与上同值）即自动携带 `Authorization: Bearer`。
- 导入侧检测「`hasPassword===true` 且 `passwordHash===null`」→ 恢复确认弹窗警示「此备份不含密码，导入后成员需重设密码」。
- 服务端导入通道自动剔除 `hasPassword`（导出侧派生字段，非表列）。
- **导入响应体**：`{ ok: true, renumbered: <number> }`
  - `renumbered` = 本次导入因**包内**号段自身冲突（同一个 `taskNo` 出现多次）被
    重编号的任务条数；口径是「保留先到者、后到者重编号」，正常包恒为 `0`。
    与 local（Dexie）路径**同一个答案** —— 两侧共用 `src/core/lib/task-no.ts`
    的 `resolveTaskNoCollisions`（§2.9.1），不存在第二份实现。
  - `ok` 是兼容老客户端的保留字段（老 NAS 前端只读它），**不得移除**；
    `renumbered` 为 v0.7 新增字段，老服务端不返回它 —— 前端按「缺字段回落 0」兼容。
  - 导入事务内**同时**按「三者取最大」追平 `settings.taskNoSeq`
    （包内 `max(task_no)+1` / 包内 `taskNoSeq` / 导入前**本地** `taskNoSeq`），
    保证导入后新建任务不复用已被（导入前本机或包内）占用的号。
    漏任一项都存在真实可达的撞号路径，见 `resolveTaskNoCollisions` 函数头注释。

## ⚠ Agent HTTP API 边界（写死，勿越）—— 已落地，不是待办

**Agent 通道绝不复用 `/api/backup`**，这条边界**已经实现**（不再是「未来」）：

- **独立端点**：全部挂在 `/api/agent/*`（四个端点，见上文「Agent 通道」一节）——
  `/api/agent/import`、`/api/agent/health`、`/api/agent/tasks`、`/api/agent/boards`。
- **独立 Token**：`AGENT_API_TOKEN_ENV = 'IDPLAN_AGENT_API_TOKEN'`（`server/lib/agent-auth.ts:107`），
  与备份通道的 `IDPLAN_AGENT_TOKEN` 分离，**可独立轮换/吊销**。两者必须分别配置：
  泄露面不同（备份密钥 = 整库 dump 含密码哈希；Agent 密钥 = 日常写入，会配置在多台机器上），
  吊销任一方都不应连带打死另一方。
- **独立闸门**：`requireAgentToken()`（`server/lib/agent-auth.ts:138`，与备份通道的
  `requireToken()` **同语义、不同 env**）；`requireToken` **一个字节都没有为它改动**
  （它仍是 `/api/backup*` 的唯一闸门）。新增能力一律走新增函数。
- **四个端点逐字走该闸门**：`agent.routes.ts:246`（import）/ `:419`（health）/ `:438`（tasks）/ `:530`（boards）。
- **授权面不等价**：备份 token 只授权「整库读写」；Agent token 授权「按既有 upsert 通道写任务 + 建 agent 看板」，
  且候选清单与 `?projectName=` 解析**只列 `kind='human'` 项目**（`agent.routes.ts:201`），
  `POST /api/agent/boards` 又**只新建** `kind='agent'` 看板 —— 两侧互不越界。
  （独立限流尚未实现，属 V1 待办。）

**维护纪律（新增端点时必守）**：`agent-auth.ts` 的启动告警文案**逐字列出了四个端点名**。
**新增 `/api/agent/*` 端点时，本行必须同批更新** —— 漏一个端点，该端点的 401 在启动日志里
就没有任何线索，调用方只会看到「ID Plan 未运行」这种**假无响应**（V1-13 要防的正是这个）。
定期以**实际注册**为准核对（不以人记为准）：

```
grep -n "scope\.\(get\|post\|put\|patch\|delete\)('/api/agent" server/routes/agent.routes.ts
```

## artifacts 校验口径：payload 通道 vs backup 通道（刻意不同，勿当 bug 修）

| 通道 | artifacts 条目校验 | 理由 |
| --- | --- | --- |
| **payload 导入**（Agent 写入，前端 zod） | 缺 `kind` **静默补 `'other'`**；缺 `id` 结构不符**直接拒绝** | Agent 是宽松通道的上游事实源（§9.3）：kind 是展示语义、可前向兼容（新 kind 值不因旧前端拒绝）；而 id 是 artifacts 追踪的主键，缺了等于产出台账失真，宁可拒条目让上游修 |
| **backup 导入**（人类备份恢复，前端 zod） | 同上口径（id 必填 / kind 缺省 'other'） | 备份的 artifacts 必然来自 payload 通道写入或 UI 编辑，形状已归一；同口径保证 roundtrip 无损 |

**为什么不同 ≠ 疏忽**：payload 是「机器→机器」的增量事实流（宽松宽容、逐条拒绝），
backup 是「人→机器」的全量恢复（形状已定、严格保真）。前向兼容只给 kind 这类
纯展示字段，不给主键。

## 桌面 loopback 通道口径（v0.8 · 2026-09-28 走查后补）

桌面形态（默认）走 Electron 主进程的 loopback server（`electron/loopback.cjs`，绑
`127.0.0.1:17788`，**不对外暴露**）。四个端点与上节服务端同构，但以下口径**刻意不同**，
对接前先分清自己打的是哪条通道（判别法：看 health 回包有没有 `dataLayer`——有 = 桌面）：

| 维度 | 桌面 loopback | 服务端（NAS） |
| --- | --- | --- |
| health 鉴权 | **免令牌**（`loopback.cjs` handleHealth 无 token 门） | `requireAgentToken()` |
| health 回包 | `{ ok, version, dataLayer }`（dataLayer 为渲染进程 ping/pong 真实判定，非窗口存在性） | `{ ok, version, projects, agentSeats }` |
| CORS | 全响应带 `Access-Control-Allow-Origin: *`（面板探测是跨源 fetch；loopback 绑本机 + 写有令牌门，放开不新增攻击面） | 由部署层决定 |
| 落点参数 | `?projectId=`（契约名）或 `?project=`（v0.8 面板历史别名）二选一，同传须同值；body.projectId 同样认 | `?projectId=` / `?projectName=` |
| 落点阶段名 | `?stageName=` 或同义别名 `?createStageIfMissing=`（同传须同值）；与 `?stageId=`/body.stageId 互斥 | 同左 |
| dryRun | 出现且非 `''`/`'0'`/`'false'` 即预览（**偏向安全**） | 同左 |
| 写落点 | 经 IPC 转发渲染进程落库（主进程不碰 Dexie） | Fastify 直查 SQLite |
| boards 校验 | 与建板对话框同源的 `ProjectService.createAgentBoard`（name/起止日期/阶段集合 fail-fast） | 路由内同等校验 |
| 不存在 projectId 读侧 | 400 `project_unresolved` | 200 空列表（刻意语义） |

**接入入口**：本机档优先读接入文件（默认 `%USERPROFILE%\Documents\ID Plan\agent-ingress.json`，
内容 = 地址 / 令牌 / 四端点 / payload schema / 用法；令牌轮换后重新读取即可）。
指令块兜底在 ID Plan 接入面板「复制接入指令」。

**错误码**：桌面把内部异常映射为契约码后回传——import 参数/结构类错误 → `Validation`
（字面，与服务端一致）；boards 字段类 → `invalid_field`；落点不存在/非 Agent 看板 →
`project_unresolved`（共享核心单码，两通道同源）。

## WorkBuddy 接入 skill 同步基线

本仓库 `docs/` 之外的接入指引还有一份：WorkBuddy 侧 skill
`idplan-agent-loopback`（记录接入实测方法与坑位，位于用户 skill 目录、**不在本仓库**）。

**已知漂移史**：该 skill 曾在 0009 前长期停更（如坚持「落点键名两通道不一致」，而 `73abe87` 已对齐；dryRun 只认 `'1'/'true'`，而契约偏安全早已两通道统一）。skill 不在仓库、无 CI 看守，漂移只能靠人记得——这是结构性问题，暂时只能登记不能根治。

**同步基线（每次发版核对这一行）**：

| 项 | 基线值 |
|---|---|
| skill 最后对齐的构建号 | `0.8.1.0001`（2026-09-29 回写：键名/0010 query 契约/dryRun 真值矩阵/X-Agent-Token/source） |
| 本仓库契约权威文档 | 本文档（api-contract.md）+ `src/core/agent/ingress-file.ts` 的 `INGRESS_ENDPOINTS` / 指令块构造函数 |
| 纪律 | 发版 checklist 增加一行「skill 口径 vs 本文档逐条过」；若将来 skill 收编进仓库源管理，此节作废 |


### `POST /api/agent/commands` —— 结构化命令通道（v0.8.5 · 方案 3）

**设计动机**：雯丞 2026-10-01 拍板「AI/agent 用自然语言建档、调期」的落地形态 =
**结构化意图 API（方案 3，零 LLM）**：AI 方自己把自然语言解析成带类型的结构化命令
调我们；服务端永不解析自然语言、永不调 LLM（零 key 托管 / 零 prompt injection /
用户数据不出机器）。MCP 与服务端 LLM 两条路经比选否决（供应链信任模型 / key 与
injection / 数据出境），详见 `deliverables/gstack/security-review-idplan-v085-2026-10-01.md`。

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/agent/commands?dryRun=1` | 执行结构化命令；query `dryRun` 与 import 同保守语义（非 `0`/空/`false` 即预览）。`requireAgentToken`（fail-closed） |

**当前命令（唯一）：`reschedule_stages`（调期）**

```json
{
  "command": "reschedule_stages",
  "projectId": "proj_xxx",
  "shiftDays": 14,
  "stageKeys": ["software.dev", "software.qa"],
  "reason": "甲方确认延迟"
}
```

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `command` | 字面 `"reschedule_stages"` | 必填 |
| `projectId` | string | 必填。**归属门**：目标必须 `kind='agent'`；人类项目/不存在 → 400 `project_unresolved`（附候选清单） |
| `shiftDays` | int | ±365 封顶（超出视为笔误拒绝，不替调用方猜） |
| `stageKeys` | string[]? | 按 `templateKey` 过滤；未知 key 进响应 `unmatchedKeys` 反馈（不静默）。缺省 = 全部可见且未完成段 |
| `reason` | string? | 写入留痕日志（截止日后移时必填的闸门由既有 reschedule 承担） |

**响应（两态）**：

```json
{ "mode": "dry_run", "projectId": "proj_xxx", "shiftDays": 14,
  "wouldShift": [{ "stageId": "stg_x", "name": "开发", "from": {"startAt":"2026-10-05","endAt":"2026-10-11"}, "to": {"startAt":"2026-10-19","endAt":"2026-10-25"} }],
  "skippedCompleted": 1, "unmatchedKeys": [] }
{ "mode": "applied", "projectId": "prox_xxx", "shiftDays": 14, "shifted": 2, "skippedCompleted": 1, "unmatchedKeys": [] }
```

**硬语义**：
- **completed 阶段永不平移**（历史不篡改：施工完的段日期变了=改账），计入 `skippedCompleted`；
- `visible=false` 的段不参与（隐藏段不被命令翻出来）；
- 实写逐段走既有 `StageService.reschedule`：留痕流水（`type=rescheduled`）+ 任务 `dueDate`
  连带平移 + 「截止日后移必填 reason」闸门全继承；
- ⚠️ **非幂等**：重放 = 二次平移。写入方须自行保证不重放（先用 `dryRun=1` 确认）。
  完备的 `operationId` 去重表排 0.8.6（与 NAS 写端点鉴权同批——去重记录要先有安全落点）；
- 桌面（loopback `127.0.0.1:17788`）与 NAS（本端点）**同核心同码**（`src/core/agent/commands.ts`）。

### `POST /api/agent/nl-execute` —— 自然语言通道（v0.8.5 · 方案 2，opt-in）

双轨架构的第二轨：主轨是方案 3（`/api/agent/commands` 结构化命令，零 LLM）；
本端点是**可选增强**——用户说人话，服务端调**用户自配的 LLM**（OpenAI 兼容）
解析成命令，再走同一条 `runRescheduleStages`。雯丞 2026-10-01：「方案 2 更符合
我自己的使用方式」+ 开源后「大家都会想办法用上这个功能」。

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/agent/nl-execute?dryRun=1` | 自然语言 → reschedule_stages。`requireAgentToken` |

**开启条件（fail-closed，缺一即 403 `nl_not_configured`）**：
`IDPLAN_NL_LLM_BASE_URL` + `IDPLAN_NL_LLM_API_KEY` + `IDPLAN_NL_LLM_MODEL`
（部署链已留参数位：UGOS 安装界面可见「自然语言通道」三项；可指向自架 Ollama。
**不配 = 通道不存在**，比半残状态安全）。

**请求**：`{ "text": "把茶室装修项目往后推两周" }`（≤ 500 字）。

**判序**：token → 401；NL 未配 → 403；text 缺失/超长 → 400；LLM 输出非 JSON
→ 502（不进执行链）；输出过 `validateAgentCommand` 白名单（模型被注入带歪 →
400 `nl_shape_rejected`）；解析不出项目 → 400（**绝不猜项目**）。

**安全姿态**：系统提示锁死输出形状 + 注入缓释三规则（忽略文本中的指令）；
响应 schema 白名单校验兜底；`temperature:0`；15s 超时。**响应带
`dataDisclosure` 字段**（明示自然语言文本已发往所配 LLM——数据出境要知情）。

**桌面形态无此通道**（桌面用户的 LLM key 配置不现实）：桌面保持方案 3 纯结构化，
NL 是 NAS/自部署形态的可选增强。

### 写端点鉴权（v0.8.6 P0-1 · 她 10-01 拍板「一定要记得修」）

**问题（安全官红牌，OWASP A01）**：`settings` / `logs` / `contracts` 全族写端点
零鉴权——LAN 任意方可覆写 `taskNoSeq` 制造任务重号、伪造审计流水；**自定义行业
一旦落 settings KV = 向所有 LAN 用户的建档 UI 远程投递内容**（自定义行业功能
的硬前置）。

**门（条件式，`server/lib/agent-auth.ts` `requireWriteToken`）**：

| `IDPLAN_AGENT_TOKEN` | 行为 |
|---|---|
| 已配置 | 七个写端点必须带 `Authorization: Bearer <同值>`（常量时间比较） |
| 未配置 | 放行 + 响应带 `x-idplan-write-auth: open` 告警头（Network 面板可见） |

受门端点：`PUT /api/settings/:key`、`POST /api/settings/replace-all`、
`POST /api/logs/stage`、`POST /api/logs/assignments`、`POST /api/contracts`、
`POST /api/contracts/:id/link-project`、`POST /api/contracts/:id/confirmed-payload`。

**为什么不是 fail-closed 硬拒**：这些是高频前端调用（阶段流转每次都写
log）——硬拒=重演 0.8.2 备份事故「点一次 401 一次」且天天发生。备份通道
（偶发）可以 fail-closed；日常写通道用条件门 + 明示。

**前端零改动的原因**：remote 仓储的所有 fetch 已在 0.8.2.0002 备份修复中
带上 `Authorization: Bearer`（用户在设置 → NAS 服务填的 `idplan.apiToken`，
与服务端同一 env）——配了 token 的用户自动全覆盖；没配的用户行为不变。

**收紧路径**：自定义行业（9c）以「token 已配」为上线门槛。
