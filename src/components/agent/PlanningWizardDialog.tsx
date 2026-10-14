/**
 * AI 规划向导（v0.8.6 · 竞品三件套之三 · Kanban AI 模式）。
 *
 * ── 抄的是谁 ──
 * Kanban AI（产品调研结论）：贴一段自然语言描述 → AI 拆成分阶段任务卡 →
 * 一键落进看板。开源 PM 完全没有这一步（agent 写入层我们领先，但**从零
 * 建板的入口**是空白：用户面对空库不知道该写什么）。
 *
 * ── 为什么是三步「人出题 → AI 答题 → 人验收」而不是内置 LLM ──
 * 方案 3/2 的安全姿态在此同样成立：向导**不调 LLM**，它做三件确定的事——
 *   ① 把用户的零散想法收成结构（行业 + 目标 + 阶段设想）；
 *   ② 生成一段**带上下文的指令**（PROMPT_TEMPLATE + 用户输入）让他复制给
 *      自己的 Claude/WorkBuddy——他的 key、他的模型、他的数据边界；
 *   ③ 把回传的 payload 过共享核心校验（validateAgentPayload）后落库，
 *      走与 Agent 通道**同一条** applyAgentPayload（归属门/留痕/幂等继承）。
 * 「AI 拆解」这一步在他和 AI 之间完成——我们不托管 key、不经手自然语言。
 *
 * 第四步「粘贴 payload」的能力 ApplyPayloadPanel 已有；本向导做的是
 * **前两步 + 一步建板落库**（从描述直达有数据的看板）。
 */

import { useMemo, useState } from 'react';
import { ArrowRight, Check, ClipboardCopy, Sparkles, Wand2 } from 'lucide-react';

import { Modal } from '../common/Modal';
import { IndustrySelect } from '../contract-wizard/IndustrySelect';
import { cn } from '../../lib/cn';
import { validateAgentPayload } from '../../core/types/agent-payload';
import { applyAgentPayload } from '../../core/agent/payload.apply';
import { createProjectActions } from '../../store/useProjectsStore';
import { domainLabel } from '../../core/template/stage-library';
import { defaultPresetKeyForDomain } from '../contract-wizard/StageSelectPanel';
import { useRepos } from '../../hooks/useRepos';
import { useProjectsStore } from '../../store/useProjectsStore';
import type { StageTemplateDomain } from '../../core/types/dto';
import { logUser } from '../../core/services/log.service';
import { useLang } from '../../i18n';

type Step = 1 | 2 | 3;

/**
 * 带用户上下文的指令（PROMPT_TEMPLATE 的变体：把「我的想法」原样嵌进去）。
 * 模板本体在 ApplyPayloadPanel（单一出处）——本函数只做**上下文注入**，
 * 不复制模板正文（复制=两份模板漂移）。
 */
export function buildPlanningPrompt(params: {
  projectName: string;
  domain: StageTemplateDomain | null;
  idea: string;
  stageHint: string;
}): string {
  const lines = [
    `项目名称：${params.projectName.trim() || '（未命名，请你据需求起名）'}`,
    /*
     * ⚠️ **这里刻意继续用 `domainLabel()`（中文），不改 `domainLabelKey()`** ——
     * 这段拼出来的是**发给外部 Agent 的 prompt 载荷**（读者是对方的模型，不是界面），
     * 把它翻成英文等于把界面语言泄进协议：同一份 prompt 会随用户的界面语言变，
     * 而对方按它判断行业。载荷口径 = 中文，与 `CORE_ERROR_TEXT` / `agent-loopback` 那条边界同一条纪律。
     * ⇒ 全仓 `domainLabel()` 的剩余屏幕侧消费点**只有这一处**（用
     *   `grep -rn "domainLabel\b" src/ | grep -v domainLabelKey` 复核可得）。
     */
    `所属行业：${params.domain ? domainLabel(params.domain) : '（未指定，请你判断）'}`,
    '',
    '我的想法（原文，不要替我改写需求）：',
    params.idea.trim() || '（还没写想法——请按下面的阶段设想给一版）',
  ];
  if (params.stageHint.trim()) {
    lines.push('', '我想到的阶段（可以调整/补充/重排）：', params.stageHint.trim());
  }
  lines.push(
    '',
    '请按上面的信息产出 tasks[]（externalId 用稳定 slug，不要含 runId；日期不确定写 null）。',
  );
  return lines.join('\n');
}

