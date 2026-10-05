# 小婉 · Companion Agent

本仓库对应当前作者版：DeepSeek Harness **0.1.3-alpha.1**、Cordis、Jev、原 VoiceBridge 与 **Serena**。运行 `npm start` / `Start-Author-Demo.cmd`；作者页面默认 http://127.0.0.1:8796，语音桥默认 http://127.0.0.1:8765。`npm run start:legacy` / `Start-Demo.cmd` 保留旧 8793 预览入口。

## 形象与实际能力

随仓包含当前原头像及 investor-preview-v1 动作素材：成年长黑发女性、奶油色吊带、花项链、暖色室内。文件、大小与 SHA-256 见[资源清单](public/assets/manifest.json)和[动作清单](public/assets/investor-preview-v1/manifest.json)。人物动作跟随聆听、思考、播放等状态切换；**当前没有逐字同步的实时精确口型**。

原语音使用本地 FunASR 中文识别和 Qwen3-TTS 0.6B CustomVoice Serena，保持 CUDA、BF16 及原合成参数。文件任务由 Jev 路由与 Harness 工具执行，写入需原生审批确认具体计划。上下文、请求大小、输出限制、预算、取消、防重播和原 bounded recovery 保留；媒体生成与探测仍需独立授权。

## 从干净 Windows 目录安装

使用当前发布分支：

```powershell
git clone --branch feat/runtime-config-local https://github.com/regualtoryai-oss/ai-girlfriend.git
cd ai-girlfriend
powershell -NoProfile -File Setup-Companion.ps1 -CheckOnly
```

1. 检查 Node.js 24、Git、Python 3.12、Visual Studio C++ Build Tools 与 Windows SDK。检查入口只报告缺项，不安装系统软件或驱动。原语音仍需支持 CUDA 12.8 / BF16 的 NVIDIA GPU。
2. 系统条件齐备后运行 `powershell -NoProfile -File Setup-Companion.ps1`，安装根依赖、原文件序列化环境、固定 Harness 和 VoiceBridge。失败后可用 `-Phase Harness` 或 `-Phase Voice` 重试对应阶段。不覆盖私有配置、不下载模型、不启动服务。Harness 固定为 `dsh-v0.1.3-alpha.1` / `d347e703908d0406b7a7ef80e3a0e594d86b2215`，没有更新原组件版本。
3. 运行 `npm run models:plan` 查看原模型清单和大小。Qwen/Silero 可按[模型工具说明](integrations/voice-bridge/README.md)显式下载并断点恢复。FunASR 尚未证明完整固定官方快照，必须复制 SHA-256 相同的原文件；不会静默采用最新版。18 个资源共约 3.39 GB。本轮没有执行大模型下载或复制。
4. 完整校验后运行 `python integrations/voice-bridge/model_resources.py verify --execute` 保存本机校验记录；不加载模型。运行 `npm run configure` 查看引导，或 `powershell -File Configure-Companion.ps1 -Initialize` 创建缺少的空白模板。已有配置和费用记录不覆盖。`Configure-Companion.ps1 -Launch` 可隐藏输入自己的密钥，仅在本次启动进程使用。报价和费用预算仍须操作者明确核实。
5. 双击 `Check-Companion.cmd` 或运行 `npm run doctor`，按中文错误码处理缺项，再运行 `npm start`。语音资源暂未齐备时，可显式 `npm start -- --text-only` 保留同一人物媒体与原桥接服务，暂停识别/合成；桥接依赖缺失时仍阻止启动。启动器不会抢占其他项目端口、重启已有服务或替换模型。

模型在第一次实际语音请求时加载。启动服务或检查通过不证明真实推理已经验收。使用启动器打开的本地认证地址，不公开分享其认证参数；目录可放在自己的本地位置，不依赖原电脑 D 盘路径。

## 任务与成果

语音识别得到可编辑草稿，用户确认后才进入当前会话。新 Jev 决策前检查原配置、严格预算授权、Flash 报价与首请求最低保留额；未批准时不发送 Jev 或聊天请求。较大请求和 Pro 阶段仍经过原每请求预算检查，失败请求的费用预约保留。

人物菜单中的“任务”面板显示当前会话的运行、待审批、完成、中止或失败状态。待审批项仍由原生审批界面确认。已审批成果提供打开与下载入口；下载前核对工具记录、当前大小和 SHA-256。后来修改的文件会阻止下载。`/api/companion/deliverables` 使用同一个已登录浏览器查看真实成果，干净目录显示空态，不列旧演示链接。

设置中的“重新检查”只读取环境状态。“修复后重试语音”只重新检查前置条件并解除失败缓存，不执行识别、合成或重新发送任务，不播放历史回复。服务、GPU、模型、配置或预算缺失时给出修复建议，保留任务记录和用户草稿。

## 验证与发布范围

无费用回归：

```powershell
npm test
npm run test:readiness
npm test --prefix packages/jev-plugin
npm test --prefix packages/voice-plugin
python -m unittest discover -s integrations/voice-bridge -p test_model_resources.py
```

执行证据与边界见[本轮验收](docs/acceptance-2026-10-05-product.md)、[首次发布验收](ACCEPTANCE.md)和[实现说明](docs/notes/2026-10-05-product-readiness.md)。安装升级只自动替换哈希匹配上次安装的 UI 文件，本地改动与未知同名文件会阻止覆盖，未知额外文件不删除。

本仓库不包含真实密钥、私聊、用户工作文件、账本、日志、历史授权、虚拟环境、模型权重或海量测试视频。第三方来源与许可见[来源清单](licenses/SOURCES.json)和[素材说明](licenses/ASSET-NOTICE.md)。本轮未安装系统软件、修改驱动、重启当前服务、调用真实模型或新增费用；完整新 GPU 机器部署与真实语音仍需另行验收。
