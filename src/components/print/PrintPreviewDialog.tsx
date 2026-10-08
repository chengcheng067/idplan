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
 * 经典纸面（SchedulePaper）+ 同一份算法（useSchedulePaperData）两个宿主共用，
 * 不存在第二份 DOM 或第二份计算。
 *
 * ── 规范落地索引 ──
 *  D1 浮层=Modal fullscreen · D2 z-[75] · D3 纸面恒浅（.print-root 内）·
 *  D4 圆角 0 · D5 iframe 打印（src/lib/print-frame.ts）· D6 PNG 导出复用。
 *
 * ── v0.8.6 四版模板重建（产品决策文档 §2.1/§2.2）──
 *  「打印内容」钮升格为「模板与模块」一个 dropdown 三截：
 *    上截 阅读方式：五张模板单选卡（经典 + A/D/E/H，全部已实现）；
 *    中截 输出模块：经典 = 五块复选框（数据结构逐字不变，保护既有 spec）；
 *          四版 = 11 个内容模块复选框（原生可勾选默认全选、非原生禁用态
 *          + 原因；勾选态按模板各存一套，换模板不丢——期二「外表 × 模块
 *          分离」，产品决策文档 §3.2/§3.3）；
 *    下截 配色：三槽位受控 token（预设变体卡为主 + 自定义过对比度硬闸门），
 *          仅四版显示（经典是品牌资产，不开放）。
 *  工具条另加「灰度」toggle（纸面 wrapper 套 filter:grayscale(1)）——选色时
 *  实时自查灰度可读，同时服务 02 §9 的灰度快照验收（不必真打黑白）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Download, ListChecks, Palette, Printer, X } from 'lucide-react';

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
import {
  PRINT_MODULES,
  PRINT_TEMPLATES,
  enabledPagesOf,
  printTemplateMeta,
  printTemplateModuleIds,
  printTemplateModules,
  printTemplateName,
} from './print-skins';
import type { PrintModuleId } from './print-skins';
import { usePrintViewModel } from '../../print/adapters/use-print-view-model';
import { usePrintLogo } from '../../print/adapters/use-print-logo';
import { SwissScheduleDocument } from '../../print/documents/SwissScheduleDocument';
import { DataEditorialDocument } from '../../print/documents/DataEditorialDocument';
import { EditorialIndexDocument } from '../../print/documents/EditorialIndexDocument';
import { AgentPosterDocument } from '../../print/documents/AgentPosterDocument';
import { PaletteSection } from '../../print/parts/PaletteSection';
import { PRINT_TEMPLATE_PALETTES } from '../../print/model/print-palette';
import type { PrintPageKind, PrintTemplateId } from '../../print/model/print-view-model';

/** 纸面总自然高度（缩放 wrapper 的负边距修正用；规范 §2：总高 = 1123×N + 24×(N−1)） */
const A4_HEIGHT_PX = 1123;
const GAP_BETWEEN_PAGES = 24;

type Zoom = 'fit' | '100';

/** 打印内容勾选面板的行（键 ↔ SchedulePaperBlocks；hint 是该块的通俗解释）——经典模板专用 */
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
 * portal / 遮罩 / 焦点圈禁 / 滚动锁定，面板自身 fixed 定位。
 *
 * `panelHeight` 是**实测高**（ResizeObserver 跟着内容变——配色编辑器展开时
 * 面板会长高，不重算会把底部裁出视口）。
 */
function resolveSelectorPanelPos(
  anchor: HTMLElement,
  panelHeight: number,
): { top: number; left: number; minWidth: number } {
  const r = anchor.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const flipUp = below < panelHeight + 8 && r.top > below;
  return {
    top: flipUp ? Math.max(8, r.top - panelHeight - 4) : r.bottom + 4,
    left: r.left,
    minWidth: r.width,
  };
}

/**
 * 选择器中截 · 模块勾选（v1.5-a 期二：页勾选 → 模块勾选，产品决策文档 §3.3）。
 *
 * 11 个内容模块逐行：模块名 + 一句话内容说明 + 归属页提示。
 *   · **原生模块**（该外表能力表内）：可勾选、默认全选，右侧标注原生页名
 *     （H 的 Agent 执行 = 两页，标「Agent 执行宣告 + 执行状态全览」）；
 *   · **非原生模块**：禁用态 + 原因——通用渲染是期三分期补，这里先立
 *     「模块跨模板选」的产品形态，**不装能打**（禁用行不进纸面、不计页数）。
 * 勾选态按模板各存一套（store pages），换外表不丢失。
 *
 * 为什么提成独立导出组件：截图 spec 用 renderToStaticMarkup 直接渲染它
 * （同 PaletteSection 先例），不必拉起整个预览面板也能验收四套外表的
 * 模块勾选态；dialogue 本体只负责接线（store ↔ 组件）。
 */
