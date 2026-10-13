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
 *   ④ 脱敏：**形态判据**零命中（真实主体名/真实地址形态 + 作者标识 + 联系方式域，见下方常量）；
 *   ⑤ 入口链路源码守门：loadDemo 走工厂而非 fetch 静态 json（防回潮）；
 *   ⑥ **正向锁**：项目名/客户名一律「演示…」形态、地址必须自述为演示地址、成员名受形态约束；
 *   ⑦ **顺序锁**：首页首位必须是非建筑 domain（`updatedAt` 互不相同，否则顺序退化成 id 序）。
 *
 * ── 2026-10-13 · ④ 从「三个姓名」扩到「脱敏」并**改写为形态判据** ──
 * 旧版 ④ 只禁作者自己的姓名与邮箱域，**放任**工厂里写着疑似真实甲方名与真实街道。
 * 修复时本 spec 一度把那些名字**逐条抄成黑名单** —— 那是自伤：抄进来的名字本身
 * 又成了新的泄漏点（本批发现后重写，见下方 ④ 的注释）。
 * ⚠️ 纪律：**任何"清理清单"都不许把要清的内容复述进源码或提交信息。**
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * ⚠️ 复用 cjk-locator-guard 里的 maskComments（team-lead：别写第二份实现）。
 *   模块名带 cjk 是历史原因（它最先为「中文定位扫描」而写），但**剥注释**这件事与语言无关，
 *   任何「源码 contain 锁」都该先用它。
 */
