import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Jobs} from './jobs.mjs';
const done=async j=>{for(let i=0;i<100&&['queued','writing'].includes(j.state);i++)await new Promise(r=>setTimeout(r,10));};
test('writes actual UTF-8 Markdown, duplicate request writes once and completed cancellation does not remove output',async()=>{
 const d=await mkdtemp(path.join(tmpdir(),'companion-test-'));try{const m=new Jobs(d),input={id:randomUUID(),title:'今日\n计划',notes:'读书\n散步'};const j=m.create(input);assert.equal(m.create(input),j);await done(j);assert.equal(j.state,'completed');const body=await readFile(path.join(d,j.name),'utf8');assert.ok(body.startsWith('# 今日 计划\n\n读书\n散步\n'));assert.equal(m.cancel(j.id).state,'completed');assert.equal((await readdir(d)).filter(n=>n.endsWith('.md')).length,1);assert.throws(()=>m.create({...input,notes:'changed'}),/冲突/);}finally{await rm(d,{recursive:true});}});
test('cancellation before commit removes partial and writes no final file',async()=>{
 const d=await mkdtemp(path.join(tmpdir(),'companion-test-'));let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);try{const m=new Jobs(d,async()=>{entered();await gate;}),j=m.create({id:randomUUID(),title:'取消',notes:'私人内容'});await ready;m.cancel(j.id);release();await new Promise(r=>setTimeout(r,30));assert.equal(j.state,'cancelled');assert.deepEqual((await readdir(d)).filter(n=>n!=='.jobs'),[]);}finally{release();await rm(d,{recursive:true});}});
test('rejects invalid ids, empty titles and excess text',()=>{const m=new Jobs('unused');for(const i of [{id:'../escape',title:'x',notes:''},{id:randomUUID(),title:' ',notes:''},{id:randomUUID(),title:'x',notes:'x'.repeat(2001)}])assert.throws(()=>m.create(i));});
