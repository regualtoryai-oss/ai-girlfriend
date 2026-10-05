// Retain only bounded, redacted diagnostics, never request bodies or headers.
const BODY_LIMIT=65536;
export function redactDiagnostic(value,secrets=[]){
 if(!['string','number'].includes(typeof value))return null;
 let text=String(value);
 for(const secret of secrets)if(typeof secret==='string'&&secret)text=text.split(secret).join('[redacted]');
 return text.replace(/data:[^\s"']*/gi,'[redacted-data-uri]')
  .replace(/https?:\/\/[^\s"'<>]*/gi,'[redacted-url]')
  .replace(/Bearer\s+[^\s"',;]+/gi,'Bearer [redacted]')
  .replace(/\bsk-[A-Za-z0-9_.-]+/gi,'[redacted]')
  .replace(/((?:api[_-]?key|authorization|cookie|token|secret)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]')
  .replace(/[A-Za-z0-9_+\/=-]{80,}/g,'[redacted-long-token]')
  .replace(/[\x00-\x1f\x7f]/g,' ').slice(0,600);
}
export function responseRequestIds(response,secrets=[]){
 const result={};
 for(const name of ['x-request-id','request-id','x-amzn-requestid','cf-ray']){
  const value=response.headers.get(name);
  if(value&&value.length<=200&&/^[A-Za-z0-9_.:-]+$/.test(value))result[name]=redactDiagnostic(value,secrets);
 }
 return result;
}
export async function readHttpErrorDiagnostics(response,secrets=[]){
 const out={httpStatus:response.status,requestIds:responseRequestIds(response,secrets),bodyKind:'empty'};
 const reader=response.body?.getReader();if(!reader)return out;
 let bytes=0,parts=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
   if(bytes>BODY_LIMIT){await reader.cancel();out.bodyKind='too-large';return out;}parts.push(Buffer.from(value));}
 }catch{out.bodyKind='unreadable';return out;}
 finally{reader.releaseLock();}
 const raw=Buffer.concat(parts).toString('utf8');if(!raw.trim())return out;
 let data;try{data=JSON.parse(raw);}catch{out.bodyKind='non-json';return out;}
 out.bodyKind='json';
 const error=data?.error&&typeof data.error==='object'?data.error:data;
 const fields={};
 for(const name of ['message','type','param','code']){const value=redactDiagnostic(error?.[name],secrets);if(value!==null)fields[name]=value;}
 out.providerError=fields;
 if(typeof data?.request_id==='string'&&data.request_id.length<=200&&/^[A-Za-z0-9_.:-]+$/.test(data.request_id))out.bodyRequestId=redactDiagnostic(data.request_id,secrets);
 return out;
}
