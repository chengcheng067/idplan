/**
 * server/routes/agent.routes.ts（v0.7 · T02 · 设计文档 §3.1 / §3.2 / §3.3 / §3.4；
 * v0.8 · T04-SRV 追加 §7.6「定向反转」与 §7.4「接管边界」）—— 写入通道与建板的服务端落点。
 *
 * ── 四个端点 ──
 *   `POST /api/agent/import`  —— 幂等导入 Agent payload（含「显式声明落点阶段名」）
 *   `GET  /api/agent/health`  —— 探活（版本 / 项目清单 / Agent 席位）
 *   `GET  /api/agent/tasks`   —— 只读任务流（含 `dependsOnExternal`，供 Skill 回喂 payload）
 *   `POST /api/agent/boards`  —— ★ v0.8 **建 Agent 看板**（含阶段骨架）。**只新建**：
 *      它不接受 `projectId` / `projectName`，也没有任何通往「已有项目」的写路径 ——
 *      「AI 不能碰人类项目」在这条通道上是**结构性**的（见该 handler 的段首注释）。
 *
 * ── v0.8 §7.6「定向反转」的两半（都要，缺一不可）──
 *   ① **放开建板**：AI 能建 `kind='agent'` 的看板（含阶段骨架），阶段来源复用
 *      `templates/stage-library.json` 的 18 套餐 / 56 阶段项；
 *   ② **仍然不放开人类项目**：`listProjectCandidates()` 收窄为只列 `kind='human'`，
 *      于是 `?projectName=` 解析**永不可能**命中 Agent 看板（详见该函数的注释）。
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
import { applyAgentPayload, previewAgentPayload, resolveAgentProjectId } from '../../src/core/agent/payload.apply';
import type { ApplyOptions } from '../../src/core/agent/payload.apply';
// ★ v0.8 建板：**自定义阶段**的属性表只有一份（`buildCreatedStage`，§4.3 逐字段定死）
import { buildCreatedStage } from '../../src/core/agent/stage-resolve';
import { validateAgentPayload } from '../../src/core/types/agent-payload';
import type { AgentPayloadV1 } from '../../src/core/types/agent-payload';
import { ChangxiaError, ChangxiaErrorCode, StageStatus } from '../../src/core/types/enums';
import type { ProjectKind } from '../../src/core/types/enums';
import type { StageTemplateItem } from '../../src/core/types/dto';
import type { Project, Stage } from '../../src/core/types/entities';
/**
 * ★ 阶段骨架的**唯一数据源**：`templates/stage-library.json` 的强类型访问器。
 *
 * 绝不在这里（或任何地方）再抄一份「套餐 → 阶段名」映射：那份映射是**第二份字段口径**，
 * 一旦某个套餐在 JSON 里增删了一项，抄件不会跟着变 —— 而症状是「AI 建的看板少了一段」，
 * 不报错、不崩。本文件 `GET /api/agent/tasks` 的注释里已有同款教训（抄映射 = 第二份口径）。
 */
import {
  getPreset,
  getPresetItems,
  getStageLibraryItems,
  getStageLibraryVersion,
} from '../../src/core/template/stage-library';
/**
 * 阶段上限与色号夹取也**只有一份实现**（不写字面量 `20` / `9`）：`split.ts` 是它们的
 * 唯一定义处，改常量即跟随（该文件列出全部消费点）。建板是本轮新增的第 N 个消费点。
 */
import { MAX_STAGE_COUNT, stageColorIndex } from '../../src/core/template/split';
/**
 * 阶段名归一（判重键）**只有一份实现**：与导入通道「按名选点」用的是同一份算式
 * （`task-no.ts`，前后端逐字一致）。建板时用它做**请求内去重**，于是
 * `提案` 与 `提案。` 不会被建成两段（同一份身份判定，两处不会漂移）。
 */
