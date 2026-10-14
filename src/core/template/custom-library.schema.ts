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

/* ---------- 失败消息：载荷中文模板（唯一出处）+ 界面机器码（裁 4） ---------- */

/**
 * 载荷侧中文模板（**唯一出处**）。每一条都对应英文态界面必须能跟语言走的那句 ——
 * team-lead 裁定（分界表 §零 · 裁 4）：`issue.message` **既是界面 `<li>` 正文也是载荷正文**
 * ⇒ 只翻 `custom-library.prompt.ts` 是假绿。
 *
 * ⚠️ 本表是**载荷取值**：复制给 Agent 的修正单必须恒为中文（指令契约，不随语言变）。
 *    界面侧**不读这张表**，它按 `code` 去 `src/i18n/labels.ts` 的 `CUSTOM_LIBRARY_ISSUE_KEYS`
 *    取词（`src/core/**` 不许 import i18n —— 见 `custom-library.prompt.ts` 的
 *    `CustomLibraryErrorHint` 注释）。
 *    「两边不漂」= 可执行断言：同一个 issue，界面 zh 串与本表渲染出的 `message`
 *    **逐字相等**（`tests/custom-library-path-i18n.spec.ts`，一条 spec 同时读两份）。
 *
 * 形态纪律：**随数据变的写成函数**（形参就是插值取值），不随数据变的写成字符串 ——
 * 后者是常量，写成 `() => '…'` 只会让「它没有参数」这件事变模糊。
 */
const ISSUE_TEXT = {
  /** 整包字节超限（参数：上限 KB / 当前 KB） */
  tooLarge: (maxKb: number, sizeKb: number) => `行业包超过 ${maxKb}KB 上限（当前 ${sizeKb}KB）`,
  /** customColor 不是 #RRGGBB（无参数） */
  customColorHex: 'customColor 必须是 #RRGGBB 十六进制',
  /** 阶段 key 前缀不对（参数：前缀 —— 是 schema 常量，属数据不属文案） */
  itemKeyPrefix: (prefix: string) => `阶段 key 必须以 ${prefix} 开头（小写字母/数字/连字符）`,
  /** 套餐 key 前缀不对（参数：前缀） */
  presetKeyPrefix: (prefix: string) => `套餐 key 必须以 ${prefix} 开头`,
  /** 套餐引用了本包没有的阶段 key（参数：套餐名 / 悬空 key） */
  danglingItemKey: (name: string, key: string) => `套餐「${name}」引用了不存在的阶段 key：${key}`,
  /** 包内阶段 key 重复（无参数） */
  duplicateItemKey: '阶段 key 在包内重复',
  /** 包内套餐 key 重复（无参数） */
  duplicatePresetKey: '套餐 key 在包内重复',
} as const;

/** ratioPercent：有限数、开区间 (0,100] */
const ratioSchema = z
  .number()
  .finite()
  .gt(0)
  .lte(100);

/** 自定义颜色：只认十六进制（normalizeHex 读侧再归一；这里禁任意字符串） */
const hexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, ISSUE_TEXT.customColorHex);

