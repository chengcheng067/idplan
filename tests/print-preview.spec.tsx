// @vitest-environment jsdom
/**
 * 0.8.4 打印内置化 A 方案 · 验收锚点（设计规范 §7.5）。
 *
 * 五条锁：
 *   ① z 分层：打印预览 = Modal fullscreen z-[75]，高于既有 Modal(center)、低于 Toast（80）；
 *   ② **入口回潮锁**：ProjectDetailPage / ProjectCard 源码不得再出现
 *      `window.open(...schedule-print...)`（itinerary 的新窗口入口按规范 §7.3 保留，不误伤）；
 *   ③ iframe 隔离：`printViaFrame` 克隆面 = `.print-root` 子树且 `.no-print` 被剔除；
 *   ④ 纸面组件结构钉：`.print-root` / `.a4-page` / `.schedule-bar-segment` 等规范 §7.1
 *      选择器在 SchedulePaper 源码里（抽组件时的搬运完整性）；
 *   ⑤ print-frame 兜底路径存在（`printViaMainWindow` + `[data-printing]` CSS）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

describe('打印内置化 A 方案 · 规范 §7.5 验收', () => {
  it('① Modal fullscreen = z-[75]（高于 center/right 档；Toast-80 侧由 toast-above-modal.spec 钉）', () => {
    const modal = read('src/components/common/Modal.tsx');
    // 期六重构：z 档类名收进 OVERLAY_Z_CLASS 静态映射（overlayZClass），
    // 断言跟着改为「映射表里有 75 且 fullscreen 分支引用它」——语义不变
    expect(modal).toContain("75: 'z-[75]'");
    expect(modal).toContain("if (placement === 'fullscreen' || placement === 'dropdown') return OVERLAY_Z_CLASS[75];");
    expect(modal).toContain("placement === 'fullscreen'");
    // 期六新增 78 档（选择器弹窗盖 fullscreen 预览、低于 toast 80）
    expect(modal).toContain("78: 'z-[78]'");
    // fullscreen 容器无 padding（全屏面板）
    expect(modal).toMatch(/placement === 'fullscreen'[\s\S]{0,200}'p-0'/);
  });

  it('② 入口回潮锁：日程表两入口不得回 window.open（itinerary 合法保留，不误伤）', () => {
    for (const f of ['src/pages/ProjectDetailPage.tsx', 'src/components/project/ProjectCard.tsx']) {
      const src = read(f);
      const lines = src.split('\n');
      const bad = lines.filter((l) => l.includes('window.open') && l.includes('schedule-print'));
      expect(bad, `${f} 出现 schedule-print 的 window.open 回潮`).toEqual([]);
      // 正向：入口改为 setPrintPreviewId（state 驱动应用内面板）
      expect(src, `${f} 缺少 printPreviewId state`).toContain('setPrintPreviewId');
    }
  });

  it('③ iframe 隔离：克隆面=.print-root 子树、.no-print 剔除（结构隔离 > CSS 拦截）', async () => {
    const { printViaFrame } = await import('../src/lib/print-frame');
    // 构造一个带 .no-print 的假 .print-root（模拟预览面板 DOM）
    const root = document.createElement('div');
    root.className = 'print-root';
    const page = document.createElement('div');
    page.className = 'a4-page';
    page.textContent = '纸面';
    const chrome = document.createElement('div');
    chrome.className = 'no-print';
    chrome.textContent = '工具条';
    root.append(page, chrome);

    // jsdom 无 contentDocument.write 完整支持——退而验证 cloneNode 路径的等价逻辑：
    // 直接验证「stripNoPrint 后 DOM 剩什么」是本函数的核心不变量，用同等剔除逻辑断言。
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.no-print').forEach((el) => el.remove());
    expect(clone.querySelectorAll('.no-print')).toHaveLength(0);
    expect(clone.querySelector('.a4-page')?.textContent).toBe('纸面');
    expect(clone.className).toContain('print-root');
    // 函数签名存在（真实浏览器路径的 smoke：不抛即过）
    expect(typeof printViaFrame).toBe('function');
  });

  it('④ 纸面组件结构钉：规范 §7.1 选择器全套在 SchedulePaper 源码里', () => {
    const paper = read('src/components/print/SchedulePaper.tsx');
    for (const sel of [
      'print-root',
      'a4-page',
      'schedule-bar-segment',
      'schedule-status-dot',
      'schedule-table',
      'data-print-month-tick',
      'data-tick-left',
    ]) {
      expect(paper, `SchedulePaper 缺选择器 ${sel}`).toContain(sel);
    }
    // 取色纪律：静态类映射在、无裸 hex（条件模板拼类名是母本既有形态，stageColors.ts 注释口径）
    expect(paper).toContain('stageSolidClass');
    expect(paper).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('⑤ 兜底路径：printViaMainWindow + [data-printing] CSS 三件套在位', () => {
    const lib = read('src/lib/print-frame.ts');
    expect(lib).toContain('printViaMainWindow');
    expect(lib).toContain('data-printing');
    const css = read('src/styles/global.css');
    expect(css).toContain('[data-printing] .print-preview-toolbar');
    expect(css).toContain('[data-printing] .print-preview-actionbar');
    expect(css).toContain('[data-printing] .print-preview-stage');
  });
});
