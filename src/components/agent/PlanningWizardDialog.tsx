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
      setIssues(['不是合法的 JSON——请把 AI 回传的整段内容原样粘进来']);
      return;
    }
    let validated;
    try {
      validated = validateAgentPayload(parsed);
    } catch (err) {
      setIssues([err instanceof Error ? err.message : 'payload 校验未通过']);
      return;
    }
    setBusy(true);
    try {
      // 建板（Agent 看板）+ 导入（共享核心：归属门/幂等/留痕全继承）
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
        `已建板并导入 ${result.created} 条任务${result.updated > 0 ? `（更新 ${result.updated}）` : ''}`,
      );
      logUser('规划向导', `建板「${name}」并导入 ${result.created} 条任务`);
      close();
    } catch (err) {
      setIssues([err instanceof Error ? err.message : '落库失败（看板可能已建，请检查）']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={close} ariaLabel="AI 规划向导">
      <div
        data-planning-wizard=""
        className="glass-strong iridescent-border dialog-pop w-[560px] max-w-[92vw] space-y-4 rounded-2xl p-5 shadow-soft"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-pine-soft">
            <Wand2 size={16} className="text-pine" aria-hidden />
          </span>
          <h2 className="font-display text-base font-semibold text-ink">AI 规划向导</h2>
          <ol className="ml-auto flex items-center gap-1 text-[11px] text-mist">
            {(['说想法', '给 AI', '收结果'] as const).map((label, i) => (
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
            ))}
          </ol>
        </div>

        {step === 1 && (
          <div className="space-y-3" data-planning-step="1">
            <p className="text-[13px] leading-relaxed text-mist">
              三步把一个想法变成有任务的 Agent 看板：说清楚想法 → 把指令给你的 AI →
              把它回的 JSON 粘回来。AI 用你自己那个（Claude / WorkBuddy / 别的都行），
              这里不调任何模型、不经手你的数据。
            </p>
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">项目名称（可留空，AI 会起名）</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="如：门店开业筹备"
                className="h-9 w-full rounded-[10px] border border-line bg-paper px-2.5 text-[13px] text-ink outline-none focus:border-pine"
              />
            </label>
            <div>
              <span className="mb-1 block text-[11px] text-mist">所属行业（决定看板列形态与套餐）</span>
              <IndustrySelect value={domain} onChange={setDomain} />
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">我的想法（原文即可，不必工整）</span>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                placeholder="如：先出初版方案给需求方确认，通过后再深化；准备与执行要并行推进；收尾阶段留一周做交付确认。"
                className="w-full resize-y rounded-[10px] border border-line bg-paper px-2.5 py-2 text-[13px] leading-6 text-ink outline-none focus:border-pine"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">我想到的阶段（可空，AI 会调整/补充）</span>
              <input
                value={stageHint}
                onChange={(e) => setStageHint(e.target.value)}
                placeholder="如：概念 → 深化 → 施工图 → 材料 → 施工 → 交付"
                className="h-9 w-full rounded-[10px] border border-line bg-paper px-2.5 text-[13px] text-ink outline-none focus:border-pine"
              />
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-aura flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
              >
                下一步：生成给 AI 的指令
                <ArrowRight size={13} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3" data-planning-step="2">
            <p className="text-[13px] leading-relaxed text-mist">
              复制下面两段（顺序随意）粘给你的 AI，它回一段 JSON 给你。
            </p>
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
                {copied ? '已复制' : '复制我的想法'}
              </button>
              <span className="text-[11px] text-mist">
                完整的 JSON 格式要求在「粘贴面板 → 接入」里（同样的规则，AI 那边需要看）
              </span>
            </div>
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-[10px] px-2.5 py-1.5 text-[12px] text-mist transition-colors hover:bg-sand hover:text-ink"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="btn-aura flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
              >
                下一步：粘回 AI 的结果
                <ArrowRight size={13} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3" data-planning-step="3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-mist">把 AI 回的 JSON 粘到这里（原样）</span>
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
                上一步
              </button>
              <button
                type="button"
                disabled={busy || !payloadText.trim()}
                onClick={() => void onCreate()}
                className="btn-aura flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40 disabled:opacity-40"
              >
                <Sparkles size={13} aria-hidden />
                {busy ? '正在建板并导入…' : '建板并导入'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
