/**
 * 《长夏》服务端预留（remote adapter 的后端）：
 * Fastify + better-sqlite3（WAL 模式，单文件 changxia.db）。
 * 路由严格对齐 docs/api-contract.md；错误统一 {error:{code,userMessage}} 形状。
 *
 * 启动：npm run dev:server（tsx watch）；生产：tsx server/index.ts 或打成 NAS Docker 镜像。
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';

import { createDb, openDb } from './db';
// v1.0（多工作区 NAS 版 · 批 1）：注册表建出来 + 幂等播种 ws-default。
// ⚠️ 本批只做地基：**不改** register 签名、**不改**请求路由（按 X-Workspace-Id
//    分流是批 2）。因此下面八行注册全部仍绑在同一个 db 上 —— 行为零变化。
import { openRegistry, seedDefaultWorkspace } from './workspace-registry';
import { errorBodyFrom } from './lib/server-error-text';
import { registerProjectRoutes } from './routes/projects.routes';
import { registerStageRoutes } from './routes/stages.routes';
import { registerTaskRoutes } from './routes/tasks.routes';
import { registerItineraryRoutes } from './routes/itineraries.routes';
import { registerMemberRoutes } from './routes/members.routes';
import { registerMetaRoutes } from './routes/meta.routes';
// v0.8（T04-SRV）：Agent 执行域 REST 端点（读取 + 写入，含状态机存储边界强制）
import { registerExecutionRoutes } from './routes/executions.routes';
// v0.7（T02）：Agent 导入通道（独立 token `IDPLAN_AGENT_API_TOKEN`，与备份通道分离）
import { registerAgentRoutes } from './routes/agent.routes';
// v1.0（多工作区 NAS 版 · 批 3）：五个 `/api/workspaces*` 端点。
// ★ 注意签名差异：本路由**不接 db**（它操作的是注册表库 + 跨区的多个业务库句柄，
//   由 server/workspace-registry.ts 统一管理），故只有 app 一个入参。
//   下面八行 `registerXxxRoutes(app, db)` 的签名与行为一个字都没动。
import { registerWorkspaceRoutes } from './routes/workspaces.routes';

const PORT = Number(process.env.PORT ?? 7788);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const db = openDb();
  createDb(db);

  // ── 多工作区地基（批 1）─────────────────────────────────────────────
  // 注册表库（与业务库同目录的 workspaces.db）建出来，并把存量库幂等登记成
  // ws-default（名「未命名工作室」、数据零迁移，与桌面版同源）。
  //
  // 顺序：必须在 openDb()/createDb() 之后 —— 播种只写注册表，但「默认业务库是哪个
  // 文件」由 resolveDataDir() 一次算定，与 openDb() 的默认值同源，早调晚调都一样；
  // 放这里是为了让「业务库先就绪」这个既有前提在阅读顺序上不被打破。
  //
  // ⚠️ 失败处理：注册表写不进去（只读挂载 / 权限不足 / 磁盘满）**不拦启动**。批 1 的
  //    行为契约是「零变化」，而批 1 的路由完全不读注册表 ⇒ 让它崩掉等于用一批 inert
  //    代码换来一次无法提供服务的 NAS（老版本能跑，新版本起不来 = 回归）。
  //    真正需要注册表可用的是批 2：那一路（`resolveWorkspaceFromRequest`）会**每请求**
  //    响亮失败，诊断信息也更容易拿到。故此处只响亮地告警一次。
  try {
    const registry = openRegistry();
    const seeded = seedDefaultWorkspace(registry);
    if (seeded) console.log('[changxia-server] workspace registry seeded: ws-default');
  } catch (err) {
    console.error(
      '[IDPLAN-SECURITY] workspace registry unavailable (multi-workspace data layer will be inert):',
      err,
    );
  }

  const app = Fastify({
    logger: true,
  });

  // 局域网信任基线（架构待确认 7）：CORS 全放开由路由层幂等保护；token 位预留
  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    // 三支口径（与 core 的 resolveErrorText 同构，理由见 errorBodyFrom 的文件头）：
    //   ① 抛出处带取词键（coreError 的 messageKey / ServerTextError 的 serverKey）
    //      ⇒ userMessage + messageKey + params 三件齐出，前端可本地化；
    //   ② 无键但有 userMessage ⇒ 原样透传（真因支，不建键）；
    //   ③ 都没有 ⇒ 兜底句「服务器内部错误」（只有这一支建键）。
    // ⚠️ 不退 `err.message`：那是 agent scope 处理器的历史行为（委托失败的真因只有
    //    那里看得到），两个处理器各按原样，不做「统一」= 不改行为。
    void reply.status(err.statusCode ?? 500).send(errorBodyFrom(err, 'serverErr.internal'));
  });

  registerProjectRoutes(app, db);
  registerStageRoutes(app, db);
  registerTaskRoutes(app, db);
  registerItineraryRoutes(app, db);
  registerMemberRoutes(app, db);
  registerMetaRoutes(app, db);
  // ★ v0.8（T04-SRV）：执行域端点。同样必须在既有路由之后——它经 `app.inject`
  //   委托既有处理器，且与本文件下方 `registerAgentRoutes` 使用**同一个**
  //   `createSqliteBundle` 实现（执行域语义只有一份，不因入口不同而分叉）。
  registerExecutionRoutes(app, db);
  // ★ v0.7（T02）：**必须排在既有路由之后**——Agent 通道的服务端 bundle
  //   （`server/adapters/sqlite.bundle.ts`）通过 `app.inject` 委托既有处理器完成
  //   幂等 upsert 与成员写入（详见该文件头「三条实现策略」）。先后顺序不影响
  //   注册正确性（委托发生在请求期），但放在最后读起来与依赖方向一致。
  registerAgentRoutes(app, db);
  // ★ 多工作区（批 3）：**必须排在最后**。它不依赖任何既有路由（不经 app.inject 委托），
  //   排最后只是为了让「八行老路由先就位」这个阅读顺序保持原样。
  registerWorkspaceRoutes(app);

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error('[changxia-server] 启动失败：', err);
  process.exit(1);
});
