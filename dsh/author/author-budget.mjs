import {campaignBudgetLimits,guardCampaignReservation} from './camping-workflow.mjs';
import {validateLimits,requestAllowance} from './author-request-limits.mjs';
import {readFileSync,appendFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import {UsageBudget} from '../../server/usage-budget.mjs';
export const name='companion-author-budget';export const inject=['llm'];
export function apply(ctx,config){
 const limits=validateLimits(config);
 const root=process.env.COMPANION_DATA_ROOT,base=process.env.COMPANION_MODEL_ORIGIN;
 const evidence=path.join(root,'author-evidence');mkdirSync(evidence,{recursive:true});
 ctx.on('llm/stream',async function*(options,next){
  if(!['deepseek-v4-flash','deepseek-v4-pro'].includes(options.model))throw Error('TRIAL_MODEL_NOT_APPROVED');
  const budget=new UsageBudget(path.join(root,'private-config/usage-budget.json'));
  if(budget.read().forwardTestsAuthorized!==true)throw Error('FORWARD_BUDGET_PENDING');
  const quotes=JSON.parse(readFileSync(path.join(root,'private-config/verified-prices.json'),'utf8'));
  const allowance=requestAllowance(options,campaignBudgetLimits(options,limits));
  const quote=quotes[base]?.[options.model];
  guardCampaignReservation(options,((allowance.inputTokens*quote.inputPerMillion+allowance.outputTokens*quote.outputPerMillion)/1e6)*quote.groupMultiplier);
  const reservation=budget.reserve({model:options.model,inputTokens:allowance.inputTokens,outputTokens:allowance.outputTokens,quote:quotes[base]?.[options.model]});
  let usage,status=0;const start=Date.now();
  try{for await(const chunk of next()){status=200;if(chunk.type==='usage'){const u=chunk.usage;const input=u.inputTokens+(u.cacheReadTokens||0)+(u.cacheWriteTokens||0);usage={prompt_tokens:input,completion_tokens:u.outputTokens,total_tokens:u.totalTokens??input+u.outputTokens};}yield chunk;}}
  finally{budget.settle(reservation.id,{httpStatus:status,usage});appendFileSync(path.join(evidence,'model-calls.jsonl'),JSON.stringify({at:new Date().toISOString(),model:options.model,reservationId:reservation.id,maximum:reservation.maximum,requestBytes:allowance.requestBytes,status,usage,ms:Date.now()-start})+'\n');}
 },{global:true});
}