import { normalizeStageName } from '../../src/core/lib/task-no';
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

  /**
   * 项目候选清单（探活与 `project_unresolved` 共用：`{id,name}`，按名称排序）。
   *
   * ★ v0.8 §7.6「定向反转」：**只列人类项目**（`kind = 'human'`）。
   *
   * 这一条 SQL 同时、且**结构性**地解决了 v0.8 的两个需求 —— 不是两处规则，
   * 而是同一个事实的两个面：
   *   ① §7.2 #26「候选清单只列人类项目」（注意是 `'human'`，**不是** `'agent'`）：
   *      这份清单是给调用方（Skill）**选落点**用的，它只允许往人类项目写任务；
   *   ② §7.6 / §7.3 #26「`?projectName=` 永不可能解析到 Agent 看板」：
   *      `findProjectIdByName()` **复用同一份清单**，故 Agent 看板名根本不进候选集
   *      ⇒ 按名解析必然落空 ⇒ 走既有的 `project_unresolved` 分支 ⇒ **零写入**（PRD B7 末句）。
   *
   * ★ 为什么**不**再加一段「若解析到 agent 就拒绝」的分支：
   *   那会把「结构上不可能命中」降级为「运行时校验挡住」，同一个不变式于是有**两处规则**，
   *   两处迟早漂移（改一处忘另一处 = AI 又能写人类项目，而且没有任何测试会发现）。
   *   一句话记住：**零写入是结构性的，不是校验出来的** —— 候选集里根本没有 Agent 看板，
   *   就无所谓「命中之后再拦住」。
   *
   * 影响面（有意如此，非副作用）：本函数被 5 处引用 —— `findProjectIdByName`（落点解析）、
   * 三处 `project_unresolved` 诊断载荷（`:256/:268/:281/:322`）与健康探活的 `projects`
   * 字段（`:347`）。全部**剩人类项目**正是 §7.2 #26 的期望行为：诊断载荷里的候选清单
   * 若混着 Agent 看板，反而是在诱导调用方去选一个「一定会被拒绝」的落点。
   *
   * ⚠️ 用等值 `kind = 'human'` 而**不是** `kind <> 'agent'`：后者会把将来可能出现的
   *   第三种 kind 悄悄放进候选集（隔离谓词的默认方向必须是「排除在候选外」，
   *   而不是「除非明确标记为 agent」）。老库经 `migrateColumns` 补列后由 DDL 的
   *   `NOT NULL DEFAULT 'human'` 补齐，故不存在 `kind IS NULL` 的行。
   */
  const listProjectCandidates = (): Array<{ id: string; name: string }> =>
    db
      .prepare("SELECT id, name FROM projects WHERE kind = 'human' ORDER BY name")
      .all() as Array<{
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

      // ★ fail-closed（安全门禁）：query.projectId 与 payload.projectId 同时给出且不一致 →
      //   400，**绝不发生任何写入**（调用方以为写项目 A、实际可能写项目 B = 静默写错项目）。
      //   两者一致 / 仅一方给出 → 返回该 id；都未给出 → null（交由下方 ?projectName / project_unresolved）。
      let targetProjectId: string | null;
      try {
        targetProjectId = resolveAgentProjectId({
          payloadProjectId: payload.projectId,
          externalProjectId: queryProjectId,
        });
      } catch (err) {
        if (err instanceof ChangxiaError && err.code === ChangxiaErrorCode.Validation) {
          void reply.status(400);
          return { error: { code: 'Validation', userMessage: err.userMessage } };
        }
        throw err;
      }
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

    /* ======================================================================================
     * ④ POST /api/agent/boards —— v0.8 §7.6 / PRD B7 · B8 · B9
     *
     * ── 这个端点为什么是「定向反转」而不是「放开项目」 ──
     * v0.7 的 N7 铁律是「**只放开阶段，绝不放开项目**」。v0.8 要 AI 能建 Agent 看板，
     * 于是必须放开**一件事**：新建一个 `kind='agent'` 的看板。放开的方式是**另起一条只有
     * 创建语义的通道**，而不是把项目解析（`projectId` / `projectName`）放开 ——
     * 后者会让「AI 写人类项目」重新变成可能。
     *
     * ★★ 「写进人类项目」在本端点**没有对应的代码路径**（结构性，不是靠校验兜住）：
     *   · 本 handler **不接受** `projectId` / `projectName`（出现即 400，见下）；
     *   · 新看板的 id 由既有 `POST /api/projects` 在服务端生成（本 handler **不传 id**），
     *     因此这里不存在「拿外部传入的 id 去写某条已存在的行」这种操作；
     *   · 本文件里**没有任何一条**写 `projects` 的 SQL（只有两处只读 SELECT：候选清单与
     *     项目存在性判断）。全仓 `server/` 写 `projects` 的语句全部集中在
     *     `projects.routes.ts`：`INSERT`（创建）、`UPDATE … SET kind=?`（**唯一**改归属侧的
     *     路径，被 §7.4 的显式意图门守着）、`UPDATE … SET status`（归档）、`DELETE`（销毁）。
     *   换句话说：本端点的**形状**就决定了它只能新建。下面那两条针对 `projectId` /
     *   `projectName` 的 400 是**把调用方的误解说清楚**，不是安全边界。
     *
     * ── 校验顺序：fail fast，绝不猜（PRD B9）──
     *   ① token 无效 → 401（fail-closed）
     *   ② name 缺失/空白 → 400 invalid_field
     *   ③ plannedStartAt / plannedEndAt 缺失/空白 → 400 invalid_field（**绝不默认一个日期**）
     *   ④ presetKey 与 stageNames 都没给或都为空 → 400 invalid_field（阶段集合必填）
     *   ⑤ presetKey 给了但库里查不到 → 400 invalid_field
     *   ⑥ 展开后的阶段数 > MAX_STAGE_COUNT（20）→ 400 invalid_field
     * 全部校验通过后**才开始写**（零写入的失败路径不产生任何残留）。
     * ==================================================================================== */
    scope.post('/api/agent/boards', async (req, reply) => {
      if (!requireAgentToken(req)) {
        void reply.status(401);
        return agentUnauthorizedBody();
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      /* ── 0. 只新建：显式拒收落点解析参数（结构说明见段首注释） ── */
      if (hasOwn(body, 'projectId') || hasOwn(body, 'projectName')) {
        void reply.status(400);
        return invalidField(
          '建板通道**只新建**看板，不接受 projectId / projectName（那是导入通道的落点解析参数）。' +
            '要往已有项目写任务，请用 POST /api/agent/import。',
        );
      }

      /* ── ① name：必填、非空白 ── */
      const rawName = body.name;
      if (!isNonBlank(rawName)) {
        void reply.status(400);
        return invalidField(
          '建板必须显式声明看板名称（body.name 缺失 / 为空 / 仅空白）：系统不会替你取一个默认名字。',
        );
      }
      const name = rawName.trim();

      /* ── ② 起止日期：必填、非空白（★ PRD B9：**不得默认一个日期**） ── */
      const rawStart = body.plannedStartAt;
      if (!isNonBlank(rawStart)) {
        void reply.status(400);
        return invalidField(
          '建板必须显式声明计划开始日期（body.plannedStartAt 缺失 / 为空 / 仅空白）。' +
            '系统**不会替你猜一个日期**：默认日期会静默造出一条错误的排期，' +
            '而错误的排期比一条明确的报错危险得多。',
        );
      }
      const rawEnd = body.plannedEndAt;
      if (!isNonBlank(rawEnd)) {
        void reply.status(400);
        return invalidField(
          '建板必须显式声明计划结束日期（body.plannedEndAt 缺失 / 为空 / 仅空白）。' +
            '系统**不会替你猜一个日期**（同 plannedStartAt）。',
        );
      }
      const plannedStartAt = rawStart.trim();
      const plannedEndAt = rawEnd.trim();

      /* ── ③ 阶段集合：presetKey / stageNames 至少给一个（「出现但空」≠「没给」，同 C7） ── */
      const rawPreset = body.presetKey;
      if (hasOwn(body, 'presetKey') && !isNonBlank(rawPreset)) {
        void reply.status(400);
        return invalidField(
          'body.presetKey 出现但值为空/仅空白；不指定套餐时请**完全不要传**该参数' +
            '（系统不会把它当作「没给」，因为那会把调用方的 bug 掩盖成「用了另一个阶段来源」）。',
        );
      }
      const presetKey: string | undefined = isNonBlank(rawPreset) ? rawPreset.trim() : undefined;

      const declaredNames: string[] = [];
      if (hasOwn(body, 'stageNames')) {
        const rawNames = body.stageNames;
        if (!Array.isArray(rawNames)) {
          void reply.status(400);
          return invalidField('body.stageNames 必须是字符串数组（显式声明的阶段名列表）。');
        }
        for (const entry of rawNames) {
          if (!isNonBlank(entry)) {
            void reply.status(400);
            return invalidField(
              'body.stageNames 里出现空/仅空白/非字符串的条目：显式声明阶段名时不能给空名称' +
                '（系统不会把它当作「没声明过这个阶段」）。',
            );
          }
          declaredNames.push(entry.trim());
        }
      }
      if (presetKey === undefined && declaredNames.length === 0) {
        void reply.status(400);
        return invalidField(
          '建板必须显式声明阶段集合：body.presetKey（内置套餐）或 body.stageNames（阶段名数组）' +
            '至少要给一个（两者可以同时给：先展开套餐骨架，再追加声明的名字）。',
        );
      }

      /* ── 阶段集合展开（**唯一数据源**：stage-library）──
       * 判重键用 `normalizeStageName`（与导入通道「按名选点」同一份算式）：
       * 同一次请求内同名只保留**首次出现**的那一条。归一值**只用于判重、绝不入库**
       * （落库名取「声明名 trim 后的原样文本」，与 §4.3 逐字同口径）。 */
      interface BoardStageSeed {
        /** 落库展示名 */
        nameDisplay: string;
        /** 库内命中的阶段项；null = 自定义阶段（templateKey 落 null） */
        item: StageTemplateItem | null;
      }
      const seeds: BoardStageSeed[] = [];
      const seenNames = new Set<string>();
      const pushSeed = (nameDisplay: string, item: StageTemplateItem | null): void => {
        const key = normalizeStageName(nameDisplay);
        if (seenNames.has(key)) return; // 请求内去重（保留首次出现）
        seenNames.add(key);
        seeds.push({ nameDisplay, item });
      };

      let domain: string | null = null;
      if (presetKey !== undefined) {
        const preset = getPreset(presetKey);
        if (!preset) {
          void reply.status(400);
          return invalidField(
            `未找到 key 为「${presetKey}」的阶段套餐（阶段库只认 templates/stage-library.json 里的套餐 key）。`,
          );
        }
        // 主板块 = 套餐声明的 domain（PRD B8 的「套餐骨架」自带行业归属）
        domain = preset.domain;
        for (const item of getPresetItems(presetKey)) pushSeed(item.name, item);
      }

      /* 声明的阶段名：**在库** → 用该项的 key/色号/占比（正常溯源）；
       * **不在库** → 自定义阶段（`item = null` → templateKey 落 null，PRD B8）。
       * 名字比对走 `normalizeStageName`（同一份身份判定）。库内存在**同名不同 domain**
       * 的阶段项（如「概念方案」在景观与建筑各有一条）时，取 JSON 声明顺序的**第一条** ——
       * 纯 stageNames 建板没有主板块可依据，刻意不引入 domain 偏好（不猜）。 */
      const libraryItems = getStageLibraryItems();
      for (const declared of declaredNames) {
        const declaredKey = normalizeStageName(declared);
        const hit =
          libraryItems.find((it) => normalizeStageName(it.name) === declaredKey) ?? null;
        pushSeed(declared, hit);
      }

      if (seeds.length === 0) {
        void reply.status(400);
        return invalidField('建板请求展开后没有任何阶段：阶段集合不能是空的。');
      }
      if (seeds.length > MAX_STAGE_COUNT) {
        void reply.status(400);
        return invalidField(
          `单次建板最多 ${MAX_STAGE_COUNT} 个阶段，本次展开后为 ${seeds.length} 个。`,
        );
      }

      /* ── 写 1/2：建项目（**委托既有 `POST /api/projects`**，不另写一份 INSERT）──
       * 为什么不自己写 SQL：那张表有 17 列，`projects.routes.ts` 明文警告「列清单 / VALUES /
       * 实参三处同改，漏一处就是运行期 too few/many parameters」。在这里再抄一份，
       * 就是**第二份项目字段口径** —— 下次加列必然漏一处（本仓库已反复因这类抄件返工）。
       *
       * ⚠️ 代价（如实记录）：`app.inject` 是异步的，无法并入 better-sqlite3 的同步事务，
       * 故「建项目 → 建阶段」不是单事务。阶段写入失败时返回 500，**只会**留下这条刚建的
       * agent 记录（一个无阶段的空看板），**绝不会**影响任何人类项目。用这个极小的残留窗口，
       * 换「项目 INSERT 只有一份实现」。 */
      const created = await delegate.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          // ★ 不传 id：新看板 id 由既有端点生成 ⇒ 本路径不存在「写某条已有行」的可能
          name,
          // type 是**商业标签**维度（PRD A7：显示层叫「标签」）。Agent 建板不声明它 ⇒
          // 落 'other'（枚举里的「其他」）；绝不冒充 'dining' —— 那是人工室内项目的默认标签，
          // 给一个 AI 看板贴上错误的商业维度，比留空更难发现。
          type: 'other',
          plannedStartAt,
          plannedEndAt,
          // 主板块：套餐 → 套餐声明的 domain；纯 stageNames 建板 → null（不猜主板块）。
          // 服务端**不做回落**（回落口径只在 `stage-fallback.ts` 一处，避免两套规则漂移）。
          domain,
          // ★ 归属侧恒 'agent'。这是「新建一条 agent 记录」，不是「把某条人类记录改成 agent」。
          //   末尾的 `satisfies ProjectKind` 是**编译期锚定**（运行时零开销、值不变）：归属侧
          //   只有 `enums.ts` 一处定义，若哪天有人把 `'agent'` 改名/删掉，本行当场红 —— 而不是
          //   静默把「类型系统里已不存在的值」写进 `projects.kind`（隔离谓词的判据）。
          kind: 'agent' satisfies ProjectKind,
          // 纯 stageNames 建板 → null：'custom' 是**人工建档**在阶段池里增删后的归属，
          // Agent 建板没走池子 ⇒ 落 null 更诚实。观感无差异：读时回落
          // `resolveProjectDomain(null)` 与 `resolveProjectDomain('custom')` 都落 indoor。
          stagePresetKey: presetKey ?? null,
          // 模板库版本：本端点确实查了库（判「名字在不在库」），如实记录版本号
          stageTemplateVersion: getStageLibraryVersion(),
        },
      });
      if (created.statusCode < 200 || created.statusCode >= 300) {
        void reply.status(500);
        return {
          error: {
            code: 'internal',
            userMessage: `建板失败：创建项目时被既有端点拒绝（HTTP ${created.statusCode}）：${created.body}`,
          },
        };
      }
      // 委托端点的响应就是 `rowToProject()` 的产物（与 `Project` 实体同键同形），故可直接当 Project 用
      const project = created.json<Project>();

      /* ── 写 2/2：建阶段（复用既有底层能力 `stages.bulkInsert`，与 payload.apply 同一条路径）──
       * 阶段起止日一律取**项目基线**：本端点只声明「名字 / 套餐」，没有任何阶段级日期信息，
       * 凭空切分属于「猜测」（`buildCreatedStage` 的 §4.3 属性表对阶段的日期口径正是
       * 「取项目基线是确定值，不引入猜测」）。刻意**不**建 `defaultTasks` ——
       * 契约只要求阶段骨架，任务由后续导入通道喂进来（PRD B10：建板只建一次阶段）。 */
      const now = new Date().toISOString();
      const rows: Stage[] = seeds.map((seed, idx) => {
        const orderIndex = idx + 1;
        if (!seed.item) {
          /* 自定义阶段（声明名不在库）：**复用 §4.3 的属性表**（`buildCreatedStage`）——
           * templateKey 落 null（N4 禁伪造 key）、colorIndex = clamp(orderIndex, 1, 9)、
           * ratioPercent 0、起止日取项目基线、visible true、status not_started。
           * 绝不在这里重抄这张表：抄一份就是第二份会漂移的口径（本仓库的固定教训）。 */
          return buildCreatedStage({
            id: `stg_${crypto.randomUUID()}`,
            project,
            declaredName: seed.nameDisplay,
            orderIndex,
          });
        }
        const item = seed.item;
        return {
          id: `stg_${crypto.randomUUID()}`,
          projectId: project.id,
          orderIndex,
          templateKey: item.key, // 库内真 key（正常溯源，不是伪造）
          // 色号夹取复用 split.ts 的唯一实现（不写字面量 1/9）
          colorIndex: stageColorIndex(item.colorIndex),
          // Agent 只声明名字/套餐，**不带颜色** ⇒ 用内置色（绝不凭空给一个用户色）
          customColor: null,
          // 落库名 = 声明名 trim 原样（与 §4.3 同口径：归一值只用于判重，绝不入库）
          name: seed.nameDisplay,
          ratioPercent: item.ratioPercent,
          startAt: project.plannedStartAt,
          endAt: project.plannedEndAt,
          status: StageStatus.NotStarted,
          ownerId: null,
          visible: true,
          resourcePath: null,
          revision: 1,
          updatedAt: now,
        };
      });
      await bundle.stages.bulkInsert(rows);

      void reply.status(201);
      return {
        projectId: project.id,
        name: project.name,
        // 键序与契约逐字一致：id → name → templateKey
        stages: rows.map((s) => ({ id: s.id, name: s.name, templateKey: s.templateKey })),
      };
    });
  });
}
