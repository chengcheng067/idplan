# 备份包格式规范 v3（backup-format.md）

> 备份 = 单个 JSON 文件（UTF-8），人可读、diff 友好。导入侧用 zod 全量校验后才落库，
> 结构不符直接拒绝并提示（不允许半套写入——Dexie 事务保证原子性）。
>
> ★ 动代码前先分清**两个版本号**（详见 §「本地库版本 vs 备份版本」）：
> `meta.schemaVersion`（备份文件格式，导出恒为 **3**）与 `SCHEMA_VERSION`（IndexedDB 库版本，现为 **5**）。
> 二者独立演进，改一个不代表要改另一个。

## 顶层结构

```jsonc
{
  "meta": {
    "app": "changxia",          // 常量，校验必为 changxia（z.literal）
    "schemaVersion": 3,         // 导出恒为 3；导入接受 1 / 2 / 3，键整体缺失也通过（按 3）
    "exportedAt": "2026-09-01T08:00:00.000Z"
  },
  "data": {
    // ── 8 张必填表：zod 无 .default()，缺键即整包拒绝 ──
    "projects":    [ /* Project[] */ ],
    "stages":      [ /* Stage[] */ ],
    "tasks":       [ /* Task[] */ ],
    "members":     [ /* Member[] */ ],
    "assignments": [ /* AssignmentLog[] */ ],   // append-only 流水
    "logs":        [ /* StageLog[] */ ],        // append-only 流水
    "contracts":   [ /* ContractRecord[] */ ],
    "settings":    [ /* Setting[] */ ],
    // ── 5 张可选表：zod `.default([])`，老备份缺键 → 安全默认空数组 ──
    "itineraries":        [ /* ItineraryDay[] */ ],      // v0.9 旅游每日行程
    "executions":         [ /* Execution[] */ ],         // v5 执行域：执行单主实体
    "executionAttempts":  [ /* ExecutionAttempt[] */ ],  // v5 每次实际执行尝试（不覆盖旧记录）
    "executionEvents":    [ /* ExecutionEvent[] */ ],    // v5 append-only 执行事件流水
    "writebackProposals": [ /* WritebackProposal[] */ ]  // v5 字段级写回提案
  }
}
```

类型出处：`src/core/types/dto.ts:371-403`（`BackupPackage`，`data` 在 `:383-402`）；
zod schema：`src/core/services/backup.service.ts:411-439`；
导出组装：`src/core/repositories/local/local.admin.repo.ts:68-89`（`fullExport`）。

## 校验规则（zod schema 与 backup.service.ts 一一对应）

1. `meta.app === 'changxia'`（`z.literal`，`backup.service.ts:413`）。
   `meta.schemaVersion` 走 `z.union([1, 2, 3]).default(BACKUP_SCHEMA_VERSION)`（`:415-421`）：
   - 导入接受 **1 / 2 / 3**；
   - **`meta.schemaVersion` 整个键缺失也通过**——末尾 `.default()` 会把它补成现行版本 3。
     （这条是文档此前漏记的：手写 fixture 时漏写 `schemaVersion` 不会报错。）
   - 导出**恒为 3**（`BACKUP_SCHEMA_VERSION = 3`，`:34`），三个写入点一致：
     `local.admin.repo.ts:71`（正常路径）、`backup.service.ts:479`（无 admin 通道的降级路径）、
     `server/routes/meta.routes.ts:396`（服务端）。**绝不降级产出**。
2. `data` 共 **13 张表**：
   - **8 张必填**（无 default，缺键整包拒绝）：`projects` / `stages` / `tasks` / `members` /
     `assignments` / `logs` / `contracts` / `settings`；
   - **5 张可选**（`.default([])`）：`itineraries`（`:428`）、`executions` /
     `executionAttempts` / `executionEvents` / `writebackProposals`（`:434-437`）。

   全部允许空数组；元素逐条按实体 schema 校验。
3. 「可选 5 表」的兜底是**双保险**，两处都要有：
   - zod 侧 `.default([])`（`backup.service.ts:428`、`:434-437`）；
   - 仓储侧 `?? []`（`local.admin.repo.ts:124`、`:136-143`）——为了兼容**绕过 `validateBackupJson`
     直接调 admin** 的存量路径（该处注释明写「admin 本身也必须安全处理缺失字段」）。

   ⇒ 结论：**后 5 个键缺失不会整包拒绝**，导入后落库为空表。
