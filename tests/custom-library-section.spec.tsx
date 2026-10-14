// @vitest-environment jsdom
/**
 * 设置 · 行业库区 UI spec（她反馈 #6.2 新流程：复制 prompt → Agent 生成 → 导回校验）。
 *
 * 纯函数层（prompt 生成 / 错误翻译）在 custom-library-prompt.spec.ts；
 * 本文件钉住 **UI 行为层**：
 *   ① 三步常驻条 + 主按钮「复制提示词」是 pine 主按钮、「导入行业包」退居次按钮；
 *   ② 复制 = 代码生成的 prompt + 用户的一句话（tail 拼接）；
 *   ③ 勾选框开启时才把现有库 JSON 拼进 prompt；
 *   ④ 导入成功确认卡（她：「导入后给个响」——用现有板块映射 domainLabel 出板块名）；
 *   ⑤ 已导入行「导出」按钮下载该包 JSON；
 *   ⑥-1/⑥-3 失败路径：三种预告卡 + 逐条人话错误 + 一键复制全部错误贴回 Agent；
 *   ⑥-4 不落半包：校验失败时 settings.set 一次都不能被调用。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { File as NodeFile } from 'node:buffer';

const logUserSpy = vi.fn();
vi.mock('../src/core/services/log.service', () => ({
  logUser: (...args: unknown[]) => logUserSpy(...args),
}));

// 只顶掉 DI 入口 useRepos：settings 用内存替身（get/set 记账）。
// 替身必须是**稳定对象**——组件 reload = useCallback([repos])，每次渲染发新对象
// 会让 effect 自触发无限循环、act 永远不 resolve（真实 hook 返回稳定 context 值）。
const settingsSet = vi.fn<(key: string, value: unknown) => Promise<void>>(async () => {});
const settingsGet = vi.fn<() => Promise<unknown>>(async () => stored);
let stored: unknown = [];
const reposStub = { settings: { get: settingsGet, set: settingsSet } };
vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => reposStub,
}));

import { CustomLibrarySection } from '../src/components/settings/CustomLibrarySection';
import { catalogOf, setLang } from '../src/i18n';

/**
 * 恢复出厂中文。
 * ⚠️ 本 spec 的 ⑦ 会切到英文 —— 语言是 `src/i18n/lang.ts` 的**模块级单例**，而
 * `vite.config.ts` 配的是 `pool:'threads' + singleThread:true`（全部 spec 共用**一个
 * 进程**）⇒ 不回收就会让**后面每一个文件**都跑在英文下（「单跑绿 / 全量红」的第三个根，
 * 见 `tests/setup.ts` 顶部那段）。故 `beforeEach` + `afterEach` 双向复位。
 */
function resetLang(): void {
  setLang('zh');
  try {
    localStorage.removeItem('idplan-lang');
  } catch {
    /* 忽略：存储不可用时仅本会话生效 */
  }
}

const GOOD_LIB = {
  schema: 'idplan-custom-library/v1',
  name: '新库',
  domain: 'indoor',
  items: [
    { key: 'usr.site', name: '选址', ratioPercent: 30, colorIndex: 1, kanbanColumn: 'design', defaultResponsibility: '', defaultTasks: ['看场'] },
    { key: 'usr.open', name: '开业筹备', ratioPercent: 70, colorIndex: 2, kanbanColumn: 'promo', defaultResponsibility: '', defaultTasks: [] },
  ],
  presets: [{ key: 'usr.tea-full', name: '茶空间全流程', description: '', itemKeys: ['usr.site', 'usr.open'] }],
};

async function renderInto(el: HTMLElement): Promise<void> {
  await act(async () => {
    const { createRoot } = await import('react-dom/client');
    createRoot(el).render(<CustomLibrarySection />);
  });
}

function btn(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(text),
  );
}

/**
 * 与 `btn` 同源，但**找不到就红** —— 用于「这一下必须点到」的交互。
 *
 * 为什么单独加一个而不是改 `btn`：`btn` 还有**合理地接受不存在**的用法
 * （例如 `expect(btn(...) ?? container.textContent?.includes(...)).toBeTruthy()`）。
 * 而 `btn(...)?.click()` 那种写法在找不到时**静默点空** ⇒ 「这一步没发生」会被
 * 后面的断言/取值当成别的问题（假绿或指错方向的红）。
 * 2026-10-14 静默前置扫雷批。
 */
function mustBtn(container: HTMLElement, text: string): HTMLButtonElement {
  const el = btn(container, text);
  expect(
    el,
    `用例前置失效：找不到按钮「${text}」⇒ 这一步没发生（旧写法 btn(...)?.click() 会静默点空）`,
  ).toBeTruthy();
  return el!;
}

