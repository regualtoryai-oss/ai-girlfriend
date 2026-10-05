import {validateWorkbook,createWorkbookBytes} from './workbook.mjs';
import {existsSync,mkdirSync,lstatSync,realpathSync,readdirSync,readFileSync,writeFileSync,renameSync,copyFileSync} from 'node:fs';
import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
export const hash=b=>createHash('sha256').update(b).digest('hex');
const fault=code=>Object.assign(new Error(code),{code});
export function workspaceFiles(root,backupRoot){
 mkdirSync(root,{recursive:true});root=realpathSync(root);
 function resolve(rel,{directory=false,missing=false}={}){
  if(typeof rel!=='string'||rel.length>240||rel.includes('\\')||rel.includes(':')||rel.includes('\0')||path.posix.isAbsolute(rel)||rel.split('/').some(x=>x==='..'||x==='.'||!x||x.startsWith('.')||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)||/[\r\n]/.test(x)||/[<>"|?*]/.test(x)||/^(?:node_modules|private-config|credentials)$/i.test(x)||/\.(?:pem|key)$/i.test(x)))throw fault('PATH_NOT_ALLOWED');
  const full=path.resolve(root,...rel.split('/'));if(!full.startsWith(root+path.sep))throw fault('PATH_NOT_ALLOWED');
  let cursor=root;for(const part of rel.split('/')){cursor=path.join(cursor,part);if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw fault('SYMLINK_NOT_ALLOWED');}
  if(!missing&&!existsSync(full))throw fault('FILE_NOT_FOUND');
  if(existsSync(full)&&lstatSync(full).isDirectory()&&!directory)throw fault('EXPECTED_FILE');return full;
 }
 function read(rel){const file=resolve(rel),size=lstatSync(file).size;if(size>65536)throw fault('FILE_TOO_LARGE');const bytes=readFileSync(file),content=bytes.toString('utf8');if(content.includes('\0')||content.includes('\ufffd'))throw fault('TEXT_FILE_REQUIRED');return {path:rel,bytes:bytes.length,sha256:hash(bytes),content};}
 function list(rel=''){const folder=rel?resolve(rel,{directory:true}):root;if(!lstatSync(folder).isDirectory())throw fault('EXPECTED_DIRECTORY');return readdirSync(folder,{withFileTypes:true}).filter(e=>!e.name.startsWith('.')&&e.name!=='node_modules'&&!e.isSymbolicLink()).slice(0,100).map(e=>({path:rel?rel+'/'+e.name:e.name,type:e.isDirectory()?'directory':'file'}));}
 function validate(changes){
  if(!Array.isArray(changes)||changes.length<1||changes.length>10)throw fault('INVALID_CHANGE_PLAN');const seen=new Set();
  return changes.map(a=>{if(!a||!['create','create_xlsx','replace','move'].includes(a.op))throw fault('INVALID_OPERATION');const file=resolve(a.path,{missing:a.op==='create'||a.op==='create_xlsx'});if(seen.has(a.path.toLowerCase()))throw fault('OVERLAPPING_PLAN');seen.add(a.path.toLowerCase());
   if(a.op==='create_xlsx'){if(!/\.xlsx$/i.test(a.path)||existsSync(file))throw fault('INVALID_XLSX_PATH');return {op:a.op,path:a.path,sheets:validateWorkbook(a.sheets)};}
   if(['create','replace'].includes(a.op)&&/\.xlsx$/i.test(a.path))throw fault('USE_CREATE_XLSX');
   if(a.op==='create'){if(existsSync(file))throw fault('FILE_EXISTS');if(typeof a.content!=='string'||Buffer.byteLength(a.content)>32768)throw fault('CONTENT_TOO_LARGE');return {op:a.op,path:a.path,content:a.content};}
   const current=read(a.path);if(a.expectedSha256!==current.sha256)throw fault('FILE_CHANGED_READ_AGAIN');
   if(a.op==='replace'){if(typeof a.content!=='string'||Buffer.byteLength(a.content)>32768)throw fault('CONTENT_TOO_LARGE');return {op:a.op,path:a.path,expectedSha256:current.sha256,content:a.content};}
   const target=resolve(a.to,{missing:true});if(existsSync(target)||seen.has(a.to.toLowerCase()))throw fault('DESTINATION_EXISTS');seen.add(a.to.toLowerCase());return {op:a.op,path:a.path,to:a.to,expectedSha256:current.sha256};
  });
 }
 function preview(changes){return validate(changes).map(a=>({...a,content:undefined,sheets:undefined,...(a.sheets?{workbook:a.sheets.map(s=>({name:s.name,rows:s.rows.length,columns:s.rows[0].length,preview:s.rows.slice(0,6)}))}:{}),...(a.content!==undefined?{bytes:Buffer.byteLength(a.content),preview:a.content.slice(0,500)}:{})}));}
 function apply(changes,onResult=()=>{}){const plan=validate(changes),results=[];mkdirSync(backupRoot,{recursive:true});
  // All paths and input hashes are revalidated immediately before each mutation.
  // Existing text is backed up. No shell, delete, overwrite-move or external roots.
  for(const a of plan){validate([a]);const source=resolve(a.path,{missing:a.op==='create'||a.op==='create_xlsx'});const backupId=randomUUID();
   if(!['create','create_xlsx'].includes(a.op))copyFileSync(source,path.join(backupRoot,backupId+'.backup'));
   let target=source;
   if(a.op==='move'){target=resolve(a.to,{missing:true});mkdirSync(path.dirname(target),{recursive:true});renameSync(source,target);}
   else if(a.op==='create_xlsx'){const data=createWorkbookBytes(a.sheets);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx',mode:0o600});}
   else if(a.op==='create'){mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,a.content,{flag:'wx',mode:0o600});}
   else{const temp=path.join(path.dirname(source),'.companion-'+randomUUID()+'.tmp');writeFileSync(temp,a.content,{flag:'wx',mode:0o600});renameSync(temp,source);}
   const bytes=readFileSync(target);results.push({op:a.op,path:a.op==='move'?a.to:a.path,...(a.op==='move'?{from:a.path}:{}),bytes:bytes.length,sha256:hash(bytes),...(!['create','create_xlsx'].includes(a.op)?{backupId}:{})});onResult(results.at(-1));
  }return results;
 }
 function bytes(rel){const f=resolve(rel);if(lstatSync(f).size>12*1024*1024)throw fault('FILE_TOO_LARGE');return readFileSync(f);}
 return {root,resolve,read,bytes,list,validate,preview,apply};
}
