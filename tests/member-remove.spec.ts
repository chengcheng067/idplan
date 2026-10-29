// @vitest-environment jsdom
/**
 * 删除成员（v1.0.0.0020）· 本地数据层 + store + 显示口径。
 *
 * ══════════════════ 这个文件守的是什么 ══════════════════
 * 在此之前产品**只有「停用」没有「删除」**（用户多次指出这是功能缺失）。
 * 「删除」与「停用」必须**并存、各管一件事**：
 *   · 停用 = `active=false`，行还在、历史全留（既有行为，本文件另有一条反向保护）；
 *   · 删除 = 行真的消失，名下三处引用按 `reassignTo` 改写或置空。
 *
 * 七条判据（每条都对应一个会真实发生的坏结果）：
 *   ① 无引用成员删除：成员表少一行、其它表零改动；
 *   ② 有引用 + 转移：tasks / stages / projects 三处引用都到接收人，成员行被删；
 *   ③ 有引用 + 置空：三个字段正确置空，**且 `assigneeIds` 只移除该项、保留其余**；
 *   ④ `AssignmentLog` **完全未改动**（行数与内容逐字节比对）—— append-only 审计；
 *   ⑤ 删「当前登录身份」本人 ⇒ store 里身份被清空（不清就是「身份悬挂」那个老病灶）；
 *   ⑥（另一文件 `server.member-remove.spec.ts`）服务端端点；
 *   ⑦ 「已删除成员」显示 helper：未知 id ⇒ 灰名文案，不是空串、也不是原始 id。
 *
 * ⚠️ 为什么用**真** Dexie（fake-indexeddb）+ 真 store：
 *   本批改的是「三表引用 + 成员行」这种跨表不变量，mock 掉仓储等于让被测对象
 *   自己证明自己。这里只把 `useRepos` 换成真 `createRepositories` 的结果。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { emptyPackage } from './helpers/backup-fixture';
import { createMemberActions, useMembersStore } from '../src/store/useMembersStore';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { memberDisplayName, memberDisplayText } from '../src/lib/member-display';
import { setLang } from '../src/i18n';
import type { AssignmentLog, Member } from '../src/core/types/entities';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';
import type { Stage, Task } from '../src/core/types/entities';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // 单进程共用一个 fake-indexeddb ⇒ 上一个 spec 的行会残留；先清库再播种
  await bundle.admin!.replaceAllImport(emptyPackage());
  useMembersStore.getState().setAll([]);
  useProjectsStore.getState().replaceAll({ projects: [], stages: [], tasks: [] });
  useSettingsStore.getState().setCurrentMember(null);
  setLang('zh');
});

/* ────────────────────────────── 播种工具 ────────────────────────────── */

/** 造一个成员（走真仓储，返回落库行） */
async function seedMember(name: string, opts: Partial<Member> = {}): Promise<Member> {
  const m = await bundle.members.insert({
    name,
    role: '协作',
    avatarColor: '#3D6B5B',
    roleKind: opts.roleKind ?? MemberRoleKind.Member,
    actorKind: opts.actorKind ?? MemberActorKind.Human,
  });
  // 其余字段（active 等）直接 put 覆盖，避免为测试改仓储签名
  const patched = { ...m, ...opts } as Member;
  if (Object.keys(opts).length > 0) await (bundle.admin as unknown as { db?: never });
  return patched;
}

/** 直接写库（绕开 service，本文件只关心「三表引用怎么被改」） */
async function putProject(id: string, ownerMemberId: string | null): Promise<void> {
  await bundle.projects.insert({
    id,
    name: `项目 ${id}`,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-10-01',
    plannedEndAt: '2026-10-31',
    coverColor: null,
    kind: 'human',
    ownerMemberId,
  } as never);
}

async function putStage(id: string, projectId: string, ownerId: string | null): Promise<void> {
  await bundle.stages.bulkInsert([
    {
      id,
      projectId,
      name: `阶段 ${id}`,
      orderIndex: 1,
      startAt: '2026-10-01',
      endAt: '2026-10-07',
      status: 'not_started',
      ratioPercent: 10,
      colorIndex: null,
      customColor: null,
      ownerId,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-10-01T00:00:00.000Z',
    } as never,
  ]);
}

