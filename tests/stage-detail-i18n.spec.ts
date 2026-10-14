// @vitest-environment jsdom
/**
 * 笔 3-D · 阶段抽屉族（抽屉壳 / 任务清单 / 资料路径 / 延期档案）的**语言契约**（新 spec）。
 *
 * ══════════════════ 补的是哪四类缺口 ══════════════════
 * ① **取值逐字（短取值）**：本笔多条取值短于 `tools/zh-verbatim-check.mjs` 的分段阈值（≥6），
 *    那个工具一条都判不了 —— 下面表内的 `toBe(字面量)` 才是它们的低界。
 * ② **「钩子换掉之后」的那半边**（本笔把 4 处中文 aria 定位换成了 `data-*` 钩子）：
 *    钩子只证结构，**证明不了页面消费了哪个键** ⇒ 这里补「可见名 = 消息表那句」：
 *      · 取值锁（表里有这句）+ **调用形状锁**（组件确实把它传给了 ariaLabel / aria-label）。
 *    用**调用形状**而不是「文件里出现过该字面量」：后者会被 import 行或注释满足（本仓实测过的假绿）。
 * ③ **跨笔不漂**：`StageDrawer` 的「开始 / 截止」与 3-C `StageBar` 拖拽气泡那两个**短语键**
 *    必须可复算地一致（裸词 + 空格 + 日期）。
 * ④ **消费锁（防死词条）**：每个新键都必须在 `src/**` 的**活代码**里出现为字面量。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments } from './helpers/cjk-locator-guard';
import { catalogOf, t, type MessageKey } from '../src/i18n';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/* ══════════════ ① 取值锁（zh 字面量，表驱动） ══════════════ */
const ZH_LITERALS: ReadonlyArray<{ key: MessageKey; vars?: Record<string, string | number>; zh: string }> = [
  { key: 'timeline.dateEdge.start', zh: '开始' },
  { key: 'timeline.dateEdge.end', zh: '截止' },
  { key: 'stageDrawer.ariaWithName', vars: { name: '施工图' }, zh: '阶段详情：施工图' },
  { key: 'stageDrawer.subtitle', vars: { project: '项目甲', n: 3 }, zh: '项目甲 · 第 3 阶段' },
  { key: 'stageDrawer.closeAria', zh: '关闭抽屉' },
  { key: 'stageDrawer.tasksTitle', zh: '本阶段该做' },
  { key: 'stageDrawer.resourcesTitle', zh: '备注与资料' },
  { key: 'stageDrawer.delayArchiveTitle', zh: '延期档案（只增不改）' },
  { key: 'stageDrawer.nextStageToast', vars: { name: '交付' }, zh: '可提醒下一阶段「交付」的成员开工' },
  { key: 'stageDrawer.switchTo', vars: { status: '进行中' }, zh: '切换为 进行中' },
  { key: 'stageDrawer.postponePrompt', zh: '截止日后移需要填写延期原因（将完整留痕）：' },
  { key: 'stageDrawer.postponeCancelled', zh: '未填写延期原因，已取消保存。' },
  {
    key: 'delayHistory.empty',
    zh: '暂无改期记录。拖拽彩条边缘或修改日期并确认后，将在此追加一条不可篡改的档案。',
  },
  { key: 'delayHistory.operator', vars: { name: '张三' }, zh: ' · 操作人 张三' },
  { key: 'delayHistory.shifted', zh: ' · 平移/提前' },
  { key: 'taskChecklist.markDone', zh: '标记完成' },
  { key: 'taskChecklist.markUndone', zh: '标记未完成' },
  { key: 'taskChecklist.unassigned', zh: '未指派' },
  { key: 'taskChecklist.primaryOwner', vars: { name: '李四' }, zh: '主负责人：李四' },
  { key: 'taskChecklist.assignAria', zh: '指派参与人（多选）' },
  { key: 'taskChecklist.assignTitle', zh: '指派参与人（可多选）' },
  { key: 'taskChecklist.noMembers', zh: '还没有成员，请先在首页添加成员。' },
  { key: 'taskChecklist.removeAria', vars: { name: '王五' }, zh: '移除 王五' },
  { key: 'taskChecklist.removeEntryAria', zh: '删除条目' },
  { key: 'taskChecklist.newEntryPlaceholder', zh: '条目标题，回车确认' },
  { key: 'taskChecklist.addEntry', zh: '添加条目' },
  /* ⚠️ 反斜杠是**真路径分隔符**：这里是 JS 字符串 ⇒ 期望值必须写成 `\\` 才是真反斜杠。
     写成单个 `\` 会变成「丢弃转义字符」，断言反而**锁不住**渲染缺陷。 */
  { key: 'resourcePath.placeholder', zh: '如 D:\\项目资料\\03-方案 或 file://D:/…' },
  { key: 'resourcePath.register', zh: '登记本阶段资料文件夹路径…' },
  { key: 'resourcePath.open', zh: '打开' },
  { key: 'resourcePath.copy', zh: '复制路径' },
  { key: 'resourcePath.edit', zh: '修改' },
  { key: 'resourcePath.savedToast', zh: '资料路径已保存' },
  {
    key: 'resourcePath.openFallbackToast',
    zh: '浏览器不允许直接打开本地文件夹，已复制路径，请粘贴到资源管理器地址栏。',
  },
  { key: 'common.confirm', zh: '确定' },
];

