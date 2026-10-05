// One user-approved photo-conditioned compatibility trial in the native DSH tool.
import {existsSync,readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';import {createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {buildAvatarRequest,summarizeAvatarRequest,AVATAR_RESERVATION_USD} from './avatar-video-contract.mjs';
import {UsageBudget} from '../../server/usage-budget.mjs';
import {readHttpErrorDiagnostics,responseRequestIds} from './avatar-http-diagnostics.mjs';
import {downloadApprovedCdnArtifact} from './artifact-cdn-download.mjs';
import {fileURLToPath} from 'node:url';
const origin='https://newapi1.1234bot.com';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sid=process.env.COMPANION_PROBE_SESSION_ID?.trim()||null;
const photoPath=path.join(projectRoot,'public','assets','portrait.png');
const codeError=code=>Object.assign(new Error(code),{code});
async function smallJSON(r){let n=0,parts=[];for await(const b of r.body){n+=b.length;if(n>1024*1024)throw codeError('AVATAR_RESPONSE_TOO_LARGE');parts.push(b)}try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw codeError('AVATAR_RESPONSE_NOT_JSON')}}
export async function runAvatarGeneration({ctx,e,root,prompt,options,downloadArtifact}){
 if(!sid||e.agent?.session.id!==sid||e.name!=='companion_probe_video'||path.resolve(root).toLowerCase()!==path.resolve(projectRoot,'data').toLowerCase())throw codeError('AVATAR_SCOPE_MISMATCH');
 const receiptDir=path.join(root,'author-evidence','media-probes'),receiptPath=path.join(receiptDir,'avatar-original-10s.json');
 mkdirSync(receiptDir,{recursive:true});
 if(existsSync(receiptPath))return JSON.stringify({status:'already-attempted',instruction:'Do not create again. Preserve this task; inspect or explicitly resume GET-only if pending.',receipt:JSON.parse(readFileSync(receiptPath,'utf8'))});
 const photo=readFileSync(photoPath),body=buildAvatarRequest({prompt,...options},photo),summary=summarizeAvatarRequest(body,photo);
 const published=JSON.parse(readFileSync(path.join(root,'private-config','verified-prices.json'),'utf8'))[origin]?.['grok-imagine-video'];
 if(!published?.verified||published.unit!=='USD'||published.groupMultiplier!==1||published.perImage!==.05)throw codeError('AVATAR_PUBLISHED_PRICE_CHANGED');
 const workspace=path.join(root,'workspace'),outDir=path.join(workspace,'avatar-assets'),output=path.join(outDir,'original-portrait-driver-10s.mp4');
 mkdirSync(outDir,{recursive:true});
 if(lstatSync(outDir).isSymbolicLink()||realpathSync(outDir).toLowerCase()!==path.resolve(outDir).toLowerCase()||realpathSync(workspace).toLowerCase()!==path.resolve(workspace).toLowerCase()||existsSync(output))throw codeError('AVATAR_OUTPUT_BOUNDARY');
 const budget=new UsageBudget(path.join(root,'private-config','usage-budget.json'));if(!budget.read().forwardTestsAuthorized)throw codeError('AVATAR_BUDGET_NOT_AUTHORIZED');
 const decision=await ctx.approval.request({agent:e.agent,toolName:e.name,callId:e.callId,signal:e.signal,reason:JSON.stringify({summary:'原创成年人物照片转10秒视频：一次兼容验证，不重试、不降为纯文生；原生审批后才上传照片并计费',...summary,prompt,publishedRelayUSDPerCall:.05,reservationMeaning:'0.75 USD local conservative reservation using direct xAI 720p+image reference 0.702; not a provider-enforced price ceiling or invoice',maximumGenerations:1,referenceUploads:'only approved original fictional portrait; no reference video',output:'avatar-assets/original-portrait-driver-10s.mp4'})});
 if(decision!=='allowed-once')return JSON.stringify({status:'not-approved',paidPosts:0,referenceUploaded:false});
 e.signal.throwIfAborted();if(process.env.COMPANION_MODEL_ORIGIN!==origin||!process.env.DEEPSEEK_API_KEY)throw codeError('EXISTING_RELAY_UNAVAILABLE');
 // The budget records the full conservative hold, not a claim of charged cost.
 const reserveQuote={...published,perImage:AVATAR_RESERVATION_USD,source:'Conservative authorized local hold; official reference 10*0.07+0.002 USD; relay published 0.05/call'};
 const reservation=budget.reserve({model:body.model,inputTokens:0,outputTokens:0,imageCount:1,quote:reserveQuote});
 let receipt={sessionId:sid,callId:e.callId,startedAt:new Date().toISOString(),...summary,publishedRelayUSDPerCall:.05,reservationId:reservation.id,paidPosts:0,referenceUploaded:false,stage:'approved',identityAccepted:false,actualDurationVerified:false};
 const save=patch=>{receipt={...receipt,...patch,updatedAt:new Date().toISOString()};writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600})};
 try{
  save({});
  async function request(endpoint,payload){
   e.signal.throwIfAborted();if(payload){if(receipt.paidPosts)throw codeError('AVATAR_DUPLICATE_CREATE');save({paidPosts:1,stage:'submitting',referenceUploaded:'request attempting transmission'})}
   const r=await fetch(origin+endpoint,{method:payload?'POST':'GET',redirect:'error',signal:AbortSignal.any([e.signal,AbortSignal.timeout(payload?120000:30000)]),headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},body:payload?JSON.stringify(payload):undefined});
   save({lastHttpStatus:r.status,httpRequestIds:responseRequestIds(r,[process.env.DEEPSEEK_API_KEY])});
   if(!r.ok){save({httpError:await readHttpErrorDiagnostics(r,[process.env.DEEPSEEK_API_KEY])});throw codeError('AVATAR_HTTP_'+r.status)}
   return smallJSON(r);
  }
  const response=await request('/v1/videos/generations',body),id=response.request_id||response.id;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(id))throw codeError('AVATAR_TASK_ID_INVALID');
  save({taskId:id,stage:'polling',referenceUploaded:true,referenceConditioningConfirmed:false,returnedModel:response.model??null});
  const deadline=Date.now()+300000;let result;
  while(Date.now()<deadline){const data=await request('/v1/videos/'+encodeURIComponent(id));save({remoteStatus:data.status,returnedModel:data.model??receipt.returnedModel});if(['done','completed'].includes(data.status)){result=data;break}if(['failed','expired','cancelled'].includes(data.status))throw codeError('AVATAR_REMOTE_'+data.status);await delay(4000,undefined,{signal:e.signal})}
  if(!result){save({stage:'pending-get-only',noMoreCreates:true});return JSON.stringify({status:'pending',taskId:id,paidPosts:1,instruction:'Only GET existing task later; do not create again.'})}
  const url=result.video?.url||result.url||result.metadata?.url;if(typeof url!=='string')throw codeError('AVATAR_VIDEO_URL_MISSING');
  save({stage:'downloading',deliveryOrigin:new URL(url).origin,reportedDuration:result.video?.duration??result.duration??result.seconds??null});
  const bytes=await downloadApprovedCdnArtifact(url,e.signal);if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw codeError('AVATAR_VIDEO_HEADER_INVALID');
  e.signal.throwIfAborted();writeFileSync(output,bytes,{flag:'wx'});
  const artifact={path:'avatar-assets/original-portrait-driver-10s.mp4',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};save({stage:'saved-needs-frame-qa',artifact});
  return JSON.stringify({status:'saved-needs-frame-qa',artifact,taskId:id,paidPosts:1,identityAccepted:false,actualDurationVerified:false,warning:'HTTP200 is not image-conditioning proof. Decode and inspect first frame, all sampled frames, clothing/face stability and actual duration before DUIX use. Not realtime talking.'});
 }catch(err){save({stage:'failed',error:err.code||err.name,noMoreCreates:true});throw Error(err.code||'AVATAR_GENERATION_FAILED')}
 finally{budget.settle(reservation.id,{httpStatus:receipt.lastHttpStatus||0});}
}
