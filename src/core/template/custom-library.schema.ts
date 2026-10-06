/**
 * 自定义行业库（v0.8.6 · 她反馈 #9「行业允许增加自定义」的落地第一刀）。
 *
 * ── 形态决策（务实收敛，日志级说清为什么不做得更大）──
 * 她原话「行业允许增加自定义」。最完整的形态是让用户定义**新 domain**（主板块），
 * 但 `StageTemplateDomain` 是**编译期 enum**，且 `Project.domain` 是落库值——扩
 * enum = 动全站消费方 + 数据迁移。v0.8.6 取最小可用闭环：
 *
 *   自定义行业包 = **挂靠现有 domain 的自定义阶段项 + 自定义套餐集合**。
 *   用户导入 JSON → 建档时在所选行业下多出他自己的阶段/套餐。
 *   domain 枚举扩展 + Agent 侧 presetKey 叠加解析：记账 0.8.7（见文末）。
 *
 * ── 安全姿态（安全官 STRIDE 结论的全落地，C.4 清单逐条）──
 *   ① version 字面量（不认识→明确拒绝，不静默当最新）；
 *   ② items ≤200、name ≤50、key 强制 `usr.` 前缀且**拒绝与内置 key 同名**；
 *   ③ ratioPercent 有限数 0<r≤100；
 *   ④ colorIndex 整数 1..9；customColor 只认 normalizeHex（禁任意 style 串注入）；
 *   ⑤ kanbanColumn 走**白名单枚举**（columns token 名，杜绝任意字符串）；
 *   ⑥ defaultTasks ≤20 条、每条 ≤50 字（只读展示）；
 *   ⑦ presets[].itemKeys **引用完整性硬校验**——悬空 key 整包拒绝并指出是哪个
 *     preset 哪个 key（对「getPresetItems 静默跳过」的修复，见安全官 C-4）；
 *   ⑧ 整包 ≤256KB；解析失败给用户可读中文，**不落半包**；
 *   ⑨ 归一化只发生在读侧（normalizeCustomLibrary 绝不抛错哲学，与既有
 *     custom-stage.service 同家风）；**校验只在导入侧**——两处分工，别合并。
 */

import { z } from 'zod';

import { normalizeHex } from '../color/contrast';

/** 自定义行业包的 schema 标识（与备份 schema 同风格的「认不出就拒」） */
export const CUSTOM_LIBRARY_SCHEMA = 'idplan-custom-library/v1' as const;

/** 阶段项 key 前缀（与内置 key（域名.阶段）和自定义阶段 cst. 三级区分） */
export const CUSTOM_LIBRARY_KEY_PREFIX = 'usr.';

/** 整包字节上限（安全官 C.4-9：256KB） */
export const CUSTOM_LIBRARY_MAX_BYTES = 256 * 1024;

/**
 * 看板列白名单（安全官 C.4-5：枚举即白名单，杜绝任意字符串）。
 * = 内置库 items[].kanbanColumn 的全部取值（templates/stage-library.json v3，
 * 24 列；想要新列 = 改内置库走评审，不走用户输入）。
 *
 * 导出：prompt 生成器（custom-library.prompt.ts）要把这 24 个值原样写进给
 * Agent 的字段表——白名单只有这一份出处，prompt 不允许手抄第二份。
 */
export const KANBAN_COLUMN_ENUM = z.enum([
  'booking', 'build', 'creative', 'deepen', 'delivery', 'design', 'designing',
  'developing', 'kickoff', 'live', 'ongoing', 'planning', 'post', 'prep',
  'preprod', 'promo', 'rehearsal', 'released', 'research', 'review', 'settle',
  'shoot', 'testing',
] as const);

/**
 * 看板列键清单（prompt 字段表与 UI 展示用；与 KANBAN_COLUMN_ENUM 同源）。
 *
 * ⚠️ 数量**不写死**在注释里（2026-10-06 修：原注释写「24 个」而枚举实际 23 个，
 * 同期 stage-library.json 的**中文列名**去重后是 30 个 ——「列键」是英文规范键、
 * 「列名」是各领域的中文展示名，两者本就不是一一对应，如 designing/deepen/build
 * 覆盖「设计中/深化中/施工中」三个中文名）。**以 KANBAN_COLUMN_ENUM.options
 * 为唯一事实源**，这里只做同源转发。
 */
export const KANBAN_COLUMN_VALUES = KANBAN_COLUMN_ENUM.options;

/** ratioPercent：有限数、开区间 (0,100] */
const ratioSchema = z
  .number()
  .finite()
  .gt(0)
  .lte(100);

/** 自定义颜色：只认十六进制（normalizeHex 读侧再归一；这里禁任意字符串） */
const hexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'customColor 必须是 #RRGGBB 十六进制');

