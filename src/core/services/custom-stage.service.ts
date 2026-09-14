/**
 * 自定义阶段库（v0.8 · 领队 TBD-7b 裁决：存储 ＝ `settings` 表的一条 KV 记录）。
 *
 * ── 为什么不是一张新表 ──
 * 「用户自定义阶段」要跨项目复用，直觉上是 `customStages` 表。但本仓库已有的
 * `settings` KV 表（自 v0.6 起就在，`taskNoSeq` 住在里面）已经具备本场景需要的全部性质：
 *   ① **零新仓储代码** —— `ISettingsRepository.get/set` 本地与远程两套实现都已存在
 *      （`repositories/local/local.settings.repo.ts` / `remote/rest.client.ts`）；
 *   ② **零备份改动** —— `backup.service.ts` 的 `settings` 表是**整表全量往返**
 *      （`admin.fullExport()` 的 `db.settings.toArray()`），自定义阶段库因此**自动**随
 *      导出/导入往返，不需要改任何备份代码（验收 10）；
 *   ③ **零 Dexie 版本动作** —— 不新增表 ⇒ 不 bump `SCHEMA_VERSION`、不动索引串，
 *      也就不会触发「迁移前备份闸门」那类不可逆升级流程。
 * 读写手法照抄 `project.service.ts` 里 restPolicy 的既有范式（`bundle.settings.get<T>(key)`）。
 *
 * ── 一行回退（TS-07 交付要求） ──
 * `CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS = false` ⇒ 复用池恒空、`rememberCustomStage`
 * 变空操作（自定义阶段只活在表单内存态，不落 settings），**且不需要改任何组件**：
 * 组件层禁止直接触碰 `settings` 的该键，所有读写只能经本文件导出函数。
 *
 * ── 落库口径（与「是否跨项目复用」正交） ──
 * 建档时选中的自定义阶段**无论如何**都会落进 `Stage` 表：`templateKey = null`
 * （禁止伪造模板 key，见 `project.service.normalizeDraftTemplateKey`）＋
 * `customColor = 用户选的主色`。那是项目数据，不受本开关影响。
 */

import { createId } from '../../lib/id';
import { normalizeHex } from '../color/contrast';
import { MAX_COLOR_INDEX, MIN_COLOR_INDEX } from '../template/stage-fallback';
import { getDomainColumns } from '../template/stage-library';
import type { ISettingsRepository } from '../repositories/interfaces';
import type { StageSelectionItem, StageTemplateDomain } from '../types/dto';

/**
 * TS-07 一行回退点（**唯一开关**）。
 *
 *   true  = 跨项目持久化复用（默认）：自定义阶段记入 `settings` KV，下次建档可选；
 *   false = 项目内联：仅存活于当前表单内存态，不进 Dexie、下次建档看不到。
 *
 * 回退时**不需要改任何组件**（组件只看 `listReusableCustomStages()` 的返回值）。
 */
export const CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS = true;

/**
 * KV 键名（**单一出处**）。写法照抄 `src/core/lib/task-no.ts` 的 `TASK_NO_SEQ_KEY`：
 * 任何一处写成字面量 `'customStages'` 都会在某次重命名时静默脱钩
 * （读旧键得 null → 复用池凭空清空，而**不会报任何错**）。
 */
export const CUSTOM_STAGES_SETTING_KEY = 'customStages';

/** 自定义阶段项在**选中列表**里的 key 前缀（与模板库 key 天然不冲突） */
export const CUSTOM_STAGE_KEY_PREFIX = 'cst.';

/** 自定义阶段未指定占比时的兜底占比（建档弹窗默认给「已选阶段占比的平均值」） */
export const DEFAULT_CUSTOM_STAGE_RATIO = 5;

