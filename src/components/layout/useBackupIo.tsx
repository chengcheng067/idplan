import { useRef, useState } from 'react';

import { useRepos } from '../../hooks/useRepos';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useLang } from '../../i18n';
import {
  BackupService,
  downloadBackup,
  validateBackupJson,
} from '../../core/services/backup.service';
import { logError, logUser } from '../../core/services/log.service';
import { ChangxiaError } from '../../core/types/enums';
import type { BackupPackage } from '../../core/types/dto';
import type { IRepositoryBundle } from '../../core/repositories/interfaces';
import { buildDemoBackup, withHostPolicySettings } from '../../core/demo/demoDataFactory';
import { DB_NAME } from '../../core/schema/current';
import { dumpLegacyTables } from '../../core/repositories/local/dexie.database';
import { ConfirmDialog } from '../common/ConfirmDialog';

/**
 * 备份导入 / 导出逻辑（v0.4 抽取）。
 *
 * 抽出的原因：桌面顶栏的「保存备份 / 加载备份」按钮与移动端「更多」菜单里的同名菜单项
 * 需要完全相同的行为（导出下载 / 选文件 → 预检 → 二次确认 → 整体替换）。
 * 若各写一份，日后改校验规则或文案时必然出现两边不一致，故收敛为单一实现。
 *
 * 调用方必须把返回的 `fileInput` 与 `confirmDialog` 渲染进 DOM——
 * 不渲染会导致 `pick()` 点了没反应（隐藏 file input 不在 DOM 里）。
 */
export interface BackupIo {
  /** 导出全量数据并触发浏览器下载 */
  save(): Promise<void>;
  /**
   * 载入示例项目（0.8.3）：fetch 随包分发的 public/静态示例包，
   * 过 zod 校验后走与「从备份恢复」完全相同的覆盖式导入链路
   * （含二次确认弹窗）。设计意图：陌生人第一小时不用先造数据就能看懂产品。
   */
  loadDemo(): Promise<void>;
  /** 弹出系统文件选择器（走隐藏 input，非 window API） */
  pick(): void;
  /** 隐藏的 file input，必须渲染 */
  fileInput: JSX.Element;
  /** 覆盖式恢复的二次确认弹窗，必须渲染 */
  confirmDialog: JSX.Element;
}

/**
 * 可独立调用的导出函数（v0.6 抽取）：返回是否成功落盘。
 * 除顶栏/移动菜单按钮外，也供非组件上下文（如迁移前闸门）复用同一套落盘口径。
 * 成功/失败只记日志、不弹 toast——toast 由 UI 调用方按自身语境补。
 */
export async function exportBackupToFile(repos: IRepositoryBundle): Promise<boolean> {
  try {
    const pkg = await new BackupService(repos).exportAll();
    downloadBackup(pkg);
    logUser('备份', '保存备份成功');
    return true;
  } catch (err) {
    logError('备份', '保存备份失败', err);
    return false;
  }
}

/**
 * 迁移前备份闸门专用（v0.6）：把**升级前**的老库（v1）导出为回滚凭据并落盘。
 *
 * 为什么不走 BackupService：闸门必须发生在 `db.open()`（触发 Dexie 升级）之前，
 * 正式仓储此刻尚不存在；`dumpLegacyTables` 用只声明 v1 的临时实例读快照（不会升级）。
 * 导出失败返回 false —— 调用方**必须**中止升级（宁可不升，不可无凭据升）。
 */
export async function exportPreMigrationBackupToFile(dbName: string = DB_NAME): Promise<boolean> {
  try {
    const pkg = await dumpLegacyTables(dbName);
    downloadBackup(pkg);
    logUser('备份', '数据库升级前备份已导出');
    return true;
  } catch (err) {
    logError('备份', '数据库升级前备份导出失败', err);
    return false;
  }
}

