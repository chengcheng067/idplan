/**
 * 「打印标识（Logo）」设置区（产品决策文档 §3.3：全局级、管理员上传）。
 *
 * ── 为什么住在「排程」分区 ──
 * 设置六区里没有「打印」区；logo 服务的是打印输出（排程纸面 + 四版模板），
 * 与排程同域。且**排程分区本身仅管理员可见**（v0.8.6.0002 反馈 #11 +
 * 图 5 第 3 点：成员看不到排程按钮）⇒ 「管理员可见、成员不可见」的产品
 * 口径由分区角色可见性直接兑现，不另造门控（与休息制度同范式）。
 *
 * ── 上传链路 ──
 * 选文件 → processPrintLogoFile（灰度 + 阈值二值化 + 体积阶梯 ≤200KB）
 * → settings KV `printLogo` → toast + 重读。上传失败（超限 / SVG 无宽高）
 * 给人话提示，不静默。
 *
 * ── 落地位置（决策文档 §3.3 逐版定）──
 * A = 黑顶栏左端（≤24px，反白）；D = 每页头部左上格（≤28px）；
 *   E = 每页左上角发丝线下方（≤22px）；H = P1 巨字下方左侧（≤24px）、
 *   P2/P3 左上角同 E；经典 = 页脚署名旁。未上传 ⇒ 四版统一「ID Plan」文字标。
 */

import { useRef, useState } from 'react';

import { ImagePlus, Trash2 } from 'lucide-react';

import { useRepos } from '../../hooks/useRepos';
import { useProjectsStore } from '../../store/useProjectsStore';
import { logUser } from '../../core/services/log.service';
import { usePrintLogo, savePrintLogo } from '../../print/adapters/use-print-logo';
import { processPrintLogoFile, PRINT_LOGO_MAX_CHARS } from '../../lib/print-logo-image';
import { PrintLogoMark } from '../../print/parts/PrintLogoMark';

export function PrintLogoSection(): JSX.Element {
  const repos = useRepos();
  const toast = useProjectsStore((s) => s.pushToast);
  const { logo, reload } = usePrintLogo();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await processPrintLogoFile(file);
      if (!res.ok || !res.dataUrl) {
        toast('error', res.reason ?? 'logo 处理失败');
        return;
      }
      await savePrintLogo(repos, res.dataUrl);
      reload();
      logUser('打印标识', 'logo 已上传（灰度二值化后入 settings KV）');
      toast('success', '打印标识已更新，四版模板与经典纸面同步生效');
    } catch {
      toast('error', '保存失败，请重试');
    } finally {
      setBusy(false);
      // 清空 input：同一文件二次选择也要触发 change
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onRemove = async (): Promise<void> => {
    setBusy(true);
    try {
      await savePrintLogo(repos, '');
      reload();
      logUser('打印标识', 'logo 已删除（回落文字标）');
      toast('info', '已删除，四版将显示「ID Plan」文字标');
    } catch {
      toast('error', '删除失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <ImagePlus size={14} className="text-mist" aria-hidden />
          打印标识
        </h3>
      </div>
      <div className="space-y-3 rounded-[12px] border border-line bg-cream/40 px-3.5 py-3">
        {/* 当前态预览：已上传 = 缩略图；未上传 = 与纸面同款「ID Plan」文字标 */}
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-[8px] border border-line bg-paper">
            <PrintLogoMark logo={logo} height={26} />
          </span>
          <p className="text-[11px] leading-relaxed text-mist">
            {logo ? (
              <>
                已上传。打印时落在四版模板与经典纸面的固定位置
                （经典在页脚署名旁，A 在黑顶栏左端，D 在每页头部左上格，
                E / H 在每页左上角发丝线下方，H 第一页在巨字下方左侧）。
              </>
            ) : (
              <>
                未上传。四版模板与经典纸面统一显示「ID Plan」文字标，不留空。
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand disabled:opacity-60"
          >
            <ImagePlus size={15} className="text-mist" aria-hidden />
            {busy ? '处理中…' : logo ? '更换标识' : '上传标识'}
          </button>
          {logo && (
            <button
              type="button"
              onClick={() => void onRemove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2.5 text-sm text-mist transition-colors hover:bg-sand hover:text-clay disabled:opacity-60"
            >
              <Trash2 size={14} aria-hidden />
              删除
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="hidden"
            aria-label="上传打印标识"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
        </div>

        <p className="text-[11px] leading-relaxed text-mist">
          支持 PNG / JPG / SVG；上传时自动转灰度并二值化（黑白打印可辨），
          限 {Math.round(PRINT_LOGO_MAX_CHARS / 1024)}KB 以内（备份 JSON 不被一张图撑爆，
          随备份换设备恢复）。仅管理员可改。
        </p>
      </div>
    </section>
  );
}
