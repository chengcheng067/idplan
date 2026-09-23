/**
 * Toast 层级高于所有模态层（2026-09-24 实测投诉的回归钉）。
 *
 * 投诉原话：「点击『生成接入信息』弹出错误信息，但这个错误气泡的层级不对，
 * 被置灰在最下层了」——根因：Toast 容器是 z-50，而 Modal 的居中遮罩是 z-[70]，
 * 弹窗内的操作反馈全被压在置灰层底下，用户看得见背景变暗、看不见提示。
 *
 * 为什么用源码断言而不是 DOM：Toast 宿主是 AppShell 的一段 JSX，渲染它需要
 * Router + 全部 store + 一批 mock（重）；而本断言要守的是**声明式层级常量**
 * （z-index 数值），读源码取数值比较比挂载整棵树更直接、更稳。
 * 取两边源码里的 z 值做**数值比较**（而非断言某个具体数）：将来 Modal 分层
 * 若整体上移（比如 center 改 z-[90]），toast 不同步跟进的话这里会红——
 * 正是「静默漂移」要的摩擦。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** 从源码里抓出所有 z-index 数值（z-50 与 z-[70] 两种写法都认） */
function zValues(source: string): number[] {
  const out: number[] = [];
  for (const m of source.matchAll(/z-\[(\d+)\]/g)) out.push(Number(m[1]));
  for (const m of source.matchAll(/(?<![\w-])z-(\d+)(?![\w-])/g)) out.push(Number(m[1]));
  return out;
}

describe('Toast 层级：必须高于任何模态层（弹窗反馈不被压在置灰层下）', () => {
  it('★ toast 容器 z 值 > Modal 全部层级的最大值', () => {
    const modalSrc = readFileSync(resolve(ROOT, 'src/components/common/Modal.tsx'), 'utf8');
    const shellSrc = readFileSync(resolve(ROOT, 'src/components/layout/AppShell.tsx'), 'utf8');

    const modalZs = zValues(modalSrc);
    expect(modalZs.length, 'Modal.tsx 里应该摸得到 z-index 分层').toBeGreaterThan(0);

    // toast 容器 = AppShell 里含 toasts.map 的那个 fixed 容器
    const toastLine = shellSrc
      .split('\n')
      .find((l) => l.includes('toasts.map'));
    expect(toastLine, 'AppShell 里没找到 toast 渲染处（结构被改了？）').toBeTruthy();

    // 取 toast 容器声明行（往上找最近的固定定位 div）里的 z 值
    const lines = shellSrc.split('\n');
    const idx = lines.findIndex((l) => l.includes('toasts.map'));
    let toastZ: number | null = null;
    for (let i = idx; i >= 0 && i > idx - 12; i -= 1) {
      const m = /z-\[(\d+)\]/.exec(lines[i]) ?? /(?<![\w-])z-(\d+)(?![\w-])/.exec(lines[i]);
      if (m) {
        toastZ = Number(m[1]);
        break;
      }
    }
    expect(toastZ, 'toast 容器上没找到 z-index（fixed 浮层必须有显式层级）').not.toBeNull();

    const maxModal = Math.max(...modalZs);
    expect(
      toastZ as number,
      `toast z=${toastZ} 不高于 Modal 最高层 z=${maxModal} ⇒ 弹窗内反馈会被压在置灰层下`,
    ).toBeGreaterThan(maxModal);
  });

  it('toast 容器是 fixed 全视口浮层（不随内容流滚动）', () => {
    const shellSrc = readFileSync(resolve(ROOT, 'src/components/layout/AppShell.tsx'), 'utf8');
    const idx = shellSrc.split('\n').findIndex((l) => l.includes('toasts.map'));
    const containerLine = shellSrc
      .split('\n')
      .slice(Math.max(0, idx - 12), idx)
      .reverse()
      .find((l) => l.includes('fixed'));
    expect(containerLine, 'toast 容器应是 fixed 定位').toBeTruthy();
    expect(containerLine).toContain('pointer-events-none'); // 容器不挡点击，按钮自身 auto
  });
});
