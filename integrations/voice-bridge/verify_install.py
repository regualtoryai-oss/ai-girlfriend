"""Offline verification. Does not start services, download or load model weights."""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.metadata as metadata
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def file_hash(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-only", action="store_true", help="Check portable sources and wheel identities without installed dependencies.")
    parser.add_argument("--require-models", action="store_true", help="Require all exact model artifacts and verify their hashes.")
    args = parser.parse_args()
    errors: list[str] = []
    for name in ("voice_bridge.py", "qq_bridge.py", "verify_install.py"):
        ast.parse((HERE / name).read_text(encoding="utf-8"), filename=name)
    config = json.loads((HERE / "bridge-config.example.json").read_text(encoding="utf-8"))
    expected = {"backend": "funasr", "device": "cuda", "torch_dtype": "float32", "language": "zh"}
    if any(config["stt"].get(key) != value for key, value in expected.items()):
        errors.append("STT preset does not match the audited runtime")
    expected_tts = {"device": "cuda", "dtype": "bfloat16", "speaker": "Serena", "attn_implementation": "eager", "non_streaming_mode": True}
    if any(config["tts"].get(key) != value for key, value in expected_tts.items()):
        errors.append("TTS preset does not match the audited runtime")
    for name, detail in json.loads((HERE / "wheel-manifest.json").read_text()).items():
        if file_hash(HERE / "wheels" / name) != detail["sha256"]:
            errors.append("Wheel hash mismatch: " + name)
    dependencies = 0
    if not args.source_only:
        if sys.version_info[:2] != (3, 12):
            errors.append("Use Python 3.12; audited interpreter was 3.12.14")
        requirements = (HERE / "requirements.lock.txt").read_text().splitlines()
        requirements += (HERE / "requirements-gpu.txt").read_text().splitlines()
        requirements += ["speech-to-speech==0.2.10", "faster-qwen3-tts==0.2.6", "qwen-tts==0.1.1"]
        for line in requirements:
            match = re.fullmatch(r"([A-Za-z0-9_.-]+)==(.+)", line)
            if not match:
                continue
            name, version = match.groups()
            dependencies += 1
            try:
                installed = metadata.version(name)
            except metadata.PackageNotFoundError:
                errors.append("Missing dependency: " + name)
                continue
            if installed != version:
                errors.append(f"Dependency mismatch: {name} (expected {version}, installed {installed})")
        if not errors:
            import torch
            if not torch.cuda.is_available():
                errors.append("CUDA is unavailable; this preset requires its current CUDA backend")
            elif not torch.cuda.is_bf16_supported():
                errors.append("CUDA BF16 is unavailable; this preset requires Qwen3 bfloat16")
    missing_models = []
    resource_files = json.loads((HERE / "model-resources.json").read_text())["files"]
    for entry in resource_files:
        local = ROOT / entry["path"]
        if not local.is_file():
            missing_models.append(entry["path"])
        elif args.require_models and file_hash(local) != entry["sha256"]:
            errors.append("Model artifact hash mismatch: " + entry["path"])
    if args.require_models and missing_models:
        errors.append("Missing model resources; follow integrations/voice-bridge/README.md")
    print(json.dumps({"passed": not errors, "source_only": args.source_only, "dependencies_checked": dependencies,
                      "models_present": len(resource_files) - len(missing_models), "models_required": len(resource_files),
                      "weights_loaded": False, "errors": errors}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
