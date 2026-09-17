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
import { registerProjectRoutes } from './routes/projects.routes';
import { registerStageRoutes } from './routes/stages.routes';
import { registerTaskRoutes } from './routes/tasks.routes';
import { registerItineraryRoutes } from './routes/itineraries.routes';
import { registerMemberRoutes } from './routes/members.routes';
import { registerMetaRoutes } from './routes/meta.routes';
// v0.7（T02）：Agent 导入通道（独立 token `IDPLAN_AGENT_API_TOKEN`，与备份通道分离）
import { registerAgentRoutes } from './routes/agent.routes';

const PORT = Number(process.env.PORT ?? 7788);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const db = openDb();
  createDb(db);

  const app = Fastify({
    logger: true,
  });

  // 局域网信任基线（架构待确认 7）：CORS 全放开由路由层幂等保护；token 位预留
  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    void reply.status(err.statusCode ?? 500).send({
      error: {
        code: String((err as { code?: string }).code ?? 'internal'),
        userMessage: (err as { userMessage?: string }).userMessage ?? '服务器内部错误',
      },
    });
  });

  registerProjectRoutes(app, db);
  registerStageRoutes(app, db);
  registerTaskRoutes(app, db);
  registerItineraryRoutes(app, db);
  registerMemberRoutes(app, db);
  registerMetaRoutes(app, db);
  // ★ v0.7（T02）：**必须排在既有路由之后**——Agent 通道的服务端 bundle
  //   （`server/adapters/sqlite.bundle.ts`）通过 `app.inject` 委托既有处理器完成
  //   幂等 upsert 与成员写入（详见该文件头「三条实现策略」）。先后顺序不影响
  //   注册正确性（委托发生在请求期），但放在最后读起来与依赖方向一致。
  registerAgentRoutes(app, db);

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error('[changxia-server] 启动失败：', err);
  process.exit(1);
});
