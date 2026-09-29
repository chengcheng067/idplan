/**
 * Agent 接入文件 / 接入指令的**纯构建器**（v0.8 · T04-B「接入外部写入方」重设计）。
 *
 * ══════════════════════════ 为什么重设计 ══════════════════════════
 * 旧流程：用户在接入面板「粘贴访问令牌」——而全应用**没有任何地方能产生令牌**，
 * 死锁；再把令牌手动转述给写入方（WorkBuddy）。用户 2026-09-23 裁决重设计为
 * **接入文件 + 指令块兜底**：
 *   ① 令牌由本机**自动生成**（用户不再发明暗号）；
 *   ② 接入信息写成**固定路径**的 JSON（documents/ID Plan/agent-ingress.json），
 *      写入方读一个文件即完成接入；令牌轮换后重新生成、写方重读；
 *   ③ 指令块（人肉可读的完整说明）复制到剪贴板，给不能读文件的写入方兜底。
 *
 * ══════════════════════════ 为什么这些函数是纯的 ══════════════════════════
 * 文件内容与指令文案是**契约**（写入方按它接入），必须有单测钉死形状——
 * 端点路径、schema 名、鉴权头格式错一个，写入方就接不上，且现象是远端 401/404，
 * 极难回头查。IO（落盘 / 剪贴板）在调用方（页面 + 主进程），此处只算内容。
 *
 * 端点清单的单一出处就在本文件：它们镜像 `server/routes/agent.routes.ts` 的四个
 * 端点。改路由必须同批改这里——否则接入文件会指向不存在的端点（静默 404）。
 */

/** 接入文件 schema 名（写入方按它识别文件类型；与 payload schema 是两回事） */
export const INGRESS_FILE_SCHEMA = 'idplan-agent-ingress/v1';

/** Agent payload schema 名（导入端点要求的 body 类型；单一出处 = agent-payload.ts） */
export const AGENT_PAYLOAD_SCHEMA = 'idplan-agent-payload/v1';

/** 接入文件里的端点清单（镜像 agent.routes.ts；顺序即展示顺序） */
export const INGRESS_ENDPOINTS: ReadonlyArray<{
  method: 'GET' | 'POST';
  path: string;
  summary: string;
}> = [
  { method: 'GET', path: '/api/agent/health', summary: '探活：版本 / Agent 看板候选 / 席位' },
  {
    method: 'POST',
    path: '/api/agent/boards',
    summary: '建 Agent 看板：名称 + 起止日期 + 阶段集合缺一即拒',
  },
  {
    method: 'POST',
    path: '/api/agent/import',
    summary: '导入任务：幂等 upsert；落点只能是 Agent 看板',
  },
  {
    method: 'GET',
    path: '/api/agent/tasks',
    summary: '任务流：显式 projectId 须为 Agent 看板',
  },
];

/** 接入文件内容（写入 `agent-ingress.json` 的形状） */
export interface IngressPayload {
  schema: typeof INGRESS_FILE_SCHEMA;
  generatedAt: string;
  /** 服务 Origin（含协议，不含尾斜杠），如 http://127.0.0.1:17788 */
  origin: string;
  auth: { type: 'bearer'; token: string };
  endpoints: ReadonlyArray<{ method: string; path: string; summary: string }>;
  payloadSchema: typeof AGENT_PAYLOAD_SCHEMA;
  /** 给人与写入方看的两条硬边界（隔离是结构性的，不是配置问题） */
  notes: string[];
}

/** 生成一个访问令牌（共享暗号）。前缀 + 32 位十六进制，足够本机 loopback 用途。 */
export function generateAgentToken(): string {
  return `idp_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * 构建接入文件内容。`generatedAt` 可注入（测试钉死形状时传固定值）。
 *
 * notes 为什么写进文件：写入方（尤其是另一个 agent）需要知道「人类项目一律拒绝」
 * 是结构性隔离而非可配置项——否则它会反复尝试往人类项目写，把 400 当 bug 上报。
 */
export function buildIngressPayload(input: {
  origin: string;
  token: string;
  generatedAt?: string;
}): IngressPayload {
  return {
    schema: INGRESS_FILE_SCHEMA,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    origin: input.origin.replace(/\/+$/, ''),
    auth: { type: 'bearer', token: input.token },
    endpoints: INGRESS_ENDPOINTS,
    payloadSchema: AGENT_PAYLOAD_SCHEMA,
    notes: [
      '落点只能是 Agent 看板（kind=agent）：人类项目一律以 project_unresolved 拒绝，这是结构性隔离。',
      '导入幂等键为（项目内）externalId；任务号 taskNo 全局唯一，不随导入重编号。',
      '令牌轮换后以本文件最新版本为准；文件路径固定，写入方重新读取即可。',
    ],
  };
}

/**
 * 构建「接入指令块」（剪贴板兜底）：不能读文件的写入方，人肉把这段粘给它也能接上。
 *
 * 令牌**明文**出现在指令块里——这是兜底通道的必然后果（它替代的就是"把令牌
 * 告诉写入方"这一步），与旧「复制令牌」按钮同一暴露面。文件路径在前、明文
 * 令牌在后：优先引导走文件，明文只是兜底。
 */
export function buildIngressInstructionBlock(input: {
  filePath: string;
  payload: IngressPayload;
}): string {
  const lines: string[] = [
    '【ID Plan · Agent 接入指令】',
    `优先读取接入文件（地址 / 令牌 / 端点 / payload 格式以它为准）：`,
    input.filePath,
    '',
    '若无法读文件，按以下信息接入：',
    `· 地址：${input.payload.origin}`,
    `· 鉴权：Authorization: Bearer ${input.payload.auth.token}`,
    '· 端点：',
    ...input.payload.endpoints.map((e) => `    ${e.method} ${e.path}    ${e.summary}`),
    `· payload schema：${input.payload.payloadSchema}`,
    '· 注意：人类项目一律拒绝（project_unresolved）——结构性隔离，不是配置问题。',
    '· 落点参数：导入（POST /api/agent/import）的目标看板用 projectId 指定——',
    '    query（?projectId=<板id>，桌面别号 ?project= 同样认）或 body.projectId 二选一；',
    '    建板（POST /api/agent/boards）回执里的 projectId 就是它。?stageId= 可指定批次，',
    '    ?stageName= 缺段时按名补建；?dryRun=1 预览不落库（任意真值均为预览，唯 0/false 实写）。',
  ];
  return lines.join('\n');
}
