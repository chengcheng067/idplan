/**
 * 通用 JSON 文本列序列化层（v0.6 三件套③ · 设计文档 §6.1）。
 *
 * SQLite 无数组/对象类型，数组一律以 JSON 文本列存储。
 *
 * ★ 为什么必须新增而不复用 tasks.routes.ts 里旧的 serializeAssigneeIds：
 *   旧实现内含 `ids.filter(x => typeof x === 'string')`，对 artifacts（对象数组）
 *   会把每个元素判为非 string 而**全部滤掉**，结果静默写入 '[]' ——
 *   数据无声消失、无报错、无日志。本仓库已在 assigneeIds 上踩过一次
 *   「数组被 SQLite 隐式 join 吞掉」的坑（tests/server.sync-v2.spec.ts 回归防线），
 *   不能再踩第二次。硬禁令见设计文档 §9.2。
 */

/** 序列化为 JSON 文本列；undefined/null → 'null'（列声明可空时语义正确） */
export function serializeJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  try {
    return JSON.stringify(value);
  } catch {
    return 'null'; // 循环引用等极端情况
  }
}

/**
 * 反序列化：坏数据回落 fallback，绝不因单条脏数据让整次查询 500。
 * 'null' 串 / 空串 / 非串 → fallback。
 */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 数组专用薄包装：保证返回值一定是数组（列内脏数据为对象时回落） */
export function parseJsonArray<T>(raw: unknown): T[] {
  const v = parseJson<unknown>(raw, []);
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * 既有 `serializeAssigneeIds` 改为薄包装（行为等价：string[] 场景下与旧实现输出一致）。
 * ★ 仅限 assignee_ids（string[]）使用——**任何对象/对象数组字段禁止走本函数**
 *   （内部 filter 会清空对象元素），一律用 `serializeJson`。
 * 保留导出名，避免 tasks.routes.ts 大面积改名。
 */
export function serializeAssigneeIds(ids: unknown): string {
  return serializeJson(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
}
