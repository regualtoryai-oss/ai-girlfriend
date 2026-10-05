import {DEFAULT_RELAY,RELAY_ORIGINS} from './model-routing.mjs';
const fail=message=>Object.assign(new Error(message),{status:400});
export function relayMetadata(p={}){return {configured:!!p.apiKey,baseUrl:p.baseUrl||DEFAULT_RELAY.baseUrl,backupBaseUrl:DEFAULT_RELAY.backupBaseUrl,model:p.model||DEFAULT_RELAY.model,taskModel:p.taskModel||DEFAULT_RELAY.taskModel,enabled:p.enabled===true,verification:p.verification||{},connected:false,catalogCount:p.catalog?.modelIds?.length||0};}
export function validateRelay(input,old={}){
 if(Object.keys(input).some(k=>!['provider','apiKey','model','taskModel','baseUrl','enabled','clear'].includes(k)))throw fail('Invalid relay fields');
 const baseUrl=input.baseUrl??old.baseUrl??DEFAULT_RELAY.baseUrl;if(!RELAY_ORIGINS.includes(baseUrl))throw fail('Relay endpoint not authorized');
 const apiKey=input.apiKey??old.apiKey;if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>4096||/[\r\n\0]/.test(apiKey))throw fail('Invalid relay key');
 const model=input.model??old.model??DEFAULT_RELAY.model,taskModel=input.taskModel??old.taskModel??DEFAULT_RELAY.taskModel;
 for(const m of [model,taskModel])if(typeof m!=='string'||!m.trim()||m.length>100||/[\r\n\0]/.test(m))throw fail('Invalid model ID');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw fail('Invalid enabled flag');
 const unchanged=apiKey===old.apiKey&&baseUrl===old.baseUrl&&model===old.model&&taskModel===old.taskModel;
 return {apiKey,baseUrl,model,taskModel,enabled:input.enabled??old.enabled??false,verification:unchanged?old.verification||{}:{},catalog:apiKey===old.apiKey&&baseUrl===old.baseUrl?old.catalog||null:null};
}
export async function probeRelay(p,fetchImpl=fetch){
 if(!p?.apiKey||!RELAY_ORIGINS.includes(p.baseUrl))throw fail('Relay not configured');
 const results={};for(const capability of ['chat','tools']){
  const model=capability==='tools'?p.taskModel:p.model,start=Date.now();
  const payload={model,stream:false,max_tokens:64,messages:[{role:'user',content:capability==='chat'?'只回复 OK。':'调用 connection_check 工具，message 参数为 OK。不做其他事情。'}]};
  if(capability==='tools'){payload.tools=[{type:'function',function:{name:'connection_check',description:'Return a harmless connection-check marker; no files or external actions.',parameters:{type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false}}}];payload.tool_choice={type:'function',function:{name:'connection_check'}};}
  const serialized=JSON.stringify(payload);const requestBytes=Buffer.byteLength(serialized);if(requestBytes>2048)throw fail('Probe input limit exceeded');
  try{const r=await fetchImpl(p.baseUrl+'/v1/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+p.apiKey},body:serialized,signal:AbortSignal.timeout(20000)});
   if(!r.ok){results[capability]={passed:false,httpStatus:r.status,baseUrl:p.baseUrl,model,ms:Date.now()-start};continue;}
   const data=await r.json(),message=data.choices?.[0]?.message;let passed=false;
   if(capability==='chat')passed=typeof message?.content==='string'&&message.content.trim().length>0;
   else{const call=message?.tool_calls?.find(t=>t.type==='function'&&t.function?.name==='connection_check');try{passed=JSON.parse(call?.function?.arguments).message==='OK';}catch{}}
   const usage={};for(const k of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isFinite(data.usage?.[k]))usage[k]=data.usage[k];
   results[capability]={passed,baseUrl:p.baseUrl,model,httpStatus:r.status,ms:Date.now()-start,usage,requestBytes,maxOutputTokens:64,checkedAt:new Date().toISOString()};
  }catch{results[capability]={passed:false,baseUrl:p.baseUrl,model,error:'REQUEST_FAILED_OR_TIMEOUT',ms:Date.now()-start};}
 }return results;
}
