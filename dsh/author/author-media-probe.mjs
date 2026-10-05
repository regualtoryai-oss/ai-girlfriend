import {isCampingExecution} from './camping-workflow.mjs';
import {registerCampingImage} from './camping-image.mjs';
// DSH-native, single-session media probes. Does not change model defaults.
import {defineTool} from '@deepseek-ai/dsh-tools';
import {mkdirSync,readFileSync,writeFileSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {UsageBudget} from '../../server/usage-budget.mjs';
import {runAvatarGeneration} from './author-avatar-generation.mjs';

export const name='companion-native-media-probe';
export const inject=['tools','approval'];
// Preserve the exact single-session scope; an empty setting disables probes.
export const probeSession=process.env.COMPANION_PROBE_SESSION_ID?.trim()||null;
const recoveryTaskId=process.env.COMPANION_PROBE_RECOVERY_TASK_ID?.trim()||null;
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
export const probeNames=['companion_probe_image','companion_probe_video'];
export function isMediaProbeExecution(e){return isCampingExecution(e)||Boolean(probeSession&&e.agent?.session.id===probeSession&&probeNames.includes(e.name))}
const origin='https://newapi1.1234bot.com';
const artifactHosts=new Set(['newapi1.1234bot.com','imgen.x.ai','vidgen.x.ai']);
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(code,detail)=>Object.assign(new Error(code),{code,detail});
const limited=async(r,max)=>{const chunks=[];let n=0;for await(const b of r.body){n+=b.length;if(n>max)throw fail('RESPONSE_TOO_LARGE');chunks.push(b)}return Buffer.concat(chunks)};
const publicAddress=a=>a.includes(':')?!/^(::|fc|fd|fe80)/i.test(a):!(/^(0|10|127|169\.254|192\.168)\./.test(a)||/^172\.(1[6-9]|2\d|3[01])\./.test(a));
export async function downloadArtifact(url,signal){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||isIP(u.hostname)||!artifactHosts.has(u.hostname))throw fail('ARTIFACT_URL_REJECTED');
 const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw fail('ARTIFACT_PRIVATE_ADDRESS');
 // No relay credentials follow returned CDN links. Redirects are not followed.
 const r=await fetch(u,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
 if(!r.ok)throw fail('ARTIFACT_DOWNLOAD_HTTP',String(r.status));return limited(r,32*1024*1024);
}
export function apply(ctx){
 registerCampingImage(ctx,downloadArtifact);
 const root=process.env.COMPANION_DATA_ROOT;if(!root||path.resolve(root).toLowerCase()!==path.resolve(projectRoot,'data').toLowerCase())throw Error('PROBE_DATA_ROOT_MISMATCH');
 const dir=path.join(root,'author-evidence','media-probes');mkdirSync(dir,{recursive:true});
 const bound=new WeakSet();let busy=false;
 async function recoverExistingVideo(previous,e){
  // This branch can only GET/download the one retained completed task. No POST,
  // no new reservation, and the original failure receipt remains immutable.
  const recoveryPath=path.join(dir,'video-native-recovery.json');
  if(existsSync(recoveryPath))return JSON.stringify({status:'already-attempted',receipt:JSON.parse(readFileSync(recoveryPath,'utf8'))});
  if(!probeSession||!recoveryTaskId||!/^[A-Za-z0-9_-]{1,200}$/.test(recoveryTaskId)||previous.sessionId!==probeSession||previous.requestedModel!=='grok-imagine-video'||previous.paidPosts!==1||previous.taskId!==recoveryTaskId||previous.error!=='VIDEO_URL_MISSING'||previous.remoteStatus!=='completed')throw fail('RECOVERY_NOT_AUTHORIZED');
  if(busy)throw fail('PROBE_ALREADY_RUNNING');busy=true;let recovery;
  const save=patch=>{recovery={...recovery,...patch,updatedAt:new Date().toISOString()};writeFileSync(recoveryPath,JSON.stringify(recovery,null,2),{mode:0o600})};
  try{
   const approval=await ctx.approval.request({agent:e.agent,toolName:e.name,callId:e.callId,reason:JSON.stringify({summary:'恢复已有视频任务：只查询和下载，不创建、不新增生成费用，保留原失败记录',model:previous.requestedModel,taskId:previous.taskId,maximumGenerations:0,readOnlyRecovery:true,output:'model-probes/media-video.mp4'}),signal:e.signal});
   if(approval!=='allowed-once')return JSON.stringify({status:'not-approved',paidRequests:0});
   e.signal.throwIfAborted();if(!process.env.DEEPSEEK_API_KEY||process.env.COMPANION_MODEL_ORIGIN!==origin)throw fail('EXISTING_RELAY_UNAVAILABLE');
   recovery={stage:'querying',sessionId:e.agent.session.id,callId:e.callId,taskId:previous.taskId,requestedModel:previous.requestedModel,originalReceipt:'video.json',paidPosts:0,startedAt:new Date().toISOString()};save({});
   const response=await fetch(origin+'/v1/videos/'+previous.taskId,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},signal:AbortSignal.any([e.signal,AbortSignal.timeout(30000)])});
   save({queryHttpStatus:response.status,requestId:response.headers.get('x-request-id')||response.headers.get('request-id')||null});
   if(!response.ok)throw fail('RECOVERY_HTTP_'+response.status);
   const data=JSON.parse((await limited(response,1024*1024)).toString('utf8'));
   if(!['done','completed'].includes(data.status))throw fail('RECOVERY_TASK_NOT_COMPLETE');
   const url=data.video?.url||data.url||data.metadata?.url;if(typeof url!=='string')throw fail('VIDEO_URL_MISSING');
   save({stage:'downloading',returnedModel:data.model??null,remoteStatus:data.status,deliveryOrigin:new URL(url).origin,usage:data.usage??null});
   const bytes=await downloadArtifact(url,e.signal);
   if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw fail('VIDEO_HEADER_INVALID');
   const outputDir=path.join(root,'workspace','model-probes'),target=path.join(outputDir,'media-video.mp4');
   if(lstatSync(outputDir).isSymbolicLink()||realpathSync(outputDir).toLowerCase()!==path.resolve(outputDir).toLowerCase())throw fail('PROBE_WORKSPACE_BOUNDARY');
   e.signal.throwIfAborted();let disposition='created';
   if(existsSync(target)){
    if(lstatSync(target).isSymbolicLink()||hash(readFileSync(target))!==hash(bytes))throw fail('RECOVERY_EXISTING_OUTPUT_DIFFERS');
    disposition='identical-existing-file-preserved';
   }else writeFileSync(target,bytes,{flag:'wx'});
   const artifact={path:'model-probes/media-video.mp4',bytes:bytes.length,sha256:hash(bytes)};save({stage:'saved',artifact,disposition});
   return JSON.stringify({status:'saved',recoveredExistingTask:true,paidPosts:0,artifact,disposition,requestedModel:previous.requestedModel,returnedModel:data.model??null,originalFailurePreserved:true});
  }catch(err){if(recovery)save({stage:'failed',error:err.code||err.name});throw Error(err.code||'MEDIA_RECOVERY_FAILED')}
  finally{busy=false}
 }
 async function run(kind,prompt,e,options={}){
  if(options.reference_photo!==undefined||options.duration!==undefined){
   if(!isMediaProbeExecution(e)||kind!=='video'||busy)throw fail('AVATAR_NOT_AUTHORIZED');
   busy=true;try{return await runAvatarGeneration({ctx,e,root,prompt,options,downloadArtifact})}finally{busy=false}
  }
  if(!isMediaProbeExecution(e)||e.name!=='companion_probe_'+kind||typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>1000)throw fail('PROBE_NOT_AUTHORIZED');
  const receiptPath=path.join(dir,kind+'.json');
  if(existsSync(receiptPath)){
   const previous=JSON.parse(readFileSync(receiptPath,'utf8'));
   if(kind==='video'&&previous.error==='VIDEO_URL_MISSING')return recoverExistingVideo(previous,e);
   return JSON.stringify({status:'already-attempted',message:'Do not resubmit a paid request. Inspect retained probe receipt.',receipt:previous});
  }
  if(busy)throw fail('PROBE_ALREADY_RUNNING');busy=true;
  let receipt, reservation,budget;
  const save=patch=>{receipt={...receipt,...patch,updatedAt:new Date().toISOString()};writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600})};
  try{
   const model=kind==='image'?'grok-imagine-image':'grok-imagine-video';
   const quotes=JSON.parse(readFileSync(path.join(root,'private-config','verified-prices.json'),'utf8'));const quote=quotes[origin]?.[model];
   const cap=kind==='image'?.02:.05;
   if(!quote||quote.model!==model||quote.unit!=='USD'||quote.verified!==true||quote.groupMultiplier!==1||quote.inputPerMillion!==0||quote.outputPerMillion!==0||!(quote.perImage>0&&quote.perImage<=cap))throw fail('PROBE_PRICE_CAP');
   const workspace=path.join(root,'workspace'),outputDir=path.join(workspace,'model-probes');
   mkdirSync(outputDir,{recursive:true});
   if(lstatSync(outputDir).isSymbolicLink()||realpathSync(workspace).toLowerCase()!==path.resolve(workspace).toLowerCase()||realpathSync(outputDir).toLowerCase()!==path.resolve(outputDir).toLowerCase())throw fail('PROBE_WORKSPACE_BOUNDARY');
   for(const ext of kind==='image'?['.png','.jpg','.webp']:['.mp4'])if(existsSync(path.join(outputDir,'media-'+kind+ext)))throw fail('PROBE_OUTPUT_EXISTS');
   budget=new UsageBudget(path.join(root,'private-config','usage-budget.json'));if(budget.read().forwardTestsAuthorized!==true)throw fail('FORWARD_BUDGET_PENDING');
   const approval=await ctx.approval.request({agent:e.agent,toolName:e.name,callId:e.callId,reason:JSON.stringify({summary:'独立媒体模型一次性测试；不改小婉形象或默认模型',model,prompt,maximumGenerations:1,publishedEstimateUSD:quote?.perImage,output:'model-probes/media-'+kind,referenceUploads:false}),signal:e.signal});
   if(approval!=='allowed-once')return JSON.stringify({status:'not-approved',paidRequests:0});
   e.signal.throwIfAborted();if(!process.env.DEEPSEEK_API_KEY||process.env.COMPANION_MODEL_ORIGIN!==origin)throw fail('EXISTING_RELAY_UNAVAILABLE');
   reservation=budget.reserve({model,inputTokens:0,outputTokens:0,imageCount:1,quote});
   receipt={sessionId:e.agent.session.id,callId:e.callId,requestedModel:model,reservationId:reservation.id,publishedEstimateUSD:reservation.maximum,paidPosts:0,stage:'approved',startedAt:new Date().toISOString(),requestIds:[]};save({});
   async function request(endpoint,body){
    e.signal.throwIfAborted();
    if(body){if(receipt.paidPosts!==0)throw fail('DUPLICATE_PAID_POST');save({paidPosts:1,stage:'submitting'})}
    const response=await fetch(origin+endpoint,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([e.signal,AbortSignal.timeout(body?120000:30000)])});
    const requestId=response.headers.get('x-request-id')||response.headers.get('request-id');if(requestId)save({requestIds:[...receipt.requestIds,requestId]});
    const raw=await limited(response,24*1024*1024);let data;try{data=JSON.parse(raw.toString('utf8'))}catch{throw fail('NON_JSON_MEDIA_RESPONSE',response.status+' '+String(response.headers.get('content-type')))}
    save({lastHttpStatus:response.status});if(!response.ok){const msg=String(data?.error?.message||data.message||'HTTP error').split(process.env.DEEPSEEK_API_KEY).join('[redacted]').slice(0,600);throw fail('MEDIA_HTTP_'+response.status,msg)}
    return data;
   }
   let bytes,extension,metadata;
   if(kind==='image'){
    const data=await request('/v1/images/generations',{model,prompt,n:1,response_format:'b64_json'});
    save({returnedModel:data.model??null,usage:data.usage??null,stage:'received'});const item=data.data?.[0];if(!item)throw fail('IMAGE_DATA_MISSING');
    if(item.b64_json){if(typeof item.b64_json!=='string'||item.b64_json.length>16*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.b64_json))throw fail('IMAGE_BASE64_INVALID');bytes=Buffer.from(item.b64_json,'base64');if(bytes.toString('base64')!==item.b64_json)throw fail('IMAGE_BASE64_INVALID')}
    else if(item.url){save({deliveryOrigin:new URL(item.url).origin});bytes=await downloadArtifact(item.url,e.signal)}else throw fail('IMAGE_CONTENT_MISSING');
    extension=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'.png':bytes[0]===255&&bytes[1]===216?'.jpg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'.webp':null;
    if(!extension||bytes.length<24||bytes.length>12*1024*1024)throw fail('IMAGE_FORMAT_INVALID');
    metadata={decoderValidation:'pending-host-review'};
   }else{
    const data=await request('/v1/videos/generations',{model,prompt,duration:4});const id=data.request_id||data.id;
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(id))throw fail('VIDEO_TASK_ID_INVALID');save({taskId:id,stage:'polling',returnedModel:data.model??null});
    const deadline=Date.now()+240000;let result;
    while(Date.now()<deadline){const next=await request('/v1/videos/'+encodeURIComponent(id));save({remoteStatus:next.status,returnedModel:next.model??receipt.returnedModel});if(['done','completed'].includes(next.status)){result=next;break}if(['failed','expired','cancelled'].includes(next.status))throw fail('VIDEO_REMOTE_'+next.status);await delay(4000,undefined,{signal:e.signal})}
    if(!result)throw fail('VIDEO_POLL_TIMEOUT');
    const url=result.video?.url||result.url||result.metadata?.url;if(typeof url!=='string')throw fail('VIDEO_URL_MISSING');
    save({stage:'downloading',deliveryOrigin:new URL(url).origin,usage:result.usage??null});bytes=await downloadArtifact(url,e.signal);extension='.mp4';
    if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw fail('VIDEO_HEADER_INVALID');metadata={durationReported:result.video?.duration??null,decoderValidation:'pending-host-review'};
   }
   if(bytes.length>32*1024*1024)throw fail('ARTIFACT_TOO_LARGE');e.signal.throwIfAborted();
   const relative='model-probes/media-'+kind+extension,target=path.join(root,'workspace',relative);
   if(lstatSync(path.dirname(target)).isSymbolicLink()||realpathSync(path.dirname(target)).toLowerCase()!==path.resolve(root,'workspace','model-probes').toLowerCase())throw fail('PROBE_WORKSPACE_BOUNDARY');
   writeFileSync(target,bytes,{flag:'wx'});
   const artifact={path:relative,bytes:bytes.length,sha256:hash(bytes)};save({stage:'saved',artifact,metadata});budget.settle(reservation.id,{httpStatus:receipt.lastHttpStatus,usage:receipt.usage});
   return JSON.stringify({status:'saved',requestedModel:model,returnedModel:receipt.returnedModel,artifact,validation:'Actual downloaded bytes saved; visual/decoder QA pending. Not a talking-avatar claim.'});
  }catch(err){if(receipt)save({stage:'failed',error:err.code||err.name,detail:err.detail||null});if(reservation)budget.settle(reservation.id,{httpStatus:receipt?.lastHttpStatus||0});throw Error(err.code||'MEDIA_PROBE_FAILED')}
  finally{busy=false}
 }
 // Register before the first prompt is assembled; pre-step happens too late.
 ctx.on('agent/created',p=>{
  if(probeSession&&p.agent.session.id===probeSession&&!bound.has(p.agent)){
   bound.add(p.agent);
   for(const kind of ['image','video'])p.agent.ctx.tools.register(defineTool({name:'companion_probe_'+kind,description:'One authorized '+kind+' model probe in this test session only. Native approval precedes payment. Do not retry after an attempted request. Returns a real saved artifact or exact error.',parameters:{prompt:{type:'string',required:true},reference_photo:{type:'string',description:'Only approved-original, for the explicitly approved original fictional portrait; never a file path.'},duration:{type:'number',description:'Exactly 10 for the single approved photo-conditioned compatibility trial.'}},output:{schema:{type:'string'},render:(_,v)=>[{type:'text',text:v}]},execute:(args,e)=>run(kind,args.prompt,e,args)}));
  }
 },{global:true});
}