4. `revision`（非负整数）与 `updatedAt`（ISO string）**只在 5 张主实体表上成立**：
   `projects` / `stages` / `tasks` / `itineraries` / `members`。
   其余表**没有 `revision`**，不要照抄「所有实体必有 revision」：

   | 表 | 时间/版本字段 |
   |---|---|
   | `assignments` / `logs` / `contracts` | 仅 `createdAt` |
   | `settings` | 仅 `updatedAt`（主键是 `key`） |
   | `executions` / `executionAttempts` / `writebackProposals` | `createdAt` + `updatedAt`，无 `revision` |
   | `executionEvents` | 仅 `createdAt`，无 `revision` |

5. 时间字段一律 ISO string 或 YYYY-MM-DD——schema 侧用 `dateLike` 正则
   `/^\d{4}-\d{2}-\d{2}(T.*)?$/`（`backup.service.ts:43`）放宽；禁止 Date 对象序列化产物。
6. 外键仅做「存在性弱校验」：project/stage/task 的 id 彼此可解析（孤儿行允许出现于流水表——append-only 保真原则优先）。
7. 导入 = 清库重建（**单事务**）：在同一个 `rw` 事务内（`local.admin.repo.ts:151`）遍历
   `ALL_TABLE_NAMES` 先 `clear()` 再 `bulkPut`（`:191-193`），任一步失败整体回滚。
   `ALL_TABLE_NAMES` 是 `dexie.database.ts:286` 的别名，**单一出处**是
   `schema/current.ts:33-47` 的 `ALL_STORE_NAMES`（13 个，与 Dexie `Table` 声明一一对应）。
8. 低置信度解析快照中的空值字段保持 null —— 备份忠实记录，不做二次猜测。

## 往返不变式（roundtrip 不变式，tests/backup.roundtrip.spec.ts 断言）

导出 → 清库 → 导入 → 再导出，两次 BackupPackage 的 `data` 深比较相等（JSON.stringify 规范化后逐表 diff 为空）。
`meta.exportedAt` 允许不同。

## 人可读性约定

- 数组顺序不承诺稳定，diff 前先按 id 排序；
- 缩进 2 空格导出，方便 git 管理；
- 文件名建议：`id-plan-backup-YYYYMMDD-HHmm.json`（改名 ID Plan 后；文件内容校验仍走 `meta.app === 'changxia'`，与文件名解耦）。
  产出函数 `backupFileName()`（`backup.service.ts:562-565`）。

## Member 字段说明（v0.2 增量）

- `members[]` 新增 `roleKind: 'admin' | 'member'`（无密码权限模型）：
  - **旧备份（无该字段）导入时自动归一为 `'member'`**（zod `.default('member')`），导入后每行必有显式 `roleKind`，运行时不会 `undefined`；
  - 新备份含 `roleKind: 'admin'` 的成员 roundtrip 保真；
  - `roleKind` 非法值（如 `'super'`）→ 校验拒绝，不落库。

## 字段说明（v2 增量 · 阶段自定义，PRD 11 §4.4）

随「建档时可多选 N 个阶段（1 ≤ N ≤ 12）」引入。相对 v1 **只增字段且全部有默认值**，
因此 **v1 备份导入现行客户端零门槛**（`.optional()` + `.transform()` 补齐，导入后 DB 行必有值）。

**反向不成立**：「v1 客户端」这一档已不存在，现行导出恒为 3，不存在「v2 备份导入 v1 客户端」
的真实路径。zod 默认 strip 未声明键的降级语义只在「同一份包被更老的实现读取」时才生效——
目前唯一在产的「老版本导出物」是迁移前快照，见下一节。

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

### `schemaVersion: 2` 的唯一在产来源：迁移前快照

`dumpLegacyTables()`（`dexie.database.ts:300`，注释在 `:297`）读的是**升级前**的老库整表快照，
刻意把 `meta.schemaVersion` 标成 **2**（`:321`），而不是现行 3。原因写在注释里：这份备份是
**回滚凭据**，必须能被「只接受 1|2 的旧版应用」导回；v1 原始行本就没有 v0.6 新字段，标 2 才自洽。
该快照只读 8 张老表，`itineraries` 与执行域四表恒为空数组（`:328`、`:334-338`）。

### 键序铁律（本次增量同样适用，漏一处 roundtrip 就直接失败）

新增字段的插入位置必须在四处一致：**entity 接口 / zod schema / repo insert 行字面量 / 构造行字面量**。

