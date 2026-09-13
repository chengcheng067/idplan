/**
 * Agent / 备份通道鉴权（v0.6 · T14，PRD Q9 单立修复项）。
 *
 * 设计要点（设计文档 T14 要点 1–2）：
 * - 共享密钥模型：`IDPLAN_AGENT_TOKEN` 环境变量，`X-Agent-Token` 头或
 *   `Authorization: Bearer <token>` 二选一；**常量时间比较**（crypto.timingSafeEqual，
 *   长度不等先判 false——长度本身不是机密，先短路可避免 timingSafeEqual 抛异常）。
 * - **fail-closed**：env 未配置 token 时 `requireToken` 恒返回 false，模块加载时
 *   打印醒目告警。宁可全拒（本地用户配好 token 即恢复），不可裸奔。
 * - ⚠️ **边界（写死，勿越）**：本模块只服务于 `/api/backup*`（NAS 迁移通道）与
 *   **未来的独立 Agent HTTP API**。Agent 通道绝不复用 `/api/backup`——
 *   后续 Agent API 是独立端点 + 独立 token + 独立限流（§10-R7）。
 *   `/api/bootstrap` 本期只脱敏、不鉴权（前端启动全量装载依赖它，鉴权排 V1）。
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/** env 变量名（单一出处，.env.example 与 docs/api-contract.md 同名引用） */
export const AGENT_TOKEN_ENV = 'IDPLAN_AGENT_TOKEN';

// 模块加载即告警：fail-closed 意味着未配置 = backup 端点全拒，必须在启动日志里可见
if (
  typeof process !== 'undefined' &&
  !(process.env[AGENT_TOKEN_ENV] ?? '').trim()
) {
  // eslint-disable-next-line no-console -- 启动告警必须走 stdout，不走 app logger（模块加载早于 app 创建）
  console.warn(
    `[IDPLAN-SECURITY] 环境变量 ${AGENT_TOKEN_ENV} 未配置：` +
      '/api/backup 与 /api/backup/import 将拒绝所有请求（fail-closed）。' +
      '局域网备份/迁移功能需在服务端环境配置该共享密钥后重启。',
  );
}

/** 从请求头提取调用方声明的 token（两种头格式都接受） */
function extractToken(req: FastifyRequest): string {
  const headerToken = req.headers['x-agent-token'];
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken;
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  return '';
}

/** 常量时间字符串比较；长度不等直接 false（长度非机密） */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // 长度相等时 encoding 无差异影响，直接 utf-8 比对
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  return timingSafeEqual(ab, bb);
}

/**
 * 鉴权闸门（fail-closed）：
 * - env 未配置 → 恒 false（401）；
 * - 配置了 → 请求头 token 与之常量时间比较。
 *
 * 返回 true 才放行；调用方负责以 `{error:{code,userMessage}}` 形状回 401。
 */
export function requireToken(req: FastifyRequest): boolean {
  const expected = (process.env[AGENT_TOKEN_ENV] ?? '').trim();
  if (!expected) return false; // fail-closed：未配置 = 全拒
  const provided = extractToken(req);
  if (!provided) return false;
  return timingSafeEqualStr(provided, expected);
}

/** 统一 401 错误体（与全局 {error:{code,userMessage}} 形状一致） */
export function unauthorizedBody(): {
  error: { code: string; userMessage: string };
} {
  return {
    error: {
      code: 'Unauthorized',
      userMessage: '备份通道需要鉴权：请在服务端配置 IDPLAN_AGENT_TOKEN，并在请求头携带 X-Agent-Token。',
    },
  };
}