import { maskComments } from './helpers/cjk-locator-guard';
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
   * 演示数据脱敏判据（④ 的判据本体）。
   *
   * ⚠️ **不许把要清掉的名字写在这里。** 本 spec 的第一版为了让黑名单"完整"，把疑似真实
   * 甲方名与真实地址**逐条抄进了源码** —— 那些名字本身随即成了新的泄漏点（自己成了
   * 要清的东西）。所以判据写成**形态规则**，不复述名字：
   *   · 「主体名形态」与「地址形态」出现在项目名 / 客户名 / 地址字段里时，
   *     同一串必须同时含「演示」（演示命名天然满足，真实甲方名天然不满足）；
   *   · 联系方式只走 `demo.local` 域（留一个真实邮箱域 = 留一条可追溯线索）；
   *   · 作者本人标识一并禁（防把作者信息卷进演示数据）。
   * 名字层面的效力由 ⑥ 正向锁承担：演示名必须匹配 /^演示项目|^演示客户/，
   * 任何真实名字都过不了那道门 ⇒ 不需要（也不应该）在这里复述名字。
   */
  const DEMO_MARK = '演示';
  /** 真实「主体名」的形态特征（公司/工作室/俱乐部…） */
  const ENTITY_LIKE = /公司|工作室|俱乐部|事务所|集团|管理中心|协会/;
  /** 真实「地址」的形态特征（行政区划字 / 街道 / 门牌 / 地名） */
  const ADDRESS_LIKE = /[市区县镇]|街|路|号|公园|州/;
  /** 作者本人标识（不是"名字清单"，是防止作者信息被卷进演示数据） */
  const AUTHOR_MARKERS: readonly string[] = ['yangwencheng', '杨雯丞', 'foxmail'];

  it('④ 脱敏：形态判据（真实主体名/真实地址）+ 作者标识 + 联系方式只走 demo.local', () => {
    const text = JSON.stringify(pkg);
    for (const w of AUTHOR_MARKERS) {
      expect(text.includes(w), `演示数据里出现作者标识：${w}`).toBe(false);
    }
    for (const p of pkg.data.projects) {
      const fields: ReadonlyArray<readonly [string, string]> = [
        ['项目名', p.name],
        ['客户名', p.clientName ?? ''],
        ['地址', p.address ?? ''],
      ];
      for (const [label, v] of fields) {
        const hasMark = v.includes(DEMO_MARK);
        expect(
          hasMark || !ENTITY_LIKE.test(v),
          `${label}「${v}」疑似真实主体名（同一串里必须含「${DEMO_MARK}」）`,
        ).toBe(true);
        expect(
          hasMark || !ADDRESS_LIKE.test(v),
          `${label}「${v}」疑似真实地址（同一串里必须含「${DEMO_MARK}」）`,
        ).toBe(true);
      }
    }
    // 联系方式的**域名**也必须脱敏：留一个真实邮箱域就等于留了一条可追溯线索
    for (const m of pkg.data.members) {
      expect(m.contact ?? '', `成员「${m.name}」的联系方式`).toMatch(/@demo\.local$/);
    }
  });

  /**
   * ⑥ 正向锁：光有黑名单不够——黑名单只管「旧名字回来了」，管不住
   * 「换一个真实甲方名字写进来」。正向锁规定**形态**：名字必须是可识别的演示形态。
   *
   * 成员锁两条，第二条（首字两两不同）不是审美：
   *   `AvatarStack` 取 `name[0]` 当头像文字 ⇒ 首字若相同（中间那版「演示成员甲…戊」
   *   五个都取到「演」），五个头像字一模一样，只能靠颜色区分。
   */
  it('⑥ 正向锁：项目/客户/成员名的**形态**受约束，且成员首字两两不同', () => {
    expect(pkg.data.projects).toHaveLength(5);
    for (const p of pkg.data.projects) {
      expect(p.name, '项目名必须以「演示项目」开头').toMatch(/^演示项目/);
      expect(p.clientName, `「${p.name}」的客户名必须以「演示客户」开头`).toMatch(/^演示客户/);
      expect(p.address, `「${p.name}」的地址必须自述为演示地址`).toContain('演示');
    }
    const names = pkg.data.members.map((m) => m.name);
    for (const n of names) {
      expect(n, '成员名必须是「中立角色词 + 天干」形态（如 负责人甲 / 执行乙）').toMatch(
        /^(负责人|执行|协作|评审|统筹)[甲乙丙丁戊己庚辛壬癸]$/,
      );
    }
    // 头像文字可辨识：首字两两不同（AvatarStack 取 name[0]）
    expect(new Set(names.map((n) => n[0])).size, '成员名首字必须两两不同（头像靠它区分）').toBe(
      names.length,
    );
  });

  it('⑤ 入口守门：useBackupIo.loadDemo 走工厂而非 fetch 静态 json（防回潮）', () => {
    const raw = readFileSync(
      resolve(__dirname, '..', 'src/components/layout/useBackupIo.tsx'),
      'utf8',
    );
    /*
     * ★ 2026-10-13 锁升级（team-lead 裁决）：**剥注释后再匹配**。
     *
     * 原判据是 `expect(src).toContain('buildDemoBackup()')`，其中 `src` 读的是**原始源码、不剥注释**
     * ⇒ 该文件里**任何注释**只要含这串就满足它。实测：`useBackupIo.tsx:121` 一条说明性注释
     * 正好含 `buildDemoBackup()`，于是**代码行被改坏时这条锁仍然绿**。
     *
     * ⇒ **类名（可复用的一句话）：源码 contain 锁必须「剥注释后再匹配」，
     *    否则任何注释都能满足它。**
     *    （同族的还有：中文锚点当定位契约、fileProofs 脆性、matchMedia 假绿 ——
     *      都是「看起来锁住了」。）
     */
    const src = maskComments(raw);
    expect(src).toContain('buildDemoBackup()');
    expect(src).not.toContain('demo-backup.json');
    // 反向自证：剥注释这个动作**确实起作用**（否则上面两条会退化成「拿原文匹配」的假绿）。
    // ⚠️ 这里**不能用长度**判据：`maskComments` 是**等长替换**（把注释内容原地抹成空格，
    //    为的是让行号/列位不漂）⇒ `src.length === raw.length` 恒成立。
    //    故改用**内容**判据：找一句**只出现在注释里**的话，剥完后必须消失。
    expect(raw, '原文里该注释句在场（它就是能骗过旧锁的那种注释）').toContain('有源码守门');
    expect(src, '剥注释后该注释句必须消失').not.toContain('有源码守门');
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
