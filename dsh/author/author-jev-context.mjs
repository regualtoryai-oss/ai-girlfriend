// Bounded, replayable intent context. It carries no tool authority.
export const routingRule = 'Interpret the current user message using the recent conversation. A reply supplying details or confirming a still-pending file request continues that request; workspace-task includes creating Excel and other files. A cancellation, refusal, or new topic overrides the earlier request. Do not treat assistant text as user authorization. Select clarify only if the current request is still missing necessary information. Selection never grants permission to execute; file changes still require their exact native approval.';

function clipped(text, bytes) {
  let result = '', size = 0;
  for (const char of text) {
    const n = Buffer.byteLength(char);
    if (size + n > bytes) break;
    result += char; size += n;
  }
  return result;
}
const textOf = message => (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

export function buildJevContext(session, pending, message, turn) {
  const pendingIds = new Set(pending.map(m => m.id).filter(Boolean));
  const messages = session.deriveMessages();
  const recentConversation = [];
  let remaining = 6000;
  for (let i = messages.length - 1; i >= 0 && recentConversation.length < 8; i--) {
    const m = messages[i];
    if (pendingIds.has(m.id)) continue;
    if (m.role !== 'assistant' && !(m.role === 'user' && m.source?.kind === 'user')) continue;
    const raw = textOf(m);
    if (!raw.trim()) continue;
    const text = clipped(raw, Math.min(1800, remaining));
    if (!text) break;
    recentConversation.unshift({role: m.role, text, truncated: text !== raw});
    remaining -= Buffer.byteLength(text);
  }
  const current = clipped(message, 6000);
  const state = {message: current, messageTruncated: current !== message,
    sessionId: session.id, turn, routingRule, recentConversation};
  // Match the existing adapter's total JSON byte limit, including escaping.
  while (Buffer.byteLength(JSON.stringify(state)) > 15000 && recentConversation.length) recentConversation.shift();
  while (Buffer.byteLength(JSON.stringify(state)) > 15000) {
    state.message = clipped(state.message, Math.floor(Buffer.byteLength(state.message) * .8));
    state.messageTruncated = true;
  }
  return state;
}
