import { useEffect, useRef, useState } from 'react';

import { X } from 'lucide-react';

import { useSettingsStore } from '../../store/useSettingsStore';
import { useMembersStore } from '../../store/useMembersStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { matchActiveMemberByName } from '../../hooks/useRoleGuard';
import { createMemberActions } from '../../store/useMembersStore';
import { ChangxiaError, MemberRoleKind } from '../../core/types/enums';
import { memberHasPassword, type Member } from '../../core/types/entities';
import { Modal } from '../common/Modal';
import { ImeInput } from '../common/ImeInput';
import { logError, logUser } from '../../core/services/log.service';

/**
 * 身份进入对话框（增量架构 3.3 状态机 UI 承载）：
 *   admin_prompt  「你是管理员（设计师本人）吗？」→ 我是管理员 / 我不是管理员
 *   name_input    姓名输入框（不是下拉——下拉会暴露成员名单）：
 *                   - adminIntent=true  → 管理员确立（命中→提权；未命中→新建 admin）
 *                   - adminIntent=false → 成员进入（命中→锁定；未命中→mismatch）
 *   mismatch      未命中/无管理员提示（停留，不进入）
 *
 * 对话框级本地状态 mismatchKind 区分两种提示来源：
 *   'no_admin'  （admin_prompt 选「我不是管理员」）→ 关闭时置 firstRunDismissed，
 *                 防首启闸门无限重弹；
 *   'name_miss' （姓名未命中）→ 关闭仅关闭，不置位（闸门条件此时不成立）。
 */

const AVATAR_COLORS = ['#3D6B5B', '#D9A441', '#C4553B', '#7E97A8', '#A99BB5', '#2C3E50'];

type MismatchKind = 'no_admin' | 'name_miss' | null;

