/**
 * 打印 logo 的上传前处理（产品决策文档 §3.3：灰度 + 阈值二值化，≤200KB）。
 *
 * ── 为什么必须二值化 ──
 * 打印恒为亮色纸面（01 §2），logo 要跨四版纸面（A 的黄/黑栏、D 的白、
 *   E 的暖纸、H 的灰白）都可辨 ⇒ 只允许**单色（黑）透明底**：深色像素
 *   变实心黑，其余全透明。彩色 logo 直出会在 A 版黑顶栏上消失、在暖纸上
 *   发脏——与配色机制同一套灰度理念（决策文档 §3.3）。
 *
 * ── 白底深色 vs 深色底浅字 vs 透明底 ──
 * 直接阈值会把「白字深底」的 logo 打成「黑底白字」一坨；而只判平均亮度又会
 * 把「透明底黑字」误判成深底而反相——黑字变透明，logo 整个消失。故底色
 * 判定用三道统计量（不透明占比 / 不透明均亮 / 亮像素占比，见 binarizePixels
 * 文档），三种常见形态都收敛到「黑字透明底」。极端 logo（多色等权）会丢掉
 * 层次，但打印场景单色可辨优先于层次（决策文档原文）。
 *
 * ── 体积阶梯 ──
 * 二值 PNG 通常极小；复杂 logo 超限时按 320 → 240 → 160 → 120 逐档
 * 降采样重出，仍超 200KB 才拒绝（备份 JSON 不被一张图撑爆——决策文档
 * §3.1 把这条列为该方案唯一的真实风险）。
 */

/** dataURL 长度上限（字符数 ≈ base64 后的存储体积；200KB） */
export const PRINT_LOGO_MAX_CHARS = 200 * 1024;

/** 降采样阶梯（长边 px；打印落地 ≤28px，320 起步足够） */
const SCALE_LADDER: readonly number[] = [320, 240, 160, 120];

/** 二值化阈值（0-255 亮度；< 阈值 ⇒ 实心黑，其余透明） */
export const BINARIZE_THRESHOLD = 150;

/**
 * 灰度 + 阈值二值化（**纯函数**：原地改写 RGBA 缓冲区）。
 *
 * 输出只有两种像素：实心黑（标记）与全透明（其余）——跨四版纸面都可辨的
 * 单色形态。拆成纯函数是为了**不依赖 canvas 也能单测**（jsdom 无 canvas
 * 实现）：单元测试直接喂已知像素缓冲，断言输出 alpha/RGB。
 *
 * ── 底色判定（三道统计量，为什么不能只判平均亮度）──
 * 透明底黑字 / 深底白字 / 浅底深字三种 logo 的平均亮度都可能是「暗」，
 * 单判均值会把「透明底黑字」误判成深底而反相——黑字变透明，logo 整个
 * 消失（实测踩过）。故按序判三件事：
 *   ① 不透明占比 ≥ 50% ⇒ 有不透明底色（否则是已抠透明底的 logo）；
 *   ② 不透明像素均亮 < 128 ⇒ 底色暗（深底白字，反相）；
 *   ③ 亮像素占比 > 2% ⇒ 暗底上**确实有浅色内容**（否则是纯色填充图，
 *      反相会把内容反没，此时不反相，深色内容如实成标）。
 * 透明底（① 不满足）时额外允许「浅色内容也转黑」——白字透明底的 logo
 * 落在亮纸面上同理应该可见（形状保留，颜色统一近黑）。
 */
export function binarizePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = BINARIZE_THRESHOLD,
): void {
  const pixelCount = Math.max(0, Math.floor(data.length / 4));
  if (pixelCount === 0) return;

  // 统计：不透明像素的亮度分布
  let opaqueCount = 0;
  let lumSum = 0;
  let lightCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    if (data[o + 3]! < 128) continue;
    opaqueCount++;
    const lum = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
    lumSum += lum;
    if (lum > 255 - threshold) lightCount++;
  }
  const opaqueRatio = opaqueCount / pixelCount;
  const meanOpaqueLum = opaqueCount > 0 ? lumSum / opaqueCount : 255;
  const lightRatio = opaqueCount > 0 ? lightCount / opaqueCount : 0;
  // ②③：暗底 + 有浅色内容 ⇒ 反相（深底白字 → 黑字透明底）
  const invert = opaqueRatio >= 0.5 && meanOpaqueLum < 128 && lightRatio > 0.02;
  // 透明底 ⇒ 浅色内容也转黑（白字透明底 logo 在亮纸面上要可见）
  const markLightToo = !invert && opaqueRatio < 0.5;

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const a = data[o + 3]!;
    let lum = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
    if (invert) lum = 255 - lum;
    const mark = a >= 128 && (lum < threshold || (markLightToo && lum > 255 - threshold));
    data[o] = 0;
    data[o + 1] = 0;
    data[o + 2] = 0;
    data[o + 3] = mark ? 255 : 0;
  }
}

/**
 * 体积阶梯 + 闸门决策（**纯函数**：按 SCALE_LADDER 逐档渲染，取第一档
 * 不超限的 dataURL；全部超限 ⇒ null = 拒绝）。拆出来是为了不依赖 canvas
 * 也能单测「全部超限 ⇒ 拒绝」分支（render 回调在单测里给假字符串）。
 */
export function firstFittingDataUrl(render: (maxEdge: number) => string): string | null {
  for (const maxEdge of SCALE_LADDER) {
    const candidate = render(maxEdge);
    if (candidate.length <= PRINT_LOGO_MAX_CHARS) return candidate;
  }
  return null;
}

export interface PrintLogoProcessResult {
  ok: boolean;
  /** 处理后的 dataURL（ok 时） */
  dataUrl?: string;
  /** 失败原因（人话，直接进 toast） */
  reason?: string;
}

/** 读文件 → Image（SVG 需内含宽高，否则 Chromium 拒绘——明示） */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = (): void => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (): void => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败，请换 PNG / JPG / SVG 文件'));
    };
    img.src = url;
  });
}

/** 灰度 + （暗底反相） + 阈值二值化 ⇒ 黑字透明底 PNG dataURL（canvas 薄壳） */
function binarizeToDataUrl(img: HTMLImageElement, maxEdge: number): string {
  const nw = img.naturalWidth || maxEdge;
  const nh = img.naturalHeight || maxEdge;
  const scale = Math.min(1, maxEdge / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布不可用');
  ctx.drawImage(img, 0, 0, w, h);

  const image = ctx.getImageData(0, 0, w, h);
  binarizePixels(image.data, w, h);
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * 处理上传文件（入口函数）。
 *
 * SVG 无内置宽高时 Chromium 绘不出东西（naturalWidth=0）⇒ 明确拒绝并提示，
 * 不静默产出一张空图。
 */
export async function processPrintLogoFile(file: File): Promise<PrintLogoProcessResult> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : '图片读取失败' };
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    return {
      ok: false,
      reason: '该 SVG 未包含宽高，无法处理——请改用 PNG，或在 SVG 内写明 width / height',
    };
  }

  // 体积阶梯：逐档降采样重出，取第一档不超限的（纯函数决策，可单测）
  let fitted: string | null = null;
  try {
    fitted = firstFittingDataUrl((maxEdge) => binarizeToDataUrl(img, maxEdge));
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : '图片处理失败' };
  }
  if (fitted !== null) return { ok: true, dataUrl: fitted };
  return {
    ok: false,
    reason: `处理后仍超过 ${Math.round(PRINT_LOGO_MAX_CHARS / 1024)}KB——请先用图片工具简化logo（纯色、少细节）再上传`,
  };
}
