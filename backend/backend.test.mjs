import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Store } from './store.mjs';
import { createBackend } from './server.mjs';
import { readSeed } from './seed.mjs';
import { normalizeDocument,publicProduct,reviewIssues,validatePublic,date,AppError } from './catalog.mjs';
import { publish } from './publisher.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=readSeed(root);
const origin={type:'origin',sourceType:'manufacturer',title:'Synthetic test origin',summary:'Test-only manufacturing record',url:'https://example.com/test-origin',checked:'2026-10-11'};
function temp(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bgt-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
function fixture(t){const store=new Store(temp(t),baseline);t.after(()=>store.close());return store;}
function editing(store,id='hario',changes={}){const p=store.get(id);return store.save({...p.document,...changes},p.revision,'Test editor');}
function approve(store,p){p=store.transition(p.id,'submit',p.revision,'Test editor','提交审核');return store.transition(p.id,'approve',p.revision,'Test reviewer','核对了测试资料与制造地说明');}

test('public projection excludes internal notes, raw evidence and credentials',()=>{
  const d=normalizeDocument({...baseline[0],countryCode:'JP',notes:'PRIVATE_INTERNAL_NOTE',password:'DO_NOT_EXPORT',evidence:[origin]});
  const p=publicProduct(d);validatePublic([p]);assert.ok(!JSON.stringify(p).includes('PRIVATE_INTERNAL_NOTE'));assert.ok(!Object.hasOwn(p,'password'));assert.ok(!Object.hasOwn(p,'evidence'));
  assert.throws(()=>validatePublic([{...p,notes:'secret'}]),/Private field leaked/);
  assert.throws(()=>normalizeDocument({...d,image:'../secret.webp'}),AppError);
  assert.throws(()=>date('2026-02-30'),AppError);assert.throws(()=>date('2026-99-99'),AppError);
});
test('verification and Chinese-origin exceptions require specific evidence',()=>{
  const d=normalizeDocument({...baseline[0],countryCode:'CN',qualityIntent:'verified',qualityNote:'Test-only evaluation, no real product claim',comparators:['Synthetic peer A','Synthetic peer B'],exceptionReason:'Test-only quality exception rationale with documented limits.',exceptionNote:'Synthetic exception used only by automated tests.'});
  assert.equal(d.country,'中国');assert.ok(reviewIssues(d,[origin]).some(x=>x.includes('独立测试')));
  const evidence=[origin,{...origin,type:'quality',sourceType:'independent'},{...origin,type:'long_term',sourceType:'independent'},{...origin,type:'comparison',sourceType:'independent'}];
  assert.deepEqual(reviewIssues(d,evidence),[]);assert.ok(reviewIssues({...d,comparators:['same','same']},evidence).some(x=>x.includes('两个')));
  assert.ok(reviewIssues(d,evidence.filter(e=>e.type!=='comparison')).some(x=>x.includes('同类对照')));
});
test('draft edits preserve the last public snapshot; approval is explicit',t=>{
  const store=fixture(t),before=store.get('hario').live;let p=editing(store,'hario',{name:'Private draft change',notes:'PRIVATE_DRAFT'});
  assert.equal(store.plan().find(x=>x.id==='hario').document.name,before.name);
  assert.throws(()=>store.transition(p.id,'approve',p.revision,'Test','测试审核记录'),/先提交审核/);
  assert.throws(()=>store.save(p.document,p.revision-1,'Test'),error=>error.status===409);
  p=approve(store,p);assert.equal(store.plan().find(x=>x.id==='hario').document.name,'Private draft change');
  assert.ok(!JSON.stringify(store.plan()).includes('PRIVATE_DRAFT'));
  const id=store.newRelease();assert.throws(()=>editing(store),/发布进行中/);store.completeRelease(id,'test-commit');
  p=store.get('hario');assert.equal(p.state,'published');assert.equal(p.live.name,'Private draft change');
  p=editing(store,'hario',{name:'Unreviewed later change'});assert.equal(store.plan().find(x=>x.id==='hario').document.name,'Private draft change');
  store.transition(p.id,'withdraw',p.revision,'Test','测试撤回原因');assert.ok(!store.plan().some(x=>x.id==='hario'));
});
test('evidence changes invalidate approval and history restores evidence as a draft',t=>{
  const store=fixture(t);let p=editing(store);const original=store.get('hario').evidence[0];
  p=approve(store,p);p=store.updateEvidence(p.id,original.id,{...original,summary:'Changed evidence'},p.revision,'Test');
  assert.equal(p.state,'draft');assert.equal(p.candidate,null);
  p=store.removeEvidence(p.id,original.id,p.revision,'Test');assert.equal(p.evidence.length,0);
  p=store.restore(p.id,1,p.revision,'Test');assert.equal(p.state,'draft');assert.equal(p.evidence[0].summary,original.summary);assert.equal(p.live.name,baseline[0].name);
});
test('backend enforces login, same-origin writes, setup-once and stale-edit checks',async t=>{
  const {server,store}=createBackend({root,directory:temp(t),publisher:async(s,id)=>s.failRelease(id,'Test publisher disabled')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
  const request=async(url,{method='GET',data,origin=base,authenticate=true,marker=true}={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...(authenticate&&cookie?{Cookie:cookie}:{}),...(method!=='GET'&&marker?{'X-BGT-Request':'1',Origin:origin}:{})},...(data?{body:JSON.stringify(data)}:{})});
  assert.equal((await request('/api/products')).status,401);
  assert.equal((await request('/api/setup',{method:'POST',origin:'https://evil.example',data:{name:'Test',password:randomUUID()}})).status,403);
  const password=randomUUID();let res=await request('/api/setup',{method:'POST',data:{name:'Test administrator',password}});assert.equal(res.status,200);cookie=res.headers.get('set-cookie').split(';')[0];assert.match(res.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict/);
  assert.equal((await request('/api/setup',{method:'POST',data:{name:'Other',password}})).status,409);
  assert.equal((await request('/api/backup',{method:'POST',data:{},marker:false})).status,403);
  let p=await(await request('/api/products/hario')).json();
  res=await request('/api/products/hario',{method:'PUT',data:{revision:p.revision,document:{...p.document,notes:'PRIVATE_SECRET',state:'approved'}}});assert.equal(res.status,200);p=await res.json();assert.equal(p.state,'draft');
  assert.equal((await request('/api/products/hario',{method:'PUT',data:{revision:p.revision-1,document:p.document}})).status,409);
  const preview=await(await request('/api/preview')).json();assert.ok(!JSON.stringify(preview).includes('PRIVATE_SECRET'));
  const data=fs.readFileSync(path.join(root,'dist/assets/hario.webp')).toString('base64');
  res=await request('/api/assets',{method:'POST',data:{kind:'image',name:'../../private.webp',mime:'image/webp',data}});assert.equal(res.status,201);const asset=await res.json();assert.match(asset.name,/^asset-[a-z0-9-]+\.webp$/);
  assert.equal((await request(`/api/images/${asset.name}`,{authenticate:false})).status,401);
  assert.equal((await request(`/api/images/${asset.name}`)).status,200);
  res=await request('/api/assets',{method:'POST',data:{kind:'evidence',name:'private-note.txt',mime:'text/plain',data:Buffer.from('PRIVATE_ATTACHMENT').toString('base64')}});assert.equal(res.status,201);const attachment=await res.json();
  res=await request(`/api/attachments/${attachment.id}`);assert.match(res.headers.get('content-disposition'),/^attachment/);assert.equal(await res.text(),'PRIVATE_ATTACHMENT');
  res=await request('/api/backup',{method:'POST',data:{}});assert.equal(res.status,200);const backup=await res.json();assert.ok(fs.existsSync(path.join(store.directory,'backups',backup.name)));
  await request('/api/logout',{method:'POST',data:{}});assert.equal((await request('/api/products')).status,401);
  assert.equal((await request('/api/login',{method:'POST',data:{password:'wrong'}})).status,401);
  assert.equal((await request('/api/login',{method:'POST',data:{password}})).status,200);
});
test('publisher commits only reviewed public content and retries a failed push',async t=>{
  const directory=temp(t),checkout=path.join(directory,'repo'),bare=path.join(directory,'remote.git');fs.mkdirSync(checkout);
  for(const name of ['dist','scripts'])fs.cpSync(path.join(root,name),path.join(checkout,name),{recursive:true});
  fs.mkdirSync(path.join(checkout,'backend'));fs.copyFileSync(path.join(root,'backend/catalog.mjs'),path.join(checkout,'backend/catalog.mjs'));
  fs.mkdirSync(path.join(checkout,'content'));fs.copyFileSync(path.join(root,'content/catalog.json'),path.join(checkout,'content/catalog.json'));fs.writeFileSync(path.join(checkout,'.gitignore'),'.local/\n');
  const git=(args,cwd=checkout)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-b','main']);git(['config','user.name','Backend test']);git(['config','user.email','backend-test@example.invalid']);git(['add','.']);git(['commit','-m','Test fixture']);git(['init','--bare',bare],directory);git(['remote','add','origin',bare]);
  const store=new Store(path.join(checkout,'.local'),baseline);t.after(()=>store.close());let p=editing(store,'hario',{name:'PRIVATE_DRAFT_DO_NOT_PUBLISH',notes:'PRIVATE_NOTE'});
  let failPush=false;
  const runCommand=async(bin,args)=>{
    if(bin==='git'&&args[0]==='remote')return 'https://github.com/imoneys10k/buy-great-things.git';
    if(bin==='git'&&args[0]==='push'){if(failPush)throw Error('Command failed: synthetic network failure');return git(['push',bare,'main']);}
    return execFileSync(bin,args,{cwd:checkout,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  };
  let id=store.newRelease();await publish(store,id,checkout,{monitor:false,runCommand});assert.equal(store.release(id).status,'synced');
  let serialized=fs.readFileSync(path.join(checkout,'content/catalog.json'),'utf8');assert.ok(!serialized.includes('PRIVATE_DRAFT_DO_NOT_PUBLISH'));assert.ok(!serialized.includes('PRIVATE_NOTE'));assert.ok(!git(['ls-files']).includes('.local'));
  p=approve(store,store.get('hario'));failPush=true;id=store.newRelease();await publish(store,id,checkout,{monitor:false,runCommand});assert.equal(store.release(id).status,'failed');assert.equal(store.get('hario').state,'approved');assert.equal(git(['status','--porcelain']),'');
  failPush=false;id=store.newRelease();await publish(store,id,checkout,{monitor:false,runCommand});assert.equal(store.release(id).status,'synced');assert.equal(store.get('hario').state,'published');assert.equal(git(['rev-parse','HEAD']),git(['rev-parse','main'],bare));
  serialized=fs.readFileSync(path.join(checkout,'content/catalog.json'),'utf8');assert.ok(serialized.includes('PRIVATE_DRAFT_DO_NOT_PUBLISH'));assert.ok(!serialized.includes('PRIVATE_NOTE'));
});
