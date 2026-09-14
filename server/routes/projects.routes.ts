/**
 * Projects 路由（对齐 docs/api-contract.md）。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

// 共享内核（单份实现）：归属侧的**类型**出处。相对路径而非 `@core/*` alias ——
// 服务端由 `tsx` 直跑，`tsx` 不读 tsconfig 的 `paths`（见 server/tsconfig.json 文件头）。
import type { ProjectKind } from '../../src/core/types/enums';

interface ProjectRow {
  id: string;
  name: string;
  type: string;
  address: string;
  client_name: string;
  contract_amount: number | null;
  signed_at: string | null;
  planned_start_at: string;
  planned_end_at: string;
  cover_color: string | null;
  /** v0.7 侧栏方块简称（NULL = 未设置 → 前端读时回落项目名首字） */
  short_label: string | null;
  /** v2 阶段自定义字段（与 entities.Project 同构） */
  stage_preset_key: string | null;
  stage_template_version: number;
  schedule_basis: string;
  /**
   * v0.8 主板块（NULL = 未确认/老数据 → 前端 `resolveProjectDomain` 读时回落）。
   * 服务端不做回落：回落口径只在 `stage-fallback.ts` 一处，避免两套规则漂移。
   */
  domain: string | null;
  /** v0.8 归属侧。新库 DDL 有 `NOT NULL DEFAULT 'human'`，故读到的不会是 null */
  kind: string;
  status: string;
  revision: number;
  updated_at: string;
}

/**
 * snake_case 行 → 前端 camelCase 实体。
 * 键序与 entities.Project 一致（shortLabel 紧随 coverColor，domain/kind 紧随 scheduleBasis）
 * ——前端读取侧不做键序断言，但保持同序能让「人工比对两侧字段」这件事不需要额外心智负担。
 * `?? null` 兜底：老库（未跑 createDb 的极老实例 / 测试里手搓的表）读不到该列时为 undefined。
 */
export function rowToProject(r: ProjectRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    address: r.address,
    clientName: r.client_name,
    contractAmount: r.contract_amount,
    signedAt: r.signed_at,
    plannedStartAt: r.planned_start_at,
    plannedEndAt: r.planned_end_at,
    coverColor: r.cover_color,
    shortLabel: r.short_label ?? null,
    stagePresetKey: r.stage_preset_key ?? null,
    stageTemplateVersion: r.stage_template_version ?? 0,
    scheduleBasis: r.schedule_basis ?? 'calendar',
    domain: r.domain ?? null,
    // 老库可能没有该列（未跑过 createDb 的实例）→ 回落 'human'，与前端同口径，
    // 保证「服务端读到的项目」永远不会在 Agent 隔离谓词里被误判成 agent。
    kind: r.kind ?? 'human',
    status: r.status,
    revision: r.revision,
    updatedAt: r.updated_at,
  };
}

const nowIso = (): string => new Date().toISOString();

/** `invalid_field` 的统一出口（与 `/api/agent/*` 的机器码同形，见设计 §3.1） */
const invalidField = (userMessage: string): { error: { code: string; userMessage: string } } => ({
  error: { code: 'invalid_field', userMessage },
});

/**
 * 归属侧（`Project.kind`）的合法取值白名单。
 *
 * ⚠️ 为什么必须是 `as const satisfies readonly ProjectKind[]` 而**不是** `ReadonlyArray<string>`：
 * 后者让它完全脱离类型系统 —— 将来有人把 `ProjectKind` 里的 `'agent'` 改名或删掉，**服务端不会
 * 报错**，只会在运行时静默接受一个「类型系统里已不存在的值」，把它写进 `projects.kind`；而
 * `kind` 正是隔离谓词的判据 ⇒ 脏值等于把数据放进一个谁也看不见的桶（比报错难查得多）。
 * `satisfies` 让「本白名单 ⊆ `ProjectKind`」成为**编译期**约束：枚举侧一改，`tsc` 当场红。
 *
 * 为什么是**本地一份**而不是从 `src/core/types/enums.ts` 导入数组：`enums.ts` 只导出**类型**
 * `ProjectKind`（`:106`）与 `DEFAULT_PROJECT_KIND`（`:109`），**没有**运行时数组 —— 服务端若要
 * 「值」就只能自己声明一份。刻意**不**去 `enums.ts` 加数组：那是 T01 已冻结的跨端契约文件，
 * 在服务端任务里改它属于跨任务范围扩张（且会牵动前端 import 面）。
 *
 * ⚠️ 注意 `.includes()` 不能在 `readonly ['human','agent']` 上收 `string`，故**在调用点**放宽为
 * `readonly string[]`（见 `isProjectKind`）—— 放宽的是「查询参数」的类型，**不是白名单本身**，
 * 所以上面的漂移守卫依然生效。
 */
const PROJECT_KINDS = ['human', 'agent'] as const satisfies readonly ProjectKind[];

/** 值域判定（入参是任意 `string`，须能测「不在白名单」）。 */
const isProjectKind = (value: string): boolean =>
  (PROJECT_KINDS as readonly string[]).includes(value);

