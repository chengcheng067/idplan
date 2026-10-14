// @vitest-environment jsdom
/**
 * core 片 · 用户面错误文案的**语言契约**（英文补齐批）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这条链长什么样（三段，缺一段就是假绿）
 * ══════════════════════════════════════════════════════════════════════
 *   ① core 抛错：`coreError(code, 'coreErr.x.y', params, cause)`
 *      ⇒ `userMessage` 由 `CORE_ERROR_TEXT` 渲染（**载荷口径**，逐字不变）
 *      ⇒ 同时在错误上挂 `messageKey` / `params`（机器可读）
 *   ② core 解析：`resolveErrorText(err, t, fallback)` —— **core 不 import i18n**，
 *      `t` 由渲染层注入（core 引 i18n 会把 `document` 拖进服务端 program）
 *   ③ 渲染层：把 30 处 `err.userMessage` 换成 `resolveErrorText(err, t, t('…'))`
 *      ⚠️ **③ 不在本批 core 片的改动面内**（落在 components/store/hooks/pages/di）——
 *      本条链的界面效果由它决定；本 spec 只能证明 ①② 真的把英文取到手。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 本文件守的四条（每条都对应一个会真实发生的坏结果）
 * ══════════════════════════════════════════════════════════════════════
 *   ① **三表不漂**：`CORE_ERROR_TEXT`（载荷）/ 分片 zh（界面）/ 分片 en 的键集
 *      **两两相等**，且两侧 zh **取值逐字相等**。
 *      坏结果：改了一处忘了另一处 ⇒ 同一句话两个口径（本仓称「同套名字两份真相」）。
 *   ② **载荷逐字节不变**：每个键的 `userMessage` / `message` 等于**改动前源码里
 *      那句字面量**（基准值**抄在下面的表里**，不是运行时重算 —— 重算只能证明
 *      "自己等于自己"）。坏结果：`userMessage` 是回给**外部 Agent** 的协议字段，
 *      动一个字节就是契约变更。
 *   ③ **英文真能取到**：`resolveErrorText(err, t)` 在 en 下给出英文、在 zh 下给出
 *      与 `userMessage` 逐字相同的中文。坏结果：机制对但没人能取到 ⇒ 假绿。
 *   ④ **三支口径与团队判据一字不差**：有码→本地化；无码有真因→**原样透传**；
 *      都没有→`fallback`。
 *      坏结果：拿兜底句盖掉数据层真因（「用通用文案把事实盖住」）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { setLang, t } from '../src/i18n';
import {
  CORE_ERROR_TEXT,
  coreErrorText,
  type CoreErrorKey,
} from '../src/core/types/core-error-text';
import { en as coreEn, zh as coreZh } from '../src/i18n/messages/parts/core';
import {
  ChangxiaError,
  ChangxiaErrorCode,
  coreError,
  resolveErrorText,
} from '../src/core/types/enums';
import { LocalStagesRepository } from '../src/core/repositories/local/local.stages.repo';
import { LocalMembersRepository } from '../src/core/repositories/local/local.members.repo';
import { StageService } from '../src/core/services/stage.service';

/**
 * 本片**已交付**的键全集。
 *
 * 刻意**不手抄一份名单**：手抄名单只会变成「加了键忘了加名单」的第二个真相源，
 * 而 `CORE_ERROR_TEXT` 与分片 zh 的键集相等已由 ① 断言钉住。
 * 真正必须手写的是下面的 `BASELINE`（载荷基准值），那才是本文件的判别力所在。
 */
const KEYS: readonly CoreErrorKey[] = Object.keys(CORE_ERROR_TEXT) as CoreErrorKey[];

/**
 * ★ 载荷基准表 —— **手抄自 `9ca1395`（改动前）的源码字面量**，不是运行时重算。
 * 键 → [错误码, 改动前那句原文]。渲染结果必须与它逐字节相等。
 */
