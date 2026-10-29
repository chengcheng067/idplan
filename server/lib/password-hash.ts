/**
 * 密码哈希的**唯一实现**（服务端 scrypt，格式 `saltHex:hashHex`）。
 *
 * ── 为什么从 `routes/members.routes.ts` 抽出来 ──
 * 多工作区（NAS 版）的「进入某个区的闸密码」用的是**同一套**哈希口径：建区时把
 * 明文落成 `gate_password_hash`，切区时比对。若 `workspace-registry.ts` 自己再写一份
 * scrypt 参数，那么改动 `SCRYPT_N`（或换 KDF）只改一处就会出现
 * 「成员密码能验、区闸密码永远验不过」这种**只在切区那一刻暴露**的故障。
 * 本仓判据：同一个事实不许有两个出处 ⇒ 抽成模块，两处共用。
 *
 * ── 行为零变化 ──
 * 函数体与参数**逐字搬运**自 `members.routes.ts`（抽取前后用
 * `tests/server.sync-v2.spec.ts`「POST /api/members/verify 服务端 scrypt 比对」
 * 与 `tests/server.write-auth.spec.ts` 复跑守住）。本文件不新增任何校验、不改参数、
 * 不改哈希串格式 —— 库里的存量哈希照旧可比对。
 *
 * ── 为什么不下发哈希 ──
 * 见 `members.routes.ts` 文件头：实时接口只下发 `hasPassword` 布尔值，比对一律在
 * 服务端做（本文件的两个函数就是那个「服务端」）。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt 参数（改动 = 库内全部存量哈希失效，务必连同迁移一起做） */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** 明文密码 → `saltHex:hashHex`（scrypt） */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** 恒定时间校验明文密码是否匹配某哈希（`stored` 为空/格式坏 ⇒ false，不抛） */
export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const idx = stored.indexOf(':');
  if (idx <= 0) return false;
  const salt = Buffer.from(stored.slice(0, idx), 'hex');
  const expected = Buffer.from(stored.slice(idx + 1), 'hex');
  try {
    const actual = scryptSync(plain, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