const NEW_KEYS: readonly MessageKey[] = [...ZH_LITERALS.map((r) => r.key), 'common.unknown', 'common.cancel', 'common.save'];

describe('① zh 取值锁（字面量表驱动）', () => {
  it.each(ZH_LITERALS)('$key → «$zh»', ({ key, vars, zh }) => {
    expect(t(key, vars), `${key} 的 zh 取值变了（zh 逐字不变是硬线）`).toBe(zh);
  });

  it('复用键的取值一字未变（未新造「未知/取消/保存」第二份）', () => {
    expect(catalogOf('zh')['common.unknown']).toBe('未知');
    expect(catalogOf('zh')['common.cancel']).toBe('取消');
    expect(catalogOf('zh')['common.save']).toBe('保存');
  });

  it('★ 跨笔不漂：「开始 / 截止」的短语键可复算自裸键', () => {
    // 3-C 的拖拽气泡（短语）与 3-D 的 DateRow（裸词）——同一对词只能有一个出处
    expect(catalogOf('zh')['timeline.dragBubble.start']).toBe(
      `${catalogOf('zh')['timeline.dateEdge.start']} {date}`,
    );
    expect(catalogOf('zh')['timeline.dragBubble.end']).toBe(
      `${catalogOf('zh')['timeline.dateEdge.end']} {date}`,
    );
  });
});

/* ══════════════ ② 可见名 = 消息表那句（调用形状，不是字面量出现过） ══════════════ */
describe('② 钩子换掉后的那半边：可见名确实取自消息表', () => {
  it('★ 抽屉 aria：`Modal ariaLabel={t(\'stageDrawer.ariaWithName\', …)}`（调用形状锁）', () => {
    const src = maskComments(read('src/components/stage-detail/StageDrawer.tsx'));
    expect(src, '抽屉 aria 没走消息表 ⇒ 与 data-stage-drawer 钩子脱钩').toMatch(
      /ariaLabel=\{t\('stageDrawer\.ariaWithName'/,
    );
    // 同一次调用里必须把阶段名传进去（漏传会渲染成 `{name}` 字面量）
    expect(src).toMatch(/ariaLabel=\{t\('stageDrawer\.ariaWithName'[\s\S]{0,80}?name:\s*stage\.name/);
  });

  it('★ 删除条目钮：`data-task-remove` 钩子与 aria 必须成对（钩子背后有人话）', () => {
    const src = maskComments(read('src/components/stage-detail/TaskChecklist.tsx'));
    expect(src, '删除钮消失了？那下面的钩子断言是空的').toContain('data-task-remove=""');
    expect(src, '挂钩子但 aria 没走消息表 ⇒ 读屏名成了硬编码').toMatch(
      /data-task-remove=""[\s\S]{0,160}?t\('taskChecklist\.removeEntryAria'\)/,
    );
  });

  it('抽屉内容根挂的是 `data-stage-drawer`（不是 `role`/`aria` 那两处）', () => {
    const src = maskComments(read('src/components/stage-detail/StageDrawer.tsx'));
    expect(src).toMatch(/<aside\s+data-stage-drawer=""/);
  });
});

/* ══════════════ ③ 消费锁：新键必须在 src 的活代码里被引用 ══════════════ */
function srcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) srcFiles(abs, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}

describe('③ 消费锁：本笔每个键都真的被 src/** 的活代码消费（防死词条）', () => {
  const code = srcFiles(join(rootDir, 'src'))
    .map((abs) => maskComments(readFileSync(abs, 'utf8')))
    .join('\n');

  it.each(NEW_KEYS)('%s 在 src/** 里出现为字面量', (key) => {
    expect(code.includes(`'${key}'`), `${key} 没有任何 src 消费方 ⇒ 死词条`).toBe(true);
  });
});
