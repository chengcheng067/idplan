// @vitest-environment jsdom
/**
 * 「授权」区的界面行为（反馈 #11 · 离线许可证的用户可见一半）。
 *
 * 验签逻辑本身在 `tests/license.spec.ts`（真签名 / 真拒绝）。这里只验四件事：
 *   ① 浏览器 / NAS 端（无 `window.idplan`）**整区不渲染**，也不发请求；
 *   ② 未授权时有明确文案 + 机器码可复制（用户要知道该把什么发给作者）；
 *   ③ 导入被拒时**照原样显示主进程给的原因**，不糊成「失败」；
 *   ④ 导入成功即转为已授权并带出到期日。
 * 全部走组件真实的 DOM 契约（`data-license-*`），不 mock 组件内部。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { LicenseSection, type LicenseStatusView } from '../src/components/settings/LicenseSection';

let root: Root;
let container: HTMLDivElement;

/** 主进程桥的替身：只实现本区用到的那两个方法 */
interface BridgeStub {
  isDesktop: true;
  platform: string;
  licenseStatus: ReturnType<typeof vi.fn>;
  importLicense: ReturnType<typeof vi.fn>;
}

let bridge: BridgeStub;

function unlicensed(): LicenseStatusView {
  return {
    machineId: 'win-90c11f20-63c4-43c8-921e-16da1acbd18a',
    licensed: false,
    reason: '尚未导入许可证。',
    expiresAt: null,
  };
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<LicenseSection />);
  });
  // 让 `licenseStatus()` 的 Promise 落地（一次微任务轮转不够，锚点里含 await）
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function text(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.removeChild(container);
  delete (window as { idplan?: unknown }).idplan;
});

describe('授权区 · 只在桌面端出现', () => {
  it('浏览器 / NAS 端（无 window.idplan）→ 不渲染任何授权 UI', async () => {
    await render();
    expect(document.querySelector('[data-license-section]')).toBeNull();
    expect(text()).not.toContain('机器码');
  });

  it('桌面端 → 渲染状态、机器码与导入区', async () => {
    bridge = {
      isDesktop: true,
      platform: 'win32',
      licenseStatus: vi.fn().mockResolvedValue(unlicensed()),
      importLicense: vi.fn(),
    };
    (window as { idplan?: unknown }).idplan = bridge;

    await render();
    expect(document.querySelector('[data-license-section]')).not.toBeNull();
    expect(text()).toContain('未授权');
    expect(document.querySelector('[data-license-machine-id]')?.textContent).toContain(
      'win-90c11f20',
    );
    // 主进程给的拒绝原因照原样显示（不是含糊的「校验失败」）
    expect(document.querySelector('[data-license-reason]')?.textContent).toBe('尚未导入许可证。');
    // 导入闸门在一个位置：粘贴区 + 导入按钮
    expect(document.querySelector('[data-license-input]')).not.toBeNull();
  });

  it('机器码可复制（复制成功给「发给作者」的下一步提示）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    bridge = {
      isDesktop: true,
      platform: 'win32',
      licenseStatus: vi.fn().mockResolvedValue(unlicensed()),
      importLicense: vi.fn(),
    };
    (window as { idplan?: unknown }).idplan = bridge;

    await render();
    const copyBtn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('复制'),
    );
    expect(copyBtn).toBeTruthy();
    await act(async () => {
      copyBtn!.click();
    });
    expect(writeText).toHaveBeenCalledWith('win-90c11f20-63c4-43c8-921e-16da1acbd18a');
    expect(document.querySelector('[data-license-hint]')?.textContent).toContain('复制');
  });
});

describe('授权区 · 导入许可证', () => {
  beforeEach(() => {
    bridge = {
      isDesktop: true,
      platform: 'win32',
      licenseStatus: vi.fn().mockResolvedValue(unlicensed()),
      importLicense: vi.fn(),
    };
    (window as { idplan?: unknown }).idplan = bridge;
  });

  async function fillAndImport(raw: string): Promise<void> {
    await render();
    const area = document.querySelector('[data-license-input]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(area, raw);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const importBtn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('导入许可证'),
    );
    await act(async () => {
      importBtn!.click();
    });
  }

  it('内容为空 → 直接提示，不调用主进程（不做无意义的一次 IPC）', async () => {
    await render();
    const importBtn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('导入许可证'),
    );
    await act(async () => {
      importBtn!.click();
    });
    expect(bridge.importLicense).not.toHaveBeenCalled();
    expect(document.querySelector('[data-license-error]')?.textContent).toContain('请先粘贴');
  });

  it('主进程拒绝（机器码不匹配）→ 原样显示原因，状态仍为未授权', async () => {
    bridge.importLicense.mockResolvedValue({
      machineId: 'win-90c11f20-63c4-43c8-921e-16da1acbd18a',
      licensed: false,
      reason: '许可证不属于当前设备。',
      expiresAt: null,
    });

    await fillAndImport('{"payload":{"a":1},"signature":"x"}');
    expect(bridge.importLicense).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-license-error]')?.textContent).toBe('许可证不属于当前设备。');
    expect(text()).toContain('未授权');
  });

  it('主进程接受 → 转为已授权、显示到期日，并清空粘贴区（不留许可证副本）', async () => {
    bridge.importLicense.mockResolvedValue({
      machineId: 'win-90c11f20-63c4-43c8-921e-16da1acbd18a',
      licensed: true,
      reason: null,
      expiresAt: '2027-09-17T00:00:00.000Z',
    });

    await fillAndImport('{"payload":{"expiresAt":"2027-09-17T00:00:00.000Z"},"signature":"s"}');
    expect(text()).toContain('已授权');
    expect(document.querySelector('[data-license-hint]')?.textContent).toContain('2027-09-17');
    expect((document.querySelector('[data-license-input]') as HTMLTextAreaElement).value).toBe('');
  });

  it('主进程抛错（内容不是 JSON）→ 给出可操作文案，不白屏', async () => {
    bridge.importLicense.mockRejectedValue(new Error('bad json'));
    await fillAndImport('这不是 JSON');
    expect(document.querySelector('[data-license-error]')?.textContent).toContain('不是有效的 JSON');
  });
});
