# 备份包格式规范 v2（backup-format.md）

> 备份 = 单个 JSON 文件（UTF-8），人可读、diff 友好。导入侧用 zod 全量校验后才落库，
> 结构不符直接拒绝并提示（不允许半套写入——Dexie 事务保证原子性）。

## 顶层结构

```jsonc
{
  "meta": {
    "app": "changxia",          // 常量，校验必为 changxia
    "schemaVersion": 2,         // 现行版本；导入侧同时接受 1 与 2
    "exportedAt": "2026-09-01T08:00:00.000Z"
  },
  "data": {
    "projects":  [ /* Project[] */ ],
    "stages":    [ /* Stage[] */ ],
    "tasks":     [ /* Task[] */ ],
    "members":   [ /* Member[] */ ],
    "assignments":[ /* AssignmentLog[] */ ],   // append-only 流水
    "logs":      [ /* StageLog[] */ ],         // append-only 流水
    "contracts": [ /* ContractRecord[] */ ],
    "settings":  [ /* Setting[] */ ]
  }
}
```

## 校验规则（zod schema 与 backup.service.ts 一一对应）

1. `meta.app === 'changxia'`，`meta.schemaVersion ∈ {1, 2}`（导出恒为 2，导入两者都收）；
2. 八张表必须存在且为数组（允许空数组）；元素逐条按实体 schema 校验；
3. 所有实体必有 `revision:number ≥0` 与 `updatedAt: ISO string`；
4. 时间字段一律 ISO string 或 YYYY-MM-DD；禁止 Date 对象序列化产物；
5. 外键仅做「存在性弱校验」：project/stage/task 的 id 彼此可解析（孤儿行允许出现于流水表——append-only 保真原则优先）；
6. 导入 = 清库重建（单事务）：先 `clear()` 八表再 `bulkPut`，任一步失败整体回滚；
7. 低置信度解析快照中的空值字段保持 null —— 备份忠实记录，不做二次猜测。

## 往返不变式（roundtrip 不变式，tests/backup.roundtrip.spec.ts 断言）

导出 → 清库 → 导入 → 再导出，两次 BackupPackage 的 `data` 深比较相等（JSON.stringify 规范化后逐表 diff 为空）。
`meta.exportedAt` 允许不同。

## 人可读性约定

- 数组顺序不承诺稳定，diff 前先按 id 排序；
- 缩进 2 空格导出，方便 git 管理；
- 文件名建议：`id-plan-backup-YYYYMMDD-HHmm.json`（改名 ID Plan 后；文件内容校验仍走 `meta.app === 'changxia'`，与文件名解耦）。

## Member 字段说明（v0.2 增量）

- `members[]` 新增 `roleKind: 'admin' | 'member'`（无密码权限模型）：
  - **旧备份（无该字段）导入时自动归一为 `'member'`**（zod `.default('member')`），导入后每行必有显式 `roleKind`，运行时不会 `undefined`；
  - 新备份含 `roleKind: 'admin'` 的成员 roundtrip 保真；
  - `roleKind` 非法值（如 `'super'`）→ 校验拒绝，不落库。

## 字段说明（v2 增量 · 阶段自定义，PRD 11 §4.4）

随「建档时可多选 N 个阶段（1 ≤ N ≤ 12）」引入。相对 v1 **只增字段且全部有默认值**，
因此 **v1 备份导入 v2 客户端零门槛，v2 备份导入 v1 客户端也不会校验失败**
（zod 默认 strip 未声明键 → 静默丢失 `templateKey` / `colorIndex` 等新列，属可接受的降级场景）。

| 表 | 新增字段 | 默认值 / 老数据回落 |
|---|---|---|
| `projects[]` | `stagePresetKey: string \| null` | `null`（未知套餐） |
| `projects[]` | `stageTemplateVersion: number` | `0`（未知版本） |
| `projects[]` | `scheduleBasis: 'calendar' \| 'workday'` | `'calendar'`（自然日，与改造前口径一致） |
| `stages[]` | `templateKey: string \| null` | 按 `orderIndex` 反查 `indoor_full` 套餐（1..9 一一对应）；越界 → `null` |
| `stages[]` | `colorIndex: number` | `clamp(orderIndex, 1, 9)` |

