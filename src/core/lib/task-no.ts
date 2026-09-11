/**
 * taskNo（任务人读号）共享纯函数库 —— **前后端单份实现**。
 *
 * ── 为什么单独成库 ──
 * 号的分配规则同时被三处消费：前端 Dexie 仓储（`local.tasks.repo`）、前端备份导入
 * （`local.admin.repo`）、服务端 SQLite 路由（`server/routes/tasks.routes.ts`）。
 * 三处各写一遍「下一个号取多少」的算式，就是三份会各自漂移的真相 ——
 * 典型症状是「本地新建 T-1030、NAS 新建也 T-1030」，而两边都不报错。
 * 故规则做成**零 IO 纯函数**，两端 import 同一份。
 *
 * ── 纪律（本文件是服务端 typecheck 的边界守卫，见 §2.15 ⑨）──
 * **零 repo import、零 browser API、零 node API**（只 import 类型）。
 * 一旦引入 `crypto` / `indexedDB` / `node:*`，`npm run typecheck:server` 立刻炸 ——
 * 这是有意设计的探针，不是巧合。类型 import 是安全的（编译期擦除，运行时不加载）。
 *
 * ── 号的两条硬语义（全库唯一口径）──
 *   ① **全局单调递增、永不复用**：删掉 T-1050 之后，下一次新建**不得**再发 1050。
 *      故计数器只读 `settings.taskNoSeq`，**绝不**现算 `MAX(task_no) + 1`
 *      （删号后 MAX 回退 → 直接复用旧号）。
 *   ② **`taskNoSeq` 的语义是「下一个待分配号」，不是「已分配的最大号」**。
 *      空库 → 1000 → 第一个号 `T-1000`。
 */

import type { Task } from '../types/entities';

/**
 * 计数器在 `settings` 表中的键名（**单一出处**）。
 *
 * local / remote / server 三处必须引用本常量 —— 任何一处写成字面量 `'taskNoSeq'`
 * 都会在某次重命名时静默脱钩（读旧键得 null → 计数器从 1000 重来 → 集体撞号）。
 */
export const TASK_NO_SEQ_KEY = 'taskNoSeq';

/** 计数器种子：空库首号 = T-1000（4 位起） */
export const TASK_NO_SEED = 1000;

/** 老包/空库的「最大号」占位：`max(task_no)` 为空时按 999 计，于是下一个号天然是 1000 */
export const TASK_NO_LEGACY_MAX = 999;

/**
 * 号 → 展示串。**UI 一律走本函数，禁止组件里散拼 `'T-' + n`**。
 *
 * `null` / `undefined` → `'—'`（老数据本轮**不回填**，见 §2.1；回填需要全表改写，
 * 而「老任务没有号」本身是完全合法的状态，没有必须消灭它的理由）。
 *
 * `>9999` 自然进位成 5 位（`T-10000`）—— `padStart(4)` 是**下限**不是截断，
 * 绝不为了「保持 4 位」而回绕或截断（那会直接制造重复号）。
 */
export function formatTaskNo(taskNo: number | null | undefined): string {
  if (taskNo === null || taskNo === undefined) return '—';
  return `T-${String(taskNo).padStart(4, '0')}`;
}

/** `initTaskNoSeq` 入参 */
export interface InitTaskNoSeqInput {
  /** `settings.taskNoSeq` 的当前值（读不到 → null） */
  seqFromSettings: number | null | undefined;
  /** 库内 `max(task_no)`（空库/全为 null → null） */
  maxTaskNoInDb: number | null | undefined;
}

/**
 * 初始化计数器：**已存的值优先**，否则由数据现算。
 *
 * 算式逐字照 §2.3：
 *   `seqFromSettings ?? Math.max((maxTaskNoInDb ?? 999) + 1, 1000)`
 *
 * 空库（两者皆无）→ `max(999 + 1, 1000)` = **1000** → 首号 `T-1000`。
 *
 * ⚠️ **已知边界（登记，不在本轮改）**：`??` 的语义是「null/undefined 才回落」，
 * 故若 settings 里存着一个**落后于数据**的号（如 seq=1000 而库里已有 T-1005），
 * 本函数会原样返回 1000 而**不会**自动抬到 `max+1` —— 该场景下仍可能撞号。
 * 备份导入路径不受影响（§2.9.1 的 `resolveTaskNoCollisions` 用「三者取最大」，
 * 显式把 `max+1` 纳进来了，见该函数注释）。
 *
 * @see resolveTaskNoCollisions —— 导入路径的权威归一（三条取最大）
 */
