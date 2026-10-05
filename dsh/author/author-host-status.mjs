import {writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorReadiness} from './author-readiness.mjs';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
export const name='companion-author-host-status';
export const inject=['webServer','connection','sessionController','workspaceController','agentDefaultModel','companionDecision','tools','appReady'];
export function apply(ctx){
 for(const route of ['/api/companion/status','/api/companion/readiness'])ctx.effect(()=>ctx.connection.fetch.register({path:route,methods:['GET'],requestBody:'buffered',async fetch(){return Response.json(await authorReadiness(projectRoot),{headers:{'Cache-Control':'no-store'}});}}));
 ctx.effect(()=>ctx.connection.fetch.register({path:'/api/companion/voice/recheck',methods:['POST'],requestBody:'buffered',async fetch(request){
  if((await request.arrayBuffer()).byteLength)return Response.json({code:'RECHECK_BODY_NOT_ALLOWED'},{status:400});
  try{
   const response=await globalThis.fetch('http://127.0.0.1:8765/api/models/recheck',{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000)});
   if(!response.ok)throw Error('recheck failed');
   return Response.json({rechecked:true,...await authorReadiness(projectRoot)},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({rechecked:false,code:'VOICE_RECHECK_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});}
 }}));
 const register=(route,handler)=>ctx.effect(()=>ctx.connection.fetch.register({path:route,methods:['GET'],requestBody:'buffered',fetch:handler}));
 const prefix='/api/companion/avatar';
 register(prefix+'/api/media/bg-images',()=>Response.json({media:[{name:'original-companion-portrait.png',type:'image'}]}));
 register(prefix+'/api/media/task-videos',()=>Response.json({videos:[]}));
 register(prefix+'/media/bg-images/original-companion-portrait.png',()=>new Response(readFileSync(path.join(projectRoot,'public','assets','portrait.png')),{headers:{'Content-Type':'image/png'}}));
 register(prefix+'/api/health',()=>Response.json({ready:false,mode:'static-portrait-only',voiceConnected:false},{status:503}));
 register(prefix+'/api/dh/status',()=>Response.json({enabled:false,state:'idle',message:'静态形象；实时语音和口型未接通',videos:[],pending:0,progress:0}));
 ctx.effect(()=>ctx.appReady.onReady(async()=>{
  await ctx.agentDefaultModel.saveSelection({provider:'deepseek-official',model:'deepseek-v4-flash'});
  const workspace=await ctx.workspaceController.create({path:path.join(projectRoot,'data','workspace')});
  writeFileSync('author-workspace.json',JSON.stringify(workspace));
  writeFileSync('author-launch-url.txt',ctx.connection.authenticatedUrl('http://127.0.0.1:8796'),{mode:0o600});process.stderr.write('AUTHOR_WEB_READY http://127.0.0.1:8796\n');
 }));
}
