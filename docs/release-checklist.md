# 发布 checklist（0.8.1 / 0.8.2 两轮出包实测固化 · 2026-09-30）

> 每次发版前逐项过。带 ✱ 的是踩过坑后补的（坑记在条目末尾）。

## 1. 代码就绪
- [ ] `npm run build` ✓（**先 build 再全量**——浏览器族依赖 `build-dist`，没构建整批 skip，skip ≠ 通过）
- [ ] `npx vitest run`：**0 failed 且 0 skipped**（1841 例基线）
- [ ] `npm run typecheck:tests`：≤ 66（既有债基线；新增 spec 不许加债）
- [ ] `npx tsc --noEmit -p tsconfig.json` 与 `-p server/tsconfig.json` 双 0
- [ ] ⚠️ **打印（纸面）批次开工前必读**：`// TODO(print-5blocks): 纸面批次开工时必须升级本 helper，否则退化为恒过假绿` —— 这条提醒同时写在 `tests/v07-dline-print-access.spec.tsx` 文件头。纸面文案一经搬进 i18n 消息表，`ungatedClientNameSpots()`（扫中文字面量 `委托方`）与它上面那条 `toContain('委托方')` 前提会**双双变成恒过**：前者找不到字面量返回 `[]`、后者若只改成「锁键名」就丢了「那句话必须渲染在受门控的位置」这层绑定。**两处必须同批升级为「取值再比串」（先断言 zh 值长度 > 2，再断言目标容器的 textContent 含该值）**，并把范围限定在目标容器内（不许放宽到整页匹配）。

## 2. 版本号（✱ 走查 D5 纪律：数字类事实同源同批更新）
- [ ] `version.json` 四段号推进（如 0.8.3.0001）
- [ ] README / README.en.md 徽章 version + tests 数与**本轮实跑一致**
- [ ] `docs/install/windows-install.md` 文件名同步
- [ ] 套餐数 / phase 数等库数字（stage-library version、presets 数）同批更（api-contract / README）

## 3. Windows 桌面包（四步链）
- [ ] `rm -f build-dist/assets/* && npm run build && node scripts/prune-build-dist.mjs`（空目录重建防旧 bundle 混入）
- [ ] `ELECTRON_BUILDER_RCEDIT_PATH=... npx electron-builder --win nsis -c.directories.output=release-v260928`
- [ ] `node scripts/verify-package.cjs` → **总体 ALL PASS**；asar 内 `version.json` 实读 == 本轮版本
- [ ] 产物 `ID Plan-0.8.x-Setup.exe`（builder 用 package.json semver 命名）**复制为** `IDPlan-<四段号>-Setup.exe` 并记 SHA256

## 4. NAS UPK（层替换式产出：在上一代出货带上换两层）

> ✱ 本节标题旧写作「干净重建，✱ 永不 patch 旧层」，**2026-10-13 作废**——那是错口径：
> 紧接着下面两条命令就是 patch，而现行链路**只能**这么做（本机没有 Docker，
> 重建 base 镜像是恢复 CI 产线的事，另行决策）。别再按旧标题找「干净重建」的路。
>
> 机理：拿 `ugnas/upk/rootfs_<arch>/images/` 里那份**上一代实际出货的 tar** 当 base，
> 把**前端整层**换成当轮 `build-dist`、**后端整层**换成当轮 `server/` + `src/` + `templates/`，
> 镜像 tag 保持不变。前端 dist 层 / 后端 server 层各自的 diffID 与 config 的
> `rootfs.diff_ids` 由脚本同步重写（不同步 = NAS 拒载）。
>
> ✱ **不需要 docker，也不需要外网**：`ugcli.exe` 在**仓库外**（`../tools/ugcli.exe`），
> patch / 校验脚本是纯 Python，全程本机离线可跑。**「本机没有 Docker」不是阻塞理由**——
> 这一点在 2026-10-13 出 1.0.0.0008 时被实测推翻（此前误以为必须去 NAS 机器跑 `ugnas/scripts/pack.sh`）。
>
> 本机装机验证仍缺（无 NAS 真机）⇒ 产物级认证到此为止，交付说明须如实写「未做真机安装」。

- [ ] **0. 建回滚点（必须在 patch 之前做）**：`rootfs_<arch>/images/*.tar` 与 `ugnas/cache/`
      **都在 `.gitignore` 内**（`.gitignore:21` build_dir / `:23` `ugnas/upk/rootfs_*/images/*.tar` / `:24` `ugnas/cache/`），
      而 patch 是**原地覆盖** ⇒ `git checkout` **找不回**。先把它们复制到**仓库外**
      （如 `qa-scratch/nas-backup-<YYYYMMDD>/`），并**逐件记下字节数 + sha256**。
      ✱ 为什么有这一条：2026-10-13 出 1.0.0.0008 时，回滚点**完全靠这个仓库外备份才有**——
      §7「回滚点」那句只覆盖 `release-*/` 里的双包，**覆盖不到 NAS 那两个 tar**。
