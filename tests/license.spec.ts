import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Windows 离线许可证（MVP）· 纯逻辑验收。
 *
 * ── 这份测试在防什么 ──
 * 1. **伪校验**：只「读取一个 JSON 就当授权成功」是最容易写出来的假实现。
 *    这里用**临时 Ed25519 密钥对**真签真验：合法包必须通过，动一个字节必须被拒。
 *    临时私钥只活在本进程内，**不落仓库、不进安装包** —— 生产私钥仍只在作者离线持有。
 * 2. **绑定漏项**：机器码 / 产品 ID / 到期日 / 允许版本四项缺一，许可证就能被复制到别的
 *    机器或无限期使用。每条都有独立用例（改一项 → 必须被拒）。
 * 3. **私钥泄漏**：主进程一旦 require 私钥、或安装包目录里出现私钥文件，离线授权的意义归零。
 *    末尾两条回归用例直接扫源码与目录。
 */

const require_ = createRequire(import.meta.url);
const license = require_('../electron/license.cjs') as {
  PRODUCT_ID: string;
  canonicalPayload(payload: Record<string, unknown>): string;
  machineId(): string;
  versionAllowed(allowed: unknown, appVersion: string): boolean;
  validateLicense(
    doc: unknown,
    ctx: { machineId: string; appVersion: string; publicKeyPem?: string | Buffer },
  ): { valid: boolean; reason: string | null; payload?: Record<string, unknown> };
  readLicenseStatus(
    userDataPath: string,
    appVersion: string,
    options?: { machineId?: string; publicKeyPem?: string | Buffer },
  ): { machineId: string; licensed: boolean; reason: string | null; expiresAt: string | null };
  importLicense(
    userDataPath: string,
    raw: unknown,
    appVersion: string,
    options?: { machineId?: string; publicKeyPem?: string | Buffer },
  ): { machineId: string; licensed: boolean; reason: string | null; expiresAt: string | null };
  PUBLIC_KEY_PATH: string;
};

const APP_VERSION = '0.8.0';
const MACHINE = 'win-0123456789abcdef0123456789abcdef';
const KEY_DIR = path.join(__dirname, '..', 'electron');
const LICENSES_DIR = path.join(KEY_DIR, 'licenses');

let publicKeyPem: string;
let privateKey: crypto.KeyObject;

/** 造一份**真签名**的许可证（payload 可被用例改写以构造各种拒绝场景） */
function issueLicense(overrides: Partial<Record<string, unknown>> = {}): {
  payload: Record<string, unknown>;
  signature: string;
} {
  const payload = {
    productId: license.PRODUCT_ID,
    machineId: MACHINE,
    issuedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2099-12-31T00:00:00.000Z',
    allowedVersions: ['*'],
    ...overrides,
  };
  const signature = crypto
    .sign(null, Buffer.from(license.canonicalPayload(payload)), privateKey)
    .toString('base64');
  return { payload, signature };
}

function verify(doc: unknown, appVersion = APP_VERSION) {
  return license.validateLicense(doc, {
    machineId: MACHINE,
    appVersion,
    publicKeyPem,
  });
}

let tmpRoot: string;