`stages[].orderIndex` 上限由 **9 放宽为 99** —— 否则阶段数 >9 的项目备份一导出就再也导不回来。
阶段数上限 20 由建档链路（`previewSplit` / `ProjectService.assertDraftsValid`）保证，不由备份层兜底。
（v0.8 起上限由 12 放宽到 20：自定义主色 `Stage.customColor` 解开了「只有 9 色」的约束，
打印按 A4 高度估算分页——段数只增页数，不会崩。）

### 键序铁律（本次增量同样适用，漏一处 roundtrip 就直接失败）

新增字段的插入位置必须在四处一致：**entity 接口 / zod schema / repo insert 行字面量 / 构造行字面量**。

| 实体 | 新增字段 | 插入位置 | 四处落点 |
|---|---|---|---|
| Project | `stagePresetKey`、`stageTemplateVersion`、`scheduleBasis` | `coverColor` 之后、`status` 之前 | `core/types/entities.ts`、`backup.service.ts` 的 `projectSchema`、`local.projects.repo.ts` 的 `insert` 行字面量 |
| Stage | `templateKey`、`colorIndex` | `orderIndex` 之后、`name` 之前 | `core/types/entities.ts`、`backup.service.ts` 的 `stageSchema`、`project.service.ts` 的 `stageRows` 行字面量 |

导入侧 projects / stages 与 members / tasks 一样**落库 zod 归一产物**（`normalizeProjectRow` /
`normalizeStageRow`），归一函数按 entity 键序重建对象，故 roundtrip 的 `JSON.stringify` 逐表 diff 依然成立。

## v3 增量（v0.6 · Agent 任务字段，PRD §0.4 / IN-06）

现行导出版本 **3**（`BACKUP_SCHEMA_VERSION = 3`）；导入侧同时接受 **1 / 2 / 3**。

### Task 新增 9 字段（键序：`dueDate` 后、`orderIndex` 前，即 §3.1 序 9–17）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `source` | `'human' \| 'agent'` | `'human'` | 任务来源；存量数据全部归 `human` |
| `externalId` | `string \| null` | `null` | 幂等键，建议 `${agentKind}:${runId}:${localKey}`。Dexie 行内不写该键，序列化侧归一为 `null`（形状稳定） |
| `agentId` | `string \| null` | `null` | 产出者 Agent 的 Member.id |
| `status` | 7 值（draft/ready/claimed/in_progress/blocked/review/done） | 由 `done` 推导 | ★ **唯一事实源**。schema 用 `.optional()` 而非 `.default('draft')`——v2 老备份无 status，必须由 done 反推 |
| `description` | `string \| null` | `null` | Markdown 正文 |
| `dependsOn` | `string[]` | `[]` | 同项目内前驱 Task.id |
| `artifacts` | `TaskArtifact[]`（对象数组） | `[]` | ★ 序列化绝不可经过 `serializeAssigneeIds`（内含 `filter(typeof x === 'string')`，会静默清空对象数组） |
| `startAt` | `string \| null` | `null` | 任务级排期起点 |
| `claimedAt` | `string \| null` | `null` | 认领时刻 |

`TaskArtifact`：`{ id: 'art_xxx', kind: 'task_md'|'doc'|'file'|'diff'|'link'|'other', title, path, url, note }`；
`kind` 缺省 `'other'`（前向兼容）；`id` 缺失 → 结构不符直接拒绝（不静默补）。

### Member 新增 2 字段（键序：`passwordHash` 后、`revision` 前）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `actorKind` | `'human' \| 'agent'` | `'human'` | Agent 是 Member 的一种（不新增顶层实体） |
| `agentKind` | `string \| null` | `null` | **开放字符串，严禁 z.enum**——Harness 迭代极快，封闭结构会让每次接新 Agent 都要发版 |

### `done` 与 `status` 的归一口径（normalizeTaskRow）

