/**
 * 日程表打印视图的数据组装（v0.3 变更 E，纯函数可测）。
 * 只读聚合：阶段分组任务表 + 时间轴摘要所需的最小数据形状。
 * 打开者身份（v0.7-D 更新）：**管理员与成员均可打开**（页内守卫仅挡 `role === null`），
 * 故本模块不得假设调用方是管理员 —— 但页面当前**只渲染阶段级信息**
 * （序号 / 阶段 / 起止 / 状态），`tasks[].assigneeNames` 仅组装、未上屏，无姓名外泄面。
 */

import type { Member, Project, Stage, Task } from '../core/types/entities';
import { taskIsDone } from '../core/types/entities';
import type { StageStatus } from '../core/types/enums';
import { taskAssigneeIds } from '../hooks/useRoleGuard';

/**
 * 导出 PNG / A4 预览的「打印友好」配色（v0.5 主题修复）：
 *   导出给客户 / 委托方的交付物相当于打印稿，固定「浅底深字」，
 *   不跟随应用当前的暗色主题。浅色主题下若文字写死浅色，会白底白字看不见；
 *   深色主题下深底浅字虽可读，但发给客户不专业。故无论当前亮 / 暗主题，
 *   导出图一律 白 / 浅灰底 + 深色文字。阶段色条（stage colors）等品牌 / 语义色保持原样。
 */
export const EXPORT_BG = '#ffffff'; // 导出背景：纯白纸面
export const EXPORT_FG = '#1e293b'; // 导出前景（默认文字）：深 slate-800（与 global.css .a4-page 对齐）
export const EXPORT_BORDER = '#e2e8f0'; // 导出弱描边：slate-200

/**
 * 导出 PNG 的 html2canvas 固定配色选项（纯函数，可测）。
 * backgroundColor 写死 EXPORT_BG（浅色常量），不读取任何主题 CSS 变量 / store；
 * ignoreElements 跳过 .no-print 操作栏——该栏使用跟随主题的 bg-paper/text-mist/border-line，
 * 不应进入交付物。若有人改回「跟随主题」，本函数返回的 backgroundColor 不再是固定常量，
 * 对应回归测试会失败。
 */
export function schedulePngExportOptions(): {
  backgroundColor: string;
  scale: number;
  useCORS: boolean;
  logging: boolean;
  ignoreElements: (el: Element) => boolean;
} {
  return {
    backgroundColor: EXPORT_BG,
    scale: 2,
    useCORS: true,
    logging: false,
    ignoreElements: (el: Element) => el.classList.contains('no-print'),
  };
}

/** 打印表单行：任务标题 | 参与人（多人多值，未指派 → [] → 页面渲染「—」）| 截止日 | 状态 */
export interface ScheduleTaskRow {
  id: string;
  title: string;
  dueDate: string | null;
  done: boolean;
  /** 参与人姓名列表（未指派 → []） */
  assigneeNames: string[];
}

/** 按阶段分组的一个 section（无任务 → tasks=[] → 页面显示「无任务」空行） */
export interface ScheduleSection {
  orderIndex: number;
  name: string;
  startAt: string;
  endAt: string;
  status: StageStatus;
  /** 阶段色号（1..9，多阶段项目循环）；打印时间轴摘要取色用 */
  colorIndex: number;
  /**
   * 阶段自定义色（v0.8 通路 B）。**必填而非可选**：`null` = 用内置 9 色，
   * 与 `undefined`（= 数据层漏接）在渲染层是**同一个后果**（退回内置色），
   * 故这里强制组装者显式给出，让「漏传」在 tsc 阶段就暴露，而不是变成静默的视觉退化。
   */
  customColor: string | null;
  tasks: ScheduleTaskRow[];
}

/**
 * 组装日程表 section：
 *   - 阶段按 orderIndex 1→9 排序（仅 visible 阶段）；
 *   - 任务按 orderIndex 排序；
 *   - 参与人 = taskAssigneeIds(task) 映射成员姓名（id 找不到 → 显示 id 兜底）；
 *   - 未指派 → assigneeNames=[]。
 */
