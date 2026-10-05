"""Offline ASGI smoke: fake handlers only, no service/weights/API calls."""
from __future__ import annotations

import asyncio
import json
import sys
import threading
from pathlib import Path

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
        health = (await client.get("/api/health")).json()
        assert health["status"] == "ok" and health["stt_backend"] == "funasr"
        assert not health["stt"] and not health["tts"]
        results.append("health preserves lazy loading")
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
        bridge.models._tts = FakeTTS()
        response = await client.post("/api/tts", json={"text": "本地接口测试"})
        assert response.status_code == 200 and response.content[:4] == b"RIFF"
        assert response.headers["content-type"].startswith("audio/wav")
        results.append("TTS response format with fake handler")
        bridge.models._tts = None

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
