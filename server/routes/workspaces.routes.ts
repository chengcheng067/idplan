/**
 * 工作区路由（多工作区 · NAS 版 · 批 3）：五个端点，对齐
 * `src/core/repositories/remote/rest.client.ts` 的 `RemoteWorkspacesRepo` 契约。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 端点清单（前端 `RemoteWorkspacesRepo` 逐条对应，改形状就是改契约）
 * ══════════════════════════════════════════════════════════════════════
 *   · `GET  /api/workspaces`                  → `{ workspaces: [{id,name,ownerMemberName,createdAt}] }`
 *   · `POST /api/workspaces`                  → `{ id, ownerMemberId }`（body `{name,ownerName,password}`）
 *   · `GET  /api/workspaces/:id/gate`          → `{ hasGate: boolean }`
 *   · `POST /api/workspaces/:id/gate/verify`   → 200 = 密码对 / **401 = 密码错**（body `{password}`）
 *   · `POST /api/workspaces/:id/gate`          → 204（body `{password, currentPassword?}`）
 *
 * `GET` 的 `{workspaces:[...]}` 外层是刻意的（不是裸数组）：工作区列表将来要能被
 * 服务端单独扩展出分页/计数而不改响应形状；解包只在前端那一次做（见其类注释）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 安全边界声明（**必须原样进发布文档**）★★
 * ══════════════════════════════════════════════════════════════════════
 * **区闸密码是「客户端门闸」，不构成服务端授权边界。**
 *
 * 说清楚这意味着什么，免得下一个人误以为这里有鉴权：
 *   · 知道 `/api` 地址的人**可以绕过**区闸密码 —— 他只需在请求里换一个
 *     `X-Workspace-Id`（或用别的客户端直接调 `/api/projects`），本文件的闸密校验
 *     根本不在那条路径上。闸密只挡「在 ID Plan 界面里点进某个区」这一步。
 *   · 因此本批的五个端点**不加 token 门**（与现有 projects / members 同格局：
 *     局域网内谁都能调）。真正要防「谁都能读全库」需要的是**服务端鉴权**，
 *     那是另一件事，本批不做，也不该被这段文字掩盖。
 *   · 反过来说：**别把敏感数据只靠区闸密码保护**。它的定位与桌面版一致 ——
 *     「防止同事顺手打开别人的公司」，不是「防止攻击者」。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 三条实现纪律
 * ══════════════════════════════════════════════════════════════════════
 * ① **不存在的区一律 404**，绝不回落 ws-default（否则 A 公司的请求会静默写进
 *    B 公司的库）。本文件的每个 `:id` 端点都先查注册表。
 * ② **建区失败必须带 `messageKey`**：`createWorkspace()` 抛的是内部英文诊断串
 *    （`WorkspaceCreateError.message`），**绝不能直接回给用户**。本文件按
 *    `err.field` 映射成 `serverErr.workspace.*` 八条取词键（见 `mapCreateError`）。
 * ③ **`verify` 用 401 表达「密码错」，不用 400/500**：前端 `rest.client.ts` 只把
 *    401 吞成 `false`，其余状态码会照常抛（那是真故障，不能伪装成「密码不对」，
 *    否则用户会一直重输密码而问题在 NAS）。
 */

import type { FastifyInstance } from 'fastify';

import { errorBody } from '../lib/server-error-text';
import {
  DEFAULT_WORKSPACE_ID,
  WorkspaceCreateError,
  createWorkspace,
  deriveOwnerMemberName,
  findWorkspace,
  listWorkspaces,
  openRegistry,
  readGateHash,
  setGatePassword,
  verifyGatePassword,
} from '../workspace-registry';
import type { ServerErrorKey } from '../lib/server-error-text';

/** 密码最短长度（与桌面版 UI 层校验同值；服务端只做下限防呆，不重复 UI 的复杂度规则） */
const MIN_PASSWORD_LENGTH = 4;

/**
 * `WorkspaceCreateError.field` → 取词键（**八条键与 field 的映射表，唯一出处**）。
 *
 * `storage` 覆盖一切未预期的落盘失败（含 SQLite 约束、磁盘满）—— 那一支的
 * 内部诊断在 `err.message` 里，日志可见；用户面只说「失败且没留残留」。
 */
const CREATE_ERROR_KEYS: Record<WorkspaceCreateError['field'], ServerErrorKey> = {
  name: 'serverErr.workspace.nameRequired',
  ownerName: 'serverErr.workspace.ownerNameRequired',
  password: 'serverErr.workspace.passwordRequired',
  dbFile: 'serverErr.workspace.dbFileConflict',
  storage: 'serverErr.workspace.createFailed',
};

