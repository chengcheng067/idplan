#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ID Plan · OCI/Docker-save 前端镜像 tar 就地修补（完整版）
========================================================
把 <repo>/changxia/build-dist/（新蓝P logo + 收紧UI + favicon）写进前端镜像的
dist 层（usr/share/nginx/html/），并同步更新：
  - 经典 docker-save manifest.json（ugcli 实际读取的）
  - OCI index.json + OCI manifest blob（给不读 classic 的导入方看）
  - 清掉 manifest 图不可达的历史层（层尸体）—— 内含旧一代 bundle 文件名，
    留着会让后续 grep 排查把「历史残留」误判成「patch 没生效」

输出为同格式的「经典 docker save」tar（manifest.json 指向 blobs/sha256/<hash>）。

用法：python scripts/patch_oci_tar.py <in.tar> <out.tar> <build_dist_dir>
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


def pax_info(name, size, mode=0o644, dirtype=False):
    info = tarfile.TarInfo(name)
    info.mode = mode
    if dirtype:
        info.type = tarfile.DIRTYPE
        info.size = 0
    else:
        info.size = size
    return info


def build_dist_tar(build_dist: str) -> bytes:
    """build_dist/ -> 未压缩 tar，条目根为 usr/share/nginx/html。
    用 os.walk 遍历，相对路径直接拼前缀，避免双层嵌套。
    返回未压缩字节：diffID = sha256(未压缩 tar)，层 blob = gzip(未压缩 tar)。"""
    buf = io.BytesIO()
    root = "usr/share/nginx/html"
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tf:
        tf.addfile(pax_info(root, 0, 0o755, True), io.BytesIO(b""))
        for dirpath, dirnames, filenames in os.walk(build_dist):
            # 相对 build_dist 的目录路径
            rel_dir = os.path.relpath(dirpath, build_dist).replace("\\", "/")
            if rel_dir == ".":
                arc_dir = root
            else:
                arc_dir = f"{root}/{rel_dir}"
            if arc_dir != root:
                tf.addfile(pax_info(arc_dir, 0, 0o755, True), io.BytesIO(b""))
            for fn in sorted(filenames):
                fp = os.path.join(dirpath, fn)
                rel = os.path.relpath(fp, build_dist).replace("\\", "/")
                arc = f"{root}/{rel}"
                data = open(fp, "rb").read()
                tf.addfile(pax_info(arc, len(data), 0o644, False), io.BytesIO(data))
    return buf.getvalue()