/* ============================================================================================
 * Agent 导入通道（v0.7 · T02 · 设计文档 §3.4）
 *
 * ── 为什么另起一套 env 而不是复用上面那套 ──
 * `IDPLAN_AGENT_TOKEN` 是**备份/迁移通道**的密钥：它保护的是「整库 dump（含成员密码哈希）」
 * 这种最高危操作，泄露面 = 全部数据。`/api/agent/*` 是**日常写入通道**，调用方是桌面上的
 * Skill，会被配置在很多台机器上。两者的**生命周期与吊销范围必须能独立**：
 *   · Skill 所在机器换了一台 → 只轮换 Agent token，备份密钥不受影响；
 *   · 备份密钥疑似泄露 → 只吊销它，Agent 同步照常工作。
 * 共用一个 env 会把两个不同风险面绑死：吊销任一方都会连带打死另一方。
 *
 * ── 为什么 `requireToken` 一个字节都不改 ──
 * 它是 `/api/backup` 与 `/api/backup/import` 的**唯一闸门**。在 T02 里顺手把它「统一」
 * 成收 env 参数的函数，等于在一个纯新增任务里改动迁移通道的鉴权行为 —— 一旦有环境
 * 只配了其中一个 env，备份通道会从「可用」变成「全拒」（fail-closed 会把它放大成
 * 100% 失败）。新增能力一律走**新增函数**，既有函数保持原样（`extractToken` /
 * `timingSafeEqualStr` 两个内部工具则**共享**，它们是纯比较逻辑，不承载任何通道语义）。
 * ============================================================================================ */

/**
 * Agent 导入通道的独立 env（单一出处）。
 *
 * ⚠️ **不是** `IDPLAN_AGENT_TOKEN`（那是备份通道的），两者必须分别配置。
 */
export const AGENT_API_TOKEN_ENV = 'IDPLAN_AGENT_API_TOKEN';

// 模块加载即告警（fail-closed）：未配置 = `/api/agent/*` 全拒，必须在启动日志里可见，
// 否则用户只会看到 Skill 报「ID Plan 未运行」，而真相是「服务活着但没配 token」——
// 这正是 V1-13 要防的「假无响应」。
if (typeof process !== 'undefined' && !(process.env[AGENT_API_TOKEN_ENV] ?? '').trim()) {
  // eslint-disable-next-line no-console -- 启动告警必须走 stdout，不走 app logger（模块加载早于 app 创建）
  console.warn(
    `[IDPLAN-SECURITY] 环境变量 ${AGENT_API_TOKEN_ENV} 未配置：` +
      '/api/agent/import、/api/agent/health、/api/agent/tasks 将拒绝所有请求（fail-closed）。' +
      `WorkBuddy 侧的 Agent 同步功能需在服务端配置该共享密钥后重启（与备份用的 ${AGENT_TOKEN_ENV} 相互独立）。`,
  );
}

/**
 * Agent 通道鉴权闸门（fail-closed），与 `requireToken` **同语义、不同 env**：
 * - env 未配置 → 恒 false（401）。宁可全拒（用户配好即恢复），不可裸奔；
 * - 配置了 → 请求头 token（`X-Agent-Token` 或 `Authorization: Bearer`）与之**常量时间**比较。
 *
 * 返回 true 才放行；调用方负责以 `{error:{code,userMessage}}` 形状回 401
 * （用 `agentUnauthorizedBody()`，文案绑定 Agent 的 env 名）。
 */
export function requireAgentToken(req: FastifyRequest): boolean {
  const expected = (process.env[AGENT_API_TOKEN_ENV] ?? '').trim();
  if (!expected) return false; // fail-closed：未配置 = 全拒
  const provided = extractToken(req);
  if (!provided) return false;
  return timingSafeEqualStr(provided, expected);
}

/**
 * Agent 通道专用 401 错误体。
 *
 * 为什么要独立文案（§3.4 表格第 2 行）：复用 `unauthorizedBody()` 会告诉用户
 * 「请在服务端配置 IDPLAN_AGENT_TOKEN」—— **指错了要配的变量名**。用户照做之后
 * 依然 401，且两次报错长得一模一样，排查经验完全失效。报错必须指向**真正缺的那个**。
 *
 * `code` 保持 `'Unauthorized'`（与备份通道同一机器码，形状恒定）。
 */
export function agentUnauthorizedBody(): {
  error: { code: string; userMessage: string };
} {
  return {
    error: {
      code: 'Unauthorized',
      userMessage: `Agent 通道需要鉴权：请在服务端配置 ${AGENT_API_TOKEN_ENV}，并在请求头携带 X-Agent-Token（或 Authorization: Bearer）。`,
    },
  };
}