const BASELINE: ReadonlyArray<readonly [CoreErrorKey, ChangxiaErrorCode, string]> = [
  ['coreErr.stage.listReadFailed', ChangxiaErrorCode.Storage, '阶段列表读取失败。'],
  ['coreErr.stage.readFailed', ChangxiaErrorCode.Storage, '阶段读取失败。'],
  ['coreErr.stage.draftIncomplete', ChangxiaErrorCode.Validation, '阶段草稿字段不完整，无法入库。'],
  // 原本是模板串 `` `「${r.name}」起止日期倒置。` ``（取值逐字节相同）
  ['coreErr.stage.rangeReversed', ChangxiaErrorCode.Validation, '「S1」起止日期倒置。'],
  ['coreErr.stage.bulkWriteFailed', ChangxiaErrorCode.Storage, '阶段批量写入失败。'],
  ['coreErr.stage.notFound', ChangxiaErrorCode.NotFound, '未找到该阶段。'],
  ['coreErr.stage.badDate', ChangxiaErrorCode.Validation, '日期格式无效。'],
  ['coreErr.stage.endBeforeStart', ChangxiaErrorCode.Validation, '新截止日早于开始日，已拒绝保存。'],
  ['coreErr.stage.newRangeInvalid', ChangxiaErrorCode.Validation, '新起止日期无效。'],
  ['coreErr.stage.newEndBeforeStart', ChangxiaErrorCode.Validation, '新的截止日早于开始日。'],
  [
    'coreErr.stage.postponeReasonRequired',
    ChangxiaErrorCode.Validation,
    '截止日后移必须填写延期原因（PRD 硬规则），否则不予保存。',
  ],
  [
    'coreErr.stage.completedOnlyReopenInProgress',
    ChangxiaErrorCode.Conflict,
    '已完成阶段仅允许重新开启为「进行中」。',
  ],
  ['coreErr.member.listReadFailed', ChangxiaErrorCode.Storage, '成员列表读取失败。'],
  ['coreErr.member.readFailed', ChangxiaErrorCode.Storage, '成员读取失败。'],
  ['coreErr.member.nameRequired', ChangxiaErrorCode.Validation, '成员姓名不能为空。'],
  ['coreErr.member.createFailed', ChangxiaErrorCode.Storage, '成员创建失败。'],
  ['coreErr.member.notFound', ChangxiaErrorCode.NotFound, '未找到该成员。'],

  /* ── 第 2 批（本地仓储余下 4 文件 / 31 键）：基准值同样**取自改动前的 `HEAD:` 源码** ── */
  ['coreErr.itinerary.createFailed', ChangxiaErrorCode.Storage, '每日行程创建失败。'],
  ['coreErr.itinerary.deleteFailed', ChangxiaErrorCode.Storage, '每日行程删除失败。'],
  ['coreErr.itinerary.generateFailed', ChangxiaErrorCode.Storage, '每日行程生成失败。'],
  ['coreErr.itinerary.listReadFailed', ChangxiaErrorCode.Storage, '每日行程读取失败。'],
  ['coreErr.itinerary.missingProjectOrDate', ChangxiaErrorCode.Validation, '每日行程缺少有效项目或日期。'],
  ['coreErr.itinerary.notFound', ChangxiaErrorCode.NotFound, '未找到该每日行程。'],
  ['coreErr.itinerary.rangeInvalid', ChangxiaErrorCode.Validation, '旅游项目的起止日期无效，无法生成每日行程。'],
  ['coreErr.itinerary.updateFailed', ChangxiaErrorCode.Storage, '每日行程更新失败。'],
  ['coreErr.log.assignmentAppendFailed', ChangxiaErrorCode.Storage, '指派流水写入失败。'],
  ['coreErr.log.assignmentReadFailed', ChangxiaErrorCode.Storage, '指派流水读取失败。'],
  ['coreErr.log.projectReadFailed', ChangxiaErrorCode.Storage, '项目流水读取失败。'],
  ['coreErr.log.stageAppendFailed', ChangxiaErrorCode.Storage, '阶段流水写入失败。'],
  ['coreErr.log.stageReadFailed', ChangxiaErrorCode.Storage, '阶段流水读取失败。'],
  // 原本是模板串「设置项 + 变量 + 读取失败。」（基准值 = key 取 theme 时的渲染结果）
  ['coreErr.setting.readFailed', ChangxiaErrorCode.Storage, '设置项 theme 读取失败。'],
  ['coreErr.setting.tableReadFailed', ChangxiaErrorCode.Storage, '设置表读取失败。'],
  ['coreErr.setting.tableRebuildFailed', ChangxiaErrorCode.Storage, '设置表重建失败。'],
  ['coreErr.setting.writeFailed', ChangxiaErrorCode.Storage, '设置项 theme 写入失败。'],
  ['coreErr.task.assigneeRequired', ChangxiaErrorCode.Validation, '认领人不能为空。'],
  ['coreErr.task.bulkWriteFailed', ChangxiaErrorCode.Storage, '任务批量写入失败。'],
  ['coreErr.task.claimFailed', ChangxiaErrorCode.Storage, '任务认领失败。'],
  ['coreErr.task.deleteFailed', ChangxiaErrorCode.Storage, '任务删除失败。'],
  ['coreErr.task.draftIncomplete', ChangxiaErrorCode.Validation, '任务草稿字段不完整，无法入库。'],
  ['coreErr.task.externalIdRequired', ChangxiaErrorCode.Validation, '幂等键 externalId 不能为空。'],
  ['coreErr.task.fieldsIncomplete', ChangxiaErrorCode.Validation, '任务字段不完整，无法写入。'],
  ['coreErr.task.idempotencyConflict', ChangxiaErrorCode.Conflict, '任务幂等键冲突，请重试导入。'],
  ['coreErr.task.idempotentWriteFailed', ChangxiaErrorCode.Storage, '任务幂等写入失败。'],
  ['coreErr.task.listReadFailed', ChangxiaErrorCode.Storage, '任务列表读取失败。'],
  ['coreErr.task.notClaimable', ChangxiaErrorCode.Conflict, '该任务已被认领或不处于就绪状态。'],
  ['coreErr.task.notFound', ChangxiaErrorCode.NotFound, '未找到该任务。'],
  ['coreErr.task.readFailed', ChangxiaErrorCode.Storage, '任务读取失败。'],
  ['coreErr.task.titleRequired', ChangxiaErrorCode.Validation, '任务标题不能为空。'],
];

