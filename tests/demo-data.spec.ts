// @vitest-environment node
/**
 * 0.8.5 demo 运行时工厂（路线 A）· 守门 spec。
 *
 * 替代旧版「读 public/demo-backup.json 静态文件」的断言形态——静态文件已删
 * （行业不中立+日期过期+与阶段库重复造内容三宗罪，见 demoDataFactory.ts 头注）。
 *
 * 五件事各钉一层：
 *   ① 产物过当前 backup zod schema（导入链与真实备份同一条）；
 *   ② **行业中立**：≥3 个不同 domain（旧静态包是 5 个全室内——本 spec 的存在理由）；
 *   ③ **日期动态锚**：阶段区间以 today 为基准（永不过期）；
 *   ④ 脱敏：**禁词表**零命中（真实姓名/邮箱 + 旧项目名/客户名/真实街道，见下方常量）；
 *   ⑤ 入口链路源码守门：loadDemo 走工厂而非 fetch 静态 json（防回潮）；
 *   ⑥ **正向锁**：项目名/客户名一律「演示…」形态、地址必须自述为演示地址。
 *
 * ── 2026-10-13 · ④ 从「三个姓名」扩成禁词表（公开仓库前的脱敏）──
 * 旧版的 ④ 只禁作者自己的姓名与邮箱域，**放任**工厂里写着
 * 「云栖·湖畔茶室 / 云栖餐饮管理有限公司 / 山旬食品 / 等风来旅行俱乐部」这类
 * 疑似真实甲方名，以及「天府三街 / 红星路三段 / 渭滨公园」这类真实街道。
 * 那些正是这次公开推送前要清掉的东西 ⇒ 黑名单必须覆盖它们，
 * 否则下一个 PR 又把「某甲方」写回去，没人拦得住（4 条 spec 都还全绿）。
 * ⑤ 的正向锁是配对的另一半：④ 只说「不许出现什么」，⑥ 说「必须长什么样」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildDemoBackup, DEMO_PRESETS, demoPresetReadiness } from '../src/core/demo/demoDataFactory';
import { validateBackupJson } from '../src/core/services/backup.service';
import { getPresets } from '../src/core/template/stage-library';

describe('demo 运行时工厂（buildDemoBackup）', () => {
  const pkg = buildDemoBackup();

  it('① 产物过当前 backup zod schema（与真实备份同一导入链）', () => {
    const parsed = validateBackupJson(pkg);
    expect(parsed.data.projects).toHaveLength(5);
    expect(parsed.data.stages.length).toBeGreaterThanOrEqual(25);
    expect(parsed.data.tasks.length).toBeGreaterThanOrEqual(60);
    expect(parsed.data.members.length).toBeGreaterThanOrEqual(5);
  });

  it('② 行业中立：5 项目覆盖 ≥3 个不同 domain（防退回全室内）', () => {
    const domains = new Set(pkg.data.projects.map((p) => (p.stagePresetKey ?? '').split('_')[0]));
    expect(domains.size).toBeGreaterThanOrEqual(3);
    // 五种 preset 全在阶段库有定义（悬空 = 工厂会静默跳过，这里钉住不许缺）
    const libKeys = new Set(getPresets().map((p) => p.key));
    for (const { presetKey } of DEMO_PRESETS) {
      expect(libKeys.has(presetKey), `阶段库缺 preset ${presetKey}`).toBe(true);
    }
    for (const p of pkg.data.projects) {
      expect(p.stagePresetKey).toBeTruthy();
      expect(libKeys.has(p.stagePresetKey as string)).toBe(true);
    }
  });

  it('③ 日期动态锚：每段 startAt <= endAt，且 ≥3 个项目跨度跨过 today', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const s of pkg.data.stages) {
      expect(s.startAt <= s.endAt).toBe(true);
    }
    const spanning = pkg.data.projects.filter(
      (p) => p.plannedStartAt.slice(0, 10) <= today && p.plannedEndAt.slice(0, 10) >= today,
    );
    expect(spanning.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * 演示数据禁词表（④ 的判据本体）。
   *
   * 分四组，全部是**曾经真的写进过工厂**的东西（2026-10-13 脱敏批次清掉的）：
   *   · 旧项目名/品牌名：云栖·湖畔茶室 / 植屋·品牌小程序 / 山旬·秋季新品发布会 /
   *     渭水茶炉·品牌宣传片 / 川西·深秋摄影线路；
   *   · 旧客户名：云栖餐饮管理有限公司 / 植屋植物工作室 / 山旬食品 /
   *     渭水茶炉（咸阳）/ 等风来旅行俱乐部；
   *   · 旧真实地址：成都市高新区天府三街 88 号 / 成都市锦江区红星路三段 1 号 /
   *     咸阳市渭城区渭滨公园 / 甘孜州（线上行程）；
   *   · 作者本人姓名与邮箱域（原 ④ 的内容，一字不减）。
   * ⚠️ 只许加不许减——减一条就是给「名字回来了」放行。
   */
  const BANNED_IN_DEMO: readonly string[] = [
    // 旧项目名 / 品牌名
    '云栖',
    '植屋',
    '山旬',
    '渭水',
    '等风来',
    '湖畔茶室',
    '川西',
    // 旧客户名 / 真实地址
    '天府三街',
    '红星路',
    '渭滨公园',
    '咸阳',
    '甘孜',
    // 作者本人
    'yangwencheng',
    '杨雯丞',
    'foxmail',
  ];

  it('④ 脱敏：禁词表零命中 + 联系方式只走 demo.local 域', () => {
    const text = JSON.stringify(pkg);
    const hits = BANNED_IN_DEMO.filter((w) => text.includes(w));
    expect(hits, `演示数据里出现禁词（公开仓库红线）：${hits.join(' / ')}`).toEqual([]);
    // 联系方式的**域名**也必须脱敏：留一个真实邮箱域就等于留了一条可追溯线索
    for (const m of pkg.data.members) {
      expect(m.contact ?? '', `成员「${m.name}」的联系方式`).toMatch(/@demo\.local$/);
    }
  });

  /**
   * ⑥ 正向锁：光有黑名单不够——黑名单只管「旧名字回来了」，管不住
   * 「换一个真实甲方名字写进来」。正向锁规定**形态**：名字必须以「演示」开头。
   */
  it('⑥ 正向锁：项目名/客户名一律「演示…」开头，地址自述为演示地址', () => {
    expect(pkg.data.projects).toHaveLength(5);
    for (const p of pkg.data.projects) {
      expect(p.name, '项目名必须以「演示项目」开头').toMatch(/^演示项目/);
      expect(p.clientName, `「${p.name}」的客户名必须以「演示客户」开头`).toMatch(/^演示客户/);
      expect(p.address, `「${p.name}」的地址必须自述为演示地址`).toContain('演示');
    }
    for (const m of pkg.data.members) {
      expect(m.name, '成员名必须以「演示成员」开头').toMatch(/^演示成员/);
    }
  });

  it('⑤ 入口守门：useBackupIo.loadDemo 走工厂而非 fetch 静态 json（防回潮）', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/components/layout/useBackupIo.tsx'), 'utf8');
    expect(src).toContain('buildDemoBackup()');
    expect(src).not.toContain('demo-backup.json');
    // demoPresetReadiness 全 ready（设计师 D5 demoReady 门控的数据源）
    expect(demoPresetReadiness().every((r) => r.ready)).toBe(true);
  });

  /**
   * ⑦ 顺序锁：首页卡片按 `updatedAt` 降序排 ⇒ 首位必须是**非建筑** domain。
   *
   * 为什么值得单独钉：工厂给 5 个项目的 updatedAt 若相等，顺序退化成 id 的字母序，
   * 「软件开发优先」在界面上就不成立（而它是这次重排的全部意义）。
   */
  it('⑦ 顺序锁：首位 domain 非建筑类 + 5 个 order 互不相同', () => {
    const sorted = [...pkg.data.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const first = (sorted[0]?.stagePresetKey ?? '').split('_')[0];
    expect(['indoor', 'landscape', 'architecture', 'exhibition']).not.toContain(first);
    expect(first, '首位应为软件域（DEMO_PRESETS 声明序）').toBe('software');
    expect(new Set(pkg.data.projects.map((p) => p.updatedAt)).size, 'updatedAt 必须互不相同（否则顺序不确定）').toBe(5);
  });
});
