import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateReadiness, formatReadiness, machineJson} from './doctor-core.mjs';

function ready() {
  return {system: {windows: true, node24: true, git: true, python312: true, visualCpp: true}, harness: {exists: true, pinned: true, compiled: true, profile: true, rootDependencies: true, fileSerializer: true}, configuration: {relayConfigured: true, jevConfigured: true, budgetAuthorized: true, forwardAuthorized: true, pricesVerified: true, budgetAvailable: true}, media: {valid: true}, ports: {host: {state: 'free'}, voice: {state: 'owned'}}, voice: {runtime_ready: true, voice_ready: true, checks: []}};
}

test('fully prepared original components report ready without exposing observations', () => {
  const fixture = ready(); fixture.configuration.apiKey = 'synthetic-secret-never-print'; fixture.configuration.limit = 123456789;
  fixture.ports.voice.commandLine = 'synthetic-private-process';
  const report = evaluateReadiness(fixture);
  assert.equal(report.status, 'ready'); assert.equal(report.ready, true); assert.deepEqual(report.error_codes, []);
  const output = JSON.stringify(report) + formatReadiness(report);
  for (const privateValue of ['synthetic-secret-never-print', '123456789', 'synthetic-private-process']) assert.equal(output.includes(privateValue), false);
  assert(!/[^\x00-\x7f]/.test(machineJson(report)));
  assert.deepEqual(JSON.parse(machineJson(report)), report);
});
test('installation requires system dependencies but neither credentials nor budgets', () => {
  const fixture = ready(); fixture.configuration = {}; fixture.voice = {}; fixture.harness = {};
  assert.equal(evaluateReadiness(fixture, 'install').ready, true);
  fixture.system.visualCpp = false;
  const report = evaluateReadiness(fixture, 'install');
  assert.equal(report.status, 'system-dependencies-needed'); assert.deepEqual(report.error_codes, ['VISUAL_CPP_REQUIRED']);
});
test('keys gate UI startup while closed budget and quote guards allow UI with tasks blocked', () => {
  for (const key of ['relayConfigured', 'jevConfigured']) {
    const fixture = ready(); fixture.configuration[key] = false;
    const report = evaluateReadiness(fixture, 'text');
    assert.equal(report.ready, false); assert.equal(report.status, 'configuration-needed'); assert.equal(report.configuration[key], false);
  }
  for (const key of ['budgetAuthorized', 'forwardAuthorized', 'pricesVerified', 'budgetAvailable']) {
    const fixture = ready(); fixture.configuration[key] = false;
    const report = evaluateReadiness(fixture, 'text');
    assert.equal(report.ready, true); assert.equal(report.status, 'ui-ready-tasks-blocked');
    assert.equal(report.capabilities.task_ready, false); assert.equal(report.capabilities.text_ready, false);
  }
});
test('a different project listener or unknown process owner prevents every launch mode', () => {
  for (const port of ['host', 'voice']) for (const state of ['foreign', 'unknown']) {
    const fixture = ready(); fixture.ports[port].state = state;
    for (const mode of ['voice', 'text']) assert.equal(evaluateReadiness(fixture, mode).ready, false);
  }
});
test('missing original models or GPU permits only an explicit text choice with the same bridge', () => {
  const fixture = ready(); fixture.voice.voice_ready = false;
  fixture.voice.checks = [{code: 'MODELS_UNVERIFIED', status: 'missing', message: '原模型未验证', action: '核验原模型'}];
  const full = evaluateReadiness(fixture);
  assert.equal(full.ready, false); assert.equal(full.status, 'ui-ready-voice-not-ready'); assert.equal(full.capabilities.text_ready, true);
  assert.equal(evaluateReadiness(fixture, 'text').ready, true);
  fixture.voice.runtime_ready = false;
  const text = evaluateReadiness(fixture, 'text');
  assert.equal(text.ready, false); assert(text.error_codes.includes('BRIDGE_RUNTIME_REQUIRED'));
});
test('missing or replaced original image prevents launch without substituting a character', () => {
  const fixture = ready(); fixture.media = {valid: false, missing: false};
  assert(evaluateReadiness(fixture).error_codes.includes('CURRENT_MEDIA_REQUIRED'));
});
test('wrong Harness version and incomplete build have distinct actionable codes', () => {
  const fixture = ready(); fixture.harness.pinned = false; fixture.harness.compiled = false;
  const report = evaluateReadiness(fixture);
  assert(report.error_codes.includes('HARNESS_COMMIT_REQUIRED')); assert(report.error_codes.includes('HARNESS_BUILD_REQUIRED'));
});
test('voice resource check failure cannot be hidden by an inconsistent voice_ready flag', () => {
  const fixture = ready(); fixture.voice.checks = [{code: 'CUDA_BF16_REQUIRED', status: 'missing', message: 'BF16 未就绪', action: '核对原GPU环境'}];
  assert.equal(evaluateReadiness(fixture).ready, false); assert.equal(evaluateReadiness(fixture, 'text').ready, true);
});
test('actual Python ok status is accepted and invalid private configuration still blocks', () => {
  const fixture = ready(); fixture.voice.checks = [{code: 'MODEL_READY', status: 'ok', message: '原模型就绪', action: ''}];
  assert.equal(evaluateReadiness(fixture).ready, true);
  fixture.configuration.ready = false; fixture.configuration.issues = [{code: 'PROVIDERS_CONFIG_INVALID'}];
  assert.equal(evaluateReadiness(fixture, 'text').ready, false);
});
