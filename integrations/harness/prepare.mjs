// Restore reviewed UI files; upgrade only bytes from a recorded installation.
import {spawnSync} from 'node:child_process';
import {lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HARNESS_COMMIT='d347e703908d0406b7a7ef80e3a0e594d86b2215';
const BASELINE_COMMIT='436bf4ff5b8532b667cb57366dad01ec973e9c3c';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
function stat(file){try{return lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

/** Reject linked ancestors and paths outside the explicit installation workspace. */
function safePath(root,file){
 const relative=path.relative(root,file);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('AUTHOR_UI_PATH_OUTSIDE_WORKSPACE');
 if(normalized(realpathSync(root))!==normalized(root)||stat(root)?.isSymbolicLink())throw Error('AUTHOR_UI_LINK_REJECTED');
 let current=root;
 for(const part of relative.split(path.sep).filter(Boolean)){
  current=path.join(current,part);const info=stat(current);
  if(info?.isSymbolicLink())throw Error('AUTHOR_UI_LINK_REJECTED: '+path.relative(root,current));
  if(info&&!info.isFile()&&!info.isDirectory())throw Error('AUTHOR_UI_FILE_TYPE_REJECTED');
 }
 return stat(file);
}

function hashes(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AUTHOR_UI_MARKER_INVALID');
 for(const [relative,hash] of Object.entries(value)){
  if(!relative||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(relative)||/^[a-z]:/i.test(relative)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error('AUTHOR_UI_MARKER_INVALID');
 }
 return value;
}

function replaceFile(root,file,bytes){
 const temporary=file+'.companion-'+randomUUID()+'.tmp';
 let created=false;
 try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});created=true;safePath(root,file);renameSync(temporary,file);}
 finally{if(created&&stat(temporary))unlinkSync(temporary);}
}

/**
 * Preflight every UI file before writing. Preserve unrelated destination files.
 * @param {object} options Explicit workspace paths, patch digest and release hashes.
 * @param {Function} beforeWrite Optional reviewed upstream patch application.
 * @returns {{copied:number,updated:number,unchanged:number}} Installed file counts.
 */
export function prepareUI(options,beforeWrite=()=>{}){
 const {root,source,destination,marker,patchSha256,baseline}=options;
 for(const file of [source,destination,marker])safePath(root,file);
 if(!safePath(root,source)?.isDirectory())throw Error('AUTHOR_UI_SOURCE_MISSING');
 if(stat(destination)&&!stat(destination).isDirectory())throw Error('AUTHOR_UI_DESTINATION_INVALID');
 let previous,previousMarker=null;
 if(stat(marker)){
  if(!stat(marker).isFile())throw Error('AUTHOR_UI_MARKER_INVALID');
  previousMarker=readFileSync(marker,'utf8');previous=JSON.parse(previousMarker);
  if(previous.harnessCommit!==HARNESS_COMMIT||previous.patchSha256!==patchSha256)throw Error('AUTHOR_UI_MARKER_MISMATCH');
 }
 const installed=previous?.currentUIHashes===undefined?null:hashes(previous.currentUIHashes);
 if(baseline.releaseCommit!==BASELINE_COMMIT)throw Error('AUTHOR_UI_BASELINE_INVALID');
 const oldHashes=hashes(baseline.files),windowsHashes=hashes(baseline.windowsCheckoutFiles??{});
 const ledger=Object.assign(Object.create(null),installed??{}),plan=[],files=[],counts={copied:0,updated:0,unchanged:0};
 function scan(relative=''){
  const directory=path.join(source,relative);safePath(root,directory);
  for(const entry of readdirSync(directory,{withFileTypes:true})){
   if(entry.name==='README.md'||entry.name==='UPSTREAM-LICENSE')continue;
   const rel=relative?relative+'/'+entry.name:entry.name;
   const from=path.join(source,rel),to=path.join(destination,rel);
   const sourceStat=safePath(root,from),destinationStat=safePath(root,to);
   if(sourceStat.isDirectory()){
    if(destinationStat&&!destinationStat.isDirectory())throw Error('AUTHOR_UI_FILE_TYPE_REJECTED: '+rel);
    scan(rel);continue;
   }
   if(!sourceStat.isFile()||(destinationStat&&!destinationStat.isFile()))throw Error('AUTHOR_UI_FILE_TYPE_REJECTED: '+rel);
   const bytes=readFileSync(from),nextHash=sha256(bytes),currentHash=destinationStat?sha256(readFileSync(to)):null;
   if(currentHash===null&&installed&&Object.hasOwn(installed,rel))throw Error('AUTHOR_UI_WORKTREE_DIFFERS: '+rel+' (deleted)');
   ledger[rel]=nextHash;
   files.push({to,currentHash,nextHash});
   if(currentHash===nextHash){counts.unchanged++;continue;}
   const previousHash=installed?.[rel];
   const isBaseline=installed===null&&(currentHash===oldHashes[rel]||currentHash===windowsHashes[rel]);
   if(currentHash!==null&&currentHash!==previousHash&&!isBaseline)throw Error('AUTHOR_UI_WORKTREE_DIFFERS: '+rel);
   plan.push({from,to,bytes,currentHash});counts[currentHash===null?'copied':'updated']++;
  }
 }
 scan();
 beforeWrite();
 for(const item of files){
  safePath(root,item.to);
  if((stat(item.to)?sha256(readFileSync(item.to)):null)!==item.currentHash)throw Error('AUTHOR_UI_WORKTREE_CHANGED_DURING_PREPARE');
 }
 for(const item of plan){
  safePath(root,item.from);safePath(root,item.to);
  const actual=stat(item.to)?sha256(readFileSync(item.to)):null;
  if(actual!==item.currentHash)throw Error('AUTHOR_UI_WORKTREE_CHANGED_DURING_PREPARE');
  mkdirSync(path.dirname(item.to),{recursive:true});safePath(root,item.to);
  if(actual===null)writeFileSync(item.to,item.bytes,{flag:'wx',mode:0o600});
  else replaceFile(root,item.to,item.bytes);
 }
 for(const item of files){
  safePath(root,item.to);
  if(sha256(readFileSync(item.to))!==item.nextHash)throw Error('AUTHOR_UI_WORKTREE_CHANGED_DURING_PREPARE');
 }
 safePath(root,marker);
 const record=JSON.stringify({harnessCommit:HARNESS_COMMIT,patchSha256,currentUIHashes:ledger})+'\n';
 const currentMarker=stat(marker)?readFileSync(marker,'utf8'):null;
 if(currentMarker!==previousMarker)throw Error('AUTHOR_UI_MARKER_CHANGED_DURING_PREPARE');
 if(currentMarker!==record)replaceFile(root,marker,record);
 return counts;
}

/** Apply the fixed upstream patch and install current UI without changing local edits. */
export function prepare(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')){
 const repo=path.join(root,'vendor/deepseek-harness-0.1.3-alpha.1');
 const patch=path.join(root,'integrations/harness/xiaowan-ui.patch');
 const baselineFile=path.join(root,'integrations/harness/ui-baseline-436bf4f.json');
 for(const file of [repo,patch,baselineFile])safePath(root,file);
 if(!safePath(root,path.join(repo,'.git'))?.isDirectory())throw Error('HARNESS_GIT_DIRECTORY_INVALID');
 const patchBytes=readFileSync(patch);
 const patchTargets=[...patchBytes.toString('utf8').matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match=>path.resolve(repo,match[1].trim()));
 const git=(...args)=>spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});
 const head=git('rev-parse','HEAD');
 if(head.status!==0||head.stdout.trim()!==HARNESS_COMMIT)throw Error('HARNESS_PIN_MISMATCH');
 const counts=prepareUI({root,source:path.join(root,'integrations/dsh-ui-voice'),destination:path.join(repo,'packages/client/ui-voice'),marker:path.join(repo,'.companion-author-prepared.json'),patchSha256:sha256(patchBytes),baseline:JSON.parse(readFileSync(baselineFile,'utf8'))},()=>{
  for(const file of patchTargets)safePath(repo,file);
  if(git('apply','--check',patch).status===0){if(git('apply',patch).status!==0)throw Error('HARNESS_PATCH_FAILED');}
  else if(git('apply','--reverse','--check',patch).status!==0)throw Error('HARNESS_WORKTREE_DIFFERS');
 });
 console.log('Current Xiaowan UI sources and reviewed upstream patch prepared. '+JSON.stringify(counts));
 return counts;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepare();
