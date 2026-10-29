import { ChangxiaError, ChangxiaErrorCode, MemberActorKind, MemberRoleKind, coreError } from '../../types/enums';
import type { Member, Task } from '../../types/entities';
import type { CreateMemberCmd, UpdateMemberCmd } from '../../types/dto';
import type { IMembersRepository, MemberRefRewrite } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';
import { pickDefined } from './local.projects.repo';
import { hashPassword, verifyPassword } from '../../../lib/password';
import { taskAssigneeIds } from '../../../hooks/useRoleGuard';

/** Dexie 实现的成员仓储 */
export class LocalMembersRepository implements IMembersRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async list(includeInactive?: boolean): Promise<Member[]> {
    try {
      const rows = await this.db.members.toArray();
      const filtered = includeInactive ? rows : rows.filter((m) => m.active);
      return filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.member.listReadFailed', undefined, err);
    }
  }

  async get(id: string): Promise<Member | null> {
    try {
      return (await this.db.members.get(id)) ?? null;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.member.readFailed', undefined, err);
    }
  }

  async insert(cmd: CreateMemberCmd): Promise<Member> {
    if (!cmd.name?.trim()) {
      throw coreError(ChangxiaErrorCode.Validation, 'coreErr.member.nameRequired');
    }
    const now = new Date().toISOString();
    const row: Member = {
      id: crypto.randomUUID(),
      name: cmd.name.trim(),
      role: cmd.role?.trim() ?? '',
      contact: cmd.contact ?? null,
      avatarColor: cmd.avatarColor,
      active: true,
      // 角色默认 member（外部调用方零改动）；first-run 管理员提权经 roleKind:'admin' 显式传入
      roleKind: cmd.roleKind ?? MemberRoleKind.Member,
      // v0.6 密码系统：明文 password → Web Crypto PBKDF2 哈希；缺省/未设 → null（无密码）
      passwordHash: cmd.password ? await hashPassword(cmd.password) : null,
      // v0.6 Agent 身份（键序铁律：passwordHash 后、revision 前，与 entities.Member / memberSchema 同步）。
      // actorKind 默认 human（存量调用方零改动）；agentKind 为开放字符串、人类恒 null。
      actorKind: cmd.actorKind ?? MemberActorKind.Human,
      agentKind: cmd.agentKind ?? null,
      revision: 1,
      updatedAt: now,
    };
    try {
      await this.db.members.add(row);
      return row;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.member.createFailed', undefined, err);
    }
  }

  async update(id: string, cmd: UpdateMemberCmd): Promise<Member> {
    const existing = await this.db.members.get(id);
    if (!existing) {
      throw coreError(ChangxiaErrorCode.NotFound, 'coreErr.member.notFound');
    }
    // password 语义：string → 设为明文密码（哈希入库）；null → 清除密码；
    // undefined → 不变（缺省，不进入 pickDefined 覆盖集合）。
    // 用 pickDefined 处理除 password 外的常规字段（只过滤 undefined，保留 null 清除语义）。
    const { password, ...rest } = cmd;
    const base = pickDefined(rest);
    const next: Member = {
      ...existing,
      ...base,
      ...(password !== undefined
        ? { passwordHash: password ? await hashPassword(password) : null }
        : {}),
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.members.put(next);
    return next;
  }

  /** 本地密码校验：Web Crypto PBKDF2 比对（见 src/lib/password.ts） */
  async verifyCredentials(memberId: string, password: string): Promise<boolean> {
    const existing = await this.db.members.get(memberId);
    if (!existing || !existing.active) return false;
    return verifyPassword(password, existing.passwordHash);
  }

  /**
   * **删除**成员（真删行，与 `update({active:false})` 的软停用分开，两者并存）。
   *
   * ── 三表引用在同一 Dexie 事务里改写，再删成员行 ──
   * 单事务的理由与 `LocalProjectsRepository.remove` 逐字相同：Dexie 没有物理外键，
   * 「先删成员再改引用」或反之都可能在中途失败后留下**悬挂引用 + 成员已消失**的半成品
   * （那正是「显示层查不到 → 灰名」本该兜住的场景，但没人希望它因一次写失败而普遍发生）。
   *
   * ── 引用改写口径 ──
   *   · `Task.assigneeId` / `Task.assigneeIds`：见下方 `nextAssignee`；
   *   · `Stage.ownerId`：等于 fromId ⇒ toId（`null` 即置空）；
   *   · `Project.ownerMemberId`：同上。
   * 改过的行**同步 revision+1 与 updatedAt**——与 `update()` 的既有口径一致：
   * 这些行确实被改了，版本号不涨会让「按 revision 判脏」的调用方读到旧版本。
   *
   * ── `AssignmentLog` 一个字都不碰 ──
   * `assignments` 是 append-only 审计流水：把它改成 `toId` 等于伪造历史（看起来这个人
   * 从没被指派过），把它删掉等于销毁审计。故本方法**刻意不进 `assignments` 表**，
   * 历史行照旧指着已不存在的 id，显示层按「已删除成员」灰名呈现。
   */
  async delete(id: string, reassignTo: string | null): Promise<MemberRefRewrite> {
    const existing = await this.db.members.get(id);
    if (!existing) {
      throw coreError(ChangxiaErrorCode.NotFound, 'coreErr.member.notFound');
    }
    if (reassignTo === id) {
      // 自指会让引用原地打转、删完仍悬挂。UI 已排除本人，这里是仓储层的硬防线。
      throw coreError(ChangxiaErrorCode.Validation, 'coreErr.member.reassignToSelf');
    }
    try {
      return await this.db.transaction(
        'rw',
        [this.db.members, this.db.tasks, this.db.stages, this.db.projects],
        async () => {
          const now = new Date().toISOString();
          const counts: MemberRefRewrite = { tasks: 0, stages: 0, projects: 0 };

          const tasks = await this.db.tasks.toArray();
          for (const t of tasks) {
            const next = withMemberRefsRemoved(t, id, reassignTo, now);
            if (next === null) continue;
            await this.db.tasks.put(next);
            counts.tasks += 1;
          }

          const stages = await this.db.stages.toArray();
          for (const s of stages) {
            if (s.ownerId !== id) continue;
            await this.db.stages.put({
              ...s,
              ownerId: reassignTo,
              revision: s.revision + 1,
              updatedAt: now,
            });
            counts.stages += 1;
          }

          const projects = await this.db.projects.toArray();
          for (const p of projects) {
            if (p.ownerMemberId !== id) continue;
            await this.db.projects.put({
              ...p,
              ownerMemberId: reassignTo,
              revision: p.revision + 1,
              updatedAt: now,
            });
            counts.projects += 1;
          }

          await this.db.members.delete(id);
          return counts;
        },
      );
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw coreError(
        ChangxiaErrorCode.Storage,
        'coreErr.member.deleteFailedRolledBack',
        undefined,
        err,
      );
    }
  }
}

