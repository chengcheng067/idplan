import { useEffect } from 'react';

import { useSettingsStore } from '../store/useSettingsStore';
import { useOnboardingStore } from '../store/useOnboardingStore';

/**
 * 新手引导自动弹出闸门（挂在 AppShell，一次；与 useFirstRunGate 同款写法）。
 *
 * 触发条件（四条同时成立）：
 *   ① bootstrap 完成（hydrated）—— settings 两键已注入 onboarding store；
 *   ② 已进入身份（currentMemberId !== null）—— 设计稿 §二：身份选定之后才引导；
 *   ③ `done === false` —— **只有全新数据库才弹**（建区/首次确立管理员时播种的
 *      显式标记）；老库无记录（null）视为已看过，绝不打扰；
 *   ④ 覆盖层未打开（手动重看已开着时不重复触发）。
 *
 * 为什么用 Effect 订阅而不是在 setCurrentMember 里直接开：setCurrentMember 是
 * **同步** action，而 done 的镜像要到 bootstrap 解析 settings 才就绪——把判定放在
 * Effect 里让「身份落定」与「done 就绪」两条线自然汇合（谁后到谁触发），不需要
 * 人为编排时序。看完/跳过写 `done = true` 后条件自然失效，不会重弹。
 */
export function useOnboardingGate(): void {
  const hydrated = useSettingsStore((s) => s.hydrated);
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const done = useOnboardingStore((s) => s.done);
  const overlayOpen = useOnboardingStore((s) => s.overlayOpen);
  const openOverlay = useOnboardingStore((s) => s.openOverlay);

  useEffect(() => {
    if (hydrated && currentMemberId !== null && done === false && !overlayOpen) {
      openOverlay();
    }
  }, [hydrated, currentMemberId, done, overlayOpen, openOverlay]);
}
