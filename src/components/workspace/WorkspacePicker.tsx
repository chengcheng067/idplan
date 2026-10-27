import { useState } from 'react';
import { Check, ChevronLeft, Loader2, X } from 'lucide-react';

import { Modal } from '../common/Modal';
import { ImeInput } from '../common/ImeInput';
import { Button } from '../ui/Button';
import { useLang } from '../../i18n';
import { cn } from '../../lib/cn';
import { reloadApp } from '../../lib/reload';
import { verifyPassword } from '../../lib/password';
import { resolveErrorText } from '../../core/types/enums';
import { logError, logUser } from '../../core/services/log.service';
import {
  addWorkspace,
  currentWorkspaceIdSync,
  hasWorkspaceManuallySwitched,
  listWorkspaces,
  markWorkspaceEntryStarted,
  markWorkspaceManuallySwitched,
  setCurrentWorkspaceId,
  writeMemberIdForWorkspace,
  type WorkspaceEntry,
} from '../../lib/workspace-registry';
import { createWorkspaceOwnerDb, readWorkspaceGateHash } from '../../core/repositories/local/workspace.db';

/**
 * 工作区选择器（多工作区 0016 · 首屏与切换的共用 UI）。
 *
 * ── 两个挂载点 ──
 *   · `variant="page"`  —— HomePage 未进入身份时的整页首屏（区数量 > 1 或用户
 *     手动切过时替代「请先进入身份」引导块，判据在调用方，见 HomePage）；
 *   · `variant="modal"` —— 侧栏底部「切换工作区」入口的浮层（已进入身份时可见）。
 *
 * ── 三态视图 ──
 *   list     区列表（名 + Owner 名）+「新建工作区」；
 *   create   建区表单（区名 + Owner 管理员名 + 密码 ≥4 位 + 确认；PBKDF2 复用
 *            src/lib/password，建库/Owner 入库经 core 的 createWorkspaceOwnerDb），
 *            成功后直接以 Owner 身份进入空白新区（落区级身份键 → reload）；
 *   password 目标区设过管理员密码 ⇒ 切入前验密（verifyPassword 对该区 Owner/
 *            管理员的 passwordHash；区没设过密码 ⇒ 不验直接进）。
 *   同区（= 当前区）选中不验密不重载：page 态回调 onEnterCurrentWorkspace 回
 *   身份引导，modal 态直接关闭。
 *
 * ── 为什么切换走整页 reload ──
 * 分库后仓储 bundle 绑定的是「启动那一刻」的库；区切换 = 换库名 = 从 RepoProvider
 * 重新装配最省心也最不出错（身份键、settings KV、僵尸执行恢复全部按新库重来）。
 * 本应用是 Electron 壳没有地址栏，reload 对用户就是一次正常的启动。
 */

type View = 'list' | 'create' | 'password';

