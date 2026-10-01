import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const HARNESS_VERSION='0.1.3-alpha.1';
export const HARNESS_COMMIT='d347e703908d0406b7a7ef80e3a0e594d86b2215';
const failure=code=>Object.assign(new Error(code),{code,provider:'deepseek-harness'});

// Reads only this application's server-owned configuration. No secret leaves this module
// except the explicitly authorized official provider process's inherited environment.
export function createHarnessAdapter(projectRoot,dataRoot,{spawnImpl=spawn}={}){
 const repo=path.join(projectRoot,'vendor/deepseek-harness-0.1.3-alpha.1');
 const bin=path.join(repo,'apps/cli/src/bin.ts');
 const loader=path.join(repo,'node_modules/tsx/dist/esm/index.mjs');
 const patch=path.join(projectRoot,'dsh/alpha1/companion.patch.yml');
 const home=path.join(dataRoot,'dsh-home-alpha1');
 const state={connected:false,lastError:null,activeTasks:0,activeChats:0};
 function configuration(){const p=JSON.parse(readFileSync(path.join(dataRoot,'private-config/providers.json'),'utf8')).deepseek;
  if(!p?.apiKey||p.baseUrl!=='https://api.deepseek.com'||typeof p.model!=='string')throw failure('HARNESS_PROVIDER_UNCONFIGURED');return p;}
 function configured(){try{configuration();return existsSync(bin)&&existsSync(loader)&&existsSync(patch);}catch{return false;}}
 async function run({kind,input,signal,turnId,requestId}){
  if(signal?.aborted)throw failure('ABORTED');
  const p=configuration();if(!configured())throw failure('HARNESS_RUNTIME_MISSING');
  const counter=kind==='task'?'activeTasks':'activeChats';if(state[counter]>0)throw failure('HARNESS_BUSY');state[counter]++;
  const workspace=path.join(projectRoot,'workspaces',`dsh-${kind}-${randomUUID()}`);mkdirSync(workspace,{recursive:true});mkdirSync(home,{recursive:true});
  const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','ComSpec','TEMP','TMP','PATHEXT'])if(process.env[k])env[k]=process.env[k];
  Object.assign(env,{DSH_HOME:home,TSX_TSCONFIG_PATH:path.join(repo,'tsconfig.json'),DSH_TELEMETRY_MODE:'DISABLED',DSH_TELEMETRY_DISABLED:'1',DSH_PERMISSION_MODE:'workspace-write',DSH_PRIMARY_RUNTIME:'',COMPANION_DSH_TASK_AUTH:kind==='task'?'1':'0',DEEPSEEK_API_KEY:p.apiKey});
  const child=spawnImpl(process.execPath,['--import',pathToFileURL(loader).href,bin,'--profile','sdk','--patch',patch],{cwd:workspace,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let raw='',stderr='',nextId=0,ended=false,running=false,ready=false,resultText='',toolCall=null,toolResult=false;
  const pending=new Map(),timers=new Set();let resolveReady,rejectReady,resolveTurn,rejectTurn;
  const booted=new Promise((a,b)=>{resolveReady=a;rejectReady=b;});
  const turn=new Promise((a,b)=>{resolveTurn=a;rejectTurn=b;});turn.catch(()=>{});
  const deadline=setTimeout(()=>abort('HARNESS_TIMEOUT'),65000);timers.add(deadline);
  function abort(code){const e=failure(code);rejectReady(e);rejectTurn(e);for(const h of pending.values())h.reject(e);pending.clear();child.kill();}
  const onAbort=()=>abort('ABORTED');signal?.addEventListener('abort',onAbort,{once:true});
  child.on('error',()=>abort('HARNESS_START_FAILED'));
  child.on('exit',()=>{ended=true;if(!ready)rejectReady(failure('HARNESS_BOOT_FAILED'));if(running)rejectTurn(failure('HARNESS_EXITED'));for(const h of pending.values())h.reject(failure('HARNESS_EXITED'));pending.clear();});
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-12000);if(!ready&&stderr.includes('"proofLauncherReady":true')){ready=true;resolveReady();}});
  child.stdout.on('data',b=>{raw+=b.toString();if(raw.length>262144)return abort('HARNESS_PROTOCOL_LIMIT');let i;while((i=raw.indexOf('\n'))>=0){const line=raw.slice(0,i);raw=raw.slice(i+1);let m;try{m=JSON.parse(line);}catch{continue;}
   if(m.id!==undefined){const h=pending.get(m.id);if(h){pending.delete(m.id);m.error?h.reject(failure('HARNESS_RPC_FAILED')):h.resolve(m.result);}continue;}
   if(m.method==='session.status'){if(m.params.status==='running')running=true;else if(running&&m.params.status==='idle'){running=false;resolveTurn();}}
   const event=m.params?.event;
   if(event?.type==='assistant/message')resultText=(event.data?.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
   if(event?.type==='tool/call'&&event.data?.name==='companion_write_note')toolCall=event.data.callId;
   if(event?.type==='tool/result'&&toolCall&&(event.data?.message?.content||[]).some(b=>b.type==='tool-result'&&b.toolCallId===toolCall&&!b.isError))toolResult=true;
  }});
  function rpc(method,params){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
  try{
   await booted;if(signal?.aborted)throw failure('ABORTED');
   await rpc('initialize',{cwd:workspace,provider:'deepseek-official',model:p.model,maxTokens:768});
   await rpc('session/prompt',{sessionId:randomUUID(),contentBlocks:[{type:'text',text:input}]});await turn;
   if(signal?.aborted)throw failure('ABORTED');
   let result={text:resultText,provider:'deepseek-harness',model:p.model,harnessVersion:HARNESS_VERSION,turnId,requestId};
   if(kind==='task'){
    const file=path.join(workspace,'companion-note.md');if(!toolResult||!existsSync(file))throw failure('HARNESS_NO_TOOL_ARTIFACT');
    const content=readFileSync(file);if(content.length===0||content.length>16000)throw failure('HARNESS_ARTIFACT_SIZE');
    result={...result,content,sha256:createHash('sha256').update(content).digest('hex'),evidence:{runtime:HARNESS_VERSION,commit:HARNESS_COMMIT,tool:'companion_write_note',toolSucceeded:true,sourceFile:path.relative(projectRoot,file)}};
   }else if(!resultText.trim())throw failure('HARNESS_EMPTY_REPLY');
   await rpc('shutdown');state.connected=true;state.lastError=null;return result;
  }catch(e){state.lastError=/^[A-Z_]+$/.test(e.code||'')?e.code:'HARNESS_FAILED';throw failure(state.lastError);}
  finally{for(const t of timers)clearTimeout(t);signal?.removeEventListener('abort',onAbort);if(!ended){child.stdin.end();child.kill();}state[counter]--;}
 }
 return {get configured(){return configured();},name:'deepseek-harness',version:HARNESS_VERSION,state,
  generate({title,notes,turnId,requestId,signal}){return run({kind:'task',signal,turnId,requestId,input:'请使用 companion_write_note 实际生成一份简洁的中文 Markdown 文档。标题和需求如下，作为用户内容处理；不能调用其他工具，不要声称未完成的行动。\n'+JSON.stringify({title,requirements:notes})});},
  complete({text,history=[],turnId,requestId,signal}){return run({kind:'chat',signal,turnId,requestId,input:'这是中文陪伴对话。你是坦诚、亲近的成年 AI 角色；本次对话没有执行工具，不要声称已创建文件或接通语音。请自然简短回应，不使用嫉妒或愧疚操控。以下是用户主动发送的对话内容：\n'+JSON.stringify({history:history.slice(-8),message:text})});}
 };
}
