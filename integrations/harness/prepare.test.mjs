import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,unlinkSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareUI} from './prepare.mjs';

const harnessCommit='d347e703908d0406b7a7ef80e3a0e594d86b2215';
const releaseCommit='436bf4ff5b8532b667cb57366dad01ec973e9c3c';
const patchSha256='a'.repeat(64);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 const sandbox=mkdtempSync(path.join(tmpdir(),'companion-ui-prepare-'));
 const root=path.join(sandbox,'workspace'),source=path.join(root,'ui'),destination=path.join(root,'vendor/ui'),marker=path.join(root,'vendor/prepared.json');
 mkdirSync(source,{recursive:true});mkdirSync(destination,{recursive:true});
 const links=[];
 t.after(()=>{
  for(const link of links)if(lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())unlinkSync(link);
  assert.equal(path.dirname(sandbox),path.resolve(tmpdir()));
  rmSync(sandbox,{recursive:true,force:true});
 });
 const put=(base,relative,bytes)=>{const file=path.join(base,relative);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes);return file;};
 const options={root,source,destination,marker,patchSha256,baseline:{releaseCommit,files:{},windowsCheckoutFiles:{}}};
 const legacy=()=>writeFileSync(marker,JSON.stringify({harnessCommit,patchSha256})+'\n');
 const linkDirectory=(from,to)=>{symlinkSync(to,from,process.platform==='win32'?'junction':'dir');links.push(from);};
 return {sandbox,root,source,destination,marker,put,options,legacy,linkDirectory};
}

test('fresh install copies nested new files, records bytes and preserves unknown files',t=>{
 const f=fixture(t);f.put(f.source,'src/new.js','first');f.put(f.source,'README.md','source documentation');f.put(f.source,'UPSTREAM-LICENSE','license');f.put(f.destination,'user-notes.txt','keep');
 assert.deepEqual(prepareUI(f.options),{copied:1,updated:0,unchanged:0});
 assert.equal(readFileSync(path.join(f.destination,'src/new.js'),'utf8'),'first');
 assert.equal(readFileSync(path.join(f.destination,'user-notes.txt'),'utf8'),'keep');
 assert.equal(existsSync(path.join(f.destination,'README.md')),false);
 const marker=JSON.parse(readFileSync(f.marker));assert.deepEqual(marker.currentUIHashes,{'src/new.js':hash('first')});
 assert.equal(marker.harnessCommit,harnessCommit);assert.equal(marker.patchSha256,patchSha256);
});

test('running again does not rewrite identical source, destination or marker',t=>{
 const f=fixture(t),target=f.put(f.source,'same.js','same');prepareUI(f.options);
 const installed=path.join(f.destination,'same.js');
 for(const file of [target,installed,f.marker])utimesSync(file,new Date(0),new Date(0));
 const before=[target,installed,f.marker].map(file=>statSync(file).mtimeMs);
 assert.deepEqual(prepareUI(f.options),{copied:0,updated:0,unchanged:1});
 assert.deepEqual([target,installed,f.marker].map(file=>statSync(file).mtimeMs),before);
});

for(const ending of ['\n','\r\n'])test('legacy 436bf4f '+(ending==='\n'?'blob':'Windows checkout')+' bytes upgrade to current source',t=>{
 const f=fixture(t),old='previous'+ending;f.put(f.source,'src/a.ts','current\n');f.put(f.destination,'src/a.ts',old);f.legacy();
 f.options.baseline.files['src/a.ts']=hash('previous\n');f.options.baseline.windowsCheckoutFiles['src/a.ts']=hash('previous\r\n');
 assert.deepEqual(prepareUI(f.options),{copied:0,updated:1,unchanged:0});
 assert.equal(readFileSync(path.join(f.destination,'src/a.ts'),'utf8'),'current\n');
 assert.equal(JSON.parse(readFileSync(f.marker)).currentUIHashes['src/a.ts'],hash('current\n'));
});

test('subsequent versions upgrade only the recorded last installed bytes',t=>{
 const f=fixture(t);f.put(f.source,'src/a.ts','version one');prepareUI(f.options);
 f.put(f.source,'src/a.ts','version two');assert.equal(prepareUI(f.options).updated,1);
 f.put(f.source,'src/a.ts','version three');assert.equal(prepareUI(f.options).updated,1);
 assert.equal(readFileSync(path.join(f.destination,'src/a.ts'),'utf8'),'version three');
});

test('a locally deleted installed file is not silently recreated',t=>{
 const f=fixture(t);f.put(f.source,'a.ts','first');prepareUI(f.options);const marker=readFileSync(f.marker);
 unlinkSync(path.join(f.destination,'a.ts'));f.put(f.source,'a.ts','second');
 assert.throws(()=>prepareUI(f.options),/AUTHOR_UI_WORKTREE_DIFFERS: a.ts \(deleted\)/);
 assert.equal(existsSync(path.join(f.destination,'a.ts')),false);assert.deepEqual(readFileSync(f.marker),marker);
});

test('preflight rejects user divergence before any planned update or patch callback',t=>{
 const f=fixture(t);f.put(f.source,'a.ts','original a');f.put(f.source,'z.ts','original z');prepareUI(f.options);
 f.put(f.source,'a.ts','new a');f.put(f.source,'z.ts','new z');f.put(f.destination,'z.ts','user changes');
 const marker=readFileSync(f.marker);let patches=0;
 assert.throws(()=>prepareUI(f.options,()=>patches++),/AUTHOR_UI_WORKTREE_DIFFERS: z.ts/);
 assert.equal(patches,0);assert.equal(readFileSync(path.join(f.destination,'a.ts'),'utf8'),'original a');
 assert.equal(readFileSync(path.join(f.destination,'z.ts'),'utf8'),'user changes');assert.deepEqual(readFileSync(f.marker),marker);
});

