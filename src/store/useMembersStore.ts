import { create } from 'zustand';

import type { Member } from '../core/types/entities';
import type { CreateMemberCmd, UpdateMemberCmd } from '../core/types/dto';
import { resolveErrorText } from '../core/types/enums';
import { useProjectsStore, setMemberCacheForNames } from './useProjectsStore';
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
  };
}
