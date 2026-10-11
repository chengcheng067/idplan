import type { ReactNode } from 'react';

import { Button } from '../ui/Button';
import { useSettingsStore } from '../../store/useSettingsStore';

/**
 * 数据就绪态闸门（审计 F1-① 的统一落点）。
 *
 * ── 为什么要有这个东西 ──
 * 本应用是「离线优先 + 全量装载」：数据在本机 IndexedDB，页面全部内容都由 store
 * 里的数据派生。装载失败时 store 是空的，而各页的空态判据只看「列表长度为 0」
 * ——于是**失败**被渲染成**真空**：
 *   · 首页：「还没有进行中的项目 / 你的数据自动保存在本机浏览器中，关闭浏览器不会丢失」
 *   · 我的任务：「××，目前没有分配给你的待办 🎉」
 *   · 成员看板：「还没有与你相关的项目」
 * 三句话在失败时全是假话，且指向最危险的自救动作（拿旧备份覆盖真数据、删站点数据）。
 *
 * ── 三态（判据来自 <DataGate> 单一事实源，见 useSettingsStore.hydrated 注释）──
 *   装载中（`!hydrated` 且未失败）→ 占位，**绝不**渲染空态；
 *   失败（`hydrateError !== null`）→ **常驻、可重试**的错误面，`hydrated` 保持 false；
 *   已装载（`hydrated`）          → 才把 children（含各页空态）放出去。
 *
 * ── 两条纪律 ──
 *   ① 失败面**不依赖 toast**：toast 2 秒即散、最多 3 条、且可能被后续消息挤掉，
 *      承担不了「数据没读进来」这种需要长时间停留的信息；
 *   ② 失败面**不说假话也不吓人**：数据仍在本地库里，装载失败 ≠ 数据丢失，
 *      并明确劝阻「删站点数据」这个会真毁数据的动作。
 *
 * ── 用法 ──
 * 包住页面上**由数据派生**的整块区域（统计卡、列表、空态、分页控件…）。
 * 静态标题行留在外面，让用户始终知道自己在哪一页。
 * 若某处还要按就绪态做别的判断（如首页副标题里的计数），用 `useDataReadiness()`，
 * **不要**自己拼 `hydrated` 与 `hydrateError`。
 */
export function DataGate({ children }: { children: ReactNode }): JSX.Element {
  const readiness = useDataReadiness();
  const hydrateError = useSettingsStore((s) => s.hydrateError);
  const requestRetry = useSettingsStore((s) => s.requestBootstrapRetry);

  if (readiness === 'failed') {
    return (
      <div
        data-data-gate="failed"
        className="rounded-2xl border border-clay-soft bg-paper p-8 text-center"
      >
        <p className="text-[15px] font-semibold text-ink">本地数据装载失败</p>
        <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6 text-mist">
          你的数据仍然保存在本机数据库中，这次只是没能读进界面——
          <strong className="text-ink">装载失败不等于数据丢失</strong>。请不要删除
          浏览器/站点数据，也不要重装应用来「修」它。
        </p>
        <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6 text-mist">
          常见原因：另一个窗口正在使用同一份数据，或本机存储暂时不可用。
        </p>
        {hydrateError && (
          <p className="mx-auto mt-3 max-w-lg break-words rounded-2xl bg-cream px-4 py-2 text-[11px] leading-5 text-mist">
            {hydrateError}
          </p>
        )}
        <Button className="mt-4" onClick={requestRetry}>
          重新装载
        </Button>
        <p className="mt-2 text-[11px] text-mist">点一下就会重新读取本地数据，不必重启应用。</p>
      </div>
    );
  }

  if (readiness === 'loading') {
    return (
      <div
        data-data-gate="loading"
        aria-busy="true"
        className="rounded-2xl border border-dashed border-line bg-paper p-10 text-center"
      >
        <p className="text-[13px] text-mist">正在装载本地数据…</p>
      </div>
    );
  }

  // 已装载：children 里才允许出现「还没有…」这类空态
  return <>{children}</>;
}

/** 数据就绪态三档（`<DataGate>` 与需要按态做别的判断的地方共用） */
export type DataReadiness = 'loading' | 'failed' | 'ready';

export function useDataReadiness(): DataReadiness {
  const hydrated = useSettingsStore((s) => s.hydrated);
  const hydrateError = useSettingsStore((s) => s.hydrateError);
  if (hydrateError !== null) return 'failed';
  return hydrated ? 'ready' : 'loading';
}
