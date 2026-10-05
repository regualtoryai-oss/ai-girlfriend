// Launch the same pinned official DSH profile with private, explicit credentials.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const repo=path.join(root,'vendor/deepseek-harness-0.1.3-alpha.1');
const configFile=path.join(root,'data/private-config/providers.json');
const stored=existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')):{};
const origin='https://newapi1.1234bot.com';
const relayKey=process.env.COMPANION_RELAY_API_KEY||stored.relay?.apiKey;
if(!relayKey||(stored.relay?.apiKey&&!process.env.COMPANION_RELAY_API_KEY&&stored.relay.baseUrl!==origin))throw Error('AUTHORIZED_RELAY_NOT_CONFIGURED');
const jevKey=process.env.COMPANION_JEV_KEY||(stored.jev?.baseUrl==='https://api.typesafe.ai'?stored.jev.apiKey:undefined);
if(!jevKey)throw Error('AUTHORIZED_JEV_NOT_CONFIGURED');
const env={};
for(const k of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','ComSpec','TEMP','TMP','PATHEXT'])if(process.env[k])env[k]=process.env[k];
env.PATH=path.join(root,'build-tools/node_modules/.bin')+path.delimiter+path.dirname(process.execPath)+path.delimiter+(env.PATH||env.Path||'');
Object.assign(env,{
 DSH_HOME:path.join(root,'data/dsh-author-home'),TSX_TSCONFIG_PATH:path.join(repo,'tsconfig.json'),
 DSH_TELEMETRY_DISABLED:'1',DSH_TELEMETRY_MODE:'DISABLED',DSH_PERMISSION_MODE:'workspace-write',DSH_PRIMARY_RUNTIME:'',
 COMPANION_DATA_ROOT:path.join(root,'data'),COMPANION_WORKSPACE_ROOT:path.join(root,'data/workspace'),
 COMPANION_BACKUP_ROOT:path.join(root,'data/file-backups/author'),COMPANION_MODEL_BASE:origin+'/v1',
 DEEPSEEK_API_KEY:relayKey,COMPANION_MODEL_ORIGIN:origin,COMPANION_JEV_KEY:jevKey,
});
for(const k of ['COMPANION_XLSX_PYTHON','COMPANION_PROBE_SESSION_ID','COMPANION_PROBE_RECOVERY_TASK_ID','COMPANION_ARTIFACT_PROXY'])if(process.env[k])env[k]=process.env[k];
for(const rel of ['workspaces/author-host','data/workspace','data/file-backups/author','data/author-evidence'])mkdirSync(path.join(root,rel),{recursive:true});
console.error(JSON.stringify({existingRelayConfigured:true,existingJevConfigured:true,origin}));
const child=spawn(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/esm/index.mjs')).href,path.join(repo,'apps/cli/src/bin.ts'),'--profile','author-web','--patch',path.join(root,'dsh/author/host.patch.yml'),'--host','127.0.0.1','--port','8796','--no-open'],{cwd:path.join(root,'workspaces/author-host'),env,windowsHide:true,stdio:['ignore','inherit','inherit']});
child.on('error',()=>{console.error('AUTHOR_HOST_LAUNCH_FAILED');process.exitCode=1;});
child.on('exit',code=>process.exit(code??1));
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>child.kill());