/** 时间戳缺失时的兜底（老库/手改 KV 可能没有；不抛错，用纪元值） */
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/** 自定义阶段库条目（**只存主色**，三层派生不落库 —— 设计 §2.4.3 决策 1） */
export interface CustomStageDef {
  /** `cst_<uuid>` */
  id: string;
  name: string;
  /** 工作量占比（%）；null = 建档时按已选阶段占比平均值兜底 */
  ratioPercent: number | null;
  /** 用户选的主色 `#RRGGBB`；null = 用内置色板（colorIndex） */
  colorMain: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 本服务的最小依赖（与 `IRepositoryBundle` 结构兼容，便于单测直接注入假仓储） */
export interface CustomStageDeps {
  settings: ISettingsRepository;
}

/* ------------------------------ 读取（脏值兜底） ------------------------------ */

/**
 * 任意值 → `CustomStageDef[]`（**绝不抛错**）。
 *
 * 这是验收 11 的落点：手工把 KV 改成 `{"a":1}`（或任何非数组 / 半损坏结构）后，
 * 本函数一律返回合法数组（非数组 → `[]`；数组里的坏条目被丢弃），
 * 于是应用不崩、复用池为空，**且不影响任何其它 settings 键**（本函数只读这一个键）。
 */
export function normalizeCustomStageDefs(raw: unknown): CustomStageDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomStageDef[] = [];
  for (const entry of raw) {
    const def = normalizeCustomStageDef(entry);
    if (def) out.push(def);
  }
  return out;
}

/** 单条归一：缺 id / 缺名称的条目视为损坏，返回 null（丢弃而不是补造） */
function normalizeCustomStageDef(raw: unknown): CustomStageDef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (id === '' || name === '') return null;
  return {
    id,
    name,
    ratioPercent: normalizeRatio(o.ratioPercent),
    colorMain: normalizeColorMain(o.colorMain),
    createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : EPOCH_ISO,
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : EPOCH_ISO,
  };
}

/** 占比归一：非正数 / 非有限数 → null（不抛错） */
function normalizeRatio(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * 主色归一：**一律走 `src/core/color` 的那一个归一化器**（返回大写 `#RRGGBB`）。
 *
 * 为什么不自带一份正则：全仓若有两个归一化器，「同一颜色两种写法」迟早会漏进
 * 去重 / 比对 / 备份往返里（`tests/backup.roundtrip.spec.ts` 的夹具也是大写）。
 * 非法值 → `null`（不抛错，脏值兜底）。
 */
function normalizeColorMain(value: unknown): string | null {
  return normalizeHex(value);
}

/* ------------------------------ 构造新条目 ------------------------------ */

/** 新建一条自定义阶段定义（id / 时间戳在本函数内生成，调用方不碰 id 规则） */
export function createCustomStageDef(input: {
  name: string;
  ratioPercent?: number | null;
  colorMain?: string | null;
  /** 可注入的当前时间（测试用） */
  now?: Date;
}): CustomStageDef {
  const iso = (input.now ?? new Date()).toISOString();
  return {
    id: createId('cst'),
    name: input.name.trim(),
    ratioPercent: normalizeRatio(input.ratioPercent ?? null),
    colorMain: normalizeColorMain(input.colorMain ?? null),
    createdAt: iso,
    updatedAt: iso,
  };
}

/** 库条目 → 阶段池里可勾选的选中项（domain / colorIndex 由调用方按当前上下文给） */
export function customStageToSelectionItem(
  def: CustomStageDef,
  options: { domain: StageTemplateDomain; colorIndex: number },
): StageSelectionItem {
  return {
    key: `${CUSTOM_STAGE_KEY_PREFIX}${def.id}`,
    name: def.name,
    domain: options.domain,
    ratioPercent: def.ratioPercent ?? DEFAULT_CUSTOM_STAGE_RATIO,
    colorIndex: clampColorIndex(options.colorIndex),
    // 看板列仅供展示层参考：落库行的列由 `stage-resolve` 按 orderIndex / templateKey 决定
    // （`templateKey === null` 时按序号均分，不会崩 —— N4 已核）。
    kanbanColumn: getDomainColumns(options.domain)[0]?.key ?? 'design',
    defaultResponsibility: '',
    // 自定义阶段没有模板任务清单：建档时用户自己填（不伪造模板数据）
    defaultTasks: [],
    customColor: def.colorMain,
  };
}

/** 选中项 key 是否来自自定义阶段（区别于模板库 key） */
export function isCustomStageKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(CUSTOM_STAGE_KEY_PREFIX);
}

