import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,randomUUID,createHash,scrypt,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Store } from './store.mjs';
import { readSeed } from './seed.mjs';
import { AppError,requireThat,text,slug,imageName,COUNTRIES,ORIGIN_LEVELS,EVIDENCE_TYPES,reviewIssues } from './catalog.mjs';
import { publish,SITE_URL } from './publisher.mjs';

const scryptAsync=promisify(scrypt),exec=promisify(execFile);
const hash=value=>createHash('sha256').update(value).digest('hex');
const rootDefault=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mimeTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml'};
async function body(req){
  requireThat(req.headers['content-type']?.startsWith('application/json'),'请求必须为 JSON',415);
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;requireThat(size<=12*1024*1024,'上传内容过大',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError('JSON 格式不正确');}
}
function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));}
export function createBackend({root=rootDefault,directory=path.join(rootDefault,'.local'),seed,publisher=publish}={}){
  const store=new Store(directory,seed??readSeed(root));let publishing=false;
  const loginAttempts=new Map();
  const assetDirectory=path.join(directory,'assets');fs.mkdirSync(assetDirectory,{recursive:true,mode:0o700});
  const sessionFor=req=>{
    const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('bgt_session='))?.slice(12);
    if(!token)return null;
    const row=store.db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(hash(token));return row&&row.expires_at>Date.now()?token:null;
  };
  const cookie=token=>`bgt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      const port=server.address()?.port;
      requireThat([`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host),'后台只接受本机访问',403);
      requireThat(req.url.startsWith('/')&&!req.url.startsWith('//'),'请求路径不正确',400);
      const url=new URL(req.url,`http://${req.headers.host}`),pathname=url.pathname;
      if(!['GET','HEAD'].includes(req.method)){
        requireThat(req.headers['x-bgt-request']==='1','请求缺少本机后台标识',403);
        requireThat(!req.headers.origin||req.headers.origin===url.origin,'拒绝跨站写入',403);
      }
      if(pathname==='/api/session'&&req.method==='GET')return json(res,200,{needsSetup:!store.setting('admin'),authenticated:!!sessionFor(req),name:sessionFor(req)?store.setting('admin')?.name:null});
      if(['/api/setup','/api/login'].includes(pathname)&&req.method==='POST'){
        const input=await body(req);const password=input.password;requireThat(typeof password==='string'&&password.length<=200,'密码格式不正确');
        if(pathname==='/api/setup'){
          requireThat(!store.setting('admin'),'管理员已经创建',409);requireThat(password.trim().length>=12,'密码至少 12 个非空白字符');
          const name=text(input.name??'管理员',80);requireThat(name,'请填写管理员名称');
          const salt=randomBytes(16).toString('hex');const derived=Buffer.from(await scryptAsync(password,salt,64)).toString('hex');
          store.transaction(()=>{requireThat(!store.setting('admin'),'管理员已经创建',409);store.setSetting('admin',{name,salt,hash:derived});});
        }else{
          const key=req.socket.remoteAddress,attempt=loginAttempts.get(key);
          requireThat(!attempt||attempt.count<5||attempt.until<Date.now(),'尝试过于频繁，请 5 分钟后重试',429);
          const admin=store.setting('admin');requireThat(admin,'请先创建管理员',409);
          const actual=Buffer.from(await scryptAsync(password,admin.salt,64));
          if(!timingSafeEqual(actual,Buffer.from(admin.hash,'hex'))){loginAttempts.set(key,{count:(attempt?.until>Date.now()?attempt.count:0)+1,until:Date.now()+300000});throw new AppError('密码不正确',401);}loginAttempts.delete(key);
        }
        const token=randomBytes(32).toString('hex');store.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),Date.now()+28800000);
        return json(res,200,{name:store.setting('admin').name},{'Set-Cookie':cookie(token)});
      }
      if(pathname.startsWith('/api/')){
        const token=sessionFor(req);requireThat(token,'请登录管理后台',401);const actor=store.setting('admin').name;
        if(pathname==='/api/logout'&&req.method==='POST'){store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));return json(res,200,{ok:true},{'Set-Cookie':'bgt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
        if(pathname==='/api/config'&&req.method==='GET')return json(res,200,{countries:COUNTRIES,originLevels:ORIGIN_LEVELS,evidenceTypes:EVIDENCE_TYPES,siteUrl:SITE_URL});
        if(pathname==='/api/products'&&req.method==='GET')return json(res,200,store.list());
        if(pathname==='/api/products'&&req.method==='POST'){const input=await body(req);return json(res,201,store.save(input.document,0,actor));}
        const match=pathname.match(/^\/api\/products\/([a-z0-9-]+)(?:\/(evidence|history|restore|submit|approve|reject|withdraw))?(?:\/([a-z0-9-]+))?$/);
        if(match){
          const [,id,action,entry]=match;
          if(req.method==='GET'&&!action){const p=store.get(id);return json(res,200,{...p,issues:reviewIssues(p.document,p.evidence)});}
          if(req.method==='GET'&&action==='history')return json(res,200,store.history(id));
          const input=await body(req);const revision=input.revision;
          if(req.method==='PUT'&&!action){requireThat(input.document.id===id,'档案编号不能修改');return json(res,200,store.save(input.document,revision,actor));}
          if(req.method==='POST'&&action==='evidence')return json(res,201,store.addEvidence(id,input.evidence,revision,actor));
          if(req.method==='PUT'&&action==='evidence'&&entry)return json(res,200,store.updateEvidence(id,entry,input.evidence,revision,actor));
          if(req.method==='DELETE'&&action==='evidence'&&entry)return json(res,200,store.removeEvidence(id,entry,revision,actor));
          if(req.method==='POST'&&action==='restore')return json(res,200,store.restore(id,input.version,revision,actor));
          if(req.method==='POST'&&['submit','approve','reject','withdraw'].includes(action)){
            if(action==='approve'){const name=store.get(id).document.image;requireThat(fs.existsSync(path.join(root,'dist/assets',name))||store.db.prepare('SELECT id FROM assets WHERE name=? AND kind=?').get(name,'image'),'请先上传档案图片');}
            return json(res,200,store.transition(id,action,revision,actor,text(input.note??'',3000)));
          }
        }
        if(pathname==='/api/assets'&&req.method==='GET'){
          const existing=fs.readdirSync(path.join(root,'dist/assets')).filter(name=>name.endsWith('.webp')).map(name=>({name,kind:'image',legacy:true}));
          return json(res,200,[...existing,...store.db.prepare('SELECT id,kind,name,mime,size FROM assets ORDER BY rowid DESC').all()]);
        }
        if(pathname==='/api/assets'&&req.method==='POST'){
          store.assertUnlocked();const input=await body(req);requireThat(['image','evidence'].includes(input.kind),'上传类别不正确');
          requireThat(typeof input.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(input.data),'附件编码不正确');
          const bytes=Buffer.from(input.data,'base64');requireThat(bytes.length&&bytes.length<=8*1024*1024,'附件必须小于 8 MB');
          const id=randomUUID();let filename=path.join(assetDirectory,id),mime,name;
          if(input.kind==='image'){
            const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
            const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpeg=bytes[0]===255&&bytes[1]===216;
            requireThat(webp||png||jpeg,'图片只支持实际的 WebP、PNG 或 JPEG');
            name=`asset-${id}.webp`;filename=path.join(assetDirectory,name);mime='image/webp';
            const temporary=path.join(assetDirectory,`${id}.original`);fs.writeFileSync(temporary,bytes,{mode:0o600});
            try{await exec(process.env.BGT_WEBP_BIN??'cwebp',['-quiet','-q','80','-resize','720','0',temporary,'-o',filename],{timeout:30000});requireThat(fs.statSync(filename).size<=100000,'图片压缩后仍超过 100 KB，请先裁剪或缩小图片');}catch(error){fs.rmSync(filename,{force:true});if(error.code==='ENOENT'&&webp&&bytes.length<=100000)fs.writeFileSync(filename,bytes,{mode:0o600});else throw error instanceof AppError?error:new AppError('图片转换失败，请安装 cwebp 或上传小于 100 KB 的 WebP');}finally{fs.rmSync(temporary,{force:true});}
          }else{
            requireThat(['application/pdf','text/plain','image/png','image/jpeg','image/webp'].includes(input.mime),'证据附件支持 PDF、文本及图片');mime=input.mime;name=text(input.name??'证据附件',200).replace(/[\r\n]/g,'');fs.writeFileSync(filename,bytes,{mode:0o600});
          }
          fs.chmodSync(filename,0o600);store.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(id,input.kind,name,mime,filename,fs.statSync(filename).size,new Date().toISOString());
          return json(res,201,{id,name,kind:input.kind,mime});
        }
        const imageMatch=pathname.match(/^\/api\/images\/([a-z0-9-]+\.webp)$/);
        if(imageMatch&&req.method==='GET'){
          const name=imageName(imageMatch[1]),asset=store.db.prepare('SELECT path FROM assets WHERE name=? AND kind=?').get(name,'image');
          const file=asset?.path??path.join(root,'dist/assets',name);requireThat(fs.existsSync(file),'图片不存在',404);res.writeHead(200,{'Content-Type':'image/webp'});return res.end(fs.readFileSync(file));
        }
        const attachment=pathname.match(/^\/api\/attachments\/([a-z0-9-]+)$/);
        if(attachment&&req.method==='GET'){
          const asset=store.db.prepare('SELECT * FROM assets WHERE id=? AND kind=?').get(slug(attachment[1]),'evidence');requireThat(asset,'附件不存在',404);
          res.writeHead(200,{'Content-Type':asset.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`});return res.end(fs.readFileSync(asset.path));
        }
        if(pathname==='/api/preview'&&req.method==='GET')return json(res,200,{products:store.plan().map(x=>x.document),changes:store.list().filter(p=>['approved','withdrawn'].includes(p.state)).map(p=>({id:p.id,name:p.document.name,action:p.state==='approved'?'发布审核版本':'撤回公开档案'}))});
        if(pathname==='/api/releases'&&req.method==='GET')return json(res,200,{releases:store.releases(),publishing});
        if(pathname==='/api/releases'&&req.method==='POST'){
          requireThat(!publishing,'发布进行中',409);const id=store.newRelease();publishing=true;
          void publisher(store,id,root).catch(()=>store.failRelease(id,'发布任务异常退出')).finally(()=>{publishing=false;});return json(res,202,{id});
        }
        if(pathname==='/api/backup'&&req.method==='POST'){
          store.assertUnlocked();const folder=path.join(directory,'backups');fs.mkdirSync(folder,{recursive:true,mode:0o700});const name=`catalog-${Date.now()}.sqlite`;store.backup(path.join(folder,name));return json(res,200,{name,message:'已备份到本机私有数据目录；证据附件请与 assets 目录一起备份'});
        }
        throw new AppError('接口不存在',404);
      }
      const staticFiles={'/':'index.html','/admin':'index.html','/admin/':'index.html','/admin/admin.js':'admin.js','/admin/admin.css':'admin.css','/admin/mark.svg':'mark.svg','/favicon.ico':'mark.svg'};
      const name=staticFiles[pathname];requireThat(name&&['GET','HEAD'].includes(req.method),'页面不存在',404);
      const content=fs.readFileSync(name==='mark.svg'?path.join(root,'dist/assets/mark.svg'):path.join(root,'backend/admin',name));res.writeHead(200,{'Content-Type':mimeTypes[path.extname(name)]});res.end(req.method==='HEAD'?undefined:content);
    }catch(error){json(res,error instanceof AppError?error.status:500,{error:error instanceof AppError?error.message:'后台处理失败，请查看本机服务状态'});if(!(error instanceof AppError))console.error('Backend operation failed:',error.code??error.name);}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  return {server,store};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=path.resolve(process.env.BGT_DATA_DIR??path.join(rootDefault,'.local'));fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const lock=path.join(directory,'server.pid');
  if(fs.existsSync(lock)){const old=Number(fs.readFileSync(lock,'utf8'));let alive=false;try{process.kill(old,0);alive=true;}catch{}requireThat(!alive,'此数据目录已有后台进程运行');fs.unlinkSync(lock);}
  fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
  const {server,store}=createBackend({directory});
  for(const release of store.db.prepare("SELECT id FROM releases WHERE status IN ('preparing','syncing')").all())store.failRelease(release.id,'上次发布中断；本地文件与提交保留，请检查后重新发布');
  const close=()=>server.close(()=>{store.close();fs.rmSync(lock,{force:true});process.exit(0);});process.on('SIGINT',close);process.on('SIGTERM',close);
  server.on('error',()=>{fs.rmSync(lock,{force:true});store.close();console.error('后台端口不可用');process.exit(1);});
  server.listen(Number(process.env.BGT_PORT??4287),'127.0.0.1',()=>console.log(`Content backend: http://127.0.0.1:${server.address().port}/admin/`));
}
