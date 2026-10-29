/**
 * 新手引导（onboarding）的 settings KV 键常量 —— **键名的唯一出处**。
 *
 * 为什么住在 core：键名要被三层同时引用 ——
 *   · `src/store/useOnboardingStore.ts`（读写镜像与触发闸门）；
 *   · `src/core/repositories/local/workspace.db.ts`（建区时给**全新库**播种
 *     `onboarding.done = false`，本地形态）；
 *   · `server/workspace-registry.ts`（远端建区的同一播种，服务端形态）——
 *     服务端虽不 import 本文件（独立 tsconfig），但字面量旁有注释指回这里，
 *     且 tests/onboarding.spec.ts 有一条源码守卫锁住两边字面量一致。
 *
 * ── 三态语义（判定「该不该自动弹引导」的唯一依据）──
 *   `onboarding.done` 缺行   ⇒ 视为**已看过**（老库升级 / 历史数据一律不弹）；
 *   `onboarding.done = false` ⇒ **全新数据库**的显式标记（建区/首次确立管理员时播种）
 *                               ⇒ 身份选定后自动弹一次；
 *   `onboarding.done = true`  ⇒ 用户看完 / 跳过（两条线、完成页、跳过按钮都写它）。
 *
 * ⚠️ 历史：曾想过用「members 表是否为空」当「新库」判据，被否 ——
 * 成员可被删光（0019 删除功能），老库删光成员后会被误判成新库。显式播种才精确。
 */

/** settings KV 键：引导是否已完成/跳过（boolean） */
export const ONBOARDING_DONE_KEY = 'onboarding.done';

/** settings KV 键：用户上次选的引导线（'quick' | 'steps'；重看时不再问） */
export const ONBOARDING_MODE_KEY = 'onboarding.mode';

/** 引导线的两种形态 */
export type OnboardingMode = 'quick' | 'steps';

/** mode 的合法值守卫（settings 读档时防脏数据） */
export function isOnboardingMode(v: unknown): v is OnboardingMode {
  return v === 'quick' || v === 'steps';
}
