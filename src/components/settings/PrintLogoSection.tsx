/**
 * 「打印标识（Logo）」+「海报大字」设置区（产品决策文档 §3.3；规格 §1.4）。
 *
 * ── 为什么住在「排程」分区 ──
 * 设置六区里没有「打印」区；logo 与海报大字服务的是打印输出（排程纸面 +
 * 四版模板），与排程同域。且**排程分区本身仅管理员可见**（v0.8.6.0002 反馈
 * #11 + 图 5 第 3 点：成员看不到排程按钮）⇒ 「管理员可见、成员不可见」的产品
 * 口径由分区角色可见性直接兑现，不另造门控（与休息制度同范式）。海报大字与
 * logo **同区同权限**（规格 §1.4 载荷规则 2：与 logo 同位），故一并住在这里。
 *
 * ── 上传链路（logo）──
 * 选文件 → processPrintLogoFile（灰度 + 阈值二值化 + 体积阶梯 ≤200KB）
 * → settings KV `printLogo` → toast + 重读。上传失败（超限 / SVG 无宽高）
 * 给人话提示，不静默。
 *
 * ── 海报大字链路（规格 §1.4）──
 * 输入 → 去空白 → `savePrintBrandWord`（≤12 字符在保存侧截断）→ toast + 重读。
 * 输入框不设 maxLength：超限要**看得见**（输入框旁即时提示会截断成什么），
 * 静默吞掉用户输入比截断更糟。空值 = 回落 `PLAN`，不是错误。
 *
 * ── 落地位置（决策文档 §3.3 逐版定）──
 * A = 黑顶栏左端（≤24px，反白）；D = 每页头部左上格（≤28px）；
 *   E = 每页左上角发丝线下方（≤22px）；H = P1 巨字下方左侧（≤24px）、
 *   P2/P3 左上角同 E；经典 = 页脚署名旁。未上传 ⇒ 四版统一「ID Plan」文字标。
 * 海报大字只服务 H 版页顶出血巨字（页底 `IDPLAN` 是固定品牌装置，不随其变）。
 */

import { useEffect, useRef, useState } from 'react';

import { ImagePlus, Trash2, Type } from 'lucide-react';

import { useRepos } from '../../hooks/useRepos';
import { useProjectsStore } from '../../store/useProjectsStore';
import { t as translate, useLang } from '../../i18n';
import { logUser } from '../../core/services/log.service';
import { usePrintLogo, savePrintLogo } from '../../print/adapters/use-print-logo';
import {
  DEFAULT_PRINT_BRAND_WORD,
  PRINT_BRAND_WORD_MAX_CHARS,
  isBrandWordOverlong,
  normalizeBrandWord,
  savePrintBrandWord,
  usePrintBrandWord,
} from '../../print/adapters/use-print-brand-word';
import { processPrintLogoFile, PRINT_LOGO_MAX_CHARS } from '../../lib/print-logo-image';
import { PrintLogoMark } from '../../print/parts/PrintLogoMark';

/**
 * 超出上限时的即时提示文案（保存前就能看到会截断成什么）。
 *
 * ⚠️ 取词体例：本函数是**模块级纯函数**（非组件），故用模块级 `translate`
 * （不订阅语言）；**由调用它的组件** `useLang()` 订阅 ⇒ 切语言时整块重渲染，
 * 渲染期那一句 `{overlongHint(draft)}` 会用当时语言重新求值。
 * （同 `src/i18n/labels.ts` 那批 `xxxLabel()` 的既定体例。）
 */
function overlongHint(raw: string): string {
  const kept = normalizeBrandWord(raw);
  return translate('printLogo.brandWord.overlong', {
    kept,
    max: PRINT_BRAND_WORD_MAX_CHARS,
  });
}

