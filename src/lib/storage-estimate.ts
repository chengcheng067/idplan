/**
 * 本地库占用量估算（v0.6 · T13 底层评估追加项）。
 *
 * 目的：为未来「单库 > 50MB 触发分库/清理」提供**唯一客观判据**。
 *
 * 取值优先级：
 * 1. `navigator.storage.estimate()` —— 浏览器报告的 IndexedDB 真实落盘占用
 *    （Chrome/Edge 原生实现最准；Electron Chromium 同样支持）；
 * 2. Dexie 全表 JSON 序列化字节数 —— 后备估算（fake-indexeddb / 不支持
 *    estimate 的环境），偏小（不含索引开销），但量级正确。
 *
 * 返回 null 表示「无法估算」——UI 直接隐藏该行，不显示假数字（PRD 禁伪造数据）。
 */

export interface LocalDbUsage {
  /** 占用字节数（优先真实落盘占用，fallback 序列化估算） */
  bytes: number;
  /** 数据来源（UI 可标注「实测 / 估算」） */
  source: 'storage-estimate' | 'serialization-fallback';
}

/** 字节数 → 人读文案（KB/MB，一位小数；< 1KB 显示 B） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** UTF-8 字符串字节数（不建临时 Blob，纯算术） */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i) ?? 0;
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c < 0x10000) n += 3;
    else {
      n += 4;
      i++; // 代理对第二个码元
    }
  }
  return n;
}

/**
 * 估算本地库占用。绝不抛异常——任何失败返回 null（UI 隐藏该行）。
 * 注意：结果非实时精确值，展示用途足够；触发清理阈值时以 storage-estimate 为准。
 */
export async function estimateLocalDbUsage(
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  dumpTables: () => Promise<Record<string, any[]>>,
): Promise<LocalDbUsage | null> {
  try {
    // ① 优先：浏览器真实落盘占用（含 IndexedDB 全部库；本应用只开一个库，可近似）
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const { usage } = await navigator.storage.estimate();
      if (typeof usage === 'number' && usage > 0) {
        return { bytes: usage, source: 'storage-estimate' };
      }
    }
    // ② 后备：全表 JSON 序列化字节数
    const tables = await dumpTables();
    let total = 0;
    for (const rows of Object.values(tables)) {
      total += utf8Bytes(JSON.stringify(rows ?? []));
    }
    // usage === 0 也可能是真空库（新装用户）——此时序列化值同样≈0，返回 0 合法
    return { bytes: total, source: 'serialization-fallback' };
  } catch {
    return null;
  }
}
