/**
 * ID 生成唯一出口（铁律 1）：crypto.randomUUID() + 类型前缀。
 */
export type IdPrefix =
  | 'proj'
  | 'stg'
  | 'tsk'
  | 'mem'
  | 'log'
  | 'ctt'
  | 'art'
  // v0.8：自定义阶段库条目（存 settings KV `customStages`，不是新表）
  | 'cst';

const PREFIXES: readonly IdPrefix[] = ['proj', 'stg', 'tsk', 'mem', 'log', 'ctt', 'art', 'cst'];

export function createId(prefix: IdPrefix): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** 校验外部输入的 ID 是否符合前缀规范（弱校验，仅防御明显错误） */
export function looksLikeId(value: string): boolean {
  if (!PREFIXES.some((p) => value.startsWith(`${p}_`))) return false;
  const rest = value.slice(5);
  // UUID v4 形状（8-4-4-4-12）
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rest);
}
