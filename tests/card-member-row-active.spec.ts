// @vitest-environment node
/**
 * 卡片成员行口径：停用成员不上卡（她 2026-10-08 点名的第 4 条）。
 *
 * 规则：ProjectCard 的「当前有哪些人在此项目中」行（cardMembers）必须过滤
 * `m.active`——与同文件上一行 `stageMembers` 的口径对齐。修复前两条过滤规则
 * 不一致（stageMembers 滤 active、cardMembers 漏了），停用成员只要还有未完成
 * 任务，头像就继续挂在项目卡上。
 *
 * 为什么不是「停用时清任务指派」：产品没有成员删除（唯一出口是停用），
 * assigneeIds 是历史事实；卡片这行回答「现在有谁在这项目里」，停用者不属于现在。
 *
 * 形态：源码锁（与 responsive-card-track 同范式——渲染 ProjectCard 要 Router +
 * 全部 store，为一条过滤规则搭harness 不划算）。**剥注释后再扫**：本文件自己的
 * 注释里就写着 `m.active`，不剥就是恒绿的假断言。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('卡片成员行 · 停用成员不上卡', () => {
  it('cardMembers 过滤含 m.active（与 stageMembers 同口径）', () => {
    const raw = readFileSync(
      resolve(__dirname, '..', 'src/components/project/ProjectCard.tsx'),
      'utf8',
    );
    // 剥注释（×3 教训：不剥 = 抓注释里的字样假红）
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // 取 cardMembers 声明那一句（到分号止），断言其中含 m.active
    const m = src.match(/const cardMembers = members\.filter\(([\s\S]*?)\);/);
    expect(m, 'cardMembers 声明应存在').not.toBeNull();
    expect(m![1]).toContain('m.active');
  });

  it('stageMembers 也仍滤 active（两条口径不许再分叉）', () => {
    const raw = readFileSync(
      resolve(__dirname, '..', 'src/components/project/ProjectCard.tsx'),
      'utf8',
    );
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toMatch(/const stageMembers = members\.filter\(\(m\) => m\.active/);
  });
});
