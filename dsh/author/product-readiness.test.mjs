import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {readConfiguration, assertTaskConfiguration, RELAY_ORIGIN} from '../../config/readiness.mjs';
import {initializeConfiguration} from '../../scripts/configure.mjs';
import {artifactCatalog, artifactDownload} from './artifact-catalog.mjs';
import {authorReadiness, inspectVoice, projectVoiceHealth} from './author-readiness.mjs';
import {apply as applyDeliverables} from './author-deliverables.mjs';
import {hash} from '../../server/workspace-files.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'companion-product-'));
  const dataRoot = path.join(root, 'data'), workspaceRoot = path.join(dataRoot, 'workspace');
  mkdirSync(path.join(dataRoot, 'private-config'), {recursive: true});
  mkdirSync(path.join(dataRoot, 'author-evidence'), {recursive: true});
  mkdirSync(workspaceRoot, {recursive: true});
  const json = (name, value) => writeFileSync(path.join(dataRoot, 'private-config', name + '.json'), JSON.stringify(value));
  json('providers', {relay: {baseUrl: RELAY_ORIGIN, apiKey: 'SYNTHETIC-RELAY-ONLY'}, jev: {baseUrl: 'https://api.typesafe.ai', apiKey: 'SYNTHETIC-JEV-ONLY'}});
  json('usage-budget', {authorized: true, forwardTestsAuthorized: true, limit: 1, unit: 'USD', entries: []});
  json('verified-prices', {[RELAY_ORIGIN]: {'deepseek-v4-flash': {model: 'deepseek-v4-flash', unit: 'USD', verified: true, inputPerMillion: 1, outputPerMillion: 2, groupMultiplier: 1}}});
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return {root, dataRoot, workspaceRoot, json};
}
function approve(f, relative, contents, op = 'create') {
  const file = path.join(f.workspaceRoot, relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, contents);
  const record = {op, path: relative, bytes: Buffer.byteLength(contents), sha256: hash(Buffer.from(contents))};
  const manifest = path.join(f.dataRoot, 'author-evidence', 'artifacts.json');
  const previous = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : [];
  writeFileSync(manifest, JSON.stringify([...previous, record]));
  return record;
}

test('configuration inspection is secret-free and blocks string authorization or tiny remaining allowance', t => {
  const f = fixture(t);
  assert.equal(readConfiguration(f.root, {}).ready, true);
  assert.doesNotMatch(JSON.stringify(readConfiguration(f.root, {})), /SYNTHETIC-RELAY-ONLY|SYNTHETIC-JEV-ONLY|entries|inputPerMillion/);
  for (const settings of [
    {authorized: 'true', forwardTestsAuthorized: true, limit: 1, unit: 'USD', entries: []},
    {authorized: true, forwardTestsAuthorized: 'true', limit: 1, unit: 'USD', entries: []},
    {authorized: true, forwardTestsAuthorized: true, limit: 0.000001, unit: 'USD', entries: []},
    {authorized: true, forwardTestsAuthorized: true, limit: 1, unit: 'USD', entries: [{maximum: -1}]},
  ]) {
    f.json('usage-budget', settings);
    assert.equal(readConfiguration(f.root, {}).ready, false);
    assert.throws(() => assertTaskConfiguration(f.root, {}));
  }
});

test('configuration rejects wrong providers and malformed price files without echoing private text', t => {
  const f = fixture(t);
  f.json('providers', {relay: {baseUrl: 'https://invalid.example', apiKey: 'SYNTHETIC-RELAY-ONLY'}, jev: {baseUrl: 'https://api.typesafe.ai', apiKey: ''}});
  let result = readConfiguration(f.root, {DEEPSEEK_API_KEY: 'UNRELATED-AMBIENT-KEY'});
  assert.equal(result.relayConfigured, false);
  assert.equal(result.jevConfigured, false);
  writeFileSync(path.join(f.dataRoot, 'private-config', 'verified-prices.json'), '{SYNTHETIC-PRIVATE-TEXT');
  result = readConfiguration(f.root, {});
  assert.equal(result.pricesVerified, false);
  assert(result.issues.some(issue => issue.code === 'PRICES_CONFIG_INVALID'));
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|invalid.example|UNRELATED-AMBIENT/);
});

test('template initialization preserves existing configuration and grants no authorization', t => {
  const f = fixture(t), config = path.join(f.root, 'config');
  mkdirSync(config);
  for (const name of ['providers', 'usage-budget', 'verified-prices']) writeFileSync(path.join(config, name + '.example.json'), '{}');
  const original = readFileSync(path.join(f.dataRoot, 'private-config', 'providers.json'));
  const result = initializeConfiguration(f.root);
  assert.equal(result.credentialsWritten, false);
  assert.equal(result.budgetGranted, false);
  assert.equal(result.preserved.length, 3);
  assert.deepEqual(readFileSync(path.join(f.dataRoot, 'private-config', 'providers.json')), original);
});

test('artifacts require real approval receipts, preserve current hash and reject changed or unapproved files', t => {
  const f = fixture(t), approved = approve(f, 'report.txt', 'approved contents');
  writeFileSync(path.join(f.workspaceRoot, 'unapproved.txt'), 'private file');
  assert.deepEqual(artifactCatalog(f).artifacts, [{path: approved.path, name: 'report.txt', bytes: approved.bytes, sha256: approved.sha256}]);
  assert.equal(artifactDownload('report.txt', f).bytes.toString(), 'approved contents');
  assert.throws(() => artifactDownload('unapproved.txt', f), /ARTIFACT_NOT_APPROVED/);
  writeFileSync(path.join(f.workspaceRoot, 'report.txt'), 'later edit');
  assert.throws(() => artifactDownload('report.txt', f), /ARTIFACT_CHANGED/);
  assert.deepEqual(artifactCatalog(f).unavailable, [{path: 'report.txt', code: 'ARTIFACT_CHANGED'}]);
});