export function initTaskNoSeq(input: InitTaskNoSeqInput): number {
  const { seqFromSettings, maxTaskNoInDb } = input;
  if (seqFromSettings !== null && seqFromSettings !== undefined) return seqFromSettings;
  return Math.max((maxTaskNoInDb ?? TASK_NO_LEGACY_MAX) + 1, TASK_NO_SEED);
}

/**
 * 分配一个号并返回**分配后的下一个待分配值**。
 *
 * 调用方必须把返回的 `next` 写回 `settings.taskNoSeq`（且在**同一事务内**，
 * 否则「行进了库、计数器没走」的行为在下次写入时就会发同一个号）。
 *
 * 与 Dexie/SQLite 无关：事务外壳由调用方提供，本函数只做算术。
 */
export function allocateTaskNo(next: number): { taskNo: number; next: number } {
  return { taskNo: next, next: next + 1 };
}

/** `resolveTaskNoCollisions` 入参 */
export interface ResolveTaskNoCollisionsOptions {
  /** **包内** `settings.taskNoSeq ?? 1000` */
  seqFromSettings: number | null | undefined;
  /** **包内** `max(task_no)`（无有效号 → null） */
  maxTaskNoInDb: number | null | undefined;
  /**
   * 库内**既有**行的号集合（`replaceAllImport` 传空集：它先 clear 再 bulkPut，
   * 导入瞬间库内无既有行）。保留该参数是为了将来新增「合并导入」模式时本函数直接可用。
   */
  existingNos?: ReadonlySet<number>;
  /**
   * **本地**当前 `taskNoSeq`（导入前的本机计数器）。
   *
   * ⚠️ 这是对 §2.3 签名的一处**受控扩展**：§2.3 的 options 只列了前三个键，
   * 但 §2.9.1 的「三者取最大」必须有本地计数器才能成立 —— 少了它，就存在
   * 「A 机导出（seq=1043）→ B 机导入（B 机 seq=1000）」后 B 机新建复用包内已有号的真实路径。
   * 故显式补上并在此登记，而不是悄悄漏掉一条规则。
   */
  localSeq?: number | null;
}

/**
 * 备份导入的号段归一：**保留先到者，后到者重编号**，并算出导入后应落的计数器值。
 *
 * ── 为什么必须「三者取最大」（§2.9.1）──
 * ```
 * nextSeq = max( 包内 max(task_no) + 1,  包内 settings.taskNoSeq ?? 1000,  本地 taskNoSeq ?? 1000 )
 * ```
 * 漏掉任何一项都有**真实可达**的撞号路径：
 *   · 漏「包内 max+1」 → 下一条新建直接复用包内最大号；
 *   · 漏「包内 seq」   → 包内计数器已经领先（如 1043）却被本地 1000 覆盖回去；
 *   · 漏「本地 seq」   → 本机已发到 1043，导入一个老包后被拉回 1000，后续全部重号。
 *
 * ── 老包（无 `task_no` 字段）──
 * `max` 按 999 计 → `nextSeq = max(1000, 包内 seq ?? 1000, 本地 seq ?? 1000)`，
 * 与「不导入」的行为一致，且**不会倒退**（本地计数器只增不减）。
 *
 * ── 为什么重编号从 `nextSeq` 之后开始 ──
 * `nextSeq` 恒 `> 包内 max`，因此从这里往后发的号**天然**不与任何被保留的行冲突，
 * 无需再查一遍集合。
 *
 * 纯函数：无 IO、无事务语义。调用方负责把 `next` 写回 settings（同事务）。
 */
