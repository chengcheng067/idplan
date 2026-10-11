// @vitest-environment jsdom
/**
 * 降级安装（库版本 > 程序版本）= **独立致命分支**，不再冒充「隐私模式」（审计 F1-②）。
 *
 * 缺陷原文（修复前）：
 *   库比程序新时，唯一出口是 `db.open()` 抛 Dexie `VersionError`，而
 *   `openDatabase()` 把所有打开异常归一成「本地数据库打开失败，请检查浏览器隐私模式或
 *   存储空间。」，致命页再补一句「请确认未处于浏览器无痕/隐私模式，或为站点启用站点数据
 *   后刷新重试」。于是「版本不匹配」被说成「隐私模式问题」——用户照做无效，最自然的
 *   下一步就是**删站点数据 / 重装应用**，那会真的把整库数据删掉；
 *   而正确答案只是「换回不低于该版本的应用」。
 *
 * 本 spec 钉住四条：
 *   ① 判据在**探测结果**上显式判别（`isDbAheadOfApp`），不靠 catch 嗅异常类名；
 *   ② 致命页印出**两边**版本号 + 明确劝阻「删站点数据/重装」；
 *   ③ **绝不**自动降级/删库/修复 —— 断言 `createRepositories` 一次都没被调用；
 *   ④ 隐私模式分支仍在，但**只**为真正的初始化失败；旧库备份闸门（L1）不受影响。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { RepoProvider } from '../src/di/repository.provider';
import { SCHEMA_VERSION } from '../src/core/schema/current';
import { isDbAheadOfApp, needsPreMigrationBackup } from '../src/core/repositories/local/dexie.database';

const hoisted = vi.hoisted(() => ({
  /** 探测到的库版本（Dexie verno 语义）；null = 全新环境 */
  verno: null as number | null,
  createRepositories: vi.fn(),
  exportBackup: vi.fn(async () => true),
}));

/** 只替换探测值，其余（isDbAheadOfApp / needsPreMigrationBackup）保持**真身**——
 *  本 spec 要测的正是这两个判据与 UI 的接线，若把它们也 mock 掉就成了自证空转。 */
vi.mock('../src/core/repositories/local/dexie.database', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/core/repositories/local/dexie.database')>();
  return { ...actual, detectLocalDbVersion: async () => hoisted.verno };
});

vi.mock('../src/core/repositories', () => ({
  createRepositories: (...args: unknown[]) => hoisted.createRepositories(...args),
}));

vi.mock('../src/core/execution/execution-recovery', () => ({
  recoverZombieExecutions: async () => undefined,
}));

vi.mock('../src/components/layout/useBackupIo', () => ({
  exportPreMigrationBackupToFile: () => hoisted.exportBackup(),
}));

const FAKE_BUNDLE = {
  projects: { list: async () => [] },
  executions: {},
};

let container: HTMLDivElement;
let root: Root;

function text(): string {
  return container.textContent ?? '';
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount(): void {
  act(() => {
    root.render(
      <RepoProvider>
        <div data-child-ok="">已进入应用</div>
      </RepoProvider>,
    );
  });
}

beforeEach(() => {
  hoisted.verno = null;
  hoisted.createRepositories.mockReset();
  hoisted.createRepositories.mockResolvedValue(FAKE_BUNDLE);
  hoisted.exportBackup.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('F1-② 判据本身（唯一出处）', () => {
  it('isDbAheadOfApp：只有「库比程序新」为真；null/同版/更旧都为假', () => {
    expect(isDbAheadOfApp(null)).toBe(false);
    expect(isDbAheadOfApp(SCHEMA_VERSION)).toBe(false);
    expect(isDbAheadOfApp(SCHEMA_VERSION - 1)).toBe(false);
    expect(isDbAheadOfApp(SCHEMA_VERSION + 1)).toBe(true);
  });

  it('两个判据互补且互斥（不会同时命中，也不会有缝）', () => {
    for (const v of [null, SCHEMA_VERSION - 1, SCHEMA_VERSION, SCHEMA_VERSION + 1]) {
      expect(isDbAheadOfApp(v) && needsPreMigrationBackup(v)).toBe(false);
    }
  });
});

describe('F1-② 降级安装：独立致命页', () => {
  it('库比程序新 → 出「本地数据比当前应用更新」页，印两边版本号且不冒充隐私模式', async () => {
    hoisted.verno = SCHEMA_VERSION + 1;
    mount();
    await flush();

    expect(text()).toContain('本地数据比当前应用更新');
    expect(text(), '两边版本号都要露出来').toContain(`v${SCHEMA_VERSION + 1}`);
    expect(text()).toContain(`v${SCHEMA_VERSION}`);
    expect(text(), '必须明示不会动数据').toContain('没有打开它');
    expect(text(), '必须劝阻删站点数据').toContain('不要删除浏览器/站点数据');
    expect(text()).toContain('重装');
    expect(text(), '这不是隐私模式问题，不得再给这条误导指引').not.toContain('无痕');
    expect(container.querySelector('[data-child-ok]'), '不得进入应用').toBeNull();
  });

  it('绝不自动降级/删库/修复：连仓储都不创建（createRepositories 零调用）', async () => {
    hoisted.verno = SCHEMA_VERSION + 1;
    mount();
    await flush();

    expect(hoisted.createRepositories, '创建仓储 = 会 open 库、可能触发 Dexie 自己的处理').toHaveBeenCalledTimes(0);
    expect(hoisted.exportBackup, '也不要顺手导出/覆盖任何东西').toHaveBeenCalledTimes(0);
  });

  it('同版本 / 更旧的库都不进这条分支（判据不是「只要库存在就拦」）', async () => {
    hoisted.verno = SCHEMA_VERSION;
    mount();
    await flush();
    expect(text()).not.toContain('本地数据比当前应用更新');
    expect(container.querySelector('[data-child-ok]')).not.toBeNull();
    expect(hoisted.createRepositories).toHaveBeenCalledTimes(1);
  });
});

describe('F1-② 未受影响的既有分支（防回归）', () => {
  it('旧库（< 当前版本）仍走迁移前备份闸门 L1', async () => {
    hoisted.verno = SCHEMA_VERSION - 1;
    mount();
    await flush();

    expect(text()).toContain('需要先导出升级前备份');
    expect(text(), '闸门文案要显示实际探测到的版本，不是硬编码').toContain(`v${SCHEMA_VERSION - 1}`);
    expect(hoisted.createRepositories, '导出成功前绝不 open 库').toHaveBeenCalledTimes(0);
  });

  it('全新环境（探测不到库）不拦，直接建库进应用', async () => {
    hoisted.verno = null;
    mount();
    await flush();

    expect(container.querySelector('[data-child-ok]')).not.toBeNull();
    expect(hoisted.createRepositories).toHaveBeenCalledTimes(1);
  });

  it('真正的初始化失败：隐私模式指引**仍在**（这一支没被降级安装分支顶掉）', async () => {
    hoisted.verno = null;
    hoisted.createRepositories.mockRejectedValue(new Error('storage disabled'));
    mount();
    await flush();

    expect(text()).toContain('无法访问本地数据');
    expect(text(), '非 ChangxiaError 才归因隐私模式').toContain('隐私模式');
    expect(text(), '这条分支不得出现降级安装的话术').not.toContain('本地数据比当前应用更新');
  });
});