- [ ] **base 怎么选**：用 `rootfs_<arch>/images/` 里那份**上一代实际出货的 tar**，
      **不要**去 `ugnas/cache/` 里挑候选（那里躺着几份更早的中间候选，离「上次真出货」更远）。
      本轮把这条口径钉死过一次：`images/` 里两个 tar 与 `release-v260928/amd64_com.chengcheng.idplan_0.8.4.0001.upk`
      **包内的两个 tar 逐字节相同**（前端 sha256 `b1ed4f29…` / 后端 `39769019…`）。
- [ ] `python scripts/patch_oci_tar.py <上一代出货的前端tar> rootfs_amd64/images/idplan-amd64-upk.tar build-dist`
- [ ] `python scripts/patch_backend_tar.py <上一代出货的后端tar> rootfs_amd64/images/idplan-backend-amd64-upk.tar server`
- [ ] `python scripts/verify_chain.py` 双 tar 全绿
- [ ] 双子 `project.yaml` version 对齐（ugcli 校验会抓 `${VAR}` 未在 parameters 声明——✱ ugcli **不认** `${VAR:-}` 形式）
- [ ] `cd ugnas/upk && ../../../tools/ugcli.exe check && ../../../tools/ugcli.exe pack --arch amd64 --build <n>`
      —— ✱ `<n>` **必须等于同批桌面版四段号的第 4 段**（桌面发 `1.0.0.0008` ⇒ `--build 8`），
      **不是「同 x.y.z 内自增」**。两条理由：
      ① UGOS 按版本号判升降级——UPK 发 `1.0.0.0001` 会被已装桌面 `1.0.0.0008` 的机器当成降级；
      ② 历史上 UPK 四段号**一直**等于同批桌面版四段号：0.8.0.0010 / 0.8.1.0001 / 0.8.2.0001 /
      0.8.2.0002 / 0.8.4.0001 无一例外（0.8.0.0010 正是为对齐桌面的 0010，没有「新 x.y.z 从 1 起」）。
      —— 这条留档的直接原因：2026-10-13 出 1.0.0.0008 时差点按「从 1 起」发成 0001。
- [ ] 解包验：config.json 实读版本 / .check-app MD5 / 后端层三棵树 / **新版本特征串判别力（旧包全 0 命中）**
- [ ] 交付副本入 `release-v<本批号>/`（如本批 `release-v1000008/`，该目录 gitignored 不入库）记 SHA256

## 5. 发布
- [ ] commit + push master
- [ ] `git tag -a v<四段号>` + push tag
- [ ] GitHub Release（notes：变更表 / 双包 SHA256 / SmartScreen 提示 / 许可证）
- [ ] 上传双包——**✱ curl 不要加 `--retry`**：GitHub 上传响应偶发解析失败显示 "Validation Failed"，但 asset 实已 uploaded；传完以 `GET .../releases/<tag>` 的 assets 列表实态为准，别被 response 骗而重复传（同名二次传才是真 422）

## 6. arm64 UPK（当前：无验证环境，显式排队）
路线已定（0.8.4 决策）：CI 产线 `upk-images.yml` 本就支持 `linux/arm64` 双构建，缺的只是触发与打包。三步（需要有权触发 CI 的人操作）：
1. GitHub 网页 → Actions → **upk-images** → Run workflow（ref=master，version=当前镜像 tag，如 0.3.0）——PAT 通常无 Actions 写权限（dispatch API 会 403），**网页端点不需要**
2. 下载 artifact 的 `*-arm64-upk.tar`（前端+后端）到 `ugnas/upk/rootfs_arm64/images/`
3. 复用第 4 节同链：patch_oci_tar + patch_backend_tar → verify_chain → `ugcli pack --arch arm64 --build <n>`（**`<n>` 同第 4 节规则：等于同批桌面版四段号的第 4 段，别照抄 `1`**）→ 解包验
- **纪律**：无 arm64 真机验收的包不得发 Release（不做无验证发布）；README / 安装文档已明示 arm64 走 Docker compose 替代（ghcr 镜像多架构，pull 自动选层）

## 7. 收尾
- [ ] `.workbuddy/memory/YYYY-MM-DD.md` 归档（changelog + 踩坑）
- [ ] 更新 `docs/roadmap.md` 已发布表
- [ ] 回滚点：上一版双包保留在 `release-v260928/`（SHA 记 notes）

---

## 踩坑汇编（两轮实测）

| 坑 | 现象 | 解法 |
|---|---|---|
| `patch_backend_tar` 漏新文件 | 后端层缺新模块 | 脚本按 git tracked 推导；新增 `.ts` 自动入层，`.tsx` 按白名单不入（后端不需要） |
| ugcli `${VAR:-}` | `project validation failed: variables not set` | 裸 `${VAR}` + project.yaml parameters 声明 |
| 同名 asset 重复传 | 真 422「Validation Failed」 | 先 GET assets 实态再决定传不传 |
| curl `--retry` 上传 | 假「Validation Failed」 | 别加 retry；以实态为准 |
| python 改写 CRLF 文件 | LF 混入行被统一成 CRLF，spec 的 `indexOf('\n')` 假红 | 源码级锚点用 `\s*` 正则（换行无关） |
| 注释写 z 数字 | toast spec 正则误抓，层级断言假红 | 注释语义化，数字只出现在类名里 |
| 空库加引导层 | 全浏览器族点击被遮罩拦（timeout 海） | 探针 flag + 身份 helper 尾部加「消卡」步骤，同轮适配 |
