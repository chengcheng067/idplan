/**
 * Vitest 环境配置：node 环境 + fake-indexeddb 全局注入。
 *
 * 注意：必须在本文件顶层（setupFiles 执行期）就完成补丁——
 * Dexie 在 ES 模块加载时即捕获 indexedDB 引用，等到用例的
 * beforeAll 再挂载就来不及了。vitest 保证 setupFiles 先于
 * 测试文件及其依赖图执行，此处顶层 import 即可达标。
 */

import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach } from 'vitest';

import { resetOverlayStack } from '../src/core/overlay/overlayStack';

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

/**
 * ★ v0.8.6：jsdom DOM 全局清理（治「单跑绿 / 全量红」这类 flaky 的**根**）。
 *
 * 病灶（实测第三次同类事故）：`pool: 'threads'` + `singleThread: true` 让
 * 全部 spec 跑在**同一个进程**（配置注释里已写明这一点），而 jsdom 的
 * `document` 是**进程级单例**——某个 spec 渲染出的节点若没被卸载，会一路
 * 留在 `document.body` 上，撞掉后续 spec 的「页面里没有弹窗」类断言。
 * 本轮实测：`planning-wizard.spec.tsx` 的向导 Modal（createPortal 到 body）
 * 在自己的用例结束后仍在 DOM 里 → 紧随其后的 `stage-drawer-hook-order`
 * 断言 `document.querySelector('[role="dialog"]')` 为 null 必然红，
 * **而它单跑是绿的**。同类历史事故：print-light-lock、qa-batch-a-verify。
 *
 * 为什么收口到这里而不是让每个 spec 自己清：
 *   ① 依赖「每个 spec 作者记得清理」= 迟早复发，且**下次复发仍难查**
 *     （报错指向无辜的下游 spec）；
 *   ② 清理本身零成本、零副作用（每个 spec 的 beforeEach 本来就在建新容器），
 *     在这里做等于给全仓库买一道保险。
 */
if (typeof afterEach === 'function' && typeof document !== 'undefined') {
  afterEach(() => {
    document.body.innerHTML = '';
  });
}

/**
 * ★ 2026-10-12：浮层栈的进程级复位 —— 与上面那条 DOM 清理**同源同因**，必须成对存在。
 *
 * 上面那条把 `document.body` 清空的写法有个副作用：它摘掉 DOM 却**不 unmount React
 * 树**，于是 Modal 的 open effect 的 cleanup（`popOverlay`）**不会跑** —— 而
 * `pool: 'threads' + singleThread: true` 让全部 spec 共用一个进程，浮层栈是
 * **模块级单例**。残留的栈条目会让下一个 spec 里 `isTopOverlay(myId)` 判成 false：
 *   · Esc 关不掉本该关的那一层（表现是「Esc 没反应」）；
 *   · `isRailYielded()` 被上一个 spec 的浮层带偏（侧栏层级错）。
 * 这正是本仓已出过三次的「单跑绿 / 全量红」，且报错指向无辜的下游 spec。
 * 清理点选在这里而不是让每个 spec 自己收：理由与 DOM 清理逐字相同 ——
 * 依赖「每个 spec 作者记得清理」迟早复发，而清理本身零成本零副作用。
 */
if (typeof afterEach === 'function') {
  afterEach(() => {
    resetOverlayStack();
  });
}

