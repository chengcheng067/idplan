/**
 * 全局打印 logo 标记（产品决策文档 §3.3 的四版共用件）。
 *
 * ── 机制三句话 ──
 *   ① 存储：settings KV `key='printLogo'`，base64 dataURL 进 valueJson
 *      （KV 表整体进备份，换设备能恢复；≤200KB 上限在保存侧强制）；
 *   ② 处理：上传时前端转灰度 + 阈值二值化 ⇒ 单色（黑）透明底 PNG，
 *      黑白打印可辨（01 §2 硬约束），与配色机制同一套灰度理念；
 *   ③ 空态：未上传 ⇒ 四版统一显示「ID Plan」文字标（与现有页脚署名
 *      SchedulePaper.tsx:333 同措辞），不留空、不占位灰块。
 *
 * ── 为什么组件只出结构、颜色交给各版 CSS ──
 * logo 要落在四版完全不同的版式语境里（A 的黑顶栏 / D 的硬边头部 /
 *   E 的发丝线下方 / H 的巨字旁），高度、字重、间距、暗底反白各自不同。
 *   本组件只渲染语义结构（img 或文字标 + data 属性），视觉规则全部住在
 *   各版 CSS 的 `.print-root.print-template-*` 前缀下（02 §5 纪律）。
 *
 * ── 暗底反白（A 版黑顶栏）──
 * `tone="on-dark"` 时组件只打 data-tone 属性；A 版 CSS 对 img 挂
 * `filter: invert(1)`（黑透明底 → 白透明底，alpha 不受影响），文字标走
 * 栏内反白字色。**不在组件里写死任何颜色**。
 */

export interface PrintLogoMarkProps {
  /** 全局 logo（base64 dataURL；null = 未上传 ⇒ 文字标） */
  logo: string | null;
  /** 落地高度 px（四版各自的尺寸纪律由调用方给） */
  height: number;
  /** 暗底语境（A 版黑顶栏）：CSS 反白处理 */
  tone?: 'ink' | 'on-dark';
}

/** 未上传时的统一文字标（产品决策文档 §3.3：与页脚署名同措辞的品牌名） */
export const PRINT_LOGO_FALLBACK_TEXT = 'ID Plan';

export function PrintLogoMark({ logo, height, tone = 'ink' }: PrintLogoMarkProps): JSX.Element {
  if (logo) {
    return (
      <img
        className="print-logo"
        data-print-logo="img"
        data-tone={tone}
        src={logo}
        alt="项目标识"
        style={{ height }}
        draggable={false}
      />
    );
  }
  return (
    <span
      className="print-logo print-logo--text"
      data-print-logo="text"
      data-tone={tone}
      style={{ fontSize: Math.max(11, Math.round(height * 0.62)) }}
    >
      {PRINT_LOGO_FALLBACK_TEXT}
    </span>
  );
}
