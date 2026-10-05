import test from 'node:test';import assert from 'node:assert/strict';import {parseResponse} from './response-parser.mjs';
test('recovers final public answer when relay completes with empty output',()=>{
 const events=[{type:'response.output_text.done',output_index:1,text:''},{type:'response.output_text.done',output_index:5,text:'{"code":"ok"}'},{type:'response.completed',response:{output:[],usage:{input_tokens:4336}}}];
 const r=parseResponse(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join(''),'responses');assert.equal(r.output_text,'{"code":"ok"}');assert.equal(r.usage.input_tokens,4336);
});
test('delta fallback does not concatenate commentary with final answer',()=>{const events=[{type:'response.output_text.delta',output_index:1,delta:'preamble'},{type:'response.output_text.delta',output_index:3,delta:'answer'},{type:'response.completed',response:{output:[]}}];assert.equal(parseResponse(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join(''),'responses').output_text,'answer');});
