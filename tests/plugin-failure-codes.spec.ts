/**
 * 笔 4-b · 主进程失败码 ↔ 渲染层文案的**映射契约**（新 spec）。
 *
 * ══════════════════ 形态（team-lead 已批准）══════════════════
 * 主进程（`electron/plugin-install.cjs`）**不持有界面语言** ⇒ 它只产出
 * **稳定机器码 + 插值参数**；文案在渲染层用 `pluginFailureText()` 取词。
 *
 * ══════════════════ 这个文件守六件事 ══════════════════
 * ① **「码 ↔ 键」双向集合相等**（K12 列举完备性 + K14 消费锁）：
 *    码集**从主进程源码反推**（不是手抄清单 —— 手抄的清单不会自己发现新增的码），
 *    与键表、与 `zh` 表里 `plugin.fail.*` 的键集**两两相等**。
 * ② **zh 逐字**：每条码渲染出来必须**逐字等于**它替换掉的那句旧 `reason`（字面量写在表里）。
 * ③ **真因不许被码吃掉**（K22 反向）：`params.detail` 是 fs / JSON.parse 的原始错误串 ⇒
 *    必须**原样**出现在渲染结果里；没有真因的码**不许残留 `{detail}`** —— 正反两条。
 * ④ **退化路径不许写中文兜底**：未知码**原样回显码本身**。
 * ⑤ **消费锁（K14）**：`pluginFailureText` 必须真的被 `src/**` 消费；每条码都必须可解析成
 *    消息表那句（而不是回显码 = 死词条）。
 * ⑥ **不许有重复取值键**（K10）：本笔在 4-a 里造过一个重复键
 *    （`plugin.install.unsupportedEnv` ≡ 既有 `plugin.err.notDesktop`，取值一字不差），
 *    已删；这条断言把「同一个值两个键」钉住。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLUGIN_FAILURE_KEYS,
  catalogOf,
  pluginFailureText,
  type MessageKey,
} from '../src/i18n';
import { maskComments } from './helpers/cjk-locator-guard';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/* ══════════════ ① 码集：从主进程源码**反推**（不是手抄） ══════════════ */

