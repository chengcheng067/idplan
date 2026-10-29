// @vitest-environment jsdom
/**
 * 工作区地基 · 数据层守卫（多工作区 0016 · 版本 1.0.0.0016 第一切片）。
 *
 * ═══════════════════════ 本文件锁什么 ═══════════════════════
 *   W1 存量迁移：注册表缺席 ⇒ 整库认作第一个工作区 ws-default（名「未命名工作室」、
 *      绑定老库名 `changxia`、数据零迁移——老库本来就是它的库，只做名字绑定）。
 *   W2 身份键按区：旧库级键的值在迁移时抄进 ws-default 区级键（老用户身份记忆不丢）；
 *      区级读写经 readStoredMemberId / setCurrentMember；显式退出把区级键与旧键
 *      **一起**清（否则升级后「退出身份」会被旧键回落复活）。
 *   W3 新建工作区：createWorkspaceOwnerDb 建空白新区 + Owner 管理员入库 + 明文经
 *      PBKDF2 落哈希（verifyPassword 验真算法，不是 mock 陪跑）。
 *   W4 切区验密：readWorkspaceGateHash 取该区「设了密码的 active 管理员」的哈希；
 *      无库 / 无管理员密码 ⇒ null（切入不验密）；带外读不改库版本（不绕迁移闸门）。
 *
 * ═══════════════════════ 变异自证（本仓纪律） ═══════════════════════
 *   · 注释掉 workspace-registry.ts 的 migrateLegacyIdentityKey() 调用 ⇒ W2-1 红；
 *   · 把 setCurrentMember(null) 里移除旧键的那行删掉 ⇒ W2-3 红；
 *   · 注释掉 createWorkspaceOwnerDb 的 insert ⇒ W3 红（members 为空）；
 *   · 把 readWorkspaceGateHash 的 roleKind 过滤删掉 ⇒ W4-3 红（成员密码会被当闸密）。
 *   以上均已实测变红并恢复。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';

import {
  DEFAULT_WORKSPACE_ID,
  addWorkspace,
  currentWorkspaceIdSync,
  identityKeyFor,
  listWorkspaces,
  setCurrentWorkspaceId,
  writeMemberIdForWorkspace,
} from '../src/lib/workspace-registry';
import { openDatabase } from '../src/core/repositories/local/dexie.database';
import { createWorkspaceOwnerDb, readWorkspaceGateHash } from '../src/core/repositories/local/workspace.db';
import { CURRENT_MEMBER_ID_KEY, readStoredMemberId, useSettingsStore } from '../src/store/useSettingsStore';
import { verifyPassword } from '../src/lib/password';
import { MemberRoleKind } from '../src/core/types/enums';

beforeEach(() => {
  localStorage.clear();
  /* fake-indexeddb 每例重置（Dexie 连接是进程级的，关掉_names 环境即可——
     直接用新库名隔离，不追求跨用例同名重建） */
  useSettingsStore.setState({ currentMemberId: null, hydrated: false });
});

