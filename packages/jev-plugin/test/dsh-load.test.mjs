import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceRoot = process.env.DSH_SOURCE_ROOT || path.join(repoRoot, 'vendor/deepseek-harness-0.1.3-alpha.1');
const cleanDiagnostic = value => value.replace(/token=[^\s]+/g, 'token=[REDACTED]').slice(-3000);

async function command(args, options, timeoutMs = 60000) {
  const child = spawn(process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, cleanDiagnostic(err)); return out;
  } finally { clearTimeout(timer); }
}

test('exact DSH alpha.1 registers the bundle and loads a genuinely unconfigured Jev service', { timeout: 120000 }, async t => {
  const version = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8')).version;
  assert.equal(version, '0.1.3-alpha.1', 'Do not substitute the newer Harness runtime');
  const cli = path.join(sourceRoot, 'apps/cli/lib/bin.js');
  await readFile(cli); // A missing exact-version build is a failure, not a silent skip.
  const sandbox = await mkdtemp(path.join(tmpdir(), 'jev-dsh-load-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home'), cwd = path.join(sandbox, 'workspace');
  await mkdir(home); await mkdir(cwd);
  await writeFile(path.join(home, 'cordis.patch.yml'), '- id: session-log-deepseek\n  config:\n    enabled: false\n');
  const env = {
    PATH: process.env.DSH_TEST_PATH || `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
    HOME: home, USERPROFILE: home, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', DSH_TELEMETRY_DISABLED: '1',
    DSH_PERMISSION_MODE: 'workspace-write', TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {})
  };
  assert.equal((await command([cli, '--version'], { cwd, env })).trim(), '0.1.3-alpha.1');
  await command([cli, '--profile', 'sdk', '--dump-default-config'], { cwd, env });
  // The official command, not this test, owns the profile bundle registration.
  await command([cli, 'plugin', '--profile', 'sdk', 'add', pluginRoot], { cwd, env });
  const manifest = JSON.parse(await readFile(path.join(home, 'profiles/sdk/package.json'), 'utf8'));
  assert.ok(manifest.dsh.profile.bundles.includes('@ai-girlfriend/jev-plugin'));
  const observer = path.join(sandbox, 'observe.mjs'), patch = path.join(sandbox, 'observe.patch.yml');
  const request = { schemaVersion: 1, kind: 'choice', requestId: 'load-request', turnId: 'load-turn', candidates: [{ id: 'ask', action: 'clarify', args: { question: 'Test-only clarification' } }] };
  await writeFile(observer, `export const name='jev-test-observer'; export const inject=['companionDecision']; export async function apply(ctx) { const service=ctx.companionDecision; const result=await service.decide(${JSON.stringify(request)}); process.stderr.write('JEV_LOAD_CHECK:'+JSON.stringify({status:service.status(),result})+'\\n'); }\n`);
  await writeFile(patch, `- insert:\n    - id: jev-test-observer\n      name: ${JSON.stringify(observer)}\n`);
  const child = spawn(process.execPath, [cli, '--profile', 'sdk', '--patch', patch], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await delay(100); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); } });
  const deadline = Date.now() + 30000;
  while (!errors.includes('JEV_LOAD_CHECK:') && Date.now() < deadline && child.exitCode === null) await delay(20);
  const marker = errors.split('\n').find(line => line.startsWith('JEV_LOAD_CHECK:'));
  assert.ok(marker, cleanDiagnostic(errors));
  const observation = JSON.parse(marker.slice('JEV_LOAD_CHECK:'.length));
  assert.equal(observation.status.status, 'unconfigured'); assert.equal(observation.status.sdkVersion, '0.6.0');
  assert.equal(observation.result.status, 'unconfigured'); assert.equal(observation.result.decision, null);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { cwd, provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 32 } }) + '\n');
  let initialized;
  while (Date.now() < deadline && child.exitCode === null) {
    for (const line of output.split('\n')) { try { const reply = JSON.parse(line); if (reply.id === 1) initialized = reply; } catch {} }
    if (initialized) break; await delay(20);
  }
  assert.equal(initialized?.result?.serverInfo?.name, 'deepseek-harness-sdk-runtime', cleanDiagnostic(errors));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'shutdown' }) + '\n');
  const exit = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(exit, 0); assert.equal(output.includes('session/prompt'), false);
});
