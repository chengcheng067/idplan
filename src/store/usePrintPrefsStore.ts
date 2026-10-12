import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_SCHEDULE_PAPER_BLOCKS,
  type SchedulePaperBlocks,
} from '../lib/schedule-print';
import {
  PRINT_MODULE_IDS,
  PRINT_TEMPLATE_IDS,
  isPrintTemplateId,
  legacySkinToTemplate,
  pageKindToModule,
  printTemplateDefaultModuleIds,
  printTemplateModuleIds,
  type PrintModuleId,
  type PrintTemplateId,
} from '../components/print/print-templates';
import {
  checkPrintPalette,
  templatePaletteSpec,
  type PrintPalette,
  type PrintPaletteGateResult,
} from '../print/model/print-palette';
import {
  PRINT_BLOCK_IDS,
  blocksFromLegacyModules,
  printTemplateUnitIds,
  type PrintBlockId,
  type PrintUnitId,
} from '../print/model/print-units';
import { normalizeHex } from '../core/color/contrast';

/**
 * 打印偏好（v0.8.6.0002 · 反馈 #9.2 / #9.3；四版模板重建 · 决策文档 §3.1；
 * v1.5-a 期二「外表 × 模块分离」· 决策文档 §3.3）。
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
 *   · `pages`：每模板一套勾选态，**缺键 = 默认勾选原生模块**
 *     （签名页；换模板不丢勾选——两套粒度并存，决策文档 §2.2；
 *     默认态口径的变迁见文件头末节）；
 *   · `palette`：每模板一套三槽位自定义配色，**缺键 = 设计师基线**。
 *     setPalette 是**硬闸门**：对比度不达标直接拒绝落库并返回失败明细
 *     （产品决策文档 §3.2：禁存，不是提示）；merge 读路径同样过闸——
 *     脏 localStorage 里的踩线配色在 hydrate 时就被丢弃，不进纸面。
 *
 * ── v1.5-a 期二：pages 语义升级（页粒度 → 模块粒度，决策文档 §3.3）──
 * 当时字段名沿用 `pages`（持久键不变，免一次 key 迁移），值的语义由
 * 「启用**页**」（PrintPageKind[]）升级为「启用**模块**」
 * （PrintModuleId[]）——4 套模板是外表，11 个内容模块跨模板可选。
 * 旧持久数据在 merge 时迁移：旧页 key 逐条映射模块 key，**有一条映射
 * 不了 ⇒ 该模板整组回落默认**（照现有兜底手法，脏数据不赌）。
 * ★ 后续（架构审查 2026-10-10 债②）：内存字段名已改为 `modules`；
 *   持久键双写（pages + modules）保既有读者零变化，读优先 modules、
 *   缺时回落 pages 跑上述迁移——本节描述的期二迁移逻辑仍活着，只是
 *   它现在住在「旧 pages 键 → modules」这条兜底路径上。
 *
 * ── v1.5-b 期三第一批：可用集 = 原生 + 通用 ──
 * M1 阶段清单 / M2 任务清单 / M4 成员名册在全部 4 套外表下可输出
 * （原生页 or 通用渲染，print-templates 能力表 generic 标记）。本 store 的
 * 「可用」判定随之从原生集扩为可用集（printTemplateModuleIds 的新语义）：
 * 勾选接受、旧数据迁移过滤都以它为准；勾选粒度仍是模块（一个模块 = 一页
 * or 多页，纸面落页由 enabledSheetsOf + 各 Document 的物理页装配决定）。
 *
 * ── 默认态收敛：缺键 = 原生签名页（她 10-09 23:38 反馈的修复） ──
 * 她的原话：「地板参考图的甘特图是示意图这个样子的，但是比如说现在我们
 * 做出来的东西，就完全不是这个味道，其他几个版本同理」——根因是 pages
 * 缺键的兜底曾是「全选可用」（原生 + 通用）：D 可用 7 个里 3 个通用
 * （M1/M2/M4）按 M1→M11 序排最前 ⇒ 打开 D 预览第一页是通用「阶段清单」
 * 表格而不是签名页「阶段进度矩阵」。故缺键兜底改为
 * `printTemplateDefaultModuleIds`（= 原生模块）：A 4 页 / D 4 页 /
 * E 3 页 / H 3 纸面。通用模块仍可手动勾选、「全选」范围仍为可用集
 * （printTemplateModuleIds）——变的只是默认态。持久化形状不变
 * （缺键即默认，落库的永远是用户显式勾选的结果）。
 */

