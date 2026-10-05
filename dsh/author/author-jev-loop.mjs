import {buildJevContext} from './author-jev-context.mjs';
import {beginCamping,campingRoute,campingPrompt,campingGuard,restoreAndRecoverCamping,acceptCampingRecovery,handleWorkflowEnd} from './camping-workflow.mjs';
import {chooseChainRoute} from './author-chain-route.mjs';

import {createHash} from 'node:crypto';

import {TypeSafeClient} from '@typesafe-ai/sdk';

import {taskCandidates} from '../../server/task-intents.mjs';

import {appendFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';

export const name='companion-author-jev-loop';export const inject=['companionDecision','tools'];

export function apply(ctx){

 ctx.tools.guard(campingGuard);
 ctx.on('agent/created',({agent})=>{
  restoreAndRecoverCamping(agent);
  agent.ctx.on('session/event',(session,event)=>{if(session.id===agent.session.id)handleWorkflowEnd(agent,event)},{global:true});
  agent.ctx.inject(['systemPrompt'],scope=>scope.systemPrompt.section({name:'companion:authorized-camping',order:900,text:()=>campingPrompt(agent)}));
 },{global:true});
 const key=process.env.COMPANION_JEV_KEY;

 if(key){const client=new TypeSafeClient({apiKey:key,baseURL:'https://api.typesafe.ai',defaultModel:'jev-latest',logLevel:'off',retry:{maxRetries:0},timeout:8000});ctx.effect(()=>ctx.companionDecision.bindClient(client));}

 const turns=new WeakMap(),choices=new WeakMap(),chainRoutes=new WeakMap();const dir=path.join(process.env.COMPANION_DATA_ROOT,'author-evidence');mkdirSync(dir,{recursive:true});

 ctx.tools.guard(exec=>exec.name==='companion_apply_changes'&&!['workspace-task','coding','compound'].includes(choices.get(exec.agent))?'Jev has not selected a file task for this turn':undefined);

 ctx.on('agent/pre-step',async (p,next)=>{
  if(acceptCampingRecovery(p)){turns.set(p.agent,p.turn);choices.set(p.agent,'compound');return next();}

  if(p.messages.length&&turns.get(p.agent)!==p.turn){

   const message=p.messages.flatMap(m=>m.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');

   if(message){
    choices.delete(p.agent); chainRoutes.delete(p.agent);
    const state=buildJevContext(p.agent.session,p.messages,message,p.turn);

    const request={schemaVersion:1,kind:'choice',requestId:randomUUID(),turnId:randomUUID(),candidates:taskCandidates(message)};

    const start=Date.now();const result=await ctx.companionDecision.decide(request,{state,model:'jev-latest',signal:p.signal});

    appendFileSync(path.join(dir,'jev-decisions.jsonl'),JSON.stringify({at:new Date().toISOString(),sessionId:p.agent.session.id,turn:p.turn,status:result.status,choiceId:result.decision?.choiceId,contextMessages:state.recentConversation.length,contextBytes:Buffer.byteLength(JSON.stringify(state)),contextSha256:createHash('sha256').update(JSON.stringify(state)).digest('hex'),ms:Date.now()-start})+'\n');

    if(result.status!=='ready')throw Error('JEV_DECISION_UNAVAILABLE');

    turns.set(p.agent,p.turn);choices.set(p.agent,result.decision.choiceId);
    beginCamping(p,message,result.decision.choiceId);

    const route=chooseChainRoute(p.agent.session.id,message,result.decision.choiceId);

    if(route?.dependency){

     const input=path.join(process.env.COMPANION_WORKSPACE_ROOT,route.dependency);

     if(!existsSync(input))throw Error('CHAIN_DEPENDENCY_MISSING');

     const bytes=readFileSync(input);if(bytes.length===0||bytes.length>8192)throw Error('CHAIN_DEPENDENCY_INVALID');

     route.dependencySha256=createHash('sha256').update(bytes).digest('hex');

    }

    chainRoutes.set(p.agent,route);

   }

  }

  return next();

 },{global:true});

 // Original DSH request waterfall: same registered adapters and budget hook.

 ctx.on('agent/request',async(p,next)=>{

  const proposed=await next(),route=chainRoutes.get(p.agent);

  const camping=campingRoute(p,proposed);
  if(camping){appendFileSync(path.join(dir,'camping-model-routes.jsonl'),JSON.stringify({at:new Date().toISOString(),sessionId:p.agent.session.id,turn:p.turn,step:p.step,...camping.evidence})+'\n');return camping.options;}
  if(!route)return proposed;

  const {reasoningEffort,...rest}=proposed;

  appendFileSync(path.join(dir,'chain-model-routes.jsonl'),JSON.stringify({at:new Date().toISOString(),sessionId:p.agent.session.id,turn:p.turn,step:p.step,...route})+'\n');

  return {...rest,provider:route.provider,model:route.model};

 },{global:true});

}
