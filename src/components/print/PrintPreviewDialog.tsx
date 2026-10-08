/**
 * 应用内打印预览面板（0.8.4 · A 方案主件；设计规范 deliverables/research/v0.8.4-打印内置化A方案-视觉规范.md）。
 *
 * ── 它替代什么 ──
 * 旧交互：顶栏「打印日程表」→ `window.open('/project/:id/schedule-print')` 新窗口 +
 * 浏览器原生打印——雯丞 09-14 反馈「像外挂的浏览器窗口」。A 方案 = 应用内全屏
 * 预览面板（自绘工具条/动作条），打印走 print-frame iframe 结构隔离。
 *
 * ── 与独立路由的关系 ──
 * 路由 `/project/:id/schedule-print` **保留**（深链/直接输 URL 兜底）；
 * 同一棵纸面（SchedulePaper）+ 同一份算法（useSchedulePaperData）两个宿主共用，
 * 不存在第二份 DOM 或第二份计算。
 *
 * ── 规范落地索引 ──
 * D1 浮层=Modal fullscreen · D2 z-[75] · D3 纸面恒浅（.print-root 内）·
 * D4 圆角 0 · D5 iframe 打印（src/lib/print-frame.ts）· D6 PNG 导出复用。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Download, ListChecks, Printer, X } from 'lucide-react';

import { Modal } from '../common/Modal';
import { SchedulePaper } from './SchedulePaper';
import { useSchedulePaperData } from './useSchedulePaperData';
import { printPaper } from '../../lib/print-frame';
import { exportSchedulePngPages, schedulePngFileName, type SchedulePaperBlocks } from '../../lib/schedule-print';
import { useProjectsStore } from '../../store/useProjectsStore';
import { usePrintPrefsStore } from '../../store/usePrintPrefsStore';
import { titleBarHeight } from '../../lib/topbarMetrics';
import { isDesktop } from '../../lib/desktopBridge';
import { A4_WIDTH_PX } from '../../lib/schedule-print';

/** 纸面总自然高度（缩放 wrapper 的负边距修正用；规范 §2：总高 = 1123×N + 24×(N−1)） */
const A4_HEIGHT_PX = 1123;
const GAP_BETWEEN_PAGES = 24;

type Zoom = 'fit' | '100';

/** 打印内容勾选面板的行（键 ↔ SchedulePaperBlocks；hint 是该块的通俗解释） */
const BLOCK_ROWS: ReadonlyArray<{ key: keyof SchedulePaperBlocks; label: string; hint: string }> = [
  { key: 'header', label: '打印头部', hint: '项目名 / 周期' },
  { key: 'timeline', label: '打印时间轴', hint: '甘特图' },
  { key: 'projectInfo', label: '项目信息', hint: '排期基准' },
  { key: 'stageTable', label: '阶段清单', hint: '表格' },
  { key: 'footer', label: '页脚', hint: '署名 / 页码' },
];

/**
 * 勾选面板定位（锚定触发钮；下方空间不够则向上翻）——范式同
 * `IndustrySelect.resolvePanelPos`（0.8.5 A 规范 §A.4）：Modal 只出
 * portal / 遮罩 / 焦点圈禁，面板自身 fixed 定位。
 */
function resolveBlocksPanelPos(anchor: HTMLElement): { top: number; left: number; minWidth: number } {
  const r = anchor.getBoundingClientRect();
  const panelHeight = BLOCK_ROWS.length * 30 + 34;
  const below = window.innerHeight - r.bottom;
  const flipUp = below < panelHeight + 8 && r.top > below;
  return {
    top: flipUp ? Math.max(8, r.top - panelHeight - 4) : r.bottom + 4,
    left: r.left,
    minWidth: r.width,
  };
}