/** localStorage key（单处定义；无首屏闪烁面，不需 index.html 引导脚本，见文件头） */
export const PRINT_PREFS_STORAGE_KEY = 'changxia.printPrefs';

export interface PrintPrefsState {
  /** 五块打印内容勾选（缺键由 merge 回落默认全开）——经典模板专用 */
  blocks: SchedulePaperBlocks;
  /** 当前模板（'classic' = 现有纸面） */
  template: PrintTemplateId;
  /**
   * 每模板一套「启用模块」勾选态（期二：原「启用页」语义升级；期三：可用集
   * = 原生 + 通用）。缺键 = 该模板默认勾选**原生**模块（签名页；她 10-09
   * 23:38 反馈的修复，见文件头末节）；暂不可用的模块 id 在 merge 时剔除。
   * 纸面页序由 print-templates 的 enabledSheetsOf 派生（注册表 M1→M11 序，
   * 与勾选顺序无关）。
   *
   * ★ 命名债清偿（架构审查 2026-10-10 债②）：内存字段从 `pages` 改为
   * `modules`——装的一直是 PrintModuleId[]，字段名却叫 pages，每个消费点都要
   * 在脑子里翻译一次。**持久化键保持 `pages` 不变**（partialize 双写：旧键
   * `pages` + 新键 `modules`），merge 读优先 `modules` 键、缺时回落 `pages`
   * 键并跑旧页→模块迁移；任何既有用户数据零丢失、零迁移脚本。
   */
  modules: Partial<Record<PrintTemplateId, PrintModuleId[]>>;
  /**
   * 每模板一套「启用**单元**」集合（2026-10-13 · 5 块 × 4 模板重构 · 批 1）。
   *
   * ── 为什么再加一层键（决策 5 第 4 条）──
   * 用户原话：「版性装置不参与勾选，同意，不过**预留接口未来肯定是会开放勾选的**」。
   * 故持久化形状今天就装得下：per-template 存「单元 id 集合」，**缺失 = 默认开**
   * ⇒ 将来把装置开放成可勾时，老用户数据天然可用（缺省全开），**零迁移**。
   *
   * ── 与三个旧键的关系（**一个都不删**）──
   * · `blocks`（经典五块）：仍是 classic 的唯一正主。`resolveUnits` 对 classic
   *   读它，故本键里**不会**有 `classic` 条目（同 `palette` 的「classic 永不有条目」）；
   * · `modules`（11 模块）：正主仍是它（D/E/H 批 2/3/4 才切），本键的旧数据迁移
   *   **从它读**、不写回、不删除（读出来映射到新单元，原键保留不动）；
   * · `pages`（更早的页键）：老迁移链（pages → modules）原样保留，本键不参与。
   */
  units: Partial<Record<PrintTemplateId, PrintUnitId[]>>;
  /** 每模板一套自定义三槽位配色（缺键 = 设计师基线；classic 永不有条目） */
  palette: Partial<Record<PrintTemplateId, PrintPalette>>;
  /** 摘/贴一块（即时重渲染纸面 = 所见即所得） */
  setBlock(key: keyof SchedulePaperBlocks, on: boolean): void;
  /** 切模板（选择器上截；即时重渲染） */
  setTemplate(id: PrintTemplateId): void;
  /** 勾 / 消一个模块（缺键时从「默认原生」起手；暂不可用的模块不接受） */
  setModuleEnabled(template: PrintTemplateId, module: PrintModuleId, on: boolean): void;
  /** 整模板设启用模块集合（全选 / 反选；暂不可用的 id 忽略） */
  setTemplateModules(template: PrintTemplateId, modules: PrintModuleId[]): void;
  /**
   * 勾 / 消一个**单元**（5 块的 5 行选择器走它；缺键时从「默认全开」起手）。
   * `classic` 不接受（它的正主是 `blocks`，同 palette 的口径）⇒ 无操作。
   */
  setUnit(template: PrintTemplateId, id: PrintUnitId, on: boolean): void;
  /** 整模板设启用单元集合（选择器的「全选 / 反选」；未声明的 id 忽略） */
  setTemplateUnits(template: PrintTemplateId, ids: PrintUnitId[]): void;
  /**
   * 存自定义配色。**硬闸门**：任一对对比度不达标 ⇒ 不落库 + 返回失败明细
   * （指名哪一对、当前比值多少）。传 null = 恢复设计师基线（删除该键）。
   */
  setPalette(template: PrintTemplateId, palette: PrintPalette | null): PrintPaletteGateResult;
}