/** 需要插值的键 → 参数（取值与上面基准表一致；未列出的键一律不传参） */
const PARAMS: Partial<Record<CoreErrorKey, Record<string, string>>> = {
  'coreErr.stage.rangeReversed': { name: 'S1' },
  'coreErr.setting.readFailed': { key: 'theme' },
  'coreErr.setting.writeFailed': { key: 'theme' },
};

/** 参数名 → 该键的占位符（③ 的英文插值断言用；手写的期待，不是从实现反推） */
const PLACEHOLDER_OF: Partial<Record<CoreErrorKey, string>> = {
  'coreErr.stage.rangeReversed': 'name',
  'coreErr.setting.readFailed': 'key',
  'coreErr.setting.writeFailed': 'key',
};

const zhTable = coreZh as Record<string, string>;
const enTable = coreEn as Record<string, string>;

function resetLang(): void {
  setLang('zh');
  try {
    localStorage?.removeItem?.('idplan-lang');
  } catch {
    /* 忽略 */
  }
}

beforeEach(resetLang);
afterEach(resetLang);

/* ══════════════════ ① 三表不漂（键集两两相等 + zh 取值逐字相等） ══════════════════ */

describe('① 三表不漂：载荷表 / 分片 zh / 分片 en', () => {
  it('★ 键集两两相等（载荷表 ⟺ 分片 zh ⟺ 本 spec 的点名表）', () => {
    expect(Object.keys(CORE_ERROR_TEXT).sort(), '载荷表与分片 zh 键集不一致').toEqual(
      Object.keys(zhTable).sort(),
    );
    expect(
      BASELINE.map(([k]) => k).sort(),
      'BASELINE（载荷基准表）漏了键 —— 加了键就必须补一条**改动前的原文**，不许只加键不记基准',
    ).toEqual(Object.keys(CORE_ERROR_TEXT).sort());
  });

  it('★ 分片 zh 键集 === 分片 en 键集（漏一个英文 = 编译错，这里再钉一次运行期）', () => {
    expect(Object.keys(enTable).sort()).toEqual(Object.keys(zhTable).sort());
  });

  it('★ zh 取值逐字相等：载荷表 === 分片 zh', () => {
    for (const key of KEYS) {
      expect(zhTable[key], `${key} 的两处中文不一致`).toBe(CORE_ERROR_TEXT[key]);
    }
  });

  it('★ en 取值非空且不含汉字（英文界面不许漏中文）', () => {
    for (const key of KEYS) {
      expect(enTable[key]?.length ?? 0, `${key} 的英文为空`).toBeGreaterThan(0);
      expect(enTable[key], `${key} 的英文里还有汉字`).not.toMatch(/[\u3400-\u4dbf\u4e00-\u9fff]/);
    }
  });

  it('★ 占位符两侧一致（载荷表有 `{name}` ⇒ 英文也得有，否则插值只生效一半）', () => {
    for (const key of KEYS) {
      const holders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
      expect(holders(enTable[key] ?? ''), `${key} 的占位符两侧不一致`).toEqual(
        holders(CORE_ERROR_TEXT[key]),
      );
    }
  });
});