/** 色号夹取到内置色板范围（1..9） */
function clampColorIndex(index: number): number {
  if (!Number.isFinite(index)) return MIN_COLOR_INDEX;
  return Math.min(Math.max(Math.trunc(index), MIN_COLOR_INDEX), MAX_COLOR_INDEX);
}

/**
 * 新加阶段应默认使用**未被占用**的内置色号（PRD A10 ②）。
 * 9 个内置色全部用尽 → 返回 null，调用方据此提示「建议自定义一个颜色以便区分」。
 */
export function firstUnusedColorIndex(usedColorIndexes: readonly number[]): number | null {
  for (let i = MIN_COLOR_INDEX; i <= MAX_COLOR_INDEX; i += 1) {
    if (!usedColorIndexes.includes(i)) return i;
  }
  return null;
}

/* ------------------------------ 库读写（唯一出口） ------------------------------ */

/**
 * TS-07 开关的**唯一读取点**。
 * `persistOverride` 只给测试用（验收 8 要验证「一行回退」的行为，
 * 而 ES module 的 `const` 在运行时不可改；测试钩子不改变「生产开关是上面那一行」这一事实）。
 */
let persistOverride: boolean | null = null;

function persistAcrossProjects(): boolean {
  return persistOverride ?? CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS;
}

/** 仅测试用：临时覆写 TS-07 开关（传 null 恢复默认） */
export function __setPersistAcrossProjectsForTest(value: boolean | null): void {
  persistOverride = value;
}

/** 内部：读原始数组（**不受开关影响**，供写路径合并用） */
async function readStoredDefs(deps: CustomStageDeps): Promise<CustomStageDef[]> {
  try {
    const raw = await deps.settings.get<unknown>(CUSTOM_STAGES_SETTING_KEY);
    return normalizeCustomStageDefs(raw);
  } catch {
    // 存储不可用（隐私模式 / 老库异常）或值不是合法 JSON：一律当「没有自定义阶段」。
    // 复用库读不出来**不该拦住建档**，更不该把异常冒泡到 UI。
    return [];
  }
}

/**
 * 建档时展示的「可复用自定义阶段」。
 *
 * `CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS === false` ⇒ **恒返回 `[]`**
 * （这就是 TS-07 的一行回退：调用方无需任何改动，复用池自然为空）。
 */
export async function listReusableCustomStages(deps: CustomStageDeps): Promise<CustomStageDef[]> {
  if (!persistAcrossProjects()) return [];
  return readStoredDefs(deps);
}

/**
 * 记入复用库。
 *
 * 同名条目会被**替换**（而不是各留一条）：复用池里出现两条同名项会让用户在池子里
 * 看到两个同名可选项，而项目内的重名校验又要求阶段名唯一 —— 同一份「库」里先内耗了。
 * 覆盖语义同时天然实现「改了颜色再记一次」的期望行为。
 *
 * 开关为 false 时是**空操作**：自定义阶段只活在当前表单内存态（项目内联口径）。
 */
export async function rememberCustomStage(
  deps: CustomStageDeps,
  def: CustomStageDef,
): Promise<void> {
  if (!persistAcrossProjects()) return;
  const existing = await readStoredDefs(deps);
  const next = [
    ...existing.filter((d) => d.id !== def.id && d.name !== def.name),
    def,
  ];
  await deps.settings.set(CUSTOM_STAGES_SETTING_KEY, next);
}

/** 从复用库移除一条（开关为 false 时空操作） */
export async function forgetCustomStage(deps: CustomStageDeps, id: string): Promise<void> {
  if (!persistAcrossProjects()) return;
  const existing = await readStoredDefs(deps);
  const next = existing.filter((d) => d.id !== id);
  if (next.length === existing.length) return;
  await deps.settings.set(CUSTOM_STAGES_SETTING_KEY, next);
}
