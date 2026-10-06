/**
 * ID Plan · 插件「从文件安装」主进程共享模块（L2 · v0.8.6）
 *
 * ── 这个模块为什么是共享 CJS 而不是内联在 main.cjs ──
 * 2026-09-24 的事故（接入文件形状门内联在 IPC handler 里读错字段路径，错到家也没人
 * 发现）之后，主进程的「形状门 + 文件语义」一律抽成共享 CJS 模块，由
 * tests/ingress-file.main.spec.ts / tests/plugin-install-sandbox.spec.ts 直 require
 * 测试。本模块同理：安装校验、扫描、卸载、plug:// 路径解析四条文件语义全部在这里，
 * 单测能钉死，main.cjs 只做协议与 IPC 的接线。
 *
 * ── v1 的四条文件语义（每个都有实测背书，见探路报告 §3）──
 *   ① 安装 = 选文件（manifest.json）→ 校验 → **整目录覆盖写** `userData/plugins/<id>/`。
 *      同名 id = 先 rm 旧目录再整体复制（merge 会留上一个版本的孤儿文件）；
 *   ② id 是信任边界的门：只放行 `^[a-z0-9][a-z0-9-]{0,63}$`，杜绝穿越与怪名；
 *   ③ 卸载 = `rmSync(dir, {recursive, force})` 一步（KV 由渲染侧清，见插件面板）；
 *   ④ 登记入口唯一 = 启动扫描 plugins 下每个子目录的 manifest.json，坏 manifest **fail-open 跳过**，
 *      minHostVersion 高于宿主时跳过（提示由 UI 展示 skipped 计数）。
 *
 * 纪律：本模块零 Electron 依赖（纯 node:fs/node:path + 传进来的 userData 路径），
 * 因而可以在 node 环境的 vitest 里直接 require。
 */

const path = require('node:path');
const fs = require('node:fs');

/** 单个插件产物体积上限（粗限，防病态安装；探路报告建议的 v1 上限） */
const MAX_PLUGIN_TOTAL_BYTES = 5 * 1024 * 1024;

/** id 合法性（小写字母/数字/中划线，首字符不能是中划线，最长 64）。穿越字符在此被结构性排除 */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** entry 文件名合法性（单段文件名，杜绝路径与怪异字符；.html/.htm/.js/.mjs 四种） */
const ENTRY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENTRY_EXT_RE = /\.(html?|m?js)$/i;

/** v1 唯一能力（与 src/core/plugin/types.ts 的 PluginCapability 对齐；写/网/文件保存都不在 v1） */
const ALLOWED_CAPABILITIES = ['data.read'];

/**
 * 简易版本段比较：把 'x.y.z.build' 补成四段数值逐段比。
 * 任一无法解析 ⇒ 返回 null（调用方按「判不了」处理：minHostVersion 判不了 = 不拦）。
 */
function parseVersionSegs(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.startsWith('v') ? raw.slice(1) : raw.trim();
  if (v === '') return null;
  const parts = v.split('.');
  if (parts.length > 4) return null;
  const segs = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
    segs.push(n);
  }
  while (segs.length < 4) segs.push(0);
  return segs;
}

/** host >= min ? （min 无法解析时返回 true = 放行，绝不因我方解析不了拦住用户的插件） */
function isHostAtLeast(hostVersion, minVersion) {
  const host = parseVersionSegs(hostVersion);
  const min = parseVersionSegs(minVersion);
  if (!host || !min) return true;
  for (let i = 0; i < 4; i++) {
    if (host[i] !== min[i]) return host[i] > min[i];
  }
  return true;
}

/** userData 下的 plugins 根目录 */
function pluginsRoot(userDataDir) {
  return path.join(userDataDir, 'plugins');
}

/** id 合法性（安装与卸载两侧都用它兜底） */
function isValidPluginId(id) {
  return typeof id === 'string' && PLUGIN_ID_RE.test(id);
}

