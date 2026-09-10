import { useEffect, useRef, useState } from 'react';

import { ChevronsUpDown } from 'lucide-react';

import { useSettingsStore } from '../../store/useSettingsStore';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { MEMBER_ROLE_LABELS } from '../../core/types/enums';
import { cn } from '../../lib/cn';

/**
 * 顶栏身份入口（v0.2 重写：不再渲染成员下拉——下拉会暴露全名单）。
 *   未进入：「点击进入」→ 按 hasAdmin 打开 admin_prompt 或 name_input；
 *   已进入：「当前身份：名字」（首字头像）+ admin 时「管理员」徽标 + 「切换/退出」。
 * 绝不展示其他成员姓名；切换/退出支持同机换人（待明确事项 7 默认允许）。
 */
export function MemberIdentityPicker(): JSX.Element {
  const { currentMember, isAdmin, isEntered, hasAdmin } = useRoleGuard();
  const openIdentityFlow = useSettingsStore((s) => s.openIdentityFlow);
  const setCurrentMember = useSettingsStore((s) => s.setCurrentMember);

  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  if (!isEntered) {
    return (
      <button
        type="button"
        onClick={() => {
          // 无管理员 → 引导确立管理员；有管理员 → 直接姓名输入
          if (hasAdmin) openIdentityFlow('name_input', false);
          else openIdentityFlow('admin_prompt', false);
        }}
        className="rounded-md border border-pine px-3 py-1.5 text-sm text-pine transition-colors hover:bg-pine-soft"
        title="点击进入身份（我的任务按此身份过滤）"
      >
        点击进入
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-line bg-paper px-2 py-1.5 text-sm shadow-soft transition-colors hover:bg-sand sm:px-3"
        title="当前身份（点击切换/退出）"
      >
        <span
          className="inline-block h-5 w-5 rounded-full text-center text-xs leading-5 text-white"
          style={{ backgroundColor: currentMember?.avatarColor ?? '#8A959E' }}
        >
          {(currentMember?.name ?? '?')[0]}
        </span>
        {/* 姓名在手机上隐藏（顶栏第一行放不下），xl 以下连管理员徽标一起收起 */}
        <span className="hidden max-w-[96px] truncate sm:inline">{currentMember?.name ?? '未知'}</span>
        {isAdmin && (
          <span className="hidden rounded-full bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine-deep xl:inline-block">
            {MEMBER_ROLE_LABELS.admin}
          </span>
        )}
        <ChevronsUpDown size={14} className="text-mist" />
      </button>

      {menuOpen && (
        <div className="glass-medium menuFadeIn absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-line py-1 shadow-soft">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setCurrentMember(null);
              // 退出后重走身份流程：无管理员走引导，否则直接姓名输入（同机换人）
              if (hasAdmin) openIdentityFlow('name_input', false);
              else openIdentityFlow('admin_prompt', false);
            }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-sand"
          >
            切换身份
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setCurrentMember(null);
            }}
            className="w-full border-t border-line px-3 py-1.5 text-left text-xs text-mist hover:bg-sand"
          >
            退出身份
          </button>
        </div>
      )}
    </div>
  );
}
