import type { Member } from '../../core/types/entities';
import { ROLE_SENTINELS } from '../../core/types/role-sentinel';
import { roleLabel, useLang } from '../../i18n';

/**
 * 负责人头像叠放组：首字圆形 + 角色色底。
 * v0.2 权限矩阵 #12：maskMemberNames=true 时（成员视角），
 * title 用角色标签（m.role 或「负责人」）代替姓名——不暴露其他成员姓名。
 * v0.3 视觉修复（QA BUG-2）：+N 胶囊 mist(#b3adcc) 浅底配 cream(#0d0d0d) 深字，
 * 保证对比度 ≥4.5:1（原 ink 近白字在浅底上不可读）。
 */
export function AvatarStack({
  members,
  max = 4,
  maskMemberNames = false,
}: {
  members: Member[];
  max?: number;
  maskMemberNames?: boolean;
}): JSX.Element {
  /* 取词 + 订阅语言变化（角色标签随语言变；`roleLabel` 不是 hook，订阅靠这里） */
  useLang();
  const visible = members.slice(0, max);
  const rest = members.length - visible.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {visible.map((m) => (
          <span
            key={m.id}
            title={
              /*
               * 角色值的两处都是**展示**（title 提示），走 `roleLabel()` 取词：
               * 兜底值 `负责人` 落库是中文原值，英文界面要显示 `Owner`；
               * 用户自填的角色名（「主案设计师」）回落原文，绝不翻译。
               */
              maskMemberNames
                ? roleLabel(m.role || ROLE_SENTINELS.owner)
                : `${m.name} · ${roleLabel(m.role)}`
            }
            className="inline-block h-6 w-6 rounded-full border border-white/40 text-center text-[10px] leading-[22px] text-white"
            style={{ backgroundColor: m.avatarColor }}
          >
            {m.name[0]}
          </span>
        ))}
        {rest > 0 && (
          <span className="inline-block h-6 w-6 rounded-full border border-white/40 bg-mist text-center text-[10px] leading-[22px] text-cream">
            +{rest}
          </span>
        )}
      </div>
    </div>
  );
}
