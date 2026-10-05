import {createServer} from './app.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'companion-admin-test-'));const rows=[];const server=createServer({dataRoot:dir,logger:r=>rows.push(r)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let checks=0;
try{
 const start=await fetch(origin+'/api/admin/bootstrap');const cookie=start.headers.get('set-cookie').split(';')[0],boot=await start.json();assert.ok(start.headers.get('set-cookie').includes('HttpOnly'));assert.ok(start.headers.get('set-cookie').includes('SameSite=Strict'));checks++;
 const headers={'Content-Type':'application/json',Origin:origin,Cookie:cookie,'X-CSRF-Token':boot.csrfToken};
 const body={provider:'deepseek',apiKey:'SYNTHETIC-TEST-KEY-NOT-REAL',model:'test-model',baseUrl:'https://api.deepseek.com'};
 const post=async h=>fetch(origin+'/api/admin/config',{method:'POST',headers:h,body:JSON.stringify(body)});
 assert.equal((await post({'Content-Type':'application/json'})).status,403);checks++;
 assert.equal((await post({...headers,'X-CSRF-Token':'bad'})).status,403);checks++;
 assert.equal((await post({...headers,Origin:'https://example.com'})).status,403);checks++;
 const saved=await post(headers);assert.equal(saved.status,200);const raw=await saved.text();assert.equal(raw.includes(body.apiKey),false);const data=JSON.parse(raw);assert.equal(data.providers.deepseek.configured,true);assert.equal(data.connectionTested,false);checks++;
 const read=await fetch(origin+'/api/admin/config',{headers});assert.equal((await read.text()).includes(body.apiKey),false);assert.equal(JSON.stringify(rows).includes(body.apiKey),false);checks++;
 const test=await fetch(origin+'/api/admin/test',{method:'POST',headers,body:'{}'});assert.equal(test.status,503);checks++;
 const remove=await fetch(origin+'/api/admin/config',{method:'POST',headers,body:JSON.stringify({provider:'deepseek',clear:true})});assert.equal((await remove.json()).providers.deepseek.configured,false);checks++;
 console.log(JSON.stringify({passed:checks,realCredentialsUsed:false,externalRequests:0}));
}finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true});}