/**
 * 该模板**可用**的模块 id（原生 + 通用；未知模板 / 经典 ⇒ 空集）。
 * 期三：printTemplateModuleIds 语义升级为「可用集」——M1/M2/M4 在 D/E/H
 * 经通用渲染进入可用集，勾选接受 / 全选 / 迁移过滤都以它为准。
 * ⚠️ 可用集 ≠ 默认态：缺键默认是原生签名页（printTemplateDefaultModuleIds，
 * 见文件头末节），本函数只回答「这个外表下哪些模块可勾选」。
 */
function availableModules(template: PrintTemplateId): PrintModuleId[] {
  return printTemplateModuleIds(template);
}

/** 规范化一组模块勾选（实时设置路径）：只留可用 id，按 PRINT_MODULES 序去重 */
function normalizeModules(template: PrintTemplateId, value: unknown): PrintModuleId[] | null {
  if (!Array.isArray(value)) return null;
  const available = availableModules(template);
  const kept = new Set(value.filter((m): m is PrintModuleId => available.includes(m as PrintModuleId)));
  return PRINT_MODULE_IDS.filter((m) => kept.has(m));
}

/**
 * 旧 pages 数据迁移（期二：页粒度 → 模块粒度，决策文档 §3.3）：
 * 旧页 key 逐条映射模块 key；**有一条映射不了 ⇒ 整组回落默认**
 * （返回 null = 调用方不存该键 = 缺键走默认原生，照现有 merge 兜底手法）。
 * 映射成功的组按「可用 + 注册序」收编——跨模板脏页名自然滤掉
 * （期三：在某外表可用的模块——含通用渲染——不再被滤掉）。
 */