export function PlanningWizardDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}): JSX.Element | null {
  const { t } = useLang();
  const repos = useRepos();
  const pushToast = useProjectsStore((s) => s.pushToast);
  const [step, setStep] = useState<Step>(1);
  const [projectName, setProjectName] = useState('');
  const [domain, setDomain] = useState<StageTemplateDomain | null>(null);
  const [idea, setIdea] = useState('');
  const [stageHint, setStageHint] = useState('');
  const [payloadText, setPayloadText] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const promptText = useMemo(
    () => buildPlanningPrompt({ projectName, domain, idea, stageHint }),
    [projectName, domain, idea, stageHint],
  );

  if (!open) return null;

  const reset = (): void => {
    setStep(1);
    setPayloadText('');
    setIssues([]);
    setCopied(false);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const onCreate = async (): Promise<void> => {
    setIssues([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      setIssues([t('ui.planning.errBadJson')]);
      return;
    }
    let validated;
    try {
      validated = validateAgentPayload(parsed);
    } catch (err) {
      setIssues([err instanceof Error ? err.message : t('ui.planning.errInvalidPayload')]);
      return;
    }
    setBusy(true);
    try {
      // 建板（Agent 看板）+ 导入（共享核心：归属门/幂等/留痕全继承）
      /*
       * ⚠️ 默认板名**有意保持中文**（B 类·落库值）：它作为 `Project.name` **写进库**，
       *    判据是「这个值进不进数据槽」而不是「它长得像不像界面文案」。
       *    清单 v2 §6 把这条判成 A（普查是启发式的，这是它最容易误判的一类），
       *    team-lead 2026-10-15 复核后**收回该判定、改判 B，并批准本处不翻**。
       *    台账：将来随「阶段预设名」那次（存 key + 显示取词 + 数据迁移）一起收拾。
       */
      const name = projectName.trim() || `AI 规划 · ${new Date().toLocaleDateString('zh-CN')}`;
      const preset = defaultPresetKeyForDomain(domain);
      const project = await createProjectActions(repos).createAgentBoard({
        name,
        plannedStartAt: new Date().toISOString().slice(0, 10),
        plannedEndAt: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
        ...(preset ? { presetKey: preset } : {}),
      });
      const result = await applyAgentPayload(repos, validated, { projectId: project.id });
      pushToast(
        'success',
        t('ui.planning.toastImported', { created: result.created }) +
          (result.updated > 0 ? t('ui.planning.toastUpdated', { updated: result.updated }) : ''),
      );
      logUser('规划向导', `建板「${name}」并导入 ${result.created} 条任务`);
      close();
    } catch (err) {
      setIssues([err instanceof Error ? err.message : t('ui.planning.errPersistFailed')]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={close} ariaLabel={t('ui.planning.title')}>
      <div
        data-planning-wizard=""
        className="glass-strong iridescent-border dialog-pop w-[560px] max-w-[92vw] space-y-4 rounded-2xl p-5 shadow-soft"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-pine-soft">
            <Wand2 size={16} className="text-pine" aria-hidden />
          </span>
          <h2 className="font-display text-base font-semibold text-ink">{t('ui.planning.title')}</h2>
          <ol className="ml-auto flex items-center gap-1 text-[11px] text-mist">
            {([t('ui.planning.step1'), t('ui.planning.step2'), t('ui.planning.step3')] as const).map(
              (label, i) => (
                <li key={label} className="flex items-center gap-1">
                  <span
                    className={cn(
                      'rounded-md px-1.5 py-0.5',
                      step === i + 1 ? 'bg-pine-soft font-medium text-pine' : 'text-mist',
                    )}
                  >
                    {i + 1}. {label}
                  </span>
                  {i < 2 && <ArrowRight size={10} aria-hidden />}
                </li>
              ),
            )}
          </ol>
        </div>

        {step === 1 && (
          <div className="space-y-3" data-planning-step="1">
            <p className="text-[13px] leading-relaxed text-mist">{t('ui.planning.intro')}</p>
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">{t('ui.planning.nameLabel')}</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t('ui.planning.namePlaceholder')}
                className="h-9 w-full rounded-[10px] border border-line bg-paper px-2.5 text-[13px] text-ink outline-none focus:border-pine"
              />
            </label>
            <div>
              <span className="mb-1 block text-[11px] text-mist">{t('ui.planning.domainLabel')}</span>
              <IndustrySelect value={domain} onChange={setDomain} />
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">{t('ui.planning.ideaLabel')}</span>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                placeholder={t('ui.planning.ideaPlaceholder')}
                className="w-full resize-y rounded-[10px] border border-line bg-paper px-2.5 py-2 text-[13px] leading-6 text-ink outline-none focus:border-pine"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">{t('ui.planning.stageHintLabel')}</span>
              <input
                value={stageHint}
                onChange={(e) => setStageHint(e.target.value)}
                placeholder={t('ui.planning.stageHintPlaceholder')}
                className="h-9 w-full rounded-[10px] border border-line bg-paper px-2.5 text-[13px] text-ink outline-none focus:border-pine"
              />
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-aura flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
              >
                {t('ui.planning.nextToPrompt')}
                <ArrowRight size={13} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3" data-planning-step="2">
            <p className="text-[13px] leading-relaxed text-mist">{t('ui.planning.copyHint')}</p>
            <pre
              data-planning-prompt=""
              className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[10px] border border-line bg-sunken p-2.5 text-[12px] leading-5 text-ink"
            >
              {promptText}
            </pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(promptText)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
                className="flex items-center gap-1.5 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink transition-colors hover:bg-cream"
              >
                {copied ? <Check size={13} className="text-pine" aria-hidden /> : <ClipboardCopy size={13} aria-hidden />}
                {copied ? t('ui.planning.copied') : t('ui.planning.copyIdea')}
              </button>
              <span className="text-[11px] text-mist">{t('ui.planning.formatHint')}</span>
            </div>
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-[10px] px-2.5 py-1.5 text-[12px] text-mist transition-colors hover:bg-sand hover:text-ink"
              >
                {t('ui.planning.prev')}
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="btn-aura flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
              >
                {t('ui.planning.nextToPaste')}
                <ArrowRight size={13} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3" data-planning-step="3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">{t('ui.planning.pasteLabel')}</span>
              <textarea
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                rows={6}
                placeholder='{"schema":"idplan-agent-payload/v1", ...}'
                className="w-full resize-y rounded-[10px] border border-line bg-paper px-2.5 py-2 font-mono text-[12px] leading-5 text-ink outline-none focus:border-pine"
              />
            </label>
            {issues.length > 0 && (
              <ul className="space-y-0.5 rounded-md border border-clay/40 bg-clay/5 px-2 py-1.5 text-[11px] text-clay">
                {issues.map((i) => (
                  <li key={i}>· {i}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-[10px] px-2.5 py-1.5 text-[12px] text-mist transition-colors hover:bg-sand hover:text-ink"
              >
                {t('ui.planning.prev')}
              </button>
              <button
                type="button"
                disabled={busy || !payloadText.trim()}
                onClick={() => void onCreate()}
                className="btn-aura flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40 disabled:opacity-40"
              >
                <Sparkles size={13} aria-hidden />
                {busy ? t('ui.planning.importing') : t('ui.planning.importAction')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
