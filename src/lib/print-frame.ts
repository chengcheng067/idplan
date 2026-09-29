/**
 * 打印件 DOM 隔离（0.8.4 · A 方案 §5：隐藏 iframe + contentWindow.print）。
 *
 * ── 为什么不用 window.print() 直调 ──
 * 直调打的是**主文档**：应用 chrome（工具条 / 侧栏 / 弹窗）要么靠 `@media print`
 * 的 `display:none` 逐个躲（漏一个就是打印事故），要么整页重排。A 方案改成
 * **结构隔离**：把 `.print-root` 纸面子树**深拷贝**进一个独立 iframe 文档，
 * chrome 物理上不在克隆范围内——比 CSS 拦截彻底一个量级。
 *
 * ── 样式策略（规范 §5.2 五条） ──
 * iframe 是独立浏览上下文（CSS 不互泄）；主文档全部样式表以**整包拷贝**单向
 * 进入（Vite prod 单包 CSS + dev 的注入 style）；克隆面 = `.print-root` 子树；
 * iframe `<html>` 不写 data-theme ⇒ `:root` 亮色令牌生效（第一道锁），克隆面
 * 自带 `.print-root`（第二道锁）；`.no-print` 元素克隆前剔除。
 */

/** 惰性单例 iframe（首次打印时创建、之后复用；不挂 React 树） */
let frame: HTMLIFrameElement | null = null;

function ensureFrame(): HTMLIFrameElement {
  if (frame && document.body.contains(frame)) return frame;
  const el = document.createElement('iframe');
  el.setAttribute('data-print-frame', '');
  el.title = '打印';
  el.setAttribute('aria-hidden', 'true');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  el.style.top = '0';
  el.style.width = '0';
  el.style.height = '0';
  el.style.border = '0';
  el.style.visibility = 'hidden';
  document.body.appendChild(el);
  frame = el;
  return el;
}

/** 剔除 `.no-print` 子树（与 html2canvas 的 ignoreElements 同口径） */
function stripNoPrint(root: HTMLElement): void {
  root.querySelectorAll('.no-print').forEach((el) => el.remove());
}

/** 拷贝主文档全部样式表（link[rel=stylesheet] 的 href + 内联 <style> 的 textContent） */
function copyStyles(doc: Document): void {
  for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const l = doc.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    doc.head.appendChild(l);
  }
  for (const style of Array.from(document.querySelectorAll('style'))) {
    const st = doc.createElement('style');
    st.textContent = style.textContent ?? '';
    doc.head.appendChild(st);
  }
}

/**
 * 打印 `.print-root` 容器的纸面子树。
 *
 * @param paperRoot 预览面板（或独立页）里的 `.print-root` 元素；找不到时抛错（调用方兜底）
 * @returns 是否成功走了 iframe 路径（false = 抛异常了，调用方应回退主窗口打印）
 */
export function printViaFrame(paperRoot: HTMLElement): boolean {
  try {
    const el = ensureFrame();
    const doc = el.contentDocument;
    if (!doc) return false;
    doc.open();
    // ★ 不写 data-theme ⇒ :root 亮色令牌生效；@page 规则随样式表一并进入 iframe
    doc.write('<!doctype html><html><head><meta charset="utf-8" /></head><body></body></html>');
    doc.close();
    copyStyles(doc);

    const clone = paperRoot.cloneNode(true) as HTMLElement;
    stripNoPrint(clone);
    doc.body.appendChild(clone);

    el.contentWindow?.focus();
    el.contentWindow?.print();
    return true;
  } catch {
    return false;
  }
}

/** 兜底：主窗口打印（极端环境 iframe 失败时）。调用方负责 afterprint 清理 */
export function printViaMainWindow(): void {
  document.documentElement.setAttribute('data-printing', '');
  const cleanup = (): void => {
    document.documentElement.removeAttribute('data-printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

/**
 * 统一入口：优先 iframe 隔离路径，失败回退主窗口。
 * 返回实际走的路径（供 spec 断言 / 埋点）。
 */
export function printPaper(paperRoot: HTMLElement): 'frame' | 'main' {
  return printViaFrame(paperRoot) ? 'frame' : 'main';
}
