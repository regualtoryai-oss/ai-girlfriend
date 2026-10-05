// Decode only public answer text. Never expose reasoning content.
export function parseResponse(raw, protocol) {
  try { return JSON.parse(raw); } catch { if (protocol !== 'responses') throw Error('INVALID_JSON'); }
  const frames = raw.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(x=>x&&x!=='[DONE]').map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);
  const end = frames.findLast(x=>['response.completed','response.incomplete'].includes(x.type));
  const result = {...(end?.response||{})};
  const existing = result.output_text || (result.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
  if (!existing) {
    // Some relays send an empty output array in the completed event. The last
    // nonempty done event is their final answer; prior items may be preambles.
    const done = frames.findLast(x=>x.type==='response.output_text.done' && typeof x.text==='string' && x.text.trim());
    if (done) result.output_text=done.text;
    else {
      const deltas=frames.filter(x=>x.type==='response.output_text.delta'&&typeof x.delta==='string');
      const last=deltas.at(-1)?.output_index;
      result.output_text=deltas.filter(x=>x.output_index===last).map(x=>x.delta).join('');
    }
  }
  return result;
}
