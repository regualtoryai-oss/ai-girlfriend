# 小婉 · Companion Agent

这份源码发布对应本机作者版：DeepSeek Harness **0.1.3-alpha.1**、Cordis、Jev、原 VoiceBridge 和 **Serena**。主要入口是 npm start 或 Start-Author-Demo.cmd，作者页面默认 http://127.0.0.1:8796，语音桥默认 http://127.0.0.1:8765。npm run start:legacy / Start-Demo.cmd 是保留的旧 8793 本地预览入口；验收作者版请使用作者入口。

## 形象与实际能力

随仓包含原头像和当前作者页面使用的 investor-preview-v1 动作素材：成年黑色长发女性、奶油色吊带、花朵项链、暖色室内。文件、大小、SHA-256 和模式说明见 [资源清单](public/assets/manifest.json) 与 [动作清单](public/assets/investor-preview-v1/manifest.json)。下载源码后无需另找照片。

人物动作来自静音缓存视频，跟随聆听、思考、播放等状态切换。**当前没有逐字同步的实时口型。** 原语音是本地 FunASR 中文识别与 Qwen3-TTS CustomVoice Serena；需要原有 CUDA 语音环境及权重。

文件任务由 Harness 工具执行，写入需先批准具体计划。Jev 负责原决策与路由，近期上下文、请求大小/输出限制、费用预算和审批守卫保留。媒体生成与实验探测仍需独立授权、价格配置与预算；安装或启动不会自动做付费测试。

## 从干净 Windows 目录安装

使用本次发布分支：git clone --branch feat/runtime-config-local https://github.com/regualtoryai-oss/ai-girlfriend.git

1. 安装 Node.js 24、Git、Python 3.12 与 Visual Studio C++ Build Tools；语音使用支持 CUDA 12.8 的 NVIDIA 环境。目录可以位于任意本地位置，发布代码不依赖原电脑的 D 盘路径。
2. 执行 powershell -File Setup-Files.ps1 安装独立的文件序列化环境。再执行 npm ci --ignore-scripts，再执行 powershell -ExecutionPolicy Bypass -File Setup-Harness.ps1。脚本固定官方 Harness tag dsh-v0.1.3-alpha.1 / commit d347e703908d0406b7a7ef80e3a0e594d86b2215，应用随仓保存的当前 UI 修改，并注册作者与 SDK 配置。它不调用模型。
3. 按 [VoiceBridge 安装说明](integrations/voice-bridge/README.md) 安装原语音依赖与权重。大权重不进入普通 Git；版本、目录与哈希保留在说明/清单里。
4. 将 config/providers.example.json 的占位配置另存到被忽略的 data/private-config/providers.json，仅填自己授权的配置；也可显式设置 COMPANION_RELAY_API_KEY 与 COMPANION_JEV_KEY。预算与价格模板仅提供格式，不带本机账本或历史授权。没有凭据时模型调用不可用，错误会明确显示。
5. 双击 Start-Author-Demo.cmd，或运行 python Start-Author-Demo.py。启动后使用启动器打开的本地认证地址；不要公开分享其认证参数。原始语音模型在首次语音请求时载入，冷启动可能需要等待。

## 验证与发布范围

运行 npm test、npm test --prefix packages/jev-plugin 和 npm test --prefix packages/voice-plugin 进行无费用回归。实际执行结果及安装/界面检查见 [验收记录](ACCEPTANCE.md)。

本仓库不包含 .env 真实值、API 密钥、私聊、用户工作文件、费用账本、日志、历史授权、虚拟环境、模型权重和海量测试视频。语音/模型依赖按固定来源安装，必要原人物媒体按用户此次发布要求随仓保留。第三方来源和许可见 [来源清单](licenses/SOURCES.json) 与 [素材说明](licenses/ASSET-NOTICE.md)。
