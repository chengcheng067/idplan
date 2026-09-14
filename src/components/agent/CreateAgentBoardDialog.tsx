/**
 * 「新建 Agent 看板」表单（v0.8 · T04-B；设计 §6.1 时序图第 1–3 步、§7.4、PRD B7–B10 / TS-08 / D5）。
 *
 * ══════════════════════════ 这个组件在设计里的位置 ══════════════════════════
 *
 * §6.1 的时序图逐行就是本组件的职责：
 *   `U->>P: 点「新建 Agent 看板」`
 *   `P->>P: 表单：名称 + 起止日期 + 阶段集合(显式声明，缺一即拒)`
 *   `P->>S: createAgentBoard(cmd)`
 * 它是**第 3 条建档路径**（另两条是合同向导与手动兜底，都只建人类项目）。
 *
 * ── 分层纪律：本组件**不直接**调 service ──
 * 调的是 store action（`createProjectActions(repos).createAgentBoard`），
 * 与 `ManualFallbackForm.tsx` 调 `actions.createManual` 同一形状。service 只做
 * 「领域规则 + 落库」，store 负责「刷新镜像 + toast」—— 把这条边界守着，
 * 就不会出现"某个页面自己写了一套刷新逻辑、另一处忘了刷"的漂移。
 *
 * ══════════════════════════ ★ 本表单**一律不预填**（与 `ManualFallbackForm` 的刻意差异）══════════════════════════
 *
 * 三件必填项 —— 名称 / 起止日期 / 阶段集合 —— 初始值**全是空的**：
 *
 *   · **日期不预填**：PRD B9 原文「缺日期 → 明确报错、**不得**默认日期」。
 *     猜一个起止日期会让排期与真实意图不符，而错误的日期会一路传染到阶段切分、
 *     甘特、打印稿，且**不报错**。所以 `plannedStartAt = ''`（**不是**今天）。
 *   · **阶段集合不预填**：§6.1 的措辞是「阶段集合(**显式声明**，缺一即拒)」。
 *     预选一个套餐 = 替用户猜了一个行业（室内九段？景观？），用户没改就提交、
 *     界面上没有任何迹象说明"这九段是系统替他挑的"。空集合 + 阻塞提交，
 *     把"选阶段"变成一次**显式动作**，与 service 的"三处不猜"同一条policy。
 *   · **名称不预填**：无可用默认值（猜名字没有意义）。
 *
 * ⚠️ 这与 `ManualFallbackForm`（预选 `indoor_full` 九段、预填今天为开始日）**行为不同**，
 * 是**刻意的**：手动建档的语义是「快速建一个人类项目」，给默认值是便利；Agent 建板的
 * 语义是「外部写入方/用户显式声明这块看板长什么样」，给默认值就是猜测。
 * 两处的差别只在这一个 policy 上，组件复用（`DomainCascade` / `StageSelectPanel`）不受影响。
 *
 * ══════════════════════════ 阶段集合 → 命令：为什么"精确命中套餐"与"自由组合"分开走 ══════════════════════════
 *
 * `createAgentBoard` 的入参是 `presetKey?` 与 `stageNames?`（**二选一即可**，见其注释），
 * 不是"阶段项数组"——因为服务端要通过**摘要口径**收口（套餐靠 key 取库项、声明名靠名字反查）。
 * 于是本表单做一次映射（`toAgentBoardCmd`，纯函数、可直测）：
 *
 *   · 选中集**恰好等于**某个内置套餐（`presetKeyOfItems` 顺序敏感匹配）⇒ 只送 `presetKey`。
 *     这样 `Project.stagePresetKey` 落的是真套餐 key、`domain` 由套餐推导 —— 保住了溯源。
 *   · 否则（自由组合/含自定义阶段）⇒ 只送 `stageNames`（按序）。
 *     服务端逐名反查：库里有的名字用**库项**（占比/色号/默认任务都来自库），
 *     库里没有的建为**自定义阶段**（`templateKey` 归 `null`，即 PRD B8 的
 *     `stageNames=[提案,消防报审] → 2 段且后者 templateKey=null`）。
 *
 * ⚠️ **不能两样都送**。若在精确命中套餐时**同时**送 9 个名字，服务端会判定
 * `declaredNames.length > 0` 而把 `Project.stagePresetKey` 记成 `'custom'` ——
 * 套餐溯源**静默丢失**（阶段数还是 9，看不出问题）。这是"接口两个字段都能收"
 * 最容易踩的一脚，故在这里显式二选一，并由单测把两条分支都钉住。
 *
 * ══════════════════════════ 复用既有建档构件，不新写第二套 ══════════════════════════
 *
 * 阶段池用 `StageSelectPanel`，板块导航用 `DomainCascade` —— 与向导、手动兜底**同一条路径**。
 * 自己再写一套勾选 UI 就等于复制「上限 20 / 重名校验 / 套餐推导 / 板块过滤」四份口径，
 * 而这类复制品的失效方式全部是**静默的**（少一段、多一段，都不抛错）。
 *
 * ── `DomainCascade` 在本表单里的语义：**只是阶段池的筛选器**（一个刻意的澄清）──
 * Agent 建板请求里**没有板块字段**（B9 只要求名称/日期/阶段集合），所以级联的选择
 * **不会**直接写进 `Project.domain`；`domain` 由服务端按 `presetKey` 推导
 * （自由组合 ⇒ `null`，读时回落链照旧兜住 —— 与"不猜"一致）。
 * 留它是为了让用户能跨行业找阶段（`visibleDomainsOf(cascade)` 决定哪些分组可见），
 * 这正是 `StageSelectPanel` 的 `domain` / `visibleDomains` 两个 prop 的用途。
 * ⚠️ 因此界面上**不**出现"主板块"这种会让人以为会落库的措辞。
 *
 * ── 自定义阶段：加得进来，但**不写复用池**（这是与 `ManualFallbackForm` 的关键差别）──
 * 手动兜底里 `handleAddCustomStage` 会调 `rememberCustomStage(...)` 把新阶段记进
 * `settings` KV 的复用池 —— 那池子是**人类侧建档**用的（T03 的 `listReusableCustomStages`）。
 * 若 Agent 侧也往里写，Agent 工作区就会往人类工作区**留下数据**，正是 v0.8 在拆的
 * 那种跨工作区耦合（只是方向相反，且不在 §7.2 的 27 项里，不会有守卫报红）。
 * 故本表单只在**内存**里追加该阶段：它照样能经 `stageNames` 落成 `templateKey=null`
 * 的自定义阶段（B8 的路径完整保留），但**不产生任何跨工作区写入**。
 */