export function registerProjectRoutes(app: FastifyInstance, db: Database.Database): void {
  // GET /projects?status=&keyword=
  app.get('/api/projects', async (req) => {
    const { status, keyword } = req.query as { status?: string; keyword?: string };
    let rows = db.prepare('SELECT * FROM projects').all() as ProjectRow[];
    if (status && status !== 'all') rows = rows.filter((r) => r.status === status);
    if (keyword) {
      const kw = keyword.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          r.client_name.toLowerCase().includes(kw) ||
          r.address.toLowerCase().includes(kw),
      );
    }
    return rows.map(rowToProject);
  });

  // GET /projects/:id
  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!row) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '项目不存在' } };
    }
    return rowToProject(row);
  });

  // POST /projects
  app.post('/api/projects', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const id = (body.id as string) ?? crypto.randomUUID();
    const name = String(body.name ?? '').trim();
    if (!name) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '项目名称不能为空' } };
    }
    // ⚠️ 列清单与占位符个数必须逐一对齐（v0.8 起 17 个 ?）。加列时三处同改：
    //    列清单 / VALUES / .run() 实参，漏一处就是运行期 'too few/many parameters'。
    db.prepare(
      `INSERT INTO projects
        (id, name, type, address, client_name, contract_amount, signed_at,
         planned_start_at, planned_end_at, cover_color, short_label,
         stage_preset_key, stage_template_version, schedule_basis,
         domain, kind,
         status, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`,
    ).run(
      id,
      name,
      String(body.type ?? 'dining'),
      String(body.address ?? ''),
      String(body.clientName ?? ''),
      body.contractAmount == null ? null : Number(body.contractAmount),
      (body.signedAt as string | null) ?? null,
      String(body.plannedStartAt),
      String(body.plannedEndAt),
      (body.coverColor as string | null) ?? null,
      (body.shortLabel as string | null) ?? null,
      (body.stagePresetKey as string | null) ?? null,
      Number(body.stageTemplateVersion ?? 0),
      String(body.scheduleBasis ?? 'calendar'),
      // 主板块：不传 → NULL（服务端**不猜**，回落口径只在 stage-fallback 一处）
      (body.domain as string | null) ?? null,
      // 归属侧：不传 → 'human'。Agent 通道建板由 T04 显式传 'agent'（§7.6）。
      // 这里必须与 DDL 的 DEFAULT 同值——显式写入而非依赖 DEFAULT，读回才稳定。
      String(body.kind ?? 'human'),
      nowIso(),
    );
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow;
    return rowToProject(row);
  });

  // PATCH /projects/:id
  app.patch('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!existing) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '项目不存在' } };
    }
    const b = (req.body ?? {}) as Record<string, unknown>;

    /* ======================================================================================
     * v0.8 §7.4 · 「接管」的服务端边界（PRD B11/B12 · TBD-9/TBD-10 的 D5 口径）
     *
     * ── 设计文档要求的是什么 ──
     * 接管（Agent 看板 ⇄ 人类项目，即改 `kind`）要求**双层门**：
     *   ① 服务端 `assert`（**真正的安全边界**）；② UI 隐藏入口（体验层，**不是**安全边界）。
     * 领队 TBD-9 原文「UI 隐藏不是安全边界，这条对」⇒ 服务端这一层是**必做项**。
     *
     * ── ⚠️ 这条边界的**真实内容**与它的**局限**（如实写在这里，不粉饰）──
     * 本服务端**没有角色模型**：全仓 `server/` 唯一的鉴权是 Agent 通道的共享密钥
     * （`requireAgentToken`，且只覆盖 `/api/agent/*`），人类客户端的请求（本路由）**无鉴权**。
     * 因此「校验请求者是 admin」在当前架构下**不可能实现** —— 硬编码一个 header 就当管理员
     * 是自欺（任何客户端都能伪造）。
     *
     * 于是本层实现的是当前架构能支持的**最强边界：「显式意图」**——
     * 变更归属侧必须在请求体里**显式声明** `takeover === true`。它挡住的是**误操作**
     * （前端某处顺手带上 kind、批量脚本照搬字段映射把 `kind` 一起 PATCH 过去、
     * 旧客户端重放一份含 kind 的 payload），**不是**恶意调用方：本地单机部署模型下
     * 能发这个请求的人本来就能直接改库，这里不构成提权面。
     * 若将来服务端要暴露到多用户环境，**这里必须补真正的会话/角色校验** ——
     * 本注释就是留给那时的待办（不是「已实现 admin 校验」）。
     * ==================================================================================== */
    if (b.kind !== undefined) {
      const nextKind = String(b.kind);
      // ★ 只在**真的发生变化**时启用本门；kind 未变化（含完全没传）→ 与今天逐字一致，
      //   不引入任何新校验（零回归的硬要求：老客户端的普通 PATCH 不受任何影响）。
      if (nextKind !== existing.kind) {
        if (!isProjectKind(nextKind)) {
          void reply.status(400);
          return invalidField(
            `归属侧 kind 只接受 'human' / 'agent' 两个取值，收到「${nextKind}」。` +
              '（现状是原样透传，会把脏值写进库 —— 归属侧是隔离谓词的判据，脏值等于把数据放进一个谁也看不见的桶。）',
          );
        }
        if (b.takeover !== true) {
          void reply.status(400);
          return invalidField(
            '变更项目归属侧（kind）属于「接管」动作，必须显式声明接管意图（body.takeover === true）。' +
              '本服务端当前**没有角色模型**，因此这道门校验的是「显式意图」而不是「请求者身份」——' +
              '它能挡住误操作（顺手带上 kind 的字段级更新），但挡不住本来就拥有本机文件访问权的调用方。',
          );
        }
      }
    }

    // undefined = 不变（字段级更新语义），null = 显式清除。两态必须分开处理，
    // 否则「只改简称」的请求会把封面/阶段溯源字段一并擦掉。
    const merged: ProjectRow = {
      ...existing,
      name: b.name !== undefined ? String(b.name) : existing.name,
      type: b.type !== undefined ? String(b.type) : existing.type,
      address: b.address !== undefined ? String(b.address) : existing.address,
      client_name: b.clientName !== undefined ? String(b.clientName) : existing.client_name,
      contract_amount:
        b.contractAmount !== undefined ? (b.contractAmount as number | null) : existing.contract_amount,
      signed_at: b.signedAt !== undefined ? (b.signedAt as string | null) : existing.signed_at,
      cover_color: b.coverColor !== undefined ? (b.coverColor as string | null) : existing.cover_color,
      short_label:
        b.shortLabel !== undefined ? (b.shortLabel as string | null) : existing.short_label,
      stage_preset_key:
        b.stagePresetKey !== undefined
          ? (b.stagePresetKey as string | null)
          : existing.stage_preset_key,
      stage_template_version:
        b.stageTemplateVersion !== undefined
          ? Number(b.stageTemplateVersion)
          : existing.stage_template_version,
      schedule_basis:
        b.scheduleBasis !== undefined ? String(b.scheduleBasis) : existing.schedule_basis,
      // v0.8：domain 允许显式 null（= 清除，回到读时回落）；
      // kind 走 String() 而非原样透传——归属侧只有 human/agent 两个合法值。
      // ★ 变更合法性**已由本函数上方的「接管显式意图门」拦下**（值域白名单 + takeover === true），
      //   故这里只做「不写进非字符串」的收尾，不重复校验（两处规则必然漂移）。
      domain: b.domain !== undefined ? (b.domain as string | null) : existing.domain,
      kind: b.kind !== undefined ? String(b.kind) : existing.kind,
      status: b.status !== undefined ? String(b.status) : existing.status,
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      `UPDATE projects SET name=?, type=?, address=?, client_name=?, contract_amount=?,
        signed_at=?, cover_color=?, short_label=?, stage_preset_key=?, stage_template_version=?,
        schedule_basis=?, domain=?, kind=?, status=?, revision=?, updated_at=? WHERE id=?`,
    ).run(
      merged.name,
      merged.type,
      merged.address,
      merged.client_name,
      merged.contract_amount,
      merged.signed_at,
      merged.cover_color,
      merged.short_label,
      merged.stage_preset_key,
      merged.stage_template_version,
      merged.schedule_basis,
      merged.domain,
      merged.kind,
      merged.status,
      merged.revision,
      merged.updated_at,
      id,
    );
    return rowToProject(merged);
  });

  // POST /projects/:id/archive
  app.post('/api/projects/:id/archive', async (req) => {
    const { id } = req.params as { id: string };
    const { archived } = req.body as { archived: boolean };
    db.prepare(
      "UPDATE projects SET status=?, revision=revision+1, updated_at=? WHERE id=?",
    ).run(archived ? 'archived' : 'active', nowIso(), id);
    return { ok: true };
  });

  // DELETE /projects/:id —— 永久删除（级联清理阶段/任务/流水），不可恢复
  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(id) as
      | { id: string }
      | undefined;
    if (!exists) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '项目不存在或已删除' } };
    }
    const stageIds = (
      db.prepare('SELECT id FROM stages WHERE project_id = ?').all(id) as Array<{ id: string }>
    ).map((r) => r.id);
    const taskIds = (
      db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(id) as Array<{ id: string }>
    ).map((r) => r.id);
    const tx = db.transaction(() => {
      if (stageIds.length > 0) {
        db.prepare(`DELETE FROM stage_logs WHERE stage_id IN (${stageIds.map(() => '?').join(',')})`).run(...stageIds);
      }
      if (taskIds.length > 0) {
        db.prepare(`DELETE FROM assignments WHERE task_id IN (${taskIds.map(() => '?').join(',')})`).run(...taskIds);
        db.prepare(`DELETE FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`).run(...taskIds);
      }
      if (stageIds.length > 0) {
        db.prepare(`DELETE FROM stages WHERE id IN (${stageIds.map(() => '?').join(',')})`).run(...stageIds);
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  });
}
