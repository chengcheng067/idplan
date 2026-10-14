/**
 * 测试定位解耦 · 扫描核（**纯函数**，批次⑥ 的守卫底座）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要有这个纯函数（而不是「扫一遍源码 + 打印报告」）
 * ══════════════════════════════════════════════════════════════════════
 * 只打印报告的守卫**没法证明它真的会红** —— 一个恒不命中的正则和一条真正的闸门，
 * 在「跑一遍看看输出」这件事上长得一模一样。故把判别逻辑抽成纯函数，
 * 配一组**离散、零容差**的夹具（正的必中 / 负的必不中），判别力由夹具钉住。
 * （团队内的说法：这是「防假闸门」纪律的又一次实践。）
 *
 * ── 判据口径（team-lead 批准，三形态取舍 + 四形态补齐）──
 * **锁（即红）**——「拿文案当定位契约」这四类，英文模式下会找不到元素、且失败会
 *   伪装成「控件不存在」：
 *     ① `aria-label="<含 CJK>"` 出现在 locator / querySelector / waitForSelector 里；
 *     ② `getByRole('button', { name: '<含 CJK>' })`；
 *     ③ `getByLabel('<含 CJK>')`；
 *     ④ `getByPlaceholder('<含 CJK>')`；
 *     ⑤ `getByTitle('<含 CJK>')`。
 *     （③④⑤ 目前全仓 0 处 —— 但守卫要**先立着**，否则下一个写的人会以为它们合法。）
 *
 * **有意不锁（并在本文件写明，免得下一个人以为守卫漏了）**：
 *   ⚠️ **来源（可追溯）**：这是 **team-lead 裁决**的结果，不是我自己放的行 ——
 *     他要求「三种形态分别处置」，并明示「带 allowlist 的守卫必然腐化、豁免清单会让下一个人
 *     以为中文 aria 定位是被允许的」；而规模是**实测**出来的（`getByText` / `hasText:` 合计
 *     27 处 / 11 个文件，绝大多数是渲染态内容断言 = 正确写法）。
 *     ⇒ **不锁的两类 + 锁的五类，边界都来自这次裁决与实测，不是惯例。**
 *   ⚠️ **下游后果（team-lead 要求：让下一个人看见他自己那一步的后果）**：
 *     **你若在这里补一条锁，会发生什么？** ① 它立刻把**整个测试套扫红**（这两类在全仓有
 *     27 处、且绝大多数是**正确写法**的渲染态内容断言）；② 你会以为「守卫坏了」或
 *     「这些 spec 写错了」，于是去改那 27 处；③ 改不动就会把补的那条**改回去/加豁免**；
 *     ④ **从此这条豁免的形状再也没人说得清** —— 下一个人面对的是「一堆被改过又改回来的
 *     断言」，而不是一条明确的边界。
 *     ⇒ 所以：**要动它，先改上面的「上游依据」（裁决 + 实测），别从结论那行倒着改。**
 *     （「只写上游容易被当成凭空加的；只写下游容易被当成危言耸听」—— 两者要一起在。）
 *   · **断言可访问名 / 白名单值**：如 `expect(src).toContain('aria-label="ID Plan 首页"')`
 *     或 `['打开导航菜单','更多操作']` 这种「期望的 aria 名清单」。那是对**内容本身**的
 *     断言（就是要验 a11y 名/文案），锁它会把整个测试套扫红；而且这类断言在英文模式下
 *     本就应该按语言取值。
 *   · **按可见文案定位**：`getByText('<CJK>')` / `hasText: '<CJK>'` / `textContent).toContain('<CJK>')`。
 *     它们既是定位也是内容断言，机器区分不了 —— 且它们是**渲染态**断言，
 *     正是「取值再比串」那类正确写法，锁它们是自伤。
 *     ⚠️ 「不锁」≠「没人知道有多少」：规模已单独盘点（见交付报告），供 team-lead 决定是否立项。
 *
 * ── 已知局限（如实登记，别当成「已覆盖」）──
 *   · 本核按**行**判定；跨行书写的调用（`locator(\n  'button[aria-label="中文"]'\n)`）
 *     不会命中。全仓当前无此写法，但将来出现即漏 —— 这也是为什么它只能当**兜底**，
 *     真正的纪律是「新写 spec 不用中文定位」。
 *   · 不解析 AST，故别名（`const SEL = 'button[aria-label="中文"]'` 再 `locator(SEL)`）
 *     只在**字面量出现的那一行**判定：该行若不在 locator 调用里就不命中。
 *     换句话说：**它会漏，但不会误伤**（宁可漏报也不把合法断言扫红）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

/** 一处命中 */
export interface CjkLocatorHit {
  /** 该行命中处的原文（trim 后截断），用于红灯时直接看到问题代码 */
  text: string;
  /** 命中的形态（报错文案用） */
  kind: 'aria-label-selector' | 'getByRole-name' | 'getByLabel' | 'getByPlaceholder' | 'getByTitle';
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/**
 * 把注释**内容**原地抹成空格（保留换行 ⇒ 行号/列位不漂）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 已知边界（2026-10-13 复核者交叉核对两条实现后量化出来的，**务必读**）★★
 * ══════════════════════════════════════════════════════════════════════
 * 本函数**不是**「把注释删掉」的工具，而是「**把注释内容抹白、保留注释标记与长度**」：
 *   · 保留：换行、**注释起始标记 `/*` 与 `//` 这两个字符本身**（它们是原字符，我只把
 *     内容写成空格）；长度**恒等**（这正是它能保行号/列位、供行级回溯的原因）。
 *   · 抹掉：注释**内容**、块注释的**结束标记**（星号 + 斜杠；此处不写它的字面形态，
 *     以免本段注释提前闭合 —— 这本身也是「块注释里不能写结束标记」的一个现场例子）。
 *
 * ⇒ **用途**：任何「按原文位置/长度对齐地忽略注释内容」的场景 —— 本守卫的定位扫描、
 *   以及 `tests/demo-data.spec.ts` 那条「源码 contain 锁」（只在活代码里匹配）。
 *
 * ⇒ **不可用于**：「断言某文件里**不含** `/*`」这类**要求标记也消失**的判据。
 *   那种场景必须用**删除式**剥法（本仓已有先例：`tests/v07-t03b-ingress-wired.spec.tsx:453`
 *   的 `code = source.replace(/\/\*[\s\S]*?\*\//g, '')…`）。**两者不可互换** ——
 *   若把那条 spec 的局部剥法换成我这份，它的 `expect(code).not.toContain('/*')` **会红**
 *   （因为我把 `/*` 留着）。这也正是复核者两条实现命中数 123 vs 122 的**唯一**差异来源：
 *   被锁串恰好是 `/*` 本身（`v07-t03b-ingress-wired.spec.tsx:464`）。
 *
 * ⇒ 另一条边界：**被锁串若形如注释标记**（如 `/*`、`//`），本剥法**不会**让它消失
 *   ⇒ 那类锁在「是否被注释满足」的判定上会**偏宽**（判成"有效"而不判成"被注释满足"）。
 *   该情形**目前只有一处**，且它**本就是自证**（原文确实有块注释 / 剥完后不该剩），
 *   配对的那条用的是删除式剥法 ⇒ **无需修改**；但**判定器**若以本剥法为准，需知道这个偏宽。
 *   判别力已由 `tests/cjk-locator-guard.spec.ts` 的「剥法边界」夹具钉住。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 2026-10-14 修：**两处「从某行起再也不剥注释」的真缺陷** ★★
 * ══════════════════════════════════════════════════════════════════════
 * 旧状态机只认「字符串」与「注释」两种会吃掉后续 Token 的形态，另有两类 Token
 * 它不认识 —— 认错的后果不是「那一行剥错」，而是**引号状态永久错位**：
 * 从此往后的**每一行注释都不再被剥**（把注释当活代码 ⇒ 守卫读数被注释里的中文污染，
 * `tests/demo-data.spec.ts` 那条「源码 contain 锁」也就可能被注释里的串蒙过去）。
 *
 * **缺陷 A · 正则字面量里的引号**（`src/components/agent/TaskDrawer.tsx` 的真实形态）
 *
 *     .replace(/"/g, '&quot;')
 *
 * 正则体里的 `"` 被当成**字符串起始** ⇒ `quote` 卡在 `"` 上直到下一次出现 `"`；
 * 而下一个 `"` 又在一个正则 `/"/g` 里 ⇒ 状态**永久错位**。
 *
 * **缺陷 B · 模板字面量的 `${ }` 替换段**（`src/components/common/Modal.tsx` 的真实形态）
 *
 *     className={`fixed ... ${
 *       placement === 'center'
 *         ? 'bg-ink/45'
 *         : placement === 'fullscreen'
 *           ? // 0.8.4 打印预览：……   ← 这行注释在旧实现里被当成「字符串内容」，永不剥
 *
 * 旧实现把整个模板当**一个字符串**吞掉，`${ … }` 里明明是**真代码**（三元、注释、字符串）
 * 却全被当成字符串内容 ⇒ 替换段里的注释一律漏剥。
 *
 * 实测（抹白后仍含中文的**行数**，`56→16` 等真值与交接包一致）：
 *   `src/components/agent/TaskDrawer.tsx`  **56 → 16**（泄漏 31 行中文注释被当成活代码）
 *   `src/components/common/Modal.tsx`      **19 → 1**
 *   `src/lib/schedule-print.ts`            **67 → 2**
 *   全仓「含中文行」合计 **12837 → 12251**
 *
 * 修法（两处，互不相干）：
 *   **A** 在 `code` 态、`/` 既不是 `//` 也不是 `/*` 时，先按**上一个有意义 token**判断
 *      它是不是**正则字面量的起点**（`reverse_lexer` 一类的标准启发式）：
 *        · 正则**体内**的 `"` `'` 只是普通字符，不进入字符串态；
 *        · 正则内的**转义斜杠** `\/` 被跳过，故 `/\//` 不会把 `//` 认成行注释起点；
 *        · **字符类** `[...]` 内的 `/` 不结束正则，故 `/["']/` 不会提前收尾；
 *        · 收尾后**吞掉 flags**（`/x/gimsy`）。
 *      判定不了（如 `a / b`）时**原样退化成除号**，不改变旧行为。
 *   **B** 模板字面量改成**有栈的正确解析**：`` ` `` 进「模板文本段」，`${` 压栈并切回
 *      **代码态**（真剥注释、真识字符串/正则），裸 `{`/`}` 计数配对，配对满则弹栈
 *      回到模板文本段，`` ` `` 收尾。模板文本段内的 `\` 转义与 `}` 仍是普通字符。
 *
 * 判别力由 `tests/cjk-locator-guard.spec.ts` 的「正则字面量」「模板替换段」两组夹具钉住 ——
 * 其中**必须有会红的反例**：源码里写了 `.replace(/"/g, '&quot;')`（及 `${` 三元）之后
 * 紧跟一行中文注释，剥完后**必须看不到那句中文**（少了这条，本缺陷会复发）。
 */

/** 可以**紧邻**在正则字面量之前的字符（见到这些 ⇒ `/` 是正则起点而不是除号） */
const REGEX_MAY_FOLLOW_CHAR = new Set([
  '', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
  '+', '-', '*', '%', '^', '~', '<', '>',
]);
/**
 * 同理的**关键字**：`return /re/.test(x)` 这种，前一个字符是字母 `n`，
 * 但它不是**标识符**的结尾（`return` 之后只能是表达式或分号）⇒ 仍是正则起点。
 */
const REGEX_MAY_FOLLOW_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'yield', 'await', 'case', 'throw',
]);