import { useState } from 'react';

import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';

import type { StageSelectionItem } from '../../core/types/dto';
import { ChangxiaError, ChangxiaErrorCode } from '../../core/types/enums';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT } from '../../core/template/split';
import { CUSTOM_STAGE_PRESET_KEY, DEFAULT_PROJECT_DOMAIN } from '../../core/template/stage-fallback';
import {
  createCustomStageDef,
  customStageToSelectionItem,
} from '../../core/services/custom-stage.service';
import type { CreateAgentBoardCmd } from '../../core/services/project.service';
import { createProjectActions } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { toIsoDate } from '../../lib/date';
import {
  duplicateStageNames,
  presetKeyOfItems,
  StageSelectPanel,
} from '../contract-wizard/StageSelectPanel';
import {
  DEFAULT_DOMAIN_CASCADE,
  DomainCascade,
  visibleDomainsOf,
  type DomainCascadeValue,
} from '../contract-wizard/DomainCascade';
import type { CustomStageDraft } from '../contract-wizard/CustomStageDialog';
import { Modal } from '../common/Modal';
import { ImeInput } from '../common/ImeInput';

/**
 * 表单草稿（**未经校验**的原始输入）。
 *
 * 抽出来是为了让「校验」与「命令组装」两个纯函数有同一个入参形状，
 * 从而都能不经组件 DOM 直接单测（见文件尾的 `validateAgentBoardDraft` / `toAgentBoardCmd`）。
 */
export interface AgentBoardDraft {
  name: string;
  /** 原始输入（`YYYY-MM-DD` 或 `''`）；**绝不预填**，见文件头 */
  plannedStartAt: string;
  plannedEndAt: string;
  stageItems: readonly StageSelectionItem[];
}

/**
 * 校验表单草稿，返回**第一条**用户可读的错误；全部通过返回 `null`。
 *
 * 为什么返回"第一条"而不是错误数组：表单只有一个错误展示位，
 * 一次说清一件事比堆一串更可操作（用户改完第一条再看到第二条也算正常节奏）。
 * 顺序刻意与用户填写的自然顺序一致：名称 → 日期 → 阶段。
 *
 * ⚠️ 这里的每条判据都与 **`createAgentBoard` 的校验保持同向**（不是替代）：
 * 表单层负责"早说、说得具体"，服务端那层负责"不猜"（它才是真正的边界，
 * 因为 API 调用方绕过本表单直接调 service）。两层都做，不做其中一层。
 */
