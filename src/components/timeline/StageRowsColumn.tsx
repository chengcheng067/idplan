import dayjs from 'dayjs';

import type { Member, Stage } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { remainingDays } from '../../lib/date';
import { stageSolidClass, stageSolidColor } from './stageColors';
import { customStageColor } from './stageColorKey';
import { roleLabel, useLang } from '../../i18n';
import { ROLE_SENTINELS } from '../../core/types/role-sentinel';

/**
 * 左侧锁定列（sticky）：序号圆标 / 阶段名 / 负责人 / 距截止天数。
 * v0.2 修复 + 权限矩阵 #15：
 *   - 修复旧版直接显示 ownerId raw id 的 bug；
 *   - admin 视角：负责人显示姓名（未指派 → 「未指派负责人」）；
 *   - member 视角：负责人显示角色标签（m.role 或「负责人」），不暴露其他成员姓名。
 */
export function StageRowsColumn({
  stages,
  todayIso,
  activeStageId,
  onRowClick,
  members = [],
  memberView = false,
  leftColW = 260,
}: {
  stages: Stage[];
  todayIso: string;
  activeStageId: string | null;
  onRowClick(stageId: string): void;
  members?: Member[];
  memberView?: boolean;
  leftColW?: number;
}): JSX.Element {
  /* 取词 + 订阅语言变化（负责人两态词随语言变） */
  const { t } = useLang();
  const ownerLabel = (stage: Stage): string => {
    if (!stage.ownerId) return t('stageRows.unassigned');
    const owner = members.find((m) => m.id === stage.ownerId);
    if (!owner) return t('stageRows.unknownOwner');
    /*
     * ⚠️ `'负责人'` 是 `owner.role` 这个**数据槽的兜底值**（角色值本身是落库值，
     *    如用户自填的「设计总监」，不随界面语言变）⇒ 口径是
     *    **写入/落库钉死中文原值 + 显示层取词**（裁决 2026-10-19，
     *    同 `operator_name` 一族）：值取 `ROLE_SENTINELS.owner`，
     *    显示经 `roleLabel()` 取词 —— 英文界面显示 `Owner`，库里仍是 `负责人`。
     *    ⚠️ 与上一行之上的 `'未指派负责人'` 不同：那个是**纯界面状态词**，
     *    不进任何数据槽 ⇒ 直接走消息表，不需要「钉死」。
     *    （同族的 `'未署名'` / `'协作'` 判 B 的结论不变：它们只出现在**载荷/协议**面。）
     */
    return memberView ? roleLabel(owner.role || ROLE_SENTINELS.owner) : owner.name;
  };

  return (
    <div
      className="sticky left-0 z-10 shrink-0 border-r border-line bg-cream"
      style={{ width: leftColW }}
    >
      {stages.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onRowClick(s.id)}
          className={`flex w-full items-center gap-3 border-b border-line/50 px-4 text-left transition-colors hover:bg-sand/60 ${
            s.id === activeStageId ? 'bg-sand' : ''
          }`}
          style={{ height: 44, marginBottom: 8 }}
        >
          <IndexBadge stage={s} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{s.name}</span>
            <span className="block truncate text-[11px] leading-4 text-mist">
              {ownerLabel(s)}
            </span>
          </span>
          <DueChip stage={s} todayIso={todayIso} />
        </button>
      ))}
      <div style={{ height: 0 }} />
    </div>
  );
}

function IndexBadge({ stage }: { stage: Stage }): JSX.Element {
  // 画板 04：阶段点 = 实心块（main 色，圆角 9999），仅作色相指示；
  // 序号由行序 + 阶段抽屉承载，避免「深色 main 上压白/黑字」的对比度问题。
  //
  // ── 两条通路（v0.8 A11 · ① 阶段卡色点）──
  //   · 内置 9 色：Tailwind 静态类镜像 `stageSolidClass`（禁止动态拼类名 —— BUG-05）；
  //   · 用户自定义色：内联 `var(--stage-local-solid)` **＋** `data-stage-key`。
  // 两个半件成对由 `customStageColor()` 一次给出（只写 var() 不挂属性 ⇒ 解析为空 ⇒ 色点透明）。
  // 自定义那条路**不拼任何类名**（颜色只经内联 var()），故不经过 Tailwind 扫描器。
  const { isCustom, attrs } = customStageColor(stage.customColor);
  const shape = 'inline-block h-2.5 w-2.5 shrink-0 rounded-full';
  return (
    <span
      className={isCustom ? shape : `${shape} ${stageSolidClass(stage.orderIndex)}`}
      style={
        isCustom
          ? { backgroundColor: stageSolidColor(stage.orderIndex, stage.colorIndex, stage.customColor) }
          : undefined
      }
      {...attrs}
      aria-hidden
    />
  );
}

function DueChip({ stage, todayIso }: { stage: Stage; todayIso: string }): JSX.Element | null {
  /* 取词 + 订阅语言变化（到期胶囊三态随语言变） */
  const { t } = useLang();
  if (stage.status === StageStatus.Completed) return null;
  const days = remainingDays(stage.endAt.slice(0, 10), todayIso);
  const overdue = days < 0;
  const urgent = !overdue && days <= 3;
  const cls = overdue ? 'text-clay' : urgent ? 'text-amber-deep' : 'text-mist';
  const label = overdue
    ? t('timeline.overdueDays', { n: Math.abs(days) })
    : days === 0
      ? t('timeline.dueToday')
      : t('timeline.daysCount', { n: days });
  void dayjs; // 保持单一日期入口的注释位（剩余口径在 lib/date）
  return <span className={`shrink-0 text-[11px] tabular-nums ${cls}`}>{label}</span>;
}
