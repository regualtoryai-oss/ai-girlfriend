"""Small local fixtures only; never fetch real weights or load a model."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import model_resources as resources
import voice_diagnostics as diagnostics


class FakeHTTP:
    def __init__(self, body: bytes, mode: str = "normal"):
        self.body, self.mode, self.ranges, self.calls = body, mode, [], 0
        outer = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                outer.calls += 1
                if outer.mode == "http_error":
                    self.send_error(404)
                    return
                header = self.headers.get("Range")
                outer.ranges.append(header)
                offset = int(header.removeprefix("bytes=").removesuffix("-")) if header else 0
                if outer.mode == "ignore_range":
                    offset = 0
                self.send_response(206 if header and outer.mode != "ignore_range" else 200)
                if header and outer.mode != "ignore_range":
                    start = offset + 1 if outer.mode == "bad_range" else offset
                    self.send_header("Content-Range", f"bytes {start}-{len(outer.body)-1}/{len(outer.body)}")
                self.send_header("Content-Length", str(len(outer.body) - offset))
                self.end_headers()
                body = outer.body[offset:]
                if outer.mode == "interrupt_once" and outer.calls == 1:
                    body = body[:1024 * 1024 + 1234]
                try:
                    for index in range(0, len(body), 8192):
                        self.wfile.write(body[index:index + 8192])
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass
                if outer.mode == "interrupt_once" and outer.calls == 1:
                    self.close_connection = True
            def log_message(self, *_args):
                pass
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/fixture"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
    def __enter__(self):
        self.thread.start()
        return self
    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def entry(body: bytes, **extra) -> dict:
    return {"path": "models/fixture/model.bin", "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), **extra}


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = resources.ResourceStore(self.root)
        self.body = bytes(range(251)) * 9000
        self.item = entry(self.body)
    def tearDown(self):
        self.temporary.cleanup()
    def assert_error(self, expected, callback):
        with self.assertRaises(resources.ResourceError) as caught:
            callback()
        self.assertEqual(caught.exception.code, expected)
    def test_copy_full_hash_receipt_and_stale_detection(self):
        source = self.root / "source.bin"
        source.write_bytes(self.body)
        self.assertEqual(self.store.copy(self.item, source)["state"], "verified")
        manifest = {"files": [self.item]}
        self.assertFalse(resources.inspect_resources(self.root, manifest)["ready"])
        resources.write_receipt(self.root, manifest)
        self.assertTrue(resources.inspect_resources(self.root, manifest)["ready"])
        target = resources.target_path(self.root, self.item)
        before = target.stat().st_mtime_ns
        self.assertEqual(self.store.copy(self.item, source)["state"], "already_verified")
        self.assertEqual(before, target.stat().st_mtime_ns)
        target.write_bytes(b"x" * len(self.body))
        self.assertFalse(resources.inspect_resources(self.root, manifest)["ready"])
        self.assertEqual(resources.inspect_resources(self.root, manifest, full_hash=True)["files"][0]["state"], "hash_mismatch")
    def test_wrong_copy_hash_is_kept_and_explicit_restart_archives(self):
        source = self.root / "source.bin"
        source.write_bytes(b"x" * len(self.body))
        self.assert_error("HASH_MISMATCH", lambda: self.store.copy(self.item, source))
        target = resources.target_path(self.root, self.item)
        self.assertFalse(target.exists())
        partial = target.with_name(target.name + ".part")
        self.assertEqual(partial.stat().st_size, len(self.body))
        source.write_bytes(self.body)
        self.store.copy(self.item, source, restart=True)
        self.assertEqual(target.read_bytes(), self.body)
        self.assertEqual(len(list(target.parent.glob("*.part.rejected-*"))), 1)
    def test_existing_bad_destination_is_never_overwritten(self):
        target = resources.target_path(self.root, self.item)
        target.parent.mkdir(parents=True)
        target.write_bytes(b"previous-user-file")
        source = self.root / "source.bin"
        source.write_bytes(self.body)
        self.assert_error("DESTINATION_CONFLICT", lambda: self.store.copy(self.item, source))
        self.assertEqual(target.read_bytes(), b"previous-user-file")
    def test_interrupted_http_download_resumes_from_preserved_bytes(self):
        with FakeHTTP(self.body, "interrupt_once") as server:
            item = {**self.item, "download_url": server.url}
            self.assert_error("TRANSFER_INCOMPLETE", lambda: self.store.download(item))
            target = resources.target_path(self.root, item)
            partial = target.with_name(target.name + ".part")
            offset = partial.stat().st_size
            self.assertGreater(offset, 0)
            self.assertLess(offset, item["bytes"])
            self.store.download(item)
            self.assertEqual(server.ranges[1], f"bytes={offset}-")
            self.assertEqual(target.read_bytes(), self.body)
            before = target.stat().st_mtime_ns
            self.assertEqual(self.store.download(item)["state"], "already_verified")
            self.assertEqual(server.calls, 2)
            self.assertEqual(target.stat().st_mtime_ns, before)
    def test_ignored_or_bad_range_does_not_append_bytes(self):
        for mode, code in (("ignore_range", "RESUME_NOT_SUPPORTED"), ("bad_range", "RANGE_MISMATCH")):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as folder, FakeHTTP(self.body, mode) as server:
                store = resources.ResourceStore(Path(folder))
                item = {**self.item, "download_url": server.url}
                target, partial, _ = store._prepare(item, server.url, False)
                partial.write_bytes(self.body[:1000])
                self.assert_error(code, lambda: store.download(item))
                self.assertEqual(partial.read_bytes(), self.body[:1000])
                self.assertFalse(target.exists())
    def test_http_wrong_hash_never_promoted(self):
        with FakeHTTP(b"x" * len(self.body)) as server:
            item = {**self.item, "download_url": server.url}
            self.assert_error("HASH_MISMATCH", lambda: self.store.download(item))
            target = resources.target_path(self.root, item)
            self.assertFalse(target.exists())
            self.assertTrue(target.with_name(target.name + ".part").is_file())
    def test_http_error_is_explainable_and_keeps_resume_state(self):
        with FakeHTTP(self.body, "http_error") as server:
            item = {**self.item, "download_url": server.url}
            self.assert_error("DOWNLOAD_HTTP_ERROR", lambda: self.store.download(item))
            target = resources.target_path(self.root, item)
            self.assertFalse(target.exists())
            self.assertTrue(target.with_name(target.name + ".part.json").is_file())
            server.mode = "normal"
            self.store.download(item)
            self.assertEqual(target.read_bytes(), self.body)
    def test_partial_wrong_identity_stays_preserved(self):
        with FakeHTTP(self.body) as server:
            item = {**self.item, "download_url": server.url}
            _, partial, _ = self.store._prepare(item, "other-source", False)
            partial.write_bytes(b"partial")
            self.assert_error("PARTIAL_CONFLICT", lambda: self.store.download(item))
            self.assertEqual(server.calls, 0)
            self.assertEqual(partial.read_bytes(), b"partial")
    def test_manual_source_cannot_download_latest(self):
        self.assert_error("MANUAL_COPY_REQUIRED", lambda: self.store.download(self.item))
        self.assertFalse((self.root / "models").exists())
    def test_paths_cannot_escape_models_root(self):
        self.assert_error("UNSAFE_RESOURCE_PATH", lambda: resources.target_path(self.root, {**self.item, "path": "models/../../outside"}))
    def test_default_download_is_plan_with_no_network_or_files(self):
        with patch("sys.argv", ["model_resources.py", "download", "--group", "qwen"]), patch.object(resources.urllib.request, "urlopen", side_effect=AssertionError("Plan must not request")), patch.object(resources.ResourceStore, "_prepare", side_effect=AssertionError("Plan must not mutate")), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(resources.main(), 0)
            result = json.loads(output.getvalue())
        self.assertEqual(result["operation"], "plan")
        self.assertFalse(result["network"])
    def test_original_manifest_pins_and_fixed_sources(self):
        manifest = resources.load_manifest()
        self.assertEqual(len(manifest["files"]), 18)
        self.assertEqual(sum(item["bytes"] for item in manifest["files"]), 3388720615)
        for item in manifest["files"]:
            self.assertEqual(len(item["sha256"]), 64)
            if item["group"] == "qwen":
                self.assertIn("/85e237c12c027371202489a0ec509ded67b5e4b5/", item["download_url"])
            elif item["group"] == "silero":
                self.assertIn("/915dd3d639b8333a52e001af095f87c5b7f1e0ac/", item["download_url"])
            else:
                self.assertNotIn("download_url", item)
    def test_diagnostics_gpu_and_path_privacy_without_model_load(self):
        config = json.loads((resources.HERE / "bridge-config.example.json").read_text())
        config["stt"]["model_name"] = str(self.root / "private-token-sentinel")
        config["tts"]["model_name"] = str(self.root / "private-token-sentinel")
        config["stt"]["vad_model"] = str(self.root / "private-token-sentinel")
        config["deepseek"] = {"enabled": False, "api_key": "SYNTHETIC-PRIVATE-KEY-SENTINEL"}
        expected = diagnostics.expected_dependencies()
        with patch.object(diagnostics.sys, "version_info", (3, 12, 14, "final", 0)), patch.object(diagnostics.metadata, "version", side_effect=lambda name: expected[name]), patch.object(diagnostics, "probe_gpu", return_value={"cuda": False, "bfloat16": False, "code": "GPU_CUDA_UNAVAILABLE"}), patch.object(resources, "sha256", side_effect=AssertionError("Quick checks must not hash model bytes")):
            report = diagnostics.collect_readiness(config=config)
        self.assertTrue(report["runtime_ready"])
        self.assertFalse(report["voice_ready"])
        self.assertFalse(report["weights_loaded"])
        self.assertNotIn("private-token-sentinel", json.dumps(report))
        self.assertNotIn("SYNTHETIC-PRIVATE-KEY-SENTINEL", json.dumps(report))
        self.assertIn("GPU_CUDA_UNAVAILABLE", [item["code"] for item in report["checks"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
