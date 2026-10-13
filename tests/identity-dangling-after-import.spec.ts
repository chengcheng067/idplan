// @vitest-environment jsdom
/**
 * 身份悬挂（identity dangling）· 真跑 `bootstrapAllStores` + 真导入 + 真 store。
 *
 * ══════════════════ 症状（修复前）══════════════════
 * 任何**覆盖式导入**（`BackupService.importAndReplace`：整表清空再插包内行）都会把
 * `members` 换成新的一张表，而浏览器 `localStorage` 里存的身份 id **还在**
 * （导入后是 `window.location.reload()`，没人清过它）。于是：
 *   · `deriveRoleGuardState` 查无此人 ⇒ `role = null` ⇒ 用户被当「未进入身份」（受限视图）；
 *   · `useFirstRunGate` 要求 `currentMemberId === null` 才自动弹引导 ⇒ 这里非 null ⇒ **不提示**；
 *   · `FirstRunGuide` 的「身份流是否走完」信号是 `localStorage 非空` ⇒ **欢迎卡也被压掉**。
 * ⇒ 三条合起来就是「**身份悄悄没了，而且没有任何地方告诉你**」。
 * 这不限于示例数据：「把另一台机器的备份恢复到这台」同样中（异机成员 id 不同）。
 *
 * ══════════════════ 修复后的判据（本 spec 锁死）══════════════════
 *   `useRepos.ts` 的身份候选阶梯（优先级**不动**）每一档都必须**命中当前 members**；
 *   最终采用的不是本机那份时，把本机那份**清掉**（否则下游 `hydrate` 的
 *   `?? readLocalStorageId()` 会把它读回来，修复等于没做）。
 *
 * ══════════════════ 为什么这么测 ══════════════════
 *   走**真**函数：真 `BackupService.importAndReplace`（真 Dexie 落库）+ 真
 *   `bootstrapAllStores`（导入后 reload 那次装载走的正是它）+ 真 store。
 *   不 mock 任何身份逻辑 —— mock 掉就测不到「谁被采用」这件事本身。
 *   离散判据、零容差：判「最终 id 与 members 自洽」，不断言具体落成哪个 id（那由优先级决定）。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService } from '../src/core/services/backup.service';
import { buildDemoBackup } from '../src/core/demo/demoDataFactory';
import { emptyPackage } from './helpers/backup-fixture';
import { bootstrapAllStores } from '../src/hooks/useRepos';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { deriveRoleGuardState } from '../src/hooks/useRoleGuard';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';

let bundle: IRepositoryBundle;

/**
 * 本 spec 只写**一枚** localStorage 键（身份）⇒ 用「键数」判它是否被清掉即可，
 * 无需在测试里手写键名（键名的唯一出处在 `useSettingsStore.ts` 的 `LS_KEY`）。
 */
const lsKeyCount = (): number => localStorage.length;

/** 本机旧身份：模拟「上个成员集里选过的人」 */
const OLD_ID = 'm_local_old';

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  localStorage.clear();
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
  // store 是模块级单例：逐用例复位，免得上一条的注入污染
  useSettingsStore.getState().setCurrentMember(null);
  useMembersStore.getState().setAll([]);
  localStorage.clear();
});

