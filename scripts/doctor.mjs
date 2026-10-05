/** Windows companion environment inspection; no network, service startup or model loading. */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {evaluateReadiness, formatReadiness, machineJson} from './doctor-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedCommit = 'd347e703908d0406b7a7ef80e3a0e594d86b2215';
function probe(command, args, env = {}) {
  const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  const result = spawnSync(command, args, {cwd: root, env: {...safeEnv, ...env}, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024});
  return {ok: !result.error && result.status === 0, output: result.stdout?.trim() ?? ''};
}
function readJson(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }
function pythonProbe(command, args) {
  const locations = path.isAbsolute(command) ? [command] : (process.env.PATH || process.env.Path || '').split(path.delimiter).map(folder => path.join(folder, command.endsWith('.exe') ? command : command + '.exe'));
  const resolved = locations.find(file => existsSync(file));
  // Windows Store aliases may open an installer; inspection never invokes them.
  if (resolved && /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(resolved)) return {ok: false, output: ''};
  return probe(command, args, {PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'});
}
function mediaReadiness() {
  const manifest = readJson(path.join(root, 'public/assets/manifest.json'));
  const motion = readJson(path.join(root, 'public/assets/investor-preview-v1/manifest.json'));
  if (!manifest?.portrait || !Array.isArray(motion?.files)) return {valid: false, missing: true};
  const files = [{...manifest.portrait, path: 'portrait.png'}, ...motion.files.map(item => ({...item, path: 'investor-preview-v1/' + item.path}))];
  if (files.length !== 8) return {valid: false, missing: false};
  for (const item of files) {
    const file = path.resolve(root, 'public/assets', item.path);
    if (!file.startsWith(path.resolve(root, 'public/assets') + path.sep)) return {valid: false, missing: false};
    if (!existsSync(file)) return {valid: false, missing: true};
    if (statSync(file).size !== item.bytes || createHash('sha256').update(readFileSync(file)).digest('hex') !== item.sha256) return {valid: false, missing: false};
  }
  return {valid: true, missing: false};
}
function inspectWindows() {
  if (process.platform !== 'win32') return {visualCpp: false, ports: {host: {state: 'unknown'}, voice: {state: 'unknown'}}};
  const script = readFileSync(path.join(root, 'scripts/doctor-windows.ps1'), 'utf8').replace(/^param[^\n]*\n/, '$ProjectRoot = $env:COMPANION_DOCTOR_ROOT\n');
  const result = probe('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {COMPANION_DOCTOR_ROOT: root});
  try { return result.ok ? JSON.parse(result.output) : {visualCpp: false, ports: {}}; } catch { return {visualCpp: false, ports: {}}; }
}

/** Collect only readiness booleans; credentials, amounts, command lines and local paths stay private. */
export async function collectObservations(options = {}) {
  const localPython = path.join(root, '.venv-voice/Scripts/python.exe');
  const python = options.python || (existsSync(localPython) ? localPython : process.env.COMPANION_LAUNCH_PYTHON || 'python');
  const interpreter = pythonProbe(python, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])']);
  const git = probe('git', ['--version']);
  const repo = path.join(root, 'vendor/deepseek-harness-0.1.3-alpha.1');
  const commit = existsSync(repo) && git.ok ? probe('git', ['-c', 'safe.directory=' + repo, '-C', repo, 'rev-parse', 'HEAD']) : {ok: false};
  const windows = inspectWindows();
  const profile = readJson(path.join(root, 'data/dsh-author-home/profiles/author-web/package.json'));
  const profileValid = profile?.dsh?.profile?.bundles?.slice(0, 2).join(',') === '@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app' && profile.dsh.profile.bundles.includes('@ai-girlfriend/jev-plugin') && existsSync(path.join(root, 'data/dsh-author-home/profiles/author-web/node_modules/@ai-girlfriend/jev-plugin'));
  const compiled = ['apps/cli/src/bin.ts', 'node_modules/tsx/dist/esm/index.mjs', 'packages/client/ui-voice/lib/client.js', 'packages/bundle/web-app/lib/startup.js', 'apps/web/dist/index.html'].every(rel => existsSync(path.join(repo, rel)));
  const rootDependencies = readJson(path.join(root, 'node_modules/@typesafe-ai/sdk/package.json'))?.version === '0.6.0' && existsSync(path.join(root, 'node_modules/@typesafe-ai/sdk/dist/index.mjs'));
  const filePython = process.env.COMPANION_XLSX_PYTHON || path.join(root, '.venv-files/Scripts/python.exe');
  const fileCheck = pythonProbe(filePython, ['-c', 'import importlib.metadata as m; print("ready" if m.version("openpyxl")=="3.1.5" and m.version("Pillow")=="11.3.0" else "mismatch")']);
  let configuration = {};
  try {
    const reader = await import(pathToFileURL(path.join(root, 'config/readiness.mjs')).href);
    configuration = reader.readConfiguration(root, process.env);
  } catch { /* Missing or unreadable configuration keeps every capability closed. */ }
  let voice = {runtime_ready: false, voice_ready: false, checks: []};
  const voiceTool = path.join(root, 'integrations/voice-bridge/voice_diagnostics.py');
  if (existsSync(localPython) && existsSync(voiceTool)) {
    const result = pythonProbe(localPython, [voiceTool, '--json', ...(options.deepModels ? ['--full-hash'] : [])]);
    try { voice = JSON.parse(result.output); } catch { /* Failed inspection is not evidence of voice readiness. */ }
  }
  return {system: {windows: process.platform === 'win32', node24: Number(process.versions.node.split('.')[0]) >= 24, git: git.ok, python312: interpreter.ok && interpreter.output === '3.12', visualCpp: windows.visualCpp === true}, harness: {exists: existsSync(repo), pinned: commit.ok && commit.output === expectedCommit, compiled, profile: profileValid, rootDependencies, fileSerializer: fileCheck.ok && fileCheck.output === 'ready'}, configuration, media: mediaReadiness(), ports: windows.ports, voice};
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--json', '--text', '--mode', '--fixture', '--python', '--deep-model-check']);
  let mode = 'voice', fixture, python;
  for (let index = 0; index < args.length; index++) {
    if (!known.has(args[index])) throw Error('DOCTOR_ARGUMENT_INVALID');
    if (['--mode', '--fixture', '--python'].includes(args[index])) {
      const value = args[++index]; if (!value) throw Error('DOCTOR_ARGUMENT_INVALID');
      if (args[index - 1] === '--mode') mode = value;
      else if (args[index - 1] === '--fixture') fixture = value;
      else python = value;
    }
  }
  if (!['voice', 'text', 'install'].includes(mode)) throw Error('DOCTOR_MODE_INVALID');
  const observed = fixture ? readJson(path.resolve(fixture)) : await collectObservations({python, deepModels: args.includes('--deep-model-check')});
  if (!observed) throw Error('DOCTOR_FIXTURE_INVALID');
  const report = evaluateReadiness(observed, mode);
  console.log(args.includes('--text') ? formatReadiness(report) : machineJson(report));
  process.exitCode = report.ready ? 0 : 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.log(machineJson({schema_version: 1, read_only: true, ready: false, status: 'diagnostic-error', error_codes: ['DOCTOR_FAILED'], next_actions: ['检查参数，并从仓库目录运行 Check-Companion.cmd。']}));
  process.exitCode = 2;
});
