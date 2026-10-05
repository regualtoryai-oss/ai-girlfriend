"""Launch the current Voice Bridge with an explicit environment allowlist."""
import os
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
bridge = root / "integrations/voice-bridge"
python = root / ".venv-voice/Scripts/python.exe"
allowed = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"}
env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
temporary = root / "runtime/author-voice-bridge/temp"
temporary.mkdir(parents=True, exist_ok=True)
env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1", PYTHONNOUSERSITE="1", PYTHONUNBUFFERED="1", PYTHONUTF8="1", PYTHONIOENCODING="utf-8", OMP_NUM_THREADS="4", MKL_NUM_THREADS="4", TEMP=str(temporary), TMP=str(temporary), HF_HOME=str(root / "cache/author-voice/huggingface"))
print("Author Voice Bridge: allowlisted environment; offline models; balance/QQ disabled; no credentials inherited.", flush=True)
sys.exit(subprocess.call([str(python), "-m", "uvicorn", "voice_bridge:app", "--host", "127.0.0.1", "--port", "8765"], cwd=bridge, env=env))