| 实体 | 新增字段 | 插入位置 | 四处落点 |
|---|---|---|---|
| Project | `stagePresetKey`、`stageTemplateVersion`、`scheduleBasis` | `coverColor` 之后、`status` 之前 | `core/types/entities.ts`、`backup.service.ts` 的 `projectSchema`、`local.projects.repo.ts` 的 `insert` 行字面量 |
| Stage | `templateKey`、`colorIndex` | `orderIndex` 之后、`name` 之前 | `core/types/entities.ts`、`backup.service.ts` 的 `stageSchema`、`project.service.ts` 的 `stageRows` 行字面量 |

导入侧 projects / stages 与 members / tasks 一样**落库 zod 归一产物**（`normalizeProjectRow` /
`normalizeStageRow`），归一函数按 entity 键序重建对象，故 roundtrip 的 `JSON.stringify` 逐表 diff 依然成立。

## v3 增量（v0.6 · Agent 任务字段，PRD §0.4 / IN-06）

现行导出版本 **3**（`BACKUP_SCHEMA_VERSION = 3`）；导入侧同时接受 **1 / 2 / 3**（键缺失按 3）。

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
| v2（v0.5，含迁移前快照） | ✗（现行客户端不再产出，仅 `dumpLegacyTables` 产出） | ✅ 接受 | `done` → `status` 归一；其余 8 字段 `.default()`；`externalId` 归一 `null` |
| v3（现行） | ✅ 恒为 v3 | ✅ 接受 | 全字段显式存在 |
| `meta.schemaVersion` 键缺失 | — | ✅ 接受 | 按 `.default(BACKUP_SCHEMA_VERSION)` 归一为 **3**（`backup.service.ts:421`） |

### 键序铁律（v3 同样适用）

Task 9 字段的键顺序必须在四处逐字一致：`entities.ts` / `backup.service.taskSchema`（含
`normalizeTaskRow` 返回字面量）/ `local.tasks.repo.insert` / `project.service.taskRows`。
违反后果：`tests/backup.roundtrip.spec.ts` 的 `JSON.stringify` 逐表 diff 失败。

---

## v0.7 增量（任务人读号 `taskNo` · 侧栏简称 `shortLabel`）

**`BACKUP_SCHEMA_VERSION` 保持 3，不 bump** —— 两处都只是追加可空字段，
`z.number().int().nullable().default(null)` / `z.string().nullable().optional()` 让 v3 老包照常可读。

| 表 | 字段 | 类型 / 默认值 | 语义 |
|---|---|---|---|
| `tasks[]` | `taskNo` | `number \| null`，`.nullable().default(null)`（`backup.service.ts:191`） | 任务人读号，全局单调递增、**永不复用**；`null` = 老数据，本轮**不回填**。展示一律走 `formatTaskNo()`（`entities.ts:57-58` 明令禁止组件里散拼 `'T-' + n`） |
| `tasks[]` | `itineraryDate`（v0.9） | `string \| null`，`.nullable().default(null)`（`backup.service.ts:203`） | 旅游行程归属日 YYYY-MM-DD。与 `dueDate` 分工严格区分：它决定「行程第几天」，`dueDate` 仍是截止日 |
| `projects[]` | `shortLabel` | `string \| null`，`.nullable().optional()`（`backup.service.ts:70`） | 侧栏折叠态方块简称。`null`/空串 → 读时回落项目名首字（`resolveProjectShortLabel`），老数据无需迁移脚本 |

⚠️ 两处类型**刻意不对齐**，改代码时别顺手「修正」：
`entities.Task.taskNo` 是必填 `number | null`（`entities.ts:71`），而
`entities.Task.itineraryDate` 是**可选** `itineraryDate?: string | null`（`entities.ts:96`）。
备份侧则**两者都**用 `.default(null)`（`backup.service.ts:191`、`:203`）——因为
`normalizeTaskRow` 需要拿到**显式 `null`** 才能把键落进重建对象；用 `.optional()` 会让键缺失，
导出/导入键序不一致，roundtrip 的 `JSON.stringify` 逐表 diff 直接失败（`:180-190` 注释）。

### 导入期的号段重编号（`taskNo` 专属，`local.admin.repo.ts:149-170`）

导入不是原样 `bulkPut`：`replaceAllImport` 会在事务内先调用
`resolveTaskNoCollisions`（`src/core/lib/task-no.ts:143`）做号段归一。要点：

- 规则：**保留先到者，后到者重编号**。重编号从 `nextSeq` 之后开始发号，天然不与保留行冲突。
- `nextSeq = max(包内 max(taskNo) + 1, 包内 settings.taskNoSeq ?? 1000, 本地 taskNoSeq ?? 1000)`
  （`task-no.ts:150-154`，注释给了三条漏项各自的真实撞号路径）。
