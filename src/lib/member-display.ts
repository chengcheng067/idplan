/**
 * 成员 id → 屏幕显示名的**统一出口**（v1.0.0.0020 · 删除成员批次新增）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么需要它（症状：成员可以被删了）
 * ══════════════════════════════════════════════════════════════════════
 * 在「删除成员」之前，任务/阶段/看板上的负责人 id **总能**在 `members` 里查到人
 * （唯一把它从界面移除的手段是软停用 `active=false`，行还在）。删除上线后这条
 * 前提没了：`reassignTo=null` 的路径**故意**把引用置空，而 append-only 的
 * `AssignmentLog` 更是**永远**留着原 id。于是显示层会遇到「id 查不到成员」。
 *
 * 三种到处各写一遍的坏兜底：
 *   ① 显示空串 —— 用户看到「负责人：」（以为是自己没设）；
 *   ② 显示原始 id（`9f3a-…`）—— 界面上冒出一串 UUID，比空白更糟；
 *   ③ 各处各自决定 —— 同一个「已删除的人」在任务卡、阶段列、看板上三种叫法。
 *
 * 所以**收口到这一个函数**：查不到 ⇒ 灰名「已删除成员」。灰（`text-mist`）不是点缀，
 * 它同时表达「这条记录还在、但指向的人已经不在了」——数据没坏，只是人走了。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 边界（别越界）
 * ══════════════════════════════════════════════════════════════════════
 * · **只用于显示**。任何要落库的位置（`operator_name` 等）继续走
 *   `OPERATOR_SENTINELS`（`src/core/types/operator-sentinel.ts`）——
 *   把界面文案写进库会让历史留痕随界面语言分叉，那是本仓明令禁止的一类 bug。
 * · **不改数据**。`AssignmentLog` 是 append-only 审计流水：删人之后那些行仍指着
 *   原 id，本文件只决定它们**怎么显示**，绝不参与改写。
 * · `null` / 空串 ≠ 已删除：「没有负责人」是第三种状态，由各调用点自己说
 *   （`stageRows.unassigned` / `taskChecklist.unassigned`）。本文件只管
 *   「**有** id 但查不到人」。
 *
 * ⚠️ 本文件不是 hook、不订阅语言变化 ⇒ 调用它的组件必须自己 `useLang()`
 *   （与 `src/i18n/labels.ts` 里的取词小函数同一口径）。
 */
import type { Member } from '../core/types/entities';
import { t } from '../i18n';

/** 「查不到成员」的灰名文案键（唯一出处；测试与调用点都引它，不手抄字面量） */
export const DELETED_MEMBER_LABEL_KEY = 'member.deletedMember' as const;

/** 灰名样式类（唯一出处：所有「已删除成员」都长这样，别各写一份 `text-mist/60`） */
export const DELETED_MEMBER_CLASS = 'text-mist/70 italic';

/**
 * 成员 id → 显示名。查得到 ⇒ 真名；查不到 ⇒ 灰名「已删除成员」（**不是**空串、
 * **不是**原始 id）。
 *
 * @param memberId 引用里的成员 id。`null`/空串 ⇒ 返回 `null`，由调用方表达
 *   「未指派」（本函数不替它编一个词，因为不同位置的「未指派」文案本来不同）。
 * @param members  当前成员表（通常来自 `useMembersStore`）
 */
export function memberDisplayName(
  memberId: string | null | undefined,
  members: readonly Member[],
): { text: string; missing: boolean } | null {
  if (memberId === null || memberId === undefined || memberId === '') return null;
  const hit = members.find((m) => m.id === memberId);
  if (hit) return { text: hit.name, missing: false };
  return { text: t(DELETED_MEMBER_LABEL_KEY), missing: true };
}

/**
 * 同上，但只要文本（`null` ⇒ 空串）。给「拼接」场景用（多人姓名 join、
 * 打印表格单元格），那里塞不下 `missing` 这个标记。
 */
export function memberDisplayText(
  memberId: string | null | undefined,
  members: readonly Member[],
): string {
  return memberDisplayName(memberId, members)?.text ?? '';
}
