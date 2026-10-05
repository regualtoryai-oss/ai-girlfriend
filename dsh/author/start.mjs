// Shell-free entry: inspect before invoking Python or starting either service.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectObservations} from '../../scripts/doctor.mjs';
import {evaluateReadiness, formatReadiness, machineJson} from '../../scripts/doctor-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const localPython = path.join(root, '.venv-voice/Scripts/python.exe');
const python = existsSync(localPython) ? localPython : process.env.COMPANION_LAUNCH_PYTHON || 'python';
try {
  const report = evaluateReadiness(await collectObservations({python}), args.includes('--text-only') ? 'text' : 'voice');
  if (args.includes('--check') || !report.ready) {
    console.log(args.includes('--json') ? machineJson(report) : formatReadiness(report));
    if (!report.ready && report.capabilities.ui_startable && !args.includes('--json')) console.log('可明确选择：npm start -- --text-only（保留同一桥和人物媒体；不更换原语音模型）。');
    process.exitCode = report.ready ? 0 : 2;
  } else {
    if (!report.capabilities.task_ready) console.log('页面可启动；费用和任务守卫仍关闭，模型/Jev 任务不会获准执行。');
    const child = spawn(python, [path.join(root, 'Start-Author-Demo.py'), ...args], {cwd: root, env: process.env, windowsHide: true, stdio: 'inherit'});
    child.on('error', () => { console.error('AUTHOR_LAUNCH_PYTHON_MISSING：请安装 Python 3.12，或运行 Setup-Companion.ps1 -Phase Voice。'); process.exitCode = 2; });
    child.on('exit', code => { process.exitCode = code ?? 2; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
  }
} catch {
  console.error('DOCTOR_FAILED：环境诊断未完成，没有启动服务。请运行 Check-Companion.cmd。');
  process.exitCode = 2;
}
