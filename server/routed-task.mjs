import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';import path from 'node:path';import os from 'node:os';import {randomUUID,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {UsageBudget} from './usage-budget.mjs';import {requestModel,intersectProfiles} from './multimodal-adapters.mjs';import {workspaceFiles} from './workspace-files.mjs';
const fail=code=>Object.assign(new Error(code),{code});const hash=b=>createHash('sha256').update(b).digest('hex');
export async function executeRoutedTask({dataRoot,taskType,text,turnId,requestId,onEvent,onApproval,onArtifacts,signal,fetchImpl=fetch}){
 const p=JSON.parse(readFileSync(path.join(dataRoot,'private-config/providers.json'),'utf8')).relay;
 if(!p?.apiKey)throw fail('RELAY_CREDENTIAL_REQUIRED');
 if(!p.catalog?.modelIds?.length)throw fail('RELAY_MODEL_DISCOVERY_REQUIRED');
 if(taskType==='video')throw fail('VIDEO_PROTOCOL_AND_PRICE_UNVERIFIED');
 if(taskType==='compound')throw fail('COMPOUND_PLAN_NOT_IMPLEMENTED');
 const eligible=intersectProfiles(p.catalog.modelIds);
 // These are documented-protocol first-trial candidates, not a quality ranking.
 const profile=taskType==='coding'?eligible.find(x=>x.id==='gpt-6.1-sol'):eligible.find(x=>x.id==='grok-imagine-image');if(!profile)throw fail('REQUIRED_MODEL_NOT_AUTHORIZED');
 const priceFile=path.join(dataRoot,'private-config/verified-prices.json'),prices=existsSync(priceFile)?JSON.parse(readFileSync(priceFile,'utf8')):{};
 const quote=prices[p.baseUrl]?.[profile.id],budget=new UsageBudget(path.join(dataRoot,'private-config/usage-budget.json'));
 const route={provider:'relay',model:profile.id,capability:taskType,protocol:profile.protocol,reason:'Jev 判断任务类型；取账户目录与已文档化接口交集，进行能力验证。尚未证明该模型最强。'};
 onEvent({type:'route',route,summary:`中转站 / ${profile.id} / ${profile.protocol}`});
 if(signal?.aborted)throw fail('ABORTED');
 const prompt=taskType==='coding'?'生成一个纯JavaScript函数 solve(input) 完成以下需求。只返回JSON对象 {"code":"function solve(input){...}","tests":[{"input":...,"expected":...}]}。不能导入模块、访问网络/文件/进程，不生成命令。code不超过3000字符，提供3个独立测试。需求：'+text.slice(0,300):text.slice(0,500);
 const result=await requestModel({baseUrl:p.baseUrl,apiKey:p.apiKey,model:profile.id,protocol:profile.protocol,prompt,maxOutputTokens:taskType==='coding'?512:64,signal,budget,quote,fetchImpl,onRawResponse:receipt=>{const dir=path.join(dataRoot,'model-receipts');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,receipt.reservationId+'.json'),JSON.stringify(receipt),{mode:0o600});}});
 if(signal?.aborted)throw fail('ABORTED');
 const files=workspaceFiles(path.join(dataRoot,'workspace'),path.join(dataRoot,'file-backups',turnId)),folder='generated/'+turnId;
 if(taskType==='coding'){
  let object;try{object=JSON.parse(result.text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw fail('CODE_RESPONSE_NOT_JSON');}
  if(typeof object.code!=='string'||object.code.length>3000||!Array.isArray(object.tests)||!object.tests.length||object.tests.length>6||JSON.stringify(object.tests).length>5000)throw fail('CODE_RESPONSE_INVALID');
  const changes=[{op:'create',path:folder+'/solution.mjs',content:object.code+'\nexport default solve;\n'},{op:'create',path:folder+'/tests.json',content:JSON.stringify(object.tests,null,2)}];files.validate(changes);
  const approvalId=randomUUID(),digest=hash(Buffer.from(JSON.stringify(changes)));const approved=await onApproval({approvalId,digest,summary:'保存生成代码与测试数据，并在隔离子进程中运行这些纯函数测试（不授予文件/网络工具）。',changes:changes.map(x=>({op:x.op,path:x.path,preview:x.content}))});
  if(!approved||signal?.aborted)throw fail(signal?.aborted?'ABORTED':'PLAN_NOT_APPROVED');const artifacts=files.apply(changes);onArtifacts(artifacts);
  const env={};for(const k of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
  const child=spawnSync(process.execPath,['--permission','--allow-fs-read='+path.join(path.dirname(fileURLToPath(import.meta.url)),'pure-code-check.mjs'),'--max-old-space-size=48',path.join(path.dirname(fileURLToPath(import.meta.url)),'pure-code-check.mjs')],{input:JSON.stringify(object),env,windowsHide:true,timeout:3500,maxBuffer:65536});
  let checks;try{checks=JSON.parse(child.stdout.toString());}catch{checks={passed:false,error:'CHECK_PROCESS_FAILED'};}const report=files.apply([{op:'create',path:folder+'/test-result.json',content:JSON.stringify(checks,null,2)}]);artifacts.push(...report);onArtifacts(artifacts);onEvent({type:'tool-result',tool:'pure-function-test',summary:checks.passed?'实际纯函数用例全部通过':'实际测试未通过，保留源码与失败报告'});
  return {text:checks.passed?'代码和测试报告已保存，纯函数用例通过。':'代码已保存，但实际测试未通过；请查看测试报告。',route,artifacts,turnId,requestId};
 }
 // Image bytes require an actual decoder validation before publishing.
 const imagePath=folder+'/image'+result.extension,approvalId=randomUUID(),digest=hash(result.bytes);const approved=await onApproval({approvalId,digest,summary:'保存本次真实图像接口返回的图片。',changes:[{op:'create',path:imagePath,bytes:result.bytes.length}]});
 if(!approved||signal?.aborted)throw fail(signal?.aborted?'ABORTED':'PLAN_NOT_APPROVED');
 const filePython=path.join(path.dirname(fileURLToPath(import.meta.url)),'../.venv-files',process.platform==='win32'?'Scripts/python.exe':'bin/python'),bundledPython=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');const validation=spawnSync(process.env.COMPANION_XLSX_PYTHON||(existsSync(filePython)?filePython:(existsSync(bundledPython)?bundledPython:(process.platform==='win32'?'python.exe':'python3'))),[path.join(path.dirname(fileURLToPath(import.meta.url)),'validate-image.py')],{input:result.bytes,timeout:10000,maxBuffer:10000,windowsHide:true});
 if(validation.status!==0)throw fail('GENERATED_IMAGE_DECODE_FAILED');const target=files.resolve(imagePath,{missing:true});mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,result.bytes,{flag:'wx'});const artifacts=[{op:'create_image',path:imagePath,bytes:result.bytes.length,sha256:digest}];onArtifacts(artifacts);return {text:'真实生成图片已保存，可打开验看。',route,artifacts,turnId,requestId};
}
