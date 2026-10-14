import { useState } from 'react';

import { FileDown } from 'lucide-react';

import { createLogExportIo, type LogExportIo } from './useLogExport';
import { useProjectsStore } from '../../store/useProjectsStore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useLang } from '../../i18n';

/**
 * 「导出日志」按钮（顶栏 · 所有角色可用，调试友好）。
 *
 * 定位：当客户/成员遇到"输入法打不出字""界面异常"这类**前端**问题时，
 * 原生后端日志无从记录——导出本地运行日志发给开发即可定位。
 *
 * 行为：无日志 → toast 提示；有日志 → 二次确认（告知仅运行记录+错误堆栈，
 * 不含项目业务数据）→ 导出 .log 文件。
 */
export function ExportLogButton({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const { t } = useLang();
  const io: LogExportIo = createLogExportIo();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [count, setCount] = useState(0);

  const toast = (kind: 'info' | 'success' | 'error', message: string): void => {
    useProjectsStore.getState().pushToast(kind, message);
  };

  const onClick = (): void => {
    const n = io.count();
    if (n === 0) {
      toast('info', t('ui.logExport.empty'));
      return;
    }
    setCount(n);
    setConfirmOpen(true);
  };

  const onConfirm = (): void => {
    setConfirmOpen(false);
    io.export();
    toast('success', t('settings.log.toastExported', { count }));
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
        title={t('ui.logExport.titleAttr')}
      >
        <FileDown size={14} />
        {!compact && <span className="hidden 2xl:inline">{t('settings.log.export')}</span>}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title={t('settings.log.export')}
        confirmText={t('ui.logExport.confirmAction')}
        onConfirm={onConfirm}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>
          {t('ui.logExport.confirmPre')}
          <strong>{count}</strong>
          {t('ui.logExport.confirmMid')}
        </p>
        <p className="mt-2 text-xs text-mist">{t('ui.logExport.confirmNote')}</p>
      </ConfirmDialog>
    </>
  );
}
