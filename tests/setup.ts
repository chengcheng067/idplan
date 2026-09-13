/**
 * Vitest 环境配置：node 环境 + fake-indexeddb 全局注入。
 *
 * 注意：必须在本文件顶层（setupFiles 执行期）就完成补丁——
 * Dexie 在 ES 模块加载时即捕获 indexedDB 引用，等到用例的
 * beforeAll 再挂载就来不及了。vitest 保证 setupFiles 先于
 * 测试文件及其依赖图执行，此处顶层 import 即可达标。
 */

import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';

const g = globalThis as unknown as Record<string, unknown>;
if (g.indexedDB === undefined) {
  g.indexedDB = fakeIndexedDB;
}
if (g.IDBKeyRange === undefined) {
  g.IDBKeyRange = FakeIDBKeyRange;
}

/**
 * React 18 的 act 环境开关 —— **统一在这里置位，禁止在各 spec 文件里各自置**。
 *
 * 为什么必须真置 true：
 *   不置 → `act()` 调用点打出
 *   `The current testing environment is not configured to support act(...)`，
 *   且 `act()` 不保证同步 flush（事件驱动的断言会读到更新前的 DOM）。
 *
 * 为什么必须收口到本文件：
 *   vitest 配的是 `pool: 'threads'` + `singleThread: true`（见 `vite.config.ts`），
 *   全部 spec 共用**一个进程**，而 `globalThis` 是**进程级**的。
 *   过去三个 spec（`v07-dline-permission` / `v07-t03a-ingress` / `v07-t03a-task-no`）
 *   各自在模块顶层置 true 且无人还原，于是：
 *     ① 该文件之后的所有 spec 都被「连坐」——本来沉默的「未包 act 更新」被转成
 *        `not wrapped in act` 告警，且栈指向**下游组件**（实测告警挂到 StageDrawer 头上），
 *        排查方向被误导；
 *     ② 一旦哪个文件顺手还原成 undefined，下游立刻炸出上百条
 *        `not configured to support act`（实测 128 条）——说明还有 spec 在**依赖泄漏值**。
 *   收口到 setupFiles 后：置位只发生一次、语义对全体文件一致，两类噪声同时消失。
 *
 * ⚠️ 副作用边界：本开关置 true 后，任何 spec 里**未包 `act()` 的状态更新**都会如实告警。
 *   那是真实信号，请修对应 spec，不要靠「关掉开关」把它压回去。
 */
if (g.IS_REACT_ACT_ENVIRONMENT !== true) {
  g.IS_REACT_ACT_ENVIRONMENT = true;
}

/** 兼容保留：补丁已在模块加载时生效，此函数仅作幂等确认。 */
export async function installFakeIndexedDB(): Promise<void> {
  const gNow = globalThis as unknown as Record<string, unknown>;
  if (gNow.indexedDB === undefined) {
    gNow.indexedDB = fakeIndexedDB;
  }
  if (gNow.IDBKeyRange === undefined) {
    gNow.IDBKeyRange = FakeIDBKeyRange;
  }
}
