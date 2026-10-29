/**
 * Members 路由（对齐 api-contract.md）。
 * v0.6 密码系统：
 *   - 服务端用 node:crypto scrypt 派生密码哈希（格式 `saltHex:hashHex`），只落库；
 *   - 实时接口（GET /api/members 等）只下发 hasPassword 布尔值，**绝不下发哈希本体**；
 *   - POST /api/members/verify → 服务端比对，200 通过 / 401 密码错误；
 *   - POST /api/members 与 PATCH /api/members/:id 接受可选 password（string 设密码 / null 清密码）。
 *
 * 为什么实时接口不下发哈希：scrypt 虽不可逆，但下发哈希 + 接口无鉴权 + 无限流，
 * 等于把离线暴力破解（针对弱密码）的原料直接递出去。只下发 hasPassword（是否设过密码），
 * 既满足前端「这个成员要不要弹密码框」的判断，又不泄露任何可用于爆破的内容。
 *
 * 例外：GET /api/backup 的备份通道**保留**哈希（它走 meta.routes.ts 的 rowToDto 全列 dump，
 * 不经过本文件的 rowToMember）。备份是用户主动导出、自行保管的本地文件，暴露面与
 * 「任何能连到 NAS 端口的人调一下 GET 就拿到全部哈希」完全不同；且移除会让备份还原后
 * 成员密码全部失效，属于功能回归。两者风险等级不同，故区别对待。
 *
 * v1.0.0.0020 · 删除成员：新增 `DELETE /api/members/:id`（body 可选 `{ reassignTo }`）。
 *   在此之前**只有软停用**（`PATCH { active:false }`），名册上永远删不掉人。
 *   语义与 local 适配器（`local.members.repo.ts` 的同名方法）逐条一致：
 *   一个事务里 ①按 reassignTo 改写 tasks / stages / projects 三处引用 ②删 members 行。
 *   ⚠️ `assignments` 表**一个字都不碰** —— 那是 append-only 审计流水，
 *   改写它等于伪造「这人从没被指派过」，删除它等于销毁审计。
 *
 * ⚠️ **本文件所有写端点（含新增的 DELETE）目前无鉴权**，与 projects / stages / tasks
 *   同格局：这些端点在局域网信任基线（架构待确认 7）下不校验 Bearer，只有
 *   settings / logs / contracts 七端点归 `guardWrite` 管（见 `meta.routes.ts`）。
 *   本批**保持现状不改**（给 members 单独加门会让「能改成员密码、却不能删成员」
 *   这种半边收口的形态出现，比统一开口更难解释）；要收就整族一起收。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { errorBody } from '../lib/server-error-text';
// v1.0（多工作区 NAS 版 · 批 1）：scrypt 哈希/比对抽到 lib/password-hash.ts ——
// 区闸密码（server/workspace-registry.ts）与成员密码必须是**同一套**参数与格式，
// 否则会出现「成员密码能验、区闸密码永远验不过」这种只在切区那一刻暴露的故障。
// 两个函数体逐字搬运过去，行为零变化（POST /api/members/verify 的用例守着）。
import { hashPassword, verifyPassword } from '../lib/password-hash';
// `assignee_ids` 是 JSON 数组串（schema.sql 的 tasks 注释），改写时**必须**
// 解析→过滤→回写；字符串替换会把 '["m1","m12"]' 里的 m1 误中 m12 的片段。
import { parseJsonArray, serializeAssigneeIds } from '../lib/json-columns';

interface MemberRow {
  id: string;
  name: string;
  role: string;
  contact: string | null;
  avatar_color: string;
  active: number;
  /** v0.2 角色种类：'admin' | 'member' */
  role_kind: string;
  /** v0.6 密码哈希（服务端私有，不下发客户端） */
  password_hash: string | null;
  /** v0.6 Agent 身份（键序与 entities.Member 一致：password_hash 后、revision 前） */
  actor_kind: string;
  agent_kind: string | null;
  revision: number;
  updated_at: string;
}

function rowToMember(r: MemberRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    contact: r.contact,
    avatarColor: r.avatar_color,
    active: Boolean(r.active),
    // 与前端 memberSchema 一致：非法/缺失一律归一 'member'，保证导入后运行时不为 undefined
    roleKind: r.role_kind === 'admin' ? 'admin' : 'member',
    // 只下发「是否设过密码」，不下发哈希本体（理由见文件头注释）。
    // 前端据此决定成员进入时是否弹密码框；真正的比对一律走 POST /api/members/verify。
    hasPassword: Boolean(r.password_hash),
    // v0.6 Agent 身份：agentKind 是开放字符串（禁 z.enum / enum 封闭），人类恒 null
    actorKind: r.actor_kind === 'agent' ? 'agent' : 'human',
    agentKind: r.agent_kind,
    revision: r.revision,
    updatedAt: r.updated_at,
  };
}

const nowIso = (): string => new Date().toISOString();

