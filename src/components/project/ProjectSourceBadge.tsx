/**
 * 「AI 工作区」来源标识（v0.8 T04-A · 设计 §7.3 的 4 项特判之一）。
 *
 * ══════════════════════════ 这个组件为什么必须存在 ══════════════════════════
 *
 * §7.3 说得很清楚：只有 4 项**接不上漏斗**，它们的共同特征是
 * 「入口不是**列表**，而是**单项目直达**或**路由级**」—— 没有"过滤"可以挂：
 *
 *   · #17 `/project/:id/schedule-print`（日程表打印）
 *   · #18 `/project/:id/calendar-print`（月历打印）
 *   · #27 `/project/:id`（详情页，**唯一允许穿越**的通道）
 *
 * 这三处的正确做法**不是**"打不开"（删路由会破坏既有深链，PRD 明示保留独立路由），
 * 而是：**打开后必须让用户知道自己正在看一块 Agent 看板**。
 * 所以本组件是那三处的"来源提示"——它把"这是一次跨工作区访问"从**隐含**变成**可见**。
 *
 * ── 为什么是"细边 + 非阻塞"而不是醒目标语 ──
 *   ① **不阻塞**：详情页是唯一允许穿越的通道，用户来这里是**正常使用**（看排期、
 *      看任务），不是误入歧途。用一个 modal / 全屏提示拦住他，等于把"允许穿越"
 *      重新变回"不许进"——与 §7.3 的裁决自相矛盾。
 *   ② **细边**：提示的受众是「偶尔从深链/收藏夹进来的人」。对每天都在 Agent 工作区
 *      里干活的人（比如 AI 侧的操作者），一个每次都弹的醒目横幅是纯噪音。
 *      细边徽章"一直在、但不抢注意力"，两类受众都成立。
 *   ③ **不新增颜色**：本仓铁律「零裸 hex，只用既有 token」。这里只用
 *      `line`（描边）/ `cream`（底）/ `pine`（字）三个既有语义色 —— Agent 侧与人类侧
 *      的区分**不靠颜色**，靠**文案**。用一套新配色去区分工作区会引出"配色要进
 *      两套主题、还要进打印浅色稿"三处连带改动，而收益只是多一个色块。
 *
 * ── 判定只用 `projectKindOf`（本仓判 kind 的唯一出处）──
 *   组件**不自己写** `p.kind === 'agent'`：那样会把"读时回落"的口径抄成第二份
 *   （老库无 kind 列 ⇒ `undefined`，抄错就变成"把人类项目误标成 AI 工作区"）。
 *   `projectKindOf` 只认字面量 `'agent'`，其余一律按人类侧 —— 这里直接复用它。
 */

import { Bot } from 'lucide-react';

import { projectKindOf } from '../../core/project/visibility';
import type { Project } from '../../core/types/entities';
import { useLang } from '../../i18n';
import { cn } from '../../lib/cn';

export function ProjectSourceBadge({
  project,
  className,
}: {
  /** 只依赖 `kind` —— 传整个 Project 也行（结构化类型），便于调用点少写一次 pick */
  project: Pick<Project, 'kind'> | null | undefined;
  className?: string;
}): JSX.Element | null {
  /* 徽章文案现在只有一个出处（消息表 `ui.agentSourceBadge.text`）：原先那个
     `AGENT_SOURCE_BADGE_TEXT` 导出常量已退役 —— 它只有本文件一个消费点，
     留着就是「同一个词的第二份取值」。测试侧用的是自带字面量（`isolation-browser`）。 */
  const { t } = useLang();
  // 人类侧**零渲染**（v0.8 验收 8：kind 在人类侧不产生任何新的视觉痕迹）。
  // 注意这里返回 null 而不是"渲染一个空 span"——空 span 会让父容器的 gap/flex 布局
  // 多出一个不可见的间隔项，在 action bar 那种 space-between 行里表现为"标题莫名右移"。
  if (projectKindOf(project) !== 'agent') return null;

  return (
    <span
      // 稳定测试钩子：L4 真浏览器用例按它断言"Agent 看板详情/打印页确实标了来源"
      data-project-source-badge="agent"
      title={t('ui.agentSourceBadge.title')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-cream px-2.5 py-1',
        'text-[12px] font-medium text-pine',
        className,
      )}
    >
      <Bot size={12} aria-hidden />
      {t('ui.agentSourceBadge.text')}
    </span>
  );
}