test('artifact catalog rejects private paths and junctions instead of exposing arbitrary files', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside');
  mkdirSync(outside); writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  symlinkSync(outside, path.join(f.workspaceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const paths = ['../outside/secret.txt', '/absolute/secret.txt', '.env', 'private-config/providers.json', 'linked/secret.txt'];
  writeFileSync(path.join(f.dataRoot, 'author-evidence', 'artifacts.json'), JSON.stringify(paths.map(relative => ({op: 'create', path: relative, bytes: 6, sha256: hash(Buffer.from('secret'))}))));
  assert.deepEqual(artifactCatalog(f), {artifacts: [], unavailable: []});
  for (const relative of paths) assert.throws(() => artifactDownload(relative, f));
});

test('dynamic downloads remain authenticated-registry attachments and empty checkout has no dead demo links', async t => {
  const f = fixture(t), old = {data: process.env.COMPANION_DATA_ROOT, workspace: process.env.COMPANION_WORKSPACE_ROOT};
  process.env.COMPANION_DATA_ROOT = f.dataRoot; process.env.COMPANION_WORKSPACE_ROOT = f.workspaceRoot;
  t.after(() => {for (const [key, value] of [['COMPANION_DATA_ROOT', old.data], ['COMPANION_WORKSPACE_ROOT', old.workspace]]) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}});
  const routes = new Map();
  applyDeliverables({effect: fn => fn(), connection: {fetch: {register: route => routes.set(route.path, route)}}});
  const empty = await routes.get('/api/companion/deliverables').fetch().text();
  assert.match(empty, /还没有可下载/); assert.doesNotMatch(empty, /START-HERE|xiaowan-real-task-demo/);
  approve(f, 'result.html', '<script>fetch("/api/private")</script>');
  const route = routes.get('/api/companion/artifacts/download');
  assert.deepEqual(route.methods, ['GET']);
  const response = route.fetch(new Request('http://127.0.0.1/api/companion/artifacts/download?path=result.html'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
  assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  writeFileSync(path.join(f.workspaceRoot, 'result.html'), 'changed');
  assert.equal(route.fetch(new Request('http://127.0.0.1/api/companion/artifacts/download?path=result.html')).status, 409);
});

test('voice diagnostics use fixed loopback without credentials, redirects, warmup or raw bridge errors', async t => {
  const f = fixture(t), calls = [];
  const fetcher = async (url, options) => {calls.push({url, options}); return Response.json({stt: false, tts: false,
    readiness: {status: 'blocked', code: 'MODEL_MISSING', checks: [{code: 'MODEL_FILES', ok: false}]}, stt_error: 'SYNTHETIC-SECRET C:/private/user/path'});};
  const status = await authorReadiness(f.root, {COMPANION_DATA_ROOT: f.dataRoot}, fetcher);
  assert.equal(status.voice.code, 'MODEL_MISSING');
  assert.equal(status.avatar.liveLipSync, false);
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/api/health');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers, undefined);
  assert.doesNotMatch(JSON.stringify(status), /SYNTHETIC|C:\/private|apiKey|stt_error/);
  assert.equal(projectVoiceHealth({status: 'ok', stt: false, tts: false}).status, 'unchecked');
  assert.equal((await inspectVoice(async () => {throw Error('private failure');})).code, 'VOICE_SERVICE_UNAVAILABLE');
});

test('the actual Jev pre-step hook refuses calls before routing when budget is unapproved or insufficient', async t => {
  const f = fixture(t), previous = {data: process.env.COMPANION_DATA_ROOT, jev: process.env.COMPANION_JEV_KEY};
  process.env.COMPANION_DATA_ROOT = f.dataRoot; process.env.COMPANION_JEV_KEY = 'SYNTHETIC-JEV-ONLY';
  t.after(() => {for (const [key, value] of [['COMPANION_DATA_ROOT', previous.data], ['COMPANION_JEV_KEY', previous.jev]]) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}});
  const stubs = new Map([
    ['@deepseek-ai/dsh-tools', 'export function defineTool(){throw Error("No tools in this test")}'],
    ['@deepseek-ai/dsh-llm', 'export function createUserMessage(){throw Error("No recovery in this test")}'],
    ['@typesafe-ai/sdk', 'export class TypeSafeClient {}'],
  ]);
  const hook = registerHooks({resolve(specifier, context, nextResolve) {return stubs.has(specifier) ? {url: 'data:text/javascript,' + encodeURIComponent(stubs.get(specifier)), shortCircuit: true} : nextResolve(specifier, context);}});
  let apply;
  try {({apply} = await import('./author-jev-loop.mjs?product-guard-test'));} finally {hook.deregister();}
  const handlers = new Map(); let decisions = 0, delegated = 0;
  apply({effect: fn => fn(), tools: {guard: () => {}}, on: (name, fn) => handlers.set(name, fn), companionDecision: {bindClient: () => {}, decide: async () => {decisions++; throw Error('Unexpected provider request');}}});
  const p = {messages: [{role: 'user', content: [{type: 'text', text: 'synthetic request'}]}], agent: {session: {id: 'synthetic-current-session'}}, turn: 1};
  for (const limit of [0, 0.000001]) {
    f.json('usage-budget', {authorized: limit > 0, forwardTestsAuthorized: limit > 0, limit, unit: 'USD', entries: []});
    await assert.rejects(handlers.get('agent/pre-step')(p, async () => {delegated++;}), /FORWARD_BUDGET_PENDING|BUDGET_LIMIT/);
  }
  assert.equal(decisions, 0); assert.equal(delegated, 0);
});
