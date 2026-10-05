import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function createVoiceRuntime(root,dataRoot,harness,appPort){
 const token=randomBytes(32).toString('hex'),sessions=new Map(),state={host:'starting',asr:'not-tested',microphone:false,output:'browser-synthesis-temporary'};
 const repo=path.join(root,'vendor/deepseek-harness-0.1.3-alpha.1'),workspace=path.join(root,'workspaces','voice-host-'+randomUUID());mkdirSync(workspace,{recursive:true});
 const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','ComSpec','TEMP','TMP','PATHEXT'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{DSH_HOME:path.join(dataRoot,'dsh-home-alpha1'),TSX_TSCONFIG_PATH:path.join(repo,'tsconfig.json'),DSH_TELEMETRY_DISABLED:'1',DSH_TELEMETRY_MODE:'DISABLED',COMPANION_VOICE_TOKEN:token,COMPANION_VOICE_CALLBACK:`http://127.0.0.1:${appPort}/api/voice/internal-route`});
 const child=spawn(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/esm/index.mjs')).href,path.join(repo,'apps/cli/src/bin.ts'),'--profile','sdk','--patch',path.join(root,'dsh/alpha1/voice-host.patch.yml')],{cwd:workspace,env,windowsHide:true,stdio:['pipe','ignore','pipe']});
 let bridgePort=null,stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16000);for(const line of stderr.split('\n'))try{const m=JSON.parse(line);if(m.voiceBridgeReady&&Number.isInteger(m.port)){bridgePort=m.port;state.host='ready';}}catch{}});child.on('error',()=>state.host='failed');child.on('exit',()=>state.host='stopped');
 async function call(route,input,signal){if(!bridgePort)throw Error('Voice host not ready');const r=await fetch(`http://127.0.0.1:${bridgePort}${route}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input),redirect:'error',signal:signal||AbortSignal.timeout(65000)});if(!r.ok)throw Error('Voice operation failed');return r.json();}
 async function health(){try{const r=await fetch('http://127.0.0.1:8795/health',{signal:AbortSignal.timeout(1200)});state.asr=r.ok&&(await r.json()).ready?'ready':'not-connected';}catch{state.asr='not-connected';}return state.host==='ready'&&state.asr==='ready';}
 const json=(res,status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
 async function body(req,max=1400000){let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>max)throw Error('Body too large');}return JSON.parse(raw);}
 async function handle(req,res,p){if(!p.startsWith('/api/voice/'))return false;
  try{
   if(p==='/api/voice/internal-route'){
    if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token)return json(res,403,{error:'forbidden'}),true;
    const input=await body(req,16000);if(!sessions.has(input.sessionId))throw Error('Session closed');
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>3000)throw Error('Invalid transcript');
    // The active browser turn hands this real ASR result to the same conversation
    // entry point as typing. No hidden second LLM, approval or file execution.
    return json(res,200,{text:'',transcript:input.text,handoff:'conversation'}),true;
   }
   if(p==='/api/voice/bootstrap'&&req.method==='GET'){
    for(const [id,s]of sessions)if(s.expires<Date.now()){sessions.delete(id);call('/close',{sessionId:id}).catch(()=>{});}
    if(sessions.size>=24)return json(res,429,{error:'语音会话已达上限'}),true;
    const sessionId=randomUUID(),csrf=randomBytes(24).toString('hex');sessions.set(sessionId,{csrf,expires:Date.now()+3600000});
    res.setHeader('Set-Cookie',`companion_voice=${sessionId}; HttpOnly; SameSite=Strict; Path=/api/voice; Max-Age=3600`);
    const ready=await health();return json(res,200,{sessionId,csrf,ready,state}),true;
   }
   const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('companion_voice='))?.slice(16),session=sessions.get(id);
   if(req.method!=='POST'||req.headers.origin!==`http://127.0.0.1:${appPort}`||!session||session.expires<Date.now()||req.headers['x-voice-csrf']!==session.csrf)return json(res,403,{error:'语音会话已过期，请刷新页面'}),true;
   const op=p.slice('/api/voice'.length);if(!['/wav','/poll','/ack','/stop','/cancel','/close','/speak'].includes(op))return json(res,404,{error:'unknown-operation'}),true;
   if(req.headers['content-type']!=='application/json')throw Error('Invalid content type');
   const input=await body(req);input.sessionId=id;
   const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
   const result=await call(op,input,controller.signal);if(op==='/close')sessions.delete(id);json(res,200,result);
  }catch{json(res,503,{error:'语音处理未完成，请检查本地识别服务或重试'});}return true;
 }
 return {state,health,handle,get ready(){return state.host==='ready'&&state.asr==='ready';},close(){for(const id of sessions.keys())call('/close',{sessionId:id}).catch(()=>{});sessions.clear();child.stdin.end();child.kill();}};
}
