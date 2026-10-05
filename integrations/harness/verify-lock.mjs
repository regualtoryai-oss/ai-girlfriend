// The local UI adds only workspace links; upstream package resolutions stay locked.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const repo=path.join(root,'vendor/deepseek-harness-0.1.3-alpha.1');
const yaml=createRequire(path.join(repo,'package.json'))('js-yaml');
const base=spawnSync('git',['-C',repo,'show','HEAD:pnpm-lock.yaml'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
if(base.status!==0)throw Error('HARNESS_LOCK_BASE_UNAVAILABLE');
const before=yaml.load(base.stdout),after=yaml.load(readFileSync(path.join(repo,'pnpm-lock.yaml'),'utf8'));
for(const key of ['packages','snapshots','settings','overrides','patchedDependencies'])assert.deepEqual(after[key],before[key],'LOCKED_DEPENDENCIES_CHANGED');
for(const [key,value] of Object.entries(before.importers)){
 if(key!=='packages/bundle/web-app')assert.deepEqual(after.importers[key],value,'LOCKED_IMPORTER_CHANGED: '+key);
}
const web={...after.importers['packages/bundle/web-app'],dependencies:{...after.importers['packages/bundle/web-app'].dependencies}};
delete web.dependencies['@deepseek-ai/dsh-client-ui-voice'];
assert.deepEqual(web,before.importers['packages/bundle/web-app'],'WEB_DEPENDENCIES_CHANGED');
assert.ok(after.importers['packages/client/ui-voice'],'AUTHOR_UI_IMPORTER_MISSING');
console.log('Only current UI workspace links changed; every upstream resolved dependency is unchanged.');