/** `/` 处在上一个有意义 token 之后时，它是不是**正则字面量**的起点 */
function canStartRegexLiteral(prevSignificant: string, prevWord: string): boolean {
  if (REGEX_MAY_FOLLOW_CHAR.has(prevSignificant)) return true;
  return REGEX_MAY_FOLLOW_KEYWORD.has(prevWord);
}

export function maskComments(source: string): string {
  const out = source.split('');
  let state: 'code' | 'line' | 'block' = 'code';
  let quote: string | null = null;
  // 正则字面量判定用：上一个**有意义**（非空白、非注释、非字符串）的字符 / 词，及其下标
  let prevSignificant = '';
  let prevWord = '';
  let lastSigIndex = -1;
  /**
   * 模板字面量（缺陷 B）：是否正处在**模板文本段**（`` ` `` 与 `${` 之间）。
   * 为 false 时，若 `tpl` 栈非空，说明我们正处在某个 `${ … }` 的**代码段**里。
   */
  let inTemplateText = false;
  /** `${ … }` 嵌套栈；每项记该层已开的**裸**花括号数（`{a:1}` 这类） */
  const tpl: Array<{ braces: number }> = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const d = source[i + 1];
    if (state === 'code') {
      // ── 模板**文本**段：只认 `\` 转义、`` ` `` 收尾、`${` 开替换段 ──
      if (inTemplateText) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '`') {
          inTemplateText = false;
          prevSignificant = '`';
          prevWord = '';
          lastSigIndex = i;
          i += 1;
          continue;
        }
        if (c === '$' && d === '{') {
          tpl.push({ braces: 0 });
          inTemplateText = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (quote !== null) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) {
          quote = null;
          // 整个字符串算**一个** token：故其后紧跟的 `/` 是除号（`'a' / 2`）
          prevSignificant = c;
          prevWord = '';
          lastSigIndex = i;
        }
        i += 1;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        i += 1;
        continue;
      }
      // 模板字面量起止：`${` 之前/之后的那对反引号
      if (c === '`') {
        inTemplateText = true;
        i += 1;
        continue;
      }
      // ── 在 `${ … }` 的**代码段**里：裸花括号计数配对，配对满则弹栈回到模板文本段 ──
      if (tpl.length > 0) {
        const top = tpl[tpl.length - 1]!;
        if (c === '{') {
          top.braces += 1;
          i += 1;
          continue;
        }
        if (c === '}') {
          if (top.braces > 0) {
            top.braces -= 1;
          } else {
            tpl.pop();
            inTemplateText = true;
            prevSignificant = '}';
            prevWord = '';
            lastSigIndex = i;
          }
          i += 1;
          continue;
        }
      }
      // ⚠️ 顺序要紧：`//` 与 `/*` 必须先判，否则 `/` 会被当成正则起点
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      // ★ 正则字面量：整段（含体内的引号、`\/`、字符类、尾随 flags）一次跳过，
      //   不产出任何注释态转移 —— 这就是「正则里的 `"` 不得改变字符串状态」的落点。
      if (c === '/' && canStartRegexLiteral(prevSignificant, prevWord)) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < source.length) {
          const ch = source[j]!;
          if (ch === '\\') {
            j += 2;
            continue;
          }
          if (ch === '\n') break; // 正则不跨行 ⇒ 判定失败
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) {
            closed = true;
            j += 1;
            break;
          }
          j += 1;
        }
        if (closed) {
          while (j < source.length && /[a-z]/i.test(source[j]!)) j += 1; // flags
          prevSignificant = source[j - 1] ?? '/';
          prevWord = '';
          lastSigIndex = j - 1;
          i = j;
          continue;
        }
        // 没闭合 ⇒ 判不了，当除号走下面（保持旧行为）
      }
      if (!/\s/.test(c)) {
        if (/[A-Za-z0-9_$]/.test(c)) prevWord = lastSigIndex === i - 1 ? prevWord + c : c;
        else prevWord = '';
        prevSignificant = c;
        lastSigIndex = i;
      }
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
      i += 1;
      continue;
    }
    // block
    if (c === '*' && d === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      state = 'code';
      i += 2;
      continue;
    }
    if (c !== '\n') out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

