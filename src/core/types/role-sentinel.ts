/**
 * 角色数据槽哨兵值的**唯一出处**（数据面）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么和 `operator-sentinel.ts` 分开、但同一套口径
 * ══════════════════════════════════════════════════════════════════════
 * `Member.role` 是**落库数据值**（用户能自己填「主案设计师」这种自由文本，
 * 不是枚举）。但代码里有一处会**代用户填入**一个兜底值：
 * 建档时走「管理员确立」那条路，新建成员不填角色 ⇒ `IdentityDialog` 写 `负责人`。
 * 那个兜底值同样是落库值，因此走与 `operator_name` **完全相同的口径**：
 *
 *   **写入点钉死中文原值 + 显示层取词**（`src/i18n/labels.ts` 的
 *   `ROLE_NAME_KEYS` / `roleLabel()`，按**中文原值为键**）。
 *
 * 零迁移：老行里已经存着 `负责人`，以原值为键 ⇒ 天然可映射，不动 DDL。
 *
 * ── 与 `operator_name` 的两个差别 ──
 *   ① 这里只有**一个**哨兵值（角色是自由文本，其余取值都是用户自己的话）；
 *   ② 用户的自由文本（`主案设计师` / `Lighting Designer`）**永不翻译** ——
 *      `roleLabel()` 查不到就回落原文。所以「钉死」在这里的含义是：
 *      **兜底值不许随界面语言变**，不是「所有角色都要翻译」。
 *
 * 本文件**零 DOM、零 Node、零 import**：纯常量，前端与 Node 两端同一份源码都跑
 * （`src/core/**` 不许 import i18n —— 会把 `lang.ts` 的 `document` 拖进无 DOM 的
 * 服务端 program ⇒ `typecheck:server` TS2584）。
 *
 * 守卫：`tests/data-sentinel-i18n.spec.ts` 的「角色数据槽」一组（写入点唯一出处 +
 * 显示层取词 + 覆盖率锁 + 自由文本回落原文）。
 */

/** 角色数据槽的哨兵值（写入点唯一出处；值 = 改造前的中文原值） */
export const ROLE_SENTINELS = {
  /** 未指定角色时的兜底角色名（`IdentityDialog` 新建成员时写入） */
  owner: '负责人',
} as const;

/** 全部哨兵值（覆盖率锁遍历用；顺序即本表声明序） */
export const ALL_ROLE_SENTINELS: readonly string[] = Object.values(ROLE_SENTINELS);
