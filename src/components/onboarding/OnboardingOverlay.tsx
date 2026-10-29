import { useState } from 'react';

import { useLang } from '../../i18n';
import { useRepos } from '../../hooks/useRepos';
import { ONBOARDING_DONE_KEY, ONBOARDING_MODE_KEY } from '../../core/onboarding/keys';
import { useOnboardingStore } from '../../store/useOnboardingStore';
import { useUiStore } from '../../store/useUiStore';
import { logUser } from '../../core/services/log.service';
import { OnboardingWelcome } from './OnboardingWelcome';
import { OnboardingQuickTour } from './OnboardingQuickTour';
import { OnboardingStepsTour } from './OnboardingStepsTour';
import { OnboardingFinish } from './OnboardingFinish';

/**
 * 新手引导覆盖层（设计稿 §七：**全屏覆盖层**，不是弹窗——引导是新地方的第一眼，
 * 要整个接管画面，而不是在主界面上叠一层玻璃）。
 *
 * ── 挂载模型 ──
 * 关闭即整体卸载（`if (!open) return null`），四幕状态机住在内层 `OnboardingFlow`；
 * 每次打开（自动闸门 / 设置 → 关于 重看）都是全新挂载，从记忆的 `onboarding.mode`
 * 直进对应线（§三拍板：「选中即记住，重看不再问」），不需要任何重置 action。
 *
 * ── 四幕状态机（组件内会话态）──
 *   welcome → quick | steps → finish；任何一幕的出口（开始使用 / 完成 / 跳过）
 *   都走同一条 `finishAndClose()`：写 `onboarding.done = true`（settings KV）+
 *   同步镜像 + 关闭。
 *
 * ── 持久化纪律（与 restPolicy 同范式）──
 * 落库用 `repos.settings.set(...)`，镜像用 useOnboardingStore 的 action ——
 * 先落库后镜像（失败时镜像不前进，下次启动仍按旧值判）。写入失败静默：
 * 引导进度丢一拍不该打断用户（下次启动最多再看一次引导）。
 *
 * ── 层级 ──
 * z-[79]：盖过一切内容浮层（center 弹窗 70 / 打印选择器 78 / 设置抽屉 60），
 * 与顶栏 chrome 自持浮层同档（79，浮层栈语义见 Modal.tsx）——引导打开时那些
 * 菜单本就不该在场；toast（80）仍在其上，操作反馈不被吞。
 */
type Screen = 'welcome' | 'quick' | 'steps' | 'finish';

export function OnboardingOverlay(): JSX.Element | null {
  const open = useOnboardingStore((s) => s.overlayOpen);
  if (!open) return null;
  return <OnboardingFlow />;
}

function OnboardingFlow(): JSX.Element {
  const { t } = useLang();
  const repos = useRepos();
  const mode = useOnboardingStore((s) => s.mode);
  const [screen, setScreen] = useState<Screen>(() =>
    mode === 'quick' ? 'quick' : mode === 'steps' ? 'steps' : 'welcome',
  );

  /** settings.set 的统一失败口径：静默（进度丢一拍不产生用户可见故障） */
  const persist = (key: string, value: unknown): void => {
    repos.settings.set(key, value).catch(() => undefined);
  };

  /** 选线（§三：选中即记住 onboarding.mode，重看不再问） */
  const chooseMode = (m: 'quick' | 'steps'): void => {
    persist(ONBOARDING_MODE_KEY, m);
    useOnboardingStore.getState().setMode(m);
    logUser('引导', `选择引导线：${m}`);
    setScreen(m);
  };

  /** 唯一出口：写 done → 镜像 → 关闭（两条线、完成页、跳过全部汇到这里） */
  const finishAndClose = (action: string): void => {
    persist(ONBOARDING_DONE_KEY, true);
    useOnboardingStore.getState().markDone();
    logUser('引导', `${action}（onboarding.done = true）`);
    useOnboardingStore.getState().closeOverlay();
  };

  return (
    <div
      data-onboarding-root=""
      className="onboarding-root fixed inset-0 z-[79] overflow-y-auto"
      role="dialog"
      aria-label={t('onboarding.welcome.title')}
    >
      {screen === 'welcome' && <OnboardingWelcome onChooseMode={chooseMode} />}
      {screen === 'quick' && (
        <OnboardingQuickTour
          onStart={() => finishAndClose('快速了解：开始使用')}
          onSwitchToSteps={() => setScreen('steps')}
        />
      )}
      {screen === 'steps' && (
        <OnboardingStepsTour
          onFinish={() => setScreen('finish')}
          onSkip={() => finishAndClose('分步引导：跳过')}
        />
      )}
      {screen === 'finish' && (
        <OnboardingFinish
          onNewProject={() => {
            finishAndClose('完成页：新建第一个项目');
            // 引导关闭后再拉起建档向导（ManualFallbackForm 常驻 AppShell）
            useUiStore.getState().openManualForm();
          }}
          onLookAround={() => finishAndClose('完成页：先随便看看')}
        />
      )}
    </div>
  );
}
