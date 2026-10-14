import { useEffect, useMemo, useRef, useState } from 'react';

import { CalendarDays, X } from 'lucide-react';

import { ALL_REST_POLICIES, ChangxiaError, RestPolicyKind, ScheduleBasis } from '../../core/types/enums';
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
import {
  restPolicyLabel,
  useLang,
  weekdayFullLabel,
  weekdayShortLabel,
  WEEKDAY_FULL_KEYS,
} from '../../i18n';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Modal } from '../common/Modal';
import { RestPolicyRecalcDialog } from './RestPolicyRecalcDialog';

/*
 * ★ 2026-10-13 中英切换：这里原本有一张本地 `WEEKDAY_LABELS`（一~日）与
 * 对 `REST_POLICY_LABELS` 的直接引用。两张表的文案都已搬进
 * src/i18n/messages/{zh,en}.ts，本文件在渲染期用 weekdayFullLabel(idx) /
 * weekdayShortLabel(idx) / restPolicyLabel(kind) 取词（序号 0..6 = 周一..周日）。
 * ⇒ 本文件不再持有任何文案表，也不再直接 import core/types 的标签表。
 *
 * ★ 2026-10-14（笔 1-⑤）本文件**其余文案**也改走 `t()`（键前缀 `restPolicy.`）：
 *   · 组件里 `const { t } = useLang()`（`useLang()` 同时是语言变化的订阅点）；
 *   · 事件回调里的 toast 直接取当时语言；
 *   · 日期标签那几处是 `title` 模板（`{date} 休息` / `{date} 上班`）。
 *   ⚠️ `restPolicy.single.lead` 的 zh 取值**结尾带一个空格**：原文是
 *     `单休休息日 = <span>…</span>`，那个空格是 JSXText 的**尾随空格**（真实渲染字符，
 *     不是排版）⇒ 必须逐字带进取值，否则中文态会从「单休休息日 = 周日」变成
 *     「单休休息日 =周日」。`restPolicy.double.lead` / `preview.lead` 则**不带**尾随空格：
 *     原文那里是 `双休休息日 ={' '}`，空格由 JSX 里的 `{' '}` 出（两处形状**不同，别统一**）。
 */

/** 大小休预览周数（设置弹窗「未来 4 周」） */
const PREVIEW_WEEKS = 4;

/**
 * 顶栏「休息制度」入口（仅管理员渲染，权限体例同 SaveBackupButton.tsx:19）。
 * 点击打开 RestPolicyDialog。
 */