/** 主进程里「产出码」的两种写法：`failure('CODE'`（返回体）与 `code: 'CODE'`（skipped 项） */
function codesFromMainSource(): string[] {
  const src = maskComments(read('electron/plugin-install.cjs'));
  const out = new Set<string>();
  for (const m of src.matchAll(/\bfailure\(\s*'([^']+)'/g)) out.add(m[1]!);
  for (const m of src.matchAll(/\bcode:\s*'([^']+)'/g)) out.add(m[1]!);
  return [...out].sort();
}

const codes = codesFromMainSource();
const keyTableCodes = Object.keys(PLUGIN_FAILURE_KEYS).sort();
const zhFailKeys = Object.keys(catalogOf('zh')).filter((k) => k.startsWith('plugin.fail.')).sort();

describe('① 码 ↔ 键 ↔ zh 表：三处集合两两相等（K12 + K14）', () => {
  it('★ 粒度先报清：本笔共 20 个码（manifest 7 / install 8 / uninstall 2 / scan 3）', () => {
    // 「20」这个数来自本断言的粒度声明：改粒度先改这里，别让「22 / 21 / 20」在对话里漂
    expect(codes).toHaveLength(20);
    const byPrefix = (p: string): number => codes.filter((c) => c.startsWith(p)).length;
    expect([byPrefix('manifest.'), byPrefix('install.'), byPrefix('uninstall.'), byPrefix('scan.')]).toEqual(
      [7, 8, 2, 3],
    );
  });

  it('★ 主进程产出的码集 === 键表的码集（相等，不是包含）', () => {
    expect(codes, '主进程新增了码但键表没跟上（英文态会露中文）/ 键表多了没人产出的码').toEqual(
      keyTableCodes,
    );
  });

  it('★ 键表的**值**集 === zh 表里 `plugin.fail.*` 的键集（相等）', () => {
    const values = [...new Set(Object.values(PLUGIN_FAILURE_KEYS))].sort() as string[];
    expect(values, '键表指向了不存在的键，或 zh 表里有没人用的 `plugin.fail.*` 死词条').toEqual(
      zhFailKeys,
    );
  });

  it('键名与码 1:1（`plugin.fail.<码>`）—— 便于人肉对账，也让上一条的集合比较有意义', () => {
    for (const code of codes) {
      expect(PLUGIN_FAILURE_KEYS[code], `码 ${code} 没有键`).toBe(`plugin.fail.${code}`);
    }
  });

  it('en 侧每条都有取值、且不是中文（防漏翻）', () => {
    const en = catalogOf('en');
    for (const key of zhFailKeys as MessageKey[]) {
      expect(en[key], `${key} 的英文为空`).toBeTruthy();
      expect(/[\u4e00-\u9fff]/.test(en[key]), `${key} 的英文里混了汉字`).toBe(false);
    }
  });
});

/* ══════════════ ② zh 逐字：码渲染出来 = 它替换掉的那句旧 reason ══════════════ */

const ZH_RENDERED: ReadonlyArray<{
  code: string;
  params?: Record<string, string | number>;
  zh: string;
}> = [
  { code: 'manifest.notObject', zh: 'manifest.json 不是合法的 JSON 对象' },
  {
    code: 'manifest.badId',
    params: { id: 'Bad' },
    zh: 'manifest.id 不合法（"Bad"）——只允许小写字母、数字与中划线，首字符不能是中划线，最长 64 位',
  },
  { code: 'manifest.badName', zh: 'manifest.name 缺失或不是非空字符串（插件列表要显示它）' },
  { code: 'manifest.badVersion', zh: 'manifest.version 缺失或不是非空字符串（用户要看得见装了哪版）' },
  {
    code: 'manifest.badEntry',
    params: { entry: 'x.txt' },
    zh: 'manifest.entry 缺失或不是合法入口文件名（"x.txt"）——v1 只支持 .html/.htm/.js/.mjs 之一',
  },
  { code: 'manifest.badInstallVersion', zh: 'manifest.installVersion 若填写必须是字符串' },
  { code: 'manifest.badMinHostVersion', zh: 'manifest.minHostVersion 若填写必须是字符串' },
  { code: 'install.badPath', zh: '文件路径无效' },
  {
    code: 'install.readFailed',
    params: { detail: 'Unexpected token n' },
    zh: 'manifest.json 读取或解析失败：Unexpected token n',
  },
  { code: 'install.badId', zh: '插件 id 不合法（拒绝安装）' },
  // ⚠️ `**源目录**` 是**原样保留的字面星号**（原串就长这样）：去掉它是「有意的 zh 变更」⇒ 单独一笔
  { code: 'install.sourceIsInstalled', zh: '请选择插件**源目录**里的 manifest.json（不能直接重装已安装目录）' },
  {
    code: 'install.entryMissing',
    params: { entry: 'index.html' },
    zh: 'manifest.entry 声明的入口文件 "index.html" 在所选目录里不存在',
  },
  { code: 'install.tooLarge', params: { mb: '7.3' }, zh: '插件目录体积 7.3MB 超过 v1 上限 5MB——请精简产物后重试' },
  { code: 'install.writeFailed', params: { detail: 'EACCES' }, zh: '写入失败：EACCES' },
  { code: 'install.copyVerifyFailed', zh: '复制后入口文件缺失（安装未完成，目录已回滚）' },
  { code: 'uninstall.badId', zh: '插件 id 不合法（拒绝卸载）' },
  { code: 'uninstall.removeFailed', params: { detail: 'EBUSY' }, zh: '删除失败：EBUSY' },
  {
    code: 'scan.dirIdMismatch',
    params: { id: 'a', dir: 'b' },
    zh: 'manifest.id（a）与目录名（b）不一致——请以目录名作为 id 重新安装',
  },
  {
    code: 'scan.hostTooLow',
    params: { min: '9.9.9', host: '0.8.6' },
    zh: '需要 ID Plan 9.9.9 或更高（当前 0.8.6）',
  },
  { code: 'scan.readFailed', params: { detail: 'ENOENT' }, zh: 'manifest.json 无法读取：ENOENT' },
];

describe('② zh 逐字：每条码渲染出来 = 旧的 `reason` 句', () => {
  it('表覆盖了全部码（少一条这条就红，防「新增码没补字面量」）', () => {
    expect(ZH_RENDERED.map((r) => r.code).sort()).toEqual(codes);
  });

  it.each(ZH_RENDERED)('$code → «$zh»', ({ code, params, zh }) => {
    expect(pluginFailureText({ code, params })).toBe(zh);
  });
});

/* ══════════════ ③ 真因透传（正反两条，K22 反向） ══════════════ */

describe('③ 真因不许被码吃掉（正反两条判据）', () => {
  const DETAIL_CODES = ['install.readFailed', 'install.writeFailed', 'uninstall.removeFailed', 'scan.readFailed'];

  it('★ 正：`params.detail` 里的原始错误串**逐字**出现在渲染结果里', () => {
    const raw = 'EACCES: permission denied, open "/x/manifest.json"';
    for (const code of DETAIL_CODES) {
      const text = pluginFailureText({ code, params: { detail: raw } });
      expect(text, `${code} 把真因吞了（界面上只剩一句通用话）`).toContain(raw);
    }
  });

  it('★ 正（续）：真因**不被改写**（原样拼接，不做任何清洗/截断/翻译）', () => {
    const raw = 'Unexpected token } in JSON at position 2 <b>不转义</b>';
    expect(pluginFailureText({ code: 'install.readFailed', params: { detail: raw } })).toBe(
      `manifest.json 读取或解析失败：${raw}`,
    );
  });

  it('★ 反：**只有**该带真因的码才有 `{detail}` 占位符（取值与码的约定必须对齐）', () => {
    const zh = catalogOf('zh');
    for (const code of Object.keys(PLUGIN_FAILURE_KEYS)) {
      const value = zh[PLUGIN_FAILURE_KEYS[code]!]!;
      const hasDetail = value.includes('{detail}');
      expect(
        hasDetail,
        DETAIL_CODES.includes(code)
          ? `${code} 的取值里没有 {detail} ⇒ 真因无处可插`
          : `${code} 的取值里有 {detail}，但它在主进程侧不产真因 ⇒ 界面上会漏出未替换的占位符`,
      ).toBe(DETAIL_CODES.includes(code));
      // 不带 detail 的码，渲染时不出现 detail 字样（防止「错位的真因」）
      if (!DETAIL_CODES.includes(code)) {
        expect(pluginFailureText({ code })).not.toContain('detail');
      }
    }
  });

  it('★ 反：四个带 detail 的码，渲染结果里 `detail` 段与消息表取值**同源**（不是另拼一句）', () => {
    const zh = catalogOf('zh');
    for (const code of DETAIL_CODES) {
      const key = PLUGIN_FAILURE_KEYS[code]!;
      const text = pluginFailureText({ code, params: { detail: 'X' } });
      // 把 `{detail}` 换成 'X' 必须与渲染结果逐字相同 ⇒ 证明渲染只走了消息表这一条路
      expect(text).toBe(zh[key]!.replace('{detail}', 'X'));
    }
  });
});

/* ══════════════ ④ 退化：未知码原样回显（不写中文兜底） ══════════════ */

describe('④ 退化路径不许写中文兜底', () => {
  it('未知码 ⇒ 原样回显**码本身**（可见即错，便于发现遗漏）', () => {
    expect(pluginFailureText({ code: 'nope.unknown' })).toBe('nope.unknown');
  });

  it('未知码 + 参数 ⇒ 仍回显码（不猜、不拼）', () => {
    expect(pluginFailureText({ code: 'nope.unknown', params: { detail: 'x' } })).toBe('nope.unknown');
  });

  it('取词器源码里**没有**任何中文兜底字符串（K21：不翻的决定要有会红的断言）', () => {
    const src = maskComments(read('src/i18n/labels.ts'));
    const fn = /export function pluginFailureText[\s\S]*?\n}/.exec(src);
    expect(fn, '找不到取词函数？那下面的断言是空的').not.toBeNull();
    expect(/[\u4e00-\u9fff]/.test(fn![0]), '取词器里出现了中文 ⇒ 兜底又回到写死的语言了').toBe(false);
  });
});

