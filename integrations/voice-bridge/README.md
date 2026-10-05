# 当前 VoiceBridge 语音链路

这里发布的是实际运行目录 `runtime/author-voice-bridge` 中的桥接源码。相对路径和缺资源报错是移植所需的修改；识别、合成、推理参数和音频取消逻辑沿用当前版本。

| 项目 | 当前配置 |
| --- | --- |
| Python | 3.12，当前机器为 3.12.14 |
| GPU | PyTorch / torchaudio 2.9.1+cu128，NVIDIA CUDA，可运行 BF16 |
| 中文识别 | FunASR 1.4.16，Paraformer-large-zh，本地模型，CUDA float32 |
| 语音合成 | speech-to-speech 0.2.10 → faster-qwen3-tts 0.2.6 → qwen-tts 0.1.1 |
| 音色和模型 | Qwen3-TTS-12Hz-0.6B-CustomVoice，Serena，中文 |
| 合成参数 | CUDA bfloat16、eager、non_streaming_mode=true、max_new_tokens=512、blocksize=512 |
| 噪音门和打断检测 | 当前本地 Silero v4 JIT，CPU；HTTP STT 入口保留非语音过滤 |
| 对外音频格式 | 16 kHz 单声道 PCM16 WAV |

`/api/health` 可以在模型尚未加载时返回 `status=ok`。`stt=false`、`tts=false` 表示尚未首次使用或尚未成功加载，不能据此宣称语音推理已验证。关闭语音时保留客户端取消和服务端合成块之间的协作取消；当前 non-streaming 生成内部仍可能需要等待一个生成阶段完成。

当前配置关闭 QQ、桥内 DeepSeek 余额查询、OmniVoice 和 DUIX 数字人生成。它们的原始可选接口源码保留，但没有发布个人音色克隆、QQ 标识、余额、API 密钥或生成视频。页面的人物动作素材通过 `/media/task-videos/investor-preview-v1/...` 读取仓库内 `public/assets`。目前的人物预设动作播放不等于实时精确口型合成。

## 安装依赖

在仓库根目录打开 PowerShell，使用 Python 3.12：

```powershell
& .\integrations\voice-bridge\setup.ps1 -Python 'python'
```

这会创建本仓库 `.venv-voice`，安装精确依赖，生成本地 `bridge-config.json`；已存在的本地配置不会覆盖。依赖安装需要网络，但不调用任何收费模型 API，不启动服务，不自动下载模型权重。没有复用原机器指向另一项目的 `.pth` 文件。

`requirements.lock.txt` 记录当前有效环境中所用依赖及其闭包的精确版本。GPU 构建单独从 PyTorch cu128 索引安装。三个小型上游 wheel 随仓库保存，安装前验证 `wheel-manifest.json` 的 SHA-256；其 `.py` 文件已与本机安装逐文件比较，完全一致。

安装采用 `--no-deps`：当前桥只使用 speech-to-speech 的指定 handler，不启动其完整 VAD → STT → LLM → TTS pipeline。原环境也没有 `nano-parakeet` 和 `lingua-language-detector`，因此完整分发包的 `pip check` 会报告这两项未安装；它们不参与当前链路。不要以修复该报告为由更换当前 ASR/TTS 组件。

## 手动安装当前模型资源

权重总计 **3,388,720,615 bytes**，不随 Git 提交。`model-resources.json` 记录 18 个实际必需文件的大小和 SHA-256，包含两个模型的 tokenizer、前端和配置文件。不能只复制最大的权重文件。

从已有合规本地模型目录复制以下目录到仓库根目录：

```text
models/
  funasr/paraformer-large-zh/
    am.mvn config.yaml configuration.json model.pt seg_dict tokens.json
  qwen3-tts-0.6b-customvoice/
    config.json generation_config.json merges.txt model.safetensors
    preprocessor_config.json tokenizer_config.json vocab.json
    speech_tokenizer/config.json
    speech_tokenizer/configuration.json
    speech_tokenizer/model.safetensors
    speech_tokenizer/preprocessor_config.json
  silero-vad/silero_vad_v4.jit
```

