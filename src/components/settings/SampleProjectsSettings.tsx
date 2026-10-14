/**
 * 内置插件「示例项目」的设置面板（v1.0 · 设置层级重做）
 *
 * 她的原话：「每一个插件都应该有自己对应的设置，它应该是在自己的板块里面」。
 * 这个插件的**唯一贡献点**就是「一键载入示例数据」，原先只有侧栏底部那一枚按钮
 * （`Sidebar.tsx` 里手写的 `sampleProjectsOn && isAdmin` 门控）——本文件把它
 * **同时**作为 `manifest.settingsSlot` 暴露出来：设置 → 插件 → 「示例项目」卡的
 * 齿轮 ⇒ 就地出现这枚按钮 + 一段说明。这样「插件有自己的设置」这件事在
 * sample-projects 上也是真的，而不是只有 agent-board 一家在撑场面。
 *
 * ── 三处口径（都不是新决定，是既有规则的继承）──
 *  ① **管理员门槛保留**：`loadDemo` 走的是 `BackupService.importAndReplace`
 *     （覆盖式全量替换、不可撤销），侧栏入口与首启引导卡都用了 `isAdmin` 门控。
 *     这里照旧门控——**不许**因为「它现在住在插件设置里」就放开；成员身份下
 *     按钮置灰并给 `guide.adminOnlyTitle` 的 tooltip（与 FirstRunGuide 同款）。
 *  ② **零新逻辑**：载入动作与侧栏完全同链路（`useBackupIo().loadDemo`），
 *     含它的二次确认弹窗（`confirmDialog`）与隐藏 file input（`fileInput`）——
 *     两者**必须渲染进 DOM**，否则 `pick()` 之类的调用会静默失效（见 hook 头注释）。
 *  ③ **停用即消失**：插件停用时 `PluginSettingsSlot` 直接返回 null，本面板
 *     根本不会被挂载（`PluginsSection` 会显示一句「插件已停用」占位）。
 */

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { useBackupIo } from '../layout/useBackupIo';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useLang } from '../../i18n';

export function SampleProjectsSettings(): JSX.Element {
  const { t } = useLang();
  const { isAdmin } = useRoleGuard();
  const { loadDemo, fileInput, confirmDialog } = useBackupIo();
  /** 导入中：`loadDemo` 是覆盖式，连点 = 两次全量替换，故点了就锁到自己交代清楚为止 */
  const [busy, setBusy] = useState(false);

  const onLoad = (): void => {
    setBusy(true);
    void loadDemo().finally(() => setBusy(false));
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Sparkles size={14} className="text-mist" aria-hidden />
          {t('sample.title')}
        </h3>
      </div>

      {/*
        ⚠️ 这条文本流会被 tests/i18n-jsx-space.spec.ts 判空格（五个子项都可解释：
        `{t()}` 与行内 `<strong>` 交替）。五段之间的空格**全在取值里**，且中英不同：
          · `lead`  zh `载入 ` / en `Load `      —— 两侧都带**尾随空格**（原文 `载入 <strong>`）
          · `mid`   zh `（跨行业…它是` / en ` (across… It is ` —— **zh 无空格**（`</strong>（` 紧贴），
                    en **前导 + 尾随**各一个（左段是拉丁取值、右段是拉丁取值）
          · `tail`  zh `的：…` / en `: …`     —— 两侧都**不带**空格（`: ` 是右贴标点，不必补）
      */}
      <p className="mb-2 rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
        {t('sample.note.lead')}
        <strong className="text-ink">{t('sample.note.demo')}</strong>
        {t('sample.note.mid')}
        <strong className="text-ink">{t('sample.note.strong')}</strong>
        {t('sample.note.tail')}
      </p>

      <button
        type="button"
        data-sample-projects-load=""
        disabled={busy || !isAdmin}
        title={isAdmin ? t('sidebar.loadDemoTitle') : t('guide.adminOnlyTitle')}
        onClick={onLoad}
        className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Sparkles size={15} className="text-mist" aria-hidden />
        {busy ? t('sample.loading') : t('sidebar.loadDemo')}
      </button>
      {!isAdmin && <p className="mt-1.5 text-[11px] text-mist">{t('guide.adminOnlyTitle')}</p>}

      {/* 与侧栏同一份备份 IO：隐藏 file input + 覆盖式导入二次确认，必须渲染 */}
      {fileInput}
      {confirmDialog}
    </section>
  );
}
