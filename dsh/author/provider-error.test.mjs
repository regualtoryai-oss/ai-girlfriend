import test, {before, after, mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {providerFailure, providerChunk} from './provider-error.mjs';

// Match the pinned DSH LlmError's own failure fields without installing a host,
// registering a workflow, touching real configuration or calling a provider.
const hook = registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-llm') return {
    shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
      export class LlmError extends Error {
        constructor(message, code, options = {}) {
          super(message); this.name = 'LlmError'; this.code = code;
          this.failure = Object.freeze({message, code, ...options});
        }
      }
      export function createUserMessage(){throw Error('Unexpected workflow execution')}
    `),
  };
  return nextResolve(specifier, context);
}});
const {apply} = await import('./author-budget.mjs');
const {LlmError} = await import('@deepseek-ai/dsh-llm');
hook.deregister();
let networkCalls = 0;
before(() => mock.method(globalThis, 'fetch', () => {networkCalls++; throw Error('Network forbidden in provider-error tests');}));
after(() => {assert.equal(networkCalls, 0); mock.restoreAll();});

const privateKey = 'SYNTHETIC-ERROR-KEY-NOT-A-CREDENTIAL';
const privatePath = 'C:\\Private-Synthetic\\credential-file.json';
const leaked = `${privateKey} ${privatePath}`;
function publicJson(value) { return JSON.stringify(value); }
function noPrivate(value) {
  const text = typeof value === 'string' ? value : publicJson(value);
  assert.equal(text.includes(privateKey), false);
  assert.equal(text.includes(privatePath), false);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-provider-error-'));
  const previous = new Map(['COMPANION_DATA_ROOT', 'COMPANION_MODEL_ORIGIN'].map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
    const target = path.resolve(root), temporary = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(target.startsWith(temporary) && path.basename(target).startsWith('companion-provider-error-'));
    fs.rmSync(target, {recursive: true, force: true});
  });
  const origin = 'https://newapi1.1234bot.com';
  process.env.COMPANION_DATA_ROOT = root;
  process.env.COMPANION_MODEL_ORIGIN = origin;
  const config = path.join(root, 'private-config');
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, 'usage-budget.json'), JSON.stringify({authorized: true, forwardTestsAuthorized: true, unit: 'USD', limit: 1, entries: []}));
  fs.writeFileSync(path.join(config, 'verified-prices.json'), JSON.stringify({[origin]: {'deepseek-v4-flash': {model: 'deepseek-v4-flash', verified: true, unit: 'USD', inputPerMillion: 1, outputPerMillion: 1, groupMultiplier: 1}}}));
  let stream;
  apply({on(name, handler, options) {assert.equal(name, 'llm/stream'); assert.deepEqual(options, {global: true}); stream = handler;}}, {maxRequestBytes: 65536, maxOutputTokens: 2048});
  const records = () => ({
    ledger: JSON.parse(fs.readFileSync(path.join(config, 'usage-budget.json'), 'utf8')),
    calls: fs.readFileSync(path.join(root, 'author-evidence/model-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse),
  });
  return {stream, records, options: {model: 'deepseek-v4-flash', messages: [], maxTokens: 16, signal: new AbortController().signal}};
}
async function consume(stream) {const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks;}
const usage = {type: 'usage', usage: {inputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 4, totalTokens: 16}};

test('terminal failures discard private messages, ids, causes and failure replay metadata', () => {
  const failure = {message: leaked, code: 'AUTH', status: 401, requestId: leaked, cause: leaked, providerRetryAfterMs: 25};
  const input = {type: 'finish', reason: {kind: 'error', failure}, replayState: {private: leaked}};
  const result = providerChunk(input);
  assert.deepEqual(result, {type: 'finish', reason: {kind: 'error', failure: {message: 'Provider request failed (AUTH)', code: 'AUTH', status: 401, providerRetryAfterMs: 25}}});
  noPrivate(result);
  assert.equal(input.reason.failure, failure);
  assert.equal(failure.message, leaked);
  assert.deepEqual(providerFailure({message: leaked, code: leaked, status: 999, providerRetryAfterMs: -1}), {code: 'UNKNOWN', message: 'Provider request failed (UNKNOWN)'});
});

test('compaction, quota and existing retry diagnostics retain only their stable machine facts', () => {
  for (const code of ['CONTEXT_WINDOW_EXCEEDED', 'QUOTA', 'EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'MALFORMED_RESPONSE', 'MISSING_CREDENTIAL', 'HTTP_418']) {
    const output = providerFailure({message: leaked, code, status: 418, providerRetryAfterMs: 32, requestId: leaked});
    assert.deepEqual(output, {code, message: `Provider request failed (${code})`, status: 418, providerRetryAfterMs: 32});
    noPrivate(output);
  }
  // Unknown DeepSeek finish_reason becomes an uppercase code upstream; it must
  // never pass through merely because it resembles a conventional machine code.
  const output = providerFailure({message: leaked, code: privateKey.toUpperCase()});
  assert.deepEqual(output, {code: 'UNKNOWN', message: 'Provider request failed (UNKNOWN)'});
  noPrivate(output);
});

test('normal text, usage and all successful finish reasons retain their objects and serialized bytes', () => {
  for (const chunk of [
    {type: 'text-delta', index: 0, text: 'Original response 你好'}, usage,
    ...['stop', 'tool-calls', 'max-tokens'].map(kind => ({type: 'finish', reason: {kind}, replayState: {provider: 'unchanged'}})),
  ]) {
    const original = publicJson(chunk);
    assert.equal(providerChunk(chunk), chunk);
    assert.equal(publicJson(providerChunk(chunk)), original);
  }
});

test('a thrown provider error keeps safe taxonomy and settlement without carrying its cause', async t => {
  const f = fixture(t), raw = Object.assign(new Error(leaked, {cause: new Error(leaked)}), {code: 'AUTH', failure: {message: leaked, code: 'AUTH', status: 401, requestId: leaked}});
  await assert.rejects(consume(f.stream(f.options, async function*() {throw raw;})), error => {
    assert.ok(error instanceof LlmError);
    assert.deepEqual(error.failure, {message: 'Provider request failed (AUTH)', code: 'AUTH', status: 401});
    assert.equal(error.cause, undefined);
    noPrivate(error.stack); noPrivate(error.failure);
    return true;
  });
  const {ledger, calls} = f.records();
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].state, 'finished');
  assert.equal(ledger.entries[0].maximum, (65536 + 16) / 1e6);
  assert.equal(ledger.entries[0].httpStatus, 0);
  assert.deepEqual(ledger.entries[0].reportedUsage, {});
  assert.equal(calls.length, 1); assert.equal(calls[0].status, 0);
  noPrivate(ledger); noPrivate(calls);
});

test('in-band error finish preserves order and usage and settles the retained reservation once', async t => {
  const f = fixture(t), text = {type: 'text-delta', index: 0, text: 'Partial ordinary reply'};
  const output = await consume(f.stream(f.options, async function*() {
    yield text; yield usage;
    yield {type: 'finish', reason: {kind: 'error', failure: {message: leaked, code: 'RATE_LIMIT', status: 429, requestId: leaked}}};
  }));
  assert.equal(output[0], text); assert.equal(output[1], usage);
  assert.deepEqual(output[2], {type: 'finish', reason: {kind: 'error', failure: {message: 'Provider request failed (RATE_LIMIT)', code: 'RATE_LIMIT', status: 429}}});
  const {ledger, calls} = f.records();
  assert.equal(ledger.entries.length, 1); assert.equal(ledger.entries[0].state, 'finished'); assert.equal(ledger.entries[0].httpStatus, 200);
  assert.deepEqual(ledger.entries[0].reportedUsage, {prompt_tokens: 12, completion_tokens: 4, total_tokens: 16});
  assert.equal(calls.length, 1); noPrivate(output); noPrivate(ledger); noPrivate(calls);
});

test('aborted finishes and thrown cancellation keep cancellation facts and retained usage', async t => {
  const aborted = providerChunk({type: 'finish', reason: {kind: 'aborted', failure: {message: leaked, code: 'ABORTED', requestId: leaked}}});
  assert.deepEqual(aborted, {type: 'finish', reason: {kind: 'aborted', failure: {message: 'Provider request cancelled', code: 'ABORTED'}}});
  const f = fixture(t), controller = new AbortController(); f.options.signal = controller.signal;
  await assert.rejects(consume(f.stream(f.options, async function*() {yield usage; controller.abort(); throw new DOMException(leaked, 'AbortError');})), error => {
    assert.ok(error instanceof LlmError); assert.equal(error.code, 'ABORTED'); noPrivate(error.stack); noPrivate(error.failure); return true;
  });
  const {ledger, calls} = f.records();
  assert.equal(controller.signal.aborted, true); assert.equal(ledger.entries.length, 1); assert.equal(calls.length, 1);
  assert.equal(ledger.entries[0].state, 'finished'); assert.equal(ledger.entries[0].httpStatus, 200);
  assert.deepEqual(ledger.entries[0].reportedUsage, {prompt_tokens: 12, completion_tokens: 4, total_tokens: 16});
});

test('normal stream finish passes through unchanged and keeps the existing accounting', async t => {
  const f = fixture(t), finish = {type: 'finish', reason: {kind: 'max-tokens'}, replayState: {cursor: 'normal-replay'}};
  const output = await consume(f.stream(f.options, async function*() {yield usage; yield finish;}));
  assert.deepEqual(output, [usage, finish]); assert.equal(output[0], usage); assert.equal(output[1], finish);
  const {ledger, calls} = f.records();
  assert.equal(ledger.entries.length, 1); assert.equal(calls.length, 1); assert.equal(calls[0].status, 200);
  assert.deepEqual(ledger.entries[0].reportedUsage, {prompt_tokens: 12, completion_tokens: 4, total_tokens: 16});
});