export function resolveTaskNoCollisions(
  rows: readonly Task[],
  options: ResolveTaskNoCollisionsOptions,
): { rows: Task[]; renumbered: number; next: number } {
  const { seqFromSettings, maxTaskNoInDb, existingNos, localSeq } = options;

  // 三者取最大：注意「包内 max」为空时按 999 计（老包），而非 0
  const base = Math.max(
    (maxTaskNoInDb ?? TASK_NO_LEGACY_MAX) + 1,
    seqFromSettings ?? TASK_NO_SEED,
    localSeq ?? TASK_NO_SEED,
  );

  const seen = new Set<number>(existingNos ?? []);
  let next = base;
  let renumbered = 0;

  const out = rows.map((row) => {
    // 老数据（null/undefined）不参与查重、也不重编号：它本来就没有号，
    // 给它补一个号属于「回填」，已明确不做（§2.1）。
    if (row.taskNo === null || row.taskNo === undefined) return row;

    if (!seen.has(row.taskNo)) {
      seen.add(row.taskNo);
      return row; // 先到者原样保留 —— 保证「导入不改动本来没问题的数据」
    }

    const assigned = next;
    next += 1;
    renumbered += 1;
    seen.add(assigned);
    return { ...row, taskNo: assigned };
  });

  // next 已随重编号前移，故返回的即「导入后下一个待分配号」
  return { rows: out, renumbered, next };
}

/* ============================================================================================
 * 调用方共用的两个「取值」小工具
 *
 * 为什么放进共享库而不是各自写一遍：这两段都在做**同一件判据**（「什么算一个有效的号」、
 * 「settings 里这个值算不算数」），一旦两处漂移就会出现「A 路径认它是号、B 路径当它是
 * 空值」这种最难查的不一致 —— 恰好是 taskNo 这条链最怕的事。
 * ============================================================================================ */

/**
 * 库内 / 包内 `max(task_no)`（内存归约；无有效号 → null）。
 *
 * ⚠️ `taskNo` **刻意不建索引**（§2.14：只为展示与归约服务），故这是 O(n) 全表归约
 * 而非 `.max()`。调用方必须**在事务内取一次并复用**，不要每写一条就再扫一遍。
 *
 * v0.7 之前写入的行没有该键（`undefined`），必须挡住 —— 否则 `Math.max` 会得到 `NaN`。
 */
export function maxTaskNoOf(rows: readonly Task[]): number | null {
  let max: number | null = null;
  for (const r of rows) {
    const n = r.taskNo;
    if (typeof n === 'number' && Number.isFinite(n)) max = max === null ? n : Math.max(max, n);
  }
  return max;
}

/**
 * `settings.taskNoSeq` 的 `value_json` → 数字。
 *
 * 读不到 / JSON 坏 / 不是有限数 → `null`（交由 `initTaskNoSeq` 用「库内 max+1」兜底重算）。
 *
 * ★ 刻意**不抛**：计数器损坏不该让「新建任务」这个用户可见的动作整体失败。
 *   兜底重算最坏只是号段跳跃，**不会产生重复号**（单调性由 max+1 保证）。
 */
export function parseTaskNoSeq(valueJson: string | null | undefined): number | null {
  if (!valueJson) return null;
  try {
    const v: unknown = JSON.parse(valueJson);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/* ============================================================================================
 * 事务内计数器
 *
 * 「init 一次、之后逐条自增」这条纪律在**每一处**都要成立（前端 insert / 前端 upsert /
 * 服务端 bulk / 服务端单建 / 服务端 upsert insert 分支）。任何一处写成「每条重新 init」，
 * 该批新建就会全部拿到同一个号。既然它是个必须处处一样的**行为**，就只实现一份。
 * ============================================================================================ */

/** 事务内号计数器 */
export interface TaskNoCounter {
  /** 取下一个号并自增 */
  take(): number;
  /** 当前「下一个待分配号」（事务末尾回写 settings 用） */
  peek(): number;
}

/**
 * 由「已读到的两个输入」建一个计数器（**纯函数，无 IO**）。
 *
 * 调用方负责在**事务内**把 `seqFromSettings`（settings 里读到的）与
 * `maxTaskNoInDb`（库内 max(task_no)）取来；取数方式两端不同（Dexie 内存归约 /
 * SQLite `SELECT MAX`），但「怎么算下一个号」是同一份。
 */
export function createTaskNoCounter(input: InitTaskNoSeqInput): TaskNoCounter {
  let next = initTaskNoSeq(input);
  return {
    take: () => {
      const allocated = allocateTaskNo(next);
      next = allocated.next;
      return allocated.taskNo;
    },
    peek: () => next,
  };
}
