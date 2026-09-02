import { useState } from 'react';

import { Settings } from 'lucide-react';

import { SettingsDialog } from './SettingsDialog';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';

/**
 * 顶栏「设置」入口按钮（所有角色可见，不限管理员）。
 *
 * 点击打开 SettingsDialog（右侧抽屉），承载导出日志 / 清空日志等设置项。
 * 用户反馈"导出日志按钮藏在一堆图标里找不到"——把它作为独立、带文字标签的
 * 设置入口，一眼可见；导出日志收进设置面板内。
 */
export function SettingsButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  // 仅桌面端且主进程推送过「有新版本」时为 true；浏览器/NAS 端恒为 false（不渲染徽标）
  const { status } = useUpdateCheck();
  const hasUpdate = status === 'has-update';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-sand bg-paper px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
        title="设置（导出日志 / 清空日志）"
        aria-label="设置"
      >
        <span className="relative inline-flex">
          <Settings size={14} aria-hidden />
          {hasUpdate && (
            <span
              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-clay ring-2 ring-paper"
              aria-label="有新版本可用"
            />
          )}
        </span>
        <span className="hidden 2xl:inline">设置</span>
      </button>

      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
