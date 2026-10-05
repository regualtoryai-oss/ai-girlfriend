// Create the explicit author profile, then let the official CLI own plugin registration.
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const repo=path.join(root,'vendor/deepseek-harness-0.1.3-alpha.1');
const home=path.join(root,'data/dsh-author-home'),profile=path.join(home,'profiles/author-web');
mkdirSync(profile,{recursive:true});
const manifestFile=path.join(profile,'package.json');
if(!existsSync(manifestFile))writeFileSync(manifestFile,JSON.stringify({name:'dsh-profile-author-web',private:true,dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'],patchReload:'startup'}}},null,2)+'\n');
const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
if(manifest.dsh?.profile?.bundles?.slice(0,2).join(',')!=='@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app')throw Error('EXISTING_AUTHOR_PROFILE_DIFFERS');
for(const [name,content] of [['cordis.yml','[]\n'],['cordis.patch.yml','[]\n'],['pnpm-workspace.yaml','packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n']])if(!existsSync(path.join(profile,name)))writeFileSync(path.join(profile,name),content);
const env={};for(const key of ['SystemRoot','WINDIR','COMSPEC','TEMP','TMP','PATHEXT'])if(process.env[key])env[key]=process.env[key];
env.PATH=path.join(root,'build-tools/node_modules/.bin')+path.delimiter+path.dirname(process.execPath)+path.delimiter+(process.env.PATH||process.env.Path||'');
Object.assign(env,{DSH_HOME:home,DSH_TELEMETRY_MODE:'DISABLED',DSH_TELEMETRY_DISABLED:'1',TSX_TSCONFIG_PATH:path.join(repo,'tsconfig.json')});
const command=['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/esm/index.mjs')).href,path.join(repo,'apps/cli/src/bin.ts'),'plugin','--profile','author-web','add',path.join(root,'packages/jev-plugin'),'--offline','--ignore-scripts'];
const result=spawnSync(process.execPath,command,{env,cwd:root,windowsHide:true,stdio:'inherit',timeout:60000});
if(result.status!==0)throw Error('AUTHOR_PLUGIN_REGISTRATION_FAILED');
for(const rel of ['data/private-config','data/workspace','data/author-evidence','data/file-backups/author','workspaces/author-host','evidence'])mkdirSync(path.join(root,rel),{recursive:true});
for(const name of ['providers','usage-budget','verified-prices']){
 const target=path.join(root,'data/private-config',name+'.json');
 if(!existsSync(target))writeFileSync(target,readFileSync(path.join(root,'config',name+'.example.json')),{mode:0o600});
}
console.log('Author profile registered without credentials or provider calls. Private templates remain unapproved.');
