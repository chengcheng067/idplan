import { useEffect, useRef, useState } from 'react';

import { X } from 'lucide-react';

import { useSettingsStore } from '../../store/useSettingsStore';
import { useMembersStore } from '../../store/useMembersStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { matchActiveMemberByName, useRoleGuard } from '../../hooks/useRoleGuard';
import { createMemberActions } from '../../store/useMembersStore';
import { resolveErrorText, MemberRoleKind } from '../../core/types/enums';
import { memberHasPassword, type Member } from '../../core/types/entities';
import { ROLE_SENTINELS } from '../../core/types/role-sentinel';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
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
  /* 只在「成员入口未命中」时需要：库里已有管理员 ⇒ 新建必须先告知 + 二次确认 */
  const { hasAdmin } = useRoleGuard();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [mismatchKind, setMismatchKind] = useState<MismatchKind>(null);
  const [busy, setBusy] = useState(false);
  /** 「以管理员身份新建」的二次确认是否打开（见文件头 §新建管理员） */
  const [askCreateAdmin, setAskCreateAdmin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (flow === 'name_input') {
      setName('');
      setPassword('');
      setNotice(null);
      setBusy(false);
      setAskCreateAdmin(false);
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

  /**
   * 「以管理员身份新建」的**唯一实现**（两个调用点共用，不许各写一份）：
   *   · `adminIntent === true` 且姓名未命中（首启 / 库里还没有管理员）；
   *   · 成员入口（`adminIntent === false`）姓名未命中（本轮新增，见文件头 §新建管理员）。
   *
   * 抛错交给调用方的 catch —— 两条调用点对失败的处置（toast + logError）完全一致，
   * 在各自那里再写一遍就是第三份孪生实现。
   */
  const createAdminAndEnter = async (trimmed: string): Promise<void> => {
    const created = await repos.members.insert({
      name: trimmed,
      /*
       * ⚠️ **写入点**：`role` 是落库数据值 ⇒ 取数据面常量表的中文原值，
       *    不许经 `t()`（英文态会把 `Owner` 写进库，成员表按语言分裂）。
       *    显示层由 `roleLabel()` 取词，见 `src/i18n/labels.ts`。
       */
      role: ROLE_SENTINELS.owner,
      contact: null,
      avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
      roleKind: MemberRoleKind.Admin,
    });
    useMembersStore.getState().upsert(created);
    setCurrentMember(created.id);
    toast('success', t('ui.identity.toastAdminEstablished', { name: trimmed }));
    logUser('身份', `身份切换：管理员「${trimmed}」确立`);
    closeIdentityFlow();
  };

  /**
   * 二次确认里的「已有管理员姓名」——她选的形态是**告知**，不是密码验证
   * （原话：就算这台电脑上出现过管理员，我也想能新建一个身份进去）。
   * 列前 3 位，其余折成「等 N 位」：这是告知，不是名单展示，不把成员表摊开。
   */
  const activeAdminNames = members
    .filter((m) => m.active && m.roleKind === MemberRoleKind.Admin)
    .map((m) => m.name);
  const adminsText =
    activeAdminNames.length <= 3
      ? activeAdminNames.join('、')
      : `${activeAdminNames.slice(0, 3).join('、')} 等 ${activeAdminNames.length} 位`;

  /** 二次确认的「确认」：真正建号并进入 */
  const confirmCreateAdmin = async (): Promise<void> => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createAdminAndEnter(trimmed);
      setAskCreateAdmin(false);
    } catch (err) {
      toast('error', resolveErrorText(err, t, t('ui.identity.setFailed')));
      logError('身份', `新建管理员失败：「${trimmed}」`, err);
    } finally {
      setBusy(false);
    }
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
          toast('success', t('ui.identity.toastAdminEstablished', { name: trimmed }));
          logUser('身份', `身份切换：管理员「${trimmed}」确立`);
          closeIdentityFlow();
        } else {
          await createAdminAndEnter(trimmed);
        }
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

      /*
       * ★ 未命中 —— 修前是**死胡同**（`mismatch` + 「名单中没有找到你的名字，请联系管理员」），
       *   而「联系管理员」在一台只有他自己的电脑上是个走不出去的建议：
       *   `MemberIdentityPicker` 只在 `hasAdmin === false` 时才会把人送进能建管理员的
       *   `adminIntent === true` 那条路。她的原话：
       *     「就算哪怕这台电脑上已经出现过管理员，那我可不可以新建一个身份进去呢？」
       *
       * 新口径（已拍板）：
       *   · 库里有管理员 ⇒ **先弹告知 + 二次确认**（列出已有管理员姓名与后果），确认才建；
       *   · 库里没有管理员 ⇒ 直接确立（与首启 `adminIntent` 那条完全同一条实现）。
       *
       * ⚠️ `mismatch` 状态**保留**：`admin_prompt` 里选「我不是管理员」的 `no_admin` 支还在用。
       *    只是 `name_miss` 不再把人送进去。
       */
      if (hasAdmin) {
        setAskCreateAdmin(true);
        return;
      }
      await createAdminAndEnter(trimmed);
    } catch (err) {
      toast('error', resolveErrorText(err, t, t('ui.identity.setFailed')));
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
      toast('error', resolveErrorText(err, t, t('ui.identity.passwordVerifyFailed')));
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
              /* 语言无关定位钩子（i18n-EN 批 · team-lead 裁定①）：真机流程原先按**中文文案**
                 （`x.textContent.trim() === '我是管理员'`）找这三枚按钮 —— 而那在**英文环境**
                 （`i18n-browser.spec.ts` 的 `openEnglish()` 冷启动即 en）下**必然找不到**，
                 `?.click()` 还会**静默不点**，失败伪装成「后面的输入框不存在」。
                 ⚠️ 三枚按钮**各给独立值、不共用**：共用值＝当场造一个「匹配集变宽」
                 （见 C-口径 40 半二，本批已为此栽过一次）。 */
              data-identity-role="admin"
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
              data-identity-role="member"
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
            /*
             * 语言无关定位钩子：`placeholder` 已走消息表（`ui.identity.namePlaceholder`，
             * 英文态是 `Your name`）。真 Chromium 那批 spec 里有 **10 处 / 10 文件**
             * 按 `input[placeholder="你的姓名"]` 填这个框（`helpers/board-env.ts` 是共用夹具，
             * 一处失配会连带整族 spec 红，而报错是"找不到输入框"）。⇒ 统一改按本钩子定位。
             */
            data-identity-name-input=""
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {/*
            ★ 2026-10-27 · 未进入态的第二条出路：**以管理员身份新建**（见文件头 §新建管理员）。

            为什么它常驻而不是「提交未命中后才出现」：本屏要回答的问题是"我是谁"，
            而用户**本来就可能不在名单里**（新同事 / 换了台电脑 / 当初填的不是这个名字）。
            把出路藏在一次失败的提交之后，等于让他先撞一次墙；且 `hasAdmin === false` 时
            首启那条路（`adminIntent === true`）根本不会走到这里，所以本按钮只出现在
            "有管理员 + 成员入口"这一态 —— 恰好就是原来那个死胡同。

            ⚠️ **不渲染 `adminIntent` 那一态**：那条路的主按钮本身就会新建管理员，
               再给一枚同义按钮只会让人分不清哪个才会真的建号。
          */}
          {!adminIntent && (
            <button
              type="button"
              onClick={() => setAskCreateAdmin(true)}
              disabled={busy || !name.trim()}
              /* 语言无关定位钩子：英文态文案是另一串，真机/单测按本钩子定位 */
              data-identity-create-admin=""
              className="w-full rounded-md border border-dashed border-line px-3 py-2 text-[12px] leading-5 text-mist outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40 disabled:opacity-50"
            >
              {t('ui.identity.createAdminAction')}
            </button>
          )}
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
              /* 语言无关定位钩子（同上）。**这一枚是双语义按钮**（`确认为管理员` / `下一步`）
                 ⇒ 取值随语义走，而不是写死一个值 —— 否则两种语义会共用一个匹配集。 */
              data-identity-submit={adminIntent ? 'confirm-admin' : 'next'}
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

  /*
   * 身份对话框本体。抽成变量是为了让「以管理员身份新建」的二次确认成为它的**兄弟**浮层
   * —— 不能渲染进本 Modal 的子树：确认框要能盖在它上面，而取消后它必须原样还在
   * （渲染进子树会让两套遮罩＋焦点圈禁相互打架）。
   */
  const identityDialog = (
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

  return (
    <>
      {identityDialog}
      {/*
        ★ 2026-10-27 · 「以管理员身份新建」的告知 + 二次确认（她选定的形态：不设密码、
        不多一步输入，只让人明确知道自己在做什么）。

        文案里必须出现**已有管理员的姓名**与**后果**：这台机器上已经有人是管理员，
        新建一个管理员等于再开一把通往全部项目 / 成员 / 备份的钥匙。只写「确定吗」
        是没告知；写成密码验证又违反她「别加一道没用的门」的取向。

        ⚠️ 取消只关确认框（`onCancel` 里只置 false）：身份对话框保持原样、姓名还在输入框里，
        用户可以改用已有成员的名字重试。这是「取消不能把人送回死胡同」的落点。
      */}
      <ConfirmDialog
        open={askCreateAdmin}
        title={t('ui.identity.createAdminConfirmTitle')}
        confirmText={t('ui.identity.confirmAdmin')}
        dataAttrs={{ 'data-identity-create-admin-confirm': '' }}
        onCancel={() => setAskCreateAdmin(false)}
        onConfirm={() => void confirmCreateAdmin()}
      >
        {t('ui.identity.createAdminConfirmBody', {
          admins: adminsText,
          name: name.trim(),
        })}
      </ConfirmDialog>
    </>
  );
}

// 类型引用保持（供外部扩展 Member 工具）
export type { Member };
