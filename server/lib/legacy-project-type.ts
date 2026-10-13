/**
 * 「v0.8 已下线、但 DDL 仍要求」的遗留列占位值 —— **单一出处**。
 *
 * ── 它为什么存在（#15）──
 * 客户端自 v0.8 起**不再产出** `projects.type`：「type 下线」是仓库的既有决定
 * （`backup.service.ts` 的 zod 宽收 + `stage-fallback.ts` 的 `normalizeProjectRow`
 * 返回对象不含 `type`；`src/core/types/enums.ts` 里的 `ProjectType` 枚举也已删除）。
 * 而服务端 `projects.type` 是 `TEXT NOT NULL` **且无默认值**（`server/schema.sql`）。
 *
 * 服务端有两条写这条列的路：
 *   · **建档路由**（`projects.routes.ts`）—— 一直写着占位值，所以能用；
 *   · **导入路由**（`meta.routes.ts`）—— 逐列原样插入、**无补偿** ⇒ 任何客户端产出的包
 *     都在 `INSERT` 期抛 `SQLITE_CONSTRAINT_NOTNULL: projects.type`，
 *     **整笔事务回滚**（导入全废）。后果见 #16：NAS/remote 形态下「载入示例项目」
 *     完全不可用（那是该插件的唯一功能），且桌面版导出的备份导不进 NAS。
 *
 * ── 处置（team-lead 拍板，三条都不得偏离）──
 *   ① **不改 DDL**：去掉 NOT NULL 会与「建档路由写占位」这个既有决定冲突；
 *   ② **不让客户端重新传 `type`**：那会推翻「type 下线」这个既有决定；
 *   ③ 两条路**从本模块取**同一个占位值 —— 不各手打一份字面量（本文件就是为此而生：
 *      改动前 `'dining'` 只在建档路由里硬编码了一处，没有单一出处可「沿用」）。
 *
 * ── ⚠️ 读这一列的人请注意 ──
 * 该值与业务无关，纯粹为满足 DDL。`agent.routes.ts` 里明写「绝不冒充 'dining'
 * —— 那是人工室内项目的默认标签」，故**任何需要判读项目类型的逻辑都不得读这一列**
 * （`projects.routes.ts` 的 PATCH 注释亦已声明：列保留、已无读写语义）。
 * 项目类型/板块请走 `domain` / `stagePresetKey`（见 `resolveProjectDomain`）。
 */
export const LEGACY_PROJECT_TYPE_PLACEHOLDER = 'dining';
