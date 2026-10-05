import http from 'node:http';
export const name='companion-voice-http';
export const inject=['companionVoice'];
export function apply(ctx){
 const voice=ctx.companionVoice,key=process.env.COMPANION_VOICE_TOKEN,callback=process.env.COMPANION_VOICE_CALLBACK;
 if(!key||!/^http:\/\/127\.0\.0\.1:\d+\/api\/voice\/internal-route$/.test(callback||''))throw Error('Voice bridge configuration missing');
 const events=new Map(),outputs=new Map(),pending=new Map(),replies=new Map();
 const emit=(session,item)=>{const q=events.get(session)||[];q.push(item);events.set(session,q.slice(-50));};
 ctx.effect(()=>voice.subscribe(e=>emit(e.sessionId,e)));
 ctx.effect(()=>voice.bindRouter(async(input,{signal})=>{
  const response=await fetch(callback,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(input),signal});
  if(!response.ok)throw Error('Router failed');const reply=await response.json();if(signal.aborted)return;
  replies.set(input.sessionId,{...reply,turnId:input.turnId,requestId:input.requestId});
  if(outputs.get(input.sessionId)&&reply.text?.trim())void voice.enqueueSpeech({...input,utteranceId:input.turnId,text:reply.text.slice(0,4000)});
 }));
 ctx.effect(()=>voice.bindOutput({kind:'browser-synthesis',speak(input){
  return new Promise((resolve,reject)=>{const id=input.sessionId+':'+input.utteranceId;const abort=()=>{pending.delete(id);reject(Error('Stopped'));};if(input.signal.aborted)return abort();input.signal.addEventListener('abort',abort,{once:true});pending.set(id,{sessionId:input.sessionId,turnId:input.turnId,resolve:()=>{input.signal.removeEventListener('abort',abort);resolve();},reject:()=>{input.signal.removeEventListener('abort',abort);reject(Error('Playback failed'));}});emit(input.sessionId,{type:'playback',sessionId:input.sessionId,requestId:input.requestId,turnId:input.turnId,utteranceId:input.utteranceId,text:input.text});});
 },stop(ids){emit(ids.sessionId,{type:'playback-stop',...ids});}}));
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}};
  if(req.headers.authorization!=='Bearer '+key||req.method!=='POST')return send(403,{error:'forbidden'});
  let input;
  try{let raw='';for await(const c of req){raw+=c;if(raw.length>1400000)throw Error();}input=JSON.parse(raw);if(!/^[a-f0-9-]{36}$/.test(input.sessionId||''))throw Error();
   if(req.url==='/status')return send(200,voice.status());
   if(req.url==='/poll'){const queue=events.get(input.sessionId)||[];events.set(input.sessionId,[]);return send(200,{events:queue});}
   if(req.url==='/ack'){const id=input.sessionId+':'+input.utteranceId,p=pending.get(id);if(p&&p.turnId===input.turnId){pending.delete(id);input.ok?p.resolve():p.reject();}return send(200,{acknowledged:true});}
   if(req.url==='/speak'){if(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000)throw Error('Invalid speech');void voice.enqueueSpeech(input).catch(()=>{});return send(202,{queued:true});}
   if(req.url==='/stop')return send(200,voice.stopSpeaking(input));
   if(req.url==='/cancel')return send(200,voice.cancelInput(input));
   if(req.url==='/close'){voice.closeSession(input.sessionId);events.delete(input.sessionId);outputs.delete(input.sessionId);replies.delete(input.sessionId);return send(200,{closed:true});}
   if(req.url==='/wav'){
    if(typeof input.wav!=='string'||input.wav.length>1280060||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.wav))throw Error();
    outputs.set(input.sessionId,input.output===true);replies.delete(input.sessionId);
    res.on('close',()=>{if(!res.writableEnded)try{voice.cancelInput(input);}catch{}});
    const result=await voice.submitWav({...input,wav:Buffer.from(input.wav,'base64')});
    const reply=replies.get(input.sessionId);replies.delete(input.sessionId);
    return send(200,{...result,reply:reply?.turnId===input.turnId?reply:null});
   }
   send(404,{error:'unknown-operation'});
  }catch{send(400,{error:'voice-operation-failed'});}
 });
 server.requestTimeout=70000;server.headersTimeout=10000;
 server.listen(0,'127.0.0.1',()=>process.stderr.write(JSON.stringify({voiceBridgeReady:true,port:server.address().port})+'\n'));
 ctx.effect(()=>()=>{server.close();server.closeAllConnections();for(const p of pending.values())p.reject();pending.clear();});
 ctx.provide('companionVoiceBridgeReady',{});
}