/* ══════════════════ ② 载荷逐字节不变（基准表，不是重算） ══════════════════ */

describe('② 载荷口径逐字节不变（`userMessage` / `message`）', () => {
  it.each(BASELINE)('★ %s：userMessage 与改动前那句字面量逐字节相等', (key, code, before) => {
    const err = coreError(code, key, PARAMS[key]);
    expect(err.userMessage).toBe(before);
    expect(err.message).toBe(`[changxia:${code}] ${before}`);
    expect(err.code).toBe(code);
    expect(err.messageKey).toBe(key);
  });

  it('★ 不传 params 时占位符**原样保留**（与 `t()` 同口径：漏传变量要看得见）', () => {
    expect(coreErrorText('coreErr.stage.rangeReversed')).toBe('「{name}」起止日期倒置。');
  });

  it('★ 手写 `new ChangxiaError(...)` 仍合法（真因不定型那一支留在 B）', () => {
    const err = new ChangxiaError(ChangxiaErrorCode.ParseFailed, '任意真因。');
    expect(err.userMessage).toBe('任意真因。');
    expect(err.messageKey).toBeUndefined();
    expect(err.params).toBeUndefined();
  });
});

/* ══════════════════ ③ 英文真能取到（这条是防假绿的关键） ══════════════════ */

describe('③ `resolveErrorText` 在两种语言下都给出正确取值', () => {
  it.each(BASELINE)('★ %s：zh 取到与 userMessage 逐字相同的中文；en 取到英文', (key, code, before) => {
    const err = coreError(code, key, PARAMS[key]);

    setLang('zh');
    expect(resolveErrorText(err, t), `${key} 的 zh 取值必须等于 userMessage`).toBe(before);

    setLang('en');
    const english = resolveErrorText(err, t);
    expect(english.length).toBeGreaterThan(0);
    expect(english, `${key} 在英文下仍给中文`).not.toMatch(/[\u3400-\u4dbf\u4e00-\u9fff]/);
    const vars = PARAMS[key];
    if (vars === undefined) {
      expect(english).toBe(enTable[key]);
    } else {
      // 有插值：英文取值必须**已被替换**（占位符原样端出去 = 界面露出 `{name}`）
      const holder = PLACEHOLDER_OF[key]!;
      expect(english, `${key} 把 {${holder}} 原样端出去了`).not.toContain(`{${holder}}`);
      expect(english).toContain(vars[holder]!);
    }
  });

  it('★ 插值参数在英文里真的被替换（不是把 `{name}` 原样端出去）', () => {
    const err = coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.rangeReversed', { name: 'S9' });
    setLang('en');
    expect(resolveErrorText(err, t)).toContain('S9');
    expect(resolveErrorText(err, t)).not.toContain('{name}');
  });
});

/* ══════════════════ ④ 三支口径（团队判据一字不差） ══════════════════ */

