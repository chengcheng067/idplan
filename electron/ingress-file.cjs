/**
 * Agent 接入文件：固定路径 + 形状门 + 落盘（electron 主进程侧）。
 *
 * ── 为什么单独成文件（2026-09-24 事故修复）──
 * 原实现把形状门内联在 main.cjs 的 IPC handler 里，**读错了字段路径**：接入文件
 * payload 的令牌是嵌套的 `auth.token`（见 src/core/agent/ingress-file.ts 的
 * IngressPayload），handler 却读扁平的 `payload.token` ⇒ 合法请求被判「缺地址或
 * 令牌」拒绝写文件——用户在 0007 包上点「生成接入信息」实测撞到的就是这个。
 * 内联在 main.cjs 的逻辑**没有任何测试能覆盖它**（CJS + electron 依赖），所以
 * 错到家也没人发现。抽成纯 CJS 模块后：main.cjs 与 vitest（node 环境）共用同一
 * 份实现，契约被测试钉死。
 *
 * ── 职责边界 ──
 * 本模块只做「校验 + 落盘」；**payload 的构建在渲染侧**（ingress-file.ts），
 * 主进程不重算内容（避免两份真相）。形状门是最后一道：渲染侧构建器无论如何
 * 演进，主进程只认这个契约。
 */

const path = require('node:path');
const fs = require('node:fs');

const INGRESS_DIR_NAME = 'ID Plan';
const INGRESS_FILE_NAME = 'agent-ingress.json';

/** 接入文件固定路径（documents/ID Plan/agent-ingress.json） */
function ingressFilePath(documentsDir) {
  return path.join(documentsDir, INGRESS_DIR_NAME, INGRESS_FILE_NAME);
}

/**
 * 形状门：接入信息不完整（缺地址或令牌）对写方无用，宁可不写。
 * 返回 `{ ok, reason? }`——不通过时 reason 由调用方展示，绝不静默。
 *
 * ★ 令牌路径是 `auth.token`（嵌套，与 IngressPayload 同构）。曾误读扁平
 *   `payload.token` 把合法请求判死（见文件头事故）。
 */
function validateIngressPayload(payload) {
  const origin = payload && typeof payload.origin === 'string' ? payload.origin.trim() : '';
  const token =
    payload && payload.auth && typeof payload.auth.token === 'string'
      ? payload.auth.token.trim()
      : '';
  if (!origin || !token) {
    return { ok: false, reason: '接入信息不完整（缺地址或令牌），拒绝写文件。' };
  }
  return { ok: true };
}

/**
 * 写盘。返回 `{ ok, path, reason? }`：
 *   · 形状门不过 → ok:false（reason 即门给出的文案）；
 *   · 磁盘错误 → ok:false + 真实原因（截断 200 字符）——绝不静默失败，
 *     静默=用户以为接上了。
 */
function writeIngressFile(documentsDir, payload) {
  const filePath = ingressFilePath(documentsDir);
  const gate = validateIngressPayload(payload);
  if (!gate.ok) return { ok: false, path: filePath, reason: gate.reason };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, path: filePath, reason: String((err && err.message) || err).slice(0, 200) };
  }
}

module.exports = {
  INGRESS_DIR_NAME,
  INGRESS_FILE_NAME,
  ingressFilePath,
  validateIngressPayload,
  writeIngressFile,
};