export function PrintPreviewDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  /** 打印偏好（个人偏好，localStorage 持久化；无角色门控——成员也打印） */
  const blocks = usePrintPrefsStore((s) => s.blocks);
  const skin = usePrintPrefsStore((s) => s.skin);
  const setBlock = usePrintPrefsStore((s) => s.setBlock);

  const d = useSchedulePaperData(projectId, blocks);
  const paperRootRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [scale, setScale] = useState(1);
  const [printBusy, setPrintBusy] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  /**
   * 打印内容勾选面板（v0.8.6.0002 · 反馈 #9.2）：
   * 挂预览面板内 = 勾选即时重渲染纸面（所见即所得），这是挂在这里的理由。
   * 深链路由（`*-print` 三条）没有本面板 ⇒ SchedulePaper 默认五块全开（兜底）。
   */
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [blocksPos, setBlocksPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const blocksTriggerRef = useRef<HTMLButtonElement | null>(null);

  /** 弹开期间窗口尺寸变化 ⇒ 锚点失效，直接收起（重开照当时锚点重算，不给陈旧坐标留路） */
  useEffect(() => {
    if (!blocksOpen) return;
    const onResize = (): void => setBlocksOpen(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [blocksOpen]);
  /**
   * 预览区元素（v0.8.6.0002 · 反馈 #9.1 修复）。
   *
   * 为什么从 useRef 改成 state：fit 缩放 effect 此前只依赖 `[zoom]`，而本面板是
   * 「常驻挂载、open 才渲染内容」——Modal 在 open=false 时 return null，stage
   * 元素**每次打开才挂载**。首开时 deps 未变 ⇒ effect 不跑 ⇒ scale 停在初始 1、
   * ResizeObserver 也没挂：「适应」是按下的却没生效，「100%」因 scale 本就是 1
   * 点了肉眼无变化——她看到的就是「第一次打开两个按钮都失效」。
   * 元素进 state 后，每次打开（挂载）/ 关闭（卸载）都会换依赖 ⇒ effect 必跑。
   */
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);

  /** fit 档：随预览区宽度重算（ResizeObserver；规范 §2 公式 clamp((w−32)/794, 0.25, 1)） */
  useEffect(() => {
    if (zoom !== 'fit') {
      setScale(1);
      return;
    }
    if (!stageEl) return;
    const calc = (): void => {
      const s = Math.min(Math.max((stageEl.clientWidth - 32) / A4_WIDTH_PX, 0.25), 1);
      setScale(s);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [zoom, stageEl]);

  const onPrint = useCallback(() => {
    const root = paperRootRef.current;
    if (!root || printBusy) return;
    // 双击防护（规范 §5.1：150ms 内忽略重复点击）
    setPrintBusy(true);
    window.setTimeout(() => setPrintBusy(false), 150);
    const via = printPaper(root);
    if (via === 'main') {
      useProjectsStore.getState().pushToast('info', '已回退主窗口打印。');
    }
  }, [printBusy]);

  /**
   * 导出 PNG（规范 §2 铁律：`.a4-page` 自身永不缩放，导出前若当前档 ≠ 100%
   * 先临时置回再截，capture 完成后恢复——React state 切换同帧完成，无视觉残留）。
   */
  const onExportPng = useCallback(async () => {
    const els = pageRefs.current.filter((el): el is HTMLDivElement => el !== null);
    if (els.length === 0 || pngBusy || !d.project) return;
    setPngBusy(true);
    const wasFit = zoom === 'fit';
    if (wasFit) setZoom('100');
    try {
      // 等一帧让 scale 复原的样式生效（transform 在 wrapper 上，纸面自身不变）
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await exportSchedulePngPages(els, schedulePngFileName(d.project.name));
    } catch {
      useProjectsStore.getState().pushToast('error', 'PNG 导出失败，请改用「打印 / 另存为 PDF」。');
    } finally {
      if (wasFit) setZoom('fit');
      setPngBusy(false);
    }
  }, [pngBusy, zoom, d.project]);

  if (!open || !d.hydrated || !d.project) return null;

  const pagesCount = d.pages.length;
  const paperNaturalHeight = pagesCount * A4_HEIGHT_PX + Math.max(pagesCount - 1, 0) * GAP_BETWEEN_PAGES;
  const zoomBtn = (z: Zoom, label: string): JSX.Element => (
    <button
      type="button"
      aria-pressed={zoom === z}
      onClick={() => setZoom(z)}
      className={`rounded-[6px] px-2 py-0.5 text-xs font-medium transition-colors ${
        zoom === z ? 'bg-paper text-ink shadow-soft' : 'text-mist hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} placement="fullscreen" ariaLabel="打印预览">
      <div data-print-preview="" className="print-preview flex h-full w-full flex-col bg-paper">
        {/* 工具条：win32 桌面端避让系统三键（与 SettingsDialog 同款 titleBarHeight） */}
        <div
          data-print-preview-toolbar=""
          className="no-print flex items-center gap-3 border-b border-line bg-paper px-4"
          style={{ paddingTop: isDesktop() ? titleBarHeight() : 0, height: isDesktop() ? 56 + titleBarHeight() : 56 }}
        >
          <Printer size={16} className="text-pine" aria-hidden />
          <h2 className="font-display text-base font-semibold text-ink">打印预览</h2>
          <span className="text-xs text-mist">
            {d.project.name} · 预计 {pagesCount} 页 · A4
          </span>
          <span className="ml-auto" />
          {/* 打印内容勾选（反馈 #9.2）：样式照缩放钮范式，点开是五块勾选面板 */}
          <button
            type="button"
            ref={blocksTriggerRef}
            aria-expanded={blocksOpen}
            aria-haspopup="true"
            aria-label="打印内容"
            onClick={() => {
              const el = blocksTriggerRef.current;
              setBlocksPos(el ? resolveBlocksPanelPos(el) : null);
              setBlocksOpen((v) => !v);
            }}
            className={`inline-flex items-center gap-1 rounded-[6px] border border-line bg-cream px-2 py-0.5 text-xs font-medium transition-colors ${
              blocksOpen ? 'bg-paper text-ink shadow-soft' : 'text-mist hover:text-ink'
            }`}
          >
            <ListChecks size={14} aria-hidden />
            打印内容
          </button>
          {/* 缩放二态（规范 §2：fit / 100%，不做滑块） */}
          <div className="flex rounded-[8px] border border-line bg-cream p-0.5" role="group" aria-label="预览缩放">
            {zoomBtn('fit', '适应')}
            {zoomBtn('100', '100%')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭打印预览"
            className="rounded-[8px] p-1.5 text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* 预览区：chrome 跟随主题；纸面栈包在 .print-root 内锁亮色（D3） */}
        <div
          data-print-preview-stage=""
          ref={setStageEl}
          className="flex-1 overflow-auto bg-cream px-4 py-8"
        >
          <div
            style={
              zoom === 'fit'
                ? {
                    transform: `scale(${scale})`,
                    transformOrigin: 'top center',
                    width: A4_WIDTH_PX,
                    marginBottom: -(1 - scale) * paperNaturalHeight,
                    transition: 'transform 150ms',
                  }
                : { transition: 'transform 150ms' }
            }
            className="mx-auto"
          >
            {/* ref 两本账：外层 wrapper（缩放）与 .print-root（打印克隆源） */}
            <div ref={paperRootRef} className="mx-auto w-fit">
              <SchedulePaper
                project={d.project}
                pages={d.pages}
                sections={d.sections}
                bandGeom={d.bandGeom}
                monthTicks={d.monthTicks}
                nowText={d.nowText}
                startAt={d.startAt}
                endAt={d.endAt}
                totalDays={d.totalDays}
                role={d.role}
                pageRef={(idx) => (el: HTMLDivElement | null) => {
                  pageRefs.current[idx] = el;
                }}
                blocks={blocks}
                skin={skin}
              />
            </div>
          </div>
        </div>

        {/* 打印内容勾选面板：Modal dropdown 档（z-[75] 无底色遮罩，盖得住
            fullscreen 预览但不压暗；portal / Esc / 焦点圈禁 / 滚动锁定白拿，
            面板自身按触发钮 fixed 定位——范式同 IndustrySelect） */}
        <Modal
          open={blocksOpen}
          onClose={() => setBlocksOpen(false)}
          placement="dropdown"
          ariaLabel="打印内容选项"
        >
          <div
            role="group"
            aria-label="打印内容选项"
            data-print-blocks-panel=""
            tabIndex={-1}
            style={
              blocksPos
                ? { top: blocksPos.top, left: blocksPos.left, minWidth: blocksPos.minWidth }
                : { top: -9999, left: -9999 }
            }
            className="dropdown-pop-in fixed z-[1] w-[236px] rounded-md border border-line bg-paper p-1 shadow-overlay outline-none"
          >
            <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-mist">勾选要打印的内容，纸面即时更新</p>
            {BLOCK_ROWS.map((row) => (
              <label
                key={row.key}
                className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-ink hover:bg-sand"
              >
                <input
                  type="checkbox"
                  checked={blocks[row.key]}
                  onChange={(e) => setBlock(row.key, e.target.checked)}
                  data-print-block={row.key}
                  className="h-3.5 w-3.5 shrink-0 accent-pine"
                />
                <span className="flex-1 whitespace-nowrap">{row.label}</span>
                <span className="shrink-0 text-[11px] text-mist">{row.hint}</span>
              </label>
            ))}
          </div>
        </Modal>

        {/* 动作条：36px 主操作族；PDF 出口=打印对话框另存（规范 §4.2，不设重复按钮） */}
        <div
          data-print-preview-actionbar=""
          className="no-print flex h-16 items-center gap-3 border-t border-line bg-paper px-4"
        >
          <span className="text-xs text-mist">需要 PDF？在打印对话框选「另存为 PDF」</span>
          <span className="ml-auto" />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onExportPng()}
            disabled={pngBusy}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-paper px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={14} />
            {pngBusy ? '生成中…' : pagesCount > 1 ? `导出 PNG（${pagesCount} 张）` : '导出 PNG'}
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={printBusy}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-pine px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={16} /> 打印
          </button>
        </div>
      </div>
    </Modal>
  );
}
