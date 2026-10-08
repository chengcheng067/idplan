import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_SCHEDULE_PAPER_BLOCKS,
  type SchedulePaperBlocks,
} from '../lib/schedule-print';
import { PRINT_SKINS, type PrintSkinId } from '../components/print/print-skins';

/**
 * 打印偏好（v0.8.6.0002 · 反馈 #9.2 / #9.3）：打印内容五块勾选 + 皮肤。
 *
 * ── 为什么是 zustand + persist 到 localStorage ──
 * 打印内容选择是**个人偏好**（怎么打自己的排期自己定），不是公司制度，
 * 因此 **不进备份 JSON**（那会把它推给全公司/全成员）；同时**无角色门控**
 * （成员也打印，与「放开成员打印」同一口径）。落 localStorage = 换设备
 * 恢复默认，可接受；同设备刷新/换会话保持选择，正是需求要的。
 *
 * ── 与 useLayoutStore 的 key 纪律 ──
 * `useLayoutStore` 的 key 三处一致（index.html 防闪脚本 / persist name /
 * 常量子）是因为**侧栏宽度有首屏闪烁面**：首帧前就要按持久值定宽。
 * 本 store **没有这个面**——默认五块全开 = 默认渲染形态，hydrate 前后
 * 同形，故不做 index.html 引导脚本，key 只在本文件定义一次即可。
 *
 * ── merge 为什么不能省 ──
 * persist 默认 merge 是**整体替换**：旧版本持久值若缺某个块键
 * （将来加第六块时的既存数据），整块 `blocks` 对象缺键 → 该键
 * undefined → 渲染层当「关」→ **静默少打一块**。比丢偏好更糟，
 * 故自定义 merge：缺键回落默认、未知 skin id 回落 'default'。
 */

/** localStorage key（单处定义；无首屏闪烁面，不需 index.html 引导脚本，见文件头） */
export const PRINT_PREFS_STORAGE_KEY = 'changxia.printPrefs';

export interface PrintPrefsState {
  /** 五块打印内容勾选（缺键由 merge 回落默认全开） */
  blocks: SchedulePaperBlocks;
  /** 皮肤（v1 仅 'default'） */
  skin: PrintSkinId;
  /** 摘/贴一块（即时重渲染纸面 = 所见即所得） */
  setBlock(key: keyof SchedulePaperBlocks, on: boolean): void;
  setSkin(id: PrintSkinId): void;
}

export const usePrintPrefsStore = create<PrintPrefsState>()(
  persist(
    (set) => ({
      blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS },
      skin: 'default',

      setBlock: (key, on) =>
        set((s) => ({ blocks: { ...s.blocks, [key]: on } })),
      setSkin: (skin) => set({ skin }),
    }),
    {
      name: PRINT_PREFS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ blocks: s.blocks, skin: s.skin }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrintPrefsState>;
        return {
          ...current,
          ...p,
          // 旧持久值缺新键 ⇒ 回落默认（缺键 = undefined = 渲染层当关，会静默少块）
          blocks: { ...current.blocks, ...(p.blocks ?? {}) },
          // 未知 / 脏 skin id（含将来删掉的皮肤）⇒ 回落 default
          skin: PRINT_SKINS.some((k) => k.id === p.skin) ? (p.skin as PrintSkinId) : current.skin,
        };
      },
    },
  ),
);
