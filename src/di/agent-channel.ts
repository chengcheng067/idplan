/**
 * Agent 导入通道的**默认接线点**（组合根 · v0.7 §2.5）。
 *
 * ── 本文件存在的唯一理由 ──
 * `transport.contract.ts` 提供 `createLocalDexieChannel(getBundle)`，但**刻意不提供
 * 默认 `getBundle`**：通道契约是**共享内核**（前端与服务端都要编译它），而「仓储从哪里来」
 * 是**实现层**的事。本文件就是那个「提供仓储」的宿主：把 `repositories/index` 的工厂
 * 注入通道，并注册为当前通道。
 *
 * ── ⚠️ 为什么本文件**必须**放在 `src/di/` 而不是 `src/core/agent/`（后人勿挪）──
 * `server/tsconfig.json` 的 `include` 里有 `../src/core/agent/` 全目录通配（`**` + `*.ts`）
 * ——**整个目录**会被纳入服务端编译单元（该单元 `lib` 仅 ES2020、无 DOM）。
 * 本文件**必然**引用 `repositories/index`（它就是来干这个的），一旦落在 `src/core/agent/` 下：
 *   1. 它自己会被服务端 glob 匹配、成为新的编译单元成员；
 *   2. 于是 `repositories/index` 的整张实现图被**原样**拖回服务端编译单元
 *      —— Dexie 适配器、`remote/rest.client`、`services/backup.service`、`config/env`，
 *      以及经 `local.tasks.repo → hooks/useRoleGuard → store/use*Store` 反向缠上的
 *      Zustand store 层（实测连带 27 个文件、9 条报错）；
 *   3. 而 `transport.contract.ts` 看起来「干净了」——**修复变成障眼法**，
 *      `npm run typecheck:server` 照旧红。
 * 故：**共享内核目录（`src/core/agent/`、`src/core/types/`）里不许出现本文件这类接线**；
 * 接线一律留在组合根。挪回去 = 原样复现上述 9 条报错。
 *
 * ── 注册时机（与旧行为一致）──
 * 旧版把注册写在 `transport.contract.ts` 的模块顶层，即「import 该文件即注册」。
 * 现改为「import **本文件**即注册」——仍是「组合根被加载时注册一次」。生产侧**没有**
 * 读取者（`AgentBoardPage` 的通道信息走 `transport.http` 的 props，不读注册表），
 * 故对运行期行为零影响；唯一消费方是 `tests/v07-t01-contract.spec.ts`，
 * 它显式 import 本文件。
 *
 * ── 谁负责 import 本文件 ──
 * 当前**无生产消费者**：`getAgentImportChannel()` 在 `src/` 内除契约文件自身零出现，
 * 且 `AgentBoardPage` 的 `status` 是**有注释的刻意 `null`**（「本轮没有它的数据来源，
 * 绝不编造一条同步记录」，见该文件）。因此本文件此刻是**待接线的组合根**，
 * 由 `tests/v07-t01-contract.spec.ts` 加载以验证「组合根会注册默认通道」。
 * 将来若真有页面要读注册表（T05 的 loopback / NAS 形态），
 * 应在**组合根**（如 `src/main.tsx` 入口，与 `RepoProvider` 同侧）import 本文件，
 * **不要**在共享内核里 import。
 */
import {
  createLocalDexieChannel,
  registerAgentImportChannel,
} from '../core/agent/transport.contract';

/**
 * 安装**默认** Agent 导入通道（`local-dexie`：转调既有 preview / apply）。
 *
 * ── 为什么这里用**动态** `import()`，而不是文件顶部的静态 import ──
 * 这是从旧实现（`transport.contract.ts` 的 `defaultLocalBundle()`）**原样保留**的性质：
 * 「**懒开**本地数据源 —— 避免本文件被 import 时就触发 Dexie 建库」。
 * 静态 import 会在本模块被加载时**立即求值** `repositories/index` 的整张模块图
 * （Dexie 适配器、各 local repo、`schema/current`、`services/backup.service` …）；
 * 动态 import 则把这件事推迟到 `getBundle()` **真被调用**的那一刻（即用户点了导入）。
 * 两者在本仓库当前路径下**结果等价**，但懒开是原设计意图，且是「加载本模块」与
 * 「建库」两件事解耦的保证，故予以保留（**别"顺手"改成静态 import**）。
 *
 * 仓储配置与旧版逐字一致：`createRepositories({ dataSource: 'local' })`。
 *
 * 保持导出是为了让「默认接线」这件事**可被单测直接调用/复位**，
 * 而不是只能靠模块副作用隐式发生。
 */
export function installDefaultAgentChannel(): void {
  registerAgentImportChannel(
    createLocalDexieChannel(async () => {
      // 懒开：到 getBundle() 被调用时才加载实现层并建库（与旧 defaultLocalBundle 等价）。
      const { createRepositories } = await import('../core/repositories');
      return createRepositories({ dataSource: 'local' });
    }),
  );
}

// 模块顶层执行一次：import 本文件 = 完成默认接线（与旧行为同语义）。
installDefaultAgentChannel();