export function buildScheduleSections(opts: {
  project: Project;
  stages: Stage[];
  tasks: Task[];
  members: Member[];
}): ScheduleSection[] {
  const memberName = (id: string): string =>
    opts.members.find((m) => m.id === id)?.name ?? id;

  const visibleStages = opts.stages
    .filter((s) => s.projectId === opts.project.id && s.visible !== false)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  return visibleStages.map((s) => {
    const stageTasks = opts.tasks
      .filter((t) => t.stageId === s.id)
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
    return {
      orderIndex: s.orderIndex,
      name: s.name,
      startAt: s.startAt.slice(0, 10),
      endAt: s.endAt.slice(0, 10),
      status: s.status,
      colorIndex: s.colorIndex,
      // ★ v0.8 通路 B：`?? null` 把「字段缺失 / undefined」也归一成明确的内置色信号，
      //   与 ScheduleSection 的「必填 string | null」契约对齐（渲染层只判 null）。
      customColor: s.customColor ?? null,
      tasks: stageTasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate?.slice(0, 10) ?? null,
        done: taskIsDone(t),
        assigneeNames: taskAssigneeIds(t).map(memberName),
      })),
    };
  });
}

/**
 * 导出 PNG（html2canvas 动态 import——打印视图低频使用，避免主包体积增大）。
 * jsdom 测试环境无 canvas，不调用；返回 Promise<void> 供页面 await 并 toast。
 */
export async function exportSchedulePng(
  element: HTMLElement,
  fileName: string,
): Promise<void> {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(element, schedulePngExportOptions());
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) {
    throw new Error('PNG 导出失败：无法生成图像数据。');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // ★ 与 downloadBackup 同款：revoke 必须让出一拍（同步 revoke 与下载启动存在竞态，详见那里注释）
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 打印文件名（用户可见物）：id-plan-schedule-<项目名>-<时间戳>.png */
export function schedulePngFileName(projectName: string, now: Date = new Date()): string {
  const ts = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 24);
  return `id-plan-schedule-${safeName || 'project'}-${ts}.png`;
}

/* ---------------------------------------------------------------------------
 * A4 分页（v0.4.1）：
 * 旧实现把整份日程表一次性 html2canvas 截成单张 PNG → 内容越多图越细长，
 * 且 @media print 的 A4 / break-inside 规则对屏幕渲染无效，导致表格被拉断、
 * 颜色割裂。改为「按 A4 页高估算分页 → 每页独立渲染 → 逐页导出 PNG」。
 * ------------------------------------------------------------------------- */

/** A4 纸张像素尺寸（96dpi） */
export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;

/**
 * 打印内容可摘块（v0.8.6.0002 · 反馈 #9.2「将选择权交给用户」）。
 *
 * 五个块各自可摘；**默认全开** ⇒ 不传选择的宿主（深链路由
 * `/project/:id/schedule-print` 等）视觉与行为逐字不变。
 *
 * 为什么住在本模块（lib）而不是组件 `SchedulePaper.tsx`：
 * 第一页预留高度（`firstPageHeaderFor`）要读它 ⇒ 分页纯函数依赖它；
 * 打印偏好 store 要落它的默认值。放 lib 层让「store → lib」「组件 → lib」
 * 两条依赖都指向叶子，store 不需要为了几个布尔值去 import 组件文件
 * （组件 mock 一旦缺导出，store 初始化就会静默拿到残缺默认）。
 */
export interface SchedulePaperBlocks {
  /** 打印头部：项目名 + 委托方·周期 + 打印日期 */
  header: boolean;
  /** 打印时间轴：第一页的甘特摘要（月份刻度 / 色带 / 图例） */
  timeline: boolean;
  /** 项目信息：排期基准 + 打印时间 */
  projectInfo: boolean;
  /** 阶段清单表（每页） */
  stageTable: boolean;
  /** 页脚：署名 + 页码 */
  footer: boolean;
}

/** v1 默认：五块全开（= 现有纸面视觉；未接选项面板的宿主走此默认） */
export const DEFAULT_SCHEDULE_PAPER_BLOCKS: SchedulePaperBlocks = {
  header: true,
  timeline: true,
  projectInfo: true,
  stageTable: true,
  footer: true,
};

/** 高度估算常量（px，与 SchedulePrintPage 的行高/间距保持同量级） */
const EST = {
  sectionHeader: 52,
  row: 46,
  emptySection: 44,
  sectionGap: 24,
  /** 第一页额外的页头：项目信息 + 时间轴摘要 */
  firstPageHeader: 210,
  pageHeaderBand: 58,
  pageFooter: 48,
  pagePadding: 88,
};

