/**
 * 首次运行引导卡（0.8.3 条目2 · 首启三幕的第二幕）。
 *
 * ── 三幕全局 ──
 *   第一幕「你是谁」= IdentityDialog（既有，首启管理员/成员确立）；
 *   第二幕「这是什么 + 先看示例」= **本卡**（0.8.3 新增）；
 *   第三幕「空态提示」= 首页空态 + 侧栏备份族「载入示例项目」入口（既有）。
 *
 * ── 本卡的收敛逻辑 ──
 * 显示条件：库为空（projects 0）且未看过本卡（localStorage flag）。
 * 两个出口都写 flag（看示例也算看过——看完示例库就不空了，卡自然不再出现）：
 *   ·「载入示例项目看看」→ loadDemo（与侧栏入口同链路，覆盖式导 5 个演示项目）
 *   ·「从空库开始」→ 直接关卡，回到既有首页空态流程
 * 「跳过」语义即右上角关闭 / Esc（Modal 基建自带）。
 */
import { useCallback, useEffect, useState } from 'react';

import { Sparkles } from 'lucide-react';

import { Modal } from '../common/Modal';
import { useBackupIo } from './useBackupIo';
import { useHumanProjects } from '../../core/project/visibility';
import { logUser } from '../../core/services/log.service';

const GUIDE_SEEN_KEY = 'idplan.firstRunGuideSeen';

export function FirstRunGuide(): JSX.Element | null {
  const projects = useHumanProjects();
  const { loadDemo, fileInput, confirmDialog } = useBackupIo();
  const [dismissed, setDismissed] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem(GUIDE_SEEN_KEY) === '1' : false),
  );
  /**
   * 身份流完成判据（0.8.3 双卡叠弹修复）：欢迎卡**必须等 IdentityDialog 走完再出现**，
   * 否则陌生人首次启动会看到两张模态叠在一起（身份卡在上、欢迎卡在下，都带遮罩）。
   * 信号 = `changxia.currentMemberId`（useSettingsStore/useFirstRunGate 同一个键：
   * IdentityDialog 选完管理员/成员即写入；探针环境由 spec 预置）。
   * 用 state + effect 而非纯 render 期读：写入发生在对话框关闭时，要能触发重渲染。
   */
  const [identityDone, setIdentityDone] = useState(
    () =>
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('changxia.currentMemberId') !== null,
  );
  useEffect(() => {
    if (identityDone) return;
    const t = window.setInterval(() => {
      if (localStorage.getItem('changxia.currentMemberId') !== null) {
        setIdentityDone(true);
        window.clearInterval(t);
      }
    }, 400);
    return () => window.clearInterval(t);
  }, [identityDone]);

  const close = useCallback(() => {
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, '1');
    } catch {
      // 隐私模式等写不进的场合：会话内不再弹即可（不阻断引导关闭）
    }
    logUser('首启引导', '已关闭');
    setDismissed(true);
  }, []);

  // 有项目（老用户 / 已载入示例）或已看过 → 不出现
  if (projects.length > 0 || dismissed || !identityDone) {
    return (
      <>
        {fileInput}
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      {fileInput}
      {confirmDialog}
      <Modal open onClose={close} ariaLabel="首次运行引导">
        <div className="w-[420px] max-w-[92vw] space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-pine/10">
              <Sparkles size={16} className="text-pine" aria-hidden />
            </span>
            <h2 className="font-display text-base font-semibold text-ink">欢迎使用 ID Plan</h2>
          </div>
          <div className="space-y-1.5 text-[13px] leading-relaxed text-mist">
            <p>
              它把一份项目合同，变成一张<strong className="text-ink">看得懂的阶段时间轴</strong>
              ——看板、月历、甘特、打印，四种看法同一份数据。
            </p>
            <p>数据存在你自己机器上，离线可用，不上传。</p>
          </div>
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => {
                // 看过 flag 立即落（确认弹窗无论确认与否都不再重弹首启卡）
                try {
                  localStorage.setItem(GUIDE_SEEN_KEY, '1');
                } catch {
                  /* 同上 */
                }
                void loadDemo();
              }}
              className="btn-aura flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
            >
              <Sparkles size={15} />
              载入示例项目看看（5 个演示项目）
            </button>
            <button
              type="button"
              onClick={close}
              className="flex w-full items-center justify-center rounded-2xl border border-line bg-paper px-4 py-2.5 text-sm text-ink transition-colors hover:bg-cream"
            >
              从空库开始，我直接建项目
            </button>
          </div>
          <p className="text-center text-[11px] text-mist">随时可以在侧栏「载入示例项目」重新载入</p>
        </div>
      </Modal>
    </>
  );
}