describe('④ 三支口径：有码 / 有真因 / 都没有', () => {
  it('① 有机器码 ⇒ 取本地化文案', () => {
    setLang('en');
    expect(resolveErrorText(coreError(ChangxiaErrorCode.NotFound, 'coreErr.member.notFound'), t)).toBe(
      'Member not found.',
    );
  });

  it('② 无机器码但有 userMessage ⇒ **原样透传**（不许拿兜底句盖掉真因）', () => {
    const real = new ChangxiaError(ChangxiaErrorCode.Storage, 'zod: 第 3 条项目行业值不合法');
    expect(resolveErrorText(real, t, '备份导入失败。')).toBe('zod: 第 3 条项目行业值不合法');
  });

  it('③ 都不是 ⇒ 只用 fallback（兜底句只属于「没有真因」的那一支）', () => {
    expect(resolveErrorText(new Error('boom'), t, '兜底句')).toBe('兜底句');
    expect(resolveErrorText(undefined, t, '兜底句')).toBe('兜底句');
    expect(resolveErrorText(new Error('boom'), t)).toBe('');
  });
});

/* ══════════════════ ⑤ 真实调用点确实走了 `coreError`（不是只改了常量） ══════════════════ */

describe('⑤ 真实调用点的 userMessage 与 messageKey（防「机制在、没人用」）', () => {
  /** 只提供被测路径需要的两个方法，其余一律抛（用到即说明测试写错了） */
  function stubDb(over: Record<string, unknown>): unknown {
    return new Proxy(over, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        throw new Error(`stub 未提供 db.${String(prop)}`);
      },
    });
  }

  it('★ LocalStagesRepository.listByProject：读取失败 → 载荷中文不变 + 有机器码', async () => {
    const db = stubDb({
      stages: {
        where: () => ({
          equals: () => ({ toArray: async () => Promise.reject(new Error('boom')) }),
        }),
      },
    });
    const repo = new LocalStagesRepository(db as never);
    await expect(repo.listByProject('p1')).rejects.toMatchObject({
      userMessage: '阶段列表读取失败。',
      messageKey: 'coreErr.stage.listReadFailed',
      code: 'storage',
    });
  });

  it('★ LocalStagesRepository.bulkInsert：起止倒置 → 插值结果与改动前逐字相同', async () => {
    const repo = new LocalStagesRepository(stubDb({}) as never);
    await expect(
      repo.bulkInsert([
        {
          id: 's1',
          projectId: 'p1',
          name: '方案深化',
          startAt: '2026-03-10T00:00:00.000Z',
          endAt: '2026-03-01T00:00:00.000Z',
          orderIndex: 0,
        } as never,
      ]),
    ).rejects.toMatchObject({
      userMessage: '「方案深化」起止日期倒置。',
      messageKey: 'coreErr.stage.rangeReversed',
      params: { name: '方案深化' },
    });
  });

  it('★ LocalStagesRepository.update：未找到 → 复用同一键（同一个词只建一个键）', async () => {
    const repo = new LocalStagesRepository(stubDb({ stages: { get: async () => undefined } }) as never);
    await expect(repo.update('gone', {})).rejects.toMatchObject({
      userMessage: '未找到该阶段。',
      messageKey: 'coreErr.stage.notFound',
    });
  });

  it('★ LocalMembersRepository.insert：姓名为空 → 载荷中文不变 + 有机器码', async () => {
    const repo = new LocalMembersRepository(stubDb({}) as never);
    await expect(repo.insert({ name: '   ' } as never)).rejects.toMatchObject({
      userMessage: '成员姓名不能为空。',
      messageKey: 'coreErr.member.nameRequired',
    });
  });

  it('★ StageService.reschedule：阶段不存在 → 与仓储**共用同一个键**（未找到该阶段。）', async () => {
    const svc = new StageService({
      stages: { get: async () => null },
      logs: {},
    } as never);
    await expect(
      svc.reschedule('gone', { newStartAt: '2026-03-01', newEndAt: '2026-03-02' } as never),
    ).rejects.toMatchObject({
      userMessage: '未找到该阶段。',
      messageKey: 'coreErr.stage.notFound',
    });
  });
});