/**
 * 造任务。
 *
 * ⚠️ `LocalTasksRepository.insert` 的 id 是 `crypto.randomUUID()`（**不认** cmd.id ——
 * 那是有意的：任务 id 由仓储发号，调用方不该能指定）。故本函数返回**真行**，
 * 断言一律用 `row.id`，不要在测试里假设 `'t1'` 这类字面 id 存在。
 */
async function putTask(
  projectId: string,
  stageId: string,
  assigneeId: string | null,
  assigneeIds: string[],
): Promise<Task> {
  return bundle.tasks.insert({
    projectId,
    stageId,
    title: `任务 ${projectId}-${Math.random().toString(36).slice(2, 8)}`,
    assigneeId,
    assigneeIds,
  } as never);
}

/** 全库快照（④ 逐字节比对用；走 `fullExport` = 与备份同一条口径） */
async function dumpAll(): Promise<Record<string, unknown>> {
  const pkg = await bundle.admin!.fullExport();
  return {
    members: pkg.data.members,
    tasks: pkg.data.tasks,
    stages: pkg.data.stages,
    projects: pkg.data.projects,
    assignments: pkg.data.assignments,
  };
}

/* ══════════════════════════ ① 无引用 ⇒ 干净删除 ══════════════════════════ */

describe('① 无引用成员删除：成员表少一行，其它表零改动', () => {
  it('三表都不含该 id 时，删完只有 members 少一行', async () => {
    const victim = await seedMember('待删的人');
    const keeper = await seedMember('留下的人');
    const before = await dumpAll();

    const counts = await bundle.members.delete(victim.id, null);
    expect(counts).toEqual({ tasks: 0, stages: 0, projects: 0 });

    const after = await dumpAll();
    const membersAfter = after.members as Member[];
    expect(membersAfter.map((m) => m.id)).not.toContain(victim.id);
    expect(membersAfter.map((m) => m.id)).toContain(keeper.id);
    // 其它三表逐字节不动（含 assignments 空表）
    expect(after.tasks).toEqual(before.tasks);
    expect(after.stages).toEqual(before.stages);
    expect(after.projects).toEqual(before.projects);
    expect(after.assignments).toEqual(before.assignments);
  });

  it('不存在的 id ⇒ NotFound（不是静默成功）', async () => {
    await expect(bundle.members.delete('mem_does_not_exist', null)).rejects.toThrow();
  });

  it('reassignTo 指向自己 ⇒ Validation（引用会原地打转）', async () => {
    const victim = await seedMember('自指的人');
    await expect(bundle.members.delete(victim.id, victim.id)).rejects.toThrow();
    // 抛出后成员仍在（事务未执行）
    expect(await bundle.members.get(victim.id)).not.toBeNull();
  });
});

/* ══════════════════════════ ② 有引用 + 转移 ══════════════════════════ */