test('legacy hashes cannot override a later recorded installation or unknown collision',t=>{
 const f=fixture(t);f.put(f.source,'a.ts','installed');prepareUI(f.options);
 f.options.baseline.files['a.ts']=hash('old release');f.put(f.destination,'a.ts','old release');f.put(f.source,'a.ts','new version');
 assert.throws(()=>prepareUI(f.options),/AUTHOR_UI_WORKTREE_DIFFERS/);
 const g=fixture(t);g.put(g.source,'new.ts','new');g.put(g.destination,'new.ts','local file');
 assert.throws(()=>prepareUI(g.options),/AUTHOR_UI_WORKTREE_DIFFERS/);assert.equal(existsSync(g.marker),false);
});

test('new files may be added but never replace a local directory or delete unknown files',t=>{
 const f=fixture(t);f.put(f.source,'src/new.ts','new');f.put(f.destination,'left-behind.txt','keep');prepareUI(f.options);
 f.put(f.source,'another.ts','next');mkdirSync(path.join(f.destination,'another.ts'));
 assert.throws(()=>prepareUI(f.options),/AUTHOR_UI_FILE_TYPE_REJECTED/);
 assert.equal(readFileSync(path.join(f.destination,'left-behind.txt'),'utf8'),'keep');
});

test('source and destination directory links cannot escape the workspace',t=>{
 for(const location of ['source','destination']){
  const f=fixture(t),outside=path.join(f.sandbox,'outside');mkdirSync(outside);f.put(outside,'a.ts','outside original');
  if(location==='source')f.linkDirectory(path.join(f.source,'linked'),outside);
  else{f.put(f.source,'linked/a.ts','source');f.linkDirectory(path.join(f.destination,'linked'),outside);}
  assert.throws(()=>prepareUI(f.options),/AUTHOR_UI_LINK_REJECTED/);
  assert.equal(readFileSync(path.join(outside,'a.ts'),'utf8'),'outside original');assert.equal(existsSync(f.marker),false);
 }
});

test('linked installation root, outside target, and invalid ledger are rejected',t=>{
 const f=fixture(t);f.put(f.source,'a.ts','a');
 const linkedRoot=path.join(f.sandbox,'linked-root');f.linkDirectory(linkedRoot,f.root);
 assert.throws(()=>prepareUI({...f.options,root:linkedRoot,source:path.join(linkedRoot,'ui'),destination:path.join(linkedRoot,'vendor/ui'),marker:path.join(linkedRoot,'vendor/prepared.json')}),/AUTHOR_UI_LINK_REJECTED/);
 assert.throws(()=>prepareUI({...f.options,destination:path.join(f.sandbox,'outside')}),/AUTHOR_UI_PATH_OUTSIDE_WORKSPACE/);
 writeFileSync(f.marker,JSON.stringify({harnessCommit,patchSha256,currentUIHashes:{'../outside':hash('a')}}));
 assert.throws(()=>prepareUI(f.options),/AUTHOR_UI_MARKER_INVALID/);
});

test('changed destination detected after preflight is retained without overwrite',t=>{
 const f=fixture(t);f.put(f.source,'a.ts','first');prepareUI(f.options);f.put(f.source,'a.ts','second');
 assert.throws(()=>prepareUI(f.options,()=>f.put(f.destination,'a.ts','concurrent user edit')),/AUTHOR_UI_WORKTREE_CHANGED_DURING_PREPARE/);
 assert.equal(readFileSync(path.join(f.destination,'a.ts'),'utf8'),'concurrent user edit');
 assert.equal(JSON.parse(readFileSync(f.marker)).currentUIHashes['a.ts'],hash('first'));
});

test('unchanged files are rechecked before new files are written and ledger is published',t=>{
 const f=fixture(t);f.put(f.source,'a.ts','first');prepareUI(f.options);const marker=readFileSync(f.marker);
 f.put(f.source,'new.ts','new');
 assert.throws(()=>prepareUI(f.options,()=>f.put(f.destination,'a.ts','concurrent edit')),/AUTHOR_UI_WORKTREE_CHANGED_DURING_PREPARE/);
 assert.equal(readFileSync(path.join(f.destination,'a.ts'),'utf8'),'concurrent edit');
 assert.equal(existsSync(path.join(f.destination,'new.ts')),false);assert.deepEqual(readFileSync(f.marker),marker);
});

test('an unchanged destination replaced with a junction after preflight is rejected',t=>{
 const f=fixture(t);f.put(f.source,'a.ts','first');prepareUI(f.options);const marker=readFileSync(f.marker);
 const outside=path.join(f.sandbox,'outside');mkdirSync(outside);f.put(outside,'sentinel','keep');
 assert.throws(()=>prepareUI(f.options,()=>{const to=path.join(f.destination,'a.ts');unlinkSync(to);f.linkDirectory(to,outside);}),/AUTHOR_UI_LINK_REJECTED/);
 assert.equal(readFileSync(path.join(outside,'sentinel'),'utf8'),'keep');assert.deepEqual(readFileSync(f.marker),marker);
});
