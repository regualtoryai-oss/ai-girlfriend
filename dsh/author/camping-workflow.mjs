// Bounded content workflow inside the existing DSH/Jev loop; no independent runtime.
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import path from 'node:path';import {createHash} from 'node:crypto';
import {UsageBudget} from '../../server/usage-budget.mjs';
import {requestAllowance} from './author-request-limits.mjs';
export const JOB='camping-weekend-20261001';
export const REL='campaigns/'+JOB;
export const IMAGE_TOOL='companion_camping_image';
const states=new WeakMap(),active=new Map();
const digest=b=>createHash('sha256').update(b).digest('hex');
const root=()=>process.env.COMPANION_DATA_ROOT;
const recordFile=s=>path.join(root(),'author-evidence',s.job,'workflow.json');
function save(s){writeFileSync(recordFile(s),JSON.stringify(s,null,2))}
export const receiptPath=agent=>path.join(root(),'author-evidence',agent?stateFor(agent)?.job??'invalid':JOB,'image.json');
export function stateFor(agent){return states.get(agent)}
export function isCampingExecution(e){return e.name===IMAGE_TOOL&&stateFor(e.agent)?.needsImage===true}
export function checkedFile(relative,max=32768){
 const workspace=path.resolve(process.env.COMPANION_WORKSPACE_ROOT),file=path.resolve(workspace,relative);
 if(!file.startsWith(workspace+path.sep))throw Error('CAMPING_PATH_BOUNDARY');
 if(!existsSync(file))return null;
 if(realpathSync(file).toLowerCase()!==file.toLowerCase())throw Error('CAMPING_PATH_BOUNDARY');
 const bytes=readFileSync(file);if(!bytes.length||bytes.length>max)throw Error('CAMPING_FILE_SIZE');return {path:relative,bytes:bytes.length,sha256:digest(bytes),content:bytes.toString('utf8')};
}
export function beginCamping(p,message,choice){
 const staged=choice==='compound'||(['coding','workspace-task'].includes(choice)&&/目标/.test(message)&&/步骤/.test(message));
 if(!staged||!/(页面|网页|网站|文案|报告|方案|计划|目标|步骤|landing|html)/i.test(message))return false;
 if(message.length>12000)throw Error('COMPOUND_GOAL_TOO_LONG');
 const job='compound-'+digest(p.agent.session.id+':'+p.turn).slice(0,20),relative='campaigns/'+job;
 const dir=path.join(root(),'author-evidence',job);mkdirSync(dir,{recursive:true});const file=path.join(dir,'workflow.json');
 if(existsSync(file))throw Error('CAMPING_JOB_ALREADY_STARTED_INSPECT_RECEIPT');
 const budget=new UsageBudget(path.join(root(),'private-config/usage-budget.json')).status();
 if(!budget.authorized||budget.limit-budget.reserved<1.50)throw Error('CAMPING_ALLOWANCE_INSUFFICIENT');
 const isPage=/(页面|网页|网站|landing|html)/i.test(message);
 const needsImage=/(主视觉|配图|图片|插画|hero image)/i.test(message)&&!/(不要|不需要|不用|无需).{0,4}(图片|配图|主视觉|插画)/.test(message);
 const s={job,relative,sessionId:p.agent.session.id,turn:p.turn,phase:'brief-and-image',status:'running',goal:message,requestedSteps:message.split(/[\n；;]/).filter(x=>x.trim()),needsImage,isPage,startedAt:new Date().toISOString(),startReserved:budget.reserved,maximumIncrementUSD:1.50,briefPath:relative+'/brief.md',pagePath:relative+(isPage?'/index.html':'/result.md'),choiceId:choice,recoveryCount:0};
 writeFileSync(file,JSON.stringify(s,null,2),{flag:'wx'});states.set(p.agent,s);active.set(s.sessionId,s);return true;
}
export function imageResult(agent){
 const rp=receiptPath(agent);if(!existsSync(rp))return null;const r=JSON.parse(readFileSync(rp,'utf8'));if(r.stage!=='saved')return null;
 const f=checkedFile(r.artifact.path,12*1024*1024);if(!f||f.sha256!==r.artifact.sha256)throw Error('CAMPING_IMAGE_CHANGED');return r.artifact;
}
function output(s){const file=checkedFile(s.pagePath,65536);if(!file)return null;
 if(s.isPage&&(!/<html[\s>]/i.test(file.content)||!/<\/html\s*>/i.test(file.content)))throw Error('COMPOUND_OUTPUT_INCOMPLETE');
 if(s.isPage&&s.image&&!file.content.includes(path.basename(s.image.path)))throw Error('COMPOUND_IMAGE_NOT_REFERENCED');
 return {path:file.path,bytes:file.bytes,sha256:file.sha256};
}
export function campingGuard(e){const s=stateFor(e.agent);if(!s)return;
 if(['failed','cancelled','recovery-pending'].includes(s.status))return 'Workflow stopped; inspect the recorded reason before any further tool action';
 if(e.name===IMAGE_TOOL){if(!s.needsImage)return 'The user goal does not require a paid image';if(!checkedFile(s.briefPath,8192))return 'Write the real task brief first';return}
 if(e.name==='companion_probe_image'||e.name==='companion_probe_video')return 'Preserve earlier probe receipts; use the bounded workflow image tool only when requested';
 if(e.name==='companion_apply_changes'){
  let rows;try{rows=JSON.parse(e.arguments?.changesJson??e.args?.changesJson??'null')}catch{return 'Invalid workflow changes'}
  if(!Array.isArray(rows)||rows.length!==1||rows.some(x=>x.op!=='create'||x.path!==(s.phase==='page'?s.pagePath:s.briefPath)))return 'Only one current workflow output may be created';
 }
}
export function campingPrompt(agent){const s=stateFor(agent);if(!s||['failed','cancelled'].includes(s.status))return '';
 return `BOUNDED SINGLE-REQUEST CONTENT WORKFLOW. Jev selected ${s.choiceId}; the explicit staged goal is executed by this bounded workflow. Preserve this original user goal and requested steps: ${JSON.stringify({goal:s.goal,steps:s.requestedSteps})}.
Reply briefly in Chinese. Continue through actual tools without asking the user to send another stage prompt. Flash first creates ${s.briefPath}, containing the goal, ordered steps, deliverable acceptance criteria and usable content. Do not invent external facts, completed actions or customer data. ${s.needsImage?`After writing the brief, call ${IMAGE_TOOL} once for the requested visual. Native approval is mandatory. Never retry a paid POST; preserve the receipt even on timeout.`:'No paid image is required; do not call any media generation tool.'}
The original request hook selects Pro only after the real brief ${s.needsImage?'and hash-verified image':''} exist. Pro reads the brief and creates ${s.pagePath}. ${s.isPage?'Produce a complete responsive Chinese HTML page with no external code, telemetry or network submissions. Any form is a clearly labelled local preview. Reference the returned image by relative filename if present.':'Produce a substantive Markdown deliverable meeting the goal; explain unavailable actions honestly.'} Use the existing file approval tool, never raw shell. Its changesJson parameter must be a JSON-encoded STRING containing one create operation, not a raw array. Maximum output 8192 tokens, concise complete content. On errors/rejection do not claim success. After the file write actually succeeds, give one short completion summary. Phase ${s.phase}; output validation is separate from semantic/user acceptance.`;
}
export function campingRoute(p,proposed){const s=stateFor(p.agent);if(!s||p.turn!==s.turn)return null;
 if(['failed','cancelled'].includes(s.status))throw Error('COMPOUND_STOPPED_'+s.status);
 const brief=checkedFile(s.briefPath,8192),image=s.needsImage?imageResult(p.agent):null;
 const ready=brief&&(!s.needsImage||image);const phase=ready?'page':'brief-and-image';
 s.image=image;const done=ready?output(s):null;
 const model=phase==='page'?'deepseek-v4-pro':'deepseek-v4-flash';
 const {reasoningEffort,...options}=proposed;const next={...options,provider:'deepseek-official',model,maxTokens:phase==='page'?8192:2048};
 const budget=new UsageBudget(path.join(root(),'private-config/usage-budget.json')).status();
 const quotes=JSON.parse(readFileSync(path.join(root(),'private-config/verified-prices.json'),'utf8'));const quote=quotes[process.env.COMPANION_MODEL_ORIGIN]?.[model];
 if(!quote?.verified||quote.unit!=='USD')throw Error('CAMPING_PRICE_NOT_VERIFIED');
 const allowance=requestAllowance(next,{maxRequestBytes:262144,maxOutputTokens:8192});const maximum=(allowance.inputTokens*quote.inputPerMillion+allowance.outputTokens*quote.outputPerMillion)/1e6*quote.groupMultiplier;
 if(budget.reserved-s.startReserved+maximum+(s.needsImage&&!image?0.02:0)>s.maximumIncrementUSD)throw Error('CAMPING_INCREMENT_LIMIT');
 s.phase=phase;s.lastRequestAt=new Date().toISOString();s.briefSha256=brief?.sha256;s.lastModel=model;if(done){s.output=done;s.status='completed'}save(s);
 return {options:next,evidence:{job:s.job,phase,model,choiceId:s.choiceId,status:s.status,briefSha256:brief?.sha256,imageSha256:image?.sha256,maximumNextRequestUSD:maximum,incrementReservedUSD:budget.reserved-s.startReserved}};
}
export function campaignBudgetLimits(options,limits){const s=active.get(options.sessionId);return s&&s.phase==='page'&&options.model==='deepseek-v4-pro'&&options.maxTokens===8192?{...limits,maxOutputTokens:8192}:limits}
export function guardCampaignReservation(options,maximum){const s=active.get(options.sessionId);if(!s)return;
 const b=new UsageBudget(path.join(root(),'private-config/usage-budget.json')).status();if(b.reserved-s.startReserved+maximum>s.maximumIncrementUSD)throw Error('CAMPING_INCREMENT_LIMIT');
}
// Restart does not replay uncertain work or consume another paid request.
export function restoreAndRecoverCamping(agent){return undefined}
export function handleWorkflowEnd(agent,event){const s=stateFor(agent);if(!s||event.type!=='turn/end'||event.data.turn!==s.turn||s.lastHandledEndTurn===event.data.turn)return;
 s.lastHandledEndTurn=event.data.turn;
 try {
  const done=output(s);if(done){s.output=done;s.status='completed';save(s);return}
  const reason=event.data.reason.kind;
  if(reason==='max-tokens'&&s.phase==='page'&&!s.recoveryCount&&checkedFile(s.briefPath,8192)&&(!s.needsImage||imageResult(agent))){
   s.recoveryCount=1;s.status='recovery-pending';s.recoveryReason='Observed native turn/end max-tokens';s.recoveryAt=new Date().toISOString();save(s);
   agent.followup(createUserMessage({source:{kind:'hook',reason:'compound-output-limit-recovery'},content:[{type:'text',text:`Automatic bounded recovery of the original goal. Reuse the verified brief ${s.briefPath}${s.image?', and image '+s.image.path:''}. The previous output was truncated. Create only ${s.pagePath}, more compactly, within 8192 tokens. No new image, no duplicate completed output, no new human request. This is the single automatic retry; another failure stops the workflow.`}]}));
  }else{s.status=/cancel|interrupt|abort/.test(reason)?'cancelled':'failed';s.failureReason=reason;save(s)}
 }catch(error){s.status='failed';s.failureReason=error.message;save(s)}
}
export function acceptCampingRecovery(p){const s=stateFor(p.agent);if(!s||s.status!=='recovery-pending'||!p.messages.some(m=>m.source?.kind==='hook'&&m.source.reason==='compound-output-limit-recovery'))return false;
 s.turn=p.turn;s.status='running';save(s);return true;
}
