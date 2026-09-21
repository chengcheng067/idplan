#!/usr/bin/env bash
# =====================================================================
# ID Plan · UPK 版本一致性预检（共享片段）
#
# 背景：绿联 UPK 的版本号散落在两处，必须对得上，否则会「文件名是新版本、
#       内容却是旧镜像」，且用户完全看不出来：
#   ① ugnas/upk/project.yaml 的 `version:`  → 决定产出 UPK 文件名的 x.y.z
#   ② ugnas/upk/rootfs_common/docker-compose.yaml 各服务的 `image: name:tag`
#      → 决定容器实际拉起哪个镜像；tag 必须与 tar 内 tag 完全一致
#      （ugnas/README.md 明文要求；upk-images.yml 工作流默认 0.3.0）。
#
# 本片段只定义函数，不自动执行，供 pack-amd64.sh / pack.sh source 后调用。
# 不引入任何外部依赖（只用 grep/sed/tr），可在 Windows Git Bash 直接跑。
#
# 用法：
#   source "${SCRIPT_DIR}/check_upk_versions.sh"
#   check_upk_versions <project.yaml 绝对/相对路径> <compose1> [<compose2> ...]
# 任一 compose 的 image tag 与 project.yaml 的 version 不一致 → 立即 exit 1。
# （compose 文件不存在则跳过该文件，不报错；project.yaml 不存在则硬失败。）
# =====================================================================
set -euo pipefail

check_upk_versions() {
  local project_yaml="$1"; shift

  if [ ! -f "$project_yaml" ]; then
    echo "✗ UPK 版本预检：找不到 project.yaml：$project_yaml" >&2
    exit 1
  fi

  # 解析 `version: x.y.z`：仅匹配行首（可有缩进）后紧跟 version: 的行，
  # 避开 spec_version / depend_*_version 等；取第一个命中。
  local version
  version="$(grep -E '^[[:space:]]*version:[[:space:]]' "$project_yaml" \
            | head -n1 \
            | sed -E 's/^[[:space:]]*version:[[:space:]]*//' \
            | sed -E 's/[[:space:]]+$//' \
            | tr -d '"'"'"'\r')"
  if [ -z "$version" ]; then
    echo "✗ UPK 版本预检：无法从 $project_yaml 解析出 version" >&2
    exit 1
  fi

  local compose mismatched=0 line tag stripped
  for compose in "$@"; do
    if [ ! -f "$compose" ]; then
      echo "  (跳过：compose 不存在，不纳入比对：$compose)"
      continue
    fi
    while IFS= read -r line; do
      # 跳过整行注释（去掉前导空白后以 # 开头）
      stripped="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//')"
      case "$stripped" in
        '#'*) continue ;;
      esac
      case "$line" in
        *image:*)
          # 取 image: 之后的内容，再掐掉最后一个冒号前的部分得到 tag
          tag="$(printf '%s' "$line" \
                | sed -E 's/.*image:[[:space:]]*//' \
                | sed -E 's/[[:space:]]+$//' \
                | sed -E 's#^.*:##' \
                | tr -d '"'"'"'\r')"
          # 跳过无 tag 的写法（如 ${VAR} 注入或未带版本）
          case "$tag" in
            ''|*'${'*|*'{{'*) continue ;;
          esac
          if [ "$tag" != "$version" ]; then
            mismatched=1
            echo "  ✗ 版本不一致 —— compose: $compose" >&2
            echo "      读到镜像 tag : ${tag}" >&2
            echo "      期望（project.yaml version）: ${version}" >&2
            echo "      → 请修改 ${compose} 中 image: 的 tag，使其等于 ${version}" >&2
          fi
          ;;
      esac
    done < "$compose"
  done

  if [ "$mismatched" -ne 0 ]; then
    echo "" >&2
    echo "✗ UPK 版本预检失败：镜像 tag 与 project.yaml version 不一致。" >&2
    echo "  若继续打包，产出的 .upk 文件名会按 ${version} 生成，" >&2
    echo "  但容器实际拉起的是 ${version} 之外的旧镜像——用户看不出差异却装了旧内容。" >&2
    echo "  请先统一版本（改 compose 的 image tag，或改 project.yaml 的 version）再打包。" >&2
    exit 1
  fi

  echo "✓ UPK 版本预检通过：project.yaml version=${version}，各 compose 镜像 tag 一致"
}
