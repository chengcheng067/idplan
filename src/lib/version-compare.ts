/**
 * 版本号比较（GitHub Release tag 形如 v0.3.0.0018）。
 *
 * v0.3 引入：桌面端要做「自动检测新版本」，需把本地 BUILD_VERSION 与 GitHub latest release 的
 * tag_name 逐段数值比较。纯字符串比较会错（'0.3.0.9' < '0.3.0.10' 但字典序相反），故统一按
 * '.' 分段、每段 Number 比较。
 *
 * 约定：合法桌面版 tag 必以 'v' 开头且恰好 4 段（x.y.z.build）。不满足则视为「无法判断」，
 * 调用方据此 hasUpdate=false 绝不误报（仓库另有 docker-0.3.0 / upk-images-0.3.0 等非桌面发布）。
 *
 * 注意：electron/main.cjs 是 .cjs 无法直接吃 TS，里面有一份行为对齐的纯 JS 副本，改这里要同步改那里。
 */

/** 解析四段版本号（v 前缀可选）。非四段 / 含非数字段 → 返回 null */
export function parseVersion(raw: string): number[] | null {
  if (!raw) return null;
  const v = raw.startsWith('v') ? raw.slice(1) : raw;
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  const segments = parts.map((p) => Number(p));
  if (segments.some((n) => !Number.isFinite(n))) return null;
  return segments;
}

/** 合法桌面版 tag：必以 'v' 开头且恰好 4 段 */
export function isValidDesktopTag(tag: string): boolean {
  if (!tag.startsWith('v')) return false;
  return parseVersion(tag) !== null;
}

/**
 * 比较 a、b 两个版本。
 * 返回 >0 表示 a 较新，<0 表示 b 较新，0 表示相等。
 * 任一无法解析 → 返回 null（调用方不应据此判定有更新）。
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** 判断 upstream（GitHub latest）是否比 current 更新 */
export function isNewer(upstream: string, current: string): boolean {
  const r = compareVersions(upstream, current);
  return r !== null && r > 0;
}