/** 取一行里全部含 CJK 的引号串（含其起始下标） */
function cjkStringLiterals(line: string): Array<{ value: string; from: number }> {
  const out: Array<{ value: string; from: number }> = [];
  for (const m of line.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    if (CJK.test(value)) out.push({ value, from: m.index ?? 0 });
  }
  return out;
}

/**
 * 定位类调用（字符串出现在这些调用的实参里 ⇒ 是定位契约）。
 * ⚠️ 必须允许**泛型实参**：本仓真实写法是
 *   `document.querySelector<HTMLButtonElement>('button[aria-label="打开导航菜单"]')`
 *   —— `querySelector` 与 `(` 之间隔了 `<…>`。夹具里那条正例就是为了钉住这一点
 *   （第一版漏了它，夹具当场报红 —— 这正是「先写夹具」的价值）。
 */
const LOCATOR_CALLS =
  /\b(locator|querySelector|querySelectorAll|waitForSelector|\$\$?)\s*(?:<[^<>()]*>)?\s*\(/;
/** 断言类（出现在这些上下文里 ⇒ 是「断言内容」，有意不锁） */
const CONTENT_ASSERT = /\.(toContain|toBe|toEqual|toMatch|toHaveText)\s*\(/;
/** 按可见文案定位（有意不锁，见文件头） */
const TEXT_LOCATOR = /\b(getByText|hasText\s*:|textContent\s*\)\s*\.toContain)\s*/;

/**
 * 扫一段源码，返回**必须修**的中文定位（零容差：命中即红）。
 * 输入应该是**已 mask 掉注释**的代码（本函数内部会再 mask 一次，幂等）。
 */
export function scanCjkLocators(rawSource: string): CjkLocatorHit[] {
  const masked = maskComments(rawSource);
  const hits: CjkLocatorHit[] = [];
  for (const line of masked.split(/\r?\n/)) {
    if (!CJK.test(line)) continue;
    const literals = cjkStringLiterals(line);
    if (literals.length === 0) continue;

    const isLocatorCall = LOCATOR_CALLS.test(line);
    const isContentAssert = CONTENT_ASSERT.test(line);

    for (const { value, from } of literals) {
      const head = line.slice(0, from);

      // ① aria-label="<CJK>" 出现在定位调用里
      if (isLocatorCall && !isContentAssert && /aria-label\s*=\s*$/.test(head.trimEnd() + '=')) {
        // head 以 `aria-label=` 结尾（同一字符串内），且本行是定位调用
        hits.push({ text: line.trim(), kind: 'aria-label-selector' });
        continue;
      }
      if (isLocatorCall && /aria-label=/.test(value) && !isContentAssert) {
        hits.push({ text: line.trim(), kind: 'aria-label-selector' });
        continue;
      }
      // ② getByRole(..., { name: '<CJK>' })
      if (/\bgetByRole\s*\(/.test(line) && /name\s*:\s*$/.test(head.trimEnd() + ':')) {
        hits.push({ text: line.trim(), kind: 'getByRole-name' });
        continue;
      }
      if (/\bgetByRole\s*\(/.test(line) && /name\s*:/.test(line) && !TEXT_LOCATOR.test(line)) {
        hits.push({ text: line.trim(), kind: 'getByRole-name' });
        continue;
      }
      // ③④⑤ getByLabel / getByPlaceholder / getByTitle('<CJK>')
      for (const [re, kind] of [
        [/\bgetByLabel\s*\(\s*$/, 'getByLabel'],
        [/\bgetByPlaceholder\s*\(\s*$/, 'getByPlaceholder'],
        [/\bgetByTitle\s*\(\s*$/, 'getByTitle'],
      ] as const) {
        if (re.test(head.trimEnd() + ' ')) {
          hits.push({ text: line.trim(), kind });
          break;
        }
      }
    }
  }
  return hits;
}

/* ══════════════════════════ 全仓扫描（守卫用） ══════════════════════════ */

/** 递归收集 `tests/**` 下的 spec/helper（排除 setup 与自身） */
export function specFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(ts|tsx)$/.test(name)) out.push(abs.slice(repoRoot.length + 1).split(sep).join(posix.sep));
    }
  };
  walk(join(repoRoot, 'tests'));
  return out.filter((f) => !/cjk-locator-guard/.test(f));
}

/** 全仓扫一遍：返回 `文件:行 → 命中` 列表（空 = 干净） */
export function scanRepo(repoRoot: string): Array<{ file: string; line: number; hit: CjkLocatorHit }> {
  const out: Array<{ file: string; line: number; hit: CjkLocatorHit }> = [];
  for (const file of specFiles(repoRoot)) {
    const text = readFileSync(join(repoRoot, file), 'utf-8');
    const masked = maskComments(text);
    const lines = masked.split(/\r?\n/);
    // 逐行喂给纯函数（保持行号可回溯）
    lines.forEach((line, idx) => {
      for (const hit of scanCjkLocators(line)) out.push({ file, line: idx + 1, hit });
    });
  }
  return out;
}