/**
 * 任务行的「成员引用剔除/转移」纯函数：**不涉及的那一行返回 `null`**（调用方据此跳过写入）。
 *
 * 三个都必须正确处理的坑：
 *  ① **`assigneeIds=[]` 是合法的「老数据形态」**，读取侧 `taskAssigneeIds()` 会回落
 *     `[assigneeId]`。所以「集合里没有这个 id」不等于「这个任务不指向该成员」——
 *     只看 `assigneeIds` 会漏掉「只有 assigneeId、没有 assigneeIds」的存量任务
 *     （那批任务恰恰是本次删除最该处理的）。
 *  ② **`assigneeIds` 里去掉该项、其余必须留着**（它不是「主负责人」一个字段，
 *     而是参与人全集）。整体置空会把同任务的其他人一起踢掉 —— 变异用例守着这条。
 *  ③ 改写后**重写 `assigneeId = 新集合[0] ?? null`**：UI 保存路径一直是这么同步的
 *     （`entities.Task.assigneeId` 的注释：「UI 保存时自动同步为 assigneeIds[0] ?? null」），
 *     不重写会让「主负责人=已删除的人、参与人集合=别人」这种自相矛盾的行留在库里。
 */
function withMemberRefsRemoved(
  task: Task,
  fromId: string,
  toId: string | null,
  now: string,
): Task | null {
  const effective = taskAssigneeIds(task);
  const hit = effective.includes(fromId);
  const legacyHit = task.assigneeId === fromId;
  if (!hit && !legacyHit) return null;

  // 逐项替换（保持原顺序）→ 去重；`assigneeIds=[]` 的存量行此处以 effective 为底。
  const seen = new Set<string>();
  const nextIds: string[] = [];
  for (const raw of effective) {
    const id = raw === fromId ? toId : raw;
    if (id === null) continue; // 置空模式：该项直接消失，其余照留
    if (seen.has(id)) continue;
    seen.add(id);
    nextIds.push(id);
  }

  return {
    ...task,
    assigneeId: nextIds[0] ?? null,
    assigneeIds: nextIds,
    revision: task.revision + 1,
    updatedAt: now,
  };
}

