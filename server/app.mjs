import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Jobs,validId} from './jobs.mjs';
import {createSafeLogger} from './logger.mjs';
import {createConfigStore,createAdminSessions} from './admin.mjs';
import {createConfiguredProviders} from './providers.mjs';
import {createHarnessAdapter} from './harness-adapter.mjs';
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.mp4':'video/mp4','.json':'application/json','.md':'text/markdown; charset=utf-8'};
const fault=(status,message)=>Object.assign(new Error(message),{status});
async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fault(415,'JSON required');let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>12000)throw fault(413,'Body too large');}try{return JSON.parse(data);}catch{throw fault(400,'Invalid JSON');}}
export function createApp({dataRoot=path.join(projectRoot,'data'),publicRoot=path.join(projectRoot,'public'),adapters={},logger=()=>{},beforeCommit,allowExternalCalls=false}={}){
 dataRoot=path.resolve(dataRoot);publicRoot=path.resolve(publicRoot);
 const jobs=new Jobs(path.join(dataRoot,'tasks'),beforeCommit,allowExternalCalls&&adapters.harness?.configured?adapters.harness:null),log=createSafeLogger(logger),turns=new Map();
 const config=createConfigStore(dataRoot),admin=createAdminSessions();
 const configured=a=>a?.configured===true;
 const status=()=>({app:'companion-agent-preview',executor:jobs.adapter?'deepseek-harness':'bounded-local-file',harness:jobs.adapter?'ready':'not-connected',harnessVersion:jobs.adapter?.version||null,harnessState:jobs.adapter?.state||null,jev:configured(adapters.jev)?'configured-not-executing':'not-connected',llm:configured(adapters.chat)?(allowExternalCalls?'ready':'configured-calls-disabled'):'not-connected',voice:'not-connected',microphone:false,externalCallsAuthorized:allowExternalCalls,providers:adapters.state||null});
 const handler=async(req,res)=>{const requestId=validId(req.headers['x-request-id'])?req.headers['x-request-id']:randomUUID();res.setHeader('X-Request-Id',requestId);
  const json=(code,data)=>{if(res.destroyed||res.writableEnded)return;log('http.response',{requestId,status:code});res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({...data,requestId}));};
  try{
   const port=req.socket.localPort,origin=`http://127.0.0.1:${port}`;
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self'; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
   if(req.headers.host!==`127.0.0.1:${port}`)return json(403,{error:'Local host required'});
   if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Same origin required'});
   const p=new URL(req.url,origin).pathname;
   if(p==='/api/status'&&req.method==='GET')return json(200,status());
   if(p==='/api/admin/bootstrap'&&req.method==='GET')return json(200,{...admin.bootstrap(req,res),providers:config.metadata()});
   if(p==='/api/admin/config'&&req.method==='GET'){admin.validate(req);return json(200,{providers:config.metadata()});}
   if(p==='/api/admin/config'&&req.method==='POST'){
    if(req.headers.origin!==origin)return json(403,{error:'Explicit same origin required'});admin.validate(req);const input=await body(req);return json(200,{providers:config.save(input),saved:true,connectionTested:false});
   }
   if(p==='/api/admin/test'&&req.method==='POST'){
    if(req.headers.origin!==origin)return json(403,{error:'Explicit same origin required'});admin.validate(req);return json(503,{error:'连接测试适配器尚未启用；没有发出任何模型请求。'});
   }

   if(p==='/api/chat'&&req.method==='POST'){
    const input=await body(req);if(!validId(input.turnId)||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw fault(400,'Invalid turn');
    if(!configured(adapters.chat)||!allowExternalCalls)return json(503,{turnId:input.turnId,error:'对话模型尚未连接或调用尚未授权。'});
    if(turns.has(input.turnId))return json(409,{turnId:input.turnId,error:'Turn already submitted'});
    if(turns.size>=100)return json(429,{error:'Turn session limit reached'});
    if(input.history!==undefined&&(!Array.isArray(input.history)||input.history.length>8||input.history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>2000)))throw fault(400,'Invalid history');
    const controller=new AbortController();turns.set(input.turnId,{controller,state:'running'});
    const onClose=()=>{if(!res.writableEnded)controller.abort();};res.on('close',onClose);
    const timeout=setTimeout(()=>controller.abort(),65000);
    try{const result=await Promise.race([adapters.chat.complete({text:input.text,turnId:input.turnId,requestId,signal:controller.signal,history:input.history||[]}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(fault(499,'Turn cancelled')),{once:true}))]);
     if(controller.signal.aborted)throw fault(499,'Turn cancelled');if(typeof result?.text!=='string'||result.text.length>20000)throw fault(502,'Invalid model response');turns.get(input.turnId).state='completed';return json(200,{turnId:input.turnId,text:result.text,source:'model',decision:result.decision||null,provider:result.provider||null,model:result.model||null,harnessVersion:result.harnessVersion||null});
    }catch(e){turns.get(input.turnId).state=controller.signal.aborted?'cancelled':'failed';return json(controller.signal.aborted?499:502,{turnId:input.turnId,error:controller.signal.aborted?'对话已取消':'模型请求未完成',provider:['deepseek','jev'].includes(e.provider)?e.provider:null,providerStatus:Number.isInteger(e.providerStatus)?e.providerStatus:null});}finally{clearTimeout(timeout);res.off('close',onClose);}
   }
   const turn=p.match(/^\/api\/turns\/([a-f0-9-]{36})\/cancel$/i);if(turn&&req.method==='POST'){const t=turns.get(turn[1]);if(!t)return json(404,{error:'Unknown turn'});t.controller.abort();if(t.state==='running')t.state='cancelled';return json(200,{turnId:turn[1],state:t.state});}
   if(p==='/api/audio/stop'&&req.method==='POST'){const input=await body(req);if(input.turnId!==undefined&&!validId(input.turnId))throw fault(400,'Invalid turn');return json(200,{event:'audio.stop',turnId:input.turnId||null,audio:'not-connected',tasksUnaffected:true});}
   if(p==='/api/tasks'&&req.method==='POST'){const input=await body(req);return json(202,jobs.create({...input,requestId}));}
   const match=p.match(/^\/api\/tasks\/([a-f0-9-]{36})(\/cancel)?$/i);
   if(match){if(req.method!==(match[2]?'POST':'GET'))return json(405,{error:'Method not allowed'});let j;if(match[2]){const input=await body(req);if(input.expectedRevision!==undefined&&!Number.isInteger(input.expectedRevision))throw fault(400,'Invalid revision');j=jobs.cancel(match[1],input.expectedRevision);}else j=jobs.jobs.get(match[1]);return json(j?200:404,j||{error:'Unknown task'});}
   if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'Method not allowed'});
   let file;if(/^\/files\/note-[a-f0-9-]{36}\.md$/i.test(p)){file=path.join(dataRoot,'tasks',path.basename(p));res.setHeader('Content-Disposition',`attachment; filename="${path.basename(p)}"`);}
   else{const rel=decodeURIComponent(p==='/'?'/index.html':p);file=path.resolve(publicRoot,'.'+rel);if(!file.startsWith(publicRoot+path.sep))return json(403,{error:'Path rejected'});}
   const s=await stat(file);if(!s.isFile())return json(404,{error:'Not found'});const data=await readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');
   if(req.headers.range&&path.extname(file)==='.mp4'){const m=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);if(!m)return json(416,{error:'Invalid range'});const a=Number(m[1]),b=Math.min(m[2]?Number(m[2]):data.length-1,data.length-1);if(a>b||a>=data.length){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});return res.end();}res.writeHead(206,{'Accept-Ranges':'bytes','Content-Range':`bytes ${a}-${b}/${data.length}`,'Content-Length':b-a+1});return res.end(req.method==='HEAD'?undefined:data.subarray(a,b+1));}
   res.writeHead(200,{'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){json(e.status||(e.code==='ENOENT'?404:500),{error:e.status?e.message:'资源暂不可用'});}
 };
 return Object.assign(handler,{jobs,status,dataRoot,close(){jobs.close();for(const t of turns.values())t.controller.abort();}});
}
export function createServer(options={}){const app=createApp(options),server=http.createServer(app);server.app=app;server.on('close',()=>app.close());return server;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.COMPANION_PORT||8793);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
 const dataRoot=path.join(projectRoot,'data');const providers=createConfiguredProviders(dataRoot);const harness=createHarnessAdapter(projectRoot,dataRoot);const adapters={chat:harness,harness,jev:providers.jev,state:{harness:harness.state,jev:{connected:false,status:'plugin-integration-pending'}}};
 const server=createServer({dataRoot,adapters,allowExternalCalls:true});server.listen(port,'127.0.0.1',()=>console.log(`Companion preview http://127.0.0.1:${port} | Harness 0.1.3-alpha.1 | isolated chat/task runtimes | no microphone`));
}
