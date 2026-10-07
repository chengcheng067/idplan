import type { Server } from 'node:http';

/**
 * 真浏览器 spec 的安全 listen（v0.8.6.0002 · harness 修复）。
 *
 * ── 为什么存在 ──
 * 所有真 Chromium spec 的静态服务器都写 `server.listen(0, '127.0.0.1')` 让
 * OS 分配随机端口。OS 的 ephemeral 区间**不保证**避开 Chromium 的不安全
 * 端口黑名单（Windows  excludedportrange 可把 5061 这种低位段也放进动态
 * 分配区间——2026-10-07 实测 `listen(0)` 分到过 5061，F3-01 当场
 * `page.goto: net::ERR_UNSAFE_PORT` 假红）。失败会促使你去查，**flaky 会
 * 训练你忽略红灯**，然后真回归也被一起忽略——必须从 harness 层根治。
 *
 * ── 机制 ──
 * `listen(0)` 拿到端口后**立即校验**是否在 Chromium 黑名单里；命中 ⇒
 * `close()` 后重新 `listen(0)`（OS 会再分一个），最多重试 5 次；5 次全中
 * （概率约 (黑名单覆盖比例)^5，可忽略）才 fail 并说明原因。
 *
 * ── 黑名单口径 ──
 * 逐条列出 Chromium `net/base/port_util.cc` 的 restricted ports（触发
 * `ERR_UNSAFE_PORT` 的那些）。**不是**「按概率挑的常见档」——多覆盖只是
 * 多重听几次，成本为零；漏覆盖才会漏 flaky。Chromium 日后增补端口时同步
 * 本表即可（表上方注释已注明出处）。
 */

/** Chromium 不安全端口黑名单（net/base/port_util.cc 的 restricted ports） */
export const CHROMIUM_UNSAFE_PORTS: ReadonlySet<number> = new Set([
  // 知名服务端口段
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 164, 179, 389, 427, 465,
  // 传统 RPC / 打印 / syslog 段
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995,
  // H.323 / NFS / RADIUS 等
  1719, 1720, 1723, 2049, 3659, 4045, 4190,
  // SIP（2026-10-07 实测撞过的就是这一段）
  5060, 5061,
  // X11 / IRC / ITA 通道段
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 6699,
  // 高位服务端口
  10080, 10621,
]);

/** 该端口是否会被 Chromium 判为不安全（`net::ERR_UNSAFE_PORT`） */
export function isChromiumUnsafePort(port: number): boolean {
  return CHROMIUM_UNSAFE_PORTS.has(port);
}

/** 安全 listen 的产物：与各 spec 原 `startStaticServer` 的返回形状一致 */
export interface SafeStaticServer {
  url: string;
  close(): Promise<void>;
}

/** 连续命中黑名单的最大重听次数（全中才 fail；正常情况一次都不会中） */
const MAX_ATTEMPTS = 5;

function currentPort(server: Server): number {
  const addr = server.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

/**
 * `listen(0)` 一个不撞 Chromium 黑名单的端口，返回 `{ url, close }`。
 *
 * @param server    已 `createServer` 但尚未 listen 的服务器
 * @param entryPath url 的入口路径（`/index.html` 或 SPA 根 `/`，各 spec 口径略异）
 */
export async function listenOnSafePort(
  server: Server,
  entryPath = '/index.html',
): Promise<SafeStaticServer> {
  let lastPort = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(currentPort(server)));
    });
    if (!isChromiumUnsafePort(lastPort)) {
      return {
        url: `http://127.0.0.1:${lastPort}${entryPath}`,
        close: () => closeServer(server),
      };
    }
    // 命中黑名单：关掉重听，让 OS 重新分配（等 close 完成再 listen，同端口复用无竞态）
    await closeServer(server);
  }
  throw new Error(
    `静态服务器连续 ${MAX_ATTEMPTS} 次 listen(0) 都分到 Chromium 不安全端口（末次 ${lastPort}）——` +
      '概率可忽略；请重跑，或检查 CHROMIUM_UNSAFE_PORTS 是否需要按 Chromium 新版增补。',
  );
}
