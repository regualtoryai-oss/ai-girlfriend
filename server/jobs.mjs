import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
export class Jobs {
  constructor(dir,beforeCommit=async()=>{}){this.dir=dir;this.jobs=new Map();this.beforeCommit=beforeCommit;}
  create(input){
    if(!input || !/^[a-f0-9-]{36}$/.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>80||typeof input.notes!=='string'||input.notes.length>2000)throw Object.assign(new Error('标题或内容不符合要求'),{status:400});
    const old=this.jobs.get(input.id);
    if(old){if(old.title!==input.title||old.notes!==input.notes)throw Object.assign(new Error('重复编号内容冲突'),{status:409});return old;}
    if(this.jobs.size>=100)throw Object.assign(new Error('本次运行任务已达上限'),{status:429});
    const j={...input,state:'queued',executor:'bounded-local-file'};this.jobs.set(j.id,j);setImmediate(()=>this.run(j));return j;
  }
  cancel(id){const j=this.jobs.get(id);if(j&&['queued','writing'].includes(j.state))j.state='cancelled';return j;}
  async run(j){let tmp;try{
    if(j.state==='cancelled')return;j.state='writing';await mkdir(this.dir,{recursive:true});
    tmp=path.join(this.dir,`.${j.id}.partial`);const content=`# ${j.title.replace(/[\r\n]/g,' ')}\n\n${j.notes}\n\n---\n本文件由本地受限程序保存用户提供的内容，未调用模型。\n`;
    await writeFile(tmp,content,{flag:'wx'});await this.beforeCommit();
    if(j.state==='cancelled'){await unlink(tmp);return;}
    j.name=`note-${j.id}.md`;await rename(tmp,path.join(this.dir,j.name));j.bytes=Buffer.byteLength(content);j.url=`/files/${j.name}`;j.state='completed';
  }catch(e){if(tmp)await unlink(tmp).catch(()=>{});j.state='failed';j.error='文件保存失败';}}
}