const customItemSchema = z.object({
  /** key 强制 usr. 前缀（安全官 C.4-2）：与内置/单条自定义阶段三级区分 */
  key: z
    .string()
    .min(4)
    .max(64)
    .regex(new RegExp(`^${CUSTOM_LIBRARY_KEY_PREFIX.replace('.', '\\.')}[a-z0-9][a-z0-9-]*$`),
      `阶段 key 必须以 ${CUSTOM_LIBRARY_KEY_PREFIX} 开头（小写字母/数字/连字符）`),
  name: z.string().min(1).max(50),
  ratioPercent: ratioSchema,
  /** 整数 1..9（内置 9 色；读侧再 clampColorIndex） */
  colorIndex: z.number().int().min(1).max(9),
  kanbanColumn: KANBAN_COLUMN_ENUM,
  defaultResponsibility: z.string().max(50).default(''),
  defaultTasks: z.array(z.string().min(1).max(50)).max(20).default([]),
  /** 可选自定义主色（读侧 normalizeHex） */
  customColor: hexSchema.optional(),
});

const customPresetSchema = z.object({
  /** 套餐 key：同样 usr. 前缀（建板/建档的 presetKey 即它） */
  key: z
    .string()
    .min(4)
    .max(64)
    .regex(new RegExp(`^${CUSTOM_LIBRARY_KEY_PREFIX.replace('.', '\\.')}[a-z0-9][a-z0-9-]*$`),
      `套餐 key 必须以 ${CUSTOM_LIBRARY_KEY_PREFIX} 开头`),
  name: z.string().min(1).max(50),
  description: z.string().max(200).default(''),
  /** 引用本包 items 的 key（顺序即默认 orderIndex） */
  itemKeys: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * 自定义行业包 schema（校验只在导入侧跑——读侧归一见 custom-library.service.ts）。
 * `domain` 用**现有** StageTemplateDomain（编译期 enum，落库值零迁移——
 * 形态决策见文件头）。
 */
export const customLibrarySchema = z.object({
  schema: z.literal(CUSTOM_LIBRARY_SCHEMA),
  /** 包名（用户给自己的行业库起的名，如「我的茶空间流程」） */
  name: z.string().min(1).max(50),
  /** 挂靠的现有主板块（新 domain 扩展 = 0.8.7 记账项） */
  domain: z.enum([
    'indoor',
    'landscape',
    'architecture',
    'exhibition',
    'software',
    'marketing',
    'film',
    'wedding',
    'consulting',
    'travel',
  ] as const),
  items: z.array(customItemSchema).min(1).max(200),
  presets: z.array(customPresetSchema).min(1).max(20),
});

export type CustomLibraryFile = z.infer<typeof customLibrarySchema>;

/** 拒绝原因（用户可读中文；逐条给，不只报第一条） */
export interface CustomLibraryIssue {
  path: string;
  message: string;
}

export type CustomLibraryParseResult =
  | { ok: true; library: CustomLibraryFile }
  | { ok: false; issues: CustomLibraryIssue[] };

/**
 * 校验入口（导入侧唯一校验处；读侧归一在 service）。
 *
 * @param raw 任意 JSON.parse 产物
 * @param rawBytes 原始字节数（超 256KB 直接拒——C.4-9）
 */
export function validateCustomLibrary(raw: unknown, rawBytes?: number): CustomLibraryParseResult {
  if (typeof rawBytes === 'number' && rawBytes > CUSTOM_LIBRARY_MAX_BYTES) {
    return {
      ok: false,
      issues: [
        {
          path: '(root)',
          message: `行业包超过 ${Math.floor(CUSTOM_LIBRARY_MAX_BYTES / 1024)}KB 上限（当前 ${Math.ceil(rawBytes / 1024)}KB）`,
        },
      ],
    };
  }
  const parsed = customLibrarySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    };
  }
  const lib = parsed.data;

  // ⑦ 引用完整性硬校验（安全官 C.4-7）：preset.itemKeys 必须命中本包 items——
  //    悬空整包拒绝并指明 preset/key（对「getPresetItems 静默跳过」的修复）。
  const itemKeys = new Set(lib.items.map((it) => it.key));
  const issues: CustomLibraryIssue[] = [];
  for (const p of lib.presets) {
    for (const k of p.itemKeys) {
      if (!itemKeys.has(k)) {
        issues.push({
          path: `presets.${p.key}`,
          message: `套餐「${p.name}」引用了不存在的阶段 key：${k}`,
        });
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  // ②-2 key 唯一性（包内 item key 不得重复——Set 已经过去重，长度对比即判据）
  if (itemKeys.size !== lib.items.length) {
    return { ok: false, issues: [{ path: 'items', message: '阶段 key 在包内重复' }] };
  }
  // preset key 同理
  const presetKeys = new Set(lib.presets.map((p) => p.key));
  if (presetKeys.size !== lib.presets.length) {
    return { ok: false, issues: [{ path: 'presets', message: '套餐 key 在包内重复' }] };
  }

  return { ok: true, library: lib };
}

/** 供 service 读侧归一用的颜色工具再导出（单一出处：color/contrast） */
export { normalizeHex };
