import { useState } from 'react';

import { FileDown } from 'lucide-react';

import { createLogExportIo, type LogExportIo } from './useLogExport';
import { useProjectsStore } from '../../store/useProjectsStore';
import { ConfirmDialog } from '../common/ConfirmDialog';

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
  const io: LogExportIo = createLogExportIo();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [count, setCount] = useState(0);

  const toast = (kind: 'info' | 'success' | 'error', message: string): void => {
    useProjectsStore.getState().pushToast(kind, message);
  };

  const onClick = (): void => {
    const n = io.count();
    if (n === 0) {
      toast('info', '暂无日志，先正常使用后再导出');
      return;
    }
    setCount(n);
    setConfirmOpen(true);
  };

  const onConfirm = (): void => {
    setConfirmOpen(false);
    io.export();
    toast('success', `日志已导出（${count} 条）`);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
        title="导出前端日志（仅本地运行记录与错误堆栈，不含项目业务数据）"
      >
        <FileDown size={14} />
        {!compact && <span className="hidden 2xl:inline">导出日志</span>}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="导出日志"
        confirmText="导出"
        onConfirm={onConfirm}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>
          将导出 <strong>{count}</strong> 条前端日志（运行事件 + 错误堆栈），保存为 .log 文件。
        </p>
        <p className="mt-2 text-xs text-mist">
          日志仅含本地运行记录与错误堆栈，不含项目/客户业务数据，可放心发给开发排查。
        </p>
      </ConfirmDialog>
    </>
  );
}
