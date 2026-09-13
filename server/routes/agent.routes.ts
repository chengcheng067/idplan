/**
 * server/routes/agent.routes.ts（v0.7 · T02 · 设计文档 §3.1 / §3.2 / §3.3 / §3.4）
 * —— 写入通道与自动建阶段的**服务端**落点。
 *
 * ── 三个端点 ──
 *   `POST /api/agent/import`  —— 幂等导入 Agent payload（含「显式声明落点阶段名」）
 *   `GET  /api/agent/health`  —— 探活（版本 / 项目清单 / Agent 席位）
 *   `GET  /api/agent/tasks`   —— 只读任务流（含 `dependsOnExternal`，供 Skill 回喂 payload）
 *
 * ── 本文件是「薄壳」，判定逻辑不在它身上 ──
 * 落点判定（按名复用 / 计划新建 / 无落点）、幂等键、环检测、两段式 upsert 全部在
 * `src/core/agent/payload.apply.ts` + `stage-resolve.ts`（**与前端手动粘贴通道同一份代码**）。
 * 本文件只做四件事：**鉴权 → query 契约校验 → 项目解析 → 把结果原样回执**。
 * 若在这里再判一次落点，就会出现「同一份 payload 在 NAS 与本地得到不同答案」——
 * 那正是 §6.2 写锁矩阵要防的「两份真相」。
 *
 * ── 为什么 import 的落点名走 query 而不是 body（决策 2）──
 * body 的 schema（`idplan-agent-payload/v1`）**不动**：仓外的 Skill 作者按现有 schema
 * 产出 payload。加一个 query 参数是**向后兼容**的；改 body schema 会让所有既有 Skill
 * 的产物在严格校验下失效。
 *
 * ── `invalid_field` 的两条触发条件（§3.1 / §4.5）──
 *   ① `stageName`（或其同义别名 `createStageIfMissing`）与 `stageId` **同传**（互斥）；
 *   ② 落点名**出现但值为空/仅空白** → 400，**绝不静默降级为「未声明」**（坑 C7）。
 *      显式声明却给空名称 = 调用方 bug；静默当没声明，会把 bug 掩盖成「任务落在了别的阶段」。
 *
 * ── 为什么用一个插件作用域（`app.register`）而不是直接挂在 app 上 ──
 * 只想让**本组端点**拥有自己的错误形状映射（§3.1 的 400 `too_large`）。Fastify 的错误
 * 处理器是**封装作用域**语义：在本作用域里 setErrorHandler，只影响本组路由，
 * `registerProjectRoutes` 等既有路由一个字节都不受影响 —— 这比改 `server/index.ts` 的
 * 全局处理器（那会改变全站行为）安全得多。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

import { AGENT_SEAT_LIMIT } from '../../src/constants/agentTerms';
// ★ 落库编排与落点解析**都是共享内核**：NAS 形态与本地手动粘贴通道跑的是同一份函数。
import { applyAgentPayload, previewAgentPayload } from '../../src/core/agent/payload.apply';
import type { ApplyOptions } from '../../src/core/agent/payload.apply';
import { validateAgentPayload } from '../../src/core/types/agent-payload';
import type { AgentPayloadV1 } from '../../src/core/types/agent-payload';
import { ChangxiaError, ChangxiaErrorCode } from '../../src/core/types/enums';
import type { AgentRouteDelegate } from '../adapters/sqlite.bundle';
import { createSqliteBundle } from '../adapters/sqlite.bundle';
import { agentUnauthorizedBody, requireAgentToken } from '../lib/agent-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `GET /api/tasks` 返回行的**读取侧最小形状**（只声明本端点真正读到的字段）。
 *
 * 刻意不 import `tasks.routes.ts` 的 `rowToTask`：它**未导出**（该文件写锁属 T01）。
 * 也不抄一遍完整映射 —— 这里只做「从既有端点的产物里取 6 个字段」，多一个字段都不读，
 * 因此不存在第二份字段口径；字段一旦改名，这个接口会在编译期红。
 */
interface AgentTaskListRow {
  id: string;
  externalId: string | null;
  taskNo: number | null;
  title: string;
  status: string;
  dueDate: string | null;
  /** 落库形状：存的是 **Task.id**（不是 externalId），见下方反查注释 */
  dependsOn: string[];
}

/**
 * 应用版本（四段 `x.y.z.build`）。
 *
 * ★ **取 `version.json`，绝不取 `package.json` 的 semver**（§3.2 明文）。
 *   两者在本项目里是脱节的：`package.json` 停在 semver（如 `0.6.0`），而用户看到、
 *   备份里记、升级检测比的是 `version.json` 的四段号。取错了，Skill 会拿一个
 *   从未发布过的版本号去判断「要不要升级」。`electron/main.cjs` 已经踩过这条注释。
 *
 * 读失败（安装损坏 / 文件被删）→ `'unknown'`：**不**回落到 package.json，
 * 也不让探活整体 500 —— 「服务活着但报告不了版本」比「探活直接失败」信息量大。
 */
function readAppVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', 'version.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 进程内缓存一次即可：版本号在一次运行里不会变（升级 = 重启） */
const APP_VERSION = readAppVersion();

/** 声明式「键存在」判断：`?stageName=` 与「没有这个参数」必须区分开（前者是调用方 bug） */
function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 非空非纯空白字符串（`query` 的值可能是数组/对象，一律判否 → 上游按 invalid_field 处理） */
function isNonBlank(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 从 query 里取一个「可选的非空字符串」（空串 / 纯空白 / 非字符串 → undefined） */
function optionalString(v: unknown): string | undefined {
  return isNonBlank(v) ? v : undefined;
}

/**
 * 注册 `/api/agent/*`（v0.7 · T02）。
 *
 * 调用点：`server/index.ts` 在既有 5 组路由之后调用（Agent 通道需要
 * `POST /api/tasks/upsert` 等既有处理器已注册，见下 `delegate`）。
 */
export function registerAgentRoutes(app: FastifyInstance, db: Database.Database): void {
  /**
   * 委托目标：把适配器需要的既有处理器调用收在一处（策略 B，理由见 sqlite.bundle 文件头）。
   *
   * `app.inject` 是**进程内**派发（不过 socket、不占端口），因此这里等价于
   * 「直接调那个 handler」，只是中间多一次 JSON 往返 —— 换来的是**只有一份**
   * 幂等 upsert / 成员映射实现。
   */
  const delegate: AgentRouteDelegate = {
    async inject(opts) {
      const res = await app.inject({ method: opts.method, url: opts.url, payload: opts.payload });
      return { statusCode: res.statusCode, body: res.body, json: <T>() => res.json<T>() };
    },
  };

  const bundle = createSqliteBundle(db, delegate);

  /** 项目候选清单（探活与 `project_unresolved` 共用：`{id,name}`，按名称排序） */
  const listProjectCandidates = (): Array<{ id: string; name: string }> =>
    db.prepare('SELECT id, name FROM projects ORDER BY name').all() as Array<{
      id: string;
      name: string;
    }>;

  /** `?projectName=` 解析：先精确匹配，再「去空白 + 忽略大小写」匹配；都无 → null */
  const findProjectIdByName = (name: string): string | null => {
    const all = listProjectCandidates();
    const exact = all.find((p) => p.name === name);
    if (exact) return exact.id;
    const wanted = name.trim().toLowerCase();
    return all.find((p) => p.name.trim().toLowerCase() === wanted)?.id ?? null;
  };

  /** `invalid_field` 的统一出口（§3.1 新增错误码） */
  const invalidField = (userMessage: string): { error: { code: string; userMessage: string } } => ({
    error: { code: 'invalid_field', userMessage },
  });

  // 本作用域独占的错误形状映射：只影响 /api/agent/*，既有路由不受任何影响
  void app.register(async (scope) => {
    scope.setErrorHandler((err, _req, reply) => {
      const code = String((err as { code?: string }).code ?? 'internal');
      // §3.1 的 400 `too_large`：由 Fastify 的 bodyLimit 在**进入 handler 之前**抛出，
      // 因此不可能在 handler 里 try/catch 到，只能在这里映射（HTTP 413 → 契约的 400）。
      if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        void reply.status(400).send({
          error: { code: 'too_large', userMessage: '导入内容过大，请拆分后分批同步。' },
        });
        return;
      }
      const userMessage =
        (err as { userMessage?: string }).userMessage ?? err.message ?? '服务器内部错误';
      void reply.status(err.statusCode ?? 500).send({
        error: { code: code === 'internal' ? 'internal' : code, userMessage },
      });
    });

    /* ======================================================================================
     * ① POST /api/agent/import —— §3.1
     * ==================================================================================== */
    scope.post('/api/agent/import', async (req, reply) => {
      if (!requireAgentToken(req)) {
        void reply.status(401);
        return agentUnauthorizedBody();
      }

      const query = (req.query ?? {}) as Record<string, unknown>;

      /* ── body 校验：schema 不变（决策 2 走 query，正是不改 schema 的原因） ── */
      let payload: AgentPayloadV1;
      try {
        payload = validateAgentPayload(req.body);
      } catch (err) {
        if (err instanceof ChangxiaError) {
          void reply.status(400);
          // 契约里的机器码是 `Validation`（§3.1 Responses 块逐字），不是内部枚举值 'validation'
          return { error: { code: 'Validation', userMessage: err.userMessage } };
        }
        throw err;
      }

      /* ── 落点名：主名 stageName + 同义别名 createStageIfMissing（共用同一分支，§3.1） ── */
      const hasMain = hasOwn(query, 'stageName');
      const hasAlias = hasOwn(query, 'createStageIfMissing');
      const mainRaw = hasMain ? query.stageName : undefined;
      const aliasRaw = hasAlias ? query.createStageIfMissing : undefined;

      // ② 出现但空 → invalid_field（**不静默降级**
      //    为「未声明」：那样会把调用方的 bug 掩盖成「任务落到了别的阶段」，坑 C7）
      if (hasMain && !isNonBlank(mainRaw)) {
        void reply.status(400);
        return invalidField(
          'query 参数 stageName 出现但值为空/仅空白；显式声明落点阶段名时不能给空名称（系统不会把它当作「未声明」）。',
        );
      }
      if (hasAlias && !isNonBlank(aliasRaw)) {
        void reply.status(400);
        return invalidField(
          'query 参数 createStageIfMissing 出现但值为空/仅空白；显式声明落点阶段名时不能给空名称（系统不会把它当作「未声明」）。',
        );
      }
      // 同义别名：同传且**值不同** → invalid_field；值相同 → 接受（§4.5 失败矩阵的两行）
      if (hasMain && hasAlias && mainRaw !== aliasRaw) {
        void reply.status(400);
        return invalidField(
          'query 参数 stageName 与 createStageIfMissing 同传但取值不同：两者是同义别名，取值必须一致。',
        );
      }
      const declaredName: string | undefined = hasMain
        ? (mainRaw as string)
        : hasAlias
          ? (aliasRaw as string)
          : undefined;

      /* ── ① 互斥：落点名 与 stageId（query 或 body 任一）不可同传（§4.2 决策树第一问） ── */
      const queryStageId = optionalString(query.stageId);
      const bodyStageId = optionalString(payload.stageId);
      if (declaredName !== undefined && (queryStageId !== undefined || bodyStageId !== undefined)) {
        void reply.status(400);
        return invalidField(
          `落点阶段名与 stageId 互斥（${queryStageId !== undefined ? '?stageId' : 'body.stageId'} 与落点名同传）：` +
            '语义重叠说明调用方对落点不确定，系统报错而不是猜测。',
        );
      }

      /* ── 项目解析：**只放开阶段，绝不放开项目**（§4.5 第一行） ── */
      const queryProjectId = optionalString(query.projectId);
      const queryProjectName = optionalString(query.projectName);
      let targetProjectId: string | null = isNonBlank(payload.projectId)
        ? payload.projectId
        : (queryProjectId ?? null);
      if (targetProjectId === null && queryProjectName !== undefined) {
        targetProjectId = findProjectIdByName(queryProjectName);
        if (targetProjectId === null) {
          void reply.status(400);
          return {
            error: {
              code: 'project_unresolved',
              userMessage: `未找到名为「${queryProjectName}」的项目，请先在 ID Plan 中确认项目名称。`,
              projects: listProjectCandidates(),
            },
          };
        }
      }
      if (targetProjectId === null) {
        void reply.status(400);
        return {
          error: {
            code: 'project_unresolved',
            userMessage:
              '未指定目标项目（body.projectId / ?projectId / ?projectName 均为空），无法导入。',
            projects: listProjectCandidates(),
          },
        };
      }
      const projectExists = db
        .prepare('SELECT id FROM projects WHERE id = ?')
        .get(targetProjectId) as { id: string } | undefined;
      if (!projectExists) {
        void reply.status(400);
        return {
          error: {
            code: 'project_unresolved',
            userMessage: `目标项目（id=${targetProjectId}）不存在，可能已被删除，请重新选择。`,
            projects: listProjectCandidates(),
          },
        };
      }

      /* ── query 的 stageId 是「批次级覆盖」，优先于 body.stageId（§3.1 query 说明） ── */
      const effectiveStageId: string | null = queryStageId ?? bodyStageId ?? null;
      const effectivePayload: AgentPayloadV1 = { ...payload, stageId: effectiveStageId };

      /**
       * `dryRun` 的判定刻意**偏向安全**：出现且不是 `'0'` / `'false'` 就按「只算不写」处理。
       *
       * 理由：若按「严格等于 '1' 才算 dryRun」实现，调用方写 `?dryRun=true`（很自然的写法）
       * 会被**当成实写**——用户以为只是在预览，库里已经落了一批任务和一个新阶段。
       * 反过来（把意外值当 dryRun）最坏只是「没写进去」，用户重试即可。
       * 两个方向的代价不对称，故取保守方向。
       */
      const dryRunRaw = query.dryRun;
      const dryRun =
        dryRunRaw !== undefined && dryRunRaw !== '' && dryRunRaw !== '0' && dryRunRaw !== 'false';

      const opts: ApplyOptions = { projectId: targetProjectId, stageName: declaredName ?? null };

      try {
        // ★ 回执**原样转发** `ApplyResult`（含 `stage` 四键恒定 / R5 的 impact 白名单）：
        //   任何「在这里补一刀」的加工都会让 NAS 与本地两条通道的回执发生漂移。
        return dryRun
          ? await previewAgentPayload(bundle, effectivePayload, opts)
          : await applyAgentPayload(bundle, effectivePayload, opts);
      } catch (err) {
        if (err instanceof ChangxiaError) {
          if (err.code === ChangxiaErrorCode.Validation) {
            void reply.status(400);
            return { error: { code: 'Validation', userMessage: err.userMessage } };
          }
          if (err.code === ChangxiaErrorCode.NotFound) {
            void reply.status(400);
            return {
              error: {
                code: 'project_unresolved',
                userMessage: err.userMessage,
                projects: listProjectCandidates(),
              },
            };
          }
          void reply.status(500);
          return { error: { code: 'internal', userMessage: err.userMessage } };
        }
        throw err; // 交给本作用域的错误处理器（500 {error:{code,userMessage}}）
      }
    });

    /* ======================================================================================
     * ② GET /api/agent/health —— §3.2
     * ==================================================================================== */
    scope.get('/api/agent/health', async (req, reply) => {
      if (!requireAgentToken(req)) {
        void reply.status(401);
        return agentUnauthorizedBody();
      }
      const used = db
        .prepare("SELECT COUNT(*) AS n FROM members WHERE actor_kind = 'agent' AND active = 1")
        .get() as { n: number };
      return {
        ok: true,
        version: APP_VERSION,
        projects: listProjectCandidates(),
        agentSeats: { used: used.n, limit: AGENT_SEAT_LIMIT },
      };
    });

    /* ======================================================================================
     * ③ GET /api/agent/tasks?projectId=&source=agent|human|all —— §3.3
     * ==================================================================================== */
    scope.get('/api/agent/tasks', async (req, reply) => {
      if (!requireAgentToken(req)) {
        void reply.status(401);
        return agentUnauthorizedBody();
      }
      const q = (req.query ?? {}) as Record<string, unknown>;
      const projectId = optionalString(q.projectId);
      // `source` 复用既有 `TaskQuery.source` 语义（'human' | 'agent'）；缺省/`all` = 不过滤。
      // 直接把这个过滤条件透给既有 `GET /api/tasks`（同一份过滤实现）。
      const source = optionalString(q.source);

      const params = new URLSearchParams();
      if (projectId !== undefined) params.set('projectId', projectId);
      if (source === 'agent' || source === 'human') params.set('source', source);
      const qs = params.toString();

      // 委托既有 `GET /api/tasks`：其行→实体映射（`rowToTask`）**未导出**，抄一份映射
      // 就是第二份字段口径（漏一个 `?? null` 即静默 undefined 泄漏）。
      const res = await delegate.inject({ method: 'GET', url: `/api/tasks${qs ? `?${qs}` : ''}` });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        void reply.status(500);
        return {
          error: {
            code: 'internal',
            userMessage: `读取任务清单失败（HTTP ${res.statusCode}）：${res.body}`,
          },
        };
      }
      const rows = res.json<AgentTaskListRow[]>();

      /**
       * `dependsOn` 里存的是 **Task.id**（落库形状），而契约要求的 `dependsOnExternal`
       * 是 **externalId** —— 因为 Skill 拿到这份清单后要把它**回喂进 payload**，
       * 而 payload 的依赖字段只认 externalId（`dependsOnExternal`）。
       * 故这里做一次 id → externalId 反查；查不到的（人工任务没有 externalId）
       * **从结果里剔除**：人工任务不可能出现在 payload 的依赖里，留着 id 只会让 Skill
       * 拿一个永远解不到的键去发请求，最终得到一片 `dep_unresolved`。
       */
      const idToExternal = new Map<string, string>();
      for (const r of rows) {
        if (r.externalId) idToExternal.set(r.id, r.externalId);
      }

      return {
        tasks: rows.map((r) => {
          const deps: string[] = [];
          for (const depId of r.dependsOn ?? []) {
            const ext = idToExternal.get(depId);
            if (ext && !deps.includes(ext)) deps.push(ext); // 去重：重复依赖在 payload 里无意义
          }
          return {
            // 人工任务没有幂等键 → `null`（契约允许；Skill 侧展示 `—`）
            externalId: r.externalId,
            taskNo: r.taskNo, // ★ 老数据可能为 null（契约允许）
            title: r.title,
            status: r.status,
            dueDate: r.dueDate,
            dependsOnExternal: deps,
          };
        }),
      };
    });
  });
}
