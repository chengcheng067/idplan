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
import { useLang } from '../../i18n';
import { logError, logUser } from '../../core/services/log.service';

/**
 * 身份进入对话框（增量架构 3.3 状态机 UI 承载）：
 *   admin_prompt  「你是管理员（项目负责人）吗？」→ 我是管理员 / 我不是管理员
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
  /* 取词函数必须在**任何提前 return 之前**取（下面 `if (flow === 'closed') return null` 之后
     才有 `handleClose` 等局部函数；hook 顺序稳定是本仓的既有纪律） */
  const { t } = useLang();
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
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    if (flow === 'password_input') {
      setPassword('');
      setNotice(null);
      setBusy(false);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
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
            role: '负责人',
            contact: null,
            avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
            roleKind: MemberRoleKind.Admin,
          });
          useMembersStore.getState().upsert(created);
          setCurrentMember(created.id);
        }
        toast('success', t('ui.identity.toastAdminEstablished', { name: trimmed }));
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
      setNotice(t('ui.identity.nameMiss'));
      setIdentityFlow('mismatch');
    } catch (err) {
      toast('error', err instanceof ChangxiaError ? err.userMessage : t('ui.identity.setFailed'));
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
        setNotice(t('ui.identity.passwordWrong'));
        setPassword('');
        return;
      }
      const matched = members.find((m) => m.id === pendingMemberId) ?? null;
      setCurrentMember(matched?.id ?? pendingMemberId);
      logUser('身份', `身份切换：成员「${matched?.name ?? plain}」密码登录`);
      setPendingMember(null);
      closeIdentityFlow();
    } catch (err) {
      toast('error', err instanceof ChangxiaError ? err.userMessage : t('ui.identity.passwordVerifyFailed'));
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
            {t('ui.identity.firstRunLead')}
            <br />
            {t('ui.identity.firstRunTail')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openIdentityFlow('name_input', true)}
              className="rounded-md bg-pine px-4 py-2 text-sm text-white transition-colors hover:bg-pine-deep"
            >
              {t('ui.identity.iAmAdmin')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMismatchKind('no_admin');
                setNotice(t('ui.identity.noAdminNotice'));
                setIdentityFlow('mismatch');
              }}
              className="rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:bg-sand"
            >
              {t('ui.identity.iAmNotAdmin')}
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
              ? t('ui.identity.adminNameHint')
              : t('ui.identity.memberNameHint')}
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
            placeholder={t('ui.identity.namePlaceholder')}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {adminIntent ? t('ui.identity.confirmAdmin') : t('ui.next')}
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
            {t('ui.identity.passwordLead')}
            <b className="text-ink">{pendingMember?.name ?? t('ui.identity.thisMember')}</b>
            {t('ui.identity.passwordMid')}
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
            placeholder={t('ui.identity.passwordTitle')}
            disabled={busy}
            autoComplete="current-password"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {notice && <p className="text-xs text-clay">{notice}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submitPassword()}
              disabled={busy || !password}
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {t('ui.identity.login')}
            </button>
          </div>
        </div>
      );
    }

    // mismatch：停留展示提示，不进入
    return (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-ink/80">{notice ?? t('ui.identity.cannotEnterPeriod')}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
          >
            {t('ui.identity.gotIt')}
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
          ? t('ui.identity.ariaFirstRun')
          : flow === 'name_input'
            ? t('ui.identity.ariaNameInput')
            : flow === 'password_input'
              ? t('ui.identity.passwordTitle')
              : t('ui.identity.cannotEnter')
      }
    >
      <div
        tabIndex={-1}
        className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-2xl p-5 shadow-soft outline-none"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="font-display text-display-md">
            {flow === 'admin_prompt'
              ? t('ui.identity.adminPromptTitle')
              : flow === 'name_input'
                ? adminIntent
                  ? t('ui.identity.setAdminTitle')
                  : t('ui.identity.nameInputTitle')
                : flow === 'password_input'
                  ? t('ui.identity.passwordTitle')
                  : t('ui.identity.cannotEnterTitle')}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close')}
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
