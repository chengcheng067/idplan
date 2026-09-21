#!/usr/bin/env bash
# =====================================================================
# ID Plan · 绿联 UPK 本地打包脚本（amd64 调试版）
#
# 用途：本机没有 Docker，镜像 tar 由 GitHub Actions 导出并挂在
#       Release upk-images-0.3.0 上。本脚本负责：
#         [1/4] 下载 amd64 的前端 + 后端镜像 tar
#         [2/4] 放进 rootfs_amd64/images/
#         [3/4] ugcli check 校验
#         [4/4] ugcli pack --arch amd64 生成 .upk
#
# 用法：bash scripts/pack-amd64.sh [build号]
#       build 号默认 1，重复打包时必须递增（绿联要求同一版本号下递增）。
# =====================================================================
set -euo pipefail

# UPK 项目根：<repo>/changxia/ugnas/upk/（含 project.yaml + rootfs_*/）
# 用脚本自身绝对位置定位，避免从不同 cwd 调用时相对路径出错。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 共享版本预检（镜像 tag 必须与 project.yaml 的 version 一致，否则响亮失败）
source "${SCRIPT_DIR}/check_upk_versions.sh"
UPK_ROOT="$(cd "${SCRIPT_DIR}/../upk" && pwd)"
cd "$UPK_ROOT"

BUILD="${1:-1}"
# 版本号单一真相源：不再硬编码，改为从 UPK 项目配置 ugnas/upk/project.yaml
# 的 `version:` 字段派生。这样文件名（x.y.z.b）永远与 project.yaml 同步，
# 不会再出现「脚本里写死 0.3.0、project.yaml 已改 0.7.0、产物名是新的、内容却旧」的错位。
VERSION="$(grep -E '^[[:space:]]*version:[[:space:]]' project.yaml \
           | head -n1 | sed -E 's/^[[:space:]]*version:[[:space:]]*//' | tr -d '\r')"
# 预检：compose 里的镜像 tag 必须与解析出的 version 完全一致，否则立即退出，
# 把「静默产出错误包」变成「响亮失败」（当前仓库 state 应为 0.7.0 vs 0.3.0 → 失败）。
check_upk_versions "${UPK_ROOT}/project.yaml" \
                   "${UPK_ROOT}/rootfs_common/docker-compose.yaml"
RELEASE_TAG="upk-images-${VERSION}"
REPO="chengcheng067/id-aura-app"
API="https://api.github.com/repos/${REPO}"
GH_TOKEN="${GH_TOKEN:-}"
# ugcli.exe 所在目录：本脚本位于 <repo>/changxia/ugnas/scripts/，
# 其上级两级是 <repo>/changxia/，再上级是 <repo>。优先 <repo>/tools/ugcli.exe，
# 其次上级 Workspace 根 <repo>/../tools/ugcli.exe。
# SCRIPT_DIR 已在顶部用脚本自身绝对位置计算（与当前 cwd 无关），这里直接复用。
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"        # <repo>/
CHANGXIA_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"        # <repo>/changxia/
if [ -x "${REPO_ROOT}/tools/ugcli.exe" ]; then
  UGCLI="${REPO_ROOT}/tools/ugcli.exe"
elif [ -x "${CHANGXIA_ROOT}/tools/ugcli.exe" ]; then
  UGCLI="${CHANGXIA_ROOT}/tools/ugcli.exe"
else
  UGCLI="${REPO_ROOT}/../tools/ugcli.exe"
fi

# 通过 Release API 动态解析资产 ID，再走 API 通道下载（实测比
# browser_download_url 快几十倍：~1.3MB/s vs ~20KB/s）
asset_url() {
  local name="$1"
  if [ -n "$GH_TOKEN" ]; then
    curl -s --max-time 40 -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "${API}/releases/tags/${RELEASE_TAG}" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const a=(j.assets||[]).find(x=>x.name===process.argv[1]);console.log(a?a.id:"")}catch(e){console.log("")}})' "$name"
  else
    echo ""
  fi
}

