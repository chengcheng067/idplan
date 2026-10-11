// @vitest-environment jsdom
/**
 * 浮层栈（`src/core/overlay/overlayStack.ts`）· F3 + F6-A 的机制级回归。
 *
 * ══════════════════ 这里守的是什么 ══════════════════
 * 「**现在谁在最上层**」从前不是一个事实，而是每个组件各自猜的数：
 *   · 每个 open 的 Modal 各挂一个 document keydown，按 Esc 就关自己（不管自己在不在最上面）
 *     ⇒ 设置抽屉里开确认框、打印预览里开模板选择器，**一次 Esc 关两层**（F3）；
 *   · 侧栏的 `z-[61]` 是给**唯一**的消费者（设置抽屉）挑的常量，它不知道上面此刻压着谁
 *     ⇒ 60 档的右抽屉（阶段详情 / 任务详情）开着时侧栏仍浮在其上、还能点，
 *     点另一个项目就换页、抽屉内容错位成「该阶段不存在」（F6-A）。
 *
 * 本文件锁两件事，缺一不可：
 *   ① **判定规则**：栈顶 = tier 最大者（同档取后进者），不是 push 顺序；
 *   ② **接线**：Modal 真的在问栈顶、Sidebar 真的在问让位，而不是各自写死一个数。
 * 只锁 ① 会退化成"库写得很漂亮但没人用"，只锁 ② 会漏掉规则本身被改坏。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import {
  CHROME_OVERLAY_TIER,
  RAIL_Z_CLASS,
  isRailYielded,
  isTopOverlay,
  overlayStackSize,
  popOverlay,
  pushOverlay,
  topOverlayOf,
  type OverlayEntry,
} from '../src/core/overlay/overlayStack';
import { Modal } from '../src/components/common/Modal';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

/** 造一个栈条目的简写（只填本文件用得上的字段） */
function entry(id: number, tier: OverlayEntry['tier'], kind: OverlayEntry['kind'] = 'content', railExempt = false): OverlayEntry {
  return { id, tier, kind, railExempt };
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

describe('浮层栈 · 栈顶判定规则（纯函数）', () => {
  it('空栈没有栈顶', () => {
    expect(topOverlayOf([])).toBeNull();
  });

  it('栈顶 = tier 最大者，**不是**后进者', () => {
    /*
     * 这条不是理论洁癖，本仓真有反例：PrintPreviewDialog 的预览 Modal（75）
     * **包着**选择器 Modal（78），首次挂载时 React 的 effect 是子先父后 ⇒ 78 先 push、
     * 75 后 push。若按「后进即栈顶」，压在底下的预览会被判成顶层，Esc 又关错层。
     */
    const list = [entry(1, 78), entry(2, 75)];
    expect(topOverlayOf(list)?.id, '先入栈的 78 才是栈顶').toBe(1);
  });

  it('同档取后进者（LIFO within tier）', () => {
    const list = [entry(1, 60), entry(2, 60)];
    expect(topOverlayOf(list)?.id).toBe(2);
  });

  it('chrome 档（79）压过一切内容浮层', () => {
    const list = [entry(1, 78), entry(2, 79, 'chrome')];
    expect(topOverlayOf(list)?.id).toBe(2);
    expect(CHROME_OVERLAY_TIER).toBeLessThan(80); // toast 的 80 由 toast-above-modal.spec 钉
  });

  it('isTopOverlay 认 id 不认身份：非栈顶者为 false', () => {
    const low = pushOverlay({ tier: 60, kind: 'content', railExempt: false });
    const high = pushOverlay({ tier: 78, kind: 'content', railExempt: false });
    expect(isTopOverlay(low)).toBe(false);
    expect(isTopOverlay(high)).toBe(true);
    expect(isTopOverlay(99999), '整个栈上都找不到的 id 恒 false').toBe(false);
  });

  it('出栈后栈顶回落到下一个；重复 pop 同一 id 无害', () => {
    const low = pushOverlay({ tier: 60, kind: 'content', railExempt: false });
    const high = pushOverlay({ tier: 70, kind: 'content', railExempt: false });
    expect(overlayStackSize()).toBe(2);
    popOverlay(high);
    expect(isTopOverlay(low)).toBe(true);
    popOverlay(high); // 再 pop 一次
    expect(overlayStackSize(), '重复 pop 不该多摘一层').toBe(1);
  });
});

describe('浮层栈 · 侧栏让位判定（F6-A 的"顶层决定"）', () => {
  it('没有任何内容浮层 ⇒ 让位（保持既有 z，不做无谓扰动）', () => {
    expect(isRailYielded()).toBe(true);
  });

  it('顶层内容浮层**让出**侧栏带 ⇒ true（left-rail 设置抽屉 / 带 railLeft 的打印预览）', () => {
    pushOverlay({ tier: 60, kind: 'content', railExempt: true });
    expect(isRailYielded()).toBe(true);
  });

  it('顶层内容浮层**压满**（60 档右抽屉 / 居中弹窗）⇒ false（侧栏该被压暗、点击该被吞）', () => {
    pushOverlay({ tier: 60, kind: 'content', railExempt: false });
    expect(isRailYielded()).toBe(false);
  });

  it('让位与否看**栈顶那一个**：右抽屉压上来后，底下的设置抽屉不再是判据', () => {
    pushOverlay({ tier: 60, kind: 'content', railExempt: true }); // 设置抽屉（让位）
    expect(isRailYielded()).toBe(true);
    pushOverlay({ tier: 60, kind: 'content', railExempt: false }); // 右抽屉压上来
    expect(isRailYielded(), '压满的那个在顶上 ⇒ 侧栏必须让出层').toBe(false);
  });

  it('chrome 浮层不参与侧栏让位（它压不压侧栏是内容浮层的事）', () => {
    pushOverlay({ tier: 60, kind: 'content', railExempt: false }); // 压满的右抽屉
    pushOverlay({ tier: CHROME_OVERLAY_TIER, kind: 'chrome', railExempt: false }); // 身份菜单
    expect(isRailYielded(), '身份菜单开着不改变"侧栏被抽屉压住"这个事实').toBe(false);
  });

  it('RAIL_Z_CLASS 是静态映射：yielded 抬到 61、covered **不给 z**', () => {
    expect(RAIL_Z_CLASS.yielded).toBe('z-[61]');
    /*
     * covered 刻意不是「比 60 小的一档数值」：那等于宣称侧栏本来就该参与层叠竞争，
     * 而它实际只是被压住。空串 = 不带 z-index ⇒ 落回普通流被 fixed 遮罩盖住。
     * 这条断言同时防住"顺手把 covered 改成一个更小的数"。
     */
    expect(RAIL_Z_CLASS.covered, 'covered 必须是不带 z-index，而不是一个更小的档位').toBe('');
  });
});

describe('浮层栈 · Modal 接线（F3：Esc 只关栈顶）', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function dialog(label: string): Element | null {
    return document.querySelector(`[role="dialog"][aria-label="${label}"]`);
  }

  /**
   * 两层的挂载顺序刻意做成「**子先父后**」（内层是外层的 JSX 子节点）。
   *
   * 这同时覆盖两件事：
   *   ① 两个 Modal 都 open 时，一次 Esc 只关掉一层（F3 的核心症状）；
   *   ② 内层档位更高（78 > 75）但 push 更早 —— 若判定退化成「后进即栈顶」，
   *      第一次 Esc 会去关**外层**，本用例立刻红。
   * 两层的 placement 都取没有出口动画的档（fullscreen / dropdown 在 EXIT_CLASS
   * 里没有条目）⇒ 关闭即卸载，断言不必再替浏览器补播 animationend。
   */
  function Nested(): JSX.Element {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(true);
    return (
      <Modal open={outer} onClose={() => setOuter(false)} placement="fullscreen" ariaLabel="预览层">
        <div>
          <Modal
            open={inner}
            onClose={() => setInner(false)}
            placement="fullscreen"
            zTier={78}
            ariaLabel="选择器层"
          >
            <span>选择器</span>
          </Modal>
        </div>
      </Modal>
    );
  }

  it('一次 Esc 只关栈顶；下层存活；再按一次下层才关', () => {
    act(() => {
      root.render(<Nested />);
    });
    expect(dialog('预览层'), '下层应在场').not.toBeNull();
    expect(dialog('选择器层'), '上层应在场').not.toBeNull();

    pressEscape();
    expect(dialog('选择器层'), '第一次 Esc：关掉栈顶（选择器）').toBeNull();
    expect(
      dialog('预览层'),
      '★ 第一次 Esc 之后下层必须**仍存活** —— 修前这里会跟着一起关掉（F3）',
    ).not.toBeNull();

    pressEscape();
    expect(dialog('预览层'), '第二次 Esc：轮到下层').toBeNull();
  });

  it('下层先关时，栈顶仍在，Esc 只关剩下的那层', () => {
    const Outer = (): JSX.Element => {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(true);
      return (
        <>
          <button type="button" data-probe="open-outer" onClick={() => setOuter(true)}>
            开外层
          </button>
          <Modal open={outer} onClose={() => setOuter(false)} placement="fullscreen" ariaLabel="后开的层">
            <div />
          </Modal>
          <Modal open={inner} onClose={() => setInner(false)} placement="fullscreen" ariaLabel="先开的层">
            <div />
          </Modal>
        </>
      );
    };
    act(() => {
      root.render(<Outer />);
    });
    expect(dialog('先开的层')).not.toBeNull();

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-probe="open-outer"]')!.click();
    });
    expect(dialog('后开的层')).not.toBeNull();

    // 后开的（同档 75，后进）是栈顶 ⇒ 第一次 Esc 关它
    pressEscape();
    expect(dialog('后开的层')).toBeNull();
    expect(dialog('先开的层'), '先开的那层不该被连坐').not.toBeNull();

    pressEscape();
    expect(dialog('先开的层')).toBeNull();
  });

  it('Modal 关闭后从栈上摘掉（pop 与 push 严格配对）', () => {
    const Toggle = (): JSX.Element => {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" data-probe="close" onClick={() => setOpen(false)}>
            关
          </button>
          <Modal open={open} onClose={() => setOpen(false)} placement="fullscreen" ariaLabel="单层">
            <div />
          </Modal>
        </>
      );
    };
    act(() => {
      root.render(<Toggle />);
    });
    expect(overlayStackSize()).toBe(1);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-probe="close"]')!.click();
    });
    expect(overlayStackSize(), '关闭必须出栈，否则下一层永远不是栈顶').toBe(0);
  });
});

