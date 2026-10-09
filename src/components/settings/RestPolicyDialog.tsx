import { useEffect, useMemo, useRef, useState } from 'react';

import { CalendarDays, X } from 'lucide-react';

import { ALL_REST_POLICIES, ChangxiaError, REST_POLICY_LABELS, RestPolicyKind, ScheduleBasis } from '../../core/types/enums';
import type { RestPolicyConfig } from '../../core/types/entities';
import { useRepos } from '../../hooks/useRepos';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { buildRestDayPreview, isValidAnchorWeek, isoWeekIdOf, shiftIsoWeek } from '../../lib/restPolicyDraft';
import { planRestPolicyRecalc, sameWorkdayPolicy } from '../../lib/restPolicyRecalc';
import { useHumanProjects } from '../../core/project/visibility';
import { withCnHolidays } from '../../core/holidays/policy';
import { cnHolidayYears } from '../../core/holidays';
import { dayjs } from '../../lib/date';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Modal } from '../common/Modal';
import { RestPolicyRecalcDialog } from './RestPolicyRecalcDialog';

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
 * - 单休自定义休息周几（v3 §4.3，需求方拍板「单休之后允许用户自定义单休是周几」）：
 *   单休档下出现「休息日 = 周X」七选一（0=周一…6=周日，默认 6=周日，缺省回落周日
 *   ⇒ 旧数据无迁移）；双休/大小休档隐藏。判定侧见 lib/workdays.ts isRestDay。
 * - 法定节假日开关（三档单选下方）：skipHolidays 默认 false（现状不变）。开启后由
 *   hydrate 边界（core/holidays/policy.ts）把内置节假日表合并进 extraHolidays/extraWorkdays，
 *   内置表**不落库**——草稿（saved）与落库值恒是用户手填的原始值，绝不指向 store 的
 *   effectiveRestPolicy（那会把内置日期冻结进 settings，次年数据更新即失效）；
 * - 大小休：额外渲染未来 4 周预览，每格直接是 isRestDay() 的结果（派生层 lib/restPolicyDraft.ts），
 *   并提供「从下周起对调」——锚点周位移 1 周 ⇒ 偏移奇偶翻转 ⇒ 大休周/小休周互换；
 *   预览吃 withCnHolidays(draft)（开关开着时节假日必须体现在预览格里）；
 * - 保存：settings 表 key='restPolicy' 落库 → 同步 store 镜像（刷新后由 useRepos.hydrate 读回）。
 *   影响工作日口径的字段发生变化且存在工作日制项目时，先弹 RestPolicyRecalcDialog
 *   「预览即演算」确认（见 src/components/settings/RestPolicyRecalcDialog.tsx）。
 *
 * ⚠️ 历史结论作废（v3）：本文件头曾写「已排定的阶段日期不会因切换制度而变更」——
 *   需求方 10-09 拍板**废止**：切换制度后已排阶段必须按新制度重算，产品设计见
 *   product-redesign-calendar-print-2026-10-09.md §四。
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
  const savedEffective = useSettingsStore((s) => s.effectiveRestPolicy);
  const applyToStore = useSettingsStore((s) => s.setRestPolicy);
  // projects 走 visibility 漏斗（隔离纪律：store.projects 原始读只允许在
  // visibility.ts——公司级制度作用于人类侧项目）；stages 无 kind 字段，
  // 直读是设计认可口径（isolation-guard spec 注释明示）。
  const projects = useHumanProjects();
  const stages = useProjectsStore((s) => s.stages);

  const [draft, setDraft] = useState<RestPolicyConfig>(saved);
  const [saving, setSaving] = useState(false);
  /** 制度口径发生变化且存在受影响阶段 → 打开重算确认弹窗 */
  const [recalcOpen, setRecalcOpen] = useState(false);
  /**
   * 用户是否动过草稿。动过之后 saved 的后台变化**不**冲掉未保存的编辑；
   * 未动过时 saved 一到就同步（见下方 effect）。保存成功后复位。
   */
  const dirtyRef = useRef(false);

  /**
   * 草稿同步（2026-10-09 反馈修复：选了单休周三但月历不跟随）：
   * `saved` 来自 settings 行异步 hydrate（useRepos.ts bootstrapAllStores →
   * normalizeRestPolicy），挂载瞬间可能是出厂默认——`useState(saved)` 是
   * **惰性初值**，saved  hydrate 回来后草稿不跟，于是「编辑器显示的」
   * （draft）与「实际生效的」（effectiveRestPolicy ← saved）成了两个源：
   * 用户按编辑器显示操作，月历底纹却按另一个值渲染。
   * 修法 = saved 变化且用户未编辑时同步草稿；编辑中不跟随（避免后台变化
   * 冲掉未保存的编辑）。「每次打开重置草稿」由挂载生命周期天然保证——
   * 独立弹窗与 embedded（随 SettingsDialog / zone 切换卸载）重挂时
   * useState(saved) 即取当前值，无脏值残留（范式同 ProjectAppearanceDialog）。
   */
  useEffect(() => {
    if (!dirtyRef.current) setDraft(saved);
  }, [saved]);

  /** 草稿更新统一入口：用户编辑即置脏（脏后 saved 后台变化不冲草稿） */
  const updateDraft = (updater: (prev: RestPolicyConfig) => RestPolicyConfig): void => {
    dirtyRef.current = true;
    setDraft(updater);
  };

  const todayIso = useMemo(() => dayjs().format('YYYY-MM-DD'), []);

  /** 工作日制项目（自然日制零影响——重算演算与弹窗计数同口径，§4.0） */
  const workdayInputs = useMemo(
    () =>
      projects
        .filter((p) => p.scheduleBasis === ScheduleBasis.Workday)
        .map((p) => ({
          project: p,
          stages: stages.filter((s) => s.projectId === p.id),
        })),
    [projects, stages],
  );

  /** 单休休息周几（0=周一…6=周日）；缺省/非法回落 6=周日（旧数据无迁移） */
  const restWeekday = useMemo(() => {
    const v = draft.singleRestWeekday;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6 ? v : 6;
  }, [draft.singleRestWeekday]);

  /** 切换制度：切到大小休且锚点不可用时，以本周为大休周起算 */
  const onPickKind = (kind: RestPolicyKind): void => {
    updateDraft((prev) => ({
      ...prev,
      kind,
      anchorWeek:
        kind === RestPolicyKind.BigSmallWeek && !isValidAnchorWeek(prev.anchorWeek)
          ? isoWeekIdOf(todayIso)
          : prev.anchorWeek,
    }));
  };

  const preview = useMemo(
    () =>
      draft.kind === RestPolicyKind.BigSmallWeek
        ? // 预览同样走生效口径：开关开着时，法定节假日/补班日必须体现在预览格里
          buildRestDayPreview(withCnHolidays(draft), { weeks: PREVIEW_WEEKS })
        : [],
    [draft],
  );

  const onSwap = (): void => {
    updateDraft((prev) => ({ ...prev, anchorWeek: shiftIsoWeek(prev.anchorWeek, 1, todayIso) }));
  };

  /** 直接落库（无重算路径）：先写库再更新内存镜像，失败保持原制度 */
  const persist = async (next: RestPolicyConfig): Promise<void> => {
    await repos.settings.set('restPolicy', next);
    applyToStore(next);
    // 草稿已落库（= saved）：解脏，之后 saved 的变化可继续同步
    dirtyRef.current = false;
    useProjectsStore.getState().pushToast('success', '休息制度已保存');
    // 独立弹窗保存后关闭；嵌入态只提示、留在设置面板内
    if (onClose) onClose();
  };

  const onSave = async (): Promise<void> => {
    setSaving(true);
    try {
      // 口径未变（同制度内微调/无实质差异）→ 直接保存，无需重算
      if (sameWorkdayPolicy(saved, draft)) {
        await persist(draft);
        return;
      }
      // 口径变化：先跑一遍纯函数（与弹窗「预览即演算」同一实现）。
      // 零变化（如无工作日制项目）→ 直接保存，不弹确认窗。
      const plan = planRestPolicyRecalc({
        projects: workdayInputs,
        oldPolicy: savedEffective,
        newPolicy: withCnHolidays(draft),
      });
      if (!plan.hasChanges) {
        await persist(draft);
        useProjectsStore
          .getState()
          .pushToast('success', '休息制度已保存（没有阶段需要重算）');
        return;
      }
      // 有变化 → 弹确认窗；确认后由弹窗完成「落库制度 + 应用重算」再回调关闭
      setRecalcOpen(true);
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

      {/*
        法定节假日开关（公司级/全局）。默认关 ⇒ 与上线前逐字节一致；
        开启后由 hydrate 边界把内置节假日表合并进 extraHolidays/extraWorkdays
        （用户手填优先），排期自动跳过节假日与调休补班日，月历显示节日名。
        内置表不落库——次年安排公布后随版本更新，老库不会冻着过期副本。
      */}
      <div className="mt-4 rounded-[12px] border border-line bg-cream/60 p-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={draft.skipHolidays === true}
            onChange={() =>
              updateDraft((prev) => ({ ...prev, skipHolidays: prev.skipHolidays !== true }))
            }
            className="accent-pine"
            data-testid="skip-holidays-toggle"
          />
          <span className="font-medium text-ink">跳过国家法定节假日（含调休补班日）</span>
        </label>
        <p className="mt-1.5 text-[11px] leading-relaxed text-mist">
          内置 {cnHolidayYears().join(' / ')} 年法定节假日与调休补班日安排（来源：国务院办公厅
          年度通知），次年安排公布后随版本更新。开启后仅影响新排期，已排定的阶段日期不变。
        </p>
      </div>

      {/*
        单休：自定义休息日 = 周X 七选一（v3 §4.3，需求方拍板「选择单休之后允许
        用户自定义单休是周几」）。索引 0..6 = 周一..周日（与 WEEKDAY_LABELS 同序），
        默认 6=周日（缺省回落，旧数据无迁移）。双休/大小休档隐藏。
        判定侧见 lib/workdays.ts isRestDay 的 SingleOff 分支。
      */}
      {draft.kind === RestPolicyKind.SingleOff && (
        <div
          className="mt-4 rounded-[12px] border border-line bg-cream/60 p-3"
          data-testid="single-rest-weekday"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs text-mist">
              单休休息日 = <span className="text-ink">周{WEEKDAY_LABELS[restWeekday]}</span>
              （每周只休这一天）
            </span>
            {restWeekday !== 6 && (
              <button
                type="button"
                onClick={() => updateDraft((prev) => ({ ...prev, singleRestWeekday: 6 }))}
                className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
                title="恢复出厂口径：周日休息"
              >
                恢复默认（周日）
              </button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((w, idx) => (
              <button
                key={w}
                type="button"
                data-testid={`rest-weekday-${idx}`}
                aria-pressed={restWeekday === idx}
                onClick={() => updateDraft((prev) => ({ ...prev, singleRestWeekday: idx }))}
                className={cn(
                  'flex h-8 items-center justify-center rounded-[8px] border text-xs transition-colors',
                  restWeekday === idx
                    ? 'border-pine bg-pine-soft text-ink'
                    : 'border-line text-mist hover:bg-sand hover:text-ink',
                )}
              >
                周{w}
              </button>
            ))}
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-mist">
            默认周日（与历史行为一致）。改为周内单休后，保存时可按新口径重算已排阶段。
          </p>
        </div>
      )}

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
            {draft.skipHolidays === true
              ? '灰底为休息日（已含法定节假日与调休补班日；补班日照常上班）。'
              : '灰底为休息日。未开启「跳过国家法定节假日」时，遇法定节假日请手动改期。'}
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[11px] text-mist">
          切换制度后保存时，将按新口径重算已排阶段（保存前有确认预览）。
        </span>
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

      {/*
        重算确认弹窗（v3 §4.4）：制度口径变化且存在受影响阶段时出现。
        Modal 走 createPortal 挂 body，放在本 div 内不影响布局；确认后由弹窗
        完成「落库制度 + 应用重算」，再经 onConfirmed 回调关闭外层。
      */}
      {recalcOpen && (
        <RestPolicyRecalcDialog
          draft={draft}
          oldPolicy={savedEffective}
          onClose={() => setRecalcOpen(false)}
          onConfirmed={() => {
            setRecalcOpen(false);
            // 制度已由弹窗落库、重算已应用；独立弹窗形态下随外层一起关闭
            if (onClose) onClose();
          }}
        />
      )}
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
