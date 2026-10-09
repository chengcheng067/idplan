/**
 * 法定节假日接入层（hydrate 边界，纯函数）。
 *
 * ── 为什么合并只许发生在这里 ──
 * `DEFAULT_REST_POLICY` 与 `lib/workdays.ts` 的判定链**绝不掺入**内置节假日表：
 * 双休回归护栏（tests/workdays.rest-policy.spec.ts「与 businessdays 完全一致」）
 * 与 split-workdays 的脆弱断言都建立在「出厂策略 = 纯双休」上。内置表只在一个
 * 地方进入系统——**settings 行读入 / 写入 store 的 hydrate 边界**：
 *
 *   settings 行（raw，含 skipHolidays）
 *     → normalizeRestPolicy           形状收敛（useRepos 读入用）
 *     → withCnHolidays                内置表合并（store setRestPolicy / service 用）
 *
 * 持久化里存的永远是**用户手填的原始值**（raw），内置表不落库 ⇒ 次年数据随版本
 * 更新时，老库里不会冻着一份过期的 2025/2026 副本。
 *
 * ── 合并优先级（用户手填 > 内置表） ──
 * 同一天用户手填与内置表冲突时听用户的：
 *   · 用户把某内置放假日标进 extraWorkdays（公司过节上班）⇒ 该日不合并进 extraHolidays；
 *   · 用户把某内置补班日标进 extraHolidays（公司补班日休息）⇒ 该日不合并进 extraWorkdays。
 * 由于 isRestDay 的判定链本就是「extraWorkdays → extraHolidays → 周休制度」，
 * 冲突日内置数据让位后，用户值天然生效，判定链一个字不改。
 */

import { ALL_REST_POLICIES, RestPolicyKind } from '../types/enums';
import { DEFAULT_REST_POLICY } from '../types/entities';
import type { RestPolicyConfig } from '../types/entities';
import { cnHolidayIndex } from './index';

/**
 * 内置节假日表合并进休息制度配置。
 *
 * `skipHolidays !== true` ⇒ **原样返回同一引用**（现状逐字节不变，default=false 的保证）；
 * 无已核实年份数据（表空）⇒ 同样原样返回（降级不注入空数组）。
 */
export function withCnHolidays(policy: RestPolicyConfig): RestPolicyConfig {
  if (policy.skipHolidays !== true) return policy;

  const index = cnHolidayIndex();
  if (index.holidays.size === 0 && index.workdays.size === 0) return policy;

  const userHolidays = new Set(policy.extraHolidays ?? []);
  const userWorkdays = new Set(policy.extraWorkdays ?? []);

  // 放假日 = 用户手填 ∪ 内置表（剔除用户标了「上班」的冲突日）
  const holidays = new Set(userHolidays);
  index.holidays.forEach((d) => {
    if (!userWorkdays.has(d)) holidays.add(d);
  });
  // 补班日 = 用户手填 ∪ 内置表（剔除用户标了「休息」的冲突日）
  const workdays = new Set(userWorkdays);
  index.workdays.forEach((d) => {
    if (!userHolidays.has(d)) workdays.add(d);
  });

  return {
    ...policy,
    extraHolidays: [...holidays],
    extraWorkdays: [...workdays],
  };
}

/**
 * 双休自定义休息日收敛（hydrate 边界，规则同 singleRestWeekday）：
 * 两整数、各在 0-6、**严格升序**；同天/逆序/越界/非整数/长度不符 ⇒ undefined
 * （读时回落 [5,6] 周六+周日，旧数据无迁移）。
 */
function normalizeDoubleRestWeekdays(raw: unknown): [number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const [a, b] = raw as [unknown, unknown];
  const ok = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
  if (!ok(a) || !ok(b)) return undefined;
  return a < b ? [a, b] : undefined;
}

/**
 * 把任意解析结果收敛成合法 RestPolicyConfig；无法识别时回落默认值。
 * 体例与 `useRepos.ts` 旧实现逐行一致，仅追加 `skipHolidays` 字段
 * （旧行缺省 ⇒ false ⇒ 现状不变）、`singleRestWeekday`（单休自定义休息
 * 周几，0=周一…6=周日，缺省/非法 ⇒ undefined ⇒ 读时回落周日，无迁移）
 * 与 `doubleRestWeekdays`（双休自定义两个休息日，升序，缺省/非法 ⇒
 * undefined ⇒ 读时回落 [5,6] 周六+周日，无迁移）。
 */
export function normalizeRestPolicy(raw: unknown): RestPolicyConfig {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_REST_POLICY;
  const { kind, anchorWeek, extraHolidays, extraWorkdays, skipHolidays, singleRestWeekday, doubleRestWeekdays } =
    raw as Record<string, unknown>;
  if (!ALL_REST_POLICIES.includes(kind as RestPolicyKind)) return DEFAULT_REST_POLICY;
  return {
    kind: kind as RestPolicyKind,
    anchorWeek: typeof anchorWeek === 'string' ? anchorWeek : null,
    extraHolidays: Array.isArray(extraHolidays)
      ? extraHolidays.filter((d): d is string => typeof d === 'string')
      : undefined,
    extraWorkdays: Array.isArray(extraWorkdays)
      ? extraWorkdays.filter((d): d is string => typeof d === 'string')
      : undefined,
    skipHolidays: skipHolidays === true,
    singleRestWeekday:
      typeof singleRestWeekday === 'number' &&
      Number.isInteger(singleRestWeekday) &&
      singleRestWeekday >= 0 &&
      singleRestWeekday <= 6
        ? singleRestWeekday
        : undefined,
    doubleRestWeekdays: normalizeDoubleRestWeekdays(doubleRestWeekdays),
  };
}

/**
 * hydrate 边界一站式入口：settings 行原文 ⇒ 生效制度（含法定节假日合并）。
 * service 层（project.service 从 settings 读制度切分）与测试共用本函数。
 */
export function hydrateRestPolicy(raw: unknown): RestPolicyConfig {
  return withCnHolidays(normalizeRestPolicy(raw));
}