/* ====================================================================================
 * 静态锁：这三条防的是「库还在、接线被拆回各自写死」
 * ==================================================================================== */

describe('浮层栈 · 静态接线锁', () => {
  it('Modal.tsx：Esc 判定必须问栈顶，不许退回"谁 open 谁响应"', () => {
    const src = read('src/components/common/Modal.tsx');
    expect(src, 'Esc 分支必须由 isTopOverlay 判定').toContain('if (isTopOverlay(overlayId)) onCloseRef.current();');
    expect(src, 'open 时要上栈').toContain('const overlayId = pushOverlay({');
    expect(src, '关闭时要出栈（在 effect cleanup 里）').toContain('popOverlay(overlayId);');
  });

  it('Modal.tsx：79 档（顶栏 chrome 专用）走同一张静态映射表，不拼字符串', () => {
    const src = read('src/components/common/Modal.tsx');
    expect(src).toContain("60: 'z-[60]'");
    expect(src).toContain("70: 'z-[70]'");
    expect(src).toContain("75: 'z-[75]'");
    expect(src).toContain("78: 'z-[78]'");
    expect(src, 'F2：新增 79 一档给顶栏 chrome 的浮层').toContain("79: 'z-[79]'");
    expect(src, 'chrome 档类名必须是查表结果，不是手写').toContain(
      'export const CHROME_OVERLAY_Z_CLASS: string = OVERLAY_Z_CLASS[CHROME_OVERLAY_TIER];',
    );
    // 静态映射纪律（同 print-templates）：不许拿档位数字拼类名
    expect(src, '禁止模板字符串拼 z 档类名').not.toContain('z-[' + '${');
  });

  it('placement→档位是一张**唯一**的表（类名面由它查得，不可能漂移）', () => {
    const src = read('src/components/common/Modal.tsx');
    expect(src, '档位表在').toContain('const PLACEMENT_TIER: Record<ModalPlacement, 60 | 70 | 75> = {');
    expect(src, '类名面必须由档位表导出').toContain('return OVERLAY_Z_CLASS[overlayTier(placement, zTier)];');
    // 旧写法（在类名函数里另写一遍 placement→75）已退役：那是第二份真相
    expect(src).not.toContain("if (placement === 'fullscreen' || placement === 'dropdown') return OVERLAY_Z_CLASS[75];");
  });

  it('Sidebar.tsx：侧栏层态必须问浮层栈，不许在本地再写一个 z 常量', () => {
    const src = read('src/components/layout/Sidebar.tsx');
    expect(src).toContain('const railYielded = useRailYielded();');
    expect(src).toContain("RAIL_Z_CLASS[railYielded ? 'yielded' : 'covered'],");
    // 反面：本地写死的 z-[61] 会让 60 档右抽屉再次穿不过去（F6-A 原样复发）
    expect(src, '侧栏不许再自持 z-[61] 常量').not.toContain("'z-[61]");
  });

  it('AppShell.tsx：路由变化必须复位阶段抽屉状态（F6-B）', () => {
    const src = read('src/components/layout/AppShell.tsx');
    expect(src).toContain('useUiStore.getState().closeStageDrawer();');
  });

  it('StageDrawer.tsx：找不到阶段时合上抽屉，不再渲染占位提示', () => {
    const src = read('src/components/stage-detail/StageDrawer.tsx');
    expect(src).toContain('if (stageId && !stage) close();');
    /*
     * 比「源码里没有这串文案」再准一步：**剥掉注释**再判。
     * 原因同 toast-above-modal.spec.ts 里 shellLines 的注释 —— 本仓已被"行扫描认字样"
     * 呛过三次。这里刚改完的代码旁边就有一句解释"修前渲染的是哪句话"的注释，
     * 按裸源码判会当场假红，逼后来的人删掉解释（那才是真损失）。
     * 剥注释后判的是**还渲染不渲染**，正是这条要守的东西。
     */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '占位文案应从渲染路径上退役').not.toContain('该阶段不存在或已被移除');
  });
});
