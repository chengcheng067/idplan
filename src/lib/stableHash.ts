/**
 * 双环境安全的确定性短指纹（FNV-1a 32bit）。
 *
 * 为什么不用 node:crypto / crypto.subtle：消费方 `payload.apply.ts`（Agent 导入
 * 共享核心）**同时跑在桌面渲染进程（浏览器）与 NAS 服务端（Node）**，
 * `node:crypto` 在 vite 浏览器构建里被 externalize → import 直接炸构建（2026-09-29
 * 实测）；`crypto.subtle` 是异步且老环境支持不全。FNV-1a 十行纯函数、同步、两处通用。
 *
 * 用途限定：**生成确定性 id 的指纹分量**（artifact id 等）——不是密码学场景
 * （那种必须留给你们服务端 auth：timingSafeEqual + Ed25519）。FNV-1a 在这个用途上
 * 的碰撞率可忽略：键空间（externalId × 序号 × 标题）小且调用方会把原文片段一并
 * 编进 id（见 stableId），指纹只是「防截断后撞车」的兜底。
 */

/** FNV-1a 32bit，返回 8 位小写 hex */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // FNV prime 16777619 的 32 位乘（Math.imul 保证不丢精度）
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 只保留 id 安全字符（[a-z0-9_-]），其余折叠为 '_'；首尾连续 '_' 收敛 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 确定性 id 生成：原文可读片段 + 指纹。
 *
 * 形状：`prefix_slug(片段1)_序号_slug(片段2)_指纹8`
 * - 片段截断（默认 24）防无限长；**截断可能撞车 → 指纹兜底**
 * - 同一组入参永远同一输出（幂等重放不漂移，2026-09-29 条目8 的诉求）
 * - 不同入参输出不同（设计意图内不碰撞；跨意图撞见只能靠指纹 32bit，可忽略）
 */
export function stableId(prefix: string, parts: ReadonlyArray<string | number>): string {
  const raw = parts.map(String).join('|');
  const slugged = parts.map((p) => {
    const s = slugify(String(p));
    return s.length > 24 ? s.slice(0, 24) : s;
  });
  return [slugify(prefix), ...slugged.filter((s) => s !== ''), fnv1a32(raw)].join('_');
}
