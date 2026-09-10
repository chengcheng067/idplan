import { useMemo, useState } from 'react';

import { CalendarDays, X } from 'lucide-react';

import { ALL_REST_POLICIES, ChangxiaError, REST_POLICY_LABELS, RestPolicyKind } from '../../core/types/enums';
import type { RestPolicyConfig } from '../../core/types/entities';
import { useRepos } from '../../hooks/useRepos';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { buildRestDayPreview, isValidAnchorWeek, isoWeekIdOf, shiftIsoWeek } from '../../lib/restPolicyDraft';
import { dayjs } from '../../lib/date';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Modal } from '../common/Modal';

/** ISO 周行首为周一 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 大小休预览周数（设置弹窗「未来 4 周」） */
const PREVIEW_WEEKS = 4;

/**
 * 顶栏「休息制度」入口（仅管理员渲染，权限体例同 SaveBackupButton.tsx:19）。
 * 点击打开 RestPolicyDialog。
 */
export function RestPolicySettingsButton(): JSX.Element | null {
  const { isAdmin } = useRoleGuard();
  const [open, setOpen] = useState(false);

  // 权限联动：成员视角不渲染入口（公司级设置，只对管理员开放）
  if (!isAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
        title="公司休息制度（双休 / 单休 / 大小休）"
      >
        <CalendarDays size={14} /> <span className="hidden 2xl:inline">休息制度</span>
      </button>
      {open && <RestPolicyDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * 公司休息制度编辑区（可嵌入）。
 *
 * 抽出编辑主体，供两种入口复用：
 *   - 独立弹窗 RestPolicyDialog（顶栏/移动端菜单 → 完整 Modal）
 *   - 设置面板 SettingsDialog 内联「休息制度」区（embedded，不套独立 Modal）
 *
 * - 三档单选：文案与遍历顺序全部取自 REST_POLICY_LABELS / ALL_REST_POLICIES（唯一文案源，铁律 7）；
 * - 大小休：额外渲染未来 4 周预览，每格直接是 isRestDay() 的结果（派生层 lib/restPolicyDraft.ts），
 *   并提供「从下周起对调」——锚点周位移 1 周 ⇒ 偏移奇偶翻转 ⇒ 大休周/小休周互换；
 * - 保存：settings 表 key='restPolicy' 落库 → 同步 store 镜像（刷新后由 useRepos.hydrate 读回）。
 *
 * 已排定的阶段日期不会因切换制度而变更（九阶段日期是建档时写死的绝对值）。
 *
 * @param onClose 独立弹窗关闭回调；embedded 时不传（保存后不关闭外层设置面板）。
 * @param embedded 是否为嵌入态（隐藏「取消」、保存后不关闭外层）。
 */
export function RestPolicyEditor({
  onClose,
  embedded = false,
}: {
  onClose?(): void;
  embedded?: boolean;
}): JSX.Element {
  const repos = useRepos();
  const saved = useSettingsStore((s) => s.restPolicy);
  const applyToStore = useSettingsStore((s) => s.setRestPolicy);

  const [draft, setDraft] = useState<RestPolicyConfig>(saved);
  const [saving, setSaving] = useState(false);

  const todayIso = useMemo(() => dayjs().format('YYYY-MM-DD'), []);

  /** 切换制度：切到大小休且锚点不可用时，以本周为大休周起算 */
  const onPickKind = (kind: RestPolicyKind): void => {
    setDraft((prev) => ({
      ...prev,
      kind,
      anchorWeek:
        kind === RestPolicyKind.BigSmallWeek && !isValidAnchorWeek(prev.anchorWeek)
          ? isoWeekIdOf(todayIso)
          : prev.anchorWeek,
    }));
  };

  const preview = useMemo(
    () => (draft.kind === RestPolicyKind.BigSmallWeek ? buildRestDayPreview(draft, { weeks: PREVIEW_WEEKS }) : []),
    [draft],
  );

  const onSwap = (): void => {
    setDraft((prev) => ({ ...prev, anchorWeek: shiftIsoWeek(prev.anchorWeek, 1, todayIso) }));
  };

  const onSave = async (): Promise<void> => {
    setSaving(true);
    try {
      // 先落库再更新内存镜像：写库失败时界面保持原制度，不出现「看起来改了其实没存」
      await repos.settings.set('restPolicy', draft);
      applyToStore(draft);
      useProjectsStore.getState().pushToast('success', '休息制度已保存');
      // 独立弹窗保存后关闭；嵌入态只提示、留在设置面板内
      if (onClose) onClose();
    } catch (err) {
      useProjectsStore
        .getState()
        .pushToast('error', err instanceof ChangxiaError ? err.userMessage : '休息制度保存失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-mist">
        决定全系统哪些天是工作日（月历底纹、时间轴休息条带、改期吸附与工期口径）。
      </p>

      {/* 三档单选：遍历 ALL_REST_POLICIES，文案取 REST_POLICY_LABELS */}
      <div className="space-y-2">
        {ALL_REST_POLICIES.map((kind) => {
          const active = draft.kind === kind;
          return (
            <label
              key={kind}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'border-pine bg-pine-soft text-ink'
                  : 'border-line text-mist hover:bg-sand hover:text-ink',
              )}
            >
              <input
                type="radio"
                name="rest-policy-kind"
                value={kind}
                checked={active}
                onChange={() => onPickKind(kind)}
                className="accent-pine"
              />
              <span className="font-medium">{REST_POLICY_LABELS[kind]}</span>
            </label>
          );
        })}
      </div>

      {/* 大小休：未来 4 周预览 + 对调 */}
      {draft.kind === RestPolicyKind.BigSmallWeek && (
        <div className="mt-4 rounded-[12px] border border-line bg-cream/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs text-mist">
              未来 {PREVIEW_WEEKS} 周预览 · 锚点周{' '}
              <span className="text-ink">{draft.anchorWeek ?? '未设置'}</span>（大休周）
            </span>
            <button
              type="button"
              onClick={onSwap}
              className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
              title="把锚点周整体位移一周，大小休对调"
            >
              从下周起对调
            </button>
          </div>

          <div className="space-y-1">
            <div className="grid grid-cols-[44px_repeat(7,1fr)] gap-1">
              <span />
              {WEEKDAY_LABELS.map((w) => (
                <span key={w} className="text-center text-[10px] text-mist">
                  {w}
                </span>
              ))}
            </div>

            {preview.map((week) => (
              <div key={week.monday} className="grid grid-cols-[44px_repeat(7,1fr)] gap-1">
                <span
                  className={cn(
                    'flex items-center text-[10px]',
                    week.bigWeek ? 'text-pine' : 'text-mist',
                  )}
                >
                  {week.bigWeek ? '大休' : '小休'}
                </span>
                {week.days.map((d) => (
                  <span
                    key={d.date}
                    title={d.rest ? `${d.date} 休息` : `${d.date} 上班`}
                    className={cn(
                      'flex h-7 items-center justify-center rounded-[6px] text-[11px]',
                      d.rest ? 'bg-rest-day text-mist' : 'border border-line text-ink',
                    )}
                  >
                    {d.day}
                  </span>
                ))}
              </div>
            ))}
          </div>

          <p className="mt-2 text-[11px] text-mist">
            灰底为休息日。周一至周五不含法定节假日调休，遇法定节假日请手动改期。
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[11px] text-mist">已排定的阶段日期不会因切换制度自动变更。</span>
        <div className="flex gap-2">
          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              取消
            </button>
          )}
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm text-white transition-colors',
              saving ? 'bg-pine-soft text-mist' : 'bg-pine hover:bg-pine-deep',
            )}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 公司休息制度设置弹窗（T6）——独立入口包装。
 * 仅承载 Modal + 标题/关闭，编辑主体委托 RestPolicyEditor。
 */
export function RestPolicyDialog({ onClose }: { onClose(): void }): JSX.Element {
  return (
    <Modal open onClose={onClose} ariaLabel="公司休息制度">
      <div className="glass-strong iridescent-border dialog-pop flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl shadow-soft">
        {/* 描边挂在外层固定框；滚动交给内层，避免虹彩描边伪元素随内容断层露线 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-display-md text-ink">公司休息制度</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>

          <RestPolicyEditor onClose={onClose} />
        </div>
      </div>
    </Modal>
  );
}
