/**
 * 演示数据运行时工厂（0.8.5 · demo 中立化路线 A，产品官方案）。
 *
 * ── 它替代什么 ──
 * 旧形态：`public/demo-backup.json` 静态文件（116KB，5 个**全室内**项目，
 * 由 `scripts/gen_demo_backup.py` 离线生成）。问题：①行业不中立（全行业
 * 软件的示例数据全是室内）；②手写内容与 `templates/stage-library.json`
 * 重复造轮（DRY 违背）；③日期写死会过期（旧脚本的锚点是生成日）。
 *
 * 新形态：**运行时从阶段库动态生成**。阶段/任务/看板列全部取阶段库现成
 * 定义（原 indoor TASK_POOL 是重复造内容的第二份），日期以 today 为锚
 * 动态推算 —— demo 永远与行业库同步、永不过期、零静态文件。
 *
 * ── 与既有链路的接法（不新造导入路径） ──
 * 产物是**标准 BackupPackage**（schemaVersion 现版本），过与真实备份
 * 同一套 `validateBackupJson` zod 校验，走同一 `importAndReplace` 链路
 * ——roundtrip spec 钉死的那条路，零新增数据面代码。
 *
 * ── 行业中立（本文件的存在理由） ──
 * 5 个演示项目覆盖**五种看板列形态**（软件五列 / 市场六列 / 影视四列 /
 * 旅游四列 / 室内三段），陌生用户不论做哪行都能看到「自己那行」长什么样。
 *
 * ── 2026-10-13 · 全部中性化（公开仓库前的脱敏）──
 * 旧版本的项目名/客户名是**带行业味的品牌名 + 疑似真实甲方**，地址也是真实街道。
 * 本文件要进公开仓库，这些名字必须清零。
 *
 * ⚠️ **这里故意不复述旧名单**：把要清掉的名字写进源码或提交信息，等于把它们再公开一次
 * （本批第一版就犯过这个错 —— 为了让"清理清单完整"，把名字逐条抄进了注释与提交信息）。
 * 旧值只留在**已推送的 git 历史**里；当前源码、注释、演示包内一律不得出现。
 * 现在起必须满足的形态：
 *   · 项目名 → 「演示项目1」～「演示项目5」；
 *   · 客户名 → 「演示客户公司甲/乙/丙/丁/戊」；
 *   · 地址   → 「（演示地址）」（不再出现任何真实街道 / 园区）；
 *   · 成员   → 「**角色 + 天干**」（负责人甲 / 执行乙 / 协作丙 / 评审丁 / 统筹戊）——
 *             中立角色词、零岗位词（旧的「陈工·方案设计」「郑工·现场管理」是建筑
 *             岗位味），且**五个名字的首字互不相同**：头像取 `name[0]`（AvatarStack），
 *             中间那版命名「演示成员甲…戊」首字全是「演」⇒ 五个头像字一模一样。
 * **presetKey 一个未改**（5 个 preset 仍覆盖五种看板列形态，那是既有判据）；
 * 只把**顺序**调了，首位由 `indoor_full` 换成 `software_mobile_full`
 * （旧注释「室内放首位——主场不丢」作废：这是跨行业工具，且要弱化建筑味）。
 * 防回潮由 `tests/demo-data.spec.ts` 的禁词表 + 形态正向锁（项目/客户/成员名
 * 各有规定形态）+「成员首字两两不同」锁住。
 */

import { getPresets, getPresetItems } from '../template/stage-library';
import type { StagePreset, StageTemplateItem, BackupPackage } from '../types/dto';
import { StageStatus, ScheduleBasis, MemberRoleKind } from '../types/enums';
import type { Project, Stage, Task, Member } from '../types/entities';

/** 演示项目选用的五个 preset（覆盖五种 columns 形态；首位 = 软件开发，建筑域排末位） */
export const DEMO_PRESETS: ReadonlyArray<{ presetKey: string; label: string }> = [
  { presetKey: 'software_mobile_full', label: '软件开发' },
  { presetKey: 'marketing_launch_full', label: '市场活动' },
  { presetKey: 'film_promo_full', label: '影视制作' },
  { presetKey: 'travel_fit', label: '旅游出行' },
  { presetKey: 'indoor_full', label: '室内设计' },
];

/**
 * 演示成员（脱敏：一律「**角色 + 天干**」形态 + demo.local 域）。
 * 为什么不是「演示成员甲/乙/丙/丁/戊」：头像取 `name[0]`，那种命名五个头像全是
 * 「演」，只能靠颜色区分；改成「负责人甲 / 执行乙 / …」后首字 负/执/协/评/统 各不相同。
 * 旧的「陈工 / 周工 / 吴工 / 郑工」+「方案设计 / 深化设计 / 现场管理」是
 * 真实姓名尾字 + 建筑岗位名，公开仓库不能留。
 */