export function PrintLogoSection(): JSX.Element {
  const { t } = useLang();
  const repos = useRepos();
  const toast = useProjectsStore((s) => s.pushToast);
  const { logo, reload } = usePrintLogo();
  const { brandWord, reload: reloadBrandWord } = usePrintBrandWord();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* 海报大字：本地草稿。编辑中不被异步重读覆盖，保存 / 失焦后回到受控值 */
  const [draft, setDraft] = useState(brandWord);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(brandWord);
  }, [brandWord, editing]);

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await processPrintLogoFile(file);
      if (!res.ok || !res.dataUrl) {
        toast('error', res.reason ?? t('printLogo.err.processFailed'));
        return;
      }
      await savePrintLogo(repos, res.dataUrl);
      reload();
      logUser('打印标识', 'logo 已上传（灰度二值化后入 settings KV）');
      toast('success', t('printLogo.toast.uploaded'));
    } catch {
      toast('error', t('toast.saveFailedRetry'));
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
      toast('info', t('printLogo.toast.removed'));
    } catch {
      toast('error', t('toast.deleteFailedRetry'));
    } finally {
      setBusy(false);
    }
  };

  const onSaveBrandWord = async (): Promise<void> => {
    setBusy(true);
    try {
      const saved = await savePrintBrandWord(repos, draft);
      reloadBrandWord();
      setEditing(false);
      logUser('打印标识', `海报大字已更新为「${saved}」`);
      toast(
        'success',
        saved === DEFAULT_PRINT_BRAND_WORD
          ? t('printLogo.brandWord.toastCleared', { word: DEFAULT_PRINT_BRAND_WORD })
          : t('printLogo.brandWord.toastSaved', { word: saved }),
      );
    } catch {
      toast('error', t('toast.saveFailedRetry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <ImagePlus size={14} className="text-mist" aria-hidden />
          {t('printLogo.title')}
        </h3>
      </div>
      <div className="space-y-3 rounded-[12px] border border-line bg-cream/40 px-3.5 py-3">
        {/* 当前态预览：已上传 = 缩略图；未上传 = 与纸面同款「ID Plan」文字标 */}
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-[8px] border border-line bg-paper">
            <PrintLogoMark logo={logo} height={26} />
          </span>
          <p className="text-[11px] leading-relaxed text-mist">
            {/*
              ⚠️ 这两支**必须保持 `<>…</>` 片段形态**：`zh-render-diff.mts` 的文本流只有在
              「jsx(Fragment, {children: …})」这一层才看得见 —— 写成裸三元
              `{logo ? t('a') : t('b')}` 会让探针**一条都采不到**（它不解释三元），
              于是这一整段文案就脱离了「渲染态逐字」那层自证（实测：改裸三元后探针报
              「仅在旧」两条）。片段在这里同时是**可证明性**的载体。
            */}
            {logo ? (
              <>{t('printLogo.status.uploaded')}</>
            ) : (
              <>{t('printLogo.status.empty')}</>
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
            {busy
              ? t('printLogo.processing')
              : logo
                ? t('printLogo.replace')
                : t('printLogo.upload')}
          </button>
          {logo && (
            <button
              type="button"
              onClick={() => void onRemove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2.5 text-sm text-mist transition-colors hover:bg-sand hover:text-clay disabled:opacity-60"
            >
              <Trash2 size={14} aria-hidden />
              {t('printLogo.remove')}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="hidden"
            aria-label={t('printLogo.uploadAria')}
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
        </div>

        <p className="text-[11px] leading-relaxed text-mist">
          {t('printLogo.support.note', { kb: Math.round(PRINT_LOGO_MAX_CHARS / 1024) })}
        </p>
      </div>

      {/* 海报大字（规格 §1.4）：H 版页顶出血巨字的载荷；与 logo 同区同权限 */}
      <div className="mb-2 mt-4 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Type size={14} className="text-mist" aria-hidden />
          {t('printLogo.brandWord.title')}
        </h3>
      </div>
      <div className="space-y-3 rounded-[12px] border border-line bg-cream/40 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            disabled={busy}
            aria-label={t('printLogo.brandWord.aria')}
            placeholder={DEFAULT_PRINT_BRAND_WORD}
            onChange={(e) => {
              setEditing(true);
              setDraft(e.target.value);
            }}
            className="min-w-0 flex-1 rounded-[10px] border border-line bg-paper px-3 py-2.5 text-sm font-medium text-ink placeholder:text-mist focus:border-clay focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void onSaveBrandWord()}
            disabled={busy || (!editing && draft === brandWord)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand disabled:opacity-60"
          >
            {t('common.save')}
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-mist">
          {t('printLogo.brandWord.note', {
            word: DEFAULT_PRINT_BRAND_WORD,
            max: PRINT_BRAND_WORD_MAX_CHARS,
          })}
        </p>
        {isBrandWordOverlong(draft) && (
          <p className="text-[11px] leading-relaxed text-clay" role="status">
            {overlongHint(draft)}
          </p>
        )}
      </div>
    </section>
  );
}