- **本地计数器必须在 `clear()` 之前读**（`local.admin.repo.ts:152-156`）：同事务内 clear 会把它一起清掉。
- `taskNo` 为 `null` 的老数据**不参与查重、也不补号**（回填已明确不做）。
- 计数器回写两条准则（保 roundtrip 逐表全等）：包里没有 `taskNoSeq` 行 → **不发明一行**；
  有该行但值未变 → **连 `updatedAt` 都不动**。
- 返回值 `renumbered` 恒为 0（正常包），**刻意不接 UI toast**：跨库「合并导入」路径不可达，
  `renumbered > 0` 只表示包自身已损坏。保留仅供单测断言。

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

### `Project.type`（老备份残留字段）

v0.7 及更早的备份里 `projects[]` 仍带 `type`（商务细分）。`Project` 实体自 v0.8 起**已无该字段**，
但备份 schema 仍用 `z.string().nullable().optional()` **宽收**（`backup.service.ts:58`），
导入后由 `normalizeProjectRow` 显式剥离。理由同上：**枚举字段一律宽收**，否则老备份整包导不回来。

### 键序铁律（v0.8 · 2 条链 8 处）

| 链 | 新增字段 | 插入位置 | 四处落点 |
|---|---|---|---|
| Project | `domain`、`kind` | `scheduleBasis` 之后、`status` 之前 | `entities.Project` / `backup.service.projectSchema` / `local.projects.repo.insert` 行字面量 / `stage-fallback.normalizeProjectRow` |
| Stage | `customColor` | `colorIndex` 之后、`name` 之前 | `entities.Stage` / `backup.service.stageSchema` / **`project.service.stageRows`**（⚠️ 不是 repo，Stage 无独立 insert 字面量）/ `stage-fallback.normalizeStageRow` |

---

## 本地库版本（Dexie）与备份版本是两个独立维度

| 维度 | 常量 | 现值 | 影响面 |
|---|---|---|---|
| 备份文件格式 | `BACKUP_SCHEMA_VERSION`（`backup.service.ts:34`） | **3** | 只决定 `meta.schemaVersion` |
| IndexedDB 库版本 | `SCHEMA_VERSION`（`schema/current.ts:30`） | **5** | 只决定 Dexie 升级链 |

`schema/current.ts:27-29` 的注释明写二者独立。当前升级链：

| Dexie 版本 | 变更 | 出处 |
|---|---|---|
| v1 | 基线 8 张表 | `schema/current.ts:56-73` |
| v2 | Task 增 `&externalId` / `status` / `agentId` / `source` 索引；Member 增 `actorKind` | `:84-89` |
| v3 | Task 唯一索引换轨 `&externalId` → `&[projectId+externalId]`（幂等键作用域由「全局」收窄为「项目内」，解决跨项目误伤） | `:104-108` |
| v4 | 新增 `itineraries` 表：`id, projectId, date, &[projectId+date], updatedAt` | `:111-113` |
| v5 | 新增执行域四表 `executions` / `executionAttempts` / `executionEvents` / `writebackProposals` | `:129-137` |

v5 是**纯增量**：只声明新表自带的索引，**不重声明**任何既有表（Dexie 对未列出的表自动继承历史定义），
**不动既有表的字段与索引**，也没有 `.upgrade()` 回调。

⚠️ **用户可见后果（此前文档写「不会被闸门拦下」，v4→v5 后已不成立）**：
v4 → v5 是一次真实的库版本 bump，存量用户（库版本 < 5）启动时会命中
`needsPreMigrationBackup()`（`dexie.database.ts:281-283`，判据 `verno !== null && verno < SCHEMA_VERSION`），
被拦在**不可跳过**的「请先导出备份」对话框里——闸门唯一出口是导出成功
（`src/di/repository.provider.tsx:64`、`:77-88`，无「跳过」选项）。
写新表之前先确认这一点：**只要 bump `SCHEMA_VERSION`，全量存量用户都会被拦一次。**

## v0.9 增量（旅游每日行程 `itineraries`）