/**
 * ★ 2026-10-14：**跨文件**全局泄漏的收口复位（治「单跑绿 / 全量红」的第三个根）。
 *
 * ── 病灶（实测，不是推断）──
 * `pool: 'threads' + singleThread: true` ⇒ 全部 spec 共用一个进程，而 `window` 上的属性
 * 赋值**会活到下一个文件**（我用一对探针实测过：X 文件装 `window.matchMedia`、Y 文件仍读得到）。
 * 两个泄漏源已经在真机上造成**假红**：
 *   ① `window.matchMedia`：多份 spec 在 `beforeEach` 里装「不看查询、恒 `matches:false`」的桩
 *      且**不还原**（`member-board-viewer` / `v07-dline-print-access` / `stage-color-wiring` …）。
 *      后果不是「它的下一个文件」那么简单：**下一个文件在模块加载期**调
 *      `useLayoutStore` 的 `defaultExpanded()` → 读到 false ⇒ `sidebarExpanded:false` ⇒
 *      壳层渲染成**收起态**。受害者的 `beforeEach` 桩**救不了**：store 的状态在 `import` 期
 *      就定死了（`tests/plugin-ui-gating.spec.tsx` 的 D 组就是这么在全量里稳定红、单跑全绿的）。
 *   ② `window.__APP_ENV__`：`plugin-toggle-feedback.spec.tsx` 在 `vi.hoisted` 里注入
 *      `{VITE_DATA_SOURCE:'remote'}` 且从不删除 ⇒ 下一个文件的 `appEnv`（`src/config/env.ts`
 *      的**模块级单例**）定成 remote ⇒ `RepoProvider` 里 `if (appEnv.dataSource === 'local')`
 *      不成立 ⇒ **整段本地版本闸门不执行** ⇒ `tests/db-version-ahead.spec.tsx` 的 3 条红。
 *
 * ── 复位点为什么是 `afterEach`（**不是** `afterAll`）—— 实测定的 ──
 *   ① **挡跨文件**：跨文件泄漏的窗口就是「文件边界」，`afterEach` 覆盖它；
 *   ② **`setupFiles` 里的 `afterAll` 实测不在文件之间跑**：我用配对
 *      `[v07-dline-print-access, plugin-ui-gating]` 加打印验过 —— 下一个文件模块加载期
 *      仍读到 `typeof matchMedia === 'function'`；换成 `afterEach` 后读到 `undefined`。
 *      （⚠️ 别拿「setupFiles 先于测试文件 import」这类顺序假设下结论：顺序假设今天已被推翻多次，
 *        我实测 vitest 的文件排序既不是字母序也不是体积序。）
 *   ③ **不打断文件内的合法用法**：所有装桩点都在各文件自己的 `beforeEach` 里（逐文件核过：
 *      `theme-tri-select:50` / `use-presence:98` / `motion-exits:93` / `stage-track-coloring:43` /
 *      `holidays-cn:494` / `agenda-view-v3:261` / `member-board-viewer:406` /
 *      `v07-dline-print-access:479` …）⇒ 每用例清一次、下一条用例自己重装，不制造新红。
 *      （反例形态：`__APP_ENV__` 的合法用法是「**模块加载前**注入」（`vi.hoisted`），文件内只写一次
 *        —— 那种泄漏由写入方在**测试文件自己的 `afterAll`** 里收（`plugin-toggle-feedback` 已这么做，
 *        `98ea97f`）。**测试文件的 `afterAll` 会在该文件结束时跑，与 setupFiles 里的不是一回事。**）
 *
 * ⚠️ **为什么这里是「纯 `delete`」**：jsdom 本来就没有 `matchMedia` ⇒ **删回「不存在」才是真还原**
 *    （塞一个假实现只是把泄漏换个形状）。**实测纯 `delete` 足够**（配对
 *    `[v07-dline-print-access, plugin-ui-gating]` = 57 passed）。
 *
 * ⚠️ **更正一处我自己的错误归因（记账，别删）**：本修复的第一版把复位点写成 `afterAll`、同时写成
 *    `delete` + `o.x = undefined`；看到配对仍红，我就得出「**`delete` 单独不够、必须赋值**」——
 *    **那个结论是错的**。当时**两个变量同时改了**（`afterAll` → `afterEach`、`delete` → `delete + 赋值`），
 *    功劳被记到了后来者身上。把这版单独换成「`afterEach` + 纯 `delete`」后**直接通过** ⇒
 *    **真正的自变量是「钩子位置」，不是「delete 还是赋值」**。
 *    （教训：一次只动一个自变量；两个一起动时，任何「XX 不够、必须 YY」的结论都要单独隔离重测。）
 *    （此处曾留过一个空的 `afterAll` 壳以备回退 —— 已删：既是死代码，又因未显式 import `afterAll`
 *      给 `tsc -p tsconfig.tests.json` 添了 2 条 `Cannot find name 'afterAll'`。）
 *
 * ⚠️ **未纳入本复位、但同族的候选（记账，不擅自加）**：`ResizeObserver` 同样被多份 spec
 *    安装后不还原。**不一起删**的理由：可能有文件当前正**依赖泄漏来的** `ResizeObserver`
 *    （自己没装、却要求组件不报错），一刀切删会制造新红。真要收，得先逐文件核一遍。
 */

if (typeof afterEach === 'function') {
  afterEach(() => {
    /*
     * 纯 `delete`（不塞假实现）：jsdom 本来就没有这两个全局 ⇒ 删回「不存在」才是真还原。
     * `try/catch` 只为「万一某环境把它定义成不可配置」兜底 —— 那种情况下本钩子会静默跳过，
     * 但**不会**抛异常把整条用例带崩（宁可漏收一次，也不要制造新红）。
     */
    const clear = (o: Record<string, unknown>): void => {
      try {
        delete o.matchMedia;
      } catch {
        /* 不可配置：跳过（见上） */
      }
      try {
        delete o.__APP_ENV__;
      } catch {
        /* 同上 */
      }
    };
    clear(globalThis as unknown as Record<string, unknown>);
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      if (w !== (globalThis as unknown as Record<string, unknown>)) clear(w);
    }
  });
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
