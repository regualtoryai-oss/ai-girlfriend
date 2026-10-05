"""Offline verification. Does not start services, download or load model weights."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
from voice_diagnostics import collect_readiness, expected_dependencies

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
    for name in ("voice_bridge.py", "qq_bridge.py", "verify_install.py", "voice_diagnostics.py", "model_resources.py", "smoke_test.py", "test_model_resources.py"):
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
    readiness = None
    if not args.source_only:
        dependencies = len(expected_dependencies())
        readiness = collect_readiness(full_hash=args.require_models)
        for check in readiness["checks"]:
            is_model_check = check["code"].startswith("MODEL_")
            if check["status"] != "ok" and (args.require_models or not is_model_check):
                errors.append({key: check[key] for key in ("code", "message", "action")})
    missing_models = []
    resource_files = json.loads((HERE / "model-resources.json").read_text())["files"]
    for entry in resource_files:
        local = ROOT / entry["path"]
        if not local.is_file():
            missing_models.append(entry["path"])
        elif args.source_only and args.require_models and file_hash(local) != entry["sha256"]:
            errors.append("Model artifact hash mismatch: " + entry["path"])
    if args.source_only and args.require_models and missing_models:
        errors.append("Missing model resources; follow integrations/voice-bridge/README.md")
    print(json.dumps({"passed": not errors, "source_only": args.source_only, "dependencies_checked": dependencies,
                      "models_present": len(resource_files) - len(missing_models), "models_required": len(resource_files),
                      "runtime_ready": readiness["runtime_ready"] if readiness else None,
                      "voice_ready": readiness["voice_ready"] if readiness else None,
                      "weights_loaded": False, "errors": errors}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
