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
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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
  revision: number;
  updated_at: string;
}

/** scrypt 参数 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** 明文密码 → `saltHex:hashHex`（scrypt） */
function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** 恒定时间校验明文密码是否匹配某哈希 */
function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const idx = stored.indexOf(':');
  if (idx <= 0) return false;
  const salt = Buffer.from(stored.slice(0, idx), 'hex');
  const expected = Buffer.from(stored.slice(idx + 1), 'hex');
  try {
    const actual = scryptSync(plain, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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
      return { error: { code: 'not_found', userMessage: '成员不存在' } };
    }
    return rowToMember(row);
  });

  // POST /members
  app.post('/api/members', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const name = String(b.name ?? '').trim();
    if (!name) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '成员姓名不能为空' } };
    }
    const id = crypto.randomUUID();
    const pw = b.password as string | undefined;
    const passwordHash = pw ? hashPassword(pw) : null;
    db.prepare(
      `INSERT INTO members (id, name, role, contact, avatar_color, active, role_kind, password_hash, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, ?)`,
    ).run(
      id,
      name,
      String(b.role ?? ''),
      (b.contact as string | null) ?? null,
      String(b.avatarColor ?? '#3D6B5B'),
      b.roleKind === 'admin' ? 'admin' : 'member',
      passwordHash,
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
      return { error: { code: 'not_found', userMessage: '成员不存在' } };
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
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      'UPDATE members SET name=?, role=?, contact=?, avatar_color=?, active=?, role_kind=?, password_hash=?, revision=?, updated_at=? WHERE id=?',
    ).run(
      merged.name,
      merged.role,
      merged.contact,
      merged.avatar_color,
      merged.active,
      merged.role_kind,
      merged.password_hash,
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
      return { error: { code: 'unauthorized', userMessage: '密码错误' } };
    }
    return { ok: true, memberId };
  });
}
