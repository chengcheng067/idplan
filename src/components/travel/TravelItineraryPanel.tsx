import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Bus, BedDouble, Coins, Plus, Trash2, CalendarPlus, X } from 'lucide-react';

import type { ItineraryDay, Project, Task } from '../../core/types/entities';
import { resolveErrorText } from '../../core/types/enums';
import { taskIsDone } from '../../core/types/entities';
import { useRepos } from '../../hooks/useRepos';
import { createTaskActions, useProjectsStore } from '../../store/useProjectsStore';
import { dayjs } from '../../lib/date';
import { cn } from '../../lib/cn';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useLang, type InterpolationVars, type MessageKey } from '../../i18n';

/** 取词函数的形状（`filledSummary` 是模块级纯函数，取词器由调用方注入） */
type Translate = (key: MessageKey, vars?: InterpolationVars) => string;

/** 金额显示（'' 与 null 都显示破折号；汇总条与删除确认共用同一格式出口） */
function moneyText(n: number | null): string {
  return n === null ? '—' : `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

/**
 * 「该日已填」摘要（审计 F1-⑤ 的删除确认文案）。
 *
 * 为什么确认框里要复述内容：这张卡上的交通/住宿/预算/实际是**手输后没有别处可查**的
 * 记录（删掉就只剩备份里有）。用户点垃圾桶时看到的如果只是「确认删除？」，他无法判断
 * 这一下删掉的是一张空卡还是一整天已经核过的账——复述金额就是让他一眼认出来。
 * 空卡返回空串（调用方据此不渲染这一句）。
 */
function filledSummary(day: ItineraryDay, t: Translate): string {
  const parts: string[] = [];
  if (day.transport) parts.push(t('travel.summaryTransport', { value: day.transport }));
  if (day.accommodation) parts.push(t('travel.summaryAccommodation', { value: day.accommodation }));
  if (day.budgetAmount !== null) parts.push(t('travel.summaryBudget', { amount: moneyText(day.budgetAmount) }));
  if (day.actualAmount !== null) parts.push(t('travel.summaryActual', { amount: moneyText(day.actualAmount) }));
  /* 分隔符住在键里（中文顿号 / 英文逗号）—— 不在组件里硬编标点 */
  return parts.join(t('travel.summarySep'));
}

/**
 * 旅游每日行程面板（v0.9 旅游二期 · UI 唯一入口）。
 *
 * 数据规则（与底座契约一致）：
 *   - 打开时按项目起止日期 `ensureProjectDays`（只补缺失日，绝不删除旧行 —— 改期安全）；
 *   - 每日卡字段：交通 / 住宿 / 预算 / 实际（失焦或回车保存，经 repo.update 持久化）；
 *   - 任务按 `Task.itineraryDate` 归入对应日；未排日的任务在底部「待排任务池」，可一键挂到某天；
 *   - 头部汇总：总预算 / 总实际 / 差额（仅统计已填值）；
 *   - 非旅游项目不渲染本面板（由 ProjectDetailPage 按 effectiveDomainOf 门控）。
 */
export function TravelItineraryPanel({ project }: { project: Project }): JSX.Element {
  /* 取词 + 订阅语言变化（面板内全部文案随语言变） */
  const { t } = useLang();
  const repos = useRepos();
  const actions = useMemo(() => createTaskActions(repos), [repos]);
  const tasks = useProjectsStore((s) => s.tasks);
  const pushToast = useProjectsStore((s) => s.pushToast);

  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const loadGeneration = useRef(0);
  /** 行内编辑缓冲：key = `${dayId}:${field}`，空串 = 无缓冲 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 待删除的行程卡（非 null = 确认框打开）——删除不可撤销，故先停在确认框 */
  const [removeTarget, setRemoveTarget] = useState<ItineraryDay | null>(null);
  /** 确认框里那句「该日已填：…」（空卡为空串，调用方据此不渲染） */
  const removeSummary = removeTarget ? filledSummary(removeTarget, t) : '';

  const projectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === project.id),
    [tasks, project.id],
  );

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      await repos.itineraries.ensureProjectDays(
        project.id,
        project.plannedStartAt.slice(0, 10),
        project.plannedEndAt.slice(0, 10),
      );
      const nextDays = await repos.itineraries.listByProject(project.id);
      if (generation === loadGeneration.current) setDays(nextDays);
    } catch (err) {
      if (generation === loadGeneration.current) {
        pushToast('error', resolveErrorText(err, t, t('travel.loadFailed')));
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [repos, project.id, project.plannedStartAt, project.plannedEndAt, pushToast]);

  useEffect(() => {
    void reload();
    return () => {
      loadGeneration.current += 1;
    };
  }, [reload]);

  const saveField = async (day: ItineraryDay, field: 'transport' | 'accommodation' | 'budgetAmount' | 'actualAmount', raw: string): Promise<void> => {
    const value = field === 'transport' || field === 'accommodation'
      ? (raw.trim() === '' ? null : raw.trim())
      : (raw.trim() === '' ? null : Number(raw));
    if (value !== null && typeof value === 'number' && !Number.isFinite(value)) return;
    try {
      const next = await repos.itineraries.update(day.id, { [field]: value });
      setDays((prev) => prev.map((d) => (d.id === next.id ? next : d)));
    } catch {
      pushToast('error', t('travel.saveFailed'));
    }
  };

  const assignTask = async (taskId: string, date: string | null): Promise<void> => {
    /*
     * ⚠️ `'我'` **不翻**（B）：它是 `actions.updateTask(..., operatorName)` 的
     *    **operatorName ⇒ 会被写进任务流水**（与 `'当前用户'` / `'负责人'` 同族的落库值）。
     *    翻它 = 往库里写英文操作人，历史留痕会随界面语言分叉 —— 这是本笔最容易误翻的一处。
     */
    await actions.updateTask(taskId, { itineraryDate: date }, '我');
  };

  const addManualDay = async (): Promise<void> => {
    const last = days[days.length - 1];
    const baseDate = last?.date ?? project.plannedEndAt?.slice(0, 10);
    if (!baseDate || !dayjs(baseDate).isValid()) {
      pushToast('error', t('travel.invalidEndDate'));
      return;
    }
    const nextDate = dayjs(baseDate).add(1, 'day').format('YYYY-MM-DD');
    try {
      const row = await repos.itineraries.insert({ projectId: project.id, date: nextDate });
      setDays((prev) => [...prev, row].sort((a, b) => a.date.localeCompare(b.date)));
    } catch (err) {
      pushToast('error', resolveErrorText(err, t, t('travel.addDayFailed', { date: nextDate })));
    }
  };

  /**
   * ★ 删除行程卡（审计 F1-⑤）：**先确认、再落库、失败要说**。
   *
   * 缺陷原文：按钮点一下就 `await repos.itineraries.remove(day.id)` ——
   *   ① 无二次确认（同仓 danger 操作都走 ConfirmDialog，如 ProjectCard 的归档/删除）；
   *   ② 无 try/catch：写库失败时 Promise 静默 reject、`setDays` 不执行，
   *      界面**连一条 toast 都没有**，用户看到「点了没反应」，会以为是自己没点中。
   * 两句都按既有范式补齐：确认框照抄 ProjectCard.tsx 的 danger 变体，
   * 失败反馈照抄同文件 `saveField`（:76-78）的 pushToast。
   */
  const removeDay = async (day: ItineraryDay): Promise<void> => {
    const attached = projectTasks.filter((task) => task.itineraryDate === day.date);
    if (attached.length > 0) {
      pushToast('error', t('travel.dayHasTasks'));
      return;
    }
    try {
      await repos.itineraries.remove(day.id);
      setDays((prev) => prev.filter((d) => d.id !== day.id));
    } catch {
      pushToast('error', t('travel.removeFailed'));
    }
  };


  const totalBudget = days.reduce((a, d) => a + (d.budgetAmount ?? 0), 0);
  const totalActual = days.reduce((a, d) => a + (d.actualAmount ?? 0), 0);
  const hasAnyAmount = days.some((d) => d.budgetAmount !== null || d.actualAmount !== null);

  const unassigned = projectTasks.filter((task) => !task.itineraryDate);

  if (loading) {
    return (
      <div className="glass-medium rounded-lg border border-line p-6 text-sm text-mist" data-testid="travel-itinerary-loading">
        {t('travel.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="travel-itinerary-panel">
      {/* 汇总条 */}
      <div className="glass-medium flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line px-4 py-3 text-sm shadow-soft">
        <span className="font-display text-display-sm">{t('travel.title')}</span>
        <span className="text-mist">{t('travel.totalDays', { n: days.length })}</span>
        {hasAnyAmount && (
          <>
            <span className="flex items-center gap-1.5">
              <Coins size={14} className="text-mist" aria-hidden /> {t('travel.budget')}{' '}
              <b className="text-ink">{moneyText(totalBudget)}</b>
            </span>
            <span>
              {t('travel.actual')} <b className="text-ink">{moneyText(totalActual)}</b>
            </span>
            <span className={cn(totalActual > totalBudget ? 'text-clay' : 'text-pine')}>
              {t('travel.diff')} <b>{moneyText(totalBudget - totalActual)}</b>
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist hover:bg-sand"
            title={t('travel.syncTitle')}
          >
            <CalendarPlus size={13} className="mr-1 inline" aria-hidden />
            {t('travel.sync')}
          </button>
          <button
            type="button"
            onClick={() => void addManualDay()}
            className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist hover:bg-sand"
            title={t('travel.addDayTitle')}
          >
            <Plus size={13} className="mr-1 inline" aria-hidden />
            {t('travel.addDay')}
          </button>
        </span>
      </div>

      {/* 每日卡 */}
      {days.map((day, idx) => {
        const dayTasks = projectTasks.filter((task) => task.itineraryDate === day.date);
        const isToday = day.date === dayjs().format('YYYY-MM-DD');
        return (
          <div
            key={day.id}
            data-testid={`itinerary-day-${day.date}`}
            className={cn(
              'rounded-lg border bg-paper p-4 shadow-raised',
              isToday ? 'border-pine' : 'border-line',
            )}
          >
            <div className="mb-2.5 flex items-center gap-2">
              <span className="rounded-full bg-pine-soft/60 px-2 py-0.5 text-xs font-semibold text-pine">
                {t('travel.dayIndex', { n: idx + 1 })}
              </span>
              <span className="text-sm font-semibold text-ink">{day.date}</span>
              {isToday && <span className="text-xs text-pine">{t('travel.today')}</span>}
              <button
                type="button"
                /* ★ 语言无关定位钩子（笔 3-E）：aria 已走消息表（`travel.removeDayAria`），
                   英文态形如 `Delete the day card of 2026-10-01` —— 拿「删除 … 行程卡」当选择器的
                   会静默失配。取「这一天的删除钮」请用本钩子（外层已有 data-testid 定位到当天卡）。 */
                data-itinerary-remove=""
                aria-label={t('travel.removeDayAria', { date: day.date })}
                onClick={() => setRemoveTarget(day)}
                disabled={dayTasks.length > 0}
                className="ml-auto rounded-md p-1 text-mist hover:bg-sand disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-mist">
                  <Bus size={12} aria-hidden /> {t('travel.fieldTransport')}
                </span>
                <input
                  type="text"
                  defaultValue={day.transport ?? ''}
                  aria-label={t('travel.fieldTransportAria', { date: day.date })}
                  onChange={(e) => setDrafts((p) => ({ ...p, [`${day.id}:transport`]: e.target.value }))}
                  onBlur={(e) => {
                    if (drafts[`${day.id}:transport`] !== undefined) void saveField(day, 'transport', e.target.value);
                  }}
                  placeholder={t('travel.fieldTransportPlaceholder')}
                  className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-mist">
                  <BedDouble size={12} aria-hidden /> {t('travel.fieldAccommodation')}
                </span>
                <input
                  type="text"
                  defaultValue={day.accommodation ?? ''}
                  aria-label={t('travel.fieldAccommodationAria', { date: day.date })}
                  onChange={(e) => setDrafts((p) => ({ ...p, [`${day.id}:accommodation`]: e.target.value }))}
                  onBlur={(e) => {
                    if (drafts[`${day.id}:accommodation`] !== undefined) void saveField(day, 'accommodation', e.target.value);
                  }}
                  placeholder={t('travel.fieldAccommodationPlaceholder')}
                  className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-mist">
                  <Coins size={12} aria-hidden /> {t('travel.budget')}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={day.budgetAmount ?? ''}
                  aria-label={t('travel.fieldBudgetAria', { date: day.date })}
                  onChange={(e) => setDrafts((p) => ({ ...p, [`${day.id}:budgetAmount`]: e.target.value }))}
                  onBlur={(e) => {
                    if (drafts[`${day.id}:budgetAmount`] !== undefined) void saveField(day, 'budgetAmount', e.target.value);
                  }}
                  placeholder="0.00"
                  className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-mist">
                  <Coins size={12} aria-hidden /> {t('travel.actual')}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={day.actualAmount ?? ''}
                  aria-label={t('travel.fieldActualAria', { date: day.date })}
                  onChange={(e) => setDrafts((p) => ({ ...p, [`${day.id}:actualAmount`]: e.target.value }))}
                  onBlur={(e) => {
                    if (drafts[`${day.id}:actualAmount`] !== undefined) void saveField(day, 'actualAmount', e.target.value);
                  }}
                  placeholder="0.00"
                  className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
                />
              </label>
            </div>

            {/* 当日任务 */}
            {dayTasks.length > 0 && (
              <ul className="mt-2.5 space-y-1 border-t border-line pt-2.5" data-testid={`itinerary-tasks-${day.date}`}>
                {dayTasks.map((task) => (
                  <ItineraryTaskRow
                    key={task.id}
                    task={task}
                    onDetach={() => void assignTask(task.id, null)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* 待排任务池 */}
      {unassigned.length > 0 && (
        <div className="rounded-lg border border-dashed border-line bg-cream/40 p-4" data-testid="itinerary-unassigned">
          <p className="mb-2 text-xs font-medium text-mist">{t('travel.unassignedTitle')}</p>
          <ul className="space-y-1.5">
            {unassigned.map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-sm">
                <span className={cn('min-w-0 flex-1 truncate', taskIsDone(task) && 'text-mist line-through')}>
                  {task.title}
                </span>
                <select
                  aria-label={t('travel.assignAria', { title: task.title })}
                  value=""
                  onChange={(e) => {
                    const date = e.target.value;
                    if (date) void assignTask(task.id, date);
                  }}
                  className="rounded-md border border-line bg-cream px-2 py-1 text-xs text-ink outline-none focus:border-pine"
                >
                  <option value="">{t('travel.assignPlaceholder')}</option>
                  {days.map((d) => (
                    <option key={d.id} value={d.date}>{d.date}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        ★ 删除行程卡确认（审计 F1-⑤）：danger 变体，照抄 ProjectCard.tsx:592-605 的形态。
        文案复述该日已填内容（filledSummary）——那几张手输的金额/交通/住宿删掉后
        除了备份没有别处可查，用户必须在点下去之前看清自己删的是什么。
        onConfirm 里的 `void removeDay(...)` 走的是同一条落库路径（失败会 toast）。
      */}
      <ConfirmDialog
        open={removeTarget !== null}
        title={t('travel.removeDialogTitle')}
        confirmText={t('travel.removeDialogConfirm')}
        danger
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) void removeDay(target);
        }}
        onCancel={() => setRemoveTarget(null)}
      >
        {t('travel.removeDialogBody', { date: removeTarget?.date ?? '' })}
        {removeSummary && <> {t('travel.removeDialogFilled', { summary: removeSummary })}</>}
        <br />
        <span className="font-medium text-clay">{t('travel.removeDialogIrreversible')}</span>
        {t('travel.removeDialogNote')}
      </ConfirmDialog>
    </div>
  );
}

function ItineraryTaskRow({ task, onDetach }: { task: Task; onDetach(): void }): JSX.Element {
  /* 取词 + 订阅语言变化（本模块级组件自己订阅） */
  const { t } = useLang();
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={cn('min-w-0 flex-1 truncate', taskIsDone(task) && 'text-mist line-through')}>{task.title}</span>
      <button
        type="button"
        onClick={onDetach}
        aria-label={t('travel.detachAria', { title: task.title })}
        className="rounded-md p-1 text-mist hover:bg-sand"
        title={t('travel.detachTitle')}
      >
        <X size={13} aria-hidden />
      </button>
    </li>
  );
}