/* ══════════════ ⑤ 消费锁（K14）+ ⑥ 重复值锁（K10） ══════════════ */

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) srcFiles(abs, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}

describe('⑤⑥ 消费锁 + 重复值锁', () => {
  const srcCode = srcFiles(join(rootDir, 'src'))
    .map((abs) => maskComments(readFileSync(abs, 'utf8')))
    .join('\n');

  it('★ `pluginFailureText` 真的被 src/** 消费（否则这 20 条键全是死词条）', () => {
    const users = srcFiles(join(rootDir, 'src')).filter(
      (abs) => /pluginFailureText\(/.test(maskComments(readFileSync(abs, 'utf8'))) && !abs.endsWith('labels.ts'),
    );
    expect(
      users.length,
      '取词器没有任何消费方 ⇒ 安装失败会渲染成码（或干脆不渲染）',
    ).toBeGreaterThan(0);
  });

  it('★ 每条码都能解析成消息表那句（不是回显码）', () => {
    for (const code of codes) {
      expect(pluginFailureText({ code }), `${code} 是死词条（渲染出来还是码）`).not.toBe(code);
    }
  });

  it('★ 不许有重复取值的键：`当前运行环境不支持从文件安装（仅桌面版可用）` 在 zh 表里只出现一次', () => {
    /*
     * 这条例外来自一笔**真事故**：我在 4-a 里新造了 `plugin.install.unsupportedEnv`，
     * 它与既有 `plugin.err.notDesktop` **取值一字不差** ⇒ K10（同一个词只建一个键）的违反。
     * 处置：删掉新造的那个键、两处调用点统一用既有键；这条断言钉住它不许复发。
     */
    const zh = catalogOf('zh');
    const holders = Object.keys(zh).filter(
      (k) => zh[k as MessageKey] === '当前运行环境不支持从文件安装（仅桌面版可用）',
    );
    expect(holders, '同一个取值有两个键 ⇒ 迟早漂成两种说法').toEqual(['plugin.err.notDesktop']);
  });
});
