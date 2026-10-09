/**
 * 通用模块 · 页内框架（模块头 + 口径注；三模块共用）。
 *
 * 模块头是 L1 分组（密度研究规则 1/2）：分组的呼吸预算在这层，各版 CSS
 * 给它各自的语法——A 的 2px 墨色下划线、D 的硬边下划线、E 的 2px 粗章节
 * 上线（目录语言）、H 的 2px 粗上线（海报块语言）。口径注是 L3 附属
 * （9.5-10px + 灰度一档，压到主体底部；每页可独立解释，01 §2）。
 *
 * 为什么头/注提成共用组件而不是每个模块各写一遍：三模块的页内骨架
 * 完全同构（头 + 表 + 注），差异只在表格列与行内容；骨架同构部分只
 * 实现一份，避免三处漂移（同 EmptyPrintState 的收敛理由）。
 */

import type { JSX } from 'react';

/** 模块头：左模块名（跨页续页带「（续）」）+ 右计数行（等宽数字） */
export function GenericModuleHead({ label, count }: { label: string; count: string }): JSX.Element {
  return (
    <div className="gm-head">
      <span className="gm-head__label">{label}</span>
      <span className="gm-head__count gm-num">{count}</span>
    </div>
  );
}

/** 口径注（L3：压到主体底部；各版 CSS 给灰度一档 + 发丝上线） */
export function GenericModuleNote({ children }: { children: string }): JSX.Element {
  return <p className="gm-note">{children}</p>;
}
