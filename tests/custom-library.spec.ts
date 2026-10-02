// @vitest-environment node
/**
 * 自定义行业库（v0.8.6 · 她反馈 #9）· schema 校验 + 读侧归 spec。
 *
 * 安全官 C.4 十条逐条钉 + 归一不抛错哲学 + 引用完整性硬校验。
 */
import { describe, it, expect } from 'vitest';

import {
  validateCustomLibrary,
  CUSTOM_LIBRARY_SCHEMA,
  CUSTOM_LIBRARY_MAX_BYTES,
} from '../src/core/template/custom-library.schema';
import {
  normalizeCustomLibraries,
  buildCustomPresetItems,
  isCustomLibraryKey,
  type StoredCustomLibrary,
} from '../src/core/template/custom-library.service';

const goodLib = {
  schema: CUSTOM_LIBRARY_SCHEMA,
  name: '我的茶空间流程',
  domain: 'indoor',
  items: [
    { key: 'usr.site', name: '选址', ratioPercent: 10, colorIndex: 1, kanbanColumn: 'design', defaultTasks: ['看场'] },
    { key: 'usr.tea', name: '茶单研发', ratioPercent: 15, colorIndex: 2, kanbanColumn: 'creative' },
    { key: 'usr.build', name: '施工', ratioPercent: 60, colorIndex: 3, kanbanColumn: 'build', customColor: '#aabbcc' },
  ],
  presets: [
    { key: 'usr.tea-full', name: '茶空间全流程', description: '', itemKeys: ['usr.site', 'usr.tea', 'usr.build'] },
  ],
};

describe('自定义行业库 schema（导入侧严格校验）', () => {
  it('① 合法包过校验', () => {
    const r = validateCustomLibrary(goodLib);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.library.name).toBe('我的茶空间流程');
      expect(r.library.items).toHaveLength(3);
    }
  });

  it('② version 字面量：不认识的 schema 明确拒绝', () => {
    const r = validateCustomLibrary({ ...goodLib, schema: 'idplan-custom-library/v2' });
    expect(r.ok).toBe(false);
  });

  it('②b key 前缀强制 usr./拒绝内置同名', () => {
    const bad = {
      ...goodLib,
      items: [{ key: 'indoor_full.proposal', name: '提案', ratioPercent: 5, colorIndex: 1, kanbanColumn: 'design' }],
      presets: [{ key: 'usr.x', name: 'x', itemKeys: ['indoor_full.proposal'] }],
    };
    const r = validateCustomLibrary(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.message).toContain('usr.');
  });

  it('③ ratioPercent：0/负数/超 100 拒绝', () => {
    for (const bad of [0, -1, 101]) {
      const r = validateCustomLibrary({
        ...goodLib,
        items: goodLib.items.map((it, i) => (i === 0 ? { ...it, ratioPercent: bad } : it)),
      });
      expect(r.ok, `ratio=${bad}`).toBe(false);
    }
  });

  it('④ colorIndex 1..9 + customColor 必须 #RRGGBB', () => {
    const r1 = validateCustomLibrary({
      ...goodLib,
      items: goodLib.items.map((it, i) => (i === 0 ? { ...it, colorIndex: 12 } : it)),
    });
    expect(r1.ok).toBe(false);
    const r2 = validateCustomLibrary({
      ...goodLib,
      items: goodLib.items.map((it, i) => (i === 0 ? { ...it, customColor: 'red; background:url(x)' } : it)),
    });
    expect(r2.ok).toBe(false);
  });

  it('⑤ kanbanColumn 白名单：任意字符串拒绝', () => {
    const r = validateCustomLibrary({
      ...goodLib,
      items: goodLib.items.map((it, i) => (i === 0 ? { ...it, kanbanColumn: 'whatever' } : it)),
    });
    expect(r.ok).toBe(false);
  });

  it('⑥ defaultTasks 条数/长度上限', () => {
    const r = validateCustomLibrary({
      ...goodLib,
      items: goodLib.items.map((it, i) => (i === 0 ? { ...it, defaultTasks: Array.from({ length: 21 }, (_, n) => `t${n}`) } : it)),
    });
    expect(r.ok).toBe(false);
  });

  it('⑦ 引用完整性：preset 引用悬空 key → 整包拒绝并指明 preset/key', () => {
    const r = validateCustomLibrary({
      ...goodLib,
      presets: [{ key: 'usr.x', name: 'x', itemKeys: ['usr.site', 'usr.ghost'] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.path).toContain('usr.x');
      expect(r.issues[0]!.message).toContain('usr.ghost');
    }
  });

  it('⑧ 整包 256KB 上限', () => {
    const big = JSON.stringify({ ...goodLib, name: 'x'.repeat(CUSTOM_LIBRARY_MAX_BYTES) });
    const r = validateCustomLibrary(JSON.parse(big), Buffer.byteLength(big));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.message).toContain('KB');
  });

  it('⑨ 包内 key 重复拒绝', () => {
    const r = validateCustomLibrary({
      ...goodLib,
      items: [...goodLib.items, goodLib.items[0]!],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.message).toContain('重复');
  });
});

describe('读侧归一（绝不抛错）', () => {
  it('⑩ 坏数据安静跳过：非数组→空、坏条跳过', () => {
    expect(normalizeCustomLibraries(null)).toEqual([]);
    expect(normalizeCustomLibraries('nope')).toEqual([]);
    const mixed = [
      { schema: 'idplan-custom-library/v1', name: '好', domain: 'indoor', items: [{ key: 'usr.a' }], presets: [{ key: 'usr.p' }], importedAt: 'x' },
      { schema: 'bogus', name: '坏 schema' },
      null,
      'junk',
    ];
    const out = normalizeCustomLibraries(mixed);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('好');
  });

  it('⑪ 展开 preset 阶段项：顺序=itemKeys、domain 覆写、customColor 过 normalizeHex', () => {
    const lib = normalizeCustomLibraries([{ ...goodLib, importedAt: '2026-10-02T00:00:00Z' }])[0]!;
    const items = buildCustomPresetItems(lib, 'usr.tea-full');
    expect(items.map((i) => i.key)).toEqual(['usr.site', 'usr.tea', 'usr.build']);
    expect(items.every((i) => i.domain === 'indoor')).toBe(true);
    const build = items.find((i) => i.key === 'usr.build')!;
    expect(build.customColor).toBe('#AABBCC'); // normalizeHex 大写归一
    expect(build.defaultTasks).toEqual([]);
  });

  it('⑫ isCustomLibraryKey 前缀判定', () => {
    expect(isCustomLibraryKey('usr.x')).toBe(true);
    expect(isCustomLibraryKey('indoor_full.proposal')).toBe(false);
    expect(isCustomLibraryKey('cst.x')).toBe(false);
  });

  it('⑭ settings KV 往返（StoredCustomLibrary 序列化稳定）', () => {
    const stored: StoredCustomLibrary[] = normalizeCustomLibraries([
      { ...goodLib, importedAt: '2026-10-02T12:00:00Z' },
    ]);
    const round = normalizeCustomLibraries(JSON.parse(JSON.stringify(stored)));
    expect(round).toEqual(stored);
  });
});