export function RestPolicySettingsButton(): JSX.Element | null {
  const { t } = useLang();
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
        title={t('restPolicy.entryTitle')}
      >
        <CalendarDays size={14} />{' '}
        <span className="hidden 2xl:inline">{t('settings.section.restPolicy')}</span>
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
 * - 三档单选：文案取自 i18n（restPolicyLabel），遍历顺序取自 ALL_REST_POLICIES（铁律 7）；
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
  // 订阅语言变化：档位与星期文案由 restPolicyLabel() / weekdayFullLabel() 在渲染期取，
  // 少了这个订阅，切语言时本编辑器会停在旧语言。`t` 同时供本文件其余文案使用。
  const { t } = useLang();
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

  /**
   * 双休的两个休息日（§4.6 多选）。缺省/非法回落 [5,6] 周六+周日；
   * 归一为「合法值 + 升序」的数组（编辑瞬态可短至 1 天，见 toggleDoubleDay）。
   */
  const doubleDays = useMemo(() => {
    const v = draft.doubleRestWeekdays;
    if (!Array.isArray(v)) return [5, 6];
    const clean = v
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    return clean.length > 0 ? clean : [5, 6];
  }, [draft.doubleRestWeekdays]);
  /** 双休必须选满两天才准保存（1 天 = 编辑瞬态，0 天 = 全年无休是数据事故） */
  const doubleComplete = doubleDays.length === 2;
  const isDefaultDoubleDays = doubleComplete && doubleDays[0] === 5 && doubleDays[1] === 6;

  /**
   * 双休多选交互（§4.6）：点未选 = 加入（满两天忽略）；点已选 = 取消
   * （至少保留一天——取消到 0 天等于全年无休，绝非用户所求）。连续两天与
   * 分开两天都允许（集合无序语义，升序归一后存盘）。
   */
  const toggleDoubleDay = (idx: number): void => {
    updateDraft((prev) => {
      const cur = Array.isArray(prev.doubleRestWeekdays)
        ? prev.doubleRestWeekdays
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
            .sort((a, b) => a - b)
        : [5, 6];
      if (cur.includes(idx)) {
        if (cur.length <= 1) return prev; // 最后一个不取消
        return { ...prev, doubleRestWeekdays: cur.filter((d) => d !== idx) };
      }
      if (cur.length >= 2) return prev; // 满两天忽略
      return { ...prev, doubleRestWeekdays: [...cur, idx].sort((a, b) => a - b) };
    });
  };

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
    useProjectsStore.getState().pushToast('success', t('restPolicy.toast.saved'));
    // 独立弹窗保存后关闭；嵌入态只提示、留在设置面板内
    if (onClose) onClose();
  };

  const onSave = async (): Promise<void> => {
    // 双休未选满两天 ⇒ 拒存（1 天是编辑瞬态；双休语义 = 一周休两天）
    if (draft.kind === RestPolicyKind.DoubleOff && !doubleComplete) {
      useProjectsStore.getState().pushToast('error', t('restPolicy.err.doubleIncomplete'));
      return;
    }
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
          .pushToast('success', t('restPolicy.toast.savedNoRecalc'));
        return;
      }
      // 有变化 → 弹确认窗；确认后由弹窗完成「落库制度 + 应用重算」再回调关闭
      setRecalcOpen(true);
    } catch (err) {
      useProjectsStore
        .getState()
        .pushToast('error', err instanceof ChangxiaError ? err.userMessage : t('restPolicy.err.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-mist">{t('restPolicy.intro')}</p>

      {/* 三档单选：遍历 ALL_REST_POLICIES，文案走 i18n（restPolicyLabel） */}
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
              <span className="font-medium">{restPolicyLabel(kind)}</span>
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
          <span className="font-medium text-ink">{t('restPolicy.holidays.label')}</span>
        </label>
        <p className="mt-1.5 text-[11px] leading-relaxed text-mist">
          {t('restPolicy.holidays.note', { years: cnHolidayYears().join(' / ') })}
        </p>
      </div>

      {/*
        单休：自定义休息日 = 周X 七选一（v3 §4.3，需求方拍板「选择单休之后允许
        用户自定义单休是周几」）。索引 0..6 = 周一..周日（与 WEEKDAY_FULL_KEYS 同序），
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
              {t('restPolicy.single.lead')}
              <span className="text-ink">{weekdayFullLabel(restWeekday)}</span>
              {t('restPolicy.single.tail')}
            </span>
            {restWeekday !== 6 && (
              <button
                type="button"
                onClick={() => updateDraft((prev) => ({ ...prev, singleRestWeekday: 6 }))}
                className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
                title={t('restPolicy.single.restoreTitle')}
              >
                {t('restPolicy.single.restore')}
              </button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_FULL_KEYS.map((k, idx) => (
              <button
                key={k}
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
                {weekdayFullLabel(idx)}
              </button>
            ))}
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-mist">
            {t('restPolicy.single.note')}
          </p>
        </div>
      )}

      {/*
        双休：自定义两个休息日 = 周A + 周B 多选（v3 §4.6，需求方拍板「双休在
        周内的连续两天，还是分开的（比如休星期六和星期一）」）。索引 0..6 =
        周一..周日（与 WEEKDAY_FULL_KEYS 同序），缺省 = [5,6] 周六+周日（旧数据
        无迁移）。交互：点未选=加入（满两天忽略）；点已选=取消（至少留一天）。
        判定侧见 lib/workdays.ts isRestDay 的 DoubleOff 分支。
      */}
      {draft.kind === RestPolicyKind.DoubleOff && (
        <div
          className="mt-4 rounded-[12px] border border-line bg-cream/60 p-3"
          data-testid="double-rest-weekdays"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs text-mist">
              {t('restPolicy.double.lead')}{' '}
              <span className="text-ink">
                {doubleDays.map((d) => weekdayFullLabel(d)).join(' + ')}
              </span>
              {t('restPolicy.double.tail', {
                days: doubleComplete
                  ? t('restPolicy.double.twoDays')
                  : t('restPolicy.double.oneDay'),
              })}
            </span>
            {!isDefaultDoubleDays && (
              <button
                type="button"
                onClick={() => updateDraft((prev) => ({ ...prev, doubleRestWeekdays: undefined }))}
                data-testid="double-rest-restore"
                className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
                title={t('restPolicy.double.restoreTitle')}
              >
                {t('restPolicy.double.restore')}
              </button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_FULL_KEYS.map((k, idx) => (
              <button
                key={k}
                type="button"
                data-testid={`double-rest-day-${idx}`}
                aria-pressed={doubleDays.includes(idx)}
                onClick={() => toggleDoubleDay(idx)}
                className={cn(
                  'flex h-8 items-center justify-center rounded-[8px] border text-xs transition-colors',
                  doubleDays.includes(idx)
                    ? 'border-pine bg-pine-soft text-ink'
                    : 'border-line text-mist hover:bg-sand hover:text-ink',
                )}
              >
                {weekdayFullLabel(idx)}
              </button>
            ))}
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-mist">
            {t('restPolicy.double.note')}
          </p>
          {!doubleComplete && (
            <p className="mt-1 text-[11px] font-medium text-clay" data-testid="double-rest-incomplete">
              {t('restPolicy.err.doubleIncomplete')}
            </p>
          )}
        </div>
      )}

      {/* 大小休：未来 4 周预览 + 对调 */}
      {draft.kind === RestPolicyKind.BigSmallWeek && (
        <div className="mt-4 rounded-[12px] border border-line bg-cream/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs text-mist">
              {t('restPolicy.preview.lead', { weeks: PREVIEW_WEEKS })}{' '}
              <span className="text-ink">
                {draft.anchorWeek ?? t('restPolicy.preview.unset')}
              </span>
              {t('restPolicy.preview.tail')}
            </span>
            <button
              type="button"
              onClick={onSwap}
              className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
              title={t('restPolicy.preview.swapTitle')}
            >
              {t('restPolicy.preview.swap')}
            </button>
          </div>

          <div className="space-y-1">
            <div className="grid grid-cols-[44px_repeat(7,1fr)] gap-1">
              <span />
              {WEEKDAY_FULL_KEYS.map((k, i) => (
                <span key={k} className="text-center text-[10px] text-mist">
                  {weekdayShortLabel(i)}
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
                  {week.bigWeek ? t('restPolicy.bigWeek') : t('restPolicy.smallWeek')}
                </span>
                {week.days.map((d) => (
                  <span
                    key={d.date}
                    title={
                      d.rest
                        ? t('restPolicy.dayRest', { date: d.date })
                        : t('restPolicy.dayWork', { date: d.date })
                    }
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
              ? t('restPolicy.preview.legendOn')
              : t('restPolicy.preview.legendOff')}
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[11px] text-mist">{t('restPolicy.footer.note')}</span>
        <div className="flex gap-2">
          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving || (draft.kind === RestPolicyKind.DoubleOff && !doubleComplete)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm text-white transition-colors',
              saving ? 'bg-pine-soft text-mist' : 'bg-pine hover:bg-pine-deep',
            )}
          >
            {saving ? t('restPolicy.saving') : t('common.save')}
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
  const { t } = useLang();
  return (
    <Modal open onClose={onClose} ariaLabel={t('restPolicy.dialogAria')}>
      <div className="glass-strong iridescent-border dialog-pop flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl shadow-soft">
        {/* 描边挂在外层固定框；滚动交给内层，避免虹彩描边伪元素随内容断层露线 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-display-md text-ink">{t('restPolicy.dialogTitle')}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
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