export function registerMemberRoutes(app: FastifyInstance, db: Database.Database): void {
  // GET /members?includeInactive=1
  app.get('/api/members', async (req) => {
    const { includeInactive } = req.query as { includeInactive?: string };
    let rows = db.prepare('SELECT * FROM members').all() as MemberRow[];
    if (includeInactive !== '1') rows = rows.filter((r) => r.active === 1);
    return rows.map(rowToMember);
  });

  // GET /members/:id
  app.get('/api/members/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM members WHERE id = ?').get(id) as MemberRow | undefined;
    if (!row) {
      void reply.status(404);
      return errorBody('not_found', 'serverErr.member.notFound');
    }
    return rowToMember(row);
  });

  // POST /members
  app.post('/api/members', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const name = String(b.name ?? '').trim();
    if (!name) {
      void reply.status(400);
      return errorBody('validation', 'serverErr.member.nameRequired');
    }
    const id = crypto.randomUUID();
    const pw = b.password as string | undefined;
    const passwordHash = pw ? hashPassword(pw) : null;
    const actorKind = b.actorKind === 'agent' ? 'agent' : 'human';
    const agentKind = actorKind === 'agent' ? ((b.agentKind as string | null) ?? null) : null;
    db.prepare(
      `INSERT INTO members (id, name, role, contact, avatar_color, active, role_kind, password_hash, actor_kind, agent_kind, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      name,
      String(b.role ?? ''),
      (b.contact as string | null) ?? null,
      String(b.avatarColor ?? '#3D6B5B'),
      b.roleKind === 'admin' ? 'admin' : 'member',
      passwordHash,
      actorKind,
      agentKind,
      nowIso(),
    );
    const row = db.prepare('SELECT * FROM members WHERE id = ?').get(id) as MemberRow;
    return rowToMember(row);
  });

  // PATCH /members/:id
  app.patch('/api/members/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(id) as MemberRow | undefined;
    if (!existing) {
      void reply.status(404);
      return errorBody('not_found', 'serverErr.member.notFound');
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    // password 语义：string → 设为明文密码（scrypt 哈希入库）；null → 清除密码；undefined → 不变
    const passwordHash =
      b.password !== undefined ? (b.password ? hashPassword(String(b.password)) : null) : existing.password_hash;
    const merged: MemberRow = {
      ...existing,
      name: b.name !== undefined ? String(b.name) : existing.name,
      role: b.role !== undefined ? String(b.role) : existing.role,
      contact: b.contact !== undefined ? (b.contact as string | null) : existing.contact,
      avatar_color: b.avatarColor !== undefined ? String(b.avatarColor) : existing.avatar_color,
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active,
      role_kind: b.roleKind !== undefined ? String(b.roleKind) : existing.role_kind,
      password_hash: passwordHash,
      // v0.6：actorKind/agentKind 可改（提权为 Agent 身份 / 降级回人类，agentKind null=清除）
      actor_kind:
        b.actorKind !== undefined
          ? (b.actorKind === 'agent' ? 'agent' : 'human')
          : existing.actor_kind,
      agent_kind:
        b.agentKind !== undefined
          ? (b.agentKind as string | null)
          : existing.agent_kind,
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      'UPDATE members SET name=?, role=?, contact=?, avatar_color=?, active=?, role_kind=?, password_hash=?, actor_kind=?, agent_kind=?, revision=?, updated_at=? WHERE id=?',
    ).run(
      merged.name,
      merged.role,
      merged.contact,
      merged.avatar_color,
      merged.active,
      merged.role_kind,
      merged.password_hash,
      merged.actor_kind,
      merged.agent_kind,
      merged.revision,
      merged.updated_at,
      id,
    );
    return rowToMember(merged);
  });

  // POST /members/verify { memberId, password } → 200 / 401（服务端 scrypt 比对，密码绝不下发客户端）
  app.post('/api/members/verify', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const memberId = String(b.memberId ?? '');
    const password = String(b.password ?? '');
    const row = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId) as MemberRow | undefined;
    // 无此成员 / 已停用 / 密码为空 → 401（统一模糊提示，避免枚举成员）
    if (!row || row.active !== 1 || verifyPassword(password, row.password_hash) === false) {
      void reply.status(401);
      return errorBody('unauthorized', 'serverErr.member.badPassword');
    }
    return { ok: true, memberId };
  });

  /**
   * DELETE /members/:id —— **真删成员** + 改写名下引用（body 可选 `{ reassignTo }`）。
   *
   * 与 PATCH `{active:false}`（软停用）**并存、各管一件事**：
   *   停用让成员从名单「看不见」但行还在、历史全留；删除让行真的消失。
   *
   * `reassignTo`：
   *   · `null` / 缺省 ⇒ 引用**置空**（assignee_id / owner_id / owner_member_id → NULL，
   *     assignee_ids 里**只移除该项、其余保留**）；
   *   · 成员 id ⇒ 引用改到该成员（assignee_ids 逐项替换并去重）。
   *
   * ── 单事务（`db.transaction(...)` 默认 DEFERRED 会先拿读锁再升级写锁，并发下报
   *    SQLITE_BUSY；这里全部是「先读后写」，用 `.immediate()`）──
   * ① 逐行读 tasks / stages / projects 改写 → ② 删 members 行。
   *
   * ── `assignee_ids` 是 JSON 数组串，必须**解析→过滤→回写** ──
   * 用字符串 replace 会把 `["m1","m12"]` 里的 `m1` 误中 `m12` 的片段（前缀相同即中招），
   * 也可能把 JSON 结构弄坏。解析/序列化统一走 `server/lib/json-columns.ts`
   * （`serializeAssigneeIds` 内含 `filter(string)`，与本列 `string[]` 契约一致）。
   *
   * ── 主负责人 `assignee_id` 与集合的关系 ──
   * 前端口径是 `assigneeId = assigneeIds[0] ?? null`（entities.Task 注释）。改写后
   * 必须按**同一口径重算** `assignee_id`，否则会留下「主负责人=已删的人、
   * 集合=别人」这种自相矛盾的行（旧数据里 `assignee_ids='[]'` 而 `assignee_id` 有值
   * 的形态也存在，故判定要同时看两处）。
   *
   * ── `assignments` 表**一个字都不碰** ──
   * append-only 审计流水：改成 reassignTo 等于伪造「这人从没被指派过」，
   * 删掉等于销毁审计。历史行照旧指着原 id，显示层按「已删除成员」灰名呈现。
   */
  app.delete('/api/members/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
    if (!existing) {
      void reply.status(404);
      return errorBody('not_found', 'serverErr.member.notFound');
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    // `undefined`（没传）与 `null`（显式置空）同一语义：都不指向任何接收人。
    const raw = b.reassignTo;
    const reassignTo = raw === undefined || raw === null || raw === '' ? null : String(raw);
    if (reassignTo === id) {
      void reply.status(400);
      return errorBody('validation', 'coreErr.member.reassignToSelf');
    }
    if (reassignTo !== null) {
      const target = db.prepare('SELECT id FROM members WHERE id = ?').get(reassignTo);
      if (!target) {
        // 接收人不存在 ⇒ 400 而不是默默置空：静默置空会让用户的「转移」变成
        // 「全员失去负责人」，而界面那句「已转移给 X」会是假的。
        void reply.status(400);
        return errorBody('validation', 'coreErr.member.notFound');
      }
    }

    const now = nowIso();
    const counts = { tasks: 0, stages: 0, projects: 0 };

    const apply = db.transaction(() => {
      const taskRows = db
        .prepare('SELECT id, assignee_id, assignee_ids FROM tasks')
        .all() as Array<{ id: string; assignee_id: string | null; assignee_ids: string }>;
      const updateTask = db.prepare(
        'UPDATE tasks SET assignee_id=?, assignee_ids=?, revision=revision+1, updated_at=? WHERE id=?',
      );
      for (const t of taskRows) {
        const ids = parseJsonArray<string>(t.assignee_ids);
        const hitInSet = ids.includes(id);
        // 老行可能只有 assignee_id 而集合为空数组 ⇒ 两处都要看
        const hitInSingle = t.assignee_id === id;
        if (!hitInSet && !hitInSingle) continue;
        // 底数用「集合 ∪ {主负责人}」：两者历史上可能漂移（集合空、主负责人有值）
        const base = hitInSet ? ids : [id];
        const nextIds: string[] = [];
        const seen = new Set<string>();
        for (const cur of base) {
          const v = cur === id ? reassignTo : cur;
          if (v === null) continue; // 置空模式：该项消失，其余照留
          if (seen.has(v)) continue;
          seen.add(v);
          nextIds.push(v);
        }
        updateTask.run(nextIds[0] ?? null, serializeAssigneeIds(nextIds), now, t.id);
        counts.tasks += 1;
      }

      const stageRows = db
        .prepare('SELECT id FROM stages WHERE owner_id = ?')
        .all(id) as Array<{ id: string }>;
      const updateStage = db.prepare(
        'UPDATE stages SET owner_id=?, revision=revision+1, updated_at=? WHERE id=?',
      );
      for (const s of stageRows) {
        updateStage.run(reassignTo, now, s.id);
        counts.stages += 1;
      }

      const projectRows = db
        .prepare('SELECT id FROM projects WHERE owner_member_id = ?')
        .all(id) as Array<{ id: string }>;
      const updateProject = db.prepare(
        'UPDATE projects SET owner_member_id=?, revision=revision+1, updated_at=? WHERE id=?',
      );
      for (const p of projectRows) {
        updateProject.run(reassignTo, now, p.id);
        counts.projects += 1;
      }

      db.prepare('DELETE FROM members WHERE id = ?').run(id);
    });
    apply.immediate();

    return { ok: true, deletedId: id, reassignTo, ...counts };
  });
}
