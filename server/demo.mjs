import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from './app.mjs';
import { workspaceFiles } from './workspace-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Deterministic test double: no model SDK, credentials, network or microphone.
export function createDemoAdapter(dataRoot) {
  const files = workspaceFiles(path.join(dataRoot, 'workspace'), path.join(dataRoot, 'file-backups'));
  return {
    async execute({ text, turnId, signal, onEvent, onApproval, onArtifacts }) {
      signal?.throwIfAborted();
      onEvent({ type: 'demo', summary: '离线演示：使用确定性规则，不调用模型。' });
      if (!/保存|文件|Markdown|计划|练习/i.test(text)) {
        return { text: '这是无凭据离线演示，回复由本地固定规则生成。你可以输入“保存一份学习计划”，体验草稿预览、审批、文件写入与下载。' };
      }
      const changes = [{ op: 'create', path: `demo/${turnId}.md`, content: `# 离线演示草稿\n\n这是固定规则生成的教学文件，并非模型输出。\n\n你的输入：\n${text}\n\n- 阅读 Agent 执行循环\n- 验证审批与文件写入\n- 记录一个失败案例\n` }];
      files.validate(changes);
      const approved = await onApproval({
        approvalId: randomUUID(),
        digest: createHash('sha256').update(JSON.stringify(changes)).digest('hex'),
        summary: '离线演示：确认后在独立演示工作区保存这份 Markdown 草稿。',
        changes: files.preview(changes),
      });
      signal?.throwIfAborted();
      if (!approved) return { text: '你没有批准这次写入，未创建文件。' };
      onEvent({ type: 'tool-start', tool: 'demo_write_note', summary: '执行已批准的本地文件写入。' });
      const artifacts = files.apply(changes);
      onArtifacts(artifacts);
      onEvent({ type: 'tool-result', tool: 'demo_write_note', summary: '真实文件已写入并完成哈希校验。' });
      return { text: `离线演示草稿已保存：${changes[0].path}。可以在任务详情下载。` };
    },
  };
}

export function createDemoServer({ dataRoot = path.join(root, 'data', 'demo'), ...options } = {}) {
  return createServer({ ...options, dataRoot, adapters: { harness: createDemoAdapter(dataRoot) }, demoMode: true, allowExternalCalls: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.COMPANION_PORT || 8793);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log(`Offline demo: http://127.0.0.1:${port} (no model calls)`));
  const shutdown = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
