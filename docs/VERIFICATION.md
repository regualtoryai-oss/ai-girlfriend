# 公开版本验证记录

日期：2026-10-05。范围：本次公开准备分支；本机 Windows、Node.js 24.12.0。

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 根目录 `npm test` | 32 / 32 通过 | HTTP、状态、审批、文件、下载、路由与适配契约 |
| `packages/jev-plugin` 的 `npm test` | 14 / 14 通过 | 候选结果、确定性权限与插件生命周期 |
| `packages/voice-plugin` 的 `npm test` | 17 / 17 通过 | 录音和语音适配的模拟行为、取消与资源释放 |
| `node --check` | 通过 | 演示入口、任务路由与浏览器脚本语法 |
| 根目录及两个插件的锁定安装 | 通过 | 本机 `npm ci --ignore-scripts`；插件省略可选原生依赖 |

共 63 项 Node 测试通过。本轮未执行收费模型调用、真实麦克风、实时数字人或完整 Harness 安装。

离线演示测试验证了：模式明确标注、禁止外部调用授权、关闭模型配置入口、公开 SVG 回退、等待审批时不写文件、批准后生成真实可下载文件和 SHA-256、重复任务不重复执行，以及拒绝和取消不写文件。另覆盖关闭中转站后代码和图像任务不发起请求。

浏览器验收：在单独本机端口打开公开占位形象，输入保存学习计划，查看具体改动、点击批准，页面进入“已完成”并展示 236 字节 Markdown 文件的下载链接。没有接入真实模型或私人头像。

XLSX 回归使用通过 `COMPANION_XLSX_PYTHON` 显式指定的本机 Python 运行时。新环境运行完整测试前，需安装 Python 并执行 `python -m pip install -r requirements-files.txt`；必要时设置该变量。`npm run demo` 本身不需要 Python。

GitHub Actions 将在 Linux / Node 24 / Python 3.11 上复测。只有 Actions 实际通过后，才能认领这一平台的验证结果。历史真实接口验收见根目录 `ACCEPTANCE.md`，与本次离线回归分开。
