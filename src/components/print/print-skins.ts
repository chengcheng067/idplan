/**
 * 打印皮肤注册表（v0.8.6.0002 · 反馈 #9.3「预留皮肤功能」）。
 *
 * ── 为什么是「注册表 + 静态类映射」而不是拼类名 ──
 * 与 `stageColors.ts` 同纪律：皮肤 id → CSS 类名走**编译期固定的映射对象**，
 * 不许拿 id 去拼类名——拼出来的串不进 Tailwind 的 JIT 内容扫描，将来某个
 * 皮肤「有注册表条目但样式没生成」，表现是该皮肤静默退回默认外观，
 * 而不是构建期报错。
 *
 * ── v1 为什么只有 default 一档、且不写任何 CSS 规则 ──
 * 「预留」的正确形态是**结构先到位、视觉零变动**：
 *   · `PrintSkinId` 是字面量联合，将来加第二套皮肤只改本文件一处
 *     （`| 'compact'` + 注册表一条 + global.css 该类的规则），调用方零改动；
 *   · default 皮肤 = 现有纸面视觉本身，故本版**不新增任何 CSS 规则**，
 *     `.print-skin-default` 只是为了让「当前是哪套皮肤」在 DOM 上可观测
 *     （真机验收 / 测试断言用），不是样式钩子；
 *   · v1 **不渲染皮肤选择器**：只有一个选项的单选组没有信息量，
 *     摆在那儿反而像「功能坏了」。等第二套皮肤落地时随选择器一起放出来。
 */

/** 皮肤 id（字面量联合；新增皮肤 = 在这里加一个成员 + 注册表加一条） */
export type PrintSkinId = 'default';

export interface PrintSkin {
  id: PrintSkinId;
  /** 选择器用文案（v1 不渲染选择器，字段先就位） */
  label: string;
}

/** 皮肤注册表（v1：仅「经典」= 现有视觉） */
export const PRINT_SKINS: ReadonlyArray<PrintSkin> = [{ id: 'default', label: '经典' }];

/**
 * 皮肤 id → CSS 类名（**静态映射，禁止改成模板字符串拼接**，理由见文件头）。
 * 未知 id（含旧持久值脏数据）回落 default——纸面永远有类、永远可打印。
 */
const PRINT_SKIN_CLASS: Record<PrintSkinId, string> = {
  default: 'print-skin-default',
};

export function printSkinClass(id: PrintSkinId): string {
  return PRINT_SKIN_CLASS[id] ?? PRINT_SKIN_CLASS.default;
}
