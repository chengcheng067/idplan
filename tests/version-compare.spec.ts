import { describe, it, expect } from 'vitest';

import {
  parseVersion,
  isValidDesktopTag,
  compareVersions,
  isNewer,
} from '../src/lib/version-compare';

describe('version-compare', () => {
  it('parseVersion 拒绝非四段', () => {
    expect(parseVersion('0.3.0')).toBeNull();
    expect(parseVersion('v0.3.0')).toBeNull();
    expect(parseVersion('v0.3.0.0.0')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('parseVersion 接受四段（v 前缀可选）', () => {
    expect(parseVersion('v0.3.0.0018')).toEqual([0, 3, 0, 18]);
    expect(parseVersion('0.3.0.10')).toEqual([0, 3, 0, 10]);
  });

  it('逐段数值比较：0.3.0.9 < 0.3.0.10（字符串比较会错）', () => {
    expect(compareVersions('v0.3.0.9', 'v0.3.0.10')!).toBeLessThan(0);
    expect(compareVersions('v0.3.0.10', 'v0.3.0.9')!).toBeGreaterThan(0);
  });

  it('相等返回 0', () => {
    expect(compareVersions('v0.3.0.0018', 'v0.3.0.0018')).toBe(0);
  });

  it('任一无法解析返回 null', () => {
    expect(compareVersions('docker-0.3.0', 'v0.3.0.0018')).toBeNull();
    expect(compareVersions('v0.3.0.0018', 'not-a-version')).toBeNull();
  });

  it('isNewer 判定', () => {
    expect(isNewer('v0.3.0.0019', 'v0.3.0.0018')).toBe(true);
    expect(isNewer('v0.3.0.0018', 'v0.3.0.0018')).toBe(false);
    expect(isNewer('docker-0.3.0', 'v0.3.0.0018')).toBe(false);
  });

  it('isValidDesktopTag 只认 v 开头四段', () => {
    expect(isValidDesktopTag('v0.3.0.0018')).toBe(true);
    expect(isValidDesktopTag('0.3.0.0018')).toBe(false); // 缺 v 前缀
    expect(isValidDesktopTag('docker-0.3.0')).toBe(false); // 非桌面发布
    expect(isValidDesktopTag('upk-images-0.3.0')).toBe(false); // 非桌面发布
    expect(isValidDesktopTag('v0.3.0')).toBe(false); // 段数不足
  });
});
