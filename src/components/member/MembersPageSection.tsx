import { useEffect, useState } from 'react';

import { Plus, UserRound, UserX, Crown, XCircle, Pencil, Check, X, KeyRound } from 'lucide-react';

import { memberHasPassword, type Member } from '../../core/types/entities';
import { ChangxiaError, MemberActorKind, MemberRoleKind } from '../../core/types/enums';
import { useMembersStore } from '../../store/useMembersStore';
import { createMemberActions } from '../../store/useMembersStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { useRoleGuard, countActiveAdmins } from '../../hooks/useRoleGuard';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { ImeInput } from '../common/ImeInput';

/**
 * 成员管理区（首页内嵌）：列表 / 新增 / 重命名 / 停用 / 设管理员 / 取消管理员。
 * v0.2：仅管理员视角出现（HomePage 已按 isAdmin 双保险渲染）。
 * v0.4.1：新增「重命名」入口——成员名字可随时修改，避免首字头像与实际姓名长期不一致。
 */
export function MembersPageSection(): JSX.Element | null {
  const repos = useRepos();
  const members = useMembersStore((s) => s.members);
  const { isAdmin } = useRoleGuard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [contact, setContact] = useState('');
  // v0.6 · T13：新建成员「类型」（人 / Agent）与 agentKind（开放字符串）
  const [actorKind, setActorKind] = useState<'human' | 'agent'>('human');
  const [agentKind, setAgentKind] = useState('');
  // PRD IN-03：成员列表默认隐藏 Agent，显式开关才展示（既有指派逻辑零回归）
  const [showAgents, setShowAgents] = useState(false);
  const [demoteTarget, setDemoteTarget] = useState<Member | null>(null);
  /** v0.6 密码系统：正在设/清密码的成员（弹 PasswordDialog） */
  const [passwordMember, setPasswordMember] = useState<Member | null>(null);

  const actions = createMemberActions(repos);

  // 受控例外：头像底色 hex（仅此场景允许，来源集中在模板常量）
  const AVATAR_COLORS = ['#3D6B5B', '#D9A441', '#C4553B', '#7E97A8', '#A99BB5', '#2C3E50'];
  const submit = async (): Promise<void> => {
    if (!name.trim()) return;
    await actions.create({
      name: name.trim(),
      role: role.trim() || '协作',
      contact: contact.trim() || null,
      avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
      actorKind: actorKind === 'agent' ? MemberActorKind.Agent : undefined,
      // 开放字符串直传，不校验取值（禁封闭枚举——Harness 迭代极快）
      agentKind: actorKind === 'agent' ? agentKind.trim() || 'unknown' : null,
    });
    setName('');
    setRole('');
    setContact('');
    setAgentKind('');
    setActorKind('human');
    setAdding(false);
  };

  /** active 管理员计数（唯一管理员保护） */
  const activeAdminCount = countActiveAdmins(members);

  /** Agent 席位已用数（B5：只展示不拦截） */
  const agentSeatUsed = members.filter((m) => m.actorKind === 'agent').length;

  /** 列表渲染集：默认隐藏 Agent（PRD IN-03） */
  const visibleMembers = showAgents ? members : members.filter((m) => m.actorKind !== 'agent');

  /** 重命名：为空或不变时不调用；失败由 actions.update 内部 toast */
  const onRename = async (id: string, newName: string): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await actions.update(id, { name: trimmed });
  };

  /** 降级确认回调：双保险 */
  const onDemote = async (m: Member): Promise<void> => {
    setDemoteTarget(null);
    const fresh = useMembersStore.getState().members;
    if (
      countActiveAdmins(fresh) === 1 &&
      fresh.some((x) => x.id === m.id && x.active && x.roleKind === MemberRoleKind.Admin)
    ) {
      useProjectsStore.getState().pushToast('error', '系统至少需要一名管理员，无法降级');
      return;
    }
    try {
      const updated = await repos.members.update(m.id, { roleKind: MemberRoleKind.Member });
      useMembersStore.getState().upsert(updated);
      useProjectsStore.getState().pushToast('success', '已取消管理员身份');
    } catch (err) {
      useProjectsStore
        .getState()
        .pushToast('error', err instanceof ChangxiaError ? err.userMessage : '降级失败，请重试。');
    }
  };

  // 双保险：即便被误渲染也不暴露成员管理
  if (!isAdmin) return null;

  return (
    <section className="glass-light rounded-lg border border-line bg-paper p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-display-md">成员</h2>
        <div className="flex items-center gap-2">
          {agentSeatUsed > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-mist">
              <input
                type="checkbox"
                checked={showAgents}
                onChange={(e) => setShowAgents(e.target.checked)}
                className="h-3.5 w-3.5 accent-pine"
              />
              显示 Agent（{agentSeatUsed}/3）
            </label>
          )}
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs text-mist hover:bg-sand hover:text-pine"
            >
              <Plus size={13} /> 添加成员
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-pine/40 bg-cream p-3 md:grid-cols-[1fr_120px_160px_auto]">
          {/* 类型切换（v0.6 · T13 要点 6）：人 / Agent */}
          <div className="flex items-center gap-1.5 md:col-span-4">
            <span className="text-xs text-mist">类型</span>
            {(['human', 'agent'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setActorKind(k)}
                aria-pressed={actorKind === k}
                className={
                  'rounded-md border px-2.5 py-1 text-xs transition-colors ' +
                  (actorKind === k
                    ? 'border-pine bg-pine text-white'
                    : 'border-line text-mist hover:bg-sand hover:text-ink')
                }
              >
                {k === 'human' ? '👤 人' : '🤖 Agent'}
              </button>
            ))}
            {actorKind === 'agent' && (
              <span className="ml-2 text-[11px] text-amber">
                Agent 席位 已用 {agentSeatUsed}/3（超额仅提示，不拦截）
              </span>
            )}
          </div>
          <ImeInput
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="姓名 *"
            className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-pine"
          />
          <ImeInput
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="角色（角色（如负责人））"
            className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-pine"
          />
          <ImeInput
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="联系方式"
            className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-pine"
          />
          {actorKind === 'agent' && (
            <>
              <ImeInput
                value={agentKind}
                onChange={(e) => setAgentKind(e.target.value)}
                list="agent-kind-suggestions"
                placeholder="agentKind（如 workbuddy / codex）"
                className="rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-sm outline-none focus:border-pine"
              />
              {/* 建议值仅供参考选择，输入框始终允许任意字符串（开放字符串铁律） */}
              <datalist id="agent-kind-suggestions">
                <option value="workbuddy" />
                <option value="deepseek-harness" />
                <option value="codex" />
              </datalist>
            </>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            className="rounded-md bg-pine px-4 py-1.5 text-sm text-white hover:bg-pine-deep"
          >
            添加
          </button>
        </div>
      )}

      {visibleMembers.length === 0 ? (
        <p className="text-sm leading-6 text-mist">
          还没有成员。添加后可在阶段清单中指派任务，并在顶栏输入姓名进入「我的任务」。
        </p>
      ) : (
        <ul className="divide-y divide-sand/60">
          {visibleMembers.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isLastAdmin={
                m.active && m.roleKind === MemberRoleKind.Admin && activeAdminCount === 1
              }
              onToggle={() => void actions.setActive(m.id, !m.active)}
              onPromote={() => void actions.update(m.id, { roleKind: MemberRoleKind.Admin })}
              onDemote={() => setDemoteTarget(m)}
              onRename={(name) => void onRename(m.id, name)}
              onPassword={() => setPasswordMember(m)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={demoteTarget !== null}
        title="取消管理员"
        danger
        confirmText="确认降级"
        onConfirm={() => void (demoteTarget && onDemote(demoteTarget))}
        onCancel={() => setDemoteTarget(null)}
      >
        <p>
          将 <b>{demoteTarget?.name ?? ''}</b> 降级为普通成员：该成员将立即失去管理员权限，
          只能看到分派给自己的内容。
        </p>
      </ConfirmDialog>

      {/* v0.6 密码：设置 / 修改 / 清除成员密码 */}
      {passwordMember && (
        <PasswordDialog
          member={passwordMember}
          onClose={() => setPasswordMember(null)}
        />
      )}
    </section>
  );
}

/** 密码设置弹窗：设置/修改成员密码，或清除（管理员决定成员可有无密码） */
function PasswordDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose(): void;
}): JSX.Element {
  const repos = useRepos();
  const actions = createMemberActions(repos);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  // 走 memberHasPassword：remote 模式服务端不下发哈希，passwordHash 恒为 null
  const hasPassword = memberHasPassword(member);

  const save = async (): Promise<void> => {
    if (busy) return;
    const trimmed = value.trim();
    // 保留原密码：未输入新密码则不改动（点「清除密码」才清除）
    if (!trimmed) {
      useProjectsStore.getState().pushToast('error', '请先输入新密码，或用「清除密码」移除。');
      return;
    }
    setBusy(true);
    try {
      await actions.setPassword(member.id, trimmed);
      useProjectsStore.getState().pushToast('success', `已设置「${member.name}」的登录密码`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await actions.setPassword(member.id, '');
      useProjectsStore.getState().pushToast('success', '已清除该成员密码');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} ariaLabel="设置密码">
      <div className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-2xl p-5 shadow-soft outline-none">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="font-display text-display-md">
            {hasPassword ? `修改「${member.name}」的密码` : `设置「${member.name}」的密码`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-mist hover:bg-sand"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs leading-5 text-mist">
          {hasPassword
            ? '输入新密码可重置；不做任何输入并点「清除密码」则该成员无需密码即可进入。'
            : '设置密码后，该成员需在「输入姓名」后凭密码登录。留空并点「清除密码」则无需密码。'}
        </p>
        <ImeInput
          autoFocus
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="输入新密码（留空则不修改）"
          disabled={busy}
          autoComplete="new-password"
          className="mt-4 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
        />
        <div className="mt-5 flex justify-between gap-2">
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy || !hasPassword}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-clay transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-40"
          >
            清除密码
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {hasPassword ? '保存新密码' : '设置密码'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function MemberRow({
  member,
  isLastAdmin,
  onToggle,
  onPromote,
  onDemote,
  onRename,
  onPassword,
}: {
  member: Member;
  isLastAdmin: boolean;
  onToggle(): void;
  onPromote(): void;
  onDemote(): void;
  onRename(name: string): void;
  onPassword(): void;
}): JSX.Element {
  const isAdminMember = member.roleKind === MemberRoleKind.Admin;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(member.name);

  // 外部同步（如其他窗口/逻辑改了名字）
  useEffect(() => {
    setEditName(member.name);
  }, [member.name]);

  const save = (): void => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== member.name) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  const cancel = (): void => {
    setEditing(false);
    setEditName(member.name);
  };

  return (
    <li className="flex flex-wrap items-center gap-2 py-2 sm:gap-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-white"
        style={{ backgroundColor: member.avatarColor }}
      >
        {member.name[0]}
      </span>

      {editing ? (
        <>
          <ImeInput
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') cancel();
            }}
            placeholder="姓名"
            className="min-w-0 flex-1 rounded-md border border-pine/50 bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-pine"
          />
          <button
            type="button"
            onClick={save}
            title="保存"
            className="inline-flex items-center gap-1 rounded-md border border-pine bg-pine-soft px-2 py-1 text-xs text-pine-deep hover:bg-pine/20"
          >
            <Check size={12} /> 保存
          </button>
          <button
            type="button"
            onClick={cancel}
            title="取消"
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-mist hover:bg-sand"
          >
            <X size={12} /> 取消
          </button>
        </>
      ) : (
        <>
          <span className={`text-sm ${member.active ? 'text-ink' : 'text-mist'}`}>{member.name}</span>
          {member.actorKind === 'agent' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine-deep">
              <span aria-hidden>🤖</span>
              <span className="font-mono">{member.agentKind ?? 'agent'}</span>
            </span>
          )}
          <span className="text-xs text-mist">{member.role}</span>
          {memberHasPassword(member) ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sand px-1.5 py-0.5 text-[10px] font-medium text-mist">
              <KeyRound size={10} /> 有密码
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-sand/60 px-1.5 py-0.5 text-[10px] text-mist">
              <KeyRound size={10} /> 无密码
            </span>
          )}
          {isAdminMember && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine-deep">
              <Crown size={10} /> 管理员
            </span>
          )}
          {member.contact && <span className="hidden text-xs text-mist sm:inline">{member.contact}</span>}
        </>
      )}

      {!editing && (
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!isAdminMember && member.active && (
            <button
              type="button"
              onClick={onPromote}
              title="设为管理员"
              className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-xs text-mist hover:bg-sand hover:text-pine sm:px-2"
            >
              <Crown size={12} /> <span className="hidden sm:inline">设为管理员</span>
            </button>
          )}
          {isAdminMember && member.active && (
            <button
              type="button"
              onClick={onDemote}
              disabled={isLastAdmin}
              title={isLastAdmin ? '系统至少需要一名管理员' : '取消管理员'}
              className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-xs text-mist hover:bg-sand hover:text-clay disabled:cursor-not-allowed disabled:opacity-40 sm:px-2"
            >
              <XCircle size={12} /> <span className="hidden sm:inline">取消管理员</span>
            </button>
          )}
          <button
            type="button"
            onClick={onPassword}
            title={memberHasPassword(member) ? '修改/清除密码' : '设置密码'}
            className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-xs text-mist hover:bg-sand hover:text-pine sm:px-2"
          >
            <KeyRound size={12} /> <span className="hidden sm:inline">密码</span>
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="重命名"
            className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-xs text-mist hover:bg-sand hover:text-pine sm:px-2"
          >
            <Pencil size={12} /> <span className="hidden sm:inline">重命名</span>
          </button>
          <button
            type="button"
            onClick={onToggle}
            title={member.active ? '停用成员' : '重新启用'}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs sm:px-2 ${
              member.active ? 'border-line text-mist hover:bg-sand' : 'border-line text-pine hover:bg-sand'
            }`}
          >
            {member.active ? (
              <>
                <UserX size={12} /> <span className="hidden sm:inline">停用</span>
              </>
            ) : (
              <>
                <UserRound size={12} /> <span className="hidden sm:inline">启用</span>
              </>
            )}
          </button>
        </span>
      )}
    </li>
  );
}
