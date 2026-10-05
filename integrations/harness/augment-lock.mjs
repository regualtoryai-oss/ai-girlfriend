// Add only the current UI importer; never ask the resolver to reconsider upstream packages.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const repo=path.join(root,'vendor/deepseek-harness-0.1.3-alpha.1');
const yaml=createRequire(path.join(repo,'package.json'))('js-yaml');
const lockFile=path.join(repo,'pnpm-lock.yaml');
const lock=yaml.load(readFileSync(lockFile,'utf8'));
const uiPath='packages/client/ui-voice';
const ui=JSON.parse(readFileSync(path.join(repo,uiPath,'package.json'),'utf8'));
const workspace=new Map();
for(const group of readdirSync(path.join(repo,'packages'),{withFileTypes:true}).filter(x=>x.isDirectory())){
 for(const entry of readdirSync(path.join(repo,'packages',group.name),{withFileTypes:true}).filter(x=>x.isDirectory())){
  try{const folder=path.join('packages',group.name,entry.name);const manifest=JSON.parse(readFileSync(path.join(repo,folder,'package.json'),'utf8'));workspace.set(manifest.name,folder);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
for(const entry of readdirSync(path.join(repo,'vendor'),{withFileTypes:true}).filter(x=>x.isDirectory())){
 try{const folder=path.join('vendor',entry.name);const manifest=JSON.parse(readFileSync(path.join(repo,folder,'package.json'),'utf8'));workspace.set(manifest.name,folder);}catch(error){if(error.code!=='ENOENT')throw error;}
}
const existing=[lock.importers['packages/client/ui-conversation'],...Object.values(lock.importers)];
function locked(name,specifier){
 if(specifier.startsWith('workspace:')){
  const target=workspace.get(name);if(!target)throw Error('AUTHOR_WORKSPACE_DEPENDENCY_MISSING: '+name);
  return {specifier,version:'link:'+path.relative(uiPath,target).split(path.sep).join('/')};
 }
 for(const importer of existing){
  for(const section of ['dependencies','devDependencies','optionalDependencies']){
   const found=importer?.[section]?.[name];if(found?.specifier===specifier)return {...found};
  }
 }
 throw Error('AUTHOR_DEPENDENCY_NOT_ALREADY_LOCKED: '+name);
}
const importer={};
for(const section of ['dependencies','devDependencies','optionalDependencies']){
 if(ui[section])importer[section]=Object.fromEntries(Object.entries(ui[section]).sort(([a],[b])=>a.localeCompare(b)).map(([name,specifier])=>[name,locked(name,specifier)]));
}
// pnpm's existing autoInstallPeers=true also records a peer not explicitly present elsewhere.
for(const [name,specifier] of Object.entries(ui.peerDependencies||{})){
 if(!ui.dependencies?.[name]&&!ui.devDependencies?.[name]&&!ui.optionalDependencies?.[name]){
  importer.dependencies??={};importer.dependencies[name]=locked(name,specifier);
 }
}
lock.importers[uiPath]=importer;
lock.importers['packages/bundle/web-app'].dependencies['@deepseek-ai/dsh-client-ui-voice']={specifier:'workspace:^',version:'link:../../client/ui-voice'};
writeFileSync(lockFile,yaml.dump(lock,{lineWidth:-1,noRefs:true,sortKeys:false}));
console.log('Current UI importer added using only existing locked dependency versions and local workspace links.');
