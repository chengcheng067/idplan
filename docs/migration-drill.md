# Dexie schema 迁移真实数据演练（P1–P8 · 待用户执行）

> **状态：待用户执行。** 本文档是 step-by-step 手册。代码侧的全部自动化防线
> （Dexie v2 升级事务回滚、v3 索引换轨、v4 新表、v5 纯增量四表、迁移前备份闸门、
> v3 roundtrip、13 张表集合完整性守卫）均已由测试覆盖——**但通过数量以 `npm test`
> 的实机输出为准**：`tests/` 下的 spec 文件数量会随每次开发提交变化（本文写作时为
> 96 个），任何写在文档里的「N 条通过」都会在一周内变成假信息。
>
> 无论测试多绿，**作者本人的真实设计项目数据不在线上任何测试里**——请按本手册
> 用真实库完整走一遍，每一节都留痕。
>
> ⚠️ 版本说明：本手册已从「v0.5→v0.6 / v1→v2」单版迁移，改写为
> **覆盖 v1..v5 的通用迁移演练**。旧的 P1–P7 已重编号为 P1–P8（在 P4 之后
> 插入「P5 · v4→v5 专项」）。

## 背景

- 本地库是 Dexie（IndexedDB），**库名 `changxia`**（`src/core/schema/current.ts`
  的 `DB_NAME`）。注意：**库名 ≠ 目录名**，它只决定 IndexedDB 内部的数据库名称，
  不参与磁盘路径。
- 当前 schema 版本 `SCHEMA_VERSION = 5`。版本演进：

  | 版本 | 变更内容 | 是否改行数据 |
  | --- | --- | --- |
  | v1 | 初始 8 表（projects / stages / tasks / members / assignments / stageLogs / contracts / settings） | — |
  | v2 | Task 增 9 字段索引（`&externalId` / `status` / `agentId` / `source`）+ Member 增 `actorKind` | 是（`.upgrade()`：任务 state 归一、老 `externalId` 键清理） |
  | v3 | 唯一索引换轨 `&externalId` → `&[projectId+externalId]`（幂等键作用域从全局收窄为项目内） | 否（纯索引重建，刻意不写 `.upgrade()`） |
  | v4 | 新增 `itineraries` 表（旅游每日行程），按 `[projectId+date]` 唯一 | 否（新增表，旧项目零迁移） |
  | v5 | 新增 Agent 执行域四表：`executions` / `executionAttempts` / `executionEvents` / `writebackProposals` | 否（**纯增量**：不动任何既有表的字段与索引） |

- 迁移三级可回滚仍成立：
  - **L0** 迁移函数抛异常 → Dexie 事务自动回滚，库保持旧版本；
  - **L1** 迁移前备份在应用内整体替换恢复；
  - **L2** 删库回旧版。
- **新旧版本可共存回退**：只要你的旧构建能读旧版本库，中间没有升级过，就还能回落；
  一旦新版打开过库（version 已升），旧构建将以更低 version 打开失败——这是 Dexie 的
  行为，L2 是唯一完整回滚路径，所以 P2 的基线备份必须做。
- ⚠️ **用户可见行为变化（v5 起务必注意）**：只要已存在库的版本低于当前
  `SCHEMA_VERSION`，`needsPreMigrationBackup()`（`src/core/repositories/local/dexie.database.ts`）
  就返回 true → 应用弹出**不可跳过的「请先导出备份」对话框**，导出成功才允许打开库。
  换句话说：**任何跨版本升级（含 v4→v5 这种纯增量）都会弹闸门**，这是预期行为，不是 bug。

## P1 · 演练前置（5 min）

- [ ] 确认「旧构建」：你手上有真实数据、且 IndexedDB 库版本**低于 5** 的应用
      版本（下称**旧版**）。把它的安装包暂存到一个能找到的目录（用于 L2 回滚）
- [ ] 记录旧版对应的 Dexie 版本号（1/2/3/4），它决定本次要覆盖哪几级迁移
- [ ] 下载 / 构建含 v5 的**新构建**（下称**新版**）
- [ ] 确认在演练机上能正常打开旧版且项目数据完整
- [ ] 准备一个目录存放演练产物（备份包 / 截图 / 报告），下称 `DRILL_DIR`

## P2 · 迁移前基线快照（10 min）★ 最重要的护身符

- [ ] 打开旧版 → 顶栏「保存备份」→ 导出 `changxia-baseline-v<N>.json`（N = 你的旧库
      版本）→ 存 `DRILL_DIR`
- [ ] **核验备份包**：文件大小 > 0；用文本编辑器打开，确认 `meta.schemaVersion`、
      项目 / 任务条数与你的真实数据一致（记录：项目数 ___、任务总数 ___、成员数 ___、
      行程卡数 ___）