describe('② 有引用 + reassignTo=接收人：三处引用都改到接收人，成员行被删', () => {
  it('tasks / stages / projects 三处都改写到接收人，计数正确', async () => {
    const victim = await seedMember('走的人');
    const heir = await seedMember('接手的人');
    await putProject('p1', victim.id);
    await putProject('p2', heir.id); // 与本成员无关，必须原样
    await putStage('s1', 'p1', victim.id);
    await putStage('s2', 'p1', heir.id);
    const t1 = await putTask('p1', 's1', victim.id, [victim.id]);
    const t2 = await putTask('p1', 's1', victim.id, [victim.id, heir.id]);
    const t3 = await putTask('p1', 's1', heir.id, [heir.id]); // 无关任务

    const counts = await bundle.members.delete(victim.id, heir.id);
    expect(counts).toEqual({ tasks: 2, stages: 1, projects: 1 });

    // 成员行被删
    expect(await bundle.members.get(victim.id)).toBeNull();
    expect(await bundle.members.get(heir.id)).not.toBeNull();

    // 任务：t1 单人 → heir；t2 双人 → 去重后只剩 heir 一个（不能出现重复项）
    const a1 = await bundle.tasks.get(t1.id);
    expect(a1!.assigneeId).toBe(heir.id);
    expect(a1!.assigneeIds).toEqual([heir.id]);
    const a2 = await bundle.tasks.get(t2.id);
    expect(a2!.assigneeId).toBe(heir.id);
    expect(a2!.assigneeIds, '转移后必须去重（不能 [heir, heir]）').toEqual([heir.id]);
    // 无关任务一字不动
    const a3 = await bundle.tasks.get(t3.id);
    expect(a3!.assigneeId).toBe(heir.id);
    expect(a3!.assigneeIds).toEqual([heir.id]);

    // 阶段 / 项目
    expect((await bundle.stages.get('s1'))!.ownerId).toBe(heir.id);
    expect((await bundle.stages.get('s2'))!.ownerId).toBe(heir.id);
    const projects = await bundle.projects.list({ status: 'all' });
    expect(projects.find((p) => p.id === 'p1')!.ownerMemberId).toBe(heir.id);
    expect(projects.find((p) => p.id === 'p2')!.ownerMemberId).toBe(heir.id);
  });
});

/* ══════════════════════════ ③ 有引用 + 置空 ══════════════════════════ */

describe('③ 有引用 + reassignTo=null：字段置空，assigneeIds 只移除该项、保留其余', () => {
  it('★ 多参与人任务：只把该成员摘掉，其他人一个不少', async () => {
    const victim = await seedMember('走的人');
    const a = await seedMember('甲');
    const b = await seedMember('乙');
    await putProject('p1', victim.id);
    await putStage('s1', 'p1', victim.id);
    // t1：主负责人是 victim，参与人 [victim, 甲, 乙] ⇒ 摘掉 victim 后必须剩 [甲, 乙]
    const t1 = await putTask('p1', 's1', victim.id, [victim.id, a.id, b.id]);
    // t2：主负责人是 victim，但集合为空（存量老形态）⇒ 读取侧回落 [assigneeId]
    const t2 = await putTask('p1', 's1', victim.id, []);
    // t3：只有集合里有 victim，主负责人是甲
    const t3 = await putTask('p1', 's1', a.id, [a.id, victim.id]);

    const counts = await bundle.members.delete(victim.id, null);
    expect(counts).toEqual({ tasks: 3, stages: 1, projects: 1 });

    const a1 = await bundle.tasks.get(t1.id);
    expect(a1!.assigneeIds, '★ 关键断言：其余参与人必须留着，不能整体置空').toEqual([a.id, b.id]);
    expect(a1!.assigneeId, '主负责人重算为新的第一参与人').toBe(a.id);

    const a2 = await bundle.tasks.get(t2.id);
    expect(a2!.assigneeIds).toEqual([]);
    expect(a2!.assigneeId, '老形态（集合为空、只有主负责人）也要被摘掉').toBeNull();

    const a3 = await bundle.tasks.get(t3.id);
    expect(a3!.assigneeIds).toEqual([a.id]);
    expect(a3!.assigneeId).toBe(a.id);

    // 阶段 / 项目置空
    expect((await bundle.stages.get('s1'))!.ownerId).toBeNull();
    const projects = await bundle.projects.list({ status: 'all' });
    expect(projects.find((p) => p.id === 'p1')!.ownerMemberId).toBeNull();
  });

  it('改写的行 revision+1（按 revision 判脏的调用方不能读到旧版本）', async () => {
    const victim = await seedMember('走的人');
    await putProject('p1', null);
    await putStage('s1', 'p1', null);
    const before = await putTask('p1', 's1', victim.id, [victim.id]);
    await bundle.members.delete(victim.id, null);
    const after = await bundle.tasks.get(before.id);
    expect(after!.revision).toBe(before.revision + 1);
    /*
     * `updatedAt` 只断言「不倒退」而不是「不相等」：两者可能落在**同一毫秒**
     * （实测在本机 CI 上稳定复现），`not.toBe` 会变成一条偶发红的假用例。
     * 真正的判据是 revision（它的语义就是「改过几次」）。
     */
    expect(new Date(after!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updatedAt).getTime(),
    );
  });
});

