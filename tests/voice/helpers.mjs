import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import * as plugin from '../../packages/voice-plugin/index.mjs';
export const { Context } = createRequire(new URL('../../packages/voice-plugin/package.json', import.meta.url))('@deepseek-ai/cordis');
export const ids = (turn = 't1', sessionId = 's1') => ({ sessionId, requestId: `r-${turn}`, turnId: turn });
export const pause = () => new Promise(resolve => setImmediate(resolve));
export async function mount(t, config = {}) { const ctx = new Context(), fiber = ctx.plugin(plugin, config); await fiber.await(); t.after(() => ctx.fiber.dispose()); return { ctx, fiber, service: ctx.get('companionVoice') }; }
export async function fixture(t, handler) {
  const server = createServer((request, response) => { Promise.resolve(handler(request, response)).catch(() => { response.writeHead(500); response.end(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/transcribe`;
}
export async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); }
export function json(response, value) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