/** 把 id 解析成 plugins 内的绝对目录；非法 id 一律 null（结构性拒绝穿越） */
function pluginDir(userDataDir, id) {
  if (!isValidPluginId(id)) return null;
  const root = path.resolve(pluginsRoot(userDataDir));
  const dir = path.resolve(root, id);
  if (!dir.startsWith(root + path.sep)) return null;
  return dir;
}

/**
 * manifest 形状门（来自磁盘的 JSON 原值 ⇒ 归一化 manifest 或拒绝理由）。
 *
 * 与渲染侧 PluginManifest 的关系：这里是**磁盘侧**的收紧版——只认 v1 装机必需的字段，
 * capabilities 一律夹到 data.read，defaultEnabled 概念在磁盘侧不存在（合并时强制 false，
 * 见 src/core/plugin/installed.ts 的 mergeInstalledManifests）。
 *
 * @returns {{ ok: true, manifest: object } | { ok: false, reason: string }}
 */
function validatePluginManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'manifest.json 不是合法的 JSON 对象' };
  }
  const id = raw.id;
  if (typeof id !== 'string' || !PLUGIN_ID_RE.test(id)) {
    return {
      ok: false,
      reason: `manifest.id 不合法（"${String(id)}"）——只允许小写字母、数字与中划线，首字符不能是中划线，最长 64 位`,
    };
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    return { ok: false, reason: 'manifest.name 缺失或不是非空字符串（插件列表要显示它）' };
  }
  if (typeof raw.version !== 'string' || raw.version.trim() === '') {
    return { ok: false, reason: 'manifest.version 缺失或不是非空字符串（用户要看得见装了哪版）' };
  }
  if (typeof raw.entry !== 'string' || !ENTRY_NAME_RE.test(raw.entry) || !ENTRY_EXT_RE.test(raw.entry)) {
    return {
      ok: false,
      reason: `manifest.entry 缺失或不是合法入口文件名（"${String(
        raw.entry,
      )}"）——v1 只支持 .html/.htm/.js/.mjs 之一`,
    };
  }
  if (raw.installVersion !== undefined && typeof raw.installVersion !== 'string') {
    return { ok: false, reason: 'manifest.installVersion 若填写必须是字符串' };
  }
  if (raw.minHostVersion !== undefined && typeof raw.minHostVersion !== 'string') {
    return { ok: false, reason: 'manifest.minHostVersion 若填写必须是字符串' };
  }
  const caps = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  const capabilities = caps.filter((c) => ALLOWED_CAPABILITIES.includes(c));
  return {
    ok: true,
    manifest: {
      id,
      name: raw.name.trim(),
      summary: typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim() : '',
      version: raw.version.trim(),
      entry: raw.entry,
      ...(raw.installVersion ? { installVersion: raw.installVersion } : {}),
      ...(raw.minHostVersion ? { minHostVersion: raw.minHostVersion } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
    },
  };
}

/** 递归计算目录总体积（超出上限即止，避免超大目录统计耗时） */
function dirTotalBytes(dir, cap) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return total;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 读取失败的文件跳过（安装时也不会因它整体失败） */
        }
      }
      if (total > cap) return total;
    }
  }
  return total;
}

/** 递归复制目录（先 rm 目标，保证「整目录覆盖写」无残留） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
    // 符号链接等特殊节点一律跳过（插件产物不需要，也不该带来意外可达路径）
  }
}

/** 源目录不能就是 plugins 里的目标目录（否则「先 rm 再复制」会连源一起删掉） */
function resolveSourceDir(manifestFilePath) {
  if (typeof manifestFilePath !== 'string' || manifestFilePath.trim() === '') return null;
  try {
    return path.resolve(path.dirname(manifestFilePath));
  } catch {
    return null;
  }
}

