/**
 * T10–T13 阶段 D 单元验收（v0.6）。
 *
 * 覆盖：
 * 1. agentTerms 术语映射——Stage→「批次（Batch）」等 PRD §2A.3 统一口径；
 *    状态标签英文原样（不翻译）；
 * 2. storage-estimate——formatBytes 边界 + estimateLocalDbUsage 两条路径
 *    （storage.estimate 有值 / 无值回落序列化 / 内部异常返回 null）；
 * 3. HF-05 验收：Agent 工作区源码 grep 无行业黑话（甲方 / 工地 / 设计阶段）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  AGENT_SEAT_LIMIT,
  AGENT_TERMS,
  AGENT_KIND_SUGGESTIONS,
  termFor,
} from '../src/constants/agentTerms';
import { TaskStatus } from '../src/core/types/enums';
import {
  estimateLocalDbUsage,
  formatBytes,
} from '../src/lib/storage-estimate';

describe('agentTerms · PRD §2A.3 术语映射', () => {
  it('Stage 展示为「批次（Batch）」；导入叫 Apply payload；甘特叫 Timeline', () => {
    expect(termFor('stage')).toBe('批次（Batch）');
    expect(termFor('applyPayload')).toBe('Apply payload');
    expect(termFor('timeline')).toBe('Timeline');
    expect(termFor('ready')).toBe('Ready');
    expect(termFor('artifacts')).toBe('artifacts（产出物）');
  });

  it('状态值英文原样（TaskStatus 枚举值即展示值，UI 不翻译）', () => {
    expect(TaskStatus.Draft).toBe('draft');
    expect(TaskStatus.Ready).toBe('ready');
    expect(TaskStatus.Claimed).toBe('claimed');
    expect(TaskStatus.InProgress).toBe('in_progress');
    expect(TaskStatus.Blocked).toBe('blocked');
    expect(TaskStatus.Review).toBe('review');
    expect(TaskStatus.Done).toBe('done');
  });

  it('agentKind 建议值非空数组（datalist 仅供选择，不封闭输入）', () => {
    expect(AGENT_KIND_SUGGESTIONS.length).toBeGreaterThan(0);
  });

  it('未知 key 回落 key 本身（新术语未登记时不至于白屏）', () => {
    expect(termFor('someFutureTerm' as never)).toBe('someFutureTerm');
  });

  it('免费 Agent 席位 = 3（B5 拍板值）', () => {
    expect(AGENT_SEAT_LIMIT).toBe(3);
  });

  it('AGENT_TERMS 两种 mode 的值都不允许出现行业黑话（§0.5 常驻约束）', () => {
    for (const modes of Object.values(AGENT_TERMS)) {
      for (const v of Object.values(modes)) {
        expect(v).not.toMatch(/甲方|工地|设计阶段/);
      }
    }
  });
});

describe('storage-estimate · 本地库占用', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formatBytes 边界：B / KB / MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('navigator.storage.estimate 有 usage → 走实测路径', async () => {
    vi.stubGlobal(
      'navigator',
      { storage: { estimate: async () => ({ usage: 42 * 1024 * 1024 }) } },
    );
    const usage = await estimateLocalDbUsage(async () => {
      throw new Error('不应走到序列化 fallback');
    });
    expect(usage).toEqual({ bytes: 42 * 1024 * 1024, source: 'storage-estimate' });
  });

  it('estimate 不可用 → 回落全表序列化估算', async () => {
    vi.stubGlobal('navigator', { storage: undefined });
    const usage = await estimateLocalDbUsage(async () => ({
      tasks: [{ id: 'tsk_1', title: '标题tasks' }],
      members: [],
    }));
    expect(usage?.source).toBe('serialization-fallback');
    // 序列化 JSON 至少包含键名与值的字节
    expect((usage?.bytes ?? 0)).toBeGreaterThan(10);
  });

  it('内部异常 → 返回 null（UI 隐藏该行，不显示假数字）', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => {
          throw new Error('quota error');
        },
      },
    });
    const usage = await estimateLocalDbUsage(async () => {
      throw new Error('dump failed');
    });
    expect(usage).toBeNull();
  });
});

describe('HF-05 · Agent 工作区源码 grep 无行业黑话', () => {
  const agentDir = join(__dirname, '..', 'src', 'components', 'agent');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.tsx') || p.endsWith('.ts')) files.push(p);
    }
  };
  walk(agentDir);
  // Agent Board 页面与术语表也属于 Agent 工作区
  files.push(
    join(__dirname, '..', 'src', 'pages', 'AgentBoardPage.tsx'),
    join(__dirname, '..', 'src', 'constants', 'agentTerms.ts'),
  );

  it('全部 Agent 工作区文件不含「甲方 / 工地 / 设计阶段」（注释也算）', () => {
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(f, 'utf-8');
      expect(text, `${f} 出现行业黑话`).not.toMatch(/甲方|工地|设计阶段/);
    }
  });
});
