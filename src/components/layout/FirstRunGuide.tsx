/**
 * 首次运行引导卡（0.8.3 条目2 · 首启三幕的第二幕；v0.8.5 B 规范深化）。
 *
 * ── 三幕全局 ──
 *   第一幕「你是谁」= IdentityDialog（既有，首启管理员/成员确立）；
 *   第二幕「这是什么 + 先看示例」= **本卡**（0.8.3 新增）；
 *   第三幕「空态提示」= 首页空态 + 侧栏备份族「载入示例项目」入口（既有）。
 *
 * ── 本卡的收敛逻辑 ──
 * 显示条件：库为空（projects 0）且未看过本卡（localStorage flag）。
 * 两个出口都写 flag（看示例也算看过——看完示例库就不空了，卡自然不再出现）：
 *   · 点行业卡 → loadDemo（与侧栏入口同链路，覆盖式导入演示数据）
 *   ·「先四处看看」/ × / Esc → 直接关卡，回到既有首页空态流程
 *
 * ── v0.8.5 B 深化（他反馈 #2「新手教程呈现太粗糙」+ 默认室内）──
 * 单卡两按钮 → **行业分流三卡**（设计规范 deliverables/research/
 * v0.8.5-选择器与引导与二级侧栏-视觉规范.md §B）：室内 / 软件 / 旅游
 * 代表三种看板列形态（3/5/4 列），卡底一排小色条 = 真实列形态微预览
 * （零图片资源、离线优先）；卡片驱动数据是一张表（domain/图标/文案/
 * demoReady）——**全行业软件的第一屏不该只有室内**。
 * 新增：点卡导入期间 aria-busy 防连点（loadDemo 是覆盖式，连点=两次
 * 全库覆盖）；「先四处看看」ghost 出口 = 旧「从空库开始」同语义。
 * 显示条件 / flag / 轮询 / isAdmin 门控**零改动**（两条既有铁律见 B.6：
 * 欢迎卡必须等身份幕走完；两个出口都写 seen flag）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Code2, Loader2, Plane, Sofa, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Modal } from '../common/Modal';
import { useBackupIo } from './useBackupIo';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useHumanProjects } from '../../core/project/visibility';
import { logUser } from '../../core/services/log.service';
import { cn } from '../../lib/cn';

const GUIDE_SEEN_KEY = 'idplan.firstRunGuideSeen';

/**
 * 行业分流卡（规范 B.5）：三行业代表三种看板列形态。
 * `bars` = 列形态微预览的色条数与色（取该行业看板列的 tone token；
 * 宽度按列数分档：3 列 w-6 / 4 列 w-5 / 5 列 w-4）。`demoReady`：
 * 示例数据尚未制作的行业不上卡（点不动的事不摆出来——产品官 DX 纪律）。
 */
const GUIDE_CARDS: ReadonlyArray<{
  domain: string;
  label: string;
  Icon: LucideIcon;
  lines: string;
  bars: ReadonlyArray<{ w: string; tone: string }>;
  demoReady: boolean;
}> = [
  {
    domain: 'indoor',
    label: '室内',
    Icon: Sofa,
    lines: '画图纸、跑工地——从设计到施工，一图看清走到哪',
    bars: [
      { w: 'w-6', tone: 'bg-pine' },
      { w: 'w-6', tone: 'bg-amber' },
      { w: 'w-6', tone: 'bg-stage-s1' },
    ],
    demoReady: true,
  },
  {
    domain: 'software',
    label: '软件',
    Icon: Code2,
    lines: '规划、设计、开发、验证、发布——五个阶段排在一张板上',
    bars: [
      { w: 'w-4', tone: 'bg-stage-s1' },
      { w: 'w-4', tone: 'bg-stage-s2' },
      { w: 'w-4', tone: 'bg-stage-s3' },
      { w: 'w-4', tone: 'bg-stage-s4' },
      { w: 'w-4', tone: 'bg-stage-s5' },
    ],
    demoReady: true,
  },
  {
    domain: 'travel',
    label: '旅游',
    Icon: Plane,
    lines: '线路策划到出行结算，节点再多也不丢',
    bars: [
      { w: 'w-5', tone: 'bg-stage-s1' },
      { w: 'w-5', tone: 'bg-stage-s2' },
      { w: 'w-5', tone: 'bg-stage-s3' },
      { w: 'w-5', tone: 'bg-stage-s4' },
    ],
    demoReady: true,
  },
];

