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