/**
 * 安装：读 manifest.json ⇒ 校验 ⇒ 整目录覆盖写到 userData/plugins/<id>/。
 *
 * @param userDataDir userData 路径（主进程 app.getPath('userData') 传入，模块不依赖 Electron）
 * @param manifestFilePath 用户在文件选择器里选中的 manifest.json 路径（其所在目录即插件源目录）
 * @returns {{ ok: true, manifest: object, fileCount: number } | { ok: false, reason: string }}
 */
function installPluginFromDirectory(userDataDir, manifestFilePath) {
  const srcDir = resolveSourceDir(manifestFilePath);
  if (!srcDir) return { ok: false, reason: '文件路径无效' };

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestFilePath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `manifest.json 读取或解析失败：${err && err.message ? err.message : String(err)}` };
  }

  const gate = validatePluginManifest(raw);
  if (!gate.ok) return gate;
  const manifest = gate.manifest;

  const root = path.resolve(pluginsRoot(userDataDir));
  const destDir = pluginDir(userDataDir, manifest.id);
  if (!destDir) return { ok: false, reason: '插件 id 不合法（拒绝安装）' };
  if (srcDir === destDir || destDir === root) {
    return { ok: false, reason: '请选择插件**源目录**里的 manifest.json（不能直接重装已安装目录）' };
  }

  // entry 文件必须真实存在于源目录（否则装上就是一个白框架）
  const entryPath = path.resolve(srcDir, manifest.entry);
  if (!entryPath.startsWith(srcDir + path.sep) || !fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    return { ok: false, reason: `manifest.entry 声明的入口文件 "${manifest.entry}" 在所选目录里不存在` };
  }

  const bytes = dirTotalBytes(srcDir, MAX_PLUGIN_TOTAL_BYTES);
  if (bytes > MAX_PLUGIN_TOTAL_BYTES) {
    return {
      ok: false,
      reason: `插件目录体积 ${(bytes / 1024 / 1024).toFixed(1)}MB 超过 v1 上限 5MB——请精简产物后重试`,
    };
  }

  try {
    fs.rmSync(destDir, { recursive: true, force: true });
    copyDir(srcDir, destDir);
  } catch (err) {
    return { ok: false, reason: `写入失败：${err && err.message ? err.message : String(err)}` };
  }

  // 复制后复核：dest 里的 entry 必须可读（防 copy 中途出错留半套）
  const landed = path.join(destDir, manifest.entry);
  if (!fs.existsSync(landed)) {
    return { ok: false, reason: '复制后入口文件缺失（安装未完成，目录已回滚）' };
  }

  let fileCount = 0;
  try {
    const count = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) count(path.join(dir, e.name));
        else fileCount++;
      }
    };
    count(destDir);
  } catch {
    /* 计数失败不影响安装结果 */
  }

  return { ok: true, manifest, fileCount };
}

/**
 * 卸载：删除 userData/plugins/<id>/（幂等——目录本就不在也算成功，让 UI 能走完流程）。
 * KV（plugin.enabled.<id>）由渲染侧清：设置表在 Dexie 里，主进程不碰。
 */
function uninstallPlugin(userDataDir, id) {
  const dir = pluginDir(userDataDir, id);
  if (!dir) return { ok: false, reason: '插件 id 不合法（拒绝卸载）' };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, reason: `删除失败：${err && err.message ? err.message : String(err)}` };
  }
  return { ok: true };
}

/**
 * 启动扫描（登记入口唯一）：读 plugins 下每个子目录的 manifest.json。
 * 坏 manifest / 版本不兼容一律 **fail-open 跳过**（一个坏插件不许拖垮整个插件系统），
 * 跳过原因随 skipped 返回，UI 展示计数而不是静默吞掉。
 */
