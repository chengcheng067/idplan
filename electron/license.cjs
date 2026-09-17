const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PRODUCT_ID = 'com.chengcheng.idplan';
const LICENSE_FILE = 'license.json';
const PUBLIC_KEY_PATH = path.join(__dirname, 'licenses', 'public-key.pem');

function canonicalPayload(payload) {
  return JSON.stringify({
    productId: payload.productId,
    machineId: payload.machineId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt ?? null,
    allowedVersions: payload.allowedVersions ?? ['*'],
  });
}

function machineId() {
  if (process.platform !== 'win32') return fallbackMachineId();
  try {
    const output = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if (match?.[1]?.trim()) return `win-${match[1].trim().toLowerCase()}`;
  } catch {}
  return fallbackMachineId();
}

function fallbackMachineId() {
  const source = `${process.platform}|${process.arch}|${require('node:os').hostname()}|${require('node:os').userInfo().username}`;
  return `fallback-${crypto.createHash('sha256').update(source).digest('hex')}`;
}

function versionAllowed(allowedVersions, appVersion) {
  return Array.isArray(allowedVersions) && (allowedVersions.includes('*') || allowedVersions.includes(appVersion));
}

/**
 * 验签。
 *
 * `context.publicKeyPem` 允许**测试**注入临时公钥（配套私钥只存在于测试进程内），
 * 这样「验签逻辑本身」可以被真实验证，而不必把生产私钥带进仓库或测试。
 * 生产调用不传该字段 ⇒ 一律读随包发布的 `licenses/public-key.pem`。
 */
function validateLicense(document, context) {
  if (!document || typeof document !== 'object' || !document.payload || typeof document.signature !== 'string') {
    return { valid: false, reason: '许可证文件格式无效。' };
  }
  const { payload, signature } = document;
  if (payload.productId !== PRODUCT_ID) return { valid: false, reason: '许可证不属于 ID Plan。' };
  if (payload.machineId !== context.machineId) return { valid: false, reason: '许可证不属于当前设备。' };
  if (!versionAllowed(payload.allowedVersions ?? ['*'], context.appVersion)) return { valid: false, reason: '许可证不适用于当前版本。' };
  if (payload.expiresAt && Number.isNaN(Date.parse(payload.expiresAt))) return { valid: false, reason: '许可证到期日期无效。' };
  if (payload.expiresAt && Date.parse(payload.expiresAt) < Date.now()) return { valid: false, reason: '许可证已过期。' };
  let publicKey;
  try {
    publicKey = context.publicKeyPem ?? fs.readFileSync(PUBLIC_KEY_PATH);
  } catch {
    // 公钥缺失 ⇒ 一律判不通过（宁可拒绝，也不放行未验签的许可证）
    return { valid: false, reason: '许可证公钥缺失，无法验签。' };
  }
  const verified = crypto.verify(null, Buffer.from(canonicalPayload(payload)), publicKey, Buffer.from(signature, 'base64'));
  return verified ? { valid: true, reason: null, payload } : { valid: false, reason: '许可证签名无效。' };
}

function licensePath(userDataPath) {
  return path.join(userDataPath, LICENSE_FILE);
}

function readLicenseStatus(userDataPath, appVersion, options = {}) {
  const id = options.machineId ?? machineId();
  const file = licensePath(userDataPath);
  if (!fs.existsSync(file)) return { machineId: id, licensed: false, reason: '尚未导入许可证。', expiresAt: null };
  try {
    const result = validateLicense(JSON.parse(fs.readFileSync(file, 'utf8')), {
      machineId: id,
      appVersion,
      publicKeyPem: options.publicKeyPem,
    });
    return { machineId: id, licensed: result.valid, reason: result.reason, expiresAt: result.payload?.expiresAt ?? null };
  } catch {
    return { machineId: id, licensed: false, reason: '许可证文件无法读取。', expiresAt: null };
  }
}

function importLicense(userDataPath, raw, appVersion, options = {}) {
  const document = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const id = options.machineId ?? machineId();
  const result = validateLicense(document, {
    machineId: id,
    appVersion,
    publicKeyPem: options.publicKeyPem,
  });
  if (!result.valid) return { machineId: id, licensed: false, reason: result.reason, expiresAt: null };
  fs.writeFileSync(licensePath(userDataPath), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  return { machineId: id, licensed: true, reason: null, expiresAt: result.payload.expiresAt ?? null };
}

module.exports = {
  PRODUCT_ID,
  canonicalPayload,
  machineId,
  versionAllowed,
  validateLicense,
  readLicenseStatus,
  importLicense,
  PUBLIC_KEY_PATH,
};
