import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createDemoServer } from './demo.mjs';
import { createServer } from './app.mjs';

async function setup(t) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'companion-demo-'));
  const server = createDemoServer({ dataRoot });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(dataRoot, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (url, input) => { const res = await fetch(origin + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(input) }); assert.ok(res.ok); return res.json(); };
  const get = async id => (await fetch(`${origin}/api/conversations/${id}`)).json();
  async function waitFor(id, state) { for (let i = 0; i < 100; i++) { const job = await get(id); if (job.state === state) return job; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error(`No ${state} state`); }
  return { dataRoot, origin, post, get, waitFor };
}

test('offline demo is labelled, blocks external authorization and serves a public SVG', async t => {
  const { origin } = await setup(t);
  const status = await (await fetch(origin + '/api/status')).json();
  assert.equal(status.mode, 'offline-demo'); assert.equal(status.llm, 'demo-mock'); assert.equal(status.externalCallsAuthorized, false);
  assert.throws(() => createServer({ demoMode: true, allowExternalCalls: true }), /cannot authorize external calls/);
  const avatar = await fetch(origin + '/placeholder-avatar.svg'); assert.equal(avatar.status, 200); assert.equal(avatar.headers.get('content-type'), 'image/svg+xml');
  const fallback = await fetch(origin + '/avatar-image'); assert.equal(fallback.status, 200); assert.equal(fallback.headers.get('content-type'), 'image/svg+xml');
  for (const endpoint of ['/api/admin/bootstrap', '/api/admin/config', '/settings.html']) {
    assert.equal((await fetch(origin + endpoint)).status, 403);
  }
  const save = await fetch(origin + '/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ provider: 'relay' }) });
  assert.equal(save.status, 403);
});

test('demo approval creates a real hashed download; duplicate task ID does not duplicate execution', async t => {
  const { origin, post, waitFor, dataRoot } = await setup(t);
  const input = { id: randomUUID(), turnId: randomUUID(), text: '保存一份学习计划' };
  await post('/api/conversation', input);
  const pending = await waitFor(input.id, 'waiting-approval'); assert.equal(pending.artifacts.length, 0);
  assert.deepEqual(await readdir(path.join(dataRoot, 'workspace')), []);
  await post(`/api/conversations/${input.id}/approve`, { approvalId: pending.pending.approvalId, approved: true });
  const done = await waitFor(input.id, 'completed'); assert.equal(done.artifacts.length, 1);
  const download = await fetch(origin + done.artifacts[0].url); const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(download.status, 200); assert.equal(createHash('sha256').update(bytes).digest('hex'), done.artifacts[0].sha256);
  await post('/api/conversation', input); assert.equal((await waitFor(input.id, 'completed')).artifacts.length, 1);
});

test('declining or cancelling demo approval leaves no file', async t => {
  const { post, waitFor, dataRoot } = await setup(t);
  for (const decision of ['decline', 'cancel']) {
    const id = randomUUID(); await post('/api/conversation', { id, turnId: randomUUID(), text: '保存一份练习文件' });
    const pending = await waitFor(id, 'waiting-approval');
    if (decision === 'decline') { await post(`/api/conversations/${id}/approve`, { approvalId: pending.pending.approvalId, approved: false }); await waitFor(id, 'completed'); }
    else { await post(`/api/conversations/${id}/cancel`, {}); await waitFor(id, 'cancelled'); }
  }
  assert.deepEqual(await readdir(path.join(dataRoot, 'workspace')), []);
});