function migrateLegacyPages(template: PrintTemplateId, value: unknown): PrintModuleId[] | null {
  if (!Array.isArray(value)) return null;
  const mapped = new Set<PrintModuleId>();
  for (const page of value) {
    const module = pageKindToModule(page);
    if (module === null) return null;
    mapped.add(module);
  }
  const available = availableModules(template);
  return PRINT_MODULE_IDS.filter((m) => available.includes(m) && mapped.has(m));
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

/**
 * 规范化一组**单元**勾选（实时设置路径 + 读路径共用）：只留该模板声明的 id，
 * 按注册表序去重（落库形状稳定 = 将来对账/迁移可预期）。非数组 ⇒ null。
 */
function normalizeUnits(template: PrintTemplateId, value: unknown): PrintUnitId[] | null {
  if (!Array.isArray(value)) return null;
  const declared = printTemplateUnitIds(template);
  const set = new Set(value.filter((u): u is PrintUnitId => declared.includes(u as PrintUnitId)));
  return declared.filter((u) => set.has(u));
}

/**
 * 旧「11 模块」勾选 → 新单元集合（**读出来映射到新单元、原键不删**，决策 5 第 4 条
 * 的兼容链路）。`classic` 不在此处造条目——它的正主是 `blocks`（`resolveUnits` 读它）。
 */
function unitsFromLegacyModules(
  template: PrintTemplateId,
  modules: readonly PrintModuleId[] | undefined,
): PrintUnitId[] | null {
  if (template === 'classic' || modules === undefined) return null;
  const mapped = blocksFromLegacyModules(modules);
  if (mapped === null) return null;
  // 无承载位的块不表态 ⇒ 按默认（全开）处置，避免把旧数据翻译成一张白纸
  const enabled = PRINT_BLOCK_IDS.filter((b) => mapped[b] ?? DEFAULT_SCHEDULE_PAPER_BLOCKS[b]);
  return printTemplateUnitIds(template).filter((u) => enabled.includes(u as PrintBlockId));
}

export const usePrintPrefsStore = create<PrintPrefsState>()(
  persist(
    (set) => ({
      blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS },
      template: 'classic',
      modules: {},
      units: {},
      palette: {},

      setBlock: (key, on) =>
        set((s) => ({ blocks: { ...s.blocks, [key]: on } })),
      setTemplate: (template) => set({ template }),
      setModuleEnabled: (template, module, on) =>
        set((s) => {
          const available = availableModules(template);
          // 暂不可用的模块（能力表里没有的）不接受勾选
          if (!available.includes(module)) return {};
          // 缺键时从「默认原生模块」起手（她 10-09 23:38 反馈：默认必须落到
          // 签名原生页，通用模块不进默认态——可手动勾选，见 print-templates 的
          // printTemplateDefaultModuleIds）
          const current = s.modules[template] ?? printTemplateDefaultModuleIds(template);
          const next = on ? [...new Set([...current, module])] : current.filter((m) => m !== module);
          return { modules: { ...s.modules, [template]: PRINT_MODULE_IDS.filter((m) => next.includes(m)) } };
        }),
      setTemplateModules: (template, modules) =>
        set((s) => {
          const next = normalizeModules(template, modules);
          if (next === null) return {};
          return { modules: { ...s.modules, [template]: next } };
        }),
      setUnit: (template, id, on) =>
        set((s) => {
          // classic 的正主是 `blocks`（resolveUnits 读它）；此处不接受它的键，
          // 免得同一件事出现两份可能分叉的真相（同 palette 的 classic 口径）
          if (template === 'classic') return {};
          const declared = printTemplateUnitIds(template);
          if (!declared.includes(id)) return {};
          // 缺键时从「默认全开」起手（决策 5 第 4 条：缺失 = 默认开）。
          // ⚠️ 起手集 = **该模板声明的全部单元**（含装置，今天 forced）：集合语义是
          // 「单元 id 集合」，将来把装置开放成可勾时，老用户的装置**已经在集合里**
          // ⇒ 天然保持开启，不需要迁移（这正是「今天就装得下的形状」的意思）。
          const current = s.units[template] ?? declared;
          const next = on ? [...new Set([...current, id])] : current.filter((u) => u !== id);
          return { units: { ...s.units, [template]: declared.filter((u) => next.includes(u)) } };
        }),
      setTemplateUnits: (template, ids) =>
        set((s) => {
          if (template === 'classic') return {};
          const next = normalizeUnits(template, ids);
          if (next === null) return {};
          return { units: { ...s.units, [template]: next } };
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
        // 双写（债② 兼容）：旧键 `pages` 继续写 ⇒ 任何只认 pages 的既有读者
        // （含测试手写夹具、降级路径）零变化；新键 `modules` 是正主。
        pages: s.modules,
        modules: s.modules,
        // 新键 `units`（2026-10-13 批 1）：per-template 单元集合，缺失 = 默认全开。
        // 三个旧键**一个都不删**（pages/modules 仍在写、blocks 仍是 classic 正主）。
        units: s.units,
        palette: s.palette,
      }),
      merge: (persisted, current) => {
        const {
          skin: legacySkin,
          pages: legacyPages,
          modules: persistedModules,
          units: persistedUnits,
          ...p
        } = (persisted ?? {}) as Partial<PrintPrefsState> & {
          skin?: unknown;
          pages?: unknown;
          modules?: unknown;
          units?: unknown;
        };
        // 旧 skin 键迁移（决策文档 §2.3 第 3 条）：'default' → 'classic'；
        // 脏值 / 缺键 ⇒ 回落现模板（classic）
        const template = isPrintTemplateId(p.template)
          ? p.template
          : legacySkinToTemplate(legacySkin) ?? current.template;
        // 勾选态读路径（债② 双写兼容，决策文档 §3.3 语义不变）：
        //   · 有 `modules` 键 ⇒ 正主，normalizeModules 收形（期二旧「启用页」
        //     键的数据早在期二 merge 已迁走，这里只处理模块形）；
        //   · 只有旧 `pages` 键（债② 之前的持久值）⇒ 回落 migrateLegacyPages
        //     把「启用页」（PrintPageKind[]）逐条迁「启用模块」；有一条映射
        //     不了 ⇒ 该模板回落默认（缺键走原生默认）。
        // classic 不走模块表（五块 blocks 另一套粒度）⇒ 不收它的键；
        // 未知 template id 剔除（同 palette 口径）
        const rawSource = persistedModules ?? legacyPages ?? {};
        const raw: Record<string, unknown> =
          typeof rawSource === 'object' && rawSource !== null
            ? (rawSource as Record<string, unknown>)
            : {};
        const fromModulesKey = persistedModules != null;
        const modules: Partial<Record<PrintTemplateId, PrintModuleId[]>> = {};
        for (const id of Object.keys(raw) as PrintTemplateId[]) {
          if (id === 'classic' || !isPrintTemplateId(id)) continue;
          const next = fromModulesKey
            ? normalizeModules(id, raw[id])
            : migrateLegacyPages(id, raw[id]);
          if (next !== null) modules[id] = next;
        }
        // palette：三槽位合法 hex **且过闸门**才收——脏数据里的踩线配色在
        // hydrate 时丢弃（禁存在读路径同样生效，不进纸面）
        const palette: Partial<Record<PrintTemplateId, PrintPalette>> = {};
        for (const id of Object.keys(p.palette ?? {}) as PrintTemplateId[]) {
          if (id === 'classic' || !isPrintTemplateId(id)) continue;
          const next = normalizePalette((p.palette ?? {})[id]);
          if (next !== null && checkPrintPalette(id, next).ok) palette[id] = next;
        }
        /**
         * units（2026-10-13 批 1）：正主优先，缺失 ⇒ 由**已迁移好的 modules**
         * 映射（决策 5 第 4 条 + 「旧键读出来映射到新单元、不删原键」）。
         * classic 不建条目（正主 = blocks）；两者都缺 ⇒ 不建键 = 默认全开。
         */
        const unitsRaw =
          typeof persistedUnits === 'object' && persistedUnits !== null
            ? (persistedUnits as Record<string, unknown>)
            : null;
        const units: Partial<Record<PrintTemplateId, PrintUnitId[]>> = {};
        for (const id of PRINT_TEMPLATE_IDS) {
          if (id === 'classic') continue;
          const stored = unitsRaw ? normalizeUnits(id, unitsRaw[id]) : null;
          if (stored !== null) {
            units[id] = stored;
            continue;
          }
          const migrated = unitsFromLegacyModules(id, modules[id]);
          if (migrated !== null) units[id] = migrated;
        }
        return {
          ...current,
          ...p,
          // 旧持久值缺新键 ⇒ 回落默认（缺键 = undefined = 渲染层当关，会静默少块）
          blocks: { ...current.blocks, ...(p.blocks ?? {}) },
          template,
          modules,
          units,
          palette,
        };
      },
    },
  ),
);