- [ ] 再在应用内随便开一个项目，确认应用内数据与备份包条数一致
- [ ] （可选双保险）复制一份原始 IndexedDB 目录文件：
      Electron 桌面端为 `%APPDATA%/ID Plan/IndexedDB/` 整目录 > ⚠️ 见文末「待核实项」
      —— 库名是 `changxia`，但 Electron **目录名取 `productName`**（`package.json`
      为 `ID Plan`，且 `electron/main.cjs` 顶层显式调用了 `app.setName('ID Plan')`），
      所以磁盘路径应是 `%APPDATA%/ID Plan/IndexedDB/`，**不是** `%APPDATA%/changxia/`。
      浏览器端：开发者工具 → Application → IndexedDB → `changxia`。

## P3 · 升级与闸门观察（5 min）

- [ ] 安装 / 启动新版
- [ ] **预期**：出现不可跳过的「迁移前备份」对话框（不是可关闭的普通提示）。
      ★ v4→v5 也**必然**会弹——纯增量同样走 `needsPreMigrationBackup()` 判据
- [ ] 按对话框引导导出迁移前备份 `changxia-pre-migration.json` → 存 `DRILL_DIR`
- [ ] 与 P2 基线包对比：两者条数应一致（迁移前快照的 `meta.schemaVersion` 刻意标
      **2**，使旧版应用也能导回——这是 L2 回滚路径的硬前提）
- [ ] 导出成功后对话框放行 → 应用进入主界面
- [ ] 控制台（开发者工具 Console）无升级相关报错；无 Dexie `VersionError` /
      `SchemaError` / `ConstraintError`

## P4 · 存量数据完整性核对（15 min）

逐项勾选，任何一项不符立即停下（跳 P8 回滚）：

- [ ] **项目数一致**：首页项目列表条数 = P2 记录值；无重复、无缺项
- [ ] **任务全量**：抽 2 个项目逐条核对任务标题 / 批次 / 负责人 / 截止日
- [ ] **任务完成态**（仅当你这次跨越了 v1→v2 时需要核对）：原来已勾选完成的任务，
      在 Agent Board 里 status 显示 `done`（由 `done` 反推）；未完成任务显示
      `draft`（不是 `ready`，这是设计口径——防灌满 Ready 队列）
- [ ] **成员完整**：成员数一致；设过密码的成员登录仍正常
- [ ] **时间轴不塌**：每个项目的 Timeline 批次条数、起止日期与旧版一致
- [ ] **指派不丢**：「我的任务」里各成员的任务条数与旧版一致
- [ ] **旅游行程不丢**（仅当你的旧库已有 `itineraries` 时）：行程卡数 = P2 记录值
- [ ] 开发者工具抽查：任一任务对象含 `taskNo` / `itineraryDate` / `status` /
      `source` / `externalId` / `artifacts` 等字段且不报错

## P5 · v4 → v5 专项演练（10 min）

v5 是**纯增量**，不动既有表的字段与索引，数据丢失风险低。真正会出事的只有两件事：
① 闸门有没有弹；② 四张新表有没有建出来。闸门已在 P3 覆盖，本节点验后者。

- [ ] **Q1 · 四表存在且为空**：开发者工具 → Application → IndexedDB → `changxia`
      确认存在 `executions` / `executionAttempts` / `executionEvents` /
      `writebackProposals` 四张表；升级完成初次运行应**全为空**（旧库没有这些数据，
      v5 不应凭空写入）；Console 无任何报错
- [ ] **Q2 · 写一条 execution 并做往返**：
      ⚠️ 执行域目前只有数据层（`src/core/repositories/local/local.execution.repo.ts`）
      与状态机内核（`src/core/execution/execution-state.ts`），**尚无 UI 入口**
      （`src/pages/` 下没有执行域页面）。因此在 UI 接入前，这一步用开发者工具
      Console 直接写 Dexie：

      ```js
      // Console 里执行；写入后必须完全刷新页面再导出备份
      const req = indexedDB.open('changxia');
      req.onsuccess = () => {
        const db = req.result;
        const now = new Date().toISOString();
        const tx = db.transaction('executions', 'readwrite');
        tx.objectStore('executions').add({
          id: crypto.randomUUID(),
          projectId: '<填一个真实存在的 projectId>',
          taskId: null,
          source: 'natural-language',
          objective: 'drill-probe-1',
          agentMemberId: null,
          channelKind: null,
          inputSnapshotHash: null,
          status: 'draft',
          confirmation: null,
          idempotencyKey: 'drill-probe-1',
          currentAttemptNo: 0,
          createdAt: now,
          updatedAt: now,
          startedAt: null,
          finishedAt: null,
          terminalReason: null,
          blockedReason: null,
        });
        tx.oncomplete = () => { db.close(); console.log('ok'); };
      };
      ```

      > 字段清单以 `src/core/types/agent-execution.ts` 的 `Execution` interface 为准。
      > 若日后 UI 已接入，直接用 UI 建单即可，不必走 Console。

      然后：导出备份 → 用文本编辑器打开 → 确认 `data.executions` 为**非空数组**
      （`data.executionAttempts` / `data.executionEvents` /
      `data.writebackProposals` 此时仍为 `[]`，属正常）→ 记录 executions 条数 ___
      → 清库（见 P8 的删库步骤）→ 用新版打开 →「加载备份」导回 → 确认
      `executions` 条数与导出前一致，且应用不报错
