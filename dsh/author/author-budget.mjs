import {campaignBudgetLimits,guardCampaignReservation} from './camping-workflow.mjs';
import {validateLimits,requestAllowance} from './author-request-limits.mjs';
import {LlmError} from '@deepseek-ai/dsh-llm';
import {providerFailure,providerChunk} from './provider-error.mjs';
import {verifiedQuote} from '../../config/readiness.mjs';
import {readFileSync,appendFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import {UsageBudget} from '../../server/usage-budget.mjs';
export const name='companion-author-budget';export const inject=['llm'];
export function apply(ctx,config){
 const limits=validateLimits(config);
 const root=process.env.COMPANION_DATA_ROOT,base=process.env.COMPANION_MODEL_ORIGIN;
 const evidence=path.join(root,'author-evidence');mkdirSync(evidence,{recursive:true});
 ctx.on('llm/stream',async function*(options,next){
  if(!['deepseek-v4-flash','deepseek-v4-pro'].includes(options.model))throw Error('TRIAL_MODEL_NOT_APPROVED');
  const budget=new UsageBudget(path.join(root,'private-config/usage-budget.json'));
  let budgetState;try{budgetState=budget.read();}catch{throw Error('BUDGET_CONFIG_INVALID');}
  if(budgetState.forwardTestsAuthorized!==true)throw Error('FORWARD_BUDGET_PENDING');
  let quotes;try{quotes=JSON.parse(readFileSync(path.join(root,'private-config/verified-prices.json'),'utf8').replace(/^\uFEFF/,''));}catch{throw Error('PRICES_CONFIG_INVALID');}
  const allowance=requestAllowance(options,campaignBudgetLimits(options,limits));
  const quote=quotes[base]?.[options.model];
  if(!verifiedQuote(quote,options.model))throw Error('PRICE_NOT_VERIFIED');
  guardCampaignReservation(options,((allowance.inputTokens*quote.inputPerMillion+allowance.outputTokens*quote.outputPerMillion)/1e6)*quote.groupMultiplier);
  const reservation=budget.reserve({model:options.model,inputTokens:allowance.inputTokens,outputTokens:allowance.outputTokens,quote:quotes[base]?.[options.model]});
  let usage,status=0;const start=Date.now();
  try{for await(const chunk of next()){status=200;if(chunk.type==='usage'){const u=chunk.usage;const input=u.inputTokens+(u.cacheReadTokens||0)+(u.cacheWriteTokens||0);usage={prompt_tokens:input,completion_tokens:u.outputTokens,total_tokens:u.totalTokens??input+u.outputTokens};}yield providerChunk(chunk);}}
  catch(error){const {message,code,...facts}=providerFailure(error,options.signal?.aborted===true);throw new LlmError(message,code,facts);}
  finally{budget.settle(reservation.id,{httpStatus:status,usage});appendFileSync(path.join(evidence,'model-calls.jsonl'),JSON.stringify({at:new Date().toISOString(),model:options.model,reservationId:reservation.id,maximum:reservation.maximum,requestBytes:allowance.requestBytes,status,usage,ms:Date.now()-start})+'\n');}
 },{global:true});
}
