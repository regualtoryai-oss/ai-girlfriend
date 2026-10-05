import {existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readConfiguration} from '../config/readiness.mjs';

/** Create blank, unapproved templates only. Existing configuration is preserved byte for byte. */
export function initializeConfiguration(root) {
  const directory = path.join(root, 'data', 'private-config');
  for (const candidate of [root, path.join(root, 'data'), directory]) {
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) throw Error('CONFIG_DIRECTORY_LINK_NOT_ALLOWED');
  }
  mkdirSync(directory, {recursive: true});
  const created = [], preserved = [];
  for (const name of ['providers', 'usage-budget', 'verified-prices']) {
    const target = path.join(directory, name + '.json');
    if (existsSync(target)) {preserved.push(name); continue;}
    writeFileSync(target, readFileSync(path.join(root, 'config', name + '.example.json')), {flag: 'wx', mode: 0o600});
    created.push(name);
  }
  return {created, preserved, credentialsWritten: false, budgetGranted: false};
}

export function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--init', '--check', '--json', '--help'].includes(arg))) throw Error('CONFIGURE_ARGUMENT_NOT_ALLOWED');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const initialized = args.includes('--init') ? initializeConfiguration(root) : undefined;
  const configuration = readConfiguration(root);
  if (args.includes('--json')) {console.log(JSON.stringify({initialized, configuration})); return configuration.ready ? 0 : 2;}
  if (initialized) console.log('已生成缺少的空白模板；已有配置、密钥和预算记录均未覆盖。');
  console.log('小婉配置引导：只检查，不调用聊天、Jev、语音模型，也不自动批准预算。');
  console.log('1. node scripts/configure.mjs --init：生成 data/private-config 的空白模板。');
  console.log('2. powershell -File Configure-Companion.ps1 -Launch：隐藏输入自己的凭据，只在本次启动进程使用，不保存密钥。');
  console.log('3. 自行核实 verified-prices.json 的 Flash/Pro 费率与 USD 单位，并明确批准 usage-budget.json 的预算。未批准时任何任务请求都会停止。');
  console.log('4. npm run doctor：检查安装、原模型和服务。重新检查不发送任务、不增加授权。');
  for (const item of configuration.issues) console.log(`[${item.code}] ${item.message}\n${item.action}`);
  if (configuration.ready) console.log('配置检查通过；该结果只证明本地配置就绪，不验证凭据余额或模型响应。');
  return args.includes('--check') && !configuration.ready ? 2 : 0;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {process.exitCode = main();} catch {console.error('CONFIGURATION_GUIDE_FAILED：请检查参数和目录权限；未写入凭据或授予预算。'); process.exitCode = 1;}
}