def main():
    in_tar = sys.argv[1]
    out_tar = sys.argv[2]
    build_dist = os.path.abspath(sys.argv[3])
    if not os.path.isdir(build_dist):
        print("!! build-dist 不存在:", build_dist)
        sys.exit(1)

    with tarfile.open(in_tar, "r") as t:
        # ---- classic manifest ----
        classic = json.loads(t.extractfile("manifest.json").read())
        # ---- OCI index + manifest blob ----
        index = json.loads(t.extractfile("index.json").read())
        oci_manifest_digest = index["manifests"][0]["digest"].split(":")[-1]
        oci_manifest = json.loads(t.extractfile(f"blobs/sha256/{oci_manifest_digest}").read())

        # 读取所有 blob（内存）
        blobs = {}
        for n in t.getnames():
            if n.startswith("blobs/sha256/"):
                blobs[n.split("/")[-1]] = t.extractfile(n).read()

    # ---- 定位 dist 层（classic 与 OCI 的 Layers 顺序应一致）----
    def get_layer(layer_ref):
        """layer_ref 可为 'blobs/sha256/xxx' 或 'sha256:xxx'"""
        d = layer_ref.split("/")[-1].replace("sha256:", "sha256/")
        return blobs[d]

    dist_layer_index = None
    for i, ref in enumerate(classic[0]["Layers"]):
        try:
            raw = gzip.decompress(get_layer(ref))
        except Exception:
            continue
        lt = tarfile.open(fileobj=io.BytesIO(raw), mode="r:")
        names = lt.getnames()
        # 命中「运行时 dist 层」：含 usr/share/nginx/html/index.html + assets/ 目录，
        # 且不含 nginx 默认的 50x.html（那是 base nginx 层 = 61ca...，含 690 个文件）。
        #
        # ⚠️ 重要：镜像里可能存在多个「含 assets/ 但不在 Layers 列表中」的历史孤儿 blob。
        # 例如某次旧构建残留的层 9786f...（10 files，内容是过期的 index-*.js），
        # 它仍躺在 blobs/ 里但已不被任何 manifest 引用、不会被装载。
        # 若误把它当成 dist 层替换，新代码就不会生效，表现为「装完界面没变化」。
        #
        # 本循环遍历的是 classic[0]["Layers"]（实际生效的层顺序），孤儿 blob 不在其中，
        # 因此天然被跳过 —— 这是正确行为。**不要改成遍历 blobs 字典**，否则会误中孤儿层。
        # Layers 中只应有一个运行时 dist 层，故命中后 break。
        if (
            "usr/share/nginx/html/index.html" in names
            and any(n.startswith("usr/share/nginx/html/assets/") for n in names)
            and "usr/share/nginx/html/50x.html" not in names
        ):
            dist_layer_index = i
            old_layer_ref = ref
            print(">> 命中运行时 dist 层:", ref, "文件数", len(names))
            break
    if dist_layer_index is None:
        print("!! 未找到运行时 dist 层")
        sys.exit(1)
    old_digest_sha = old_layer_ref.split("/")[-1]
    print(">> 旧 dist 层:", old_digest_sha[:16], "index", dist_layer_index)

    # ---- 重建该层 ----
    # 关键：diffID = sha256(未压缩层 tar)。docker load 会逐层解压重算 diffID，
    # 与 config blob 的 rootfs.diff_ids 比对，不一致直接拒载（NAS 安装失败的根因）。
    new_tar = build_dist_tar(build_dist)
    new_diff_id = sha256(new_tar)
    new_gz = gzip.compress(new_tar, mtime=0)
    new_sha = sha256(new_gz)
    new_blob_name = f"blobs/sha256/{new_sha}"
    blobs[new_sha] = new_gz
    print(">> 新 dist 层 digest sha256:", new_sha[:16], "size", len(new_gz))
    print(">> 新 dist 层 diffID:", "sha256:" + new_diff_id[:16])

    # ---- 更新 classic manifest.json ----
    classic[0]["Layers"][dist_layer_index] = new_blob_name

    # ---- 同步更新 config blob 的 rootfs.diff_ids ----
    cfg_path = classic[0]["Config"]  # "blobs/sha256/<old>"
    cfg_sha_old = cfg_path.split("/")[-1]
    cfg = json.loads(blobs[cfg_sha_old])
    assert len(cfg["rootfs"]["diff_ids"]) == len(classic[0]["Layers"]), "diff_ids 与层数不一致"
    cfg["rootfs"]["diff_ids"][dist_layer_index] = "sha256:" + new_diff_id
    cfg_bytes = json.dumps(cfg, separators=(",", ":")).encode()
    cfg_sha = sha256(cfg_bytes)
    blobs[cfg_sha] = cfg_bytes
    blobs.pop(cfg_sha_old, None)  # 旧 config blob 移除（内容寻址，名字必须=内容哈希）
    classic[0]["Config"] = f"blobs/sha256/{cfg_sha}"
    print(">> 新 config blob:", cfg_sha[:16], "(diff_ids 已同步)")

    # ---- 更新 OCI manifest blob 的对应层 ----
    # OCI layer 与 classic 顺序一致（都是同一构建的层列表）
    oci_manifest["layers"][dist_layer_index]["digest"] = "sha256:" + new_sha
    oci_manifest["layers"][dist_layer_index]["size"] = len(new_gz)
    oci_manifest["config"]["digest"] = "sha256:" + cfg_sha
    oci_manifest["config"]["size"] = len(cfg_bytes)
    oci_manifest_bytes = json.dumps(oci_manifest, separators=(",", ":")).encode()
    oci_manifest_new_sha = sha256(oci_manifest_bytes)
    blobs[oci_manifest_new_sha] = oci_manifest_bytes
    blobs.pop(oci_manifest_digest.split("/")[-1] if "/" in oci_manifest_digest else oci_manifest_digest, None)
    index["manifests"][0]["digest"] = "sha256:" + oci_manifest_new_sha
    index["manifests"][0]["size"] = len(oci_manifest_bytes)
    index_bytes = json.dumps(index, separators=(",", ":")).encode()

    # ---- 清掉「manifest 图不可达」的历史 blob（层尸体）----
    # 为什么要清：输入镜像里存在**层尸体** —— 含 usr/share/nginx/html/assets/ 却不被
    # 任何 manifest 引用的层。它们有两类来源：(1) 本轮被我们替换掉的旧 dist 层；
    # (2) **从输入 tar 继承来的**更早一代残留（例如 9786f5f3…，10 个成员）。
    # 它们永远不会被装载（功能无害），但里面装着**旧一代 bundle 文件名**
    # （如 index-BgvOjm_I.js / index-1t3p9oM5.js）。留着的话，将来任何人 grep 这个
    # 交付包排查「有没有旧资产管理残留」都会命中它们，从而误判「patch 没生效」。
    # —— 这类「历史残留带偏判断」本晚已反复踩过（verify-package 假绿、qa-scratch 死文件、
    #    build-dist 老哈希），故不把会制造此类误判的包交出去。
    #
    # 判据必须用**从 manifest 图的可达性**，不能只看「不在 manifest.Layers 里」：
    # index.json 引用的 OCI manifest blob 与 config blob 同样不在 Layers 里，却是
    # manifest 图的必需节点，若按「不在 Layers」去删会把它们一起误删、直接损坏包
    # （上一轮的统计口径就犯过这个假阳性）。此处按可达性算保留集，天然避开。
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
        print("!! 异常：被替换的旧 dist 层仍在保留集里（应已不可达）")
    if not keep <= set(blobs):
        print("!! 异常：保留集里有 blob 不在输出 dict 中")

    # ---- 写回 ----
    def w(name, data):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = 0o644
        out.addfile(info, io.BytesIO(data))

    with tarfile.open(out_tar, "w", format=tarfile.PAX_FORMAT) as out:
        w("manifest.json", json.dumps(classic, separators=(",", ":")).encode())
        w("index.json", index_bytes)
        w("oci-layout", b'{"imageLayoutVersion":"1.0.0"}')
        # blobs 里此时只剩：新 dist 层 / 新 config / 新 OCI manifest，以及其它仍可从
        # manifest 图到达的既有层（base OS / nginx / 字体等）。不可达的层尸体已在上方清掉。
        for sha, data in blobs.items():
            w(f"blobs/sha256/{sha}", data)

    print(">> 输出:", out_tar, os.path.getsize(out_tar), "bytes")


if __name__ == "__main__":
    main()
