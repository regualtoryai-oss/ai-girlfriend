// Restore the reviewed local UI on the exact upstream source; never replace a divergent file.
import {spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const repo=path.join(root,'vendor/deepseek-harness-0.1.3-alpha.1');
const patch=path.join(root,'integrations/harness/xiaowan-ui.patch');
const git=(...args)=>spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});
if(git('rev-parse','HEAD').stdout.trim()!=='d347e703908d0406b7a7ef80e3a0e594d86b2215')throw Error('HARNESS_PIN_MISMATCH');
if(git('apply','--check',patch).status===0){if(git('apply',patch).status!==0)throw Error('HARNESS_PATCH_FAILED');}
else if(git('apply','--reverse','--check',patch).status!==0)throw Error('HARNESS_WORKTREE_DIFFERS');
const source=path.join(root,'integrations/dsh-ui-voice');
const destination=path.join(repo,'packages/client/ui-voice');
function copy(relative=''){
 for(const entry of readdirSync(path.join(source,relative),{withFileTypes:true})){
  if(entry.name==='README.md'||entry.name==='UPSTREAM-LICENSE')continue;
  const rel=path.join(relative,entry.name),from=path.join(source,rel),to=path.join(destination,rel);
  if(entry.isDirectory()){mkdirSync(to,{recursive:true});copy(rel);}
  else if(!existsSync(to))cpSync(from,to);
  else if(!readFileSync(from).equals(readFileSync(to)))throw Error('AUTHOR_UI_WORKTREE_DIFFERS: '+rel);
 }
}
mkdirSync(destination,{recursive:true});copy();
writeFileSync(path.join(repo,'.companion-author-prepared.json'),JSON.stringify({harnessCommit:'d347e703908d0406b7a7ef80e3a0e594d86b2215',patchSha256:createHash('sha256').update(readFileSync(patch)).digest('hex')})+'\n');
console.log('Current Xiaowan UI sources and reviewed upstream patch prepared.');
