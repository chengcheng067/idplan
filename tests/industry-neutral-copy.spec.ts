// @vitest-environment node
/**
 * 行业中立化源码锁（v0.8.5 C4 · 排障手 debug 报告 §3.3 五锁设计）。
 *
 * ── 为什么要有这把锁 ──
 * 她从室内设计工具做成全行业软件，遗留的行业话术/默认值散落在 26 处
 * （排障手全量排查，16 条用户可见已批修）。没有锁，下一个 PR 又会把
 * 「餐饮坪效校核」写回 placeholder——这类事靠人记不住，靠 spec 钉。
 *
 * ── 五锁（对应 debug 报告 §3.3）──
 *   ① 禁词黑名单 × 用户可见文件白名单（**剥注释后扫**，注释豁免）
 *   ② 正向锚点：ManualFallbackForm placeholder 是中性示例
 *   ③ 默认值锁：defaultPresetKeyForDomain 展陈不得回落 indoor（已是 null）
 *   ④ 示例数据锁：demo 覆盖 ≥3 个不同 domain（不退回全室内）
 *   ⑤ 元数据锁：index.html / package.json 描述不含行业词
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★★ 扫描面的**有意边界**（2026-10-13 明确登记，别再当「洞」去修）★★
 * ══════════════════════════════════════════════════════════════════════════
 * ① 锁的扫描面 = `src/components/**` + `src/pages/**` 的 tsx / `index.html` /
 *    `package.json` / `README{,.en}.md` / `docs/install/*.md`。
 *    **`templates/**`、`src/core/template/**`、`src/core/demo/**` 的行业内容
 *    故意不在扫描面内**。
 *
 * ② 判据（这条是给下一个人的，不是给机器的）：本锁扫的是**用户可见的通用话术**
 *    （「我搜索了某个成员名」这类与行业无关的界面文案），**不是行业内容**。
 *    区别看两个例子：
 *      · `templates/stage-library.json` 里室内套餐的 `defaultResponsibility`
 *        「功能分区与桌椅排布（**餐饮坪效校核**）」—— 这是**室内行业的内容**
 *        （行业库就该说行业的话，删了反而是把行业掏空）；
 *      · 而 `src/components/**` 的 placeholder 写「XX 餐饮 · 室内设计」—— 那是
 *        把某个行业当成**默认读者**，这才是「行业本位话术」，必须拦。
 *    ⇒ 「餐饮坪效」出现在 BANNED 里，但只有它出现在**用户可见通用面**时才违规。
 *      行业库里的同行文字不受管辖，**不要**为此扩扫描面（扩了会把合法的行业
 *      内容全扫成红，最后只能靠加白名单绕回来 —— 那等于把这条锁作废）。
 *
 * ③ 同理不在扫描面内、且**已判定为合法**的三处（2026-10-13 复核）：
 *    `custom-library.prompt.ts` 的示例名「我的茶空间流程」、
 *    `custom-library.schema.ts` 的同款注释、`CustomStageDialog` /
 *    `StageSelectPanel` 的自定义阶段示例「消防报审」——
 *    它们都是**让用户看懂「这一步填什么」的行业示例**，不是默认读者假设。
 *
 * ④ 本锁**只能加严**（加禁词、加文件）—— 放松任何一条都要先过产品官。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** 剥注释（教训×3：源码级扫描不剥注释 = 迟早抓到注释里的字样假红） */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8');

/** 用户可见目录的 tsx 文件全集（UI 文案就在这些文件里） */
function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, acc);
    else if (name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

/** 显式豁免：内部史料/调研文档（诚实档案，非用户可见面） */
const EXEMPT_FILES = ['docs/competitor-domestic.md'];

/** 锁 ①：禁词（用户可见语境）。注：「室内」作为 9 行业之一的合法名称保留，
 *  禁的是「室内设计工具/我从室内做起」这类**行业本位**话术 */
const BANNED = ['餐饮坪效', '茶空间', 'XX餐饮', '设计师本人', '绘图员', '长夏项目', '室内设计工具'];

describe('行业中立化源码锁（v0.8.5 C4）', () => {
  it('① 禁词黑名单：用户可见 tsx / 元数据 / 安装文档零命中（剥注释后）', () => {
    const files = [
      ...tsxFiles(resolve(ROOT, 'src/components')),
      ...tsxFiles(resolve(ROOT, 'src/pages')),
      resolve(ROOT, 'index.html'),
      resolve(ROOT, 'package.json'),
      resolve(ROOT, 'README.md'),
      resolve(ROOT, 'README.en.md'),
      resolve(ROOT, 'docs/install/windows-install.md'),
      resolve(ROOT, 'docs/install/nas-deploy-tutorial.md'),
      resolve(ROOT, 'docs/install/upk-install-tutorial.md'),
    ];
    const hits: string[] = [];
    for (const f of files) {
      if (EXEMPT_FILES.some((e) => f.endsWith(e))) continue;
      const src = stripComments(readFileSync(f, 'utf-8'));
      for (const w of BANNED) {
        if (src.includes(w)) hits.push(`${f.replace(ROOT, '')}: ${w}`);
      }
    }
    expect(hits, '行业本位话术回潮（她 feedback「全行业软件」的防线）').toEqual([]);
  });

  it('② 正向锚点：ManualFallbackForm 项目名称 placeholder 是中性示例', () => {
    const src = stripComments(read('src/components/contract-wizard/ManualFallbackForm.tsx'));
    // 必须含中性示例之一
    expect(src).toMatch(/某某项目|某某・第一阶段/);
  });

  it('③ 默认值锁：defaultPresetKeyForDomain 展陈不回落室内（debug #9）', () => {
    // 直接读源码形态（该函数被 spec 行为断言覆盖，这里防「有人把 case 合回 default」）
    const src = stripComments(read('src/components/contract-wizard/StageSelectPanel.tsx'));
    expect(src).toMatch(/case 'exhibition':\s*\n\s*return null/);
  });

  it('④ 示例数据锁：demo 工厂覆盖 ≥3 个不同 domain（不退回全室内）', async () => {
    const { buildDemoBackup } = await import('../src/core/demo/demoDataFactory');
    const pkg = buildDemoBackup();
    const domains = new Set(pkg.data.projects.map((p) => (p.stagePresetKey ?? '').split('_')[0]));
    expect(domains.size).toBeGreaterThanOrEqual(3);
  });

  it('⑤ 元数据锁：index.html 与 package.json 描述为跨行业口径', () => {
    expect(read('index.html')).toContain('跨行业项目排程工具');
    expect(read('package.json')).toContain('跨行业项目排程工具');
  });
});
