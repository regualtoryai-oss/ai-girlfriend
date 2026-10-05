import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeRoutedTask } from './routed-task.mjs';

test('disabled relay prevents coding and image requests before budget or network', async t => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'relay-disabled-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  await mkdir(path.join(dataRoot, 'private-config'));
  await writeFile(path.join(dataRoot, 'private-config/providers.json'), JSON.stringify({
    relay: { enabled: false, apiKey: 'SYNTHETIC', catalog: { modelIds: ['gpt-6.1-sol', 'grok-imagine-image'] } },
  }));
  let calls = 0;
  for (const taskType of ['coding', 'image']) {
    await assert.rejects(() => executeRoutedTask({
      dataRoot, taskType, text: 'test', fetchImpl: () => { calls++; throw new Error('must not request'); },
    }), { code: 'RELAY_DISABLED' });
  }
  assert.equal(calls, 0);
});
