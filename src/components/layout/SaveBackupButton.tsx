import { Save } from 'lucide-react';

import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useBackupIo } from './useBackupIo';

/**
 * 顶栏「保存备份」独立按钮（v0.3 变更 D：备份下拉拆分后新增）。
 * 点击直接导出：exportAll() → downloadBackup() → toast「备份包已保存」。
 * 无二次确认、无 loading 圈（铁律 11）；仅管理员渲染（备份含全部数据，成员不得导出）。
 * v0.4：导出逻辑下沉到 useBackupIo，与移动端「更多」菜单共用同一份实现。
 * 文字标签在 2xl 以下隐藏（顶栏在 1280～1535 之间放不下三条带文字的备份按钮）。
 */
export function SaveBackupButton(): JSX.Element | null {
  const { isAdmin } = useRoleGuard();
  const { save } = useBackupIo();

  // 权限联动（D-4）：成员不渲染备份入口
  if (!isAdmin) return null;

  return (
    <button
      type="button"
      onClick={() => void save()}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
      title="导出 JSON 备份包（含全部项目、成员与记录）"
    >
      <Save size={14} /> <span className="hidden 2xl:inline">保存备份</span>
    </button>
  );
}