新增第 9 张数据表。zod 侧 `.default([])`（`backup.service.ts:428`），仓储侧 `?? []`（`local.admin.repo.ts:124`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | `itd_xxx` |
| `projectId` | `string` | 所属项目 |
| `date` | `string` | YYYY-MM-DD，**项目内唯一**（Dexie `&[projectId+date]`）；既有行永不因改期自动删除 |
| `transport` | `string \| null` | 当日交通，`.default(null)` |
| `accommodation` | `string \| null` | 当日住宿，`.default(null)` |
| `budgetAmount` | `number \| null` | 预算（元），`.default(null)` |
| `actualAmount` | `number \| null` | 实际（元），`.default(null)`；与预算分列以支持差额汇总 |
| `revision` | `number ≥ 0` | 乐观锁 |
| `updatedAt` | ISO string | — |

schema 定义在 `backup.service.ts:264-274`，键序与 `entities.ItineraryDay`（`entities.ts:216-228`）逐字一致。

## v5 增量（Agent 执行域四表）

四张表全部 `.default([])`（`backup.service.ts:434-437`），旧备份缺失 → 空表，**不整包拒绝**。

设计口径与既有表一致（`backup.service.ts:336-344` 注释）：

- 枚举字段（`status` / `type` / `source` / `actor` 等）一律 `z.string()` **宽收**，
  防止将来新增枚举值时老客户端被拒；
- 嵌套对象（`ExecutionConfirmation` / `WritebackOperation[]`）用 `z.any()` 保留原值，往返不丢字段。

| 表 | schema 出处 | 说明 / 关键索引 |
|---|---|---|
| `executions` | `:345-364` | 执行单主实体。`id, projectId, taskId, source, status, idempotencyKey, currentAttemptNo, createdAt, updatedAt` |
| `executionAttempts` | `:366-380` | 每次实际执行尝试，不覆盖旧记录。`&[executionId+attemptNo]` 复合唯一（attemptNo 单调递增） |
| `executionEvents` | `:382-394` | append-only 事件流水。`&[executionId+seq]` 复合唯一；`idempotencyKey` 做迟到回执/重复事件幂等拒绝 |
| `writebackProposals` | `:396-409` | 字段级写回提案。按 `executionId` / `projectId` / `taskId` / `status` / `idempotencyKey` 索引 |

索引串见 `schema/current.ts:129-137`，应用顺序见 `:146-155`（`DEXIE_STORES = v1 ∪ v2 ∪ v3 ∪ v4 ∪ v5`）。

## 服务端列迁移

`server/db.ts` 的列迁移都是**幂等 `ALTER TABLE ADD COLUMN`**（靠 `PRAGMA table_info` 判存在），
**一律不占 `PRAGMA user_version`** —— 该计数器是 `migrateDoneToStatus`(→3) 与
`migrateAgentIndex`(→4) 共用的**单一单调计数器**，列迁移掺进去会截胡两者的 `>= 自己那档` 守卫
（后果举例：老库「done=1 → status='done'」的归一**静默丢失**，界面不报错，只是历史已完成任务全部退回 draft）。

| 常量 | 条数 | 内容 | 出处 |
|---|---|---|---|
| `V7_COLUMN_MIGRATIONS` | 1 | `projects.short_label` | `:116-122` |
| `V8_COLUMN_MIGRATIONS` | 1 | `tasks.task_no` | `:137-143` |
| `V09_COLUMN_MIGRATIONS` | 1 | `tasks.itinerary_date` | `:163-169` |
| `V08_COLUMN_MIGRATIONS` | 3 | `projects.domain` / `projects.kind` / `stages.custom_color` | `:171-187` |

`createDb` 的 ② 步统一走这四张表（`:289-292`），顺序无耦合（每条各自判存在）。
老库 `projects.kind` 由 DDL 的 `NOT NULL DEFAULT 'human'` 自动补齐——SQLite 只在
DEFAULT 为**非常量**时才禁止带 `NOT NULL` 的 ADD COLUMN，`'human'` 是字面量常量，合法（`:160-161`）。

---

## 已知局限

- **往返 fixture 尚未覆盖新增的 5 张表**：`tests/backup.roundtrip.spec.ts:39-53` 的 `emptyPackage()`
  只声明 8 个键（无 `itineraries` 与执行域四表）。这意味着 roundtrip 断言实际只在
  「5 张可选表为空」的前提下验证过；带数据的行程/执行域往返**没有回归保护**。
  补 fixture 属于测试缺口，不在本文档范围内——但动这 5 张表的 schema 时要知道这条保护是缺的。
  （注：该 fixture 目前不会编译报错，因为 `tsconfig.json` 的 `exclude` 含 `tests`，
  `npm run typecheck` 不覆盖测试目录，缺口是静默的。）
