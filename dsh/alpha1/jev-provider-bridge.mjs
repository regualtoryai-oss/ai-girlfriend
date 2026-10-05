import {TypeSafeClient} from '@typesafe-ai/sdk';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
export const name='companion-jev-provider';
export const inject=['companionDecision','appReady'];
// Server-owned bridge. Binding never contacts the provider. Only the app's explicit,
// bounded request file in this fresh process workspace activates one decision.
export function apply(ctx){
 const service=ctx.companionDecision,controller=new AbortController();
 const key=process.env.COMPANION_JEV_KEY;
 if(key){const client=new TypeSafeClient({apiKey:key,baseURL:'https://api.typesafe.ai',defaultModel:'jev-latest',logLevel:'off',retry:{maxRetries:0},timeout:8000});ctx.effect(()=>service.bindClient(client));}
 let busy=false,finished=false;
 const input=path.join(process.cwd(),'jev-request.json'),output=path.join(process.cwd(),'jev-result.json');
 async function tick(){
  if(busy||finished||controller.signal.aborted||!existsSync(input))return;busy=true;
  try{const raw=readFileSync(input);if(raw.length>24000)throw Error('Invalid request size');const {request,state}=JSON.parse(raw);
   const result=await service.decide(request,{state,model:'jev-latest',signal:controller.signal});
   if(!controller.signal.aborted)writeFileSync(output,JSON.stringify({service:'companionDecision',...result}),{flag:'wx',mode:0o600});
  }catch{if(!controller.signal.aborted&&!existsSync(output))writeFileSync(output,JSON.stringify({status:'bridge-error',decision:null}),{flag:'wx',mode:0o600});}
  finally{finished=true;busy=false;}
 }
 ctx.effect(()=>{const timer=setInterval(tick,30);return()=>{clearInterval(timer);controller.abort();};});
 ctx.provide('companionJevReady',{status:service.status().status});
 process.stderr.write(JSON.stringify({companionJevLoaded:true,status:service.status().status})+'\n');
}
