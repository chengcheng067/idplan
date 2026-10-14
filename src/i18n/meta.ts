/**
 * `src/i18n/meta.ts` —— `index.html` 的 `<meta name="description">` 的**运行时同步**（笔 4-c）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么不直接把 index.html 里那句静态中文改成英文
 * ══════════════════════════════════════════════════════════════════════
 * ① 静态改英文 ⇒ **中文用户反而丢失中文**（description 是给搜索引擎 / 分享预览用的，
 *    它没有「运行时切语言」的机会）；
 * ② `tests/i18n.spec.tsx` 有一条**行业中立化锁**（`expect(html).toContain('跨行业项目排程工具')`）
 *    —— 改静态串会当场红；那条锁守的是「description 不许退化成某个行业的说法」，不该被本笔推翻。
 * ⇒ 故：**静态中文一字不动**，本模块在启动时按当前语言把它改成对应取值（zh 态 = 写回同一个串 ⇒ 零变化）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 为什么不能把这段塞进 `src/i18n/lang.ts`
 * ══════════════════════════════════════════════════════════════════════
 * `translate.ts` 是 `import { getLang } from './lang'`（单向）。
 * 若 `lang.ts` 反过来 import `translate.ts`（或 import 本模块，而本模块 import translate）
 * ⇒ **成环**。本仓为这个循环专门写过一次代价说明（见 `src/i18n/translate.ts` 文件头）。
 * ⇒ 本模块独立成一文件，只被 `src/i18n/index.ts` 转出、由 `src/main.tsx` 在启动时调一次。
 *
 * ⚠️ **不许**为它加依赖、不许加 Vite 插件（team-lead 明确）。
 * ⚠️ 描述的**取值**里刻意保留了 `index.html` 那句「同一句写了两遍」的原样（`…阶段时间轴：把合同…时间轴。`）
 *    —— 那是**内容缺陷**、不是 i18n 问题；改它会动 zh 取值（要走「有意的 zh 变更」三条件，
 *    单独一笔 + 提交信息写明）。本笔**只做语言同步**，已把该缺陷报给 team-lead。
 */
import { subscribeLang } from './lang';
import { t } from './translate';

/** description 的 meta 选择器（唯一出处；改这里就改了全模块的行为） */
const META_SELECTOR = 'meta[name="description"]';

/**
 * 按当前语言把 `<meta name="description">` 的内容写成消息表那句。
 *
 * - 中文态 ⇒ 写回与 `index.html` 静态串**同一句** ⇒ 渲染零变化（zh 逐字不变是硬线）；
 * - 找不到该 meta（被剥离 / 非浏览器环境）⇒ **静默不动**（与 `readStoredLang` 同款降级口径：
 *   启动期辅助动作绝不该拦住首屏）。
 */
export function applyMetaDescription(): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(META_SELECTOR);
  if (el === null) return;
  el.setAttribute('content', t('meta.description'));
}

/**
 * 启动接线：写一次 + 订阅语言变化（切语言后 description 跟着换，不必等刷新）。
 *
 * 为什么订阅也放在这里而不是各调用方自己接：调用方是 `src/main.tsx` 的启动序列，
 * 那里只该有「一行一次」的装配调用 —— 订阅是**这条同步关系的一部分**，不是第二个装配点。
 * 返回值刻意不暴露（启动期装配不需要退订；真要退订，本模块就该改成显式 hook）。
 */
export function initMetaDescription(): void {
  applyMetaDescription();
  subscribeLang(() => applyMetaDescription());
}
