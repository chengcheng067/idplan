/**
 * H 版「页顶出血巨字」的载荷：用户自定义品牌词（规格 §1.4 增补拍板，2026-10-11）。
 *
 * ── 为什么不再取状态词 ──
 * 原实现纸面巨字取 `statusToGiantWord(focus.status)`。拍板后巨字**与状态解绑**：
 * 参考稿那颗 `AGENT` 是「主题词位」而不是状态位，人类化后由品牌词填充；状态
 * 表达归双栏栏头（规格 §1.4 表格末行）。`statusToGiantWord` 保留在 core 供他
 * 用，不删业务常量。
 *
 * ── 存储口径（照同区的打印 logo 抄，不另发明）──
 * settings KV 表 `key='print.brandWord'`，valueJson = 字符串。KV 表整体进备份
 * （backup.service 的 settings 表导出）⇒ 换设备能恢复。
 *
 * ── 权限口径与 logo 完全一致 ──
 * 入口住在设置的「排程」区，该区本身 adminOnly（`SettingsDialog.tsx` 的
 * 分区角色可见性）⇒ 「管理员可改、成员只读」由分区可见性直接兑现，不另造门控。
 * 与 `PrintLogoSection` 文件头同一条论证，见该文件 :4-8。
 *
 * ── 长度与回落 ──
 * ≤12 字符（规格 §1.4 规则 3）：巨字是出血装置，超长会把词义裁掉（规则的 6），
 * 故在**保存侧**截断、并在 UI 明示「已截断」。空值 / 缺键 / 坏 JSON / 非字符串
 * ⇒ 回落 `PLAN`（规则 1、2）。
 *
 * ── 大小写 ──
 * 存储保留用户原输入；纸面恒大写由 CSS `text-transform: uppercase` 处理
 * （规则 4），不在这里改写用户数据。
 *
 * ── 页底巨字不在此管辖 ──
 * 页底 `IDPLAN` 是品牌装置，**不随自定义变**（规则 5），故本文件只服务页顶。
 */

import { useCallback, useEffect, useState } from 'react';

import { useRepos } from '../../hooks/useRepos';
import type { IRepositoryBundle } from '../../core/repositories/interfaces';

/** settings KV 键（单处定义；设置入口、纸面读取、单测共用） */
export const PRINT_BRAND_WORD_SETTING_KEY = 'print.brandWord';

/** 缺省品牌词（规格 §1.4 规则 1） */
export const DEFAULT_PRINT_BRAND_WORD = 'PLAN';

/** 长度上限（字符数，规格 §1.4 规则 3）；超出在保存侧截断 */
export const PRINT_BRAND_WORD_MAX_CHARS = 12;

/** 尽力取仓储 bundle；无 Provider（孤立渲染 / 单测）时回落 null，不抛 */
function useReposOrNull(): IRepositoryBundle | null {
  try {
    return useRepos();
  } catch {
    return null;
  }
}

/**
 * 归一化用户输入：去首尾空白 → 按**码点**截断到上限（`[...s]` 而非 `slice`，
 * emoji / 代理对不会被劈成半个字符）。空串返回空串（= 回落缺省，不是错误）。
 *
 * 导出供设置入口与单测共用：入口用它做「已截断」提示与落库值，两边同一真值源。
 */
export function normalizeBrandWord(raw: string): string {
  return [...raw.trim()].slice(0, PRINT_BRAND_WORD_MAX_CHARS).join('');
}

/** 是否会被截断（入口据此给「已截断」提示，不在渲染期猜） */
export function isBrandWordOverlong(raw: string): boolean {
  return [...raw.trim()].length > PRINT_BRAND_WORD_MAX_CHARS;
}

/**
 * 从 settings 行解析品牌词。坏数据一律回落缺省（纸面永远有词兜底，
 * 不留空巨字）：坏 JSON / 非字符串 / 空串 / 全空白 ⇒ `PLAN`。
 * 导出供单测（KV 脏数据口径）。
 */
export function parseBrandWordRow(
  rows: ReadonlyArray<{ key: string; valueJson: string }>,
): string {
  for (const row of rows) {
    if (row.key !== PRINT_BRAND_WORD_SETTING_KEY) continue;
    try {
      const v: unknown = JSON.parse(row.valueJson);
      if (typeof v !== 'string') return DEFAULT_PRINT_BRAND_WORD;
      const normalized = normalizeBrandWord(v);
      return normalized.length > 0 ? normalized : DEFAULT_PRINT_BRAND_WORD;
    } catch {
      return DEFAULT_PRINT_BRAND_WORD;
    }
  }
  return DEFAULT_PRINT_BRAND_WORD;
}

export interface PrintBrandWordData {
  /** 纸面页顶巨字载荷（永不为空；未设置 = PLAN） */
  brandWord: string;
  /** 重新读取（保存后调用） */
  reload: () => void;
}

/** 读全局品牌词（settings KV；无 Provider 环境回落缺省） */
export function usePrintBrandWord(): PrintBrandWordData {
  const repos = useReposOrNull();
  const [brandWord, setBrandWord] = useState<string>(DEFAULT_PRINT_BRAND_WORD);

  const reload = useCallback(() => {
    if (!repos) {
      setBrandWord(DEFAULT_PRINT_BRAND_WORD);
      return;
    }
    void repos.settings
      .all()
      .then((rows) => setBrandWord(parseBrandWordRow(rows)))
      .catch(() => setBrandWord(DEFAULT_PRINT_BRAND_WORD));
  }, [repos]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { brandWord, reload };
}

/**
 * 保存品牌词（≤12 字符在**此处**强制，与 logo 的 ≤200KB 同理）。
 * 空串 = 清空（KV 无 delete 出口；空值解析为缺省，与未设置同效）。
 * 返回实际落库的值，供入口做 toast / 提示对齐（避免两处各算一次截断）。
 */
export async function savePrintBrandWord(
  repos: IRepositoryBundle,
  raw: string,
): Promise<string> {
  const value = normalizeBrandWord(raw);
  await repos.settings.set(PRINT_BRAND_WORD_SETTING_KEY, value);
  return value;
}
