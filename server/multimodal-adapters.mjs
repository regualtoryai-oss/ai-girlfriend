import {parseResponse} from './response-parser.mjs';
// Protocol-specific adapters. Catalog/documentation evidence is kept separate
// from actual endpoint verification. No endpoint discovery or retries here.
const fault=c=>Object.assign(new Error(c),{code:c});
const origins=new Set(['https://newapi1.1234bot.com','https://newapi.1234bot.com','https://llmapi.lovbrowser.com','https://llmapi-direct.lovbrowser.com']);
export const MODEL_PROFILES=Object.freeze([
 {id:'deepseek-v4-flash',protocol:'chat-completions',documented:['text','tools'],quality:'not-benchmarked'},
 {id:'deepseek-v4-pro',protocol:'chat-completions',documented:['text','tools'],quality:'not-benchmarked'},
 {id:'gpt-6.1-sol',protocol:'responses',documented:['text','tools'],trialFor:['coding'],quality:'not-benchmarked'},
 {id:'grok-imagine-image',protocol:'images',documented:['image'],quality:'not-benchmarked'},
 {id:'grok-imagine-image-quality',protocol:'images',documented:['image'],quality:'not-benchmarked'}
]);
export function intersectProfiles(authorizedIds){return MODEL_PROFILES.filter(m=>authorizedIds.includes(m.id));}
export async function requestModel({baseUrl,apiKey,model,protocol,prompt,maxOutputTokens=64,signal,budget,quote,fetchImpl=fetch,onRawResponse=()=>{}}){
 if(!origins.has(baseUrl)||!apiKey||typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>1800||!Number.isInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>512)throw fault('INVALID_MODEL_REQUEST');
 let endpoint,body;if(protocol==='responses'){endpoint='/v1/responses';body={model,input:[{role:'user',content:[{type:'input_text',text:prompt}]}],max_output_tokens:maxOutputTokens};}
 else if(protocol==='chat-completions'){endpoint='/v1/chat/completions';body={model,messages:[{role:'user',content:prompt}],stream:false,max_tokens:maxOutputTokens};}
 else if(protocol==='images'){endpoint='/v1/images/generations';body={model,prompt,aspect_ratio:'1:1',response_format:'b64_json',n:1};}
 else throw fault('PROTOCOL_NOT_SUPPORTED');
 // Relay may inject instructions. Reserve a 16k input allowance; this is
 // an estimate, not a provider-enforced input or billing cap.
 const serialized=JSON.stringify(body),inputBound=protocol==='images'?0:Math.max(16000,Buffer.byteLength(serialized)+256);
 const reservation=budget.reserve({model,inputTokens:inputBound,outputTokens:protocol==='images'?0:maxOutputTokens,imageCount:protocol==='images'?1:0,quote});
 let response;try{response=await fetchImpl(baseUrl+endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:serialized,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(protocol==='images'?90000:60000)]):AbortSignal.timeout(protocol==='images'?90000:60000)});}catch{budget.settle(reservation.id,{httpStatus:0});throw fault('MODEL_REQUEST_FAILED');}
 if(!response.ok){budget.settle(reservation.id,{httpStatus:response.status});let detail='';try{const raw=(await response.text()).slice(0,8000);let value;try{value=JSON.parse(raw)}catch{};detail=String(value?.error?.message||value?.message||'Non-JSON error response').split(apiKey).join('[redacted]').replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/gi,'[redacted]').slice(0,600);}catch{};throw Object.assign(fault('MODEL_HTTP_ERROR'),{httpStatus:response.status,detail});}
 let data;try{const raw=await response.text();if(raw.length>20*1024*1024)throw Error();onRawResponse({reservationId:reservation.id,contentType:response.headers.get('content-type'),raw});data=parseResponse(raw,protocol);}catch{budget.settle(reservation.id,{httpStatus:response.status});throw Object.assign(fault('MODEL_RESPONSE_INVALID'),{httpStatus:response.status,detail:'Unsupported response format: '+String(response.headers.get('content-type')||'unknown').slice(0,100)});}
 const usage=data.usage||{};budget.settle(reservation.id,{httpStatus:response.status,usage:{prompt_tokens:usage.prompt_tokens??usage.input_tokens,completion_tokens:usage.completion_tokens??usage.output_tokens,total_tokens:usage.total_tokens}});
 if(protocol==='images'){
  const image=data.data?.[0];if(!image)throw fault('IMAGE_MISSING');
  if(image.b64_json){if(typeof image.b64_json!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.b64_json))throw fault('INVALID_IMAGE_ENCODING');const bytes=Buffer.from(image.b64_json,'base64');return {kind:'image',bytes,...imageFormat(bytes),model,protocol,reservationId:reservation.id};}
  // Returned URLs may reference unapproved third-party hosts. Do not send the
  // bearer key there or follow arbitrary redirects. The caller can surface the
  // exact missing delivery-origin evidence without falsely claiming a saved image.
  if(image.url){let u;try{u=new URL(image.url);}catch{throw fault('IMAGE_URL_INVALID');}if(u.protocol!=='https:'||u.origin!==baseUrl||u.username||u.password)throw fault('IMAGE_DELIVERY_HOST_UNVERIFIED');const r=await fetchImpl(u.href,{redirect:'error',signal:signal||AbortSignal.timeout(15000)});if(!r.ok)throw fault('IMAGE_DOWNLOAD_FAILED');const bytes=Buffer.from(await r.arrayBuffer());return {kind:'image',bytes,...imageFormat(bytes),model,protocol,reservationId:reservation.id};}
  throw fault('IMAGE_MISSING');
 }
 const text=protocol==='responses'?(data.output_text||(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n')):data.choices?.[0]?.message?.content;
 if(typeof text!=='string'||!text.trim())throw fault('EMPTY_MODEL_OUTPUT');return {kind:'text',text,model,protocol,reservationId:reservation.id};
}
export function imageFormat(b){if(!Buffer.isBuffer(b)||b.length<24||b.length>12*1024*1024)throw fault('IMAGE_SIZE_INVALID');if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',extension:'.png'};if(b[0]===255&&b[1]===216&&b[2]===255)return {mime:'image/jpeg',extension:'.jpg'};if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',extension:'.webp'};throw fault('IMAGE_FORMAT_INVALID');}
