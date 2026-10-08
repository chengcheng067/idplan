import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_SCHEDULE_PAPER_BLOCKS,
  type SchedulePaperBlocks,
} from '../lib/schedule-print';
import {
  isPrintTemplateId,
  legacySkinToTemplate,
  printTemplatePages,
  type PrintTemplateId,
} from '../components/print/print-skins';
import {
  checkPrintPalette,
  templatePaletteSpec,
  type PrintPalette,
  type PrintPaletteGateResult,
} from '../print/model/print-palette';
import type { PrintPageKind } from '../print/model/print-view-model';
import { normalizeHex } from '../core/color/contrast';

/**
 * 打印偏好（v0.8.6.0002 · 反馈 #9.2 / #9.3；四版模板重建 · 决策文档 §3.1）。
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
 * 故自定义 merge：缺键回落默认、未知 template id 回落 classic、
 * 旧 `skin` 键迁 `template`（决策文档 §2.3 第 3 条）。
 *
 * ── v0.8.6 四版重建的字段增量（skin → template + pages + palette）──
 *   · `template`：模板选择（'classic' = 原 'default' 皮肤转正，决策 ⑦）；
 *   · `pages`：每模板一套「启用页」勾选态，**缺键 = 该模板默认全选**
 *     （01 §8 明文；换模板不丢勾选——两套粒度并存，决策文档 §2.2）；
 *   · `palette`：每模板一套三槽位自定义配色，**缺键 = 设计师基线**。
 *     setPalette 是**硬闸门**：对比度不达标直接拒绝落库并返回失败明细
 *     （产品决策文档 §3.2：禁存，不是提示）；merge 读路径同样过闸——
 *     脏 localStorage 里的踩线配色在 hydrate 时就被丢弃，不进纸面。
 */

/** localStorage key（单处定义；无首屏闪烁面，不需 index.html 引导脚本，见文件头） */
export const PRINT_PREFS_STORAGE_KEY = 'changxia.printPrefs';

export interface PrintPrefsState {
  /** 五块打印内容勾选（缺键由 merge 回落默认全开）——经典模板专用 */
  blocks: SchedulePaperBlocks;
  /** 当前模板（'classic' = 现有纸面） */
  template: PrintTemplateId;
  /** 每模板一套「启用页」（缺键 = 默认全选；未知页 id 在 merge 时剔除） */
  pages: Partial<Record<PrintTemplateId, PrintPageKind[]>>;
  /** 每模板一套自定义三槽位配色（缺键 = 设计师基线；classic 永不有条目） */
  palette: Partial<Record<PrintTemplateId, PrintPalette>>;
  /** 摘/贴一块（即时重渲染纸面 = 所见即所得） */
  setBlock(key: keyof SchedulePaperBlocks, on: boolean): void;
  /** 切模板（选择器上截；即时重渲染） */
  setTemplate(id: PrintTemplateId): void;
  /** 勾 / 消一页（缺键时从「默认全选」起手） */
  setPageEnabled(template: PrintTemplateId, page: PrintPageKind, on: boolean): void;
  /** 整模板设启用页集合（全选 / 反选；未知页 id 忽略） */
  setTemplatePages(template: PrintTemplateId, pages: PrintPageKind[]): void;
  /**
   * 存自定义配色。**硬闸门**：任一对对比度不达标 ⇒ 不落库 + 返回失败明细
   * （指名哪一对、当前比值多少）。传 null = 恢复设计师基线（删除该键）。
   */
  setPalette(template: PrintTemplateId, palette: PrintPalette | null): PrintPaletteGateResult;
}

/** 该模板的已知页 id（未知模板 / 经典 ⇒ 空集） */
function knownPages(template: PrintTemplateId): PrintPageKind[] {
  return printTemplatePages(template).map((p) => p.id);
}

/** 规范化一组页勾选：只保留已知 id，按注册表顺序去重 */
function normalizePages(template: PrintTemplateId, pages: unknown): PrintPageKind[] | null {
  if (!Array.isArray(pages)) return null;
  const known = knownPages(template);
  const kept = new Set(pages.filter((p): p is PrintPageKind => known.includes(p as PrintPageKind)));
  return known.filter((p) => kept.has(p));
}

