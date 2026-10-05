"""Exact model resources: offline planning/checking, explicit copy/download, resumable bytes."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RECEIPT = "models/.resource-verification.json"


class ResourceError(RuntimeError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest() -> dict:
    return json.loads((HERE / "model-resources.json").read_text(encoding="utf-8"))


def target_path(root: Path, entry: dict) -> Path:
    target = (root / entry["path"]).resolve()
    if not target.is_relative_to(root.resolve()) or not entry["path"].startswith("models/"):
        raise ResourceError("UNSAFE_RESOURCE_PATH", "资源清单路径超出模型目录。")
    return target


def fingerprint(path: Path) -> str:
    return hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()


def inspect_resources(root: Path, manifest: dict, full_hash: bool = False, locations: dict | None = None) -> dict:
    receipt_path = root / RECEIPT
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8")).get("files", {})
    except (OSError, ValueError):
        receipt = {}
    files = []
    for entry in manifest["files"]:
        target = locations.get(entry["path"], target_path(root, entry)) if locations else target_path(root, entry)
        state = "missing"
        if target.is_file():
            stat = target.stat()
            recorded = receipt.get(entry["path"], {})
            if stat.st_size != entry["bytes"]:
                state = "size_mismatch"
            elif full_hash:
                state = "verified" if sha256(target) == entry["sha256"] else "hash_mismatch"
            elif recorded.get("sha256") == entry["sha256"] and recorded.get("bytes") == stat.st_size and recorded.get("mtime_ns") == stat.st_mtime_ns and recorded.get("location") == fingerprint(target):
                state = "verified"
            else:
                state = "unverified"
        files.append({"path": entry["path"], "bytes": entry["bytes"], "state": state})
    verified = sum(item["state"] == "verified" for item in files)
    return {"ready": verified == len(files), "verified": verified, "required": len(files),
            "bytes_required": sum(item["bytes"] for item in files), "full_hash": full_hash, "files": files}


def write_receipt(root: Path, manifest: dict) -> None:
    files = {}
    for entry in manifest["files"]:
        target = target_path(root, entry)
        before = target.stat() if target.is_file() else None
        if before is None or before.st_size != entry["bytes"] or sha256(target) != entry["sha256"]:
            raise ResourceError("VERIFY_FAILED", "资源未全部通过完整 SHA-256 校验，不写入准备完成记录。")
        stat = target.stat()
        if (stat.st_size, stat.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            raise ResourceError("VERIFY_FAILED", "校验期间资源发生变化；未写入准备完成记录，请重新校验。")
        files[entry["path"]] = {"sha256": entry["sha256"], "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns, "location": fingerprint(target)}
    destination = root / RECEIPT
    if not destination.resolve().is_relative_to(root.resolve()):
        raise ResourceError("UNSAFE_RESOURCE_PATH", "校验记录路径超出模型目录。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=destination.parent, prefix=".resource-verification-", suffix=".tmp", encoding="utf-8", delete=False) as stream:
        stream.write(json.dumps({"format": 1, "files": files}, indent=2) + "\n")
        temporary = Path(stream.name)
    os.replace(temporary, destination)


class ResourceStore:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def _prepare(self, entry: dict, source_identity: str, restart: bool) -> tuple[Path, Path, bool]:
        target = target_path(self.root, entry)
        if target.exists():
            if target.is_file() and target.stat().st_size == entry["bytes"] and sha256(target) == entry["sha256"]:
                return target, target.with_name(target.name + ".part"), True
            raise ResourceError("DESTINATION_CONFLICT", "目标文件与原版资源不一致；保留原文件，请先将其移到其他位置再执行。")
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + ".part")
        sidecar = target.with_name(target.name + ".part.json")
        if partial.is_symlink() or sidecar.is_symlink():
            raise ResourceError("UNSAFE_RESOURCE_PATH", "中断文件或记录是符号链接；未写入它们。")
        identity = {"sha256": entry["sha256"], "bytes": entry["bytes"], "source": source_identity}
        if restart and (partial.exists() or sidecar.exists()):
            suffix = ".rejected-" + str(time.time_ns())
            for old in (partial, sidecar):
                if old.exists():
                    old.rename(old.with_name(old.name + suffix))
        if partial.exists():
            try:
                stored_identity = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                stored_identity = None
            if stored_identity != identity or partial.stat().st_size > entry["bytes"]:
                raise ResourceError("PARTIAL_CONFLICT", "中断文件的来源或大小不一致；文件已保留。显式 --restart 会归档它并从头重试。")
        elif sidecar.exists():
            raise ResourceError("PARTIAL_CONFLICT", "中断记录存在但数据文件缺失；记录已保留。请显式 --restart 后重试。")
        else:
            sidecar.write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")
            partial.touch(exist_ok=False)
        return target, partial, False

    def _finish(self, entry: dict, target: Path, partial: Path) -> dict:
        if partial.stat().st_size != entry["bytes"]:
            raise ResourceError("TRANSFER_INCOMPLETE", "传输未完成；中断文件已保留，再次显式执行同一操作即可续传。")
        if sha256(partial) != entry["sha256"]:
            raise ResourceError("HASH_MISMATCH", "完整 SHA-256 校验不符；中断文件已保留且未成为可用模型。用 --restart 归档后重试相同版本。")
        # link creates the destination atomically without replacing another file.
        try:
            os.link(partial, target)
        except FileExistsError as error:
            raise ResourceError("DESTINATION_CONFLICT", "校验期间目标文件被创建；没有覆盖它。") from error
        partial.unlink()
        target.with_name(target.name + ".part.json").unlink(missing_ok=True)
        return {"path": entry["path"], "state": "verified", "bytes": entry["bytes"]}

    def copy(self, entry: dict, source: Path, restart: bool = False) -> dict:
        if not source.is_file() or source.stat().st_size != entry["bytes"]:
            raise ResourceError("COPY_SOURCE_MISSING", "指定来源缺少大小一致的原版文件；未改动目标文件。")
        target, partial, skipped = self._prepare(entry, "local:" + fingerprint(source), restart)
        if skipped:
            return {"path": entry["path"], "state": "already_verified"}
        offset = partial.stat().st_size
        with source.open("rb") as incoming, partial.open("ab") as outgoing:
            incoming.seek(offset)
            for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
                outgoing.write(chunk)
        return self._finish(entry, target, partial)

    def download(self, entry: dict, restart: bool = False) -> dict:
        url = entry.get("download_url")
        if not url:
            raise ResourceError("MANUAL_COPY_REQUIRED", "该原版资源尚无已证明的固定官方下载地址，请复制 SHA-256 相同的本地文件。")
        target, partial, skipped = self._prepare(entry, url, restart)
        if skipped:
            return {"path": entry["path"], "state": "already_verified"}
        offset = partial.stat().st_size
        if offset == entry["bytes"]:
            return self._finish(entry, target, partial)
        request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-"} if offset else {})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status = response.status
                if offset and status != 206:
                    raise ResourceError("RESUME_NOT_SUPPORTED", "服务端未接受 Range 续传；中断文件保留。显式 --restart 可归档后从头尝试。")
                if status not in (200, 206):
                    raise ResourceError("DOWNLOAD_HTTP_ERROR", "官方资源请求未成功；中断文件保留。")
                if status == 206:
                    content_range = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                    if not content_range or int(content_range[1]) != offset or int(content_range[3]) != entry["bytes"]:
                        raise ResourceError("RANGE_MISMATCH", "续传响应的字节范围与原版资源不一致；没有追加该响应。")
                count = offset
                with partial.open("ab") as outgoing:
                    for chunk in iter(lambda: response.read(1024 * 1024), b""):
                        if count + len(chunk) > entry["bytes"]:
                            raise ResourceError("DOWNLOAD_SIZE_MISMATCH", "返回内容超过原版文件大小；未接受多余数据，中断文件保留。")
                        outgoing.write(chunk)
                        count += len(chunk)
        except ResourceError:
            raise
        except urllib.error.HTTPError as error:
            status = int(error.code)
            error.close()
            raise ResourceError("DOWNLOAD_HTTP_ERROR", f"固定官方资源返回 HTTP {status}；中断文件已保留，请检查该固定资源的可访问性后显式重试。") from error
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            raise ResourceError("DOWNLOAD_INTERRUPTED", "下载中断；现有字节已保留。再次显式执行同一命令即可续传。") from error
        return self._finish(entry, target, partial)


def selected_entries(manifest: dict, group: str) -> list[dict]:
    return [entry for entry in manifest["files"] if group == "all" or entry.get("group") == group]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", nargs="?", choices=("plan", "check", "verify", "copy", "download"), default="plan")
    parser.add_argument("--group", choices=("all", "funasr", "qwen", "silero"), default="all")
    parser.add_argument("--source-root", type=Path, help="Existing project or canonical model tree; never read its private data.")
    parser.add_argument("--execute", action="store_true", help="Explicitly permit copy/download or writing a successful verification receipt.")
    parser.add_argument("--restart", action="store_true", help="Archive rejected partial files instead of deleting them before restarting.")
    args = parser.parse_args()
    manifest = load_manifest()
    entries = selected_entries(manifest, args.group)
    try:
        if args.operation in ("plan", "copy", "download") and not args.execute:
            output = {"operation": "plan", "requested": args.operation, "network": False, "files": [{"path": item["path"], "group": item.get("group"), "bytes": item["bytes"], "sha256": item["sha256"], "download_available": bool(item.get("download_url")), "copy_required": not bool(item.get("download_url")), "blocked_reason": item.get("download_blocked_reason")} for item in entries]}
        elif args.operation in ("check", "verify"):
            output = inspect_resources(ROOT, {"files": entries}, full_hash=args.operation == "verify")
            output.update(operation=args.operation, network=False)
            if args.operation == "verify" and args.execute and args.group == "all" and output["ready"]:
                write_receipt(ROOT, manifest)
                output["receipt_written"] = True
            print(json.dumps(output, ensure_ascii=False, indent=2))
            return 0 if output["ready"] else 2
        else:
            store = ResourceStore(ROOT)
            if args.operation == "download" and any(not item.get("download_url") for item in entries):
                raise ResourceError("MANUAL_COPY_REQUIRED", "所选组包含未证明固定官方来源的资源；本次未联网。可显式下载 qwen 或 silero 组；FunASR 必须复制原版文件。")
            if args.operation == "copy" and args.source_root is None:
                raise ResourceError("COPY_SOURCE_REQUIRED", "copy 必须显式指定 --source-root；本次未改动文件。")
            transferred = []
            for entry in entries:
                if args.operation == "copy":
                    candidates = [args.source_root / candidate for candidate in entry.get("copy_candidates", [entry["path"]])]
                    source = next((candidate for candidate in candidates if candidate.is_file()), candidates[0])
                    transferred.append(store.copy(entry, source, args.restart))
                else:
                    transferred.append(store.download(entry, args.restart))
            output = {"operation": args.operation, "files": transferred, "network": args.operation == "download"}
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except ResourceError as error:
        print(json.dumps({"passed": False, "code": error.code, "message": str(error)}, ensure_ascii=False, indent=2))
        return 2
    except Exception:
        print(json.dumps({"passed": False, "code": "RESOURCE_OPERATION_FAILED", "message": "资源操作未完成；已有数据保留，请检查目录权限或剩余空间后重试。"}, ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
