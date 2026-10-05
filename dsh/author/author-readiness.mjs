import path from 'node:path';
import {readConfiguration} from '../../config/readiness.mjs';

const advice = {
  VOICE_SERVICE_UNAVAILABLE: ['语音服务尚未连接。', '先运行环境检查；确认同一项目的 VoiceBridge 已启动，再重新检查。'],
  VOICE_DIAGNOSTICS_UNAVAILABLE: ['当前语音服务未提供新版就绪检查。', '按安装入口更新本项目；保留现有服务，安排手动重启后再检查。'],
  GPU_MISSING: ['原语音模型需要可用的 NVIDIA GPU。', '运行 Check-Companion.cmd 检查 GPU；本轮不会安装驱动或改用其他模型。'],
  CUDA_UNAVAILABLE: ['原 CUDA 语音环境尚未就绪。', '核对 NVIDIA 驱动与锁定的 cu128 环境；不要更换为 CPU 模型。'],
  BF16_UNSUPPORTED: ['GPU 尚未通过原模型的 BF16 检查。', '核对原版硬件要求及 CUDA 环境。'],
  MODEL_MISSING: ['缺少原版本语音模型文件。', '运行模型计划和校验工具，按固定文件清单安装。'],
  MODEL_VERIFY_REQUIRED: ['语音模型需要完整哈希校验。', '运行 models.py verify；通过后重新检查，校验不会加载模型。'],
  MODEL_HASH_MISMATCH: ['语音模型与原版本哈希不一致。', '保留已有文件，按模型工具的提示恢复原版本；不会自动换模型。'],
  MODEL_LOAD_FAILED: ['上次语音模型加载失败。', '修复环境后使用“修复后重试语音”；只重新检查并清除失败缓存，不立即推理。'],
  READINESS_CHECK_PENDING: ['语音环境正在进行首次只读检查。', '稍等片刻后重新检查；此过程不会加载模型或发起推理。'],
  READINESS_CHECK_FAILED: ['语音环境检查未完成。', '运行 Check-Companion.cmd 查看固定错误码，修复后重新检查。'],
  MODEL_FILES_MISSING: ['缺少原版本语音模型文件。', '运行 npm run models:plan，按固定清单安装并完整校验。'],
  GPU_CUDA_UNAVAILABLE: ['原 CUDA 语音环境尚未就绪。', '核对 NVIDIA GPU、驱动与锁定的 cu128 环境；不会改用 CPU 模型。'],
  GPU_BF16_UNAVAILABLE: ['GPU 尚未通过原模型的 BF16 检查。', '核对原版硬件要求及 CUDA 环境。'],
};

/** Project only known readiness fields; bridge errors may contain private paths or request text. */
export function projectVoiceHealth(value) {
  const readiness = value?.readiness;
  if (!readiness || !['ready', 'blocked', 'unchecked'].includes(readiness.status)) {
    return {status: 'unchecked', code: 'VOICE_DIAGNOSTICS_UNAVAILABLE', stt: value?.stt === true, tts: value?.tts === true, readiness: {status: 'unchecked', checks: []}};
  }
  const code = typeof readiness.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(readiness.code)
    ? readiness.code : readiness.status === 'ready' ? 'VOICE_READY' : 'VOICE_NOT_READY';
  const checks = Array.isArray(readiness.checks) ? readiness.checks.slice(0, 32)
    .filter(check => check && typeof check.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(check.code) && typeof check.ok === 'boolean')
    .map(check => ({code: check.code, ok: check.ok})) : [];
  return {status: readiness.status, code, stt: value.stt === true, tts: value.tts === true, readiness: {status: readiness.status, code, checks}};
}

/** Fixed loopback GET; never follows a redirect, loads a model or sends provider credentials. */
export async function inspectVoice(fetcher = fetch) {
  try {
    const response = await fetcher('http://127.0.0.1:8765/api/health', {redirect: 'error', signal: AbortSignal.timeout(2000)});
    if (!response.ok || Number(response.headers.get('content-length')) > 65536) throw Error('unavailable');
    const text = await response.text();
    if (Buffer.byteLength(text) > 65536) throw Error('oversized');
    return projectVoiceHealth(JSON.parse(text));
  } catch {
    return {status: 'unavailable', code: 'VOICE_SERVICE_UNAVAILABLE', stt: false, tts: false, readiness: {status: 'unchecked', checks: []}};
  }
}

export async function authorReadiness(root, env = process.env, fetcher = fetch) {
  const configuration = readConfiguration(root, env, {dataRoot: env.COMPANION_DATA_ROOT || path.join(root, 'data'), hostEnvironment: true});
  const voice = await inspectVoice(fetcher);
  const issues = [...configuration.issues];
  if (voice.status !== 'ready') {
    const [message, action] = advice[voice.code] || ['原语音环境尚未就绪。', '运行 Check-Companion.cmd 和原模型校验，修复后重新检查；不会自动重试任务或切换模型。'];
    issues.push({code: voice.code, message, action});
  }
  return {status: configuration.ready && voice.status === 'ready' ? 'ready' : 'blocked',
    host: {ready: true}, configuration, voice,
    harness: '0.1.3-alpha.1', models: {chat: 'deepseek-v4-flash', routed: 'deepseek-v4-pro', decision: 'jev-latest', tts: 'Qwen3-TTS-12Hz-0.6B-CustomVoice', voice: 'Serena'},
    avatar: {mode: 'preset-motion', liveLipSync: false, phonemeSynced: false}, issues};
}
