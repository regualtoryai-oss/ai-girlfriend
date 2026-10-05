import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplySpeaker} from '../src/client/voice/speaker.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function audioFixture(t){
 const original=globalThis.AudioContext;
 const contexts=[];
 class Context{
  state='running';destination={};sources=[];pending=[];closed=false;
  constructor(){contexts.push(this);}
  resume(){this.state='running';return Promise.resolve();}
  decodeAudioData(bytes){return new Promise(resolve=>this.pending.push({bytes,resolve}));}
  createBufferSource(){const node={started:false,stopped:false,disconnected:false,onended:null,connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;this.onended?.();}};this.sources.push(node);return node;}
  close(){this.closed=true;this.state='closed';return Promise.resolve();}
 }
 globalThis.AudioContext=Context;
 const speaker=new ReplySpeaker();
 t.after(()=>{speaker.dispose();globalThis.AudioContext=original;});
 return {speaker,contexts};
}

test('stopping during decode discards the late audio and every queued clip',async t=>{
 const {speaker,contexts}=audioFixture(t);
 speaker.speak(new ArrayBuffer(4));speaker.speak(new ArrayBuffer(8));
 const context=contexts[0];assert.equal(context.pending.length,1);
 speaker.stop();context.pending[0].resolve({});await tick();
 assert.equal(context.sources.length,0);assert.equal(context.pending.length,1);assert.equal(speaker.speaking,false);
});
test('stopping active playback releases the queue and a later new reply can play',async t=>{
 const {speaker,contexts}=audioFixture(t);
 speaker.speak(new ArrayBuffer(4));const context=contexts[0];
 context.pending[0].resolve({});await tick();
 assert.equal(speaker.speaking,true);
 speaker.speak(new ArrayBuffer(8));speaker.stop();await tick();
 assert.equal(context.sources[0].stopped,true);assert.equal(context.sources[0].disconnected,true);assert.equal(speaker.speaking,false);
 speaker.speak(new ArrayBuffer(12));context.pending[1].resolve({});await tick();
 assert.equal(context.sources.length,2);assert.equal(context.sources[1].started,true);assert.equal(speaker.speaking,true);
});
test('disposing during decode closes the context and rejects late or future playback',async t=>{
 const {speaker,contexts}=audioFixture(t);
 speaker.speak(new ArrayBuffer(4));const context=contexts[0];
 speaker.dispose();context.pending[0].resolve({});speaker.speak(new ArrayBuffer(8));await tick();
 assert.equal(context.closed,true);assert.equal(context.sources.length,0);assert.equal(speaker.speaking,false);
});