本机对应来源分别为项目根目录 `models/funasr/paraformer-large-zh`、`models/qwen3-tts-0.6b-customvoice`，以及原桥目录 `runtime/author-voice-bridge/models/silero-vad/silero_vad_v4.jit`。它们包含模型资源，不含私聊或任务数据。复制后必须执行下面的哈希验证。

需要重新取得公开模型时：

1. Paraformer：从 [ModelScope 的原模型仓库](https://modelscope.cn/models/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch) 取得上列 6 个文件。原记录没有证明锁定完整模型快照，因此以 `model-resources.json` 中的文件哈希为准。
2. Qwen3：从 [官方 0.6B CustomVoice 固定版本](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice/tree/85e237c12c027371202489a0ec509ded67b5e4b5) 下载完整模型及 `speech_tokenizer`。官方模型页注明 Apache-2.0，并支持中文 Serena 音色。不要改用 Base、VoiceDesign、1.7B、其他音色或其他精度。
3. Silero：使用 [官方 v4.0 固定提交](https://github.com/snakers4/silero-vad/tree/915dd3d639b8333a52e001af095f87c5b7f1e0ac) 的 `files/silero_vad.jit`。官方 Git tree 元数据中的 1,439,299 字节、Git blob SHA-1 与当前本机文件完全一致；当前 SHA-256 保持 `082e21870cf7722b0c7fa5228eaed579efb6870df81192b79bed3f7bac2f738a`。这里证明了固定来源，没有实际下载该模型或使用新版替代。

### 计划、复制、显式下载与断点续传

以下命令均从仓库根目录执行。`model_resources.py` 是标准库工具，查看计划不要求先安装语音依赖。

```powershell
# 默认只列计划；check 只查看文件大小和已有校验记录，不联网或读取 3 GB 权重内容。
python .\integrations\voice-bridge\model_resources.py
python .\integrations\voice-bridge\model_resources.py check

# 未带 --execute 的 copy/download 仍只显示计划，不创建文件、不联网。
python .\integrations\voice-bridge\model_resources.py download --group qwen

# 从已有项目复制原版资源：只读取清单中的模型文件，原项目内容不会改动。
python .\integrations\voice-bridge\model_resources.py copy --source-root 'D:\Companion-Agent' --execute

# 只有固定官方来源已证明的组可以显式下载。
python .\integrations\voice-bridge\model_resources.py download --group qwen --execute
python .\integrations\voice-bridge\model_resources.py download --group silero --execute

# 全部 18 个文件执行完整 SHA-256。仅 --execute 才写入成功校验记录。
python .\integrations\voice-bridge\model_resources.py verify --execute
```

Qwen 固定快照与 Silero 固定提交可以下载。FunASR 六文件的完整固定官方来源仍未证明，因此其自动下载被明确阻止；`download --group all --execute` 也会在任何网络请求前停止。FunASR 必须复制与清单哈希完全相同的已有资源，不能静默使用最新版本、未验证的 `v2.0.4` 或其他识别模型。

下载或复制使用同名 `.part` 和 `.part.json`。中断后再次显式执行同一命令即可续传；网络续传使用 HTTP Range，并校验返回的起点与总大小。完成后验证整个文件的 SHA-256，只有一致才成为模型文件。已经通过校验的最终文件直接跳过；现有不一致文件会报冲突并保留，不会覆盖。来源不符、Range 不符或哈希不符时，原始中断数据也会保留。

如果必须从头重试同一固定资源，显式添加 `--restart --execute`。旧中断文件会归档为 `.rejected-*`，不会删除；之后重新取得并校验相同版本。工具不会自行切换 URL、快照、模型、音色、精度或 GPU 后端。

成功校验记录位于被 Git 忽略的 `models/.resource-verification.json`。准备检查只比较该记录的文件大小、修改时间和位置指纹；文件被移动或改变后，状态退回 `MODEL_VERIFY_REQUIRED`，必须重新完整校验。记录不包含绝对路径或凭据。单独 `verify` 或下面的 `--full-hash` 可以只读校验，但不会写入该记录。

从仓库根目录验证：

```powershell
& .\integrations\voice-bridge\setup.ps1 -VerifyOnly -RequireModels
```

缺少资源或哈希不一致时验证失败。调用 STT/TTS 之前要求依赖、原版参数、CUDA BF16、模型校验记录均准备好，否则返回可解释的 503 错误，不会静默下载、切换 CPU 或更换模型。所有配置路径相对桥目录解析。移动仓库后资源内容不变，但位置指纹失效，因此需要再次执行 `verify --execute`。本地配置可指向自己的模型目录；使用规范目录安装便于完整校验记录被桥接服务复用。

## 无推理验证和启动

```powershell
# 仅检查源码、模板和 wheel 哈希，不要求安装依赖或模型。
python .\integrations\voice-bridge\verify_install.py --source-only

# 已安装依赖后检查精确版本和 CUDA BF16；不加载模型，不启动服务。
& .\integrations\voice-bridge\setup.ps1 -VerifyOnly

# 完整只读诊断：默认不读取完整大模型；--full-hash 才执行完整哈希，不写校验记录。
& .\.venv-voice\Scripts\python.exe .\integrations\voice-bridge\voice_diagnostics.py --json
& .\.venv-voice\Scripts\python.exe .\integrations\voice-bridge\voice_diagnostics.py --json --full-hash

# 完成模型安装后启动桥；STT/TTS 模型仍在首次使用时加载。
& .\.venv-voice\Scripts\python.exe -m uvicorn voice_bridge:app --app-dir .\integrations\voice-bridge --host 127.0.0.1 --port 8765

# 无收费调用、无模型加载的 ASGI 与取消逻辑 smoke。
& .\.venv-voice\Scripts\python.exe .\integrations\voice-bridge\smoke_test.py

# 小型本地 HTTP 假资源验证 Range 续传、中断、哈希不符、冲突和校验记录失效。
& .\.venv-voice\Scripts\python.exe .\integrations\voice-bridge\test_model_resources.py
```

语音依赖、模型推理和 UI 应分别验证。这里的离线 smoke 使用本地假 handler，只证明桥接路由、默认关闭的外部集成、媒体引用和取消机制；不能代替真实麦克风、GPU 模型推理或浏览器播放验收。

`GET /api/health` 保留原来的 `status` 与 `stt`/`tts` 已加载标志，并新增只读 `readiness`。`GET /api/readiness` 提供同一准备诊断；`runtime_ready` 区分桥依赖是否可运行，`voice_ready` 还要求 GPU 和原版模型验证。冷启动检查尚在进行时会快速返回 `unchecked / READINESS_CHECK_PENDING`；它不代表服务缺失，也没有模型加载。默认检查不会读取完整 3 GB 权重。API 只返回固定错误码、中文说明和相对资源标识，不回传本地路径、配置值、密钥或原始加载异常。

`POST /api/models/recheck` 是显式修复后重查：只有准备条件全部满足，才清除先前缓存的 STT/TTS 加载错误。它不加载或卸载模型、不合成声音、不重发失败请求，也不会更换配置。返回 `{rechecked, readiness, reset:{stt,tts}}`。普通健康检查始终只读，不清除错误。

## 源码和许可证

桥接源代码基于 [Cordis/dsh-voice-ai-girlfriend](https://github.com/beiyege-01/dsh-voice-ai-girlfriend)，当前上游参考提交为 `480bbabada7335735cad591eaa55f32fe54a4214`，并保留本机正在运行的修改。其声明使用 Apache-2.0；`LICENSE.voice-bridge` 保留原声明，完整 Apache 许可证在 `LICENSE.speech-to-speech`。

随仓库的小型上游分发包：

| 分发包 | 许可证 | 对应文件 |
| --- | --- | --- |
| [speech-to-speech 0.2.10](https://github.com/huggingface/speech-to-speech) | Apache-2.0 | `LICENSE.speech-to-speech` |
| [faster-qwen3-tts 0.2.6](https://github.com/andimarafioti/faster-qwen3-tts) | MIT | `LICENSE.faster-qwen3-tts` |
| [qwen-tts 0.1.1](https://github.com/QwenLM/Qwen3-TTS) | Apache-2.0 | `LICENSE.qwen-tts` |

模型权重与人物媒体分别使用其来源许可；模型未随本仓库分发。不要把示例人物媒体、历史离线口型演示或私人参考录音混入当前所用的人物资源。
