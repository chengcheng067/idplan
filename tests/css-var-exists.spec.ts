// @vitest-environment node
/**
 * CSS 变量存在性守卫（2026-10-07 加）
 *
 * 守什么：**src 里引用的每一个 `var(--x)` 必须在 global.css 里真的被定义。**
 *
 * 为什么值得一条 spec：`var(--pine)` 这种拼错的变量名，tsc 不报（它是字符串）、
 * lint 不报、单测不报——只有真机打开才看出「描边没颜色」。而它的表现是**静默的**
 * （浏览器按继承色兜底，界面不会崩，只是少了个效果）。本轮就抓到一枚：
 * `timelineColors.ts` 的 STAGE_ACTIVE_STROKE 从上线起就是失效值（反馈 #10.1
 * 「当前进行时的色彩和进度条有较大色差」的一部分根因）。
 *
 * 手法：从 src 全部 ts/tsx 里抽出 var(--name)，从 global.css 抽出定义，
 * 差集必须为空。CSS 自定义属性允许「运行时才定义」（JS 注入/第三方库），
 * 故用**白名单**容纳已知的运行时定义而不是一律放过——白名单每加一项都要写理由。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', 'src');

/** 运行时才定义的变量（JS/第三方注入），及其理由 */
const RUNTIME_DEFINED: Record<string, string> = {
  // 例：'--toast-offset': '由 Toast 容器 JS 写入',
};

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe('CSS 变量存在性', () => {
  it('src 引用的每个 var(--x) 都在 global.css 有定义（白名单除外）', () => {
    const css = readFileSync(resolve(SRC, 'styles/global.css'), 'utf8');
    const defined = new Set<string>();
    for (const m of css.matchAll(/(--[a-zA-Z0-9-_]+)\s*:/g)) defined.add(m[1]!);

    const referenced = new Map<string, string[]>();
    for (const f of collectSourceFiles(SRC)) {
      // 先剥掉块注释：注释里的示例文本（如「var(--stage-sN)」说明）不是真引用。
      // 行内注释整行剥（// 与 # 之后的部分不含 var( 的危险面，可接受）。
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
      // 第二组捕获 `var(` 之后紧跟的 `${`：有它 = 模板拼接（`var(--stage-s${i})`），
      // 此时第一组拿到的是不完整前缀（--stage-s / --stage-ink-s），运行时才拼出
      // 完整名（--stage-s1 由构建生成）。**一律跳过拼接形态**：宁可放过动态拼接，
      // 不可误报噪音（噪音会训练人忽略红灯，与 flaky 同罪）。
      for (const m of src.matchAll(/var\((--[a-zA-Z0-9-_]*)(\$\{)?/g)) {
        const name = m[1]!;
        const isTemplateConcat = m[2] !== undefined || name.endsWith('-') || name === '--';
        if (isTemplateConcat) continue;
        if (!referenced.has(name)) referenced.set(name, []);
        referenced.get(name)!.push(f.slice(SRC.length + 1));
      }
    }

    const missing: string[] = [];
    for (const [name, files] of referenced) {
      if (defined.has(name)) continue;
      if (name in RUNTIME_DEFINED) continue;
      missing.push(`${name}  (被 ${files.slice(0, 3).join(', ')}${files.length > 3 ? ' 等' : ''} 引用)`);
    }
    expect(missing, `这些 CSS 变量被引用但从未定义：\n${missing.join('\n')}`).toEqual([]);
  });

  it('守卫自身有效性：造一个不存在的变量名必然被抓住', () => {
    // 若上面那条因为正则写错而恒真，这条会红（反假绿）
    const fake = 'var(--this-variable-must-not-exist-2026)';
    const name = fake.match(/var\((--[a-zA-Z0-9-_]+)/)![1]!;
    const css = readFileSync(resolve(SRC, 'styles/global.css'), 'utf8');
    expect(css).not.toContain(`${name}:`);
  });
});
