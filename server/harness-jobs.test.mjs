import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {Jobs} from './jobs.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5));
test('Harness artifact publication keeps executor, hash, durable identity and one execution per task',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harness-job-'));let calls=0;
 try{const bytes=Buffer.from('# Actual tool artifact\n');const adapter={version:'0.1.3-alpha.1',async generate(){calls++;return {content:bytes,evidence:{toolSucceeded:true}};}};
 const jobs=new Jobs(dir,undefined,adapter),input={id:randomUUID(),turnId:randomUUID(),title:'Proof',notes:'test'},j=jobs.create(input);while(['queued','writing'].includes(j.state))await tick();
 assert.equal(j.state,'completed');assert.equal(j.executor,'deepseek-harness');assert.equal(j.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(await readFile(path.join(dir,j.name)),bytes);jobs.create(input);assert.equal(calls,1);
 const restored=new Jobs(dir,undefined,adapter);assert.equal(restored.create(input).sha256,j.sha256);assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true});}
});
test('cancel aborts only active Harness task and rejects late artifact; queued task proceeds',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harness-cancel-'));let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let observedSignal,calls=0;
 try{const jobs=new Jobs(dir,undefined,{version:'0.1.3-alpha.1',async generate({signal}){calls++;if(calls===1){observedSignal=signal;entered();await gate;}return {content:Buffer.from('# second'),evidence:{toolSucceeded:true}};}});
 const a=jobs.create({id:randomUUID(),title:'first',notes:''}),b=jobs.create({id:randomUUID(),title:'second',notes:''});await started;assert.equal(b.state,'queued');jobs.cancel(a.id,a.revision);assert.ok(observedSignal.aborted);release();while(['queued','writing'].includes(b.state))await tick();assert.equal(a.state,'cancelled');assert.equal(b.state,'completed');assert.equal((await readdir(dir)).filter(n=>n.endsWith('.md')).length,1);
 }finally{release();await rm(dir,{recursive:true});}
});