export function useBackupIo(): BackupIo {
  const repos = useRepos();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPkg, setPendingPkg] = useState<BackupPackage | null>(null);
  /** 待确认的备份来源（0.8.3）：file=用户选的备份文件；demo=随包示例数据（文案不同） */
  const [pendingSource, setPendingSource] = useState<'file' | 'demo'>('file');
  const fileRef = useRef<HTMLInputElement>(null);

  /** 取词 + 语言变化订阅点（toast 文案在调用期取） */
  const { t } = useLang();
  /*
   * ⚠️ **判断边界（本文件的翻译范围）**：
   *   · **翻**：`toast(...)` 与 ConfirmDialog 的文案 —— 它们出现在**屏幕上**，
   *     而出错时用户唯一看到的就是这几句（备份/恢复是本轮风险最集中处，必须是母语）；
   *   · **不翻**：logUser / logError 的**日志文案**（含那个分类名「备份」）——
   *     它们进的是**前端日志文件**（`导出前端日志` 才看得到），属「屏幕外」，按 team-lead 的口径不翻；
   *     更硬的理由（team-lead 补）：`logUser(source, message)` 的 **`source` 是跨模块共用的自由文本、
   *     不是显示标签**（全仓 20+ 处：规划向导 / 打印标识 / NAS 服务 / 行业库 / 首启引导 / 身份 …），
   *     而**日志查看器按 `source` 分组** ⇒ 它实质上是**分组键**。翻它的后果不是「对不上」，
   *     而是**同一类日志在英文模式下被拆成两组**（历史组中文键 + 新组英文键）。
   *     ⇒ 这类区分（**数据键 vs 显示文本**）是本轮反复训练的东西，遇到新串先问它属于哪一类。
   */
  const toast = (kind: 'success' | 'error' | 'info', message: string): void => {
    useProjectsStore.getState().pushToast(kind, message);
  };

  // 行为与抽取前完全一致（v0.6 仅改为复用 exportBackupToFile，文案口径不变）
  const save = async (): Promise<void> => {
    const ok = await exportBackupToFile(repos);
    if (ok) {
      toast('success', t('backup.toast.saved'));
    } else {
      toast('error', t('backup.toast.exportFailed'));
    }
  };

  const pick = (): void => fileRef.current?.click();

  /**
   * 载入示例项目（0.8.3 条目1 / 0.8.5 路线 A：运行时工厂）。
   *
   * 为什么不单独写导入逻辑：示例数据就是一份标准备份包（5 项目覆盖
   * 五种行业看板列形态），复用 validateBackupJson + importAndReplace
   * 意味着「演示数据的导入路径 == 真实备份的导入路径」——后者被
   * roundtrip spec 钉死，零新增数据面代码。
   *
   * 0.8.5 改造：静态示例包（全室内、日期写死会过期）换成
   * `buildDemoBackup()` 运行时工厂——从阶段库动态生成，行业中立、
   * today 为锚永不过期、与行业库永不脱节。
   */
  const loadDemo = async (): Promise<void> => {
    try {
      // 并进本机现有 plugin.enabled.*：示例数据是「示例内容」，不该动宿主策略。
      // 必须保持 `buildDemoBackup()` 这串字面完整（tests/demo-data.spec.ts 有源码守门）。
      const json: unknown = withHostPolicySettings(buildDemoBackup(), await repos.settings.all());
      validateBackupJson(json);
      setPendingPkg(json as BackupPackage);
      setPendingSource('demo');
      setConfirmOpen(true);
    } catch (err) {
      toast('error', t('backup.toast.demoFailed'));
      logError('备份', '示例数据加载失败', err);
    }
  };

  const onFileSelected = async (f: File): Promise<void> => {
    try {
      const json: unknown = JSON.parse(await f.text());
      // 预检：结构不符 → toast 且零写入，绝不进入确认
      validateBackupJson(json);
      setPendingPkg(json as BackupPackage);
      setPendingSource('file');
      setConfirmOpen(true);
    } catch (err) {
      toast('error', t('backup.toast.verifyFailed'));
      logError('备份', '备份文件校验失败', err);
    }
  };

  const onConfirmRestore = async (): Promise<void> => {
    setConfirmOpen(false);
    if (!pendingPkg) return;
    try {
      await new BackupService(repos, {
        // i18n 笔 2.1：审计原因串在写入点取词（core 不能 import i18n，见 RecoveryReasons）
        execution: t('execution.recovery.reason'),
        attempt: t('execution.recovery.attemptReason'),
      }).importAndReplace(pendingPkg);
      logUser('备份', '从备份恢复成功');
      window.location.reload();
    } catch (err) {
      toast(
        'error',
        err instanceof ChangxiaError ? err.userMessage : t('backup.toast.restoreFailed'),
      );
      logError('备份', '从备份恢复失败', err);
    }
  };

  return {
    save,
    pick,
    loadDemo,
    fileInput: (
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // 清空 value，保证连续选同一个文件也能再次触发 change
          e.currentTarget.value = '';
          if (f) void onFileSelected(f);
        }}
      />
    ),
    confirmDialog: (
      <ConfirmDialog
        open={confirmOpen}
        title={pendingSource === 'demo' ? t('backup.dialog.loadDemoTitle') : t('backup.dialog.restoreTitle')}
        danger
        confirmText={pendingSource === 'demo' ? t('backup.dialog.confirmLoad') : t('backup.dialog.confirmRestore')}
        onConfirm={() => void onConfirmRestore()}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>
          {pendingSource === 'demo' ? (
            <>
              {t('backup.dialog.demo1')}
              <strong>{t('backup.dialog.demoStrong')}</strong>
              {t('backup.dialog.demo2')}
              <strong>{t('backup.dialog.replaceStrong')}</strong>
              {t('backup.dialog.demo3')}
            </>
          ) : (
            <>
              {t('backup.dialog.restore1')}
              <strong>{t('backup.dialog.replaceStrong')}</strong>
              {t('backup.dialog.restore2')}
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-mist">
          {t('backup.dialog.filePrefix')}
          {pendingPkg ? `${(pendingPkg.meta as { exportedAt?: string }).exportedAt ?? ''}` : ''}
        </p>
        {pendingPkg &&
          (() => {
            // T14 要点 10：网络通道下发的备份已脱敏（hasPassword=true 但
            // passwordHash=null）——导入后密码丢失，成员需重设，必须先警示。
            const members =
              (pendingPkg.data as { members?: Array<{ hasPassword?: boolean; passwordHash?: string | null }> })
                .members ?? [];
            const sanitized = members.filter((m) => m.hasPassword === true && !m.passwordHash);
            return sanitized.length > 0 ? (
              <p className="mt-2 rounded-[8px] border border-amber/40 bg-amber-soft px-2.5 py-1.5 text-xs text-amber">
                {t('backup.dialog.noPasswordHash', { count: sanitized.length })}
              </p>
            ) : null;
          })()}
      </ConfirmDialog>
    ),
  };
}