- 导入时 `status` 缺失 → `status = (done === true ? 'done' : 'draft')`；
- 归一后恒有 `done === (status === 'done')`，两字段永不矛盾（即使老备份里矛盾）；
- `done=false` 的老数据归一为 **`draft` 而非 `ready`**：ready 语义是「可被 Agent 认领的下一步」，
  把存量人工任务全置 ready 会瞬间灌满 Ready 队列。

### v1 / v2 / v3 兼容矩阵

| 备份版本 | 导出 | 导入 | 缺失字段处理 |
|---|---|---|---|
| v1（远古） | ✗ | ✅ 接受 | 既有 `.transform(normalizeProjectRow/StageRow)` + 新 9/2 字段 `.default()` |
| v2（v0.5） | ✗（升级后不再产出） | ✅ 接受 | `done` → `status` 归一；其余 8 字段 `.default()`；`externalId` 归一 `null` |
| v3（现行） | ✅ 恒为 v3 | ✅ 接受 | 全字段显式存在 |

### 键序铁律（v3 同样适用）

Task 9 字段的键顺序必须在四处逐字一致：`entities.ts` / `backup.service.taskSchema`（含
`normalizeTaskRow` 返回字面量）/ `local.tasks.repo.insert` / `project.service.taskRows`。
违反后果：`tests/backup.roundtrip.spec.ts` 的 `JSON.stringify` 逐表 diff 失败。

---

## v0.8 增量（Agent 工作区 / 主板块 / 自定义阶段色）

**`BACKUP_SCHEMA_VERSION` 仍为 3** —— 本版只**追加字段**且全部有默认值/读时回落，
不构成结构破坏，故不 bump 版本号（bump 会让旧客户端拒绝导入，收益为零）。

| 表 | 新增字段 | 类型 / 默认 | 读时回落（`normalizeXxxRow`） |
|---|---|---|---|
| `projects[]` | `domain` | `string \| null`，zod `.nullable().optional()` | 按 `stagePresetKey` 反查套餐 domain，再退 `'indoor'`（**精确复现改造前观感**） |
| `projects[]` | `kind` | `string`，zod `.nullable().optional()` | `DEFAULT_PROJECT_KIND`（`'human'`）——**老库/老备份全部落回人类侧** |
| `stages[]` | `customColor` | `string \| null`（`#RRGGBB`），zod `.nullable().optional()` | `null`（= 用内置 `colorIndex` 色） |

**为什么 zod 用 `z.string()` 而不是 `z.nativeEnum(...)`**：`StageTemplateDomain` 与
`ProjectKind` 都是**字符串字面量联合类型**，不是 TS `enum`（`z.nativeEnum()` 只吃 enum 对象）；
且本文件既有策略就是枚举字段宽收（见 `type` / `status`）——保证将来新增行业/来源值时，
旧客户端不会因为「不认识这个值」而拒绝整份备份。窄化在读时归一函数内完成。

### 键序铁律（v0.8 · 2 条链 8 处）

| 链 | 新增字段 | 插入位置 | 四处落点 |
|---|---|---|---|
| Project | `domain`、`kind` | `scheduleBasis` 之后、`status` 之前 | `entities.Project` / `backup.service.projectSchema` / `local.projects.repo.insert` 行字面量 / `stage-fallback.normalizeProjectRow` |
| Stage | `customColor` | `colorIndex` 之后、`name` 之前 | `entities.Stage` / `backup.service.stageSchema` / **`project.service.stageRows`**（⚠️ 不是 repo，Stage 无独立 insert 字面量）/ `stage-fallback.normalizeStageRow` |

**Dexie 未 bump（`SCHEMA_VERSION` 仍为 3）**：三列**均不进任何索引**，`schema/current.ts`
一个字都不用改 ⇒ 存量用户升级时**不会**被 `needsPreMigrationBackup()` 拦下强制先导备份。

### 服务端列迁移

`server/db.ts` 的 `V08_COLUMN_MIGRATIONS`（3 条幂等 `ALTER TABLE ADD COLUMN`），
**不占 `PRAGMA user_version`**（该计数器被 `migrateDoneToStatus`→3 与 `migrateAgentIndex`→4 共用，
掺进去会截胡两者的守卫）。老库 `projects.kind` 由 DDL 的 `NOT NULL DEFAULT 'human'` 自动补齐。
