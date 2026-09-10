import { Upload } from 'lucide-react';

import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useBackupIo } from './useBackupIo';

/**
 * 顶栏「加载备份」独立按钮（v0.3 变更 D：备份下拉拆分后新增）。
 * 流程：点击触发隐藏 file input → 选文件 → JSON.parse → validateBackupJson 预检
 *   （失败 toast「备份文件校验失败，未做任何改动」，零写入）→ ConfirmDialog danger 二次确认
 *   （"恢复将整体替换当前全部数据且不可撤销，建议先导出留档"）→ importAndReplace → reload。
 * v0.4：流程下沉到 useBackupIo，与移动端「更多」菜单共用同一份实现。
 * 文字标签在 2xl 以下隐藏（理由同 SaveBackupButton）。
 */
export function LoadBackupButton(): JSX.Element | null {
  const { isAdmin } = useRoleGuard();
  const { pick, fileInput, confirmDialog } = useBackupIo();

  // 权限联动（D-4）：成员不渲染备份入口
  if (!isAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={pick}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
        title="从 JSON 备份包恢复（整体替换当前全部数据）"
      >
        <Upload size={14} /> <span className="hidden 2xl:inline">加载备份</span>
      </button>
      {fileInput}
      {confirmDialog}
    </>
  );
}
