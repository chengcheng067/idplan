// @vitest-environment node
/**
 * v0.8.5 C3 · 布局容器过渡纪律（源码锁）。
 *
 * 钉的判据（排障手 debug 报告 Bug 1，她截图反馈「窗口放大缩小 UI 挤在一起」）：
 * 布局容器（随断点变宽的卡片）的过渡不得把 width 纳入——transition-all 会把
 * width/height/margin 全部过渡，缩放时容器尺寸滞后于窗口（实测 83 帧 53 帧异常）。
 * 修复=显式列属性 transition-[transform,box-shadow]。
 *
 * 形态判据（剥注释后扫）：
 *   ① 卡片本体（flex-[1_1_340px] 变宽容器）的 hover 过渡串必须显式列属性；
 *   ② 该串不得是 transition-all；
 *   ③ 全文件不得再出现 transition-all 与 duration-300 的组合（卡片本体专用时长）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('v0.8.5 C3 · 布局容器过渡纪律', () => {
  it('★ ProjectCard 本体不再 transition-all（源码锁，防回潮）', () => {
    // 剥注释后再扫——教训×3（Modal z 数字/useBackupIo 旧文件名/本 spec 自己的
    // 修因注释）：源码级断言行扫描不剥注释 = 迟早抓到注释里的字样假红。
    const raw = readFileSync(resolve(__dirname, '..', 'src/components/project/ProjectCard.tsx'), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toContain('flex-[1_1_340px]');
    expect(src).toContain('transition-[transform,box-shadow]');
    expect(src).not.toContain('transition-all duration-300');
  });
});