export function IdentityDialog(): JSX.Element | null {
  const repos = useRepos();
  const flow = useSettingsStore((s) => s.identityFlow);
  const adminIntent = useSettingsStore((s) => s.adminIntent);
  const openIdentityFlow = useSettingsStore((s) => s.openIdentityFlow);
  const setIdentityFlow = useSettingsStore((s) => s.setIdentityFlow);
  const closeIdentityFlow = useSettingsStore((s) => s.closeIdentityFlow);
  const dismissFirstRunNotice = useSettingsStore((s) => s.dismissFirstRunNotice);
  const setCurrentMember = useSettingsStore((s) => s.setCurrentMember);
  const setPendingMember = useSettingsStore((s) => s.setPendingMember);
  const pendingMemberId = useSettingsStore((s) => s.pendingMemberId);
  const members = useMembersStore((s) => s.members);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [mismatchKind, setMismatchKind] = useState<MismatchKind>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (flow === 'name_input') {
      setName('');
      setPassword('');
      setNotice(null);
      setBusy(false);
      // 对话框面板渲染后聚焦输入框
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    if (flow === 'password_input') {
      setPassword('');
      setNotice(null);
      setBusy(false);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    if (flow === 'closed') {
      setNotice(null);
      setMismatchKind(null);
      setBusy(false);
      setPassword('');
    }
    return undefined;
  }, [flow]);

  if (flow === 'closed') return null;

  const handleClose = (): void => {
    if (mismatchKind === 'no_admin') dismissFirstRunNotice();
    closeIdentityFlow();
  };

  const toast = (kind: 'success' | 'error', message: string): void => {
    useProjectsStore.getState().pushToast(kind, message);
  };

  /** 姓名提交：管理员确立 / 成员进入 共用 */
  const submit = async (): Promise<void> => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      const matched = matchActiveMemberByName(members, trimmed);

      // 管理员确立：姓名命中 active 成员 → 提权；未命中 → 新建 admin
      if (adminIntent) {
        if (matched) {
          await createMemberActions(repos).update(matched.id, {
            roleKind: MemberRoleKind.Admin,
          });
          setCurrentMember(matched.id);
        } else {
          const created = await repos.members.insert({
            name: trimmed,
            role: '设计师',
            contact: null,
            avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
            roleKind: MemberRoleKind.Admin,
          });
          useMembersStore.getState().upsert(created);
          setCurrentMember(created.id);
        }
        toast('success', `管理员「${trimmed}」已确立`);
        logUser('身份', `身份切换：管理员「${trimmed}」确立`);
        closeIdentityFlow();
        return;
      }

      // 成员进入：命中 active 成员 → 若设置了密码则先验密码，否则直接进入
      if (matched) {
        // 该成员被管理员设置了登录密码（v0.6）→ 进入 password_input 流程。
        // 必须走 memberHasPassword：remote 模式服务端不下发哈希，passwordHash 恒为 null。
        if (memberHasPassword(matched)) {
          setPendingMember(matched.id);
          setIdentityFlow('password_input');
          return;
        }
        setCurrentMember(matched.id);
        logUser('身份', `身份切换：成员「${trimmed}」进入`);
        closeIdentityFlow();
        return;
      }
      setMismatchKind('name_miss');
      setNotice('名单中没有找到你的名字，请联系管理员添加后重试');
      setIdentityFlow('mismatch');
    } catch (err) {
      toast('error', err instanceof ChangxiaError ? err.userMessage : '身份设置失败，请重试。');
      logError('身份', `身份切换失败：${trimmed ? `「${trimmed}」` : ''}`, err);
    } finally {
      setBusy(false);
    }
  };

  /** 密码提交（password_input 流程）：本地/远端校验通过后进入 */
  const submitPassword = async (): Promise<void> => {
    if (busy || !pendingMemberId) return;
    const plain = password;
    if (!plain) return;

    setBusy(true);
    try {
      const ok = await repos.members.verifyCredentials(pendingMemberId, plain);
      if (!ok) {
        setNotice('密码错误，请重试。');
        setPassword('');
        return;
      }
      const matched = members.find((m) => m.id === pendingMemberId) ?? null;
      setCurrentMember(matched?.id ?? pendingMemberId);
      logUser('身份', `身份切换：成员「${matched?.name ?? plain}」密码登录`);
      setPendingMember(null);
      closeIdentityFlow();
    } catch (err) {
      toast('error', err instanceof ChangxiaError ? err.userMessage : '密码校验失败，请重试。');
      logError('身份', '密码登录失败', err);
    } finally {
      setBusy(false);
    }
  };

  const renderBody = (): JSX.Element => {
    if (flow === 'admin_prompt') {
      return (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-ink/80">
            首次使用需要先确定管理员身份（设计师本人）。
            <br />
            管理员可以看到全部项目、成员与备份；成员只能看到分派给自己的任务。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openIdentityFlow('name_input', true)}
              className="rounded-md bg-pine px-4 py-2 text-sm text-white transition-colors hover:bg-pine-deep"
            >
              我是管理员
            </button>
            <button
              type="button"
              onClick={() => {
                setMismatchKind('no_admin');
                setNotice('系统当前还没有管理员。请联系管理员完成首次设置后再进入。');
                setIdentityFlow('mismatch');
              }}
              className="rounded-md border border-sand px-4 py-2 text-sm text-mist transition-colors hover:bg-sand"
            >
              我不是管理员
            </button>
          </div>
        </div>
      );
    }

    if (flow === 'name_input') {
      return (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-ink/80">
            {adminIntent
              ? '请填写你的姓名，系统会创建/匹配管理员身份。'
              : '请输入你的姓名（仅在本机匹配，不会展示其他成员名单）。'}
          </p>
          <ImeInput
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // 仅在非输入法组合状态接受 Enter，避免 IME 回车被误提交
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="你的姓名"
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-sand bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-sand px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {adminIntent ? '确认为管理员' : '下一步'}
            </button>
          </div>
        </div>
      );
    }

    if (flow === 'password_input') {
      const pendingMember = members.find((m) => m.id === pendingMemberId);
      return (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-ink/80">
            请输入 <b className="text-ink">{pendingMember?.name ?? '该成员'}</b> 的登录密码
            （由管理员设置；无密码成员无需此步）。
          </p>
          <ImeInput
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitPassword();
              }
            }}
            placeholder="输入密码"
            disabled={busy}
            autoComplete="current-password"
            className="w-full rounded-md border border-sand bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {notice && <p className="text-xs text-clay">{notice}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-sand px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void submitPassword()}
              disabled={busy || !password}
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              登录
            </button>
          </div>
        </div>
      );
    }

    // mismatch：停留展示提示，不进入
    return (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-ink/80">{notice ?? '无法进入。'}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-sand px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
          >
            知道了
          </button>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={handleClose}
      ariaLabel={
        flow === 'admin_prompt'
          ? '首次使用引导'
          : flow === 'name_input'
            ? '输入身份'
            : flow === 'password_input'
              ? '输入密码'
              : '无法进入'
      }
    >
      <div
        tabIndex={-1}
        className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-2xl p-5 shadow-soft outline-none"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="font-display text-display-md">
            {flow === 'admin_prompt'
              ? '你是管理员（设计师本人）吗？'
              : flow === 'name_input'
                ? adminIntent
                  ? '设置管理员身份'
                  : '输入你的姓名'
                : flow === 'password_input'
                  ? '输入密码'
                  : '暂时无法进入'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="关闭"
            className="rounded-md p-1 text-mist hover:bg-sand"
          >
            <X size={16} />
          </button>
        </div>
        {renderBody()}
      </div>
    </Modal>
  );
}

// 类型引用保持（供外部扩展 Member 工具）
export type { Member };
