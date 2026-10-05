import {readFileSync} from 'node:fs';
import path from 'node:path';
import {choice,TypeSafeClient} from '@typesafe-ai/sdk';
const allowed=Object.freeze(['chat','draft_note','clarify']);
const safeError=(provider,status)=>Object.assign(new Error(`${provider} request failed`),{provider,providerStatus:Number.isInteger(status)?status:null});
// Only this server module reads this application's credential file. No environment fallback.
export function createConfiguredProviders(dataRoot,{fetchImpl=fetch}={}){
 const state={deepseek:{connected:false,lastError:null},jev:{connected:false,lastError:null}};
 function config(provider){try{const all=JSON.parse(readFileSync(path.join(dataRoot,'private-config/providers.json'),'utf8'));const p=all[provider];if(!p?.apiKey)throw Error();return p;}catch{throw safeError(provider,null);}}
 function configured(provider){try{return !!config(provider).apiKey;}catch{return false;}}
 const jev={get configured(){return configured('jev');},name:'typesafe-official',async decide({text,turnId,requestId,signal}){
  const p=config('jev');if(p.baseUrl!=='https://api.typesafe.ai')throw safeError('jev',null);
  const client=new TypeSafeClient({apiKey:p.apiKey,baseURL:p.baseUrl,defaultModel:'jev-latest',logLevel:'off',retry:{maxRetries:0},timeout:8000});
  try{const result=await client.systemOne({state:{text},questions:{route:choice('请选择用户当前意图。draft_note仅指起草备忘、计划、清单或文档；这只是建议，不授权执行。',{chat:'普通聊天或问答',draft_note:'起草可以保存为本地Markdown的文字',clarify:'需求含糊，需要补充信息'})}},{signal,timeout:8000,retry:{maxRetries:0}});
   const route=result?.answers?.route?.choice;if(!allowed.includes(route))throw safeError('jev',null);state.jev={connected:true,lastError:null};return {route,requestId,turnId,source:'typesafe-official'};
  }catch(e){state.jev={connected:false,lastError:Number.isInteger(e.status)?e.status:null};throw safeError('jev',e.status);}
 }};
 const chat={get configured(){return configured('deepseek');},name:'deepseek-official',async complete({text,turnId,requestId,signal,history=[]}){
  const p=config('deepseek');if(p.baseUrl!=='https://api.deepseek.com'||!p.model)throw safeError('deepseek',null);
  let decision={route:'chat',source:'fallback',reason:'jev-unconfigured'};
  if(jev.configured)try{decision=await jev.decide({text,turnId,requestId,signal});}catch(e){if(signal?.aborted)throw e;decision={route:'chat',source:'fallback',reason:'jev-request-failed'};}
  const combined=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(18000)]);
  const messages=[{role:'system',content:'你是晚间，一个坦诚、亲近但不操控用户的成年AI陪伴角色。始终用中文。不要假装真人，不要使用嫉妒、愧疚或付费才爱用户的话术。简明自然地回复。可以起草备忘或清单，但没有调用执行工具，不得声称已创建文件、已发送消息或已完成后台操作。若需要文件，告诉用户可以点击保存回复为文件。不能声称能听见声音、已连通麦克风或视频。'},...history.slice(-8).filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,2000)})),{role:'user',content:text}];
  try{const response=await fetchImpl(`${p.baseUrl}/chat/completions`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${p.apiKey}`},body:JSON.stringify({model:p.model,messages,max_tokens:384,thinking:{type:'disabled'},stream:false}),signal:combined});if(!response.ok){await response.body?.cancel();throw safeError('deepseek',response.status);}
   const result=await response.json(),answer=result?.choices?.[0]?.message?.content;if(typeof answer!=='string'||!answer.trim()||answer.length>10000)throw safeError('deepseek',null);state.deepseek={connected:true,lastError:null};return {text:answer,decision,provider:'deepseek',model:p.model,turnId,requestId};
  }catch(e){state.deepseek={connected:false,lastError:e.providerStatus||null};throw safeError('deepseek',e.providerStatus);}
 }};
 return {chat,jev,state};
}