/**
 * 时间轴（第一页甘特摘要）被摘掉后，第一页的非清单内容只剩
 * 「打印头部 + 项目信息」（≈ 53 + 34 = 87，取 92 留余量）。
 *
 * 为什么必须分开给：打印内容自定义（反馈 #9.2）允许关掉时间轴，此时若仍按
 * 母本 `firstPageHeader = 210`（那是「头部 + 时间轴」的合计预留）预留，
 * 第一页会按少 ~120px 内容的空间分页 ⇒ 第一页下半部永久留白。
 */
export const FIRST_PAGE_HEADER_NO_TIMELINE = 92;

/**
 * 按打印内容选项推导第一页预留高度（供 `paginateSections` 第二参）：
 *   · 时间轴在（默认 / 未传 ⇒ 深链路由与老调用方）⇒ 母本 210；
 *   · 时间轴关 ⇒ FIRST_PAGE_HEADER_NO_TIMELINE。
 * header / projectInfo 也关时不进一步细分——那两个块合计不足 90px，
 * 多预留一点只是分页略保守，不会留白。
 */
export function firstPageHeaderFor(blocks?: SchedulePaperBlocks | null): number {
  return blocks && blocks.timeline === false ? FIRST_PAGE_HEADER_NO_TIMELINE : EST.firstPageHeader;
}

/** 单个阶段 section 的估算高度 */
export function estimateSectionHeight(s: ScheduleSection): number {
  const rows = s.tasks.length === 0 ? EST.emptySection : s.tasks.length * EST.row;
  return EST.sectionHeader + rows + EST.sectionGap;
}

/**
 * 把阶段 section 分配到 A4 页：
 *   - 第一页额外扣除页头（项目信息 + 时间轴摘要）高度；
 *   - 超过可用高度即换页，保证 section 不被切断（break-inside 语义）。
 * 纯函数可测，返回二维数组（每个元素 = 一页的 sections）。
 *
 * `firstPageHeader` 为**可选参**（默认 = 母本 210）：打印内容自定义关掉
 * 时间轴时传 `firstPageHeaderFor(blocks)` 得到的更小值；不传 = 老行为
 * （A13「预计页数」spec 的复算常量 719 = 929 − 210 逐字不变）。
 */
export function paginateSections(
  sections: ScheduleSection[],
  firstPageHeader: number = EST.firstPageHeader,
): ScheduleSection[][] {
  const usable = A4_HEIGHT_PX - EST.pagePadding - EST.pageHeaderBand - EST.pageFooter;
  const pages: ScheduleSection[][] = [];
  let current: ScheduleSection[] = [];
  let used = 0;
  let isFirstPage = true;

  for (const s of sections) {
    const h = estimateSectionHeight(s);
    const limit = usable - (isFirstPage ? firstPageHeader : 0);
    // 首个 section 即便超高也放入当前页（避免死循环）
    if (current.length > 0 && used + h > limit) {
      pages.push(current);
      current = [];
      used = 0;
      isFirstPage = false;
    }
    current.push(s);
    used += h;
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

/** 文件名加页码后缀：xxx.png → xxx-p1of3.png（单页时保持不变） */
export function withPageSuffix(name: string, page: number, total: number): string {
  if (total <= 1) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '.png';
  return `${base}-p${page}of${total}${ext}`;
}

/**
 * 逐页导出 PNG（每个元素 = 一页 A4 容器）。
 * 浏览器可能拦截瞬时连下载，故每页之间留 300ms 间隔。
 */
export async function exportSchedulePngPages(
  elements: HTMLElement[],
  baseFileName: string,
): Promise<void> {
  const html2canvas = (await import('html2canvas')).default;
  for (let i = 0; i < elements.length; i++) {
    const canvas = await html2canvas(elements[i], schedulePngExportOptions());
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error(`PNG 导出失败：第 ${i + 1} 页无法生成图像数据。`);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = withPageSuffix(baseFileName, i + 1, elements.length);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // ★ 与 downloadBackup 同款：revoke 必须让出一拍（同步 revoke 与下载启动存在竞态，详见那里注释）
    setTimeout(() => URL.revokeObjectURL(url), 0);
    if (i < elements.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
