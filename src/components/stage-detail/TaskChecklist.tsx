import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Check, Plus, Trash2, Users, X } from 'lucide-react';

import type { Member, Stage, Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { createTaskActions } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { useRoleGuard, canMemberToggleTask, taskAssigneeIds } from '../../hooks/useRoleGuard';
import { ImeInput } from '../common/ImeInput';

/**
 * checkbox 清单：增删改 / 多选指派（多人参与）/ 截止日 / 勾选完成（勾选写指派流水留痕）。
 * v0.2 权限矩阵（成员只读化）：
 *   #8  隐藏指派控件，只读展示参与人标签（不暴露其他成员姓名）；
 *   #9  参与人可勾选（v0.3：taskAssigneeIds 包含语义），其余 checkbox disabled；
 *   #10 成员只读：隐藏新增/删除按钮、标题 input 只读、截止日只读；
 *       管理员保持既有全部能力。
 * v0.3 变更 C（多人参与）：
 *   - admin 点击行内「指派」按钮 → 玻璃浮层（glass-medium + menuFadeIn）多选参与人；
 *   - 勾选即加入/移除，浮层实时显示已选胶囊；「确定」保存
 *     { assigneeIds: 选中集合, assigneeId: 选中集合[0] ?? null }（第一参与人=主负责人，兼容旧展示）；
 *   - 未勾选任何人 = 未指派（assigneeIds=[], assigneeId=null）；
 *   - 成员视角：只读展示参与人标签（多值，脱敏 m.role || '负责人'）；
 *   - 集合变化写集合级 Change 流水（memberId=null，见 useProjectsStore.updateTask）。
 */
export function TaskChecklist({
  stage,
  tasks,
  members,
}: {
  stage: Stage;
  tasks: Task[];
  members: Member[];
}): JSX.Element {
  const repos = useRepos();
  const { isAdmin, currentMember } = useRoleGuard();
  const isMember = !isAdmin;
  const meId = currentMember?.id ?? null;
  const operatorName = currentMember?.name ?? '设计师本人';

  const actions = createTaskActions(repos);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  // 多选指派浮层：当前打开浮层的任务 id + 草稿选中集合（未点确定不落库、不写流水）
  const [assignOpenId, setAssignOpenId] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  // 指派浮层锚点（视口坐标）：fixed 定位，脱离抽屉 overflow-y-auto 裁剪与 glass-light 堆叠上下文
  const [assignAnchor, setAssignAnchor] = useState<{ top: number; right: number } | null>(null);

  const activeMembers = members.filter((m) => m.active);

  const memberOf = (id: string): Member | undefined => members.find((x) => x.id === id);

  /** admin 视角参与人摘要（多值姓名，未指派 → 空串） */
  const assigneeSummary = (t: Task): string =>
    taskAssigneeIds(t)
      .map((id) => memberOf(id)?.name ?? '未知')
      .join('、');

  /** 成员视角参与人标签（多值，脱敏：用角色标签代替姓名） */
  const assigneeLabelMulti = (t: Task): string => {
    const ids = taskAssigneeIds(t);
    if (ids.length === 0) return '未指派';
    return ids
      .map((id) => {
        const m = memberOf(id);
        if (!m) return '未知';
        return isMember ? m.role || '负责人' : m.name;
      })
      .join('、');
  };

  const openAssign = (t: Task, trigger: HTMLElement): void => {
    setDraftIds(taskAssigneeIds(t));
    setAssignOpenId(t.id);
    const rect = trigger.getBoundingClientRect();
    // fixed 定位：top=按钮底边+8px，right 对齐按钮右缘（弹层浮在视口最顶层，不被任务行穿透）
    setAssignAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  };

  const closeAssign = (): void => {
    setAssignOpenId(null);
    setAssignAnchor(null);
  };

  // 抽屉滚动（overflow-y-auto 容器）/ 窗口缩放时关闭浮层，避免 fixed 坐标与触发按钮错位
  useEffect(() => {
    if (!assignOpenId) return;
    const onScroll = (e: Event): void => {
      // 弹层内部（成员列表 max-h-48 overflow-y-auto）滚动不关闭弹层，否则滚动选人会误关；
      // 仅忽略 Element 目标（页面级滚动 e.target 为 document，无 closest，属外部滚动应关闭）。
      const target = e.target;
      if (target instanceof Element && target.closest('[data-assign-popover]')) return;
      closeAssign();
    };
    const onResize = (): void => closeAssign();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [assignOpenId]);

  const toggleDraft = (id: string): void => {
    setDraftIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  /** 确定保存：assigneeIds=选中集合，assigneeId=第一参与人 ?? null */
  const saveAssign = (t: Task): void => {
    void actions.updateTask(
      t.id,
      { assigneeIds: draftIds, assigneeId: draftIds[0] ?? null },
      operatorName,
    );
    closeAssign();
  };

  return (
    <div>
      <ul className="space-y-1.5">
        {tasks.map((t) => {
          const canToggle = isAdmin || canMemberToggleTask(meId, t);
          return (
            <li
              key={t.id}
              className="glass-light group flex items-center gap-2 rounded-lg border border-sand bg-paper px-3 py-2 transition-colors hover:bg-sand/40"
            >
              <button
                type="button"
                aria-label={taskIsDone(t) ? '标记未完成' : '标记完成'}
                disabled={!canToggle}
                onClick={() => void actions.toggleDone(t, operatorName)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  taskIsDone(t)
                    ? 'border-pine bg-pine text-white'
                    : 'border-mist/50 text-transparent hover:border-pine'
                } ${canToggle ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
              >
                <Check size={12} />
              </button>

              <ImeInput
                value={t.title}
                readOnly={isMember}
                onChange={(e) => void actions.updateTask(t.id, { title: e.target.value })}
                className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${
                  taskIsDone(t) ? 'text-mist line-through' : 'text-ink'
                } ${isMember ? 'cursor-default' : ''}`}
              />

              {isMember ? (
                <span
                  className="shrink-0 rounded-md bg-sand/60 px-2 py-0.5 text-xs text-mist"
                  title={t.assigneeId ? `主负责人：${memberOf(t.assigneeId)?.name ?? '未知'}` : undefined}
                >
                  {assigneeLabelMulti(t)}
                </span>
              ) : (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={(e) => openAssign(t, e.currentTarget)}
                    className={`inline-flex max-w-[180px] items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-xs transition-colors ${
                      taskAssigneeIds(t).length > 0
                        ? 'border-pine/40 text-pine hover:border-pine hover:bg-pine-soft'
                        : 'border-sand text-mist hover:border-pine hover:text-pine'
                    }`}
                    title="指派参与人（多选）"
                  >
                    <Users size={12} className="shrink-0" />
                    <span className="truncate">{assigneeSummary(t) || '未指派'}</span>
                  </button>

                  {assignOpenId === t.id &&
                    createPortal(
                      <div
                        data-assign-popover
                        className="bg-paper menuFadeIn fixed z-[65] w-64 rounded-lg border border-sand p-2 shadow-soft"
                        style={{ top: assignAnchor?.top ?? 0, right: assignAnchor?.right ?? 0 }}
                      >
                        <p className="mb-1.5 px-1 text-xs font-medium text-ink">指派参与人（可多选）</p>
                      <div className="max-h-48 space-y-0.5 overflow-y-auto">
                        {activeMembers.length === 0 && (
                          <p className="px-1 py-2 text-xs text-mist">还没有成员，请先在首页添加成员。</p>
                        )}
                        {activeMembers.map((m) => {
                          const checked = draftIds.includes(m.id);
                          return (
                            <label
                              key={m.id}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-sand/60"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDraft(m.id)}
                                className="h-3.5 w-3.5 accent-pine"
                              />
                              <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                              <span className="text-[10px] text-mist">{m.role}</span>
                            </label>
                          );
                        })}
                      </div>

                      {draftIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1 border-t border-sand/60 pt-2">
                          {draftIds.map((id) => {
                            const m = memberOf(id);
                            if (!m) return null;
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded-full bg-pine-soft px-2 py-0.5 text-[11px] text-pine-deep"
                              >
                                {m.name}
                                <button
                                  type="button"
                                  onClick={() => toggleDraft(id)}
                                  aria-label={`移除 ${m.name}`}
                                  className="rounded-full p-0.5 hover:bg-pine/20"
                                >
                                  <X size={10} />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <div className="mt-2 flex justify-end gap-1.5 border-t border-sand/60 pt-2">
                        <button
                          type="button"
                          onClick={() => closeAssign()}
                          className="rounded-md border border-sand px-2 py-1 text-xs text-mist transition-colors hover:bg-sand"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => saveAssign(t)}
                          className="rounded-md bg-pine px-2.5 py-1 text-xs text-white transition-colors hover:bg-pine-deep"
                        >
                          确定
                        </button>
                      </div>
                      </div>,
                      document.body,
                    )}
                </div>
              )}

              <input
                type="date"
                value={t.dueDate?.slice(0, 10) ?? ''}
                readOnly={isMember}
                onChange={(e) => void actions.updateTask(t.id, { dueDate: e.target.value || null })}
                className={`w-[120px] shrink-0 rounded-md border border-transparent px-1 py-0.5 text-xs tabular-nums text-mist hover:border-sand focus:border-pine focus:bg-paper focus:outline-none ${
                  isMember ? 'cursor-default' : ''
                }`}
              />

              {!isMember && (
                <button
                  type="button"
                  onClick={() => void actions.removeTask(t.id)}
                  aria-label="删除条目"
                  className="shrink-0 rounded-md p-1 text-mist opacity-0 transition-opacity hover:text-clay group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* 新增条目（成员只读：隐藏） */}
      {!isMember &&
        (adding ? (
          <div className="mt-2 flex items-center gap-2">
            <ImeInput
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTitle.trim()) {
                  void actions.addTask(stage, newTitle.trim(), null);
                  setNewTitle('');
                  setAdding(false);
                }
                if (e.key === 'Escape') setAdding(false);
              }}
              placeholder="条目标题，回车确认"
              className="flex-1 rounded-md border border-pine bg-paper px-3 py-1.5 text-sm outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-mist/40 px-3 py-1.5 text-xs text-mist hover:border-pine hover:text-pine"
          >
            <Plus size={12} /> 添加条目
          </button>
        ))}
    </div>
  );
}