- [ ] **Q3 · 老包向前兼容**：拿一个**只有 8 个键的 v3 老包**（没有 `itineraries`
      与执行域四键的备份）导入 → 不报错、导入成功；且四张新表被安全默认为 `[]`
      （`backup.service.ts` 里这四个键都是 `.array().default([])`，缺失即归一空数组）

## P6 · v0.8  Agent 能力冒烟（10 min）

- [ ] 顶栏可进入「Agent Board」页面
- [ ] 设置 → Agent 区块能看到**席位计数**（`used / limit`，`limit` 来自
      `AGENT_SEAT_LIMIT`，定义于 `src/constants/agentTerms.ts`，由
      `GET /api/agent/health` 与本地通道共同提供）
- [ ] 新建一个 Agent 类型成员（`agentKind` 可自由填写），席位 `used` +1
- [ ] **Apply payload 两条通道都要走一次**（二者共用同一份内核
      `src/core/agent/payload.apply.ts`，但入口不同，必须分别验证）：
      - [ ] **A. 本地粘贴通道**：Agent Board 粘贴一份 3 条任务（1 条依赖另 1 条）的
            payload → 预览无 rejected → commit → 看板出现 2 条新任务
      - [ ] **B. 服务端通道**：`curl -X POST http://<host>/api/agent/import ...`
            提交同一份 payload → 结果与 A 一致
      - [ ] 幂等：同一份 payload 再导入一次 → 任务数不变
- [ ] `POST /api/agent/boards` 建一个 `kind='agent'` 的看板（含阶段骨架）成功；
      且该通道**不接受** `projectId` / `projectName`、不存在任何通往已有项目的写路径
- [ ] Ready 队列出现被依赖阻塞前的可执行任务；给一条任务点 claim 成功
- [ ] 生成 handoff bundle 并复制，肉眼确认不含任何成员密码 / 联系方式

## P7 · 导入导出闭环（5 min）

- [ ] 新版「保存备份」导出一份包 → 确认 `meta.schemaVersion` 为 **3**
      （`BACKUP_SCHEMA_VERSION` 恒为 3，与 Dexie 库版本是两个独立维度，不要混淆）
- [ ] 用「加载备份」导回同一份包 → 下列口径**条数全部不变**：
      项目 / 阶段 / 任务 / **行程卡 itineraries** / 成员 / 指派 / 日志 / 合同 / 设置 /
      **executions / executionAttempts / executionEvents / writebackProposals**
      （共 13 个键，见 `ALL_STORE_NAMES`）
- [ ] 旅游项目专项：改一条行程卡的日期与预算 → 导出 → 导回 → 数据一致（v4 表往返）
- [ ] 再检查一遍导出的 JSON 里 `data.executions` 等四键存在（即使为空数组也必须有键）

## P8 · 回滚验证（仅当 P4/P5/P6 有失败项，或需要演练回滚路径时执行）

- [ ] 关闭新版
- [ ] **删除库**：Electron 删 `%APPDATA%/ID Plan/IndexedDB/` 整目录
      （⚠️ 见文末「待核实项」；浏览器：开发者工具 → Application → IndexedDB →
      删除 `changxia`）
- [ ] 启动旧版 → 空库 →「加载备份」选 **P2 基线包** → 核对数据完整
- [ ] 在演练报告记录失败现象 + 回滚是否完全成功

## 待核实项

| # | 条目 | 现状 | 需要谁来确认 |
| --- | --- | --- | --- |
| T1 | Electron IndexedDB 磁盘目录名 | 代码证据强：① `package.json` 的 `productName = "ID Plan"`；② `electron/main.cjs` 顶层显式 `app.setName('ID Plan')`（在 `app.whenReady()` 之前执行）；③ 没有任何 `app.setPath('userData')` 覆写。据此路径应为 **`%APPDATA%/ID Plan/IndexedDB/`**，旧手册写的 `%APPDATA%/changxia/` 是把**库名**误当**目录名**。 | **仍需实机确认一次**：在演练机上打开 `%APPDATA%`，看真实目录名（尤其注意是否存在更早安装的 `%APPDATA%/id-plan/` 或 `%APPDATA%/Electron/` 遗留目录——若存在，老用户的数据在旧目录，迁移不会自动搬运）。确认后请回来删掉本条并把 T1 结论写进 P2 / P8 |
| T2 | Q2 的 Console 片段字段值 | `Execution.source` 是四值联合 `'project-task' \| 'natural-language' \| 'external' \| 'template'`，`status` 是 10 值联合；本文示例用 `'natural-language'` + `'draft'`，来源 `src/core/types/agent-execution.ts`。 | 已核对②，无需外部确认；日后若这两个联合取值变化，同步更新本片段即可 |

## 演练报告

完成后把本清单（含勾选）+ P2 记录的四个数字 + 异常截图，归档为
`qa-scratch/drill-report.md`（不入 git）。全部通过 = 真实数据迁移演练 P1–P8 收口，
该版本准出条件之一达成。
