#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ID Plan · 后端镜像 tar 就地修补（完整版）
========================================
把 <repo>/changxia/server/routes/projects.routes.ts（含新增 DELETE /api/projects/:id）
写进后端镜像的 app/server 层（层 7，含 routes/*.ts 的 layer），并同步更新：
  - 经典 docker-save manifest.json（ugcli 实际读取的）
  - OCI index.json + OCI manifest blob
  - 清掉 manifest 图不可达的历史层（层尸体）—— 内含旧 server 源码与 changxia.db 开发库

输出为同格式的「经典 docker save」tar（manifest.json 指向 blobs/sha256/<hash>）。
backend 容器用 `tsx server/index.ts` 跑 TS 源码，因此只需替换 .ts 源文件即可生效，
无需编译。

用法：python scripts/patch_backend_tar.py <in.tar> <out.tar> <server_dir>
其中 server_dir 是 <repo>/changxia/server，内含 routes/projects.routes.ts。

★ 入层文件受 LAYER_ALLOWED_EXT 白名单约束：只打 .ts/.sql/.json，开发库与日志等
  运行时产物自动排除（详见该常量上方的说明）。因此 server_dir 可以直接传 server/，
  不需要先手工做一份剔除 .db 的 staging 副本。
"""
import gzip
import hashlib
import io
import json
import os
import sys
import tarfile


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ★ 允许进镜像的文件扩展名（**白名单**，不是黑名单）。
#
# 为什么必须有这道过滤：
#   server/ 下同时躺着**源码**和**运行时产物**。本机跑 dev server 时会在该目录
#   生成 SQLite 开发库（changxia.db 以及 -wal / -shm），它们被 .gitignore 忽略、
#   但**确实在磁盘上**。本函数原先对 filenames 不做任何过滤、全量打入，于是
#   开发库会被原样塞进交付物 —— 交付物多出几 MB，并把本机数据一起带出去。
#   2026-09-14 那次打包是靠「临时做一份剔除 .db 的 staging 副本」手工绕过的；
#   这类「靠人记得」的守卫迟早会失效，所以在代码里固化。
#
# 为什么不写黑名单（"排除 .db / .sqlite / ..."）：
#   黑名单只能挡住已知名字，将来多出 .db3 / .sqlite-journal / .log / .bak 之类
#   照样会漏。白名单只放行**确实需要进镜像**的源码与 schema，未列出的扩展名
#   默认被拒（fail-closed）。若将来后端确实需要新类型文件，请在此显式加一项 ——
#   这道摩擦是有意的。
#
# 当前值来自实测：现网生效层内的 13 个文件恰好是 .ts ×11 / .sql ×1 / .json ×1。
LAYER_ALLOWED_EXT = {".ts", ".sql", ".json"}


def _add_tree(tf, src_dir: str, arc_root: str, skipped: list) -> int:
    """把 src_dir 下的白名单文件写进 tar 的 arc_root 子树，返回入层文件数。"""
    included = 0
    for dirpath, dirnames, filenames in os.walk(src_dir):
        rel_dir = os.path.relpath(dirpath, src_dir).replace("\\", "/")
        arc_dir = arc_root if rel_dir == "." else f"{arc_root}/{rel_dir}"
        if arc_dir != arc_root:
            tf.addfile(pax_info(arc_dir, 0, 0o755, True), io.BytesIO(b""))
        for fn in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, fn), src_dir).replace("\\", "/")
            ext = os.path.splitext(fn)[1].lower()
            if ext not in LAYER_ALLOWED_EXT:
                skipped.append(f"{arc_root}/{rel}")
                continue
            data = open(os.path.join(dirpath, fn), "rb").read()
            tf.addfile(pax_info(f"{arc_root}/{rel}", len(data), 0o644, False), io.BytesIO(data))
            included += 1
    return included


def backend_layer_tar(server_dir: str, src_dir: str, templates_dir: str) -> bytes:
    """后端镜像源码层：**app/server + app/src + app/templates 三棵树打进同一层**。

    为什么必须带 src/（2026-09-29 线上事故的修复）：server/ 自 b376a85
    （旅游行业）起大量 import ../../src/...（共享核心 payload.apply /
    enums / entities / stage-library / lib/date ...，共 30+ 处）。tsx 不打包、
    按 import 逐文件解析——镜像里缺 app/src ⇒ 容器启动即
    ERR_MODULE_NOT_FOUND: /app/src/lib/date（用户 0.8.0.0010 UPK 实机复现，
    日志见 Downloads/idplan-backend.txt）。Dockerfile.backend 同步补了
    COPY src/，此函数是产物 tar 侧的同一修复（两处必须同时改，否则
    docker build 对、UPK 补丁错，或反之）。

    为什么 src 可以全量进层：白名单只放行 .ts/.sql/.json——src 下的 .tsx
    React 组件、.css、图片等天然被挡；实测入层 97 文件 / 866KB，可忽略。

    保留层内目录结构；其余扩展名（开发库、日志等运行时产物）一律排除。
    返回未压缩字节：diffID = sha256(未压缩 tar)，层 blob = gzip(未压缩 tar)。"""
    buf = io.BytesIO()
    skipped: list = []
    included = 0
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tf:
        tf.addfile(pax_info("app/server", 0, 0o755, True), io.BytesIO(b""))
        included += _add_tree(tf, server_dir, "app/server", skipped)
        tf.addfile(pax_info("app/src", 0, 0o755, True), io.BytesIO(b""))
        included += _add_tree(tf, src_dir, "app/src", skipped)
        tf.addfile(pax_info("app/templates", 0, 0o755, True), io.BytesIO(b""))
        included += _add_tree(tf, templates_dir, "app/templates", skipped)
    print(f">> 打包入层 {included} 个源码/配置文件（白名单 {sorted(LAYER_ALLOWED_EXT)}）")
    if skipped:
        print(f">> 已按白名单排除 {len(skipped)} 个（运行时产物，不进镜像）:")
        for s in skipped:
            print("     -", s)
    return buf.getvalue()


def pax_info(name, size, mode=0o644, dirtype=False):
    info = tarfile.TarInfo(name)
    info.mode = mode
    if dirtype:
        info.type = tarfile.DIRTYPE
        info.size = 0
    else:
        info.size = size
    return info


def main():
    in_tar = sys.argv[1]
    out_tar = sys.argv[2]
    server_dir = os.path.abspath(sys.argv[3])
    if not os.path.isdir(server_dir):
        print("!! server 目录不存在:", server_dir)
        sys.exit(1)
    # src 与 server 同级（<repo>/src）——server/ 的共享核心依赖全在那边
    src_dir = os.path.join(os.path.dirname(server_dir), "src")
    if not os.path.isdir(src_dir):
        print("!! src 目录不存在:", src_dir, "（server routes 依赖 ../../src，缺它容器必崩）")
        sys.exit(1)
    # templates/ 与 server/src 同级：src/core/template/*.ts 以
    # ../../../templates/*.json 静态 import 阶段库与九段默认骨架
    # （nine-stages.ts / stage-library.ts）——容器缺它同样是启动即崩。
    templates_dir = os.path.join(os.path.dirname(server_dir), "templates")
    if not os.path.isdir(templates_dir):
        print("!! templates 目录不存在:", templates_dir, "（stage-library/nine-stages 依赖，缺它容器必崩）")
        sys.exit(1)

    with tarfile.open(in_tar, "r") as t:
        classic = json.loads(t.extractfile("manifest.json").read())
        index = json.loads(t.extractfile("index.json").read())
        oci_manifest_digest = index["manifests"][0]["digest"].split(":")[-1]
        oci_manifest = json.loads(t.extractfile(f"blobs/sha256/{oci_manifest_digest}").read())
        blobs = {}
        for n in t.getnames():
            if n.startswith("blobs/sha256/"):
                blobs[n.split("/")[-1]] = t.extractfile(n).read()

    def get_layer(ref):
        d = ref.split("/")[-1].replace("sha256:", "sha256/")
        return blobs[d]

    # 定位 server 层（含 app/server/routes/projects.routes.ts）
    server_layer_index = None
    for i, ref in enumerate(classic[0]["Layers"]):
        try:
            raw = gzip.decompress(get_layer(ref))
        except Exception:
            continue
        lt = tarfile.open(fileobj=io.BytesIO(raw), mode="r:")
        names = lt.getnames()
        if "app/server/routes/projects.routes.ts" in names:
            server_layer_index = i
            print(">> 命中 server 层:", ref, "files=", len(names))
            break
    if server_layer_index is None:
        print("!! 未找到 server 层")
        sys.exit(1)
    old_digest_sha = classic[0]["Layers"][server_layer_index].split("/")[-1]
    print(">> 旧 server 层:", old_digest_sha[:16], "index", server_layer_index)

    # 重建该层：用本地 server/ + src/ 整体覆盖（后端跑 tsx，直接替换所有 .ts 源；
    # src/ 是 2026-09-29 事故修复——缺 app/src 则容器 ERR_MODULE_NOT_FOUND）
    # 关键：diffID = sha256(未压缩层 tar)。docker load 会逐层解压重算 diffID，
    # 与 config blob 的 rootfs.diff_ids 比对，不一致直接拒载（NAS 安装失败的根因）。
    new_tar = backend_layer_tar(server_dir, src_dir, templates_dir)
    new_diff_id = sha256(new_tar)
    new_gz = gzip.compress(new_tar, mtime=0)
    new_sha = sha256(new_gz)
    blobs[new_sha] = new_gz
    print(">> 新 server 层 digest sha256:", new_sha[:16], "size", len(new_gz))
    print(">> 新 server 层 diffID:", "sha256:" + new_diff_id[:16])

    # 更新 classic manifest
    classic[0]["Layers"][server_layer_index] = f"blobs/sha256/{new_sha}"

    # 同步更新 config blob 的 rootfs.diff_ids
    cfg_path = classic[0]["Config"]
    cfg_sha_old = cfg_path.split("/")[-1]
    cfg = json.loads(blobs[cfg_sha_old])
    assert len(cfg["rootfs"]["diff_ids"]) == len(classic[0]["Layers"]), "diff_ids 与层数不一致"
    cfg["rootfs"]["diff_ids"][server_layer_index] = "sha256:" + new_diff_id
    cfg_bytes = json.dumps(cfg, separators=(",", ":")).encode()
    cfg_sha = sha256(cfg_bytes)
    blobs[cfg_sha] = cfg_bytes
    blobs.pop(cfg_sha_old, None)
    classic[0]["Config"] = f"blobs/sha256/{cfg_sha}"
    print(">> 新 config blob:", cfg_sha[:16], "(diff_ids 已同步)")

    # 更新 OCI manifest blob 对应层
    oci_manifest["layers"][server_layer_index]["digest"] = "sha256:" + new_sha
    oci_manifest["layers"][server_layer_index]["size"] = len(new_gz)
    oci_manifest["config"]["digest"] = "sha256:" + cfg_sha
    oci_manifest["config"]["size"] = len(cfg_bytes)
    oci_manifest_bytes = json.dumps(oci_manifest, separators=(",", ":")).encode()
    oci_manifest_new_sha = sha256(oci_manifest_bytes)
    blobs[oci_manifest_new_sha] = oci_manifest_bytes
    blobs.pop(oci_manifest_digest, None)
    index["manifests"][0]["digest"] = "sha256:" + oci_manifest_new_sha
    index["manifests"][0]["size"] = len(oci_manifest_bytes)
    index_bytes = json.dumps(index, separators=(",", ":")).encode()

    # ---- 清掉「manifest 图不可达」的历史 blob（层尸体）----
    # 为什么要清：输入镜像里存在**层尸体** —— 不被任何 manifest 引用、永远不会被装载的
    # 历史 server 层。实测本 tar 有 4 个：3 个继承自输入（其中 2 个是更早一代的 server 层，
    # 里面装着 app/server/changxia.db 以及 -wal / -shm 开发库文件），加上本轮被我们替换掉
    # 的旧 server 层。它们功能上无害（不可达 = 不装载），但：
    #   1) 交付物里躺着**开发数据库文件**，任何人 grep 都会当成数据泄漏；
    #   2) 里面是旧一代 server 源码（不含 T02 写入通道），会让排查者误判「补丁没生效」。
    # 这正是「历史残留带偏判断」那一类，与 patch_oci_tar.py 用同一条规则、同一理由。
    #
    # 判据必须用**从 manifest 图的可达性**，不能只看「不在 manifest.Layers 里」：
    # index.json 引用的 OCI manifest blob 与 config blob 同样不在 Layers 里，却是
    # manifest 图的必需节点，按「不在 Layers」删会把它们一起误删、直接损坏包。
    keep = set()
    for _entry in classic:                       # 经典 docker-save 图
        keep.add(_entry["Config"].split("/")[-1])
        for _ref in _entry["Layers"]:
            keep.add(_ref.split("/")[-1])
    for _m in index["manifests"]:                # OCI index 图（多镜像也能全保住）
        _m_sha = _m["digest"].split(":")[-1]
        keep.add(_m_sha)
        _raw_m = blobs.get(_m_sha)
        if _raw_m is None:
            continue
        try:
            _m_man = json.loads(_raw_m)
        except Exception:
            continue
        _cfg_ref = (_m_man.get("config") or {}).get("digest")
        if _cfg_ref:
            keep.add(_cfg_ref.split(":")[-1])
        for _lay in _m_man.get("layers", []) or []:
            keep.add(_lay["digest"].split(":")[-1])

    dropped_bytes = 0
    for _sha in [s for s in blobs if s not in keep]:
        _gone = blobs.pop(_sha)
        dropped_bytes += len(_gone)
        print(">> 丢弃不可达 blob（层尸体）:", _sha[:16], "size", len(_gone))
    print(">> 层尸体清理合计", dropped_bytes, "bytes；剩余 blob", len(blobs), "个")
    if old_digest_sha != new_sha and old_digest_sha in keep:
        print("!! 异常：被替换的旧 server 层仍在保留集里（应已不可达）")
    if not keep <= set(blobs):
        print("!! 异常：保留集里有 blob 不在输出 dict 中")

    def w(name, data):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = 0o644
        out.addfile(info, io.BytesIO(data))

    with tarfile.open(out_tar, "w", format=tarfile.PAX_FORMAT) as out:
        w("manifest.json", json.dumps(classic, separators=(",", ":")).encode())
        w("index.json", index_bytes)
        w("oci-layout", b'{"imageLayoutVersion":"1.0.0"}')
        for sha, data in blobs.items():
            w(f"blobs/sha256/{sha}", data)
    print(">> 输出:", out_tar, os.path.getsize(out_tar), "bytes")


if __name__ == "__main__":
    main()