export function PrintModuleSection({
  template,
  enabledModules,
  onToggle,
  onSelectAll,
  onSelectNone,
}: {
  template: PrintTemplateId;
  enabledModules: readonly PrintModuleId[];
  onToggle?: (module: PrintModuleId, on: boolean) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
}): JSX.Element {
  const caps = printTemplateModules(template);
  const on = new Set(enabledModules);
  return (
    <div data-print-module-section="">
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <span className="text-[11px] font-medium text-mist">输出模块</span>
        <span className="flex gap-1">
          <button
            type="button"
            data-print-modules-all=""
            onClick={onSelectAll}
            className="rounded-sm px-1.5 py-0.5 text-[11px] text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            全选
          </button>
          <button
            type="button"
            data-print-modules-none=""
            onClick={onSelectNone}
            className="rounded-sm px-1.5 py-0.5 text-[11px] text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            反选
          </button>
        </span>
      </div>
      <div className="flex flex-col gap-0.5 pb-1">
        {PRINT_MODULES.map((m) => {
          const cap = caps.find((c) => c.module === m.id);
          const native = cap !== undefined;
          const pageHint = cap ? cap.pages.map((p) => p.label).join(' + ') : '';
          return (
            <label
              key={m.id}
              data-print-module-row={m.id}
              data-native={native ? 'on' : 'off'}
              className={`flex select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] ${
                native ? 'cursor-pointer text-ink hover:bg-sand' : 'cursor-not-allowed text-mist'
              }`}
            >
              <input
                type="checkbox"
                checked={native && on.has(m.id)}
                disabled={!native}
                onChange={(e) => onToggle?.(m.id, e.target.checked)}
                data-print-module={m.id}
                className="h-3.5 w-3.5 shrink-0 accent-pine disabled:opacity-40"
              />
              <span className="min-w-0 flex-1">
                <span className="block whitespace-nowrap text-[13px] font-medium">{m.label}</span>
                <span className="block truncate text-[11px] text-mist">{m.hint}</span>
              </span>
              {/* 归属页提示（原生 = 原生页名；非原生 = 禁用原因；超长截断，完整值进 title） */}
              <span
                className="shrink-0 max-w-[120px] truncate text-[11px] text-mist"
                title={native ? pageHint : '该外表下暂不可用，将随通用渲染陆续支持'}
              >
                {native ? pageHint : '该外表下暂不可用'}
              </span>
            </label>
          );
        })}
      </div>
      <p className="px-2 pb-1.5 text-[11px] leading-relaxed text-mist">
        非原生模块将随通用渲染陆续支持；模块勾选按外表各存一套，换外表不丢失。
      </p>
    </div>
  );
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
  const template = usePrintPrefsStore((s) => s.template);
  /** 每模板一套「启用模块」勾选态（期二：pages 语义 = 模块，见 store 文件头） */
  const pages = usePrintPrefsStore((s) => s.pages);
  const palette = usePrintPrefsStore((s) => s.palette);
  const setBlock = usePrintPrefsStore((s) => s.setBlock);
  const setTemplate = usePrintPrefsStore((s) => s.setTemplate);
  const setModuleEnabled = usePrintPrefsStore((s) => s.setModuleEnabled);
  const setTemplateModules = usePrintPrefsStore((s) => s.setTemplateModules);

  const d = useSchedulePaperData(projectId, blocks);
  const printVm = usePrintViewModel(projectId);
  /** 全局打印 logo（settings KV；null = 未上传 ⇒ 四版统一「ID Plan」文字标） */
  const { logo } = usePrintLogo();
  const meta = printTemplateMeta(template);
  const paperRootRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [scale, setScale] = useState(1);
  const [printBusy, setPrintBusy] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  /** 灰度预览（纸面 wrapper 套 grayscale(1)；选色自查 + 灰度快照验收用，不真打黑白） */
  const [grayscale, setGrayscale] = useState(false);
  /**
   * 模板与模块下拉面板（v0.8.6.0002 · 反馈 #9.2；四版重建升格为三截选择器；
   * 期二「外表 × 模块分离」中截改模块勾选，产品决策文档 §3.3）：
   * 挂预览面板内 = 勾选即时重渲染纸面（所见即所得），这是挂在这里的理由。
   * 深链路由（`*-print` 三条）没有本面板 ⇒ SchedulePaper 默认五块全开（兜底）。
   */
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorPos, setSelectorPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const selectorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectorPanelRef = useRef<HTMLDivElement | null>(null);
  /** 面板实测高（ResizeObserver 喂给定位：配色编辑器展开 / 模板切换都会变高） */
  const [panelHeight, setPanelHeight] = useState(420);

  /** 弹开期间窗口尺寸变化 ⇒ 锚点失效，直接收起（重开照当时锚点重算，不给陈旧坐标留路） */
  useEffect(() => {
    if (!selectorOpen) return;
    const onResize = (): void => setSelectorOpen(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selectorOpen]);

  /** 面板实测高 → 重算定位（内容变高不 stale；只改 top/left 不会自激） */
  useEffect(() => {
    if (!selectorOpen) return;
    const el = selectorPanelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      setPanelHeight((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectorOpen]);

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

  /**
   * 该模板启用的纸面页（期二：模块勾选 ⇒ 原生页序派生）。
   * 缺键 = 默认全选原生模块 = 旧「页勾选」默认态**逐页等价**（回归红线：
   * 四套模板打印输出零变化）。非原生模块不在能力表 ⇒ 不进纸面、不计页数。
   */
  const enabledPages = useMemo<PrintPageKind[]>(
    () => enabledPagesOf(template, pages[template]),
    [template, pages],
  );

  /** 预计页数：经典 = 分页产物；四版 = 启用页数（勾选即时联动） */
  const pagesCount = template === 'classic' ? d.pages.length : enabledPages.length;
  /** 未实现模板不许假装能打（决策 ⑥ 实现顺序：D/E/H 后续批次落地） */
  const canOutput = meta.implemented;

  const onPrint = useCallback(() => {
    const root = paperRootRef.current;
    if (!root || printBusy || !canOutput) return;
    // 双击防护（规范 §5.1：150ms 内忽略重复点击）
    setPrintBusy(true);
    window.setTimeout(() => setPrintBusy(false), 150);
    const via = printPaper(root);
    if (via === 'main') {
      useProjectsStore.getState().pushToast('info', '已回退主窗口打印。');
    }
  }, [printBusy, canOutput]);

  /**
   * 导出 PNG（规范 §2 铁律：`.a4-page` 自身永不缩放，导出前若当前档 ≠ 100%
   * 先临时置回再截，capture 完成后恢复——React state 切换同帧完成，无视觉残留）。
   * 灰度同理：html2canvas 不认 filter，导出前临时关掉。
   */
  const onExportPng = useCallback(async () => {
    const els = pageRefs.current.filter((el): el is HTMLDivElement => el !== null);
    if (els.length === 0 || pngBusy || !d.project || !canOutput) return;
    setPngBusy(true);
    const wasFit = zoom === 'fit';
    const wasGray = grayscale;
    if (wasFit) setZoom('100');
    if (wasGray) setGrayscale(false);
    try {
      // 等一帧让 scale / filter 复原的样式生效（transform 在 wrapper 上，纸面自身不变）
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await exportSchedulePngPages(els, schedulePngFileName(d.project.name));
    } catch {
      useProjectsStore.getState().pushToast('error', 'PNG 导出失败，请改用「打印 / 另存为 PDF」。');
    } finally {
      if (wasFit) setZoom('fit');
      if (wasGray) setGrayscale(true);
      setPngBusy(false);
    }
  }, [pngBusy, zoom, grayscale, canOutput, d.project]);

  if (!open || !d.hydrated || !d.project) return null;

  const paperNaturalHeight =
    Math.max(pagesCount, 1) * A4_HEIGHT_PX + Math.max(Math.max(pagesCount, 1) - 1, 0) * GAP_BETWEEN_PAGES;
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
          {/* 模板与模块（反馈 #9.2/#9.3 升格；期二中截改模块勾选）：样式照缩放钮范式，点开是三截下拉 */}
          <button
            type="button"
            ref={selectorTriggerRef}
            aria-expanded={selectorOpen}
            aria-haspopup="true"
            aria-label="模板与模块"
            onClick={() => {
              const el = selectorTriggerRef.current;
              setSelectorPos(el ? resolveSelectorPanelPos(el, panelHeight) : null);
              setSelectorOpen((v) => !v);
            }}
            className={`inline-flex items-center gap-1 rounded-[6px] border border-line bg-cream px-2 py-0.5 text-xs font-medium transition-colors ${
              selectorOpen ? 'bg-paper text-ink shadow-soft' : 'text-mist hover:text-ink'
            }`}
          >
            <ListChecks size={14} aria-hidden />
            模板与模块
          </button>
          {/* 灰度预览（决策文档 §3.2-②）：纸面套 grayscale(1)，选色自查 + 灰度验收 */}
          <button
            type="button"
            data-print-grayscale-toggle=""
            aria-pressed={grayscale}
            aria-label="灰度预览"
            onClick={() => setGrayscale((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-[6px] border border-line bg-cream px-2 py-0.5 text-xs font-medium transition-colors ${
              grayscale ? 'bg-paper text-ink shadow-soft' : 'text-mist hover:text-ink'
            }`}
          >
            <Palette size={14} aria-hidden />
            灰度
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
            {/* 灰度只套纸面（chrome 不灰度）；ref 两本账：外层 wrapper（缩放）与 .print-root（打印克隆源） */}
            <div
              ref={paperRootRef}
              className="mx-auto w-fit"
              style={grayscale ? { filter: 'grayscale(1)' } : undefined}
              data-print-grayscale={grayscale ? 'on' : 'off'}
            >
              {template === 'classic' && (
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
                  skin="default"
                  logo={logo}
                />
              )}
              {template === 'swiss-schedule' && printVm.vm && (
                <SwissScheduleDocument
                  vm={printVm.vm}
                  pages={enabledPages}
                  palette={
                    palette['swiss-schedule'] ?? PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline
                  }
                  logo={logo}
                  pageRef={(idx) => (el: HTMLDivElement | null) => {
                    pageRefs.current[idx] = el;
                  }}
                />
              )}
              {template === 'data-editorial' && printVm.vm && (
                <DataEditorialDocument
                  vm={printVm.vm}
                  pages={enabledPages}
                  palette={
                    palette['data-editorial'] ?? PRINT_TEMPLATE_PALETTES['data-editorial'].baseline
                  }
                  logo={logo}
                  pageRef={(idx) => (el: HTMLDivElement | null) => {
                    pageRefs.current[idx] = el;
                  }}
                />
              )}
              {template === 'editorial-index' && printVm.vm && (
                <EditorialIndexDocument
                  vm={printVm.vm}
                  pages={enabledPages}
                  palette={
                    palette['editorial-index'] ?? PRINT_TEMPLATE_PALETTES['editorial-index'].baseline
                  }
                  logo={logo}
                  pageRef={(idx) => (el: HTMLDivElement | null) => {
                    pageRefs.current[idx] = el;
                  }}
                />
              )}
              {template === 'agent-poster' && printVm.vm && (
                <AgentPosterDocument
                  vm={printVm.vm}
                  pages={enabledPages}
                  palette={
                    palette['agent-poster'] ?? PRINT_TEMPLATE_PALETTES['agent-poster'].baseline
                  }
                  logo={logo}
                  pageRef={(idx) => (el: HTMLDivElement | null) => {
                    pageRefs.current[idx] = el;
                  }}
                />
              )}
              {/* 未实现模板：明确空态，不输出任何纸面（不许假装能打） */}
              {template !== 'classic' && !meta.implemented && (
                <div
                  data-print-template-building=""
                  className="my-10 w-[420px] rounded-md border border-line bg-paper p-6 text-center"
                >
                  <p className="text-sm font-medium text-ink">{printTemplateName(template)} · 页面建设中</p>
                  <p className="mt-2 text-xs leading-relaxed text-mist">
                    模板已注册（{meta.modules.length} 个原生模块；模块勾选与配色槽位已就绪），
                    页面将在后续批次实现。当前不会输出任何纸面，打印与导出已禁用。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 模板与模块下拉：Modal dropdown 档（z-[75] 无底色遮罩，盖得住
            fullscreen 预览但不压暗；portal / Esc / 焦点圈禁 / 滚动锁定白拿，
            面板自身按触发钮 fixed 定位——范式同 IndustrySelect） */}
        <Modal
          open={selectorOpen}
          onClose={() => setSelectorOpen(false)}
          placement="dropdown"
          ariaLabel="模板与模块"
        >
          <div
            role="group"
            aria-label="模板与模块"
            data-print-selector-panel=""
            ref={selectorPanelRef}
            tabIndex={-1}
            style={
              selectorPos
                ? { top: selectorPos.top, left: selectorPos.left, minWidth: selectorPos.minWidth }
                : { top: -9999, left: -9999 }
            }
            className="dropdown-pop-in fixed z-[1] w-[300px] rounded-md border border-line bg-paper p-1 shadow-overlay outline-none"
          >
            {/* 上截 · 阅读方式：模板单选卡（缩略图占位 + 版本名 + 一句话场景） */}
            <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-mist">阅读方式</p>
            <div role="radiogroup" aria-label="阅读方式" className="flex flex-col gap-0.5 pb-1.5">
              {PRINT_TEMPLATES.map((t) => {
                const current = t.id === template;
                const dots =
                  t.id === 'classic' ? null : PRINT_TEMPLATE_PALETTES[t.id].baseline;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={current}
                    data-print-template-option={t.id}
                    onClick={() => {
                      setTemplate(t.id);
                      // 换模板 ⇒ 旧模板收集的页面 ref 作废（PNG 导出按新模板重收）
                      pageRefs.current = [];
                    }}
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors ${
                      current ? 'bg-pine-soft' : 'hover:bg-sand'
                    }`}
                  >
                    {/* 缩略图占位：设计师 Ardot 导出图未到，先用「版本字母 + 基线三色点」
                        （不假装是设计稿；图到位后换 img 即可，data 属性不变） */}
                    <span
                      aria-hidden
                      className="flex h-9 w-12 shrink-0 flex-col items-center justify-center rounded-sm border border-line bg-cream"
                    >
                      <span className="text-[13px] font-bold leading-none text-ink">
                        {t.version || '经'}
                      </span>
                      {dots && (
                        <span className="mt-1 flex gap-0.5">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: dots.accent }} />
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: dots.ink }} />
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: dots.line }} />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">
                        {printTemplateName(t.id)}
                      </span>
                      <span className="block truncate text-[11px] text-mist">{t.scene}</span>
                    </span>
                    {!t.implemented && (
                      <span className="shrink-0 rounded-full bg-sunken px-1.5 py-0.5 text-[10px] text-mist">
                        建设中
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 中截 · 输出模块：经典=五块（数据结构逐字不变，保护既有 spec）；
                四版=11 个内容模块勾选（期二「外表 × 模块分离」，决策文档 §3.3） */}
            <div className="border-t border-line px-2 pb-1.5 pt-1">
              {meta.usesBlocks ? (
                <>
                  <div className="flex items-center justify-between pb-1 pt-1">
                    <span className="text-[11px] font-medium text-mist">打印内容（五块）</span>
                  </div>
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
                </>
              ) : (
                <PrintModuleSection
                  template={template}
                  enabledModules={pages[template] ?? printTemplateModuleIds(template)}
                  onToggle={(module, on) => setModuleEnabled(template, module, on)}
                  onSelectAll={() => setTemplateModules(template, printTemplateModuleIds(template))}
                  onSelectNone={() => setTemplateModules(template, [])}
                />
              )}
            </div>

            {/* 下截 · 配色：仅四版（经典是品牌资产不开放；未实现模板只提示） */}
            {template === 'classic' ? null : meta.implemented ? (
              <PaletteSection template={template} />
            ) : (
              <div className="border-t border-line px-3 pb-2 pt-2 text-[11px] leading-relaxed text-mist">
                配色：{printTemplateName(template)} 页面建设中，三槽位与预设已就绪，页面落地后生效。
              </div>
            )}
          </div>
        </Modal>

        {/* 动作条：36px 主操作族；PDF 出口=打印对话框另存（规范 §4.2，不设重复按钮） */}
        <div
          data-print-preview-actionbar=""
          className="no-print flex h-16 items-center gap-3 border-t border-line bg-paper px-4"
        >
          <span className="text-xs text-mist">
            {canOutput ? '需要 PDF？在打印对话框选「另存为 PDF」' : '该模板页面建设中，暂不可打印'}
          </span>
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
            disabled={pngBusy || !canOutput}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-paper px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={14} />
            {pngBusy ? '生成中…' : pagesCount > 1 ? `导出 PNG（${pagesCount} 张）` : '导出 PNG'}
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={printBusy || !canOutput}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-pine px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={16} /> 打印
          </button>
        </div>
      </div>
    </Modal>
  );
}