beforeAll(() => {
  const pair = crypto.generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'idplan-license-'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('canonicalPayload · 签名只覆盖约定字段（顺序固定）', () => {
  it('只序列化 productId/machineId/issuedAt/expiresAt/allowedVersions，字段顺序固定', () => {
    const json = license.canonicalPayload({
      allowedVersions: ['*'],
      expiresAt: '2099-12-31T00:00:00.000Z',
      machineId: MACHINE,
      productId: license.PRODUCT_ID,
      issuedAt: '2026-09-01T00:00:00.000Z',
      // 故意多塞一个字段：不入签名，避免「加个备注就验签失败」
      note: '发给某某',
    });
    expect(json).toBe(
      JSON.stringify({
        productId: license.PRODUCT_ID,
        machineId: MACHINE,
        issuedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2099-12-31T00:00:00.000Z',
        allowedVersions: ['*'],
      }),
    );
  });

  it('缺失 expiresAt / allowedVersions 时落到稳定默认值（null / [*]），不会因字段缺失改变签名内容', () => {
    const json = license.canonicalPayload({
      productId: license.PRODUCT_ID,
      machineId: MACHINE,
      issuedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(JSON.parse(json)).toEqual({
      productId: license.PRODUCT_ID,
      machineId: MACHINE,
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      allowedVersions: ['*'],
    });
  });
});

describe('validateLicense · 合法许可证必须通过', () => {
  it('长期许可证（allowedVersions=[*]、远期到期）→ valid', () => {
    const result = verify(issueLicense());
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.payload?.machineId).toBe(MACHINE);
  });

  it('限定版本号的许可证：当前版本在列表内 → valid', () => {
    expect(verify(issueLicense({ allowedVersions: ['0.8.0', '0.8.1'] })).valid).toBe(true);
  });

  it('无到期日（expiresAt=null）→ 永久有效', () => {
    expect(verify(issueLicense({ expiresAt: null })).valid).toBe(true);
  });
});

describe('validateLicense · 四种绑定缺一不可', () => {
  it('机器码不匹配 → 拒绝（许可证不能被复制到另一台机器）', () => {
    const result = verify(issueLicense({ machineId: 'win-deadbeefdeadbeefdeadbeefdeadbeef' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('许可证不属于当前设备。');
  });

  it('产品 ID 不符 → 拒绝（别的产品的许可证不能开这一款）', () => {
    const result = verify(issueLicense({ productId: 'com.example.other' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('许可证不属于 ID Plan。');
  });

  it('已过期 → 拒绝，并给出到期口径', () => {
    const result = verify(issueLicense({ expiresAt: '2020-01-01T00:00:00.000Z' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('许可证已过期。');
  });

  it('当前版本不在 allowedVersions → 拒绝（大版本换发的控制点）', () => {
    const result = verify(issueLicense({ allowedVersions: ['0.7.0'] }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('许可证不适用于当前版本。');
  });
});

describe('validateLicense · 伪造与畸形一律拒绝', () => {
  it('改动 payload 字段但不重签 → 签名无效（这是整个离线授权的立足点）', () => {
    const doc = issueLicense();
    // 把到期日改到更晚，签名不动
    doc.payload = { ...doc.payload, expiresAt: '2099-12-31T00:00:00.000Z', machineId: MACHINE };
    doc.payload.issuedAt = '2026-09-02T00:00:00.000Z';
    const result = verify(doc);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('许可证签名无效。');
  });

  it('换一把密钥签的许可证 → 签名无效（不能自签自用）', () => {
    const rogue = crypto.generateKeyPairSync('ed25519');
    const payload = {
      productId: license.PRODUCT_ID,
      machineId: MACHINE,
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      allowedVersions: ['*'],
    };
    const signature = crypto
      .sign(null, Buffer.from(license.canonicalPayload(payload)), rogue.privateKey)
      .toString('base64');
    const result = verify({ payload, signature });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('许可证签名无效。');
  });

  it('格式不对（缺 payload / 缺 signature / 不是对象）→ 明确报格式错，而不是崩', () => {
    for (const bad of [null, {}, { payload: {} }, { signature: 'x' }, 'a string']) {
      const result = verify(bad);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('许可证文件格式无效。');
    }
  });

  it('到期日不是合法日期 → 拒绝（避免 NaN 比较被当成「没过期」）', () => {
    const result = verify(issueLicense({ expiresAt: '不是日期' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('许可证到期日期无效。');
  });
});

describe('versionAllowed · 版本白名单', () => {
  it('[*] 通配一切版本；空数组/非数组一律不放行', () => {
    expect(license.versionAllowed(['*'], '0.8.0')).toBe(true);
    expect(license.versionAllowed(['0.8.0'], '0.8.0')).toBe(true);
    expect(license.versionAllowed(['0.8.0'], '0.9.0')).toBe(false);
    expect(license.versionAllowed([], '0.8.0')).toBe(false);
    expect(license.versionAllowed(undefined, '0.8.0')).toBe(false);
    expect(license.versionAllowed('*' as unknown, '0.8.0')).toBe(false);
  });
});

describe('machineId · 稳定且可识别', () => {
  it('同一次运行内两次取值一致（许可证绑定不能随机漂移）', () => {
    const a = license.machineId();
    const b = license.machineId();
    expect(a).toBe(b);
    // Windows: `win-<MachineGuid 小写>`（GUID 带连字符）；其它平台: `fallback-<sha256 hex>`
    expect(a).toMatch(/^(win-[0-9a-f-]{36}|fallback-[0-9a-f]{64})$/);
  });

  it('Windows 上优先读注册表 MachineGuid（形如 win-<小写 hex>）', () => {
    if (process.platform !== 'win32') return;
    expect(license.machineId()).toMatch(/^win-[0-9a-f-]{36}$/);
  });
});

describe('readLicenseStatus / importLicense · 落盘与读取', () => {
  it('未导入时 → licensed=false 且文案是「尚未导入许可证。」', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'empty-'));
    const status = license.readLicenseStatus(dir, APP_VERSION, { machineId: MACHINE, publicKeyPem });
    expect(status).toMatchObject({ licensed: false, reason: '尚未导入许可证。', expiresAt: null });
    expect(status.machineId).toBe(MACHINE);
  });

  it('导入合法许可证 → 落盘 license.json，状态转为已授权并带出到期日', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'ok-'));
    const imported = license.importLicense(dir, JSON.stringify(issueLicense()), APP_VERSION, {
      machineId: MACHINE,
      publicKeyPem,
    });
    expect(imported.licensed).toBe(true);
    expect(imported.expiresAt).toBe('2099-12-31T00:00:00.000Z');
    expect(fs.existsSync(path.join(dir, 'license.json'))).toBe(true);

    const status = license.readLicenseStatus(dir, APP_VERSION, { machineId: MACHINE, publicKeyPem });
    expect(status.licensed).toBe(true);
    expect(status.reason).toBeNull();
  });

  it('导入非法许可证 → **不落盘**（不能在磁盘上留一份「看着像授权」的文件）', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'reject-'));
    const imported = license.importLicense(
      dir,
      JSON.stringify(issueLicense({ machineId: 'win-00000000000000000000000000000000' })),
      APP_VERSION,
      { machineId: MACHINE, publicKeyPem },
    );
    expect(imported.licensed).toBe(false);
    expect(imported.reason).toBe('许可证不属于当前设备。');
    expect(fs.existsSync(path.join(dir, 'license.json'))).toBe(false);
  });

  it('落盘内容损坏（被人为改坏）→ 读取时给出「无法读取」而不是抛异常', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'broken-'));
    fs.writeFileSync(path.join(dir, 'license.json'), '{ this is not json', 'utf8');
    const status = license.readLicenseStatus(dir, APP_VERSION, { machineId: MACHINE, publicKeyPem });
    expect(status.licensed).toBe(false);
    expect(status.reason).toBe('许可证文件无法读取。');
  });

  it('坏 JSON 字符串交给 importLicense 会抛错 —— 由主进程兜成友好文案（契约见下一条）', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'badjson-'));
    expect(() => license.importLicense(dir, '{not json', APP_VERSION, { machineId: MACHINE })).toThrow();
  });
});

describe('安全回归 · 私钥不得进仓库 / 进安装包 / 进主进程', () => {
  it('随包公钥存在且是 Ed25519 SPKI PEM（验签立足点）', () => {
    expect(fs.existsSync(license.PUBLIC_KEY_PATH)).toBe(true);
    const key = crypto.createPublicKey(fs.readFileSync(license.PUBLIC_KEY_PATH));
    expect(key.asymmetricKeyType).toBe('ed25519');
  });

  it('electron/licenses/ 目录里不存在任何私钥文件，且源文件里不出现私钥 PEM 头', () => {
    const files = fs.readdirSync(LICENSES_DIR);
    expect(files.filter((f) => /private|secret|\.key$/i.test(f))).toEqual([]);
    expect(files).toContain('public-key.pem');

    for (const rel of ['license.cjs', 'main.cjs', 'preload.cjs']) {
      const source = fs.readFileSync(path.join(KEY_DIR, rel), 'utf8');
      expect(source).not.toMatch(/-----BEGIN PRIVATE KEY-----/);
      expect(source).not.toMatch(/private-key/i);
    }
  });

  it('主进程的 license:import 处理器把 JSON 解析错误兜成友好文案（不把异常抛给渲染进程）', () => {
    const main = fs.readFileSync(path.join(KEY_DIR, 'main.cjs'), 'utf8');
    const start = main.indexOf("ipcMain.handle('license:import'");
    expect(start).toBeGreaterThan(-1);
    const block = main.slice(start, start + 320);
    expect(block).toContain('try {');
    expect(block).toContain('许可证文件不是有效 JSON。');
  });
});