const DEMO_MEMBERS: ReadonlyArray<Pick<Member, 'id' | 'name' | 'role' | 'contact' | 'avatarColor' | 'roleKind'>> = [
  { id: 'demo_admin', name: '负责人甲', role: '负责人', contact: 'admin@demo.local', avatarColor: '#5B8C5A', roleKind: MemberRoleKind.Admin },
  { id: 'demo_m1', name: '执行乙', role: '执行', contact: 'member-b@demo.local', avatarColor: '#B25C5C', roleKind: MemberRoleKind.Member },
  { id: 'demo_m2', name: '协作丙', role: '协作', contact: 'member-c@demo.local', avatarColor: '#5C7A9E', roleKind: MemberRoleKind.Member },
  { id: 'demo_m3', name: '评审丁', role: '评审', contact: 'member-d@demo.local', avatarColor: '#C98D5B', roleKind: MemberRoleKind.Member },
  { id: 'demo_m4', name: '统筹戊', role: '统筹', contact: 'member-e@demo.local', avatarColor: '#7A6BAC', roleKind: MemberRoleKind.Member },
];

const NOW = (): string => new Date().toISOString();

/** today（本地时区 YYYY-MM-DD）——demo 日期锚 */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** today + offsetDays（YYYY-MM-DD） */
function shiftIso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface StagePlan {
  item: StageTemplateItem;
  startAt: string;
  endAt: string;
  status: StageStatus;
}

/**
 * 排一份项目的阶段计划：跨度按 preset 长度估（每段 2 周），
 * 当前阶段（status=in_progress）精确落在 today 附近——各项目错峰
 * （offsetShift）使 5 个项目分布在不同的看板列。
 */
function planStages(preset: StagePreset, projectStartOffset: number): StagePlan[] {
  const items = getPresetItems(preset.key);
  const per = 14; // 每段基准 14 天
  const total = items.length;
  // 当前进行中的段号：错峰（室内=2/软件=4/市场=3/影视=5/旅游=4，1-based）
  const inProgressAt = Math.min(Math.max(Math.round(total * 0.4), 1), total);
  return items.map((item, i) => {
    const startAt = shiftIso(projectStartOffset + i * per);
    const endAt = shiftIso(projectStartOffset + i * per + per - 1);
    let status: StageStatus = StageStatus.NotStarted;
    if (i + 1 < inProgressAt) status = StageStatus.Completed;
    else if (i + 1 === inProgressAt) status = StageStatus.InProgress;
    return { item, startAt, endAt, status };
  });
}

interface DemoProjectSpec {
  presetKey: string;
  name: string;
  clientName: string;
  address: string;
  contractAmount: number | null;
  startOffset: number;
  spanDays: number;
  /**
   * 首页卡片排序键（1-based，越小越靠前）。
   *
   * 为什么需要它：首页项目列表按 `updatedAt` **降序**排（`local.projects.repo.list`），
   * 而工厂原先给 5 个项目写的是**同一个** `updatedAt` ⇒ 相等时顺序退化成
   * 「Dexie 主键序」（id 里的 presetKey 字母序），与 DEMO_SPECS 的声明顺序无关。
   * 本次把首位从 `indoor_full` 换成 `software_mobile_full`，若不钉住顺序，
   * 「软件开发优先」在界面上并不成立。故按 order 错峰 1 分钟写入 updatedAt。
   */
  order: number;
}

/**
 * 五个演示项目的元数据（顺序 = 首页卡片顺序 = `order` 升序，见下方 updatedAt 错峰）。
 * 名称 / 客户 / 地址全部中性：项目「演示项目N」、客户「演示客户公司<天干>」、
 * 地址一律「（演示地址）」——**不再出现任何真实公司名 / 街道 / 园区 / 景区**。
 * `startOffset` / `spanDays` / `contractAmount` 沿用改造前各 preset 的取值（按 preset 归属搬过来）。
 */
const DEMO_SPECS: ReadonlyArray<DemoProjectSpec> = [
  { presetKey: 'software_mobile_full', name: '演示项目1', clientName: '演示客户公司甲', address: '（演示地址）', contractAmount: 150000, startOffset: -42, spanDays: 126, order: 1 },
  { presetKey: 'marketing_launch_full', name: '演示项目2', clientName: '演示客户公司乙', address: '（演示地址）', contractAmount: 280000, startOffset: -21, spanDays: 98, order: 2 },
  { presetKey: 'film_promo_full', name: '演示项目3', clientName: '演示客户公司丙', address: '（演示地址）', contractAmount: 96000, startOffset: -35, spanDays: 112, order: 3 },
  { presetKey: 'travel_fit', name: '演示项目4', clientName: '演示客户公司丁', address: '（演示地址）', contractAmount: 0, startOffset: 14, spanDays: 84, order: 4 },
  { presetKey: 'indoor_full', name: '演示项目5', clientName: '演示客户公司戊', address: '（演示地址）', contractAmount: 420000, startOffset: -56, spanDays: 168, order: 5 },
];

