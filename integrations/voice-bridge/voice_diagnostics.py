"""Read-only voice readiness. No model loading, downloads, services or paid calls."""
from __future__ import annotations

import argparse
import importlib.metadata as metadata
import json
import os
import re
import sys
from pathlib import Path

from model_resources import HERE, ROOT, inspect_resources, load_manifest


def _check(code: str, okay: bool, message: str, action: str = "") -> dict:
    return {"code": code, "status": "ok" if okay else "error", "message": message, "action": action}


def expected_dependencies() -> dict:
    versions = {}
    for file in ("requirements.lock.txt", "requirements-gpu.txt"):
        for line in (HERE / file).read_text(encoding="utf-8").splitlines():
            match = re.fullmatch(r"([A-Za-z0-9_.-]+)==(.+)", line)
            if match:
                versions[match[1]] = match[2]
    versions.update({"speech-to-speech": "0.2.10", "faster-qwen3-tts": "0.2.6", "qwen-tts": "0.1.1"})
    return versions


def load_local_config(root: Path) -> dict:
    bridge = root / "integrations/voice-bridge"
    path = Path(os.environ.get("COMPANION_VOICE_CONFIG", bridge / "bridge-config.json"))
    if not path.is_absolute():
        path = bridge / path
    if not path.is_file():
        path = bridge / "bridge-config.example.json"
    return json.loads(path.read_text(encoding="utf-8-sig"))


def resource_locations(config: dict, root: Path, manifest: dict) -> dict:
    bridge = root / "integrations/voice-bridge"
    def absolute(value: str) -> Path:
        path = Path(value).expanduser()
        return path if path.is_absolute() else (bridge / path).resolve()
    stt = absolute(config["stt"]["model_name"])
    tts = absolute(config["tts"]["model_name"])
    vad = absolute(config["stt"].get("vad_model", "../../models/silero-vad/silero_vad_v4.jit"))
    locations = {}
    for entry in manifest["files"]:
        if entry["path"].startswith("models/funasr/paraformer-large-zh/"):
            locations[entry["path"]] = stt / entry["path"].removeprefix("models/funasr/paraformer-large-zh/")
        elif entry["path"].startswith("models/qwen3-tts-0.6b-customvoice/"):
            locations[entry["path"]] = tts / entry["path"].removeprefix("models/qwen3-tts-0.6b-customvoice/")
        else:
            locations[entry["path"]] = vad
    return locations


def probe_gpu() -> dict:
    try:
        import torch
        cuda = bool(torch.cuda.is_available())
        bf16 = bool(cuda and torch.cuda.is_bf16_supported())
        return {"cuda": cuda, "bfloat16": bf16, "code": "GPU_READY" if bf16 else ("GPU_BF16_UNAVAILABLE" if cuda else "GPU_CUDA_UNAVAILABLE")}
    except Exception:
        return {"cuda": False, "bfloat16": False, "code": "GPU_PROBE_FAILED"}


def collect_readiness(config: dict | None = None, root: Path | None = None, full_hash: bool = False) -> dict:
    root = (root or ROOT).resolve()
    checks = [_check("PYTHON_VERSION", sys.version_info[:2] == (3, 12), "语音桥使用 Python 3.12；当前记录版本为 3.12.14。", "使用 Python 3.12 创建 .venv-voice。")]
    missing, mismatched = [], []
    for name, expected in expected_dependencies().items():
        try:
            installed = metadata.version(name)
        except metadata.PackageNotFoundError:
            missing.append(name)
        else:
            if installed != expected:
                mismatched.append(name)
    checks.append(_check("BRIDGE_DEPENDENCIES", not missing and not mismatched, "语音桥依赖必须匹配原版精确版本。", "运行 integrations/voice-bridge/setup.ps1 安装原版依赖。"))
    try:
        config = config if config is not None else load_local_config(root)
        stt, tts = config["stt"], config["tts"]
        expected_stt = {"backend": "funasr", "device": "cuda", "torch_dtype": "float32", "language": "zh"}
        expected_tts = {"device": "cuda", "dtype": "bfloat16", "speaker": "Serena", "language": "zh", "attn_implementation": "eager", "non_streaming_mode": True, "max_new_tokens": 512, "blocksize": 512}
        preset_ok = all(stt.get(key) == value for key, value in expected_stt.items()) and all(tts.get(key) == value for key, value in expected_tts.items())
        checks.append(_check("ORIGINAL_VOICE_PRESET", preset_ok, "保持 Paraformer CUDA FP32 和 Qwen3 0.6B Serena CUDA BF16 原版参数。", "恢复 bridge-config.example.json 的语音参数；不要自动降级或替换模型。"))
        manifest = load_manifest()
        resources = inspect_resources(root, manifest, full_hash, resource_locations(config, root, manifest))
    except Exception:
        checks.append(_check("VOICE_CONFIG_INVALID", False, "无法读取有效的语音桥配置或模型资源清单。", "根据配置模板检查 JSON 和本地资源路径。"))
        resources = {"ready": False, "verified": 0, "required": 18, "files": [], "full_hash": full_hash}
    runtime_ready = all(item["status"] == "ok" for item in checks)
    gpu = probe_gpu()
    checks.append(_check(gpu["code"], gpu["bfloat16"], "原版语音需要可用的 NVIDIA CUDA 和 BF16；未启用 CPU 或其他模型替代。", "检查 NVIDIA 驱动与 cu128 依赖。若仅使用文字，请显式选择 --text-only。"))
    file_states = {item["state"] for item in resources["files"]}
    if "missing" in file_states:
        model_code, model_message = "MODEL_FILES_MISSING", "原版语音模型文件尚未安装完整。"
    elif file_states & {"hash_mismatch", "size_mismatch"}:
        model_code, model_message = "MODEL_HASH_MISMATCH", "模型资源与原版大小或完整 SHA-256 不一致。"
    elif not resources["ready"]:
        model_code, model_message = "MODEL_VERIFY_REQUIRED", "资源存在，但尚未通过本机完整 SHA-256 校验，或校验记录已失效。"
    else:
        model_code, model_message = "MODEL_READY", "18 个原版资源身份已验证。"
    checks.append(_check(model_code, resources["ready"], model_message, "先运行 model_resources.py plan，再复制或显式下载原版资源，最后运行 verify --execute。"))
    voice_ready = runtime_ready and gpu["bfloat16"] and resources["ready"]
    return {"schema_version": 1, "status": "ready" if voice_ready else ("voice_unavailable" if runtime_ready else "runtime_blocked"),
            "runtime_ready": runtime_ready, "voice_ready": voice_ready, "text_available": runtime_ready, "checks": checks,
            "dependencies": {"missing": missing, "mismatched": mismatched}, "gpu": gpu, "models": resources,
            "weights_loaded": False, "network": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--full-hash", action="store_true", help="Explicitly read complete model files; does not write a receipt or load models.")
    args = parser.parse_args()
    result = collect_readiness(full_hash=args.full_hash)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for item in result["checks"]:
            print(f"[{item['status']}] {item['code']}: {item['message']}")
            if item["status"] != "ok":
                print("  " + item["action"])
    return 0 if result["voice_ready"] else (2 if result["runtime_ready"] else 1)


if __name__ == "__main__":
    raise SystemExit(main())
