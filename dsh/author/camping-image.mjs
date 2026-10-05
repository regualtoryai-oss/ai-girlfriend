// New campaign receipt; existing one-shot probe receipts are never reused.
import {defineTool} from '@deepseek-ai/dsh-tools';
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';import {createHash} from 'node:crypto';
import {UsageBudget} from '../../server/usage-budget.mjs';
import {stateFor,receiptPath,IMAGE_TOOL,checkedFile} from './camping-workflow.mjs';
const origin='https://newapi1.1234bot.com',model='grok-imagine-image';
export function registerCampingImage(ctx,downloadArtifact){
 const busy=new Set();
 ctx.tools.register(defineTool({name:IMAGE_TOOL,description:'Generate one requested task visual after the real brief is saved. Bound to this workflow; native approval and existing USD budget apply. Never retry a paid POST. Returns saved bytes/path or an error.',parameters:{prompt:{type:'string',required:true}},output:{schema:{type:'string'},render:(_,v)=>[{type:'text',text:v}]},async execute(a,e){
  const s=stateFor(e.agent);if(!s||!s.needsImage||busy.has(s.job)||typeof a.prompt!=='string'||Buffer.byteLength(a.prompt)>1400||!a.prompt.trim())throw Error('CAMPING_IMAGE_SCOPE');
  const rp=receiptPath(e.agent);if(existsSync(rp))return JSON.stringify({status:'already-attempted',receipt:JSON.parse(readFileSync(rp,'utf8')),instruction:'Do not submit again; inspect original receipt.'});
  const brief=checkedFile(s.briefPath,8192);if(!brief)throw Error('CAMPING_BRIEF_REQUIRED');
  const root=process.env.COMPANION_DATA_ROOT,quotes=JSON.parse(readFileSync(path.join(root,'private-config/verified-prices.json'),'utf8')),q=quotes[origin]?.[model];
  if(!q?.verified||q.model!==model||q.unit!=='USD'||q.groupMultiplier!==1||q.inputPerMillion!==0||q.outputPerMillion!==0||!(q.perImage>0&&q.perImage<=.02))throw Error('CAMPING_IMAGE_PRICE_CAP');
  const budget=new UsageBudget(path.join(root,'private-config/usage-budget.json')),b=budget.status();if(budget.read().forwardTestsAuthorized!==true||b.reserved-s.startReserved+.02>s.maximumIncrementUSD)throw Error('CAMPING_IMAGE_BUDGET');
  const directory=path.join(process.env.COMPANION_WORKSPACE_ROOT,s.relative);if(lstatSync(directory).isSymbolicLink()||realpathSync(directory).toLowerCase()!==path.resolve(directory).toLowerCase())throw Error('CAMPING_IMAGE_BOUNDARY');
  busy.add(s.job);let r,reservation;
  const save=patch=>{r={...r,...patch,updatedAt:new Date().toISOString()};writeFileSync(rp,JSON.stringify(r,null,2))};
  try{
   const approval=await ctx.approval.request({agent:e.agent,toolName:e.name,callId:e.callId,reason:JSON.stringify({summary:'露营推广任务：生成一次活动主视觉，原 USD10 预算内',model,prompt:a.prompt,maximumGenerations:1,maximumUSD:.02,output:s.relative+'/hero',referenceUploads:false}),signal:e.signal});
   if(approval!=='allowed-once')return JSON.stringify({status:'not-approved',paidPosts:0});
   e.signal.throwIfAborted();if(!process.env.DEEPSEEK_API_KEY||process.env.COMPANION_MODEL_ORIGIN!==origin)throw Error('EXISTING_RELAY_UNAVAILABLE');
   reservation=budget.reserve({model,inputTokens:0,outputTokens:0,imageCount:1,quote:q});
   r={job:s.job,sessionId:e.agent.session.id,callId:e.callId,model,briefSha256:brief.sha256,prompt:a.prompt,startedAt:new Date().toISOString(),paidPosts:1,stage:'submitting',reservationId:reservation.id,maximumUSD:reservation.maximum};save({});
   const response=await fetch(origin+'/v1/images/generations',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model,prompt:a.prompt,n:1,response_format:'b64_json'}),signal:AbortSignal.any([e.signal,AbortSignal.timeout(120000)])});
   save({httpStatus:response.status});if(!response.ok)throw Error('CAMPING_IMAGE_HTTP_'+response.status);
   let size=0;const chunks=[];for await(const v of response.body){size+=v.length;if(size>20*1024*1024)throw Error('CAMPING_IMAGE_RESPONSE_SIZE');chunks.push(v)}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));const item=data.data?.[0];let bytes;
   if(typeof item?.b64_json==='string'){if(item.b64_json.length>16*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.b64_json))throw Error('CAMPING_IMAGE_BASE64');bytes=Buffer.from(item.b64_json,'base64');if(bytes.toString('base64')!==item.b64_json)throw Error('CAMPING_IMAGE_BASE64')}
   else if(typeof item?.url==='string')bytes=await downloadArtifact(item.url,e.signal);else throw Error('CAMPING_IMAGE_DATA_MISSING');
   const ext=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'.png':bytes[0]===255&&bytes[1]===216?'.jpg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'.webp':null;
   if(!ext||bytes.length<24||bytes.length>12*1024*1024)throw Error('CAMPING_IMAGE_FORMAT');
   const relative=s.relative+'/hero'+ext;e.signal.throwIfAborted();writeFileSync(path.join(process.env.COMPANION_WORKSPACE_ROOT,relative),bytes,{flag:'wx'});
   const artifact={path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};save({stage:'saved',artifact,returnedModel:data.model??null,usage:data.usage??null});
   return JSON.stringify({status:'saved',model,artifact,briefSha256:brief.sha256,decodeAndVisualReview:'pending'});
  }catch(err){if(r)save({stage:'failed',error:err.message,noMorePaidPosts:true});throw Error(err.message?.startsWith('CAMPING_')?err.message:'CAMPING_IMAGE_FAILED')}
  finally{if(reservation)budget.settle(reservation.id,{httpStatus:r?.httpStatus??0});busy.delete(s.job)}
 }}));
}