export function FirstRunGuide(): JSX.Element | null {
  const projects = useHumanProjects();
  const { loadDemo, fileInput, confirmDialog } = useBackupIo();
  const [dismissed, setDismissed] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem(GUIDE_SEEN_KEY) === '1' : false),
  );
  // ★ 0.8.5 P0（产品官评审发现）：欢迎卡的示例按钮与侧栏/移动端入口必须同一权限口径——
  //   loadDemo 是覆盖式全量导入，成员身份点一次会把全库顶掉。侧栏版有 isAdmin 门控，
  //   这里漏了=口径洞。无管理员可用时按钮不渲染（卡仍显示，「从空库开始」不受影响）。
  const { isAdmin } = useRoleGuard();
  /** 导入中（点卡 → loadDemo 覆盖式导入进行时）：aria-busy 防连点 + Loader2（规范 B.7） */
  const [importing, setImporting] = useState(false);
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
        {/* v0.8.5 B 规范面板：glass-strong + iridescent-border + dialog-pop——
            与全站其它弹窗（建档/设置）观感统一；旧版直接坐遮罩上的裸 div 回收。 */}
        <div
          data-first-run-panel=""
          className="glass-strong iridescent-border dialog-pop w-[560px] max-w-[92vw] space-y-4 rounded-2xl p-5 shadow-soft"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-pine-soft">
              <Sparkles size={16} className="text-pine" aria-hidden />
            </span>
            <h2 className="font-display text-base font-semibold text-ink">欢迎使用 ID Plan</h2>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={close}
              aria-label="先四处看看"
              className="rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="space-y-1.5 text-[13px] leading-relaxed text-mist">
            <p>
              它把一份项目合同，变成一张<strong className="text-ink">看得懂的阶段时间轴</strong>
              ——看板、月历、甘特、打印，四种看法同一份数据。
            </p>
            <p>数据存在你自己机器上，离线可用，不上传。</p>
          </div>

          <div>
            <p className="mb-2 text-[11px] text-mist">想先看看哪个行业的样子？</p>
            {/* 卡片网格：一条 auto-fit 规则兼容 1–9 套（demo 扩容时零 CSS 改动） */}
            <div
              data-first-run-cards=""
              className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(148px,1fr))]"
            >
              {GUIDE_CARDS.map(({ domain, label, Icon, lines, bars, demoReady }) => (
                <button
                  key={domain}
                  type="button"
                  data-first-run-card={domain}
                  aria-busy={importing}
                  // 成员身份 / 示例未就绪 / 导入中 → 禁用（点不动的事不摆出来——
                  //  旧单按钮版用「不渲染」，三卡版渲染骨架+禁用：行业形态预览
                  //  对所有身份都有信息价值，只是不能触发覆盖式导入）。
                  disabled={importing || !demoReady || !isAdmin}
                  title={isAdmin ? undefined : '仅管理员可载入示例项目'}
                  onClick={() => {
                    if (!isAdmin || !demoReady) return; // 双保险（disabled 已拦，防键盘/读屏误触）
                    // 看过 flag 立即落（确认弹窗无论确认与否都不再重弹首启卡）
                    try {
                      localStorage.setItem(GUIDE_SEEN_KEY, '1');
                    } catch {
                      /* 同上 */
                    }
                    setImporting(true);
                    void loadDemo().finally(() => setImporting(false));
                  }}
                  className={cn(
                    'flex min-h-[152px] flex-col items-start gap-2 rounded-2xl border border-line bg-paper p-3 text-left',
                    'transition-[border-color,background-color,transform] duration-150 ease-[var(--liquid-ease)] hover:-translate-y-px hover:border-pine',
                    'outline-none focus-visible:ring-2 focus-visible:ring-pine/40',
                    importing && 'pointer-events-none opacity-50',
                  )}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-pine-soft">
                    {importing ? (
                      <Loader2 size={16} className="animate-spin text-pine" aria-hidden />
                    ) : (
                      <Icon size={16} className="text-pine" aria-hidden />
                    )}
                  </span>
                  <span className="text-[13px] font-semibold text-ink">{label}</span>
                  <span className="line-clamp-2 text-[11px] leading-4 text-mist">
                    {demoReady ? lines : '示例筹备中'}
                  </span>
                  {/* 列形态微预览：信息载体=真实列形态，不是装饰（零图片资源） */}
                  <span className="mt-auto flex gap-1 pt-2">
                    {bars.map((b, i) => (
                      <span key={i} className={cn('h-1.5 rounded-full', b.w, b.tone)} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={close}
              className="flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              先四处看看（不进示例）
            </button>
            <span className="ml-auto text-[11px] text-mist">随时可在侧栏「载入示例项目」回看</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