/** 规范化一组配色：三槽位全是合法 hex 才收（否则整组丢弃，回落基线） */
function normalizePalette(value: unknown): PrintPalette | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const accent = normalizeHex(v.accent);
  const ink = normalizeHex(v.ink);
  const line = normalizeHex(v.line);
  if (accent === null || ink === null || line === null) return null;
  return { accent, ink, line };
}

export const usePrintPrefsStore = create<PrintPrefsState>()(
  persist(
    (set) => ({
      blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS },
      template: 'classic',
      pages: {},
      palette: {},

      setBlock: (key, on) =>
        set((s) => ({ blocks: { ...s.blocks, [key]: on } })),
      setTemplate: (template) => set({ template }),
      setPageEnabled: (template, page, on) =>
        set((s) => {
          const known = knownPages(template);
          if (!known.includes(page)) return {};
          const current = s.pages[template] ?? known;
          const next = on ? [...new Set([...current, page])] : current.filter((p) => p !== page);
          return { pages: { ...s.pages, [template]: known.filter((p) => next.includes(p)) } };
        }),
      setTemplatePages: (template, pages) =>
        set((s) => {
          const next = normalizePages(template, pages);
          if (next === null) return {};
          return { pages: { ...s.pages, [template]: next } };
        }),
      setPalette: (template, palette) => {
        const spec = templatePaletteSpec(template);
        // classic 不开放配色（品牌资产，决策文档 §3.2 边界）：无 spec ⇒ 无操作
        if (!spec) return { ok: true, pairs: [], failures: [], message: null };
        // 恢复基线 = 删键（缺键即基线）；基线自身过闸已由 print-palette.spec 锁
        if (palette === null) {
          set((s) => {
            const next = { ...s.palette };
            delete next[template];
            return { palette: next };
          });
          return checkPrintPalette(template, spec.baseline);
        }
        // 硬闸门：不达标 ⇒ 原样返回失败明细，**一个字节都不落库**
        const gate = checkPrintPalette(template, palette);
        if (!gate.ok) return gate;
        const normalized = normalizePalette(palette) ?? palette;
        set((s) => ({ palette: { ...s.palette, [template]: normalized } }));
        return gate;
      },
    }),
    {
      name: PRINT_PREFS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        blocks: s.blocks,
        template: s.template,
        pages: s.pages,
        palette: s.palette,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrintPrefsState> & { skin?: unknown };
        // 旧 skin 键迁移（决策文档 §2.3 第 3 条）：'default' → 'classic'；
        // 脏值 / 缺键 ⇒ 回落现模板（classic）
        const template = isPrintTemplateId(p.template)
          ? p.template
          : legacySkinToTemplate(p.skin) ?? current.template;
        // pages：已知模板的数组才收，未知页 id 剔除；缺键不补（缺键 = 全选）
        const pages: Partial<Record<PrintTemplateId, PrintPageKind[]>> = {};
        for (const id of Object.keys(p.pages ?? {}) as PrintTemplateId[]) {
          if (!isPrintTemplateId(id)) continue;
          const next = normalizePages(id, (p.pages ?? {})[id]);
          if (next !== null) pages[id] = next;
        }
        // palette：三槽位合法 hex **且过闸门**才收——脏数据里的踩线配色在
        // hydrate 时丢弃（禁存在读路径同样生效，不进纸面）
        const palette: Partial<Record<PrintTemplateId, PrintPalette>> = {};
        for (const id of Object.keys(p.palette ?? {}) as PrintTemplateId[]) {
          if (id === 'classic' || !isPrintTemplateId(id)) continue;
          const next = normalizePalette((p.palette ?? {})[id]);
          if (next !== null && checkPrintPalette(id, next).ok) palette[id] = next;
        }
        return {
          ...current,
          ...p,
          // 旧持久值缺新键 ⇒ 回落默认（缺键 = undefined = 渲染层当关，会静默少块）
          blocks: { ...current.blocks, ...(p.blocks ?? {}) },
          template,
          pages,
          palette,
        };
      },
    },
  ),
);
