import { X } from 'lucide-react';

import { Modal } from './Modal';
import { useLang } from '../../i18n';

/**
 * 确认对话框（基于统一的 Modal 折层底座）。
 * 底座（Modal）负责 createPortal 到 document.body、遮罩点击关闭、Escape、焦点圈禁、
 * body 滚动锁定与 z-index——彻底隔离祖先 backdrop-filter 对 fixed 定位的破坏。
 * 这里只保留确认对话框本身的语义：标题 / 正文 / 取消 / 确认（danger 变体）。
 *
 * ★ 笔 ①（i18n）：本组件是**共享组件**，它的三处界面文案曾经**硬编中文**
 *   （`confirmText = '确认'` / `cancelText = '取消'` / 关闭钮 `aria-label="关闭"`）⇒
 *   每个调用方都得「记得传参」，漏一个就在英文态**露中文**（把 bug 推给下一个人）。
 *   现在两个按钮的缺省改为**从消息表取当前语言**：**省略这两参这个用法本身**就是对的。
 *   ⚠️ 需要**恒中文**的场合（纸面 / 打印稿）⇒ 调用方**显式传参**，不要指望默认值（K6）。
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}): JSX.Element | null {
  /* 取词 + 订阅语言变化：默认值随语言走（见文件头「笔 ①」） */
  const { t } = useLang();
  const confirmLabel = confirmText ?? t('common.confirm');
  const cancelLabel = cancelText ?? t('common.cancel');
  return (
    <Modal open={open} onClose={onCancel} ariaLabel={title}>
      <div className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-2xl p-4 shadow-soft outline-none sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="font-display text-display-md">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-mist hover:bg-sand"
          >
            <X size={16} />
          </button>
        </div>
        <div className="text-sm leading-6 text-ink/80">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm text-white transition-colors ${
              danger ? 'bg-clay hover:bg-clay-deep' : 'bg-pine hover:bg-pine-deep'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
