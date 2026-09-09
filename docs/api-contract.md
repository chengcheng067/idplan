# REST API 契约（api-contract.md）

> remote 适配器与服务端必须逐一对齐本契约。约定先行：前端 remote adapter（T05）与本 server/ 实现同源开发。
> 统一前缀 `/api`；除标注外均为 JSON `Content-Type`。
> 错误响应统一形状：`{ "error": { "code": string, "userMessage": string } }`，HTTP 状态码仅用于网络层语义。

## 资源命名与 ID

- 前缀规范：`proj_/stg_/tsk_/mem_/log_/ctt_` + uuid 片段（客户端生成，服务端信任）。

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
| POST | `/api/projects/:id/archive` | body `{archived: boolean}` |

## Stages

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/projects/:projectId/stages` | 项目九阶段 |
| GET | `/api/stages/:id` | 详情 |
| POST | `/api/stages/bulk` | `{rows: Stage[]}` 批量插入（建档事务由服务端单一事务包裹） |
| PATCH | `/api/stages/:id` | UpdateStageCmd 子集 |
| POST | `/api/stages/:id/reschedule` | `{startAt,endAt,status?}` |

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
| GET | `/api/backup` | 全量导出 BackupPackage JSON |
| POST | `/api/bootstrap` | 启动全量装载：一次性返回全部表（等价本地 Dexie 全表扫描） |

## 备注

1. 服务端不实现"切分算法"端点——切分是纯函数驻留前端（templates/nine-stages.default.json 同包分发）。
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
`claimedAt`。Agent 幂等写入唯一出口 = `POST /api/tasks/upsert`。
