import { useEffect, useState } from 'react';

import { SIDEBAR_BREAKPOINT_PX, isXlViewport } from '../store/useLayoutStore';

/**
 * 订阅 xl（≥1280）断点的 React hook（v0.8.6.0002 · 反馈 #1 抽取）。
 *
 * 为什么抽成共享 hook：侧栏「持久栏是否真正参与布局」（Sidebar）与设置抽屉
 * 「贴侧栏右缘展开」的遮罩左缘（SettingsDialog）问的是**同一个问题**——现在
 * 是不是 ≥xl。两处各写一份 matchMedia 订阅就会漂移（D3 断点纪律：xl=1280
 * 唯一口径，禁止引入新断点类）。初始值同步取（isXlViewport 首帧即可用），
 * 不产生「先旧值再跳」的多余渲染。
 */
export function useXlViewport(): boolean {
  const [xl, setXl] = useState<boolean>(() => isXlViewport());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(min-width: ${SIDEBAR_BREAKPOINT_PX}px)`);
    const onChange = (e: MediaQueryListEvent): void => setXl(e.matches);
    setXl(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return xl;
}
