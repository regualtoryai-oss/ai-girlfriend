"""Offline ASGI smoke: fake handlers only, no service/weights/API calls."""
from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import voice_bridge as bridge


class FakeTTS:
    def process(self, _message):
        yield np.zeros(512, dtype=np.int16)


async def smoke() -> dict:
    results = []
    assert not bridge.models.stt_ready and not bridge.models.tts_ready
    assert bridge.CONFIG["stt"]["torch_dtype"] == "float32"
    assert bridge.CONFIG["tts"]["speaker"] == "Serena"
    assert bridge.CONFIG["tts"]["dtype"] == "bfloat16"
    assert not bridge.CONFIG["digital_human"]["enabled"]
    assert not bridge.CONFIG["qq"]["enabled"]
    assert not bridge.CONFIG["deepseek"]["enabled"]
    results.append("actual model and disabled-integration preset")

    # Decode and resampling do not invoke models.
    raw = np.array([0, 32767, -32768], dtype="<i2").tobytes()
    decoded = bridge.decode_audio(raw, "application/octet-stream")
    assert decoded.dtype == np.float32 and decoded.shape == (3,)
    assert np.isclose(decoded[1], 32767 / 32768) and decoded[2] == -1
    results.append("PCM16 decode")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=bridge.app), base_url="http://127.0.0.1:8765") as client:
        health_started = time.perf_counter()
        health = (await client.get("/api/health")).json()
        assert time.perf_counter() - health_started < 1, "Cold health must not wait for CUDA import"
        if health["readiness"]["status"] == "unchecked":
            assert health["readiness"]["code"] == "READINESS_CHECK_PENDING"
            await asyncio.wait_for(asyncio.shield(bridge._readiness_inspection_task), timeout=15)
            health = (await client.get("/api/health")).json()
        results.append("cold health remains bounded while readiness checks finish without model loading")
        assert health["status"] == "ok" and health["stt_backend"] == "funasr"
        assert not health["stt"] and not health["tts"]
        assert health["runtime_ready"] and not health["voice_ready"]
        assert health["readiness"]["status"] == "blocked"
        assert any(item["code"] == "MODEL_FILES_MISSING" for item in health["readiness"]["checks"])
        results.append("health preserves lazy loading")
        response = await client.get("/api/readiness")
        quick_report = response.json()
        assert not quick_report["weights_loaded"] and not quick_report["network"]
        assert quick_report["models"]["full_hash"] is False
        assert str(HERE) not in response.text and "DEEPSEEK_API_KEY" not in response.text
        results.append("quick readiness reports model availability without paths or model loading")
        response = await client.post("/api/stt", content=b"")
        assert response.status_code == 400
        response = await client.post("/api/stt", content=b"\0" * 3200, headers={"content-type": "application/octet-stream"})
        assert response.status_code == 200 and response.json()["no_speech"]
        assert not bridge.models.stt_ready
        results.append("STT rejects empty input and bypasses models for silence")
        response = await client.post("/api/stt", content=b"\0" * 3200, headers={"X-Max-Audio-Sec": "0.01"})
        assert response.status_code == 422
        response = await client.post("/api/tts", json={"text": " "})
        assert response.status_code == 400
        results.append("STT duration and TTS empty-text limits")
        response = await client.get("/api/health", headers={"Origin": "http://127.0.0.1:8796"})
        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:8796"
        results.append("current local UI CORS origin")
        # Request one byte from each currently bundled media file. No media is executed.
        root = HERE.parents[1]
        manifest = root / "public/assets/investor-preview-v1/manifest.json"
        assert manifest.is_file(), "Current public media manifest is missing"
        media_files = sorted((manifest.parent).glob("*.mp4")) + sorted((manifest.parent).glob("*.png"))
        assert media_files, "Current avatar media is missing"
        for media in media_files:
            response = await client.get("/media/task-videos/investor-preview-v1/" + media.name, headers={"Range": "bytes=0-0"})
            assert response.status_code == 206 and len(response.content) == 1
            assert response.content == media.read_bytes()[:1]
        results.append(f"current media routes and Range bytes ({len(media_files)} files)")
        response = await client.get("/api/balance")
        assert response.status_code == 503 and "disabled" in response.json()["detail"].lower()
        results.append("disabled balance route avoids external API")
        gpu_unavailable = deepcopy(quick_report)
        gpu_unavailable["voice_ready"] = False
        gpu_unavailable["checks"] = [{"code": "GPU_CUDA_UNAVAILABLE", "status": "error", "message": "原版语音需要 NVIDIA CUDA。", "action": "检查原版 GPU 环境。"}]
        with patch.object(bridge, "collect_readiness", side_effect=lambda **_kwargs: deepcopy(gpu_unavailable)):
            response = await client.post("/api/tts", json={"text": "准备状态测试"})
            assert response.status_code == 503 and response.json()["detail"]["code"] == "GPU_CUDA_UNAVAILABLE"
            response = await client.post("/api/stt", content=np.full(1600, 100, dtype="<i2").tobytes())
            assert response.status_code == 503 and response.json()["detail"]["code"] == "GPU_CUDA_UNAVAILABLE"
        results.append("missing GPU produces bounded structured STT/TTS errors without fallback")
        ready_report = deepcopy(quick_report)
        ready_report.update(voice_ready=True, runtime_ready=True, status="ready", checks=[{"code": "MODEL_READY", "status": "ok", "message": "原版资源已验证。", "action": ""}])
        bridge.models._stt_error = "private-path-and-token-must-not-leak"
        bridge.models._tts_error = "private-path-and-token-must-not-leak"
        response = await client.post("/api/models/recheck")
        assert response.status_code == 200 and response.json()["reset"] == {"stt": False, "tts": False}
        assert "private-path-and-token" not in response.text
        with patch.object(bridge, "collect_readiness", side_effect=lambda **_kwargs: deepcopy(ready_report)):
            original_handler = FakeTTS()
            bridge.models._tts = original_handler
            await bridge.models._load_lock.acquire()
            try:
                response = await asyncio.wait_for(client.post("/api/models/recheck"), timeout=1)
                assert response.json()["reset"] == {"stt": False, "tts": False}
            finally:
                bridge.models._load_lock.release()
            with patch.object(bridge, "_load_stt_handler", side_effect=AssertionError("Recheck must not load STT")), patch.object(bridge, "_load_tts_handler", side_effect=AssertionError("Recheck must not load TTS")):
                response = await client.post("/api/models/recheck")
                assert response.json()["reset"] == {"stt": True, "tts": True}
                assert response.json()["readiness"]["status"] == "ready"
                assert bridge.models._tts is original_handler
            response = await client.post("/api/tts", json={"text": "本地接口测试"})
            assert response.status_code == 200 and response.content[:4] == b"RIFF"
            assert response.headers["content-type"].startswith("audio/wav")
            results.append("TTS response format with fake handler")
            bridge.models._tts = None
        results.append("explicit recheck clears cached errors only when ready and never loads/unloads handlers")

    cancel = threading.Event()
    class CancelAfterFirst:
        def process(self, _message):
            yield np.full(512, 1, dtype=np.int16)
            cancel.set()
            yield np.full(512, 2, dtype=np.int16)
    result = bridge._synthesize(CancelAfterFirst(), "取消测试", cancel)
    assert cancel.is_set() and len(result) == 512 and np.all(result == 1)
    results.append("cooperative cancellation stops before the next audio chunk")
    assert not bridge.models.stt_ready and not bridge.models.tts_ready
    return {"passed": True, "checks": results, "weights_loaded": False, "paid_calls": False, "real_services_started": False}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(smoke()), ensure_ascii=False, indent=2))