const customItemSchema = z.object({
  /** key 强制 usr. 前缀（安全官 C.4-2）：与内置/单条自定义阶段三级区分 */
  key: z
    .string()
    .min(4)
    .max(64)
    .regex(new RegExp(`^${CUSTOM_LIBRARY_KEY_PREFIX.replace('.', '\\.')}[a-z0-9][a-z0-9-]*$`),
      ISSUE_TEXT.itemKeyPrefix(CUSTOM_LIBRARY_KEY_PREFIX)),
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
      ISSUE_TEXT.presetKeyPrefix(CUSTOM_LIBRARY_KEY_PREFIX)),
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

/**
 * 失败消息的**机器码**（分界表 §零 · 裁 4）：界面按码取词，载荷仍用中文原文。
 *
 * ★ **列举完备性（K12）**：本文件里凡产出中文 `message` 的地方都必须有码 ——
 *   漏一个 ⇒ 英文态那一行仍是中文（只修一半 = 假绿，与本裁的立意相反）。
 *   判据在 `tests/custom-library-path-i18n.spec.ts`「七码逐一可复现」：每个码都用
 *   一个**真的坏包**跑出 `validateCustomLibrary` 的失败 issue 来，不是手抄清单。
 */
export type CustomLibraryIssueCode =
  | 'tooLarge'
  | 'customColorHex'
  | 'itemKeyPrefix'
  | 'presetKeyPrefix'
  | 'danglingItemKey'
  | 'duplicateItemKey'
  | 'duplicatePresetKey';

/**
 * zod 只回传 message **字符串** ⇒ 想在失败体上带码，只能拿「固定参数下的 message 原文」反查。
 * 本表三个码恰好都**不随运行时数据变**（前缀是 schema 常量、十六进制提示无参数）
 * ⇒ 反查是恒等的，不是模糊匹配。
 * ⚠️ 将来若给某个 zod message 加了运行期插值，**它就不能走本表**（那会变成猜）——
 *    要把它挪到「我们自己构造 issue」的那几处，显式带码带参数。
 */
const ZOD_MESSAGE_CODES: ReadonlyMap<
  string,
  { code: CustomLibraryIssueCode; params?: Record<string, string | number> }
> = new Map([
  [ISSUE_TEXT.customColorHex, { code: 'customColorHex' }],
  [
    ISSUE_TEXT.itemKeyPrefix(CUSTOM_LIBRARY_KEY_PREFIX),
    { code: 'itemKeyPrefix', params: { prefix: CUSTOM_LIBRARY_KEY_PREFIX } },
  ],
  [
    ISSUE_TEXT.presetKeyPrefix(CUSTOM_LIBRARY_KEY_PREFIX),
    { code: 'presetKeyPrefix', params: { prefix: CUSTOM_LIBRARY_KEY_PREFIX } },
  ],
]);

/** zod 的 message 反查码（查不到 = 无码 ⇒ 界面原样透传 message，与改造前一致） */
function codedIssue(message: string): {
  code?: CustomLibraryIssueCode;
  params?: Record<string, string | number>;
} {
  const hit = ZOD_MESSAGE_CODES.get(message);
  return hit === undefined ? {} : { code: hit.code, ...(hit.params ? { params: hit.params } : {}) };
}

/**
 * 拒绝原因（用户可读中文；逐条给，不只报第一条）。
 *
 * ⚠️ `message` 是**载荷正文**（复制给 Agent 的修正单原样用它）：恒中文，不许按语言变。
 *    `code` / `params` 只是**界面侧**的取词输入（英文态靠它们出英文）。
 *    无码 = zod 默认消息（本来就是英文，如 `Required` / `Expected array, …`）
 *    ⇒ 界面透传 `message`（与改造前一致，不新增任何兜底语言）。
 */
export interface CustomLibraryIssue {
  path: string;
  message: string;
  /** 界面侧取词用的码（键 `customLibrary.issue.<code>`）；缺省 = 无码 */
  code?: CustomLibraryIssueCode;
  /** 界面侧插值参数（取值与 `message` 里已内联的那些**同源**） */
  params?: Record<string, string | number>;
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
    const maxKb = Math.floor(CUSTOM_LIBRARY_MAX_BYTES / 1024);
    const sizeKb = Math.ceil(rawBytes / 1024);
    return {
      ok: false,
      issues: [
        {
          path: '(root)',
          message: ISSUE_TEXT.tooLarge(maxKb, sizeKb),
          code: 'tooLarge',
          params: { max: maxKb, size: sizeKb },
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
        ...codedIssue(i.message),
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
          message: ISSUE_TEXT.danglingItemKey(p.name, k),
          code: 'danglingItemKey',
          params: { name: p.name, key: k },
        });
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  // ②-2 key 唯一性（包内 item key 不得重复——Set 已经过去重，长度对比即判据）
  if (itemKeys.size !== lib.items.length) {
    return {
      ok: false,
      issues: [{ path: 'items', message: ISSUE_TEXT.duplicateItemKey, code: 'duplicateItemKey' }],
    };
  }
  // preset key 同理
  const presetKeys = new Set(lib.presets.map((p) => p.key));
  if (presetKeys.size !== lib.presets.length) {
    return {
      ok: false,
      issues: [
        { path: 'presets', message: ISSUE_TEXT.duplicatePresetKey, code: 'duplicatePresetKey' },
      ],
    };
  }

  return { ok: true, library: lib };
}

/** 供 service 读侧归一用的颜色工具再导出（单一出处：color/contrast） */
export { normalizeHex };
