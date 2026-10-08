/**
 * 全局打印 logo 的读取 hook（产品决策文档 §3.3）。
 *
 * ── 存储口径 ──
 * settings KV 表 `key='printLogo'`，valueJson = base64 dataURL 字符串。
 * KV 表整体进备份（backup.service 的 settings 表导出）⇒ 换设备能恢复
 * （公司资产的定位）；≤200KB 上限在**保存侧**强制（设置上传入口），
 * 备份 JSON 不被一张图撑爆。
 *
 * ── 为什么是 hook 而不是 store ──
 * logo 是**公司级静态资产**，不是个人偏好（不进 usePrintPrefsStore），
 * 也没有首屏闪烁面（纸面未渲染时读不到无所谓）⇒ 不需要 zustand 持久层。
 * 预览面板每次打开读一次（与设置弹窗「打开时实时读」同范式），
 * 上传/删除后由调用方重读。
 *
 * ── 失败口径 ──
 * 读不到（无行 / JSON 坏 / 非字符串 / 仓储缺失）一律 **null** ⇒ 四版
 * 统一回落「ID Plan」文字标（PrintLogoMark 空态），不留空、不占位灰块。
 */

import { useCallback, useEffect, useState } from 'react';

import { useRepos } from '../../hooks/useRepos';
import type { IRepositoryBundle } from '../../core/repositories/interfaces';

/** settings KV 键（单处定义；备份 roundtrip spec 与上传入口共用） */
export const PRINT_LOGO_SETTING_KEY = 'printLogo';

/** 尽力取仓储 bundle；无 Provider（孤立渲染 / 单测）时回落 null，不抛 */
function useReposOrNull(): IRepositoryBundle | null {
  try {
    return useRepos();
  } catch {
    return null;
  }
}

/** 从 settings 行解析 logo（坏数据静默 null——纸面永远有文字标兜底）。
 *  导出供单测（KV 脏数据口径：坏 JSON / 非字符串 / 空串一律 null）。 */
export function parseLogoRow(rows: ReadonlyArray<{ key: string; valueJson: string }>): string | null {
  for (const row of rows) {
    if (row.key !== PRINT_LOGO_SETTING_KEY) continue;
    try {
      const v: unknown = JSON.parse(row.valueJson);
      return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

export interface PrintLogoData {
  /** 当前 logo（null = 未上传 ⇒ 文字标） */
  logo: string | null;
  /** 重新读取（上传 / 删除后调用） */
  reload: () => void;
}

/** 读全局打印 logo（settings KV；无 Provider 环境回落 null） */
export function usePrintLogo(): PrintLogoData {
  const repos = useReposOrNull();
  const [logo, setLogo] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!repos) {
      setLogo(null);
      return;
    }
    void repos.settings
      .all()
      .then((rows) => setLogo(parseLogoRow(rows)))
      .catch(() => setLogo(null));
  }, [repos]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { logo, reload };
}

/** 保存 logo（≤200KB 在调用方强制；此处只落库）。空串 = 删除（回落文字标） */
export async function savePrintLogo(repos: IRepositoryBundle, dataUrl: string): Promise<void> {
  if (dataUrl.length === 0) {
    // 删除 = 写空值（KV 无 delete 出口；空值解析为 null，与未上传同效）
    await repos.settings.set(PRINT_LOGO_SETTING_KEY, '');
    return;
  }
  await repos.settings.set(PRINT_LOGO_SETTING_KEY, dataUrl);
}