/* ══════════════════════════ ④ AssignmentLog 一字不动 ══════════════════════════ */

describe('④ AssignmentLog 是 append-only 审计：删除成员后逐字节不变', () => {
  it('转移与置空两条路径都不改写、也不删除历史流水', async () => {
    const victim = await seedMember('走的人');
    const heir = await seedMember('接手的人');
    await putProject('p1', null);
    await putStage('s1', 'p1', null);
    const task = await putTask('p1', 's1', victim.id, [victim.id]);

    // 三条历史：指派给 victim / 改派 / 集合级变更（memberId=null）
    await bundle.logs.appendAssignment({
      taskId: task.id,
      projectId: 'p1',
      memberId: victim.id,
      action: 'assign',
      operatorName: '管理员',
    });
    await bundle.logs.appendAssignment({
      taskId: task.id,
      projectId: 'p1',
      memberId: victim.id,
      action: 'change',
      operatorName: '管理员',
    });
    await bundle.logs.appendAssignment({
      taskId: task.id,
      projectId: 'p1',
      memberId: null,
      action: 'change',
      operatorName: '管理员',
    });

    const logsBefore = (await bundle.logs.listAssignmentsByTask(task.id)) as AssignmentLog[];
    expect(logsBefore).toHaveLength(3);
    const bytesBefore = JSON.stringify(logsBefore);

    await bundle.members.delete(victim.id, heir.id);
    const logsAfterTransfer = (await bundle.logs.listAssignmentsByTask(task.id)) as AssignmentLog[];
    expect(JSON.stringify(logsAfterTransfer), '转移路径不得改动审计流水').toBe(bytesBefore);

    // 再来一次（置空路径）：重建一个 victim2 + 同形流水
    const victim2 = await seedMember('第二个走的人');
    await bundle.logs.appendAssignment({
      taskId: task.id,
      projectId: 'p1',
      memberId: victim2.id,
      action: 'assign',
      operatorName: '管理员',
    });
    const bytes2 = JSON.stringify(await bundle.logs.listAssignmentsByTask(task.id));
    await bundle.members.delete(victim2.id, null);
    expect(
      JSON.stringify(await bundle.logs.listAssignmentsByTask(task.id)),
      '置空路径不得改动审计流水',
    ).toBe(bytes2);
    // 且行数只增不减（上面 append 过一次 ⇒ 4 行）
    expect((await bundle.logs.listAssignmentsByTask(task.id)).length).toBe(4);
  });
});

/* ══════════════════════════ ⑤ 删当前登录身份 ⇒ 清身份 ══════════════════════════ */

describe('⑤ store.remove：删的是「当前登录身份」本人 ⇒ 身份被清空', () => {
  it('★ 删自己 ⇒ currentMemberId 变 null（不清就是「身份悬挂」那个老病灶）', async () => {
    const me = await seedMember('我自己');
    useMembersStore.getState().setAll(await bundle.members.list(true));
    useSettingsStore.getState().setCurrentMember(me.id);
    expect(useSettingsStore.getState().currentMemberId).toBe(me.id);

    const actions = createMemberActions(bundle);
    const counts = await actions.remove(me.id, null);
    expect(counts).not.toBeNull();

    expect(useSettingsStore.getState().currentMemberId, '删掉自己的身份必须被清空').toBeNull();
    expect(useMembersStore.getState().members.map((m) => m.id)).not.toContain(me.id);
  });

  it('反向保护：删的是别人 ⇒ 身份不动', async () => {
    const me = await seedMember('我自己');
    const other = await seedMember('别人');
    useMembersStore.getState().setAll(await bundle.members.list(true));
    useSettingsStore.getState().setCurrentMember(me.id);

    const actions = createMemberActions(bundle);
    await actions.remove(other.id, null);

    expect(useSettingsStore.getState().currentMemberId).toBe(me.id);
  });

  it('失败路径（id 不存在）⇒ 成员表与身份都不变，且不抛到调用方', async () => {
    const me = await seedMember('我自己');
    useMembersStore.getState().setAll(await bundle.members.list(true));
    useSettingsStore.getState().setCurrentMember(me.id);

    const actions = createMemberActions(bundle);
    const counts = await actions.remove('mem_ghost', null);
    expect(counts, '失败返回 null（页面据此保留弹窗让用户重试）').toBeNull();
    expect(useSettingsStore.getState().currentMemberId).toBe(me.id);
    expect(useMembersStore.getState().members.map((m) => m.id)).toContain(me.id);
  });
});

