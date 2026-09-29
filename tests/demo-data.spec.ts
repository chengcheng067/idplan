// @vitest-environment node
/**
 * 0.8.3 条目1「载入示例项目」的守门 spec。
 *
 * 三件事各钉一层：
 *   ① public/demo-backup.json **过当前 zod backup schema**——示例数据的导入
 *      路径与真实备份完全相同（useBackupIo.loadDemo → validateBackupJson →
 *      importAndReplace），schema 腐化 = 陌生人点「载入示例项目」直接报错，
 *      比没有这个功能更糟；
 *   ② **脱敏**：包内 demo 不得含真实姓名/邮箱（开源产物红线，她数据敏感度高）；
 *   ③ **入口在位**：Sidebar / MobileMoreMenu / useBackupIo 的 loadDemo 链路
 *      不能悄悄消失（源码级断言——「有 json 没入口」等于功能不存在）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { validateBackupJson } from '../src/core/services/backup.service';

describe('示例项目数据（public/demo-backup.json）', () => {
  const raw = JSON.parse(readFileSync('public/demo-backup.json', 'utf-8'));

  it('① 过当前 backup zod schema（导入链路与真实备份同一条）', () => {
    const parsed = validateBackupJson(raw);
    expect(parsed.data.projects).toHaveLength(5);
    expect(parsed.data.stages.length).toBeGreaterThanOrEqual(40);
    expect(parsed.data.tasks.length).toBeGreaterThanOrEqual(100);
    expect(parsed.data.members.length).toBeGreaterThanOrEqual(5);
  });

  it('② 脱敏：不含真实姓名/邮箱', () => {
    const text = JSON.stringify(raw);
    expect(text).not.toContain('杨雯丞');
    expect(text).not.toContain('yangwencheng');
  });
});

describe('载入示例项目入口在位（源码级守门）', () => {
  const read = (p: string): string => readFileSync(p, 'utf-8');

  it('③ useBackupIo 含 loadDemo → demo-backup.json → validateBackupJson 链路', () => {
    const src = read('src/components/layout/useBackupIo.tsx');
    expect(src).toContain('loadDemo');
    expect(src).toContain('demo-backup.json');
    expect(src).toContain('validateBackupJson');
  });

  it('④ Sidebar 与 MobileMoreMenu 都挂了入口（桌面+移动两端都不能少）', () => {
    expect(read('src/components/layout/Sidebar.tsx')).toContain('void loadDemo()');
    expect(read('src/components/layout/MobileMoreMenu.tsx')).toContain('void loadDemo()');
  });
});
