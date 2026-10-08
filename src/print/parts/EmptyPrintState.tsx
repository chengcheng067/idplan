/**
 * 打印空态（02 文档 §8 的四条标准文案 + A 版同族补充，四套模板共用）。
 *
 * 「空数据必须显示明确空态，不能用示例数据填充正式输出」（01 §8）——
 * 文案收敛在本文件，四套 documents/ 引用同一份，避免各版各写一遍漂移。
 *
 * 前四条是 02 §8 的标准文案（逐字）；后三条是 A 版阶段/任务/成员空态的同族
 * 补充（同一措辞风格，D/E/H 复用）。
 */

/** 标准空态文案（前四条 = 02 §8 照抄） */
export const PRINT_EMPTY_TEXTS = {
  /** 无 StageLog（A P3） */
  stageLog: '当前可见范围内无阶段延期记录',
  /** 无依赖（D P2） */
  dependencies: '当前任务未建立依赖关系',
  /** 无产出物（E P3） */
  artifacts: '当前可见任务暂无产出物',
  /** 无 Agent 数据（H 全版） */
  agent: '当前项目暂无 Agent 执行数据',
  /** 无可见阶段（A P1） */
  stages: '当前可见范围内无阶段',
  /** 无可见任务（A P2） */
  tasks: '当前可见范围内无任务',
  /** 无相关成员（A P4） */
  members: '当前可见范围内无相关成员',
} as const;

export type PrintEmptyKind = keyof typeof PRINT_EMPTY_TEXTS;

/**
 * 纸面内的空态行。住在 `.print-root` 下 ⇒ 必须带模板类前缀的样式才生效，
 * 本组件只出语义结构（data 属性 + 文案），视觉由各套 CSS 决定。
 */
export function EmptyPrintState({
  kind,
  text,
}: {
  kind: PrintEmptyKind;
  /** 覆盖文案（默认取 PRINT_EMPTY_TEXTS[kind]） */
  text?: string;
}): JSX.Element {
  return (
    <p data-print-empty={kind} className="print-empty-state">
      {text ?? PRINT_EMPTY_TEXTS[kind]}
    </p>
  );
}
