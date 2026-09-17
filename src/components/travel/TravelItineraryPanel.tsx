import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Bus, BedDouble, Coins, Plus, Trash2, CalendarPlus, X } from 'lucide-react';

import type { ItineraryDay, Project, Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { useRepos } from '../../hooks/useRepos';
import { createTaskActions, useProjectsStore } from '../../store/useProjectsStore';
import { dayjs } from '../../lib/date';
import { cn } from '../../lib/cn';

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
  const repos = useRepos();
  const actions = useMemo(() => createTaskActions(repos), [repos]);
  const tasks = useProjectsStore((s) => s.tasks);
  const pushToast = useProjectsStore((s) => s.pushToast);

  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const loadGeneration = useRef(0);
  /** 行内编辑缓冲：key = `${dayId}:${field}`，空串 = 无缓冲 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === project.id),
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
        pushToast('error', err instanceof Error && 'userMessage' in err
          ? String((err as { userMessage: unknown }).userMessage)
          : '每日行程加载失败。');
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
      pushToast('error', '保存失败，请重试。');
    }
  };

  const assignTask = async (taskId: string, date: string | null): Promise<void> => {
    await actions.updateTask(taskId, { itineraryDate: date }, '我');
  };

  const addManualDay = async (): Promise<void> => {
    const last = days[days.length - 1];
    const baseDate = last?.date ?? project.plannedEndAt?.slice(0, 10);
    if (!baseDate || !dayjs(baseDate).isValid()) {
      pushToast('error', '请先设置有效的项目结束日期。');
      return;
    }
    const nextDate = dayjs(baseDate).add(1, 'day').format('YYYY-MM-DD');
    try {
      const row = await repos.itineraries.insert({ projectId: project.id, date: nextDate });
      setDays((prev) => [...prev, row].sort((a, b) => a.date.localeCompare(b.date)));
    } catch (err) {
      pushToast('error', err instanceof Error && 'userMessage' in err
        ? String((err as { userMessage: unknown }).userMessage)
        : `无法新增 ${nextDate} 的每日行程卡。`);
    }
  };

  const removeDay = async (day: ItineraryDay): Promise<void> => {
    const attached = projectTasks.filter((t) => t.itineraryDate === day.date);
    if (attached.length > 0) {
      pushToast('error', '该日还有任务，请先移走或删除任务。');
      return;
    }
    await repos.itineraries.remove(day.id);
    setDays((prev) => prev.filter((d) => d.id !== day.id));
  };

  const fmtMoney = (n: number | null): string =>
    n === null ? '—' : `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

  const totalBudget = days.reduce((a, d) => a + (d.budgetAmount ?? 0), 0);
  const totalActual = days.reduce((a, d) => a + (d.actualAmount ?? 0), 0);
  const hasAnyAmount = days.some((d) => d.budgetAmount !== null || d.actualAmount !== null);

  const unassigned = projectTasks.filter((t) => !t.itineraryDate);

  if (loading) {
    return (
      <div className="glass-medium rounded-lg border border-line p-6 text-sm text-mist" data-testid="travel-itinerary-loading">
        正在生成每日行程…
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="travel-itinerary-panel">
      {/* 汇总条 */}
      <div className="glass-medium flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line px-4 py-3 text-sm shadow-soft">
        <span className="font-display text-display-sm">每日行程</span>
        <span className="text-mist">共 {days.length} 天</span>
        {hasAnyAmount && (
          <>
            <span className="flex items-center gap-1.5">
              <Coins size={14} className="text-mist" aria-hidden /> 预算 <b className="text-ink">{fmtMoney(totalBudget)}</b>
            </span>
            <span>实际 <b className="text-ink">{fmtMoney(totalActual)}</b></span>
            <span className={cn(totalActual > totalBudget ? 'text-clay' : 'text-pine')}>
              差额 <b>{fmtMoney(totalBudget - totalActual)}</b>
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist hover:bg-sand"
            title="按当前项目起止日期补齐缺失日期卡（只补不删）"
          >
            <CalendarPlus size={13} className="mr-1 inline" aria-hidden />同步日期
          </button>
          <button
            type="button"
            onClick={() => void addManualDay()}
            className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist hover:bg-sand"
            title="追加一天（最后一天之后）"
          >
            <Plus size={13} className="mr-1 inline" aria-hidden />加一天
          </button>
        </span>
      </div>

      {/* 每日卡 */}
      {days.map((day, idx) => {
        const dayTasks = projectTasks.filter((t) => t.itineraryDate === day.date);
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
                第 {idx + 1} 天
              </span>
              <span className="text-sm font-semibold text-ink">{day.date}</span>
              {isToday && <span className="text-xs text-pine">· 今天</span>}
              <button
                type="button"
                aria-label={`删除 ${day.date} 行程卡`}
                onClick={() => void removeDay(day)}
                disabled={dayTasks.length > 0}
                className="ml-auto rounded-md p-1 text-mist hover:bg-sand disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-mist">
                  <Bus size={12} aria-hidden /> 交通
                </span>
                <input
                  type="text"
                  defaultValue={day.transport ?? ''}
                  aria-label={`${day.date} 交通`}
                  onChange={(e) => setDrafts((p) => ({ ...p, [`${day.id}:transport`]: e.target.value }))}
                  onBlur={(e) => {
                    if (drafts[`${day.id}:transport`] !== undefined) void saveField(day, 'transport', e.target.value);
                  }}
                  placeholder="如 高铁 G1234 / 市内打车"
                  className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-mist">
                  <BedDouble size={12} aria-hidden /> 住宿
                </span>
                <input
                  type="text"
                  defaultValue={day.accommodation ?? ''}
                  aria-label={`${day.date} 住宿`}
                  onChange={(e) => setDrafts((p) => ({ ...p, [`${day.id}:accommodation`]: e.target.value }))}
                  onBlur={(e) => {
                    if (drafts[`${day.id}:accommodation`] !== undefined) void saveField(day, 'accommodation', e.target.value);
                  }}
                  placeholder="如 XX 酒店 · 大床房"
                  className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-mist">
                  <Coins size={12} aria-hidden /> 预算
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={day.budgetAmount ?? ''}
                  aria-label={`${day.date} 预算金额`}
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
                  <Coins size={12} aria-hidden /> 实际
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={day.actualAmount ?? ''}
                  aria-label={`${day.date} 实际金额`}
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
                {dayTasks.map((t) => (
                  <ItineraryTaskRow key={t.id} task={t} onDetach={() => void assignTask(t.id, null)} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* 待排任务池 */}
      {unassigned.length > 0 && (
        <div className="rounded-lg border border-dashed border-line bg-cream/40 p-4" data-testid="itinerary-unassigned">
          <p className="mb-2 text-xs font-medium text-mist">待排任务（未挂到某一天）</p>
          <ul className="space-y-1.5">
            {unassigned.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className={cn('min-w-0 flex-1 truncate', taskIsDone(t) && 'text-mist line-through')}>{t.title}</span>
                <select
                  aria-label={`将「${t.title}」排入某天`}
                  value=""
                  onChange={(e) => {
                    const date = e.target.value;
                    if (date) void assignTask(t.id, date);
                  }}
                  className="rounded-md border border-line bg-cream px-2 py-1 text-xs text-ink outline-none focus:border-pine"
                >
                  <option value="">排入…</option>
                  {days.map((d) => (
                    <option key={d.id} value={d.date}>{d.date}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItineraryTaskRow({ task, onDetach }: { task: Task; onDetach(): void }): JSX.Element {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={cn('min-w-0 flex-1 truncate', taskIsDone(task) && 'text-mist line-through')}>{task.title}</span>
      <button
        type="button"
        onClick={onDetach}
        aria-label={`将「${task.title}」移出当日行程`}
        className="rounded-md p-1 text-mist hover:bg-sand"
        title="移出当日行程"
      >
        <X size={13} aria-hidden />
      </button>
    </li>
  );
}
