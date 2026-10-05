import {UsageBudget} from './usage-budget.mjs';
import {discoverModelIds} from './capability-catalog.mjs';
import {relayMetadata,validateRelay,probeRelay} from './relay-config.mjs';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const origins={deepseek:'https://api.deepseek.com',jev:'https://api.typesafe.ai'};
export function createConfigStore(dataRoot){
 const dir=path.join(dataRoot,'private-config'),file=path.join(dir,'providers.json');
 function read(){if(!existsSync(file))return {};return JSON.parse(readFileSync(file,'utf8'));}
 function metadata(){const stored=read();return {...Object.fromEntries(Object.keys(origins).map(provider=>{const p=stored[provider]||{};return [provider,{configured:typeof p.apiKey==='string'&&p.apiKey.length>0,baseUrl:p.baseUrl||origins[provider],model:p.model||'',connected:false}];})),relay:relayMetadata(stored.relay)};}
 function save(input){
  if(input?.provider==='relay'){const current=read();if(input.clear===true)delete current.relay;else current.relay=validateRelay(input,current.relay);persist(current);return metadata();}
  if(!input||!Object.hasOwn(origins,input.provider)||Object.keys(input).some(k=>!['provider','apiKey','model','baseUrl','clear'].includes(k)))throw fail(400,'Invalid provider configuration');
  if(input.clear!==undefined&&typeof input.clear!=='boolean')throw fail(400,'Invalid clear value');
  const current=read(),old=current[input.provider]||{};
  if(input.clear===true){delete current[input.provider];}
  else{
   if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||!input.apiKey.trim()||input.apiKey.length>4096||/[\r\n\0]/.test(input.apiKey)))throw fail(400,'Invalid key');
   const baseUrl=input.baseUrl||old.baseUrl||origins[input.provider];if(baseUrl!==origins[input.provider])throw fail(400,'This preview currently accepts the official provider endpoint only');
   const model=input.model??old.model??'';if(typeof model!=='string'||model.length>100||/[\r\n\0]/.test(model))throw fail(400,'Invalid model');
   if(input.provider==='deepseek'&&!model.trim())throw fail(400,'请填写 DeepSeek 模型 ID');
   const apiKey=input.apiKey??old.apiKey;if(!apiKey)throw fail(400,'请填写 API Key');
   current[input.provider]={apiKey,model:model.trim(),baseUrl};
  }
  persist(current);return metadata();
 }
 function persist(value){mkdirSync(dir,{recursive:true,mode:0o700});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(value),{mode:0o600});renameSync(tmp,file);}
 async function testRelay(){const current=read(),p=current.relay;if(!p)throw fail(400,'Relay not configured');const quotePath=path.join(dataRoot,'private-config/verified-prices.json');const quotes=existsSync(quotePath)?JSON.parse(readFileSync(quotePath,'utf8')):{};const budget=new UsageBudget(path.join(dataRoot,'private-config/usage-budget.json'));const reservations={};for(const c of ['chat','tools']){const model=c==='chat'?p.model:p.taskModel;const quote=quotes[p.baseUrl]?.[model];reservations[c]=budget.reserve({model,inputTokens:1000,outputTokens:64,quote});}const result=await probeRelay(p);for(const c of ['chat','tools'])budget.settle(reservations[c].id,{usage:result[c]?.usage,httpStatus:result[c]?.httpStatus});const latest=read();if(JSON.stringify(latest.relay)!==JSON.stringify(p))throw fail(409,'Configuration changed during test');latest.relay.verification=result;persist(latest);return {results:result,providers:metadata(),externalRequests:2};}
 async function discoverRelay(){const current=read(),p=current.relay;if(!p)throw fail(400,'Relay not configured');const modelIds=await discoverModelIds(p);const latest=read();if(latest.relay?.apiKey!==p.apiKey||latest.relay?.baseUrl!==p.baseUrl)throw fail(409,'Configuration changed');latest.relay.catalog={modelIds,checkedAt:new Date().toISOString(),source:'authenticated-model-list'};persist(latest);return {providers:metadata(),modelCount:modelIds.length,generationRequests:0};}
 return {metadata,save,testRelay,discoverRelay}; // Secret readback is deliberately not part of the public store interface.
}
export function createAdminSessions(){
 const sessions=new Map();
 function bootstrap(req,res){
  const now=Date.now();for(const [key,item] of sessions)if(item.expires<now)sessions.delete(key);
  if(sessions.size>=20)throw fail(429,'Too many configuration sessions');
  const id=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex');sessions.set(id,{token,expires:now+30*60*1000});
  res.setHeader('Set-Cookie',`companion_admin=${id}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=1800`);return {csrfToken:token,expiresInSeconds:1800};
 }
 function validate(req){
  const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('companion_admin='))?.slice('companion_admin='.length);
  const session=sessions.get(id),token=req.headers['x-csrf-token'];
  if(!session||session.expires<Date.now()||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(session.token)))throw fail(403,'Configuration session expired or invalid');
 }
 return {bootstrap,validate};
}