export function validateAgentBoardDraft(draft: AgentBoardDraft): string | null {
  if (draft.name.trim() === '') {
    return '请填写看板名称。';
  }
  const startIso = toIsoDate(draft.plannedStartAt);
  if (!startIso) {
    // 文案明确点出"不会自动填默认日期"，否则用户会以为是自己没看到默认值
    return '请选择开始日期（本表单不会自动填写默认日期）。';
  }
  const endIso = toIsoDate(draft.plannedEndAt);
  if (!endIso) {
    return '请选择结束日期（本表单不会自动填写默认日期）。';
  }
  if (endIso < startIso) {
    return '结束日期不能早于开始日期。';
  }
  if (draft.stageItems.length < MIN_STAGE_COUNT) {
    return `请至少选择 ${MIN_STAGE_COUNT} 个阶段。`;
  }
  if (draft.stageItems.length > MAX_STAGE_COUNT) {
    return `单次最多 ${MAX_STAGE_COUNT} 个阶段。`;
  }
  // 空名阶段：`duplicateStageNames` 会跳过空名（它只判重名），故这里单独兜一次。
  // 漏掉的话会落一个无名阶段 —— 它不报错，但在看板/时间轴上是"看不见的一段"。
  if (draft.stageItems.some((it) => it.name.trim() === '')) {
    return '阶段名称不能为空。';
  }
  const duplicates = duplicateStageNames(draft.stageItems);
  if (duplicates.length > 0) {
    return `阶段名重复：${duplicates.join('、')}，请改名后再提交。`;
  }
  return null;
}

/**
 * 草稿 → `createAgentBoard` 命令（纯函数，可直测）。
 *
 * 前置：调用方**必须先**过 `validateAgentBoardDraft`（本函数只负责组装，
 * 不重复校验；日期非法时抛 `ChangxiaError.Validation` 作为最后一道兜底）。
 *
 * 两个分支的取舍见文件头「阶段集合 → 命令」。核心不变量：
 * **`presetKey` 与 `stageNames` 永远不会同时出现**。
 */
export function toAgentBoardCmd(draft: AgentBoardDraft): CreateAgentBoardCmd {
  const startIso = toIsoDate(draft.plannedStartAt);
  const endIso = toIsoDate(draft.plannedEndAt);
  if (!startIso || !endIso) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      '请选择有效的开始日期与结束日期（不会自动填充默认日期）。',
    );
  }
  const name = draft.name.trim();
  // `presetKeyOfItems` 顺序敏感匹配内置套餐；未命中时返回 `CUSTOM_STAGE_PRESET_KEY`（'custom'）
  const presetKey = presetKeyOfItems([...draft.stageItems]);

  if (presetKey !== CUSTOM_STAGE_PRESET_KEY) {
    // 精确命中套餐：**只**送 presetKey（保住 stagePresetKey 溯源与 domain 推导）
    return { name, plannedStartAt: startIso, plannedEndAt: endIso, presetKey };
  }
  // 自由组合：**只**送声明名（服务端逐名反查库项，库里没有的建为自定义阶段）
  return {
    name,
    plannedStartAt: startIso,
    plannedEndAt: endIso,
    stageNames: draft.stageItems.map((it) => it.name.trim()).filter((n) => n !== ''),
  };
}

/**
 * 建板提交的结果（供调用方分流"关窗 + 选中"与"就地报错"）。
 */
export type AgentBoardSubmitResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string };

/**
 * 建板提交的**完整决策路径**：校验 → 组装命令 → 调写入方。
 *
 * 为什么把它抽成独立函数（而不是全塞在组件的 `submit` 里）：
 *   「缺日期/缺名称/零阶段 ⇒ **根本不提交**」这条行为是本任务的核心验收项，
 *   而它恰好是**最容易被写成假绿**的那种断言 —— 只看纯函数的返回值，证明不了
 *   "写入没发生"。把写入方作为**入参**注入后，测试可以传一个计数器替身，
 *   直接断言「校验不过时 `create` 一次都没被调用」，从而证明**零写入**。
 *
 * 这与真正组件的关系：组件 `submit()` 就调这一个函数（写入方传的是
 * `createProjectActions(repos).createAgentBoard`）。故本函数的被测路径 **就是**
 * 生产路径，不是它的复制品 —— 但它是**逻辑级**验证，**未经组件 DOM 挂载**
 * （见文件尾 spec 的诚实标注）。
 *
 * 错误一律**不抛**，转成 `{ ok:false, error }`：调用方（组件）只需一次 `if`，
 * 不必再包 try/catch —— 也避免"同一段错误处理写两遍"（两遍必然漂移）。
 */