/** id 前缀保持与真库一致的形态直觉（proj_/stg_/task_），前缀 demo_ 防与真数据撞 */
const P = (presetKey: string, n: number): string => `demo_${presetKey.replace(/[^a-z]/g, '')}_${n}`;

/**
 * 生成演示 BackupPackage（每次调用都是一份**全新时间锚**的包）。
 *
 */
export function buildDemoBackup(): BackupPackage {
  const now = NOW();
  const projects: Project[] = [];
  const stages: Stage[] = [];
  const tasks: Task[] = [];

  DEMO_SPECS.forEach((spec, pi) => {
    const preset = getPresets().find((p) => p.key === spec.presetKey);
    if (!preset) return; // 阶段库缺 preset 时跳过（不造悬空数据）
    const plans = planStages(preset, spec.startOffset);
    const projectId = P(spec.presetKey, pi);
    const startAt = plans[0]?.startAt ?? todayIso();
    const endAt = plans[plans.length - 1]?.endAt ?? shiftIso(spec.spanDays);
    // order 越小 → updatedAt 越新 → 首页列表（按 updatedAt 降序）越靠前
    const projectUpdatedAt = new Date(Date.parse(now) - (spec.order - 1) * 60_000).toISOString();

    projects.push({
      id: projectId,
      name: spec.name,
      address: spec.address,
      clientName: spec.clientName,
      contractAmount: spec.contractAmount,
      signedAt: shiftIso(spec.startOffset - 7),
      plannedStartAt: startAt,
      plannedEndAt: endAt,
      coverColor: null,
      stagePresetKey: preset.key,
      stageTemplateVersion: 3,
      scheduleBasis: ScheduleBasis.Calendar,
      status: 'active',
      revision: 1,
      updatedAt: projectUpdatedAt,
    } as Project);

    plans.forEach((plan, si) => {
      const stageId = `${projectId}_s${si + 1}`;
      stages.push({
        id: stageId,
        projectId,
        orderIndex: si + 1,
        templateKey: plan.item.key,
        colorIndex: plan.item.colorIndex,
        name: plan.item.name,
        ratioPercent: plan.item.ratioPercent,
        startAt: plan.startAt,
        endAt: plan.endAt,
        status: plan.status,
        ownerId: DEMO_MEMBERS[(si + pi) % DEMO_MEMBERS.length].id,
        visible: true,
        resourcePath: null,
        revision: 1,
        updatedAt: now,
      } as Stage);
      // 任务：抽 defaultTasks 前 3 条（阶段库自带，不再手写第二份）
      plan.item.defaultTasks.slice(0, 3).forEach((title, ti) => {
        tasks.push({
          id: `${stageId}_t${ti + 1}`,
          projectId,
          stageId,
          title,
          done: plan.status === StageStatus.Completed,
          assigneeId: DEMO_MEMBERS[(si + ti + pi) % DEMO_MEMBERS.length].id,
          assigneeIds: [DEMO_MEMBERS[(si + ti + pi) % DEMO_MEMBERS.length].id],
          dueDate: plan.endAt,
          orderIndex: ti,
          revision: 1,
          updatedAt: now,
        } as Task);
      });
    });
  });

  const members = DEMO_MEMBERS.map((m) => ({ ...m, active: true, revision: 1, updatedAt: now } as Member));

  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: now },
    data: {
      projects,
      stages,
      tasks,
      members,
      assignments: [],
      logs: [],
      contracts: [],
      settings: [
        { key: 'currentMemberId', valueJson: JSON.stringify('demo_admin'), updatedAt: now },
        { key: 'restPolicy', valueJson: JSON.stringify({ kind: 'double_off', anchorWeek: null }), updatedAt: now },
      ],
    },
  } as unknown as BackupPackage;
}

/** stage-library 里每个 demo preset 的可见性（设计师 D5：demoReady 门控——没数据的行业不上卡） */
export function demoPresetReadiness(): Array<{ presetKey: string; label: string; ready: boolean }> {
  return DEMO_PRESETS.map(({ presetKey, label }) => ({
    presetKey,
    label,
    ready: Boolean(getPresets().find((p) => p.key === presetKey)),
  }));
}

