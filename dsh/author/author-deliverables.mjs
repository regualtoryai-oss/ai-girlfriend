import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {artifactCatalog, artifactDownload} from './artifact-catalog.mjs';

export const name = 'companion-author-deliverables';
export const inject = ['connection'];
const escapeHtml = text => text.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

/** Routes inherit the pinned Harness connection's host, origin and browser-cookie checks. */
export function apply(ctx) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const roots = {dataRoot: process.env.COMPANION_DATA_ROOT || path.join(root, 'data'),
    workspaceRoot: process.env.COMPANION_WORKSPACE_ROOT || path.join(root, 'data', 'workspace')};
  const register = (route, handler) => ctx.effect(() => ctx.connection.fetch.register({path: route, methods: ['GET'], requestBody: 'buffered', fetch: handler}));
  const catalog = () => artifactCatalog(roots);
  register('/api/companion/artifacts', () => {
    try {return Response.json(catalog(), {headers: {'Cache-Control': 'no-store'}});} catch {
      return Response.json({artifacts: [], unavailable: [], code: 'ARTIFACT_CATALOG_UNAVAILABLE'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  });
  register('/api/companion/artifacts/download', request => {
    const query = new URL(request.url).searchParams;
    if (query.getAll('path').length !== 1) return Response.json({code: 'ARTIFACT_PATH_REQUIRED'}, {status: 400});
    try {
      const file = artifactDownload(query.get('path'), roots);
      return new Response(file.bytes, {headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': "attachment; filename=\"companion-artifact\"; filename*=UTF-8''" + encodeURIComponent(file.name),
        'Content-Length': String(file.bytes.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      }});
    } catch (error) {
      const changed = error.code === 'ARTIFACT_CHANGED';
      return Response.json({code: changed ? 'ARTIFACT_CHANGED' : 'ARTIFACT_UNAVAILABLE',
        message: changed ? '文件已在任务完成后修改，请检查最新成果。' : '该成果尚未批准或当前不可下载。'}, {status: changed ? 409 : 404, headers: {'Cache-Control': 'no-store'}});
    }
  });
  register('/api/companion/deliverables', () => {
    let items, notice = '';
    try {
      const result = catalog();
      items = result.artifacts.map(file => '<li><a href="/api/companion/artifacts/download?path=' + encodeURIComponent(file.path) + '">' + escapeHtml(file.name) + '</a>（' + file.bytes + ' bytes）</li>').join('');
      if (result.unavailable.length) notice = '<p>部分成果已修改或暂不可用，请回到任务面板核对。</p>';
    } catch {items = ''; notice = '<p>成果记录暂不可读取；没有执行新的任务。</p>';}
    return new Response('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>小婉任务成果</title><h1>小婉任务成果</h1>'
      + (items ? '<p>以下文件已经原生审批写入，并与任务记录的哈希一致。点击下载。</p><ul>' + items + '</ul>' : '<p>还没有可下载的已审批成果。在主界面提交任务，确认具体文件计划后，成果会出现在这里。</p>')
      + notice + '<p>这里不会自动执行任务或重试模型。任务状态与待审批计划请查看主界面的任务面板。</p><p><a href="/">返回小婉</a></p></html>', {
      headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"},
    });
  });
}
