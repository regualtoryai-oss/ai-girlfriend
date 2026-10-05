import {defineTool} from '@deepseek-ai/dsh-tools';
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import path from 'node:path';import {createHash} from 'node:crypto';
export const name='companion-bounded-note';
export const inject=['tools','appReady'];
export function apply(ctx){
 const allowed='companion_write_note';ctx.tools.guard(exec=>exec.name===allowed?undefined:'This personal demo authorizes only the bounded note tool');
 if(process.env.COMPANION_DSH_TASK_AUTH==='1')ctx.tools.register(defineTool({name:allowed,description:'Save a short Chinese Markdown note requested by the user. Only writes one fixed task file inside this task workspace. No shell, network or arbitrary paths.',parameters:{title:{type:'string',required:true},content:{type:'string',required:true}},output:{schema:{type:'string'},render:(_,value)=>[{type:'text',text:value}]},async execute(args,exec){
  if(process.env.COMPANION_DSH_TASK_AUTH!=='1')throw Error('No explicit file task authorization');if(exec.signal.aborted)throw Error('Cancelled');
  if(typeof args.title!=='string'||args.title.length>80||!args.title.trim()||typeof args.content!=='string'||args.content.length>4000||!args.content.trim())throw Error('Invalid note size');
  const title=args.title.replace(/[\r\n]/g,' '),heading='# '+title+'\n';const body=args.content.startsWith(heading)?args.content.slice(heading.length).trimStart():args.content;
  const root=process.cwd(),name='companion-note.md',target=path.join(root,name),content=`# ${title}\n\n${body}\n`;
  if(existsSync(target))throw Error('Task artifact already exists; do not overwrite');mkdirSync(root,{recursive:true});writeFileSync(target,content,{flag:'wx',mode:0o600});const bytes=readFileSync(target);return JSON.stringify({executor:'deepseek-harness',tool:allowed,file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }}));
 process.stderr.write(JSON.stringify({proofRegistry:ctx.tools.schemas().map(s=>s.name)})+'\n');
 ctx.provide('companionProofReady',{registered:true});
 ctx.effect(()=>ctx.appReady.onReady(()=>process.stderr.write(JSON.stringify({proofLauncherReady:true})+'\n')));
}
