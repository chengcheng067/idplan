import { useMemo, useState } from 'react';

import { AlertTriangle, X } from 'lucide-react';

import type { BatchReschedule } from './TimelineView';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useMembersStore } from '../../store/useMembersStore';
import { createProjectActions } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { Modal } from '../common/Modal';
import { ImeInput, ImeTextarea } from '../common/ImeInput';

/**
 * 延期原因弹窗（PRD 硬规则 1）：
 *   delta > 0（截止日后移）→ 原因必填，空则保存按钮 disabled；
 *   delta ≤ 0（提前/平移）→ 原因选填。
 * v0.5 新增磁吸联动：支持批量改期，统一填写一次原因后逐个落库留痕。
 */
export function RescheduleDialog({
  batch,
  onClose,
}: {
  batch: BatchReschedule;
  onClose(): void;
}): JSX.Element {
  const repos = useRepos();
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const members = useMembersStore((s) => s.members);
  const operatorName =
    members.find((m) => m.id === currentMemberId)?.name ?? '当前用户';

  const primary = batch.items[batch.primaryIndex];
  const postponed = useMemo(
    () => batch.items.some((it) => new Date(it.newEndAt).getTime() > new Date(it.oldEndAt).getTime()),
    [batch.items],
  );
  const shiftedCount = batch.items.length;

  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 任一阶段延后且原因为空 → 保存按钮 disabled（弹回逻辑）
  const canSave = !postponed || reason.trim().length > 0;

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setSubmitting(true);
    const actions = createProjectActions(repos);
    const trimmedReason = reason.trim() || null;
    let failed = 0;
    for (const it of batch.items) {
      const ok = await actions.rescheduleStage(it.stageId, {
        newStartAt: `${it.newStartAt}T00:00:00Z`,
        newEndAt: `${it.newEndAt}T23:59:59Z`,
        reason: trimmedReason,
        operatorName,
      });
      if (!ok) failed++;
    }
    setSubmitting(false);
    if (failed === 0) {
      onClose();
    } else {
      setError(`保存被拒绝：${failed} 个阶段改期失败，请检查延期原因后重试。`);
    }
  };

  return (
    <Modal open onClose={onClose} ariaLabel="改期确认">
      <div className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-2xl p-5 shadow-soft">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="flex items-center gap-2 font-display text-display-md">
            {postponed && <AlertTriangle size={18} className="text-clay" />}
            改期确认{shiftedCount > 1 ? ` · ${primary.stageName} 等 ${shiftedCount} 个阶段` : ` · ${primary.stageName}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="取消改期"
            className="rounded-md p-1 text-mist hover:bg-sand"
          >
            <X size={16} />
          </button>
        </div>

        {/* 批量改期列表（最多显示 5 行，超出滚动） */}
        <div className="mb-4 max-h-40 overflow-y-auto rounded-md border border-line bg-cream/50 p-2 text-sm">
          {batch.items.map((it) => {
            const isPostponed = new Date(it.newEndAt).getTime() > new Date(it.oldEndAt).getTime();
            return (
              <div
                key={it.stageId}
                className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line/40 py-1.5 last:border-b-0"
              >
                <span className="truncate text-ink">{it.stageName}</span>
                <span className="tabular-nums text-mist">
                  {it.oldEndAt} → <b className={isPostponed ? 'text-clay' : 'text-pine-deep'}>{it.newEndAt}</b>
                </span>
              </div>
            );
          })}
        </div>

        {postponed ? (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                延期原因 <span className="text-clay">*（任一阶段截止日后移必填）</span>
              </span>
              <ImeTextarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="如：甲方确认延迟 / 审批排队…"
                className="w-full resize-y rounded-md border border-line p-2 text-sm leading-6 outline-none focus:border-pine"
                autoFocus
              />
            </label>
            {!canSave && (
              <p className="mt-1 text-xs text-clay">未填写延期原因前无法保存（历史将完整留痕）。</p>
            )}
          </>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">备注原因（提前/平移可留空）</span>
            <ImeInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-line px-2 py-1.5 text-sm outline-none focus:border-pine"
            />
          </label>
        )}

        {error && <p className="mt-2 text-xs leading-5 text-clay">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-mist hover:bg-sand"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSave || submitting}
            onClick={() => void submit()}
            className="rounded-md bg-pine px-4 py-1.5 text-sm text-white hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {shiftedCount > 1 ? `保存 ${shiftedCount} 个阶段并留痕` : '保存并留痕'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
