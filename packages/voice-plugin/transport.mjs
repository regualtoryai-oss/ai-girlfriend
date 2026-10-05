import { bounded, fromWav, identity, requireThat, VoiceError } from './audio.mjs';

export function localEndpoint(value) {
  let url; try { url = new URL(value); } catch { throw new VoiceError('invalid_endpoint'); }
  requireThat(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash, 'invalid_endpoint');
  return url.href;
}

/** Real file-ASR transport. Nothing is called until transcribe(); no credentials or discovery. */
export function createLocalAsrTransport({ endpoint, timeoutMs = 15000, format = 'multipart' }) {
  const url = localEndpoint(endpoint);
  requireThat(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60000, 'invalid_timeout');
  requireThat(['multipart', 'wav'].includes(format), 'invalid_format');
  return Object.freeze({ async transcribe(input, { signal }) {
    const ids = identity(input); fromWav(input.wav);
    return bounded(async requestSignal => {
      let body = input.wav; const headers = { 'X-Request-Id': ids.requestId, 'X-Turn-Id': ids.turnId, 'X-Max-Audio-Sec': '30' };
      if (format === 'multipart') { body = new FormData(); body.set('file', new Blob([input.wav], { type: 'audio/wav' }), 'utterance.wav'); for (const [key, value] of Object.entries(ids)) body.set(key, value); }
      else headers['Content-Type'] = 'audio/wav';
      const response = await fetch(url, { method: 'POST', body, headers, signal: requestSignal, redirect: 'error', credentials: 'omit' });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) { await response.body?.cancel(); throw new VoiceError('asr_error'); }
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; requireThat(size <= 65536, 'asr_response_too_large'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new VoiceError('invalid_transcript'); }
      requireThat(result && typeof result.text === 'string' && result.text.length <= 8000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result.text), 'invalid_transcript');
      return { text: result.text.trim() };
    }, signal, timeoutMs);
  } });
}