export async function submitAgentBoardDraft(
  draft: AgentBoardDraft,
  create: (cmd: CreateAgentBoardCmd) => Promise<{ id: string }>,
): Promise<AgentBoardSubmitResult> {
  const message = validateAgentBoardDraft(draft);
  if (message) {
    // ★ 提前返回：**没有**调用 `create`。这是"缺一即拒"的落点（零写入）。
    return { ok: false, error: message };
  }
  try {
    const cmd = toAgentBoardCmd(draft);
    const project = await create(cmd);
    return { ok: true, projectId: project.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ChangxiaError ? err.userMessage : '创建看板失败，请重试。',
    };
  }
}

export function CreateAgentBoardDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  /** 建板成功（项目已落库、store 已刷新）。由页面决定"跳到/选中新看板" */
  onCreated(projectId: string): void;
}): JSX.Element | null {
  const repos = useRepos();

  const [name, setName] = useState('');
  /** ★ 空字符串 = 未选。**绝不预填**（B9：不得默认日期），见文件头 */
  const [plannedStartAt, setPlannedStartAt] = useState('');
  const [plannedEndAt, setPlannedEndAt] = useState('');
  /** ★ 空数组 = 未选。**绝不预选套餐**（§6.1「显式声明」），见文件头 */
  const [stageItems, setStageItems] = useState<StageSelectionItem[]>([]);
  /** 阶段池的板块筛选器（**不落库**，只是"看得见哪些分组"，见文件头） */
  const [cascade, setCascade] = useState<DomainCascadeValue>(DEFAULT_DOMAIN_CASCADE);
  /** 本次新增的自定义阶段（**仅内存**，不写跨工作区复用池，见文件头） */
  const [customStages, setCustomStages] = useState<StageSelectionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 阶段区默认**展开**：本表单不预选阶段，收起状态下提交按钮恒灰而无提示，用户会以为坏了 */
  const [stagePanelOpen, setStagePanelOpen] = useState(true);

  /**
   * 追加自定义阶段（A8 / TBD-1：仅建档时）。**刻意不调 `rememberCustomStage`** —— 见文件头
   * 「自定义阶段：加得进来，但不写复用池」。落库路径不受影响：它以 `cst.<id>` 为 key，
   * 经 `stageNames` 交给服务端后由 `normalizeDraftTemplateKey` 归成 `templateKey=null`。
   */
  const handleAddCustomStage = (draft: CustomStageDraft): void => {
    if (stageItems.length >= MAX_STAGE_COUNT) {
      setError(`单次最多 ${MAX_STAGE_COUNT} 个阶段。`);
      return;
    }
    const def = createCustomStageDef({
      name: draft.name,
      ratioPercent: draft.ratioPercent,
      colorMain: draft.customColor,
    });
    const item = customStageToSelectionItem(def, {
      domain: cascade.domain ?? DEFAULT_PROJECT_DOMAIN,
      colorIndex: draft.colorIndex,
    });
    setCustomStages((prev) => [...prev, item]);
    setStageItems((prev) => [...prev, item]);
    setError(null);
  };

  // ★ `if (!open)` 必须在**所有 hook 之后**（hook 顺序稳定，本项目曾因此栽过整页白屏）
  if (!open) return null;

  const submit = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    const result = await submitAgentBoardDraft(
      { name, plannedStartAt, plannedEndAt, stageItems },
      (cmd) => createProjectActions(repos).createAgentBoard(cmd),
    );
    setSubmitting(false);
    if (!result.ok) {
      // 展示服务端的真实原因（含 userMessage）。store action 已 toast 一次，
      // 这里再就地在表单里显示 —— 表单是用户此刻正在看的地方，
      // 不能只靠 2s 就消失的 toast 让他自己去回想哪里错了。
      setError(result.error);
      return;
    }
    // 成功后清空：关掉再打开应是**一张干净的表**，而不是上一次的残留。
    // （失败时**刻意不清**：用户填了半天的内容必须留着，与
    //   `ApplyPayloadPanel` 的"失败保留输入"同一约定。）
    setName('');
    setPlannedStartAt('');
    setPlannedEndAt('');
    setStageItems([]);
    setCustomStages([]);
    setCascade(DEFAULT_DOMAIN_CASCADE);
    onClose();
    // 组件不自己发明"跳到新看板"的路由 —— 只用页面已有的选中机制（setCurrentProject），见 AgentBoardPage
    onCreated(result.projectId);
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel="新建 Agent 看板">
      <div
        data-create-agent-board-dialog=""
        className="glass-strong iridescent-border dialog-pop flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl shadow-soft"
      >
        {/* 描边挂在外层固定框；滚动交给内层（同 ManualFallbackForm，避免虹彩描边随内容断层） */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-display-md">新建 Agent 看板</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭新建 Agent 看板"
              className="rounded-md p-1 text-mist hover:bg-sand"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">看板名称 *</span>
              <ImeInput
                value={name}
                aria-label="看板名称"
                onChange={(e) => setName(e.target.value)}
                placeholder="如「某某项目 · 排期」"
                className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">开始日期 *</span>
              <input
                type="date"
                value={plannedStartAt}
                aria-label="开始日期"
                onChange={(e) => setPlannedStartAt(e.target.value)}
                className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">结束日期 *</span>
              <input
                type="date"
                value={plannedEndAt}
                aria-label="结束日期"
                onChange={(e) => setPlannedEndAt(e.target.value)}
                className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
              />
            </label>
          </div>

          {/*
            「不预填」的显式说明：本表单三件必填项初始全空，若不写一句，
            用户可能以为界面还没加载完（这是刻意的差异，就要说出来）。
          */}
          <p className="mt-2 text-xs leading-5 text-mist">
            名称、起止日期与阶段集合都需显式填写，系统不会替你填默认值。
          </p>

          {/* 板块筛选器：**只影响阶段池可见范围**，不写入看板归属（见文件头澄清） */}
          <div className="mt-4 rounded-md border border-line bg-cream/40 p-3">
            <p className="mb-2 text-xs leading-5 text-mist">
              下面只用来筛出要用的阶段分组，不会改变看板归属。
            </p>
            <DomainCascade value={cascade} onChange={setCascade} />
          </div>

          {/* 阶段选择（复用 StageSelectPanel —— 与向导/手动兜底同一条路径） */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setStagePanelOpen((v) => !v)}
              aria-expanded={stagePanelOpen}
              className="flex w-full items-center justify-between rounded-md border border-line bg-cream px-3 py-2 text-sm text-ink hover:bg-sand"
            >
              <span>
                看板阶段 * · 已选 {stageItems.length} 项
                <span className="ml-2 text-xs text-mist">
                  {stageItems.length === 0 ? '（请至少选择 1 项）' : `（上限 ${MAX_STAGE_COUNT}）`}
                </span>
              </span>
              {stagePanelOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {stagePanelOpen && (
              <div className="mt-2 rounded-md border border-line bg-paper p-3">
                <StageSelectPanel
                  selected={stageItems}
                  onChange={setStageItems}
                  /*
                   * ⚠️ 刻意**不传** `projectType`：那是"跟随项目类型自动预选套餐"的开关，
                   * 与本表单「阶段集合必须显式声明」的 policy 正面冲突（见文件头）。
                   * 不传 ⇒ StageSelectPanel 的自动预选 effect 直接 return（它判 `undefined`）。
                   */
                  domain={cascade.domain}
                  visibleDomains={visibleDomainsOf(cascade)}
                  customStages={customStages}
                  onCustomStageSubmit={handleAddCustomStage}
                />
              </div>
            )}
          </div>

          {error && (
            <p
              role="alert"
              data-create-agent-board-error=""
              className="mt-3 text-sm leading-6 text-clay"
            >
              {error}
            </p>
          )}

          {/*
            提交按钮**不因校验失败而 disabled**：与 `ManualFallbackForm` 的写法一致，
            点下去由 `validateAgentBoardDraft` 给出**具体**原因（"缺哪个字段"）。
            只把它置灰而不说原因，用户面对的是"按钮点不动且没人解释"。
            唯一例外是 `submitting`（防重复提交，此时也不是"校验失败"）。
          */}
          <button
            type="button"
            data-create-agent-board-submit=""
            disabled={submitting}
            onClick={() => void submit()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-pine px-4 py-2 text-sm text-white hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={15} /> {submitting ? '创建中…' : '创建看板'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
