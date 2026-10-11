import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError,requireThat,normalizeDocument,normalizeEvidence,reviewIssues,publicProduct,COUNTRIES } from './catalog.mjs';

const now=()=>new Date().toISOString();
export class Store {
  constructor(directory,seed=[]){
    fs.mkdirSync(directory,{recursive:true,mode:0o700});this.directory=directory;
    this.db=new DatabaseSync(path.join(directory,'catalog.sqlite'));fs.chmodSync(path.join(directory,'catalog.sqlite'),0o600);
    this.db.exec(`PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,document TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,candidate TEXT,live TEXT,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),revision INTEGER NOT NULL,document TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(product_id,revision));
      CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),revision INTEGER NOT NULL,decision TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,status TEXT NOT NULL,snapshot TEXT NOT NULL,commit_sha TEXT,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publication_lock(id INTEGER PRIMARY KEY CHECK(id=1),release_id TEXT NOT NULL);
    `);
    if(!this.db.prepare('SELECT COUNT(*) AS n FROM products').get().n){
      this.transaction(()=>{for(const p of seed){
        const d=normalizeDocument({...p,countryCode:Object.keys(COUNTRIES).find(k=>COUNTRIES[k]===p.country)??'UNKNOWN',originLevel:p.originLevel??(/品牌/.test(p.originScope)?'brand':/系列/.test(p.originScope)?'series':'model'),qualityIntent:p.status==='品质审定'?'verified':'pending'});
        this.db.prepare('INSERT INTO products VALUES(?,?,1,?,NULL,?,?)').run(d.id,JSON.stringify(d),'published',JSON.stringify(publicProduct(d)),now());
        for(const e of p.seedEvidence??[])this.db.prepare('INSERT INTO evidence VALUES(?,?,?)').run(randomUUID(),d.id,JSON.stringify(normalizeEvidence(e)));
        this.record(d.id,1,d,'迁移','导入既有公开档案；不新增品质审核结论');
      }});
    }
  }
  close(){this.db.close();}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  setting(key){const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  setSetting(key,value){this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  get(id){const row=this.db.prepare('SELECT * FROM products WHERE id=?').get(id);requireThat(row,'档案不存在',404);return {...row,document:JSON.parse(row.document),candidate:row.candidate?JSON.parse(row.candidate):null,live:row.live?JSON.parse(row.live):null,evidence:this.evidence(id)};}
  list(){return this.db.prepare('SELECT id,revision,state,document,live,updated_at FROM products ORDER BY rowid').all().map(r=>({...r,document:JSON.parse(r.document),hasLive:!!r.live,live:undefined}));}
  evidence(id){return this.db.prepare('SELECT id,document FROM evidence WHERE product_id=? ORDER BY rowid').all(id).map(r=>({id:r.id,...JSON.parse(r.document)}));}
  record(id,revision,document,actor,note){this.db.prepare('INSERT INTO revisions(product_id,revision,document,actor,note,created_at) VALUES(?,?,?,?,?,?)').run(id,revision,JSON.stringify({document,evidence:this.evidence(id)}),actor,note,now());}
  expected(row,revision){requireThat(Number.isInteger(revision)&&row.revision===revision,'档案已被其他编辑更新，请重新打开后再修改',409);}
  assertUnlocked(){requireThat(!this.db.prepare('SELECT id FROM publication_lock').get(),'发布进行中，请完成后再编辑',409);}
  save(input,revision,actor,note='保存草稿',evidenceOverride=null){
    const d=normalizeDocument(input);
    return this.transaction(()=>{this.assertUnlocked();const row=this.db.prepare('SELECT revision FROM products WHERE id=?').get(d.id);
      if(row){this.expected(row,revision);this.db.prepare('UPDATE products SET document=?,revision=revision+1,state=?,candidate=NULL,updated_at=? WHERE id=?').run(JSON.stringify(d),'draft',now(),d.id);}
      else{requireThat(revision===0,'新档案版本必须为 0',409);this.db.prepare('INSERT INTO products VALUES(?,?,1,?,NULL,NULL,?)').run(d.id,JSON.stringify(d),'draft',now());}
      if(evidenceOverride){this.db.prepare('DELETE FROM evidence WHERE product_id=?').run(d.id);for(const e of evidenceOverride)this.db.prepare('INSERT INTO evidence VALUES(?,?,?)').run(e.id,d.id,JSON.stringify(normalizeEvidence(e)));}
      const next=(row?.revision??0)+1;this.record(d.id,next,d,actor,note);return this.get(d.id);
    });
  }
  addEvidence(id,input,revision,actor){const e=normalizeEvidence(input);return this.transaction(()=>{this.assertUnlocked();const p=this.get(id);this.expected(p,revision);if(e.attachment)requireThat(this.db.prepare('SELECT id FROM assets WHERE id=? AND kind=?').get(e.attachment,'evidence'),'证据附件不存在');this.db.prepare('INSERT INTO evidence VALUES(?,?,?)').run(randomUUID(),id,JSON.stringify(e));this.touch(p,actor,'新增证据');return this.get(id);});}
  removeEvidence(id,evidenceId,revision,actor){return this.transaction(()=>{this.assertUnlocked();const p=this.get(id);this.expected(p,revision);requireThat(this.db.prepare('DELETE FROM evidence WHERE id=? AND product_id=?').run(evidenceId,id).changes,'证据不存在',404);this.touch(p,actor,'移除证据引用');return this.get(id);});}
  updateEvidence(id,evidenceId,input,revision,actor){const e=normalizeEvidence(input);return this.transaction(()=>{this.assertUnlocked();const p=this.get(id);this.expected(p,revision);if(e.attachment)requireThat(this.db.prepare('SELECT id FROM assets WHERE id=? AND kind=?').get(e.attachment,'evidence'),'证据附件不存在');requireThat(this.db.prepare('UPDATE evidence SET document=? WHERE id=? AND product_id=?').run(JSON.stringify(e),evidenceId,id).changes,'证据不存在',404);this.touch(p,actor,'修改证据');return this.get(id);});}
  touch(p,actor,note){this.db.prepare('UPDATE products SET revision=revision+1,state=?,candidate=NULL,updated_at=? WHERE id=?').run('draft',now(),p.id);this.record(p.id,p.revision+1,p.document,actor,note);}
  transition(id,action,revision,actor,note){return this.transaction(()=>{
    this.assertUnlocked();const p=this.get(id);this.expected(p,revision);requireThat(['submit','approve','reject','withdraw'].includes(action),'操作不正确');
    let state,candidate=null;
    if(action==='submit'){requireThat(['draft','withdrawn'].includes(p.state),'只有草稿可以提交审核',409);state='review';}
    if(action==='approve'){requireThat(p.state==='review','请先提交审核',409);const issues=reviewIssues(p.document,p.evidence);requireThat(!issues.length,issues.join('；'));requireThat(note.length>=5,'请填写具体审核记录');state='approved';candidate=publicProduct(p.document);}
    if(action==='reject'){requireThat(['review','approved'].includes(p.state),'当前档案不在审核流程中',409);requireThat(note.length>=3,'请填写退回原因');state='draft';}
    if(action==='withdraw'){requireThat(p.live,'档案尚未公开，无需撤回',409);requireThat(note.length>=3,'请填写撤回原因');state='withdrawn';}
    this.db.prepare('UPDATE products SET state=?,candidate=?,updated_at=? WHERE id=?').run(state,candidate?JSON.stringify(candidate):null,now(),id);
    this.db.prepare('INSERT INTO reviews(product_id,revision,decision,actor,note,created_at) VALUES(?,?,?,?,?,?)').run(id,revision,action,actor,note,now());return this.get(id);
  });}
  history(id){this.get(id);return {revisions:this.db.prepare('SELECT id,revision,actor,note,created_at FROM revisions WHERE product_id=? ORDER BY revision DESC').all(id),reviews:this.db.prepare('SELECT revision,decision,actor,note,created_at FROM reviews WHERE product_id=? ORDER BY id DESC').all(id)};}
  restore(id,version,revision,actor){const row=this.db.prepare('SELECT document FROM revisions WHERE product_id=? AND revision=?').get(id,version);requireThat(row,'历史版本不存在',404);const snapshot=JSON.parse(row.document);return this.save(snapshot.document,revision,actor,`恢复版本 ${version} 为草稿`,snapshot.evidence);}
  plan(){return this.db.prepare('SELECT * FROM products ORDER BY rowid').all().filter(r=>r.state!=='withdrawn'&&(r.candidate||r.live)).map(r=>({id:r.id,revision:r.revision,approved:r.state==='approved',document:JSON.parse(r.state==='approved'?r.candidate:r.live)}));}
  newRelease(){return this.transaction(()=>{this.assertUnlocked();const id=randomUUID();const snapshot=this.plan();this.db.prepare('INSERT INTO releases VALUES(?,?,?,NULL,NULL,?)').run(id,'preparing',JSON.stringify(snapshot),now());this.db.prepare('INSERT INTO publication_lock VALUES(1,?)').run(id);return id;});}
  releases(){return this.db.prepare('SELECT id,status,commit_sha,error,created_at FROM releases ORDER BY rowid DESC LIMIT 30').all();}
  release(id){const row=this.db.prepare('SELECT * FROM releases WHERE id=?').get(id);requireThat(row,'发布记录不存在',404);return {...row,snapshot:JSON.parse(row.snapshot)};}
  updateRelease(id,status,sha=null,error=null){this.db.prepare('UPDATE releases SET status=?,commit_sha=COALESCE(?,commit_sha),error=? WHERE id=?').run(status,sha,error,id);}
  completeRelease(id,sha){this.transaction(()=>{const release=this.release(id);for(const item of release.snapshot){const p=this.get(item.id);if(item.approved&&p.revision===item.revision)this.db.prepare('UPDATE products SET live=?,state=?,candidate=NULL WHERE id=?').run(JSON.stringify(item.document),'published',item.id);}this.db.prepare("UPDATE products SET live=NULL WHERE state='withdrawn'").run();this.updateRelease(id,'synced',sha);this.db.prepare('DELETE FROM publication_lock WHERE release_id=?').run(id);});}
  failRelease(id,message){this.transaction(()=>{this.updateRelease(id,'failed',null,message);this.db.prepare('DELETE FROM publication_lock WHERE release_id=?').run(id);});}
  backup(filename){this.db.exec('PRAGMA wal_checkpoint(FULL)');fs.copyFileSync(path.join(this.directory,'catalog.sqlite'),filename);fs.chmodSync(filename,0o600);}
}