describe('W1 · 存量迁移：老库绑定 ws-default', () => {
  it('W1-1 注册表缺席 ⇒ 建出唯一默认区：ws-default / 未命名工作室 / 老库名 changxia', () => {
    const list = listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(list[0]!.name).toBe('未命名工作室');
    expect(list[0]!.dbName).toBe('changxia');
    expect(currentWorkspaceIdSync()).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('W1-2 迁移幂等：已迁移过（注册表在）⇒ 不重复播种、不重置用户改动', () => {
    expect(listWorkspaces()).toHaveLength(1);
    addWorkspace({
      id: 'ws-x',
      name: '第二工作室',
      createdAt: new Date().toISOString(),
      ownerMemberName: '丞丞',
      dbName: 'idplan-ws-x',
    });
    expect(listWorkspaces()).toHaveLength(2);
    // 再读一遍：仍是两条，默认区字段原样
    const again = listWorkspaces();
    expect(again).toHaveLength(2);
    expect(again.find((w) => w.id === DEFAULT_WORKSPACE_ID)!.dbName).toBe('changxia');
  });
});

describe('W2 · 身份键按工作区', () => {
  it('W2-1 旧库级键 → ws-default 区级键的一次性抄写（老用户身份记忆不丢）', () => {
    localStorage.setItem(CURRENT_MEMBER_ID_KEY, 'mem_legacy');
    listWorkspaces(); // 触发注册表懒迁移
    expect(localStorage.getItem(identityKeyFor(DEFAULT_WORKSPACE_ID))).toBe('mem_legacy');
    // 旧键保留：回滚到 0015 的老版本仍能读到自己的身份
    expect(localStorage.getItem(CURRENT_MEMBER_ID_KEY)).toBe('mem_legacy');
    // 读档命中区级键
    expect(readStoredMemberId()).toBe('mem_legacy');
  });

  it('W2-2 setCurrentMember 写区级键（键名带 wsId）；多区各自记忆', () => {
    listWorkspaces();
    addWorkspace({
      id: 'ws-b',
      name: 'B 工作室',
      createdAt: new Date().toISOString(),
      ownerMemberName: null,
      dbName: 'idplan-ws-b',
    });
    // 默认区写入
    useSettingsStore.getState().setCurrentMember('mem_in_default');
    expect(localStorage.getItem(identityKeyFor(DEFAULT_WORKSPACE_ID))).toBe('mem_in_default');
    // 切到 B 区：读档为空（身份记忆不跨区）
    setCurrentWorkspaceId('ws-b');
    expect(readStoredMemberId()).toBeNull();
    // B 区写自己的
    useSettingsStore.getState().setCurrentMember('mem_in_b');
    expect(localStorage.getItem(identityKeyFor('ws-b'))).toBe('mem_in_b');
    expect(localStorage.getItem(identityKeyFor(DEFAULT_WORKSPACE_ID))).toBe('mem_in_default');
    // 切回默认区：记忆还在
    setCurrentWorkspaceId(DEFAULT_WORKSPACE_ID);
    expect(readStoredMemberId()).toBe('mem_in_default');
  });

  it('W2-3 显式退出 ⇒ 区级键与旧键一起清（退出不许被旧键回落复活）', () => {
    localStorage.setItem(CURRENT_MEMBER_ID_KEY, 'mem_legacy');
    listWorkspaces();
    useSettingsStore.getState().setCurrentMember('mem_legacy'); // 模拟升级后仍在身份中
    useSettingsStore.getState().setCurrentMember(null); // 退出身份
    expect(localStorage.getItem(identityKeyFor(DEFAULT_WORKSPACE_ID))).toBeNull();
    expect(localStorage.getItem(CURRENT_MEMBER_ID_KEY)).toBeNull();
    expect(readStoredMemberId()).toBeNull();
  });

  it('W2-4 writeMemberIdForWorkspace：建区流程的直接落键出口（reload 前写目标区）', () => {
    listWorkspaces();
    // 真实建区流程的顺序：先登记注册表，再落身份键，最后 reload
    addWorkspace({
      id: 'ws-future',
      name: '未来工作室',
      createdAt: new Date().toISOString(),
      ownerMemberName: null,
      dbName: 'idplan-ws-future',
    });
    writeMemberIdForWorkspace('ws-future', 'mem_owner');
    // 当前区还是默认区：读不到未来区的身份
    expect(readStoredMemberId()).toBeNull();
    setCurrentWorkspaceId('ws-future');
    expect(readStoredMemberId()).toBe('mem_owner');
  });
});

describe('W3 · 新建工作区：空白新区 + Owner 入库 + 密码哈希', () => {
  it('W3-1 建区 ⇒ 新库名下 members 只有 Owner（admin）且 projects 为空；哈希验真', async () => {
    const ownerId = await createWorkspaceOwnerDb({
      dbName: 'idplan-ws-new',
      ownerName: '丞丞',
      password: '1234',
    });
    expect(ownerId).toBeTruthy();

    const db = await openDatabase('idplan-ws-new');
    try {
      const members = await db.members.toArray();
      expect(members).toHaveLength(1);
      const owner = members[0]!;
      expect(owner.id).toBe(ownerId);
      expect(owner.name).toBe('丞丞');
      expect(owner.active).toBe(true);
      expect(owner.roleKind).toBe(MemberRoleKind.Admin);
      // 明文绝不落库；哈希对原明文 verifyPassword 通过、对错的密码不通过
      expect(owner.passwordHash).toBeTruthy();
      expect(owner.passwordHash).not.toContain('1234');
      expect(await verifyPassword('1234', owner.passwordHash)).toBe(true);
      expect(await verifyPassword('0000', owner.passwordHash)).toBe(false);
      // 空白区：业务表无数据；settings 只有一行——建区播种的 onboarding 引导标记
      // （onboarding-design-2026-10-30 §二：只有全新数据库才自动弹引导；
      //   键名出处 src/core/onboarding/keys.ts，值 false = 「待弹」三态语义）
      expect(await db.projects.toArray()).toHaveLength(0);
      expect(await db.tasks.toArray()).toHaveLength(0);
      const seedRows = await db.settings.toArray();
      expect(seedRows).toHaveLength(1);
      expect(seedRows[0]!.key).toBe('onboarding.done');
      expect(JSON.parse(seedRows[0]!.valueJson)).toBe(false);
    } finally {
      db.close();
    }
  });

  it('W3-2 新区库与主库物理隔离（分库，不是同库加列）', async () => {
    const main = await openDatabase('changxia-w3-main');
    try {
      await main.projects.add({
        id: 'proj_main',
        name: '主库项目',
        address: '',
        clientName: null,
        contractAmount: null,
        signedAt: null,
        plannedStartAt: '2026-10-01T00:00:00Z',
        plannedEndAt: '2026-12-31T23:59:59Z',
        coverColor: null,
        shortLabel: null,
        stagePresetKey: null,
        stageTemplateVersion: 0,
        scheduleBasis: 'calendar',
        domain: null,
        kind: 'human',
        status: 'active',
        revision: 1,
        updatedAt: '2026-10-01T00:00:00Z',
        ownerMemberId: null,
      } as never);
    } finally {
      main.close();
    }
    await createWorkspaceOwnerDb({ dbName: 'idplan-ws-iso', ownerName: '乙', password: 'abcd' });

    const fresh = await openDatabase('idplan-ws-iso');
    try {
      // 新区看不到主库的项目——隔离是库级的
      expect(await fresh.projects.toArray()).toHaveLength(0);
    } finally {
      fresh.close();
    }
  });
});

describe('W4 · 切区验密：readWorkspaceGateHash', () => {
  it('W4-1 目标区存在设密码的 active 管理员 ⇒ 返回其哈希且验得动', async () => {
    await createWorkspaceOwnerDb({ dbName: 'idplan-ws-gate', ownerName: '甲', password: '9999' });
    const hash = await readWorkspaceGateHash('idplan-ws-gate');
    expect(hash).toBeTruthy();
    expect(await verifyPassword('9999', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('W4-2 库不存在（注册表悬挂）⇒ null（无可验之物，不建库不报错）', async () => {
    // Dexie.exists 对不存在的库返回 false；确认带外探测没有把库建出来
    const hash = await readWorkspaceGateHash('idplan-ws-missing');
    expect(hash).toBeNull();
    expect(await Dexie.exists('idplan-ws-missing')).toBe(false);
  });

  it('W4-3 管理员未设密码 ⇒ null（老库首次，切入不验密；成员密码不算闸密）', async () => {
    const db = await openDatabase('idplan-ws-nopw');
    try {
      await db.members.bulkAdd([
        {
          id: 'mem_admin_np',
          name: '无密码管理员',
          role: '负责人',
          contact: null,
          avatarColor: '#3D6B5B',
          active: true,
          roleKind: MemberRoleKind.Admin,
          passwordHash: null,
          actorKind: 'human',
          agentKind: null,
          revision: 1,
          updatedAt: '2026-10-01T00:00:00Z',
        },
        {
          id: 'mem_member_pw',
          name: '设了密码的普通成员',
          role: '',
          contact: null,
          avatarColor: '#D9A441',
          active: true,
          roleKind: MemberRoleKind.Member,
          passwordHash: 'aa:bb',
          actorKind: 'human',
          agentKind: null,
          revision: 1,
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ] as never);
    } finally {
      db.close();
    }
    // 成员行虽有哈希，但闸只认管理员（切区验的是工作区 Owner/管理员密码）
    expect(await readWorkspaceGateHash('idplan-ws-nopw')).toBeNull();
  });

  it('W4-4 带外读不改库版本（不绕过 RepoProvider 的迁移前备份闸门）', async () => {
    // 用「只声明 v1」造一个老版本库，读闸哈希后版本必须仍是 1
    const probe = new Dexie('idplan-ws-oldver');
    probe.version(1).stores({ members: 'id, active, name' });
    await probe.open();
    await probe.table('members').add({
      id: 'mem_old',
      name: '老库管理员',
      active: true,
      roleKind: 'admin',
      passwordHash: 'cd:ef',
    });
    probe.close();

    const hash = await readWorkspaceGateHash('idplan-ws-oldver');
    expect(hash).toBe('cd:ef');

    // 版本未被带外读抬升（若被抬到 5，老库升级就没有备份闸门了）
    const dbs = await indexedDB.databases();
    const raw = dbs.find((d) => d.name === 'idplan-ws-oldver');
    expect(raw?.version).toBe(10); // Dexie verno×10 = IDB version（见 dexie.database.ts 注）
  });
});