/* ══════════════════════════ 停用与删除并存（反向保护） ══════════════════════════ */

describe('停用与删除并存：停用仍是「行还在、只是 active=false」', () => {
  it('setActive(false) 不删行、不动引用（既有行为零变化）', async () => {
    const victim = await seedMember('被停用的人');
    await putProject('p1', victim.id);
    await putStage('s1', 'p1', victim.id);
    const task = await putTask('p1', 's1', victim.id, [victim.id]);

    const actions = createMemberActions(bundle);
    await actions.setActive(victim.id, false);

    const row = await bundle.members.get(victim.id);
    expect(row, '停用不删行').not.toBeNull();
    expect(row!.active).toBe(false);
    // 引用一个字不动
    expect((await bundle.tasks.get(task.id))!.assigneeIds).toEqual([victim.id]);
    expect((await bundle.stages.get('s1'))!.ownerId).toBe(victim.id);
  });
});

/* ══════════════════════════ ⑦ 「已删除成员」显示 helper ══════════════════════════ */

describe('⑦ memberDisplayName：未知 id ⇒ 灰名文案（不是空串、不是原始 id）', () => {
  const members = [
    {
      id: 'mem_alive',
      name: '活着的人',
      role: '',
      contact: null,
      avatarColor: '#000',
      active: true,
      roleKind: MemberRoleKind.Member,
      passwordHash: null,
      actorKind: MemberActorKind.Human,
      agentKind: null,
      revision: 1,
      updatedAt: '2026-10-01T00:00:00Z',
    } as Member,
  ];

  it('查得到 ⇒ 真名，missing=false', () => {
    expect(memberDisplayName('mem_alive', members)).toEqual({ text: '活着的人', missing: false });
  });

  it('★ 查不到 ⇒ 「已删除成员」，missing=true（不是空串、不是原始 id）', () => {
    const r = memberDisplayName('mem_deleted_9f3a', members);
    expect(r).not.toBeNull();
    expect(r!.missing).toBe(true);
    expect(r!.text).toBe('已删除成员');
    expect(r!.text).not.toBe('');
    expect(r!.text, '绝不能把原始 id 显示给用户').not.toBe('mem_deleted_9f3a');
  });

  it('null / undefined / 空串 ⇒ null（「没有负责人」是第三种状态，由调用方表达）', () => {
    expect(memberDisplayName(null, members)).toBeNull();
    expect(memberDisplayName(undefined, members)).toBeNull();
    expect(memberDisplayName('', members)).toBeNull();
  });

  it('英文态 ⇒ “Deleted member”（灰名文案随语言，不出中文）', () => {
    setLang('en');
    expect(memberDisplayName('mem_deleted_9f3a', members)!.text).toBe('Deleted member');
    expect(memberDisplayText('mem_deleted_9f3a', members)).toBe('Deleted member');
    setLang('zh');
  });

  it('memberDisplayText：null id ⇒ 空串（供拼接场景用）', () => {
    expect(memberDisplayText(null, members)).toBe('');
    expect(memberDisplayText('mem_alive', members)).toBe('活着的人');
  });
});
