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
 * 5 个演示项目覆盖**五种看板列形态**（室内三段 / 软件五列 / 旅游 / 市场
 * 六列 / 影视四列），陌生用户不论做哪行都能看到「自己那行」长什么样。
 * 成员一律脱敏（demo.local 域），不含任何真实姓名/邮箱。
 */

import { getPresets, getPresetItems } from '../template/stage-library';
import type { StagePreset, StageTemplateItem, BackupPackage } from '../types/dto';
import { StageStatus, ScheduleBasis, MemberRoleKind } from '../types/enums';
import type { Project, Stage, Task, Member } from '../types/entities';

/** 演示项目选用的五个 preset（覆盖五种 columns 形态；室内放首位——主场不丢） */
export const DEMO_PRESETS: ReadonlyArray<{ presetKey: string; label: string }> = [
  { presetKey: 'indoor_full', label: '室内设计' },
  { presetKey: 'software_mobile_full', label: '软件开发' },
  { presetKey: 'marketing_launch_full', label: '市场活动' },
  { presetKey: 'film_promo_full', label: '影视制作' },
  { presetKey: 'travel_fit', label: '旅游出行' },
];

/** 演示成员（脱敏：中性姓氏+工种、demo.local 域；admin=「设计师本人」） */
const DEMO_MEMBERS: ReadonlyArray<Pick<Member, 'id' | 'name' | 'role' | 'contact' | 'avatarColor' | 'roleKind'>> = [
  { id: 'demo_admin', name: '设计师本人', role: '主案负责人', contact: 'admin@demo.local', avatarColor: '#5B8C5A', roleKind: MemberRoleKind.Admin },
  { id: 'demo_m1', name: '陈工', role: '方案设计', contact: 'chen@demo.local', avatarColor: '#B25C5C', roleKind: MemberRoleKind.Member },
  { id: 'demo_m2', name: '周工', role: '深化设计', contact: 'zhou@demo.local', avatarColor: '#5C7A9E', roleKind: MemberRoleKind.Member },
  { id: 'demo_m3', name: '吴工', role: '执行统筹', contact: 'wu@demo.local', avatarColor: '#C98D5B', roleKind: MemberRoleKind.Member },
  { id: 'demo_m4', name: '郑工', role: '现场管理', contact: 'zheng@demo.local', avatarColor: '#7A6BAC', roleKind: MemberRoleKind.Member },
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
}

const DEMO_SPECS: ReadonlyArray<DemoProjectSpec> = [
  { presetKey: 'indoor_full', name: '云栖·湖畔茶室', clientName: '云栖餐饮管理有限公司', address: '成都市高新区天府三街 88 号', contractAmount: 420000, startOffset: -56, spanDays: 168 },
  { presetKey: 'software_mobile_full', name: '植屋·品牌小程序', clientName: '植屋植物工作室', address: '（线上交付）', contractAmount: 150000, startOffset: -42, spanDays: 126 },
  { presetKey: 'marketing_launch_full', name: '山旬·秋季新品发布会', clientName: '山旬食品', address: '成都市锦江区红星路三段 1 号', contractAmount: 280000, startOffset: -21, spanDays: 98 },
  { presetKey: 'film_promo_full', name: '渭水茶炉·品牌宣传片', clientName: '渭水茶炉（咸阳）', address: '咸阳市渭城区渭滨公园', contractAmount: 96000, startOffset: -35, spanDays: 112 },
  { presetKey: 'travel_fit', name: '川西·深秋摄影线路', clientName: '等风来旅行俱乐部', address: '甘孜州（线上行程）', contractAmount: 0, startOffset: 14, spanDays: 84 },
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
      updatedAt: now,
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

