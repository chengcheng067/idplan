/**
 * 操作人哨兵值的**唯一出处**（数据面）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么是一张常量表，而不是 `t('…')`
 * ══════════════════════════════════════════════════════════════════════
 * `assignments.operator_name` / `stage_logs.operator_name` 是**落库数据值**（DDL：
 * `server/schema.sql:151`、`:168` 两处 `operator_name TEXT NOT NULL`）。写入点若经
 * `t()` 取词，同一条哨兵值会随界面语言分叉（英文态写进 `Unknown`）⇒ 历史留痕按语言
 * 分裂，且无法回溯当时是谁写的。故**写入点永远写同一个中文原值**。
 *
 * 「钉死」= 写入点永远取这同一个值，**不是**改成 NULL、**不是**改成语言取值。
 * 显示层要另一种语言，由 `src/i18n/labels.ts` 的 `OPERATOR_NAME_KEYS` /
 * `operatorNameLabel()` 按**中文原值为键**取词（老行天然可映射，零迁移、不动 DDL）。
 *
 * ── 为什么这张表必须住在 core（数据面）──
 * `src/core/**` **不许 import i18n**（会把 `lang.ts` 的 `document` 拖进无 DOM 的服务端
 * program ⇒ `typecheck:server` TS2584）⇒ 语言取词不可能在写入侧发生。
 * 本文件因此**零 DOM、零 Node、零 import**：纯常量，前端与 Node 两端同一份源码都跑
 * （`arch-boundary.spec.ts` 共享内核第 5 条；`server/tsconfig.json` `lib: ["ES2020"]`）。
 *
 * ── 值本身不许改（本轮纪律）──
 * 四个值与改造前**逐字节相同**；改的只是「出处」——从散在 9 个写入点的字面量收敛成这里
 * 一行。守卫：`tests/data-sentinel-i18n.spec.ts`（写入点取词形状 + 覆盖率锁）。
 *
 * ⚠️ 这里**没有**「未知值兜底」的概念：兜底本身就是表里的一行。显示侧遇到不在表里的值
 *    （成员真名、将来新增的哨兵）必须**回落原文**（可见即错，不写第二份语言）。
 */

/** 操作人哨兵值（写入点唯一取词处；值 = 改造前的中文原值） */
export const OPERATOR_SENTINELS = {
  /** 无成员身份 / 查不到成员时的留痕名（显示层复用既有 `common.unknown`，不另建键） */
  unknown: '未知',
  /** 当前登录成员取不到真名时的留痕名 */
  currentUser: '当前用户',
  /** 行程面板写入时的留痕名（历史上就是 `'我'`，属落库值） */
  me: '我',
  /** Agent 通道写入时的留痕名 */
  agentChannel: 'Agent 通道',
} as const;

/** 全部哨兵值（覆盖率锁遍历用；顺序即本表声明序） */
export const ALL_OPERATOR_SENTINELS: readonly string[] = Object.values(OPERATOR_SENTINELS);
