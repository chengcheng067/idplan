import { create } from 'zustand';

import type { Member } from '../core/types/entities';
import type { CreateMemberCmd, UpdateMemberCmd } from '../core/types/dto';
import { resolveErrorText } from '../core/types/enums';
import { useProjectsStore, setMemberCacheForNames } from './useProjectsStore';
import { useSettingsStore } from './useSettingsStore';
import { t } from '../i18n';

/** 成员镜像：列表 + CRUD action（异步持久化经 repo，失败 toast 回滚） */
export interface MembersState {
  members: Member[];
  setAll(list: Member[]): void;
  upsert(m: Member): void;
  removeLocal(id: string): void;
}

export const useMembersStore = create<MembersState>((set) => ({
  members: [],
  setAll: (list) => {
    setMemberCacheForNames(list);
    set({ members: list });
  },
  upsert: (m) =>
    set((st) => {
      const next = st.members.some((x) => x.id === m.id)
        ? st.members.map((x) => (x.id === m.id ? m : x))
        : [...st.members, m];
      setMemberCacheForNames(next);
      return { members: next };
    }),
  removeLocal: (id) =>
    set((st) => {
      const next = st.members.filter((m) => m.id !== id);
      setMemberCacheForNames(next);
      return { members: next };
    }),
}));

export function createMemberActions(repos: import('../core/repositories/interfaces').IRepositoryBundle) {
  const store = useMembersStore.getState();

  return {
    async loadAll(): Promise<void> {
      const list = await repos.members.list(true);
      store.setAll(list);
    },

    async create(cmd: CreateMemberCmd): Promise<boolean> {
      try {
        const created = await repos.members.insert(cmd);
        store.upsert(created);
        useProjectsStore.getState().pushToast('success', t('toast.memberAdded', { name: created.name }));
        return true;
      } catch (err) {
        useProjectsStore
          .getState()
          .pushToast('error', resolveErrorText(err, t, t('toast.memberAddFailed')));
        return false;
      }
    },

    async update(id: string, cmd: UpdateMemberCmd): Promise<void> {
      try {
        const updated = await repos.members.update(id, cmd);
        store.upsert(updated);
        useProjectsStore.getState().pushToast('success', t('toast.memberUpdated'));
      } catch (err) {
        useProjectsStore
          .getState()
          .pushToast('error', resolveErrorText(err, t, t('toast.updateFailed')));
      }
    },

    /** 设置/重置成员密码（明文，repo 各自哈希）；空串视为清除密码 */
    async setPassword(id: string, password: string): Promise<void> {
      await this.update(id, { password: password || null });
    },

    /** 停用 = active=false（软停用，历史指派记录保留） */
    async setActive(id: string, active: boolean): Promise<void> {
      await this.update(id, { active });
    },

    /**
     * **删除**成员（真删行；与上面的软停用并存，各管一件事）。
     *
     * ── 与 `setActive(id,false)` 的分工（别把两者合并）──
     *   · 停用：人还在名单里（灰着）、历史全留、随时可以再启用 ⇒ 处理「暂时离开」；
     *   · 删除：行真的没了 ⇒ 处理「这个人不该再出现在系统里」。
     * 用户提过多次「只有停用、没有删除」，本方法是后者的唯一入口。
     *
     * ── `reassignTo` 三态 ──
     *   `null`  ⇒ 名下引用**置空**（`assigneeId`/`ownerId`/`ownerMemberId` → null；
     *             `assigneeIds` 里只移除该项、其余保留），界面显示「已删除成员」灰名；
     *   成员 id ⇒ 引用**改到该成员**，再删。
     * 仓储层（local / remote）在**一个事务**里做完引用改写 + 删行，`AssignmentLog`
     * 一律不碰（append-only 审计）。
     *
     * ── 删的是「当前登录身份」本人时必须清身份（本方法是唯一出口）──
     * 不清的后果不是报错而是**静默卡死**：`deriveRoleGuardState` 查无此人 ⇒ `role=null`
     * ⇒ 用户被当成「未进入身份」（受限视图）；而 `useFirstRunGate` 只在
     * `currentMemberId === null` 时才自动弹引导 ⇒ 这里非 null ⇒ **既不提示也不引导**。
     * 这与 `useRepos.ts` 的「身份悬挂」是**同一个病灶**，修法也必须是同一个：
     * 走 `setCurrentMember(null)` 这个身份的**唯一写入口**（它还会顺带清掉
     * localStorage 的区级键与「已进入某区」标记，让首屏正常回到选公司）。
     *
     * 返回被改写的行数，供页面报「转移了 N 个任务 / M 个阶段 / K 个项目」。
     */
    async remove(
      id: string,
      reassignTo: string | null,
    ): Promise<import('../core/repositories/interfaces').MemberRefRewrite | null> {
      try {
        const counts = await repos.members.delete(id, reassignTo);
        const victim = store.members.find((m) => m.id === id) ?? null;
        store.removeLocal(id);
        /*
         * 清身份必须**在** removeLocal 之后：`setCurrentMember(null)` 会触发
         * 「回到未进入身份」的重渲染，此时 members 里若还留着这个已删的人，
         * `deriveRoleGuardState` 仍可能在这一帧读到他（顺序错就是一闪而过的旧身份）。
         */
        if (useSettingsStore.getState().currentMemberId === id) {
          useSettingsStore.getState().setCurrentMember(null);
        }
        const name = victim?.name ?? '';
        if (reassignTo !== null) {
          useProjectsStore.getState().pushToast(
            'success',
            t('member.toastMemberDeletedWithRefs', {
              name,
              tasks: counts.tasks,
              stages: counts.stages,
              projects: counts.projects,
            }),
          );
        } else if (counts.tasks + counts.stages + counts.projects > 0) {
          useProjectsStore.getState().pushToast(
            'success',
            t('member.toastMemberDeletedOrphaned', {
              name,
              tasks: counts.tasks,
              stages: counts.stages,
              projects: counts.projects,
            }),
          );
        } else {
          useProjectsStore
            .getState()
            .pushToast('success', t('member.toastMemberDeleted', { name }));
        }
        return counts;
      } catch (err) {
        useProjectsStore
          .getState()
          .pushToast('error', resolveErrorText(err, t, t('member.toastMemberDeleteFailed')));
        return null;
      }
    },
  };
}
