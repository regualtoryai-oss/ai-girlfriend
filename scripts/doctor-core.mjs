/** Evaluate read-only observations without reading files, starting services or making requests. */
export function evaluateReadiness(observed, mode = 'voice') {
  const checks = [];
  const add = (code, ok, requiredFor, message, action, failure = 'missing') => checks.push({code, status: ok ? 'pass' : failure, required_for: requiredFor, message, action: ok ? '' : action});
  const system = observed.system ?? {}, harness = observed.harness ?? {}, config = observed.configuration ?? {};
  add('WINDOWS_REQUIRED', system.windows === true, ['install', 'host'], 'Windows 运行环境', '请在 Windows 上运行此入口；当前组件和模型配置保持不变。', 'blocked');
  add('NODE_24_REQUIRED', system.node24 === true, ['install', 'host'], 'Node.js 24 或更高版本', '安装 Node.js 24 或更高版本后重新打开终端。');
  add('GIT_REQUIRED', system.git === true, ['install', 'host'], 'Git 可用', '安装 Git 后重新打开终端；安装器不会安装系统软件。');
  add('PYTHON_312_REQUIRED', system.python312 === true, ['install', 'host'], 'Python 3.12 可用', '安装 Python 3.12；可通过 COMPANION_LAUNCH_PYTHON 指定解释器。');
  add('VISUAL_CPP_REQUIRED', system.visualCpp === true, ['install'], 'Visual Studio C++ 工具与 Windows SDK', '安装 Visual Studio C++ Build Tools 的 C++ 桌面开发工具和 Windows SDK。');
  add('HARNESS_COMMIT_REQUIRED', harness.pinned === true, ['host'], 'Harness 固定提交一致', '运行 Setup-Companion.ps1；不同版本的现有 checkout 会保留并阻止覆盖。', harness.exists ? 'invalid' : 'missing');
  add('HARNESS_BUILD_REQUIRED', harness.compiled === true, ['host'], 'Harness 与当前 UI 已构建', '运行 Setup-Companion.ps1 -Phase Harness。');
  add('ROOT_DEPENDENCIES_REQUIRED', harness.rootDependencies === true, ['host'], '根目录原 TypeSafe SDK 依赖已安装', '运行 Setup-Companion.ps1 -Phase Harness；使用锁文件安装根依赖。');
  add('FILE_SERIALIZER_REQUIRED', harness.fileSerializer === true, ['host'], '原 Excel 与图片文件序列化依赖可用', '运行 Setup-Companion.ps1 -Phase Harness；文件环境与语音环境各自保留。');
  add('AUTHOR_PROFILE_REQUIRED', harness.profile === true, ['host'], '原 author-web profile 和 Jev 插件已注册', '运行 Setup-Companion.ps1 -Phase Harness；不会覆盖私有配置。');
  add('CURRENT_MEDIA_REQUIRED', observed.media?.valid === true, ['host'], '原人物图片及六段动作素材 SHA256 一致', '恢复仓库中 public/assets 的原素材；诊断不会换图。', observed.media?.missing ? 'missing' : 'invalid');
  for (const [name, label] of [['host', '8796'], ['voice', '8765']]) {
    const state = observed.ports?.[name]?.state ?? 'unknown';
    add(name === 'host' ? 'HOST_PORT_OWNERSHIP' : 'BRIDGE_PORT_OWNERSHIP', state === 'free' || state === 'owned', ['host'], `端口 ${label} 空闲或属于此仓库`, state === 'foreign' ? `端口 ${label} 属于其他项目。保留该服务；先使用其现有入口，或在明确停止它后再启动此副本。` : `无法确认端口 ${label} 的进程归属。请在具有本机进程读取权限的终端重新检查。`, state === 'foreign' ? 'blocked' : 'unknown');
  }
  for (const [field, code, label, scope] of [
    ['relayConfigured', 'RELAY_CONFIG_REQUIRED', '原 relay 凭据已配置', 'host'],
    ['jevConfigured', 'JEV_CONFIG_REQUIRED', 'Jev 凭据已配置', 'host'],
    ['budgetAuthorized', 'BUDGET_APPROVAL_REQUIRED', '费用预算已明确授权', 'task'],
    ['forwardAuthorized', 'FORWARD_APPROVAL_REQUIRED', '原模型调用审批守卫已明确授权', 'task'],
    ['pricesVerified', 'PRICE_VERIFICATION_REQUIRED', '原模型报价已核验', 'task'],
    ['budgetAvailable', 'BUDGET_AVAILABLE_REQUIRED', '已授权预算仍可用', 'task'],
  ]) add(code, config[field] === true, [scope], label, '运行 npm run configure 并按提示配置自己的凭据、核验报价和明确预算；安装器不会自动授权。');
  add('HOST_CONFIG_VALID', !config.issues?.some(item => item.code === 'PROVIDERS_CONFIG_INVALID'), ['host'], '原 provider 私有配置格式有效', '运行 npm run configure；修复 providers.json 格式，不要输出凭据。', 'invalid');
  add('CONFIGURATION_VALID', config.ready !== false && (!Array.isArray(config.issues) || config.issues.length === 0), ['task'], '任务配置与原审批守卫有效', '运行 npm run configure；修复私有配置，不要复制历史账本或自动批准费用。', 'invalid');
  const voice = observed.voice ?? {};
  add('BRIDGE_RUNTIME_REQUIRED', voice.runtime_ready === true, ['bridge'], '原 VoiceBridge Python 环境与配置可用', '运行 Setup-Companion.ps1 -Phase Voice；保持 FunASR、Qwen3 和 Serena 原配置。');
  add('VOICE_RESOURCES_REQUIRED', voice.voice_ready === true, ['voice'], '原语音 GPU、BF16 和模型资源已就绪', '查看语音诊断项并安装原模型资源；可明确选择 --text-only 保留人物媒体并暂停 STT/TTS。');
  for (const item of voice.checks ?? []) {
    if (!item || !/^[A-Z][A-Z0-9_]*$/.test(item.code ?? '')) continue;
    const okay = item.status === 'pass' || item.status === 'ok';
    checks.push({code: 'VOICE_' + item.code, status: okay ? 'pass' : 'missing', required_for: ['voice'], message: String(item.message ?? item.code), action: okay ? '' : String(item.action ?? '查看 integrations/voice-bridge/README.md。')});
  }
  const passes = scope => checks.filter(item => item.required_for.includes(scope)).every(item => item.status === 'pass');
  const hostReady = passes('host'), bridgeReady = passes('bridge'), taskReady = hostReady && passes('task');
  const capabilities = {install_ready: passes('install'), host_startable: hostReady, host_ready: hostReady, ui_startable: hostReady && bridgeReady, task_ready: taskReady, text_ready: taskReady && bridgeReady, bridge_runtime_ready: bridgeReady, voice_ready: hostReady && bridgeReady && passes('voice')};
  const ready = mode === 'install' ? capabilities.install_ready : mode === 'text' ? capabilities.ui_startable : capabilities.voice_ready;
  const required = mode === 'install' ? ['install'] : mode === 'text' ? ['host', 'bridge'] : ['host', 'bridge', 'voice'];
  const failures = checks.filter(item => item.status !== 'pass' && item.required_for.some(scope => required.includes(scope)));
  const taskFailures = checks.filter(item => item.status !== 'pass' && item.required_for.includes('task'));
  const status = ready ? (mode === 'install' ? 'install-ready' : !taskReady ? 'ui-ready-tasks-blocked' : mode === 'text' ? 'text-ready' : 'ready') : mode === 'install' ? 'system-dependencies-needed' : capabilities.ui_startable ? 'ui-ready-voice-not-ready' : !passes('host') && checks.some(item => item.status !== 'pass' && item.required_for.includes('host') && /CONFIG/.test(item.code)) ? 'configuration-needed' : 'dependencies-or-port-needed';
  return {schema_version: 1, read_only: true, requested_mode: mode, status, ready, capabilities, configuration: Object.fromEntries(['relayConfigured', 'jevConfigured', 'budgetAuthorized', 'forwardAuthorized', 'pricesVerified', 'budgetAvailable'].map(name => [name, config[name] === true])), ports: Object.fromEntries(['host', 'voice'].map(name => [name, {state: ['free', 'owned', 'foreign', 'unknown'].includes(observed.ports?.[name]?.state) ? observed.ports[name].state : 'unknown'}])), checks, error_codes: failures.map(item => item.code), task_error_codes: taskFailures.map(item => item.code), next_actions: [...new Set([...failures, ...taskFailures].map(item => item.action).filter(Boolean))]};
}

/** Render only public diagnostics; observation records and private configuration are never printed. */
export function formatReadiness(report) {
  const lines = [`环境诊断：${report.status}（只读，不加载模型、不调用 API）`];
  for (const item of report.checks) lines.push(`${item.status === 'pass' ? '[OK]' : '[待处理]'} ${item.code}: ${item.message}${item.action ? '\n  建议：' + item.action : ''}`);
  lines.push(`原语音环境：${report.capabilities.voice_ready ? '就绪' : '未就绪'}；人物媒体页面：${report.capabilities.ui_startable ? '可启动' : '未就绪'}；文本/模型任务：${report.capabilities.text_ready ? '可用' : '未获准或环境未就绪'}。`);
  if (report.capabilities.ui_startable && !report.capabilities.task_ready) lines.push('页面可打开；费用和任务守卫仍关闭，模型/Jev 任务不会获准执行。');
  return lines.join('\n');
}

/** ASCII JSON survives Windows PowerShell 5 native-command code-page decoding. */
export function machineJson(report) {
  return JSON.stringify(report, null, 2).replace(/[^\x00-\x7f]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}