echo "==> 版本 ${VERSION}，构建号 ${BUILD}"

# 跨平台取文件字节数：GNU stat(-c%s) / BSD stat(-f%z) / 兜底 wc -c
host_size() {
  local f="$1"
  if stat -c%s "$f" >/dev/null 2>&1; then
    stat -c%s "$f" 2>/dev/null
  elif stat -f%z "$f" >/dev/null 2>&1; then
    stat -f%z "$f" 2>/dev/null
  else
    wc -c < "$f" 2>/dev/null | tr -d ' '
  fi
}

# 经典 docker-save 格式的体积特征（压缩层）：
#   前端 ~20MB、后端 ~170MB。若远超此值说明导出了 OCI 未压缩格式，直接报错。
EXPECTED_MAX_FRONT_MB=60
EXPECTED_MAX_BACK_MB=400

download() {
  local name="$1" dest="$2" max_mb="$3"
  if [ -s "$dest" ]; then
    echo "    已存在，跳过下载：$dest"
  else
    local id url
    id=$(asset_url "$name")
    if [ -n "$id" ]; then
      echo "    走 API 通道下载（资产 ${id}）：${name}"
      url="${API}/releases/assets/${id}"
      AUTH=(-H "Authorization: Bearer ${GH_TOKEN}")
    else
      echo "    走直链下载：${name}"
      url="https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${name}"
      AUTH=()
    fi
    # TLS 在本机不稳定，用断点续传 + 多次重试拉完整
    local expect i cur
    expect=$(curl -sI "${AUTH[@]}" -H "Accept: application/octet-stream" "$url" \
      | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)
    for i in 1 2 3 4 5 6 7 8; do
      if [ -s "$dest" ] && [ -n "$expect" ] && [ "$(host_size "$dest")" -ge "$expect" ]; then
        break
      fi
      echo "    (第 ${i} 次下载/续传)"
      curl -fL -C - --retry 2 --connect-timeout 20 "${AUTH[@]}" \
        -H "Accept: application/octet-stream" -o "$dest" "$url" || true
    done
  fi
  local mb
  mb=$(( $(host_size "$dest") / 1048576 ))
  echo "    大小 ${mb}MB"
  if [ "$mb" -gt "$max_mb" ]; then
    echo "    ✗ ${name} 体积 ${mb}MB 超过预期上限 ${max_mb}MB —— 疑似 OCI 未压缩格式，"
    echo "      请检查 upk-images 工作流是否用的 --output type=docker。"
    exit 1
  fi
  # 下载完整性：空文件或 0 字节直接判失败
  if [ "$(host_size "$dest")" -le 0 ]; then
    echo "    ✗ ${name} 下载失败（空文件）。请检查网络 / GH_TOKEN 权限。"
    exit 1
  fi
}

echo "[1/4] 下载 amd64 镜像 tar"
mkdir -p cache
download "idplan-amd64-upk.tar"          cache/idplan-amd64-upk.tar          "$EXPECTED_MAX_FRONT_MB"
download "idplan-backend-amd64-upk.tar"  cache/idplan-backend-amd64-upk.tar  "$EXPECTED_MAX_BACK_MB"

echo "[2/4] 放入 rootfs_amd64/images/"
mkdir -p rootfs_amd64/images
cp cache/idplan-amd64-upk.tar         rootfs_amd64/images/
cp cache/idplan-backend-amd64-upk.tar rootfs_amd64/images/
ls -lh rootfs_amd64/images/

echo "[3/4] ugcli check"
"$UGCLI" check

echo "[4/4] ugcli pack --arch amd64 --build ${BUILD}"
"$UGCLI" pack --arch amd64 --build "${BUILD}"

echo ""
echo "=== 完成 ==="
find build_dir -name "*.upk" -exec ls -lh {} \;