/**
 * 走「选文件」链路：jsdom 25 的 File 没有 .text()（jsdom 26 才补），
 * 用 node:buffer 的 File（size/text 齐全）做替身——组件侧 API 不变。
 */
function makeFile(name: string, text: string): File {
  return new NodeFile([text], name, { type: 'application/json' }) as unknown as File;
}

/** jsdom 里给 file input 塞 File 并派发 change */
async function pickFile(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('CustomLibrarySection · 她反馈 #6.2 新流程', () => {
  let container: HTMLElement;
  let clipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    // 复位也包 act：`renderInto` **不 unmount**（root 被丢弃、只把容器从 DOM 摘掉），
    // 上一用例的组件树仍订阅着语言 store ⇒ 不包 act 就是「未包 act 的状态更新」告警。
    act(() => {
      resetLang();
    });
    stored = [];
    settingsSet.mockClear();
    settingsGet.mockClear();
    logUserSpy.mockClear();
    clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'clipboard');
    // 同上：复位语言若把 store 从 en 切回 zh，会 emit 给**仍挂载**的组件 ⇒ 必须包 act
    act(() => {
      resetLang();
    });
  });

  it('① 三步常驻条 + 主按钮形态：pine 主「复制提示词」/ 次「导入行业包」', async () => {
    await renderInto(container);
    const text = container.textContent ?? '';
    expect(text).toContain('复制提示词');
    expect(text).toContain('发给你的 Agent，让它只回一个 JSON');
    expect(text).toContain('导回这里');
    const copyBtn = btn(container, '复制提示词');
    const importBtn = btn(container, '导入行业包');
    expect(copyBtn?.className).toContain('soft-btn-primary');
    expect(importBtn?.className).toContain('soft-btn-ghost');
    // 多行输入在场
    const note = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(note).toBeTruthy();
    expect(container.textContent).toContain('附上我当前的行业库（0 个）作参照');
  });

  it('② 复制提示词 = 代码生成的 prompt + 用户的一句话（尾部拼接）', async () => {
    await renderInto(container);
    const note = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(note, '社区咖啡店，从选址到开业运营');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      mustBtn(container, '复制提示词').click();
    });
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = String(clipboard.writeText.mock.calls[0]![0]);
    expect(copied).toContain('idplan-custom-library/v1');
    expect(copied).toContain('usr.');
    expect(copied).toContain('引用完整性');
    expect(copied).toContain('只输出一个 JSON 代码块');
    expect(copied.endsWith('【用户的一句话描述】\n社区咖啡店，从选址到开业运营')).toBe(true);
    expect(container.textContent).toContain('提示词已复制');
    expect(logUserSpy).toHaveBeenCalled();
  });

  it('③ 勾选框开启时才附现有库（不勾不附）', async () => {
    stored = [
      {
        schema: 'idplan-custom-library/v1',
        name: '已有库X',
        domain: 'travel',
        items: [{ key: 'usr.t', name: '踩点', ratioPercent: 100, colorIndex: 1, kanbanColumn: 'research', defaultResponsibility: '', defaultTasks: [] }],
        presets: [{ key: 'usr.tp', name: '全流程', description: '', itemKeys: ['usr.t'] }],
        importedAt: '2026-10-06T00:00:00.000Z',
      },
    ];
    await renderInto(container);
    await act(async () => {
      mustBtn(container, '复制提示词').click();
    });
    let copied = String(clipboard.writeText.mock.calls[0]![0]);
    expect(copied).not.toContain('已有库X');
    expect(container.textContent).toContain('附上我当前的行业库（1 个）作参照');

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    await act(async () => {
      mustBtn(container, '复制提示词').click();
    });
    copied = String(clipboard.writeText.mock.calls[1]![0]);
    expect(copied).toContain('【用户当前的行业库');
    expect(copied).toContain('已有库X');
    // 「附参照」的痕迹落日志（logUser 走 spy），flash 是面向用户的复制成功提示
    expect(logUserSpy.mock.calls.some((c) => String(c[1]).includes('附 1 个现有库作参照'))).toBe(true);
    expect(container.textContent).toContain('提示词已复制');
  });

  it('④ 导入成功确认卡：名/阶段数/套餐数/板块中文（用 domainLabel）+ 落库', async () => {
    stored = [
      { ...GOOD_LIB, name: '旧库', importedAt: '2026-10-01T00:00:00.000Z' },
    ];
    await renderInto(container);
    await pickFile(container, makeFile('lib.json', JSON.stringify(GOOD_LIB)));
    const text = container.textContent ?? '';
    expect(text).toContain('已导入「新库」：2 个阶段 · 1 个套餐 · 挂在「室内」板块下');
    expect(text).toContain('建档时选「室内」就能看到');
    expect(text).toContain('同名再导入 = 更新这一包');
    // 落库 = settings.set 一次，且内容含新包（旧包保留、同名不叠加）
    expect(settingsSet).toHaveBeenCalledTimes(1);
    const written = settingsSet.mock.calls[0]![1] as Array<{ name: string }>;
    expect(written.map((l) => l.name).sort()).toEqual(['新库', '旧库']);
    // 列表行出现新包 + 导出按钮
    expect(btn(container, '新库') ?? container.textContent?.includes('新库')).toBeTruthy();
    expect(container.querySelector('[data-testid="library-export-新库"]')).toBeTruthy();
  });

  it('⑤ 已导入行「导出」下载该包 JSON', async () => {
    stored = [{ ...GOOD_LIB, name: '已有库X', importedAt: '2026-10-01T00:00:00.000Z' }];
    await renderInto(container);
    const exportBtn = container.querySelector(
      '[data-testid="library-export-已有库X"]',
    ) as HTMLButtonElement;
    expect(exportBtn).toBeTruthy();
    /*
     * ★ 升级锁（2026-10-14 语言切换批）：原断言是
     *   `querySelector('button[aria-label="导出行业包 已有库X"]')` —— **拿中文 aria 当定位**。
     *   那是哑雷：aria 取值已改走 `t('library.exportAria', { name })`，切英文即变
     *   `Export industry library 已有库X` ⇒ 这条选择器在英文态永远找不到元素（且失败会
     *   伪装成「按钮不存在」）。改成两层：① 用与语言无关的 data- 钩子定位；
     *   ② 把「可见名」单独断言成**消息表里那句**（表里有这句 + 页面确实消费该键）。
     */
    expect(exportBtn.getAttribute('aria-label')).toBe(
      catalogOf('zh')['library.exportAria'].replace('{name}', '已有库X'),
    );
    await act(async () => {
      exportBtn.click();
    });
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已导出「已有库X.json」');
  });

  it('⑥-1/③ 失败路径：三种预告卡 + 逐条人话 + 一键复制贴回 Agent', async () => {
    const bad = {
      ...GOOD_LIB,
      items: [
        ...GOOD_LIB.items,
        { key: 'bad.site', name: '选址', ratioPercent: 90, colorIndex: 3, kanbanColumn: 'delivery', defaultResponsibility: '', defaultTasks: [] },
      ],
      presets: [{ key: 'usr.tea-full', name: '茶空间全流程', description: '', itemKeys: ['usr.site', 'usr.open', 'bad.site'] }],
    };
    await renderInto(container);
    await pickFile(container, makeFile('bad.json', JSON.stringify(bad)));
    const text = container.textContent ?? '';
    // 三种预告卡
    expect(text).toContain('Agent 多输出了说明文字，不是纯 JSON');
    expect(text).toContain('阶段 key 忘了 usr. 前缀');
    expect(text).toContain('套餐引用了本包没有的阶段 key');
    // 逐条人话（路径翻译：第 3 个阶段的 key）
    expect(text).toContain('第 3 个阶段（选址）');
    // 一键复制全部错误
    const copyErrBtn = btn(container, '一键复制全部错误，贴回给 Agent');
    expect(copyErrBtn).toBeTruthy();
    await act(async () => {
      copyErrBtn?.click();
    });
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    const feedback = String(clipboard.writeText.mock.calls[0]![0]);
    expect(feedback).toContain('请按下面每一条修正');
    expect(feedback).toContain('1. 第 3 个阶段（选址）的key');
  });

  it('⑥-1b 非 JSON 文件：文件级人话（指向预告卡①的解救动作）', async () => {
    await renderInto(container);
    await pickFile(container, makeFile('x.json', '这是 Agent 的说明文字，不是 JSON'));
    expect(container.textContent).toContain('这个文件不是合法的 JSON');
    expect(container.textContent).toContain('多半是 Agent 在 JSON 前后多输出了说明文字');
  });

  it('⑥-4 不落半包：校验失败时 settings.set 一次都没被调用', async () => {
    const bad = { ...GOOD_LIB, items: [{ ...GOOD_LIB.items[0]!, key: 'nope.site' }, GOOD_LIB.items[1]!] };
    await renderInto(container);
    await pickFile(container, makeFile('bad.json', JSON.stringify(bad)));
    expect(settingsSet).not.toHaveBeenCalled();
    expect(container.textContent).toContain('第 1 个阶段（选址）的key');
  });

  /*
    ★ F1-③（审计）：**落库失败**必须有反馈。
    修复前 `onPick` 只有 try/finally 没有 catch —— `repos.settings.set` 抛错时 Promise
    静默 reject，界面一声不吭，而 finally 已把 file input 清空。用户看到的是
    「选完文件 → 框空了 → 什么都没发生」，重试多少次都一样（错误只进本地日志）。
    本用例与 ⑥-4 是同一动作的两条相反结论：**校验没过**（不落库、报校验错）
    vs **校验全过但没落盘**（必须报「未导入」）。
  */
  it('⑥-5 落库失败必须有反馈：失败卡说明「未导入」，且不出现成功确认卡', async () => {
    settingsSet.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await renderInto(container);
    await pickFile(container, makeFile('good.json', JSON.stringify(GOOD_LIB)));
    const text = container.textContent ?? '';
    expect(text, '必须说清楚「行业包未导入」').toContain('写入本地存储失败');
    expect(text).toContain('行业包未导入');
    expect(text, '不得给出「导入成功」的假象').not.toContain('导入了');
    // 既有形态不变：失败卡仍是文件级卡（复用，不是新 UI），且清单里没有这个包
    expect(text).not.toContain('已导入的行业库（1）');
    expect(logUserSpy).not.toHaveBeenCalled();
    // 文件选择框照旧清空（finally 语义未变，重试路径不受影响）
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('⑥-6 落库失败后仍可再次导入（busy 复位、错误卡不锁死流程）', async () => {
    settingsSet.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await renderInto(container);
    await pickFile(container, makeFile('good.json', JSON.stringify(GOOD_LIB)));
    expect(container.textContent).toContain('写入本地存储失败');

    settingsSet.mockResolvedValueOnce(undefined);
    await pickFile(container, makeFile('good.json', JSON.stringify(GOOD_LIB)));
    const text = container.textContent ?? '';
    expect(settingsSet).toHaveBeenCalledTimes(2);
    expect(text, '第二次成功：失败卡让位给成功确认卡').not.toContain('写入本地存储失败');
    expect(text).toContain('新库');
  });

  /*
    ══════════════════════════════════════════════════════════════════════════
    ★ ⑦ 切语言的**唯一**易漏点：`useCallback` 的 `t`-deps 陷阱（2026-10-14）
    ══════════════════════════════════════════════════════════════════════════
    病灶：`useLang()` 给的 `t` 是 `useCallback(..., [lang])` ⇒ **切语言时换新身份**。
    组件里 `const onCopyPrompt = useCallback(..., [note, attachRef, libs])`
    （漏了 `t`）会永久捕获**挂载那一刻的 t**（语言在闭包里定格）⇒ 切英文后
    **界面是英文、toast 仍是中文**。

    为什么必须单独一条：这种形状**在中文态下完全看不出来**（默认语言就是中文，
    「捕获旧 t」与「每次取当下 t」在中文下给出同一个结果），只有「渲染后再切语言、
    再触发回调」这一个序列能分辨。它是本仓最怕的那类假绿。
    （第 5 条用例已经证明「渲染期正文」会跟着语言变 —— useLang 订阅正常工作；
      它**证明不了**回调闭包里的 `t` 是新的。两条判据各管一段。）

    判据：同一枚按钮点两次 —— ① 中文态点 ⇒ flash 是中文那句；② 切 en 再点
    ⇒ flash 必须是**英文表里那句**（不是中文那句，也不是空的）。
  */
  it('⑦ 回调里取词必须跟随语言（守住 useCallback 的 t-deps 陷阱）', async () => {
    await renderInto(container);
    const zhCopy = catalogOf('zh')['library.flash.copied'];
    const enCopy = catalogOf('en')['library.flash.copied'];
    expect(zhCopy).not.toBe(enCopy);

    // ① 中文态：flash = 中文那句
    await act(async () => {
      mustBtn(container, '复制提示词').click();
    });
    expect(container.textContent).toContain(zhCopy);

    // ② 切英文（组件已挂载 ⇒ 走的是「重渲染 + 回调闭包」这条路，不是重新挂载）
    await act(async () => {
      setLang('en');
    });
    // 正文确实换了语言（useLang 订阅正常工作）
    expect(container.textContent).toContain(catalogOf('en')['library.title']);
    expect(container.textContent).not.toContain(catalogOf('zh')['library.title']);

    // ③ 再点同一枚按钮（用与语言无关的钩子定位）：flash 必须是**英文**那句
    const copyBtn = container.querySelector('[data-testid="library-copy-prompt"]') as HTMLButtonElement;
    expect(copyBtn, '前置失效：找不到复制按钮').toBeTruthy();
    await act(async () => {
      copyBtn.click();
    });
    const text = container.textContent ?? '';
    expect(
      text,
      '回调捕获了旧语言的 t（切英文后 toast 仍是中文 = 界面英文、反馈中文）',
    ).toContain(enCopy);
    expect(text, '旧语言那句不许还在').not.toContain(zhCopy);
  });
});
