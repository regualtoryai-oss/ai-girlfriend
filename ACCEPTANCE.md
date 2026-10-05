# 本次发布验收

目标仓库为 https://github.com/regualtoryai-oss/ai-girlfriend，发布分支 feat/runtime-config-local。发布以 D:\Companion-Agent 的真实工作树为基线，在独立目录整理；没有清空、重置或覆盖原项目。

## 已执行并通过

- 根 npm ci --ignore-scripts 与 npm test：27/27，包括实际 XLSX 序列化、重新读取和公式文本保护。
- Jev 单元回归：14/14；Voice 单元/本地 HTTP 回归：17/17。
- 固定官方 Harness 的 Jev/Voice SDK 无密钥加载：各 1/1。合计上述 60 项通过。
- 作者可移植性与实际 speaker 生命周期：10/10，覆盖精确探针范围、上下文/请求限制、头像 HTTP 哈希、decode 中止、队列清空和新回复恢复。
- 作者 UI Vitest：motion 3/3、reply lifecycle 3/3，覆盖历史回复防重播、迟到合成取消、卸载释放与当前动作冷却语义。
- VoiceBridge 离线 ASGI smoke：10 项通过，覆盖实际媒体 Range 响应、默认禁用集成、输入限制、假 TTS WAV 与协作取消；依赖/配置/GPU 检查 121 项通过。
- 独立目录执行 Setup-Harness.ps1：官方精确 tag 全新克隆，原 1,068 依赖按冻结锁安装，原生 fs-ext 编译，host/client/frontend 完整构建，当前 author-web 和 sdk 配置注册，SDK initialize/shutdown 完成。全程无模型请求。
- 独立 .venv-files 从头安装 openpyxl/Pillow；实际文件/图像适配器相关 5 项回归通过。
- 新构建的作者 profile 在独立本地测试端口成功启动，使用合成凭据和未批准预算。页面加载认可海报（720×960），六条视频 URL 与原作者版相同；人物截图已在本地保存。
- 原图、海报和 6 段动作视频 SHA-256 全与当前运行引用的原文件相同。6 段视频完整 FFmpeg 解码通过、无音轨；抽帧目视核对为同一成年黑长发、奶油吊带、花项链、暖室内人物。
- 发布候选/历史/上游 wheel 内层内容已做脱敏扫描，并与本机三个真实 provider key 逐字比较，未检出泄露。最终提交前另做 git index 扫描。

## 保留的功能与发布边界

保持官方 Harness 0.1.3-alpha.1、Cordis/Jev、FunASR Paraformer、Qwen3 0.6B Serena 以及原文件审批、上下文、费用预算和音频中止逻辑。修改主要为当前源代码/资产收录、相对路径、固定安装及私有配置模板。原实验 session/task 标识改由私有显式配置提供，缺省仍关闭，审批与费用守卫未放宽。

随仓八个必要人物媒体共 6,647,541 bytes，完整哈希见 public/assets 两份 manifest。旧 Ditto idle、旧 DUIX 离线口型演示、参考音频、测试生成海量视频、用户任务/私聊/账本、日志、凭据、虚拟环境与 3.39 GB 模型权重均未发布。第三方公开源码/小型 wheel 保留 Apache-2.0/MIT 来源及许可；权重仅提供安装路径、来源和精确哈希。

## 明确限制

- 当前人物模式是预设动作视频；没有对新语音实时逐字精确口型。离线对口型演示不能证明生产实时能力。
- 自动化浏览器将原页面和新构建页面都报告为 hidden；图像可显示，视频进入海报回退并显示加载失败。因此这里只确认了人物像素、引用和 HTTP 媒体一致，未把隐藏页面当作连续动作播放验收。没有为绕过该限制修改生产功能。
- 无费用测试使用本地 mock、合成 ASR/TTS 与无密钥 SDK。未发送真实聊天、麦克风、模型推理或新增付费调用；真实 Serena 听感与真实语音端到端需要用户已有语音环境验收。
- 全新 GPU Python 虚拟环境的 120 项闭包联网重装未重复执行；已核对原有效依赖、实际源码、小型 wheel 哈希和现有 GPU 环境。大权重需按 integrations/voice-bridge/README.md 安装并核验。Silero v4 当前文件已记录哈希和准确本地复制流程，公开下载地址未重新验证。
- 本次发布到已有工作分支；未自动合并、改变仓库可见性或部署服务。
