import {mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const fail=(message,status)=>Object.assign(new Error(message),{status});
export class Jobs {
 constructor(dir,beforeCommit=async()=>{},adapter=null){
  this.adapter=adapter;this.controllers=new Map();this.queue=Promise.resolve();this.dir=dir;this.ledger=path.join(dir,'.jobs');this.beforeCommit=beforeCommit;this.jobs=new Map();mkdirSync(this.ledger,{recursive:true});
  for(const name of readdirSync(this.ledger).filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n))){
   const j=JSON.parse(readFileSync(path.join(this.ledger,name),'utf8'));if(!validId(j.id)||name!==`${j.id}.json`)throw Error('Invalid local job journal');
   if(['queued','writing'].includes(j.state)){
    const final=path.join(dir,`note-${j.id}.md`);
    if(existsSync(final)){j.state='completed';j.name=path.basename(final);j.url=`/files/${j.name}`;j.bytes=readFileSync(final).length;}
    else{j.state='failed';j.error='服务中断，任务未完成；请新建任务。';}
    j.revision++;const partial=path.join(dir,`.${j.id}.partial`);if(existsSync(partial))unlinkSync(partial);this.persist(j);
   }this.jobs.set(j.id,j);
  }
 }
 persist(j){const dest=path.join(this.ledger,`${j.id}.json`),tmp=dest+'.tmp';writeFileSync(tmp,JSON.stringify(j),{mode:0o600});renameSync(tmp,dest);}
 set(j,state){j.state=state;j.revision++;this.persist(j);}
 create(input){
  if(this.closed)throw fail("Task runner is closed",503);
  if(!input||!validId(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>80||typeof input.notes!=='string'||input.notes.length>2000||input.turnId!==undefined&&!validId(input.turnId))throw fail('标题或内容不符合要求',400);
  const old=this.jobs.get(input.id);if(old){if(old.title!==input.title||old.notes!==input.notes||input.turnId&&old.turnId!==input.turnId)throw fail('重复编号内容冲突',409);return old;}
  if(this.jobs.size>=100)throw fail('本地任务已达上限',429);
  const j={id:input.id,title:input.title,notes:input.notes,turnId:input.turnId||input.id,requestId:input.requestId||input.id,state:'queued',revision:1,executor:this.adapter?'deepseek-harness':'bounded-local-file',...(this.adapter?{harnessVersion:this.adapter.version}:{})};
  this.persist(j);this.jobs.set(j.id,j);this.queue=this.queue.then(()=>this.run(j));return j;
 }
 cancel(id,expectedRevision){const j=this.jobs.get(id);if(!j)return undefined;if(expectedRevision!==undefined&&expectedRevision!==j.revision)throw fail('任务状态已变化，请刷新后重试',409);if(['queued','writing'].includes(j.state)){this.controllers.get(id)?.abort();this.set(j,'cancelled');}return j;}
 close(){this.closed=true;for(const j of this.jobs.values())if(['queued','writing'].includes(j.state))this.cancel(j.id);}
 async run(j){let tmp;const controller=new AbortController();this.controllers.set(j.id,controller);try{
  if(j.state==='cancelled')return;this.set(j,'writing');tmp=path.join(this.dir,`.${j.id}.partial`);
  let content=`# ${j.title.replace(/[\r\n]/g,' ')}\n\n${j.notes}\n\n---\n本文件由本地受限程序保存用户提供的内容，未调用模型。\n`;
  if(this.adapter){const result=await this.adapter.generate({...j,signal:controller.signal});content=result.content;if(!Buffer.isBuffer(content)||content.length>16000)throw Error('Invalid artifact');j.sha256=createHash('sha256').update(content).digest('hex');j.evidence=result.evidence;}
  if(j.state==='cancelled')return;
  writeFileSync(tmp,content,{flag:'wx',mode:0o600});await this.beforeCommit();
  if(j.state==='cancelled'){unlinkSync(tmp);return;}
  // No await between the final cancellation check and atomic file publication.
  j.name=`note-${j.id}.md`;renameSync(tmp,path.join(this.dir,j.name));tmp=null;j.bytes=Buffer.byteLength(content);j.url=`/files/${j.name}`;this.set(j,'completed');
 }catch(e){if(tmp&&existsSync(tmp))unlinkSync(tmp);if(j.state==='cancelled')return;j.errorCode=/^[A-Z_]+$/.test(e.code||'')?e.code:'TASK_FAILED';j.error='文件保存失败';try{this.set(j,'failed');}catch{j.state='failed';}}finally{this.controllers.delete(j.id);}}
}
