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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验外部输入的 ID 是否符合前缀规范（弱校验，仅防御明显错误）。
 *
 * 注意：各前缀长度不同（proj_ 为 5 字符，其余前缀均为 4 字符），
 * 必须按**实际命中的前缀**截取，不能写死 slice(5)——否则除 proj_ 外的
 * 所有 ID 都会被切掉 UUID 首位而误判为非法。
 */
export function looksLikeId(value: string): boolean {
  const prefix = PREFIXES.find((p) => value.startsWith(`${p}_`));
  if (!prefix) return false;
  return UUID_V4.test(value.slice(prefix.length + 1));
}
