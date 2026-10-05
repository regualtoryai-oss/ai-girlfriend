// Shell-free entry to the current author host and local Voice Bridge.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const localPython=path.join(root,'.venv-voice/Scripts/python.exe');
const python=existsSync(localPython)?localPython:(process.env.COMPANION_LAUNCH_PYTHON||'python');
const child=spawn(python,[path.join(root,'Start-Author-Demo.py'),...process.argv.slice(2)],{cwd:root,env:process.env,windowsHide:true,stdio:'inherit'});
child.on('error',()=>{console.error('AUTHOR_LAUNCH_PYTHON_MISSING: install the Voice Bridge with integrations/voice-bridge/setup.ps1.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
