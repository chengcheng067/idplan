import { Moon, Sun } from 'lucide-react';

import { useTheme } from '../../hooks/useTheme';

/**
 * 亮 / 暗主题切换（Soft UI 版本）。
 *
 * 形态：rounded-full 圆形图标按钮 + 内凹底（sunken）+ hover 微微上浮并亮起主色，
 * 符合 stylekit soft-ui 的「图标一律 round-full、靠柔和投影而非描边分层」。
 *
 * 放在顶栏最右侧控件簇里（该簇所有断点都可见），因此手机 / 平板 / 桌面都能一键切换。
 */
export function ThemeToggle(): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const target = theme === 'dark' ? '亮色' : '暗色';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`切换到${target}主题`}
      title={`切换到${target}主题`}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-mist transition-all duration-base ease-in-out hover:-translate-y-0.5 hover:text-pine hover:shadow-raised soft-focus-halo"
    >
      {theme === 'dark' ? (
        <Sun size={16} aria-hidden />
      ) : (
        <Moon size={16} aria-hidden />
      )}
    </button>
  );
}