function scanInstalledPlugins(userDataDir, hostVersion) {
  const root = pluginsRoot(userDataDir);
  const installed = [];
  const skipped = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { ok: true, installed, skipped }; // plugins 目录不存在 = 什么都没装（常态）
  }
  for (const d of dirs) {
    const manifestPath = path.join(root, d.name, 'manifest.json');
    try {
      const stat = fs.statSync(manifestPath);
      if (!stat.isFile()) throw new Error('not a file');
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const gate = validatePluginManifest(raw);
      if (!gate.ok) {
        skipped.push({ dir: d.name, reason: gate.reason });
        continue;
      }
      // 目录名与 manifest.id 必须一致（安装路径天然一致；手拷的目录对不上时，
      // plug://<manifest.id>/… 会 404——装上是死的，不如跳过并说明）
      if (gate.manifest.id !== d.name) {
        skipped.push({
          dir: d.name,
          reason: `manifest.id（${gate.manifest.id}）与目录名（${d.name}）不一致——请以目录名作为 id 重新安装`,
        });
        continue;
      }
      if (gate.manifest.minHostVersion && !isHostAtLeast(hostVersion, gate.manifest.minHostVersion)) {
        skipped.push({
          dir: d.name,
          reason: `需要 ID Plan ${gate.manifest.minHostVersion} 或更高（当前 ${hostVersion}）`,
        });
        continue;
      }
      installed.push(gate.manifest);
    } catch (err) {
      skipped.push({
        dir: d.name,
        reason: `manifest.json 无法读取：${err && err.message ? err.message : String(err)}`,
      });
    }
  }
  return { ok: true, installed, skipped };
}

/**
 * plug:// 专属 MIME 表。
 *
 * ★ `.js/.mjs` 必须是 `text/javascript`——坏 MIME 会让 dynamic import 被 Chromium
 * 严格校验直接拒（实测：回 application/octet-stream 时 "Expected a JavaScript-or-Wasm
 * module script…"）。**未知扩展名一律 octet-stream，绝不回退 text/html**（404 回退 HTML
 * 会让「文件不存在」报得极具迷惑性，探路实测踩过）。
 */
function plugMimeFor(ext) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
  };
  return map[String(ext).toLowerCase()] || 'application/octet-stream';
}

/**
 * plug:// URL ⇒ 磁盘文件路径（协议处理器用）。
 *
 * URL 形态：`plug://<插件id>/<文件名>`（host 段即插件 id，与「落盘目录」一一对应）。
 * 四道防线：id 正则 / normalize 后必须在**该插件自己的目录**内（不只 plugins 根内——
 * 编码的 `..` 干不掉时至少跨不出自家目录）/ 存在且是文件 / 目录根无默认文档（404 不回落）。
 *
 * @returns {{ status: 403 } | { status: 404 } | { status: 200, filePath: string, mime: string }}
 */
function resolvePlugFile(userDataDir, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return { status: 404 };
  }
  let hostname;
  let pathname;
  try {
    hostname = decodeURIComponent(url.hostname);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { status: 404 };
  }
  const ownDir = pluginDir(userDataDir, hostname);
  if (!ownDir) return { status: 403 };
  if (pathname.startsWith('/')) pathname = pathname.slice(1);
  if (pathname === '') return { status: 404 }; // 无 SPA 回退：目录根没有默认文档
  const safePath = path.normalize(path.join(ownDir, pathname));
  if (!safePath.startsWith(ownDir + path.sep)) return { status: 403 };
  try {
    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) return { status: 404 };
  } catch {
    return { status: 404 };
  }
  return { status: 200, filePath: safePath, mime: plugMimeFor(path.extname(safePath)) };
}

module.exports = {
  MAX_PLUGIN_TOTAL_BYTES,
  PLUGIN_ID_RE,
  pluginsRoot,
  isValidPluginId,
  pluginDir,
  validatePluginManifest,
  isHostAtLeast,
  installPluginFromDirectory,
  uninstallPlugin,
  scanInstalledPlugins,
  plugMimeFor,
  resolvePlugFile,
};