/** 取请求体为对象（Fastify 的 body 可能是 undefined / 标量 / 数组） */
function bodyOf(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function registerWorkspaceRoutes(app: FastifyInstance): void {
  /**
   * `:id` 的前置：未登记 ⇒ 一律 404（铁律 ①）。
   *
   * 返回 `false` 表示已回过响应，调用方必须 `return`。
   *
   * ⚠️ 刻意不区分「id 格式非法」与「id 不存在」：两者都 404。区分会给出
   *    「这个 id 长得对但没登记」vs「格式就不对」的枚举信号，而工作区 id 不是秘密
   *    也不该被探测 —— 统一一个答案最省事也最不多话。
   */
  const ensureExists = (id: string, reply: import('fastify').FastifyReply): boolean => {
    if (findWorkspace(id, openRegistry()) !== null) return true;
    void reply.status(404).type('application/json').send(errorBody('not_found', 'serverErr.workspace.notFound'));
    return false;
  };

  /* ------------------------------- 列表 ------------------------------- */

  app.get('/api/workspaces', async () => {
    const registry = openRegistry();
    const rows = listWorkspaces(registry);
    return {
      workspaces: rows.map((w) => ({
        id: w.id,
        name: w.name,
        // Owner 显示名是**派生值**（该区库里首个 active+admin），不是注册表列 ——
        // 存量区的 `owner_member_id` 是 NULL。派生失败 ⇒ null（列表必须能出全表，
        // 一个区的库坏掉不该让整个列表 500）。
        ownerMemberName: deriveOwnerMemberName(w.id, registry),
        createdAt: w.createdAt,
      })),
    };
  });

  /* ------------------------------- 建区 ------------------------------- */

  app.post('/api/workspaces', async (req, reply) => {
    const b = bodyOf(req.body);
    const name = typeof b.name === 'string' ? b.name : '';
    const ownerName = typeof b.ownerName === 'string' ? b.ownerName : '';
    const password = typeof b.password === 'string' ? b.password : '';

    // 长度下限在**这里**判（不进 createWorkspace）：注册表模块是数据层，它的职责是
    // 「给什么就落什么」，产品口径（≥4 位）属于 API 层。这样将来若放开下限，
    // 只改这一处，不动数据层用例。
    if (password !== '' && password.length < MIN_PASSWORD_LENGTH) {
      void reply.status(400).type('application/json').send(errorBody('validation', 'serverErr.workspace.passwordRequired'));
      return;
    }

    try {
      const created = createWorkspace({ name, ownerName, password });
      // 201 + 精确两个字段（多给字段就是多一个前端会误用的形状）
      void reply.status(201);
      return { id: created.id, ownerMemberId: created.ownerMemberId };
    } catch (err) {
      if (err instanceof WorkspaceCreateError) {
        void reply.status(400).type('application/json').send(errorBody('validation', CREATE_ERROR_KEYS[err.field]));
        return;
      }
      // 未预期：交给全局错误处理器（兜底句 + serverErr.internal），不在这里吞
      throw err;
    }
  });

  /* ---------------------------- 闸密：读 ---------------------------- */

  app.get('/api/workspaces/:id/gate', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ensureExists(id, reply)) return;
    // `hasGate:false` ⇒ 前端引导「先设一个再进」（0017 口径），**不是**「无需验密直接进」
    return { hasGate: readGateHash(id, openRegistry()) !== null };
  });

  /* ---------------------------- 闸密：验 ---------------------------- */

  app.post('/api/workspaces/:id/gate/verify', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ensureExists(id, reply)) return;

    const b = bodyOf(req.body);
    const password = typeof b.password === 'string' ? b.password : '';

    // ★ 401 = 密码不对（前端只把 401 吞成 false，见文件头纪律 ③）。
    //   空密码同样走 401：与「密码不对」同形 —— 区分开等于告诉调用方「这里确实需要密码」。
    if (!verifyGatePassword(id, password, openRegistry())) {
      void reply.status(401).type('application/json').send(errorBody('unauthorized', 'serverErr.member.badPassword'));
      return;
    }
    return { ok: true };
  });

  /* ---------------------------- 闸密：写 ---------------------------- */

  app.post('/api/workspaces/:id/gate', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ensureExists(id, reply)) return;

    const b = bodyOf(req.body);
    const password = typeof b.password === 'string' ? b.password : '';
    const currentPassword = typeof b.currentPassword === 'string' ? b.currentPassword : undefined;

    if (password.length < MIN_PASSWORD_LENGTH) {
      void reply.status(400).type('application/json').send(errorBody('validation', 'serverErr.workspace.passwordRequired'));
      return;
    }

    const result = setGatePassword(id, password, currentPassword, openRegistry());
    if (result.ok === false) {
      if (result.reason === 'notFound') {
        // 前置 ensureExists 已挡过；这里仍然给 404（不假设前置一定跑过）
        void reply.status(404).type('application/json').send(errorBody('not_found', 'serverErr.workspace.notFound'));
        return;
      }
      // 旧密缺失 / 不符：都是「你的凭据不足以改这道闸」⇒ 401
      // （不是 400 参数错、也不是 403）。与 members/verify 同码，前端一条分支处理。
      const key =
        result.reason === 'currentPasswordRequired'
          ? 'serverErr.workspace.gateCurrentRequired'
          : 'serverErr.workspace.gateCurrentWrong';
      void reply.status(401).type('application/json').send(errorBody('unauthorized', key));
      return;
    }

    // 204：成功但无内容（前端 `setGate` 不读响应体）
    void reply.status(204);
    return null;
  });
}

/**
 * 本文件对外暴露的「默认区 id」再导出（供测试与将来的调用方少 import 一处）。
 * 真正的出处是 `workspace-registry.ts`（与桌面版 `src/lib/workspace-registry.ts` 同值）。
 */
export { DEFAULT_WORKSPACE_ID };
