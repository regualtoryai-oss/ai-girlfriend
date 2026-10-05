// User-approved scoped CDN transport; never inherit proxy settings globally.
// Never use for relay API traffic, requests with Authorization, or arbitrary URLs.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,stat,unlink,mkdir,mkdtemp,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export function validateCdnUrl(url){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!['vidgen.x.ai','imgen.x.ai'].includes(u.hostname))throw Error('CDN_URL_REJECTED');
 return u;
}
export function childEnvironment(source){return Object.fromEntries(Object.entries(source).filter(([k])=>['SYSTEMROOT','WINDIR','TEMP','TMP'].includes(k.toUpperCase())));}
export async function downloadApprovedCdnArtifact(url,signal){
 validateCdnUrl(url);
 // Explicit credential-free loopback proxy. The original port remains the default. No global
 // launcher environment changes, and DEEPSEEK_API_KEY is never inherited.
 const env=childEnvironment(process.env);
 const systemRoot=Object.entries(env).find(([k])=>k.toUpperCase()==='SYSTEMROOT')?.[1];
 if(!systemRoot)throw Error('CDN_CURL_UNAVAILABLE');
 const proxy=new URL(process.env.COMPANION_ARTIFACT_PROXY||'http://127.0.0.1:7892');
 if(proxy.protocol!=='http:'||proxy.hostname!=='127.0.0.1'||!proxy.port||proxy.username||proxy.password||proxy.pathname!=='/'||proxy.search||proxy.hash)throw Error('CDN_PROXY_REJECTED');
 const base=fileURLToPath(new URL('../../data/author-evidence/artifact-download-cache/',import.meta.url));
 await mkdir(base,{recursive:true});const owned=await mkdtemp(base+'/download-');const temporaryFile=owned+'/artifact.part';
 try{
  const r=await exec(path.join(systemRoot,'System32','curl.exe'),['-q','--proxy',proxy.href,'--noproxy','','--proto','=https','--max-time','45','--connect-timeout','10','--max-filesize','33554432','--silent','--show-error','--output',temporaryFile,'--write-out','%{http_code}',url],{env,windowsHide:true,signal,timeout:48000,maxBuffer:2048});
  if(r.stdout.trim()!=='200')throw Error('CDN_DOWNLOAD_HTTP');
  if((await stat(temporaryFile)).size>33554432)throw Error('CDN_DOWNLOAD_TOO_LARGE');
  return await readFile(temporaryFile);
 }catch(e){throw Error(e.name==='AbortError'?'CDN_DOWNLOAD_CANCELLED':'CDN_DOWNLOAD_FAILED')}
 finally{await unlink(temporaryFile).catch(()=>{});await rmdir(owned).catch(()=>{});}
}