export function WorkspacePicker({
  variant,
  onClose,
  onEnterCurrentWorkspace,
}: {
  variant: 'page' | 'modal';
  /** modal 态：关闭浮层 */
  onClose?: () => void;
  /** page 态：选中了「当前区」（同区不验密不重载）→ 回身份引导 */
  onEnterCurrentWorkspace?: () => void;
}): JSX.Element {
  const { t } = useLang();
  /** 区列表挂载时读一次（建区/切区都整页 reload，无存活的列表需要刷新） */
  const [workspaces] = useState<WorkspaceEntry[]>(() => listWorkspaces());
  const [view, setView] = useState<View>('list');
  /** password 态：目标区与其闸密哈希 */
  const [gateTarget, setGateTarget] = useState<{ ws: WorkspaceEntry; hash: string } | null>(null);
  const [gatePw, setGatePw] = useState('');
  const [gateNotice, setGateNotice] = useState<string | null>(null);

  // 建区表单
  const [wsName, setWsName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [createPw, setCreatePw] = useState('');
  const [createPwConfirm, setCreatePwConfirm] = useState('');
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const currentId = currentWorkspaceIdSync();

  /** list↔create↔password 互切时的表单残留清理（一个出口，防漏字段） */
  const resetForms = (): void => {
    setGateTarget(null);
    setGatePw('');
    setGateNotice(null);
    setWsName('');
    setOwnerName('');
    setCreatePw('');
    setCreatePwConfirm('');
    setCreateNotice(null);
  };

  /** 进入目标区（验密通过 / 无需验密的共同出口）：落标记 → reload 换库 */
  const enterWorkspace = (ws: WorkspaceEntry): void => {
    setCurrentWorkspaceId(ws.id);
    // 「进入某区的流程已开始」：reload 后首屏给身份引导而不是区列表；
    // 「手动切过」：此后即使只剩一个区，首屏也保留选择列表（用户已表达多区意图）。
    markWorkspaceEntryStarted();
    markWorkspaceManuallySwitched();
    logUser('工作区', `switch: enter "${ws.name}" (${ws.id})`);
    reloadApp();
  };

  const pick = async (ws: WorkspaceEntry): Promise<void> => {
    if (busy) return;
    // 同区：不验密、不重载（拍板口径「同区退出重进不验」）
    if (ws.id === currentId) {
      if (variant === 'modal') onClose?.();
      else onEnterCurrentWorkspace?.();
      return;
    }
    setBusy(true);
    try {
      const hash = await readWorkspaceGateHash(ws.dbName);
      if (!hash) {
        // 该区没设过任何管理员密码（新区 Owner 一定有）⇒ 无可验之物，直接进
        enterWorkspace(ws);
        return;
      }
      setGateTarget({ ws, hash });
      setGatePw('');
      setGateNotice(null);
      setView('password');
    } finally {
      setBusy(false);
    }
  };

  const submitGate = async (): Promise<void> => {
    if (busy || !gateTarget || !gatePw) return;
    setBusy(true);
    try {
      const ok = await verifyPassword(gatePw, gateTarget.hash);
      if (!ok) {
        setGateNotice(t('workspace.gate.wrong'));
        return;
      }
      enterWorkspace(gateTarget.ws);
    } finally {
      setBusy(false);
    }
  };

  /** 建区：校验 → 建库+Owner（core）→ 注册表 → 区级身份键 → 切区 → reload */
  const submitCreate = async (): Promise<void> => {
    if (busy) return;
    const name = wsName.trim();
    const owner = ownerName.trim();
    if (!name) {
      setCreateNotice(t('workspace.create.nameRequired'));
      return;
    }
    if (!owner) {
      setCreateNotice(t('workspace.create.ownerRequired'));
      return;
    }
    if (createPw.length < 4) {
      setCreateNotice(t('ui.identity.pw.tooShort'));
      return;
    }
    if (createPw !== createPwConfirm) {
      setCreateNotice(t('ui.identity.pw.mismatch'));
      return;
    }
    setBusy(true);
    try {
      const id = `ws-${crypto.randomUUID()}`;
      const dbName = `idplan-${id}`;
      const ownerId = await createWorkspaceOwnerDb({ dbName, ownerName: owner, password: createPw });
      addWorkspace({ id, name, createdAt: new Date().toISOString(), ownerMemberName: owner, dbName });
      // 直接以 Owner 身份进入：reload 前把身份记忆写到**新区**的区级键
      writeMemberIdForWorkspace(id, ownerId);
      setCurrentWorkspaceId(id);
      markWorkspaceEntryStarted();
      markWorkspaceManuallySwitched();
      logUser('工作区', `create: "${name}" (${id})`);
      reloadApp();
    } catch (err) {
      setCreateNotice(resolveErrorText(err, t, t('workspace.create.failed')));
      logError('工作区', `create failed: "${name}"`, err);
      setBusy(false);
    }
  };

  const backToList = (): void => {
    resetForms();
    setView('list');
  };

  const toCreate = (): void => {
    resetForms();
    setView('create');
  };

  const body = (
    <div
      data-workspace-picker=""
      className={cn(
        'space-y-4 rounded-2xl p-5',
        variant === 'page'
          ? 'glass-strong iridescent-border w-[440px] max-w-[92vw] shadow-soft'
          : 'w-full',
      )}
    >
      <div className="flex items-center gap-2">
        {view !== 'list' && (
          <button
            type="button"
            onClick={backToList}
            aria-label={t('workspace.backAria')}
            className="rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
        )}
        <h2 className="font-display text-display-md text-ink">
          {view === 'list'
            ? t('workspace.picker.title')
            : view === 'create'
              ? t('workspace.create.title')
              : t('workspace.gate.title')}
        </h2>
        {variant === 'modal' && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto rounded-md p-1 text-mist hover:bg-sand"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {view === 'list' && (
        <>
          <p className="text-[13px] leading-5 text-mist">{t('workspace.picker.lead')}</p>
          <ul className="space-y-2" data-workspace-list="">
            {workspaces.map((ws) => {
              const isCurrent = ws.id === currentId;
              return (
                <li key={ws.id}>
                  <button
                    type="button"
                    data-workspace-item={ws.id}
                    disabled={busy}
                    onClick={() => void pick(ws)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      'border-line bg-paper hover:border-pine hover:bg-sand',
                      'outline-none focus-visible:ring-2 focus-visible:ring-pine/40',
                      isCurrent && 'border-pine/60',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-ink">{ws.name}</span>
                        {isCurrent && (
                          <>
                            <Check size={13} className="shrink-0 text-pine" aria-hidden />
                            <span className="shrink-0 text-[11px] text-pine">{t('workspace.currentTag')}</span>
                          </>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-mist">
                        {t('workspace.ownerLine', { name: ws.ownerMemberName ?? '—' })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            variant="secondary"
            className="w-full"
            onClick={toCreate}
            data-workspace-new=""
            disabled={busy}
          >
            {t('workspace.picker.newAction')}
          </Button>
        </>
      )}

      {view === 'create' && (
        <div className="space-y-3">
          <p className="text-[13px] leading-5 text-mist">{t('workspace.create.lead')}</p>
          <label className="block space-y-1">
            <span className="text-[12px] text-mist">{t('workspace.create.nameLabel')}</span>
            <ImeInput
              value={wsName}
              onChange={(e) => {
                setWsName(e.target.value);
                setCreateNotice(null);
              }}
              placeholder={t('workspace.create.namePlaceholder')}
              data-workspace-name-input=""
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-mist">{t('workspace.create.ownerLabel')}</span>
            <ImeInput
              value={ownerName}
              onChange={(e) => {
                setOwnerName(e.target.value);
                setCreateNotice(null);
              }}
              placeholder={t('workspace.create.ownerPlaceholder')}
              data-workspace-owner-input=""
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-mist">{t('workspace.create.pwLabel')}</span>
            <ImeInput
              type="password"
              value={createPw}
              onChange={(e) => {
                setCreatePw(e.target.value);
                setCreateNotice(null);
              }}
              placeholder={t('workspace.create.pwPlaceholder')}
              data-workspace-pw-input=""
              disabled={busy}
              autoComplete="new-password"
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
            />
          </label>
          <ImeInput
            type="password"
            value={createPwConfirm}
            onChange={(e) => {
              setCreatePwConfirm(e.target.value);
              setCreateNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitCreate();
              }
            }}
            placeholder={t('workspace.create.pwConfirmPlaceholder')}
            data-workspace-pw-confirm=""
            disabled={busy}
            autoComplete="new-password"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {createNotice && <p className="text-xs text-clay">{createNotice}</p>}
          <Button className="w-full" onClick={() => void submitCreate()} disabled={busy} data-workspace-create-submit="">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {t('workspace.create.submitting')}
              </span>
            ) : (
              t('workspace.create.submit')
            )}
          </Button>
        </div>
      )}

      {view === 'password' && gateTarget && (
        <div className="space-y-3">
          <p className="text-[13px] leading-5 text-mist">
            {t('workspace.gate.lead', { name: gateTarget.ws.name })}
          </p>
          <ImeInput
            type="password"
            value={gatePw}
            onChange={(e) => {
              setGatePw(e.target.value);
              setGateNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitGate();
              }
            }}
            placeholder={t('workspace.gate.inputPlaceholder')}
            data-workspace-gate-input=""
            disabled={busy}
            autoComplete="current-password"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {gateNotice && <p className="text-xs text-clay">{gateNotice}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={backToList}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submitGate()}
              disabled={busy || !gatePw}
              data-workspace-gate-submit=""
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {t('workspace.gate.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (variant === 'page') {
    return <div className="flex min-h-[50vh] items-start justify-center pt-6">{body}</div>;
  }

  return (
    <Modal open onClose={onClose ?? (() => undefined)} ariaLabel={t('workspace.picker.aria')}>
      {body}
    </Modal>
  );
}
