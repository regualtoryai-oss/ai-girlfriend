import {writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
export const name='companion-author-host-status';
export const inject=['webServer','connection','sessionController','workspaceController','agentDefaultModel','companionDecision','tools','appReady'];
export function apply(ctx){
 ctx.effect(()=>ctx.connection.fetch.register({path:'/api/companion/status',methods:['GET'],requestBody:'buffered',async fetch(){return Response.json({foundation:'beiyege-01/dsh-voice-ai-girlfriend',commit:'480bbabada7335735cad591eaa55f32fe54a4214',harness:'0.1.3-alpha.1',authorPlugin:'@deepseek-ai/dsh-client-ui-voice',jev:ctx.companionDecision.status(),tools:ctx.tools.schemas().map(x=>x.name),voice:'bridge-not-connected',avatar:'not-yet-configured'});}}));
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