/** 手写的**陌生成员集**（不经被测系统的导出链产出）：里面没有 OLD_ID 这个人 */
function strangerPackage(kvCurrentMemberId: string | null) {
  const base = emptyPackage();
  return {
    ...base,
    data: {
      ...base.data,
      members: [
        {
          id: 'stranger_admin',
          name: '陌生人管理员',
          role: '负责人',
          contact: null,
          avatarColor: '#3D6B5B',
          active: true,
          roleKind: MemberRoleKind.Admin,
          passwordHash: null,
          actorKind: MemberActorKind.Human,
          agentKind: null,
          revision: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      settings:
        kvCurrentMemberId === null
          ? []
          : [
              {
                key: 'currentMemberId',
                valueJson: JSON.stringify(kvCurrentMemberId),
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
    },
  };
}

/** 当前状态是否自洽：采用的 id 要么为空，要么真的在 members 里 */
function assertSelfConsistent(): void {
  const st = useSettingsStore.getState();
  const members = useMembersStore.getState().members;
  const guard = deriveRoleGuardState(members, st.currentMemberId, st.hydrated);
  if (st.currentMemberId !== null) {
    expect(
      guard.currentMember,
      `store 说身份是 ${st.currentMemberId}，但 members 里查无此人 —— 这就是悬挂（静默失效）`,
    ).not.toBeNull();
  }
  // 派生结论与 store 一致：非 null 且命中 ⇒ 必已进入身份
  expect(guard.isEntered).toBe(st.currentMemberId !== null && guard.currentMember !== null);
}

describe('身份悬挂：覆盖式导入换掉 members 之后', () => {
  it('① 导入陌生成员集 ⇒ 本机旧身份不再被采用，且状态自洽、旧值被清掉', async () => {
    useSettingsStore.getState().setCurrentMember(OLD_ID);
    expect(lsKeyCount()).toBe(1);

    // 陌生成员集（KV 里也没有 OLD_ID）→ 覆盖式导入 → 再走一次装载（= reload 后那次）
    await new BackupService(bundle).importAndReplace(strangerPackage(null) as never);
    await bootstrapAllStores(bundle);

    const st = useSettingsStore.getState();
    expect(st.currentMemberId, '旧身份已不存在，却仍被采用').not.toBe(OLD_ID);
    expect(st.currentMemberId).toBeNull();
    expect(lsKeyCount(), '悬挂的那份必须被清掉（否则它会被 hydrate 读回来）').toBe(0);
    assertSelfConsistent();
    // 自洽为「未进入身份」⇒ 身份控件会渲染「点击进入」入口（不是静默）
    expect(deriveRoleGuardState(useMembersStore.getState().members, st.currentMemberId, st.hydrated).isEntered).toBe(false);
  });

  it('② KV 兜底命中时（demo 包路径）⇒ 采用 demo 成员表里的人，且本机旧值被清掉', async () => {
    useSettingsStore.getState().setCurrentMember(OLD_ID);
    // 真 demo 包：它自带 settings.currentMemberId = 'demo_admin'，且 demo_admin 就在它的 members 里
    await new BackupService(bundle).importAndReplace(buildDemoBackup() as never);
    await bootstrapAllStores(bundle);

    const st = useSettingsStore.getState();
    expect(st.currentMemberId, '应回落到 KV 兜底（demo 自带的身份）').toBe('demo_admin');
    expect(lsKeyCount(), '本机那份悬挂值应被清掉（不是留着当僵尸）').toBe(0);
    assertSelfConsistent();
    const guard = deriveRoleGuardState(useMembersStore.getState().members, st.currentMemberId, st.hydrated);
    expect(guard.isEntered, 'demo 载入后用户应正常进入身份（而不是被静默踢出）').toBe(true);
    expect(guard.isAdmin).toBe(true);
  });

  it('③ 两档都悬挂（本机 + KV 都是查无此人的 id）⇒ 自洽为未进入，不留僵尸', async () => {
    useSettingsStore.getState().setCurrentMember(OLD_ID);
    await new BackupService(bundle).importAndReplace(strangerPackage('ghost_from_another_machine') as never);
    await bootstrapAllStores(bundle);

    const st = useSettingsStore.getState();
    expect(st.currentMemberId, 'KV 里那档也是悬挂的，不该被采用').toBeNull();
    expect(lsKeyCount()).toBe(0);
    assertSelfConsistent();
  });

  it('④ 反向保护：本机身份**存在但已停用** ⇒ 不被清掉（停用/再启用的既有行为不动）', async () => {
    // 这条是本修法的边界：判据是「存在」而不是「active」，否则「管理员把人停用、
    // 之后又启用 ⇒ 该成员自动恢复身份」这条既有路径会被悄悄掐断。
    await bundle.members.insert({
      name: '待停用的人',
      role: '执行',
      contact: null,
      avatarColor: '#5C7A9E',
    });
    const list = await bundle.members.list(true);
    const target = list.find((m) => m.name === '待停用的人');
    expect(target).toBeTruthy();
    await bundle.members.update(target!.id, { active: false });

    useSettingsStore.getState().setCurrentMember(target!.id);
    await bootstrapAllStores(bundle);

    const st = useSettingsStore.getState();
    expect(st.currentMemberId, '停用不等于不存在，id 不该被清').toBe(target!.id);
    expect(lsKeyCount(), '本机那份不该被清掉').toBe(1);
    // 但「active 才算进入身份」的口径仍由 deriveRoleGuardState 把守 ⇒ 派生出来仍是未进入
    const guard = deriveRoleGuardState(useMembersStore.getState().members, st.currentMemberId, st.hydrated);
    expect(guard.isEntered, '停用成员不该被当成已进入身份').toBe(false);
  });

  it('⑤ 常规路径不受影响：本机身份存在 ⇒ 原样采用（优先级没动）', async () => {
    await bundle.members.insert({
      name: '本人',
      role: '负责人',
      contact: null,
      avatarColor: '#3D6B5B',
    });
    const me = (await bundle.members.list(true)).find((m) => m.name === '本人')!;
    await bundle.settings.set('currentMemberId', 'someone_else_in_kv');

    useSettingsStore.getState().setCurrentMember(me.id);
    await bootstrapAllStores(bundle);

    const st = useSettingsStore.getState();
    expect(st.currentMemberId, '个人选择优先（v0.8.6 口径）').toBe(me.id);
    expect(lsKeyCount(), '合格的本机身份不该被动').toBe(1);
    assertSelfConsistent();
  });
});
