import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requireThat,validatePublic } from './catalog.mjs';
const exec=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const SITE_URL='https://imoneys10k.github.io/buy-great-things/';
export async function publish(store,id,root,{repository='imoneys10k/buy-great-things',monitor=true,runCommand}={}){
  let synced=false;
  const command=async (bin,args)=>{if(runCommand)return runCommand(bin,args);const r=await exec(bin,args,{cwd:root,timeout:120000,maxBuffer:1024*1024});return r.stdout.trim();};
  try{
    requireThat(await command('git',['branch','--show-current'])==='main','请在 main 分支发布');
    requireThat(!(await command('git',['status','--porcelain'])),'工作区有未提交改动；请先提交代码后发布');
    const remote=await command('git',['remote','get-url','origin']);
    requireThat(remote===`https://github.com/${repository}.git`||remote===`https://github.com/${repository}`||remote===`git@github.com:${repository}.git`,'GitHub 远端与项目配置不一致');
    const release=store.release(id);const products=validatePublic(release.snapshot.map(item=>item.document));
    const assets=[];
    for(const p of products){
      const target=path.join(root,'dist/assets',p.image);
      if(!fs.existsSync(target)){
        const asset=store.db.prepare('SELECT * FROM assets WHERE name=? AND kind=?').get(p.image,'image');
        requireThat(asset&&fs.existsSync(asset.path),`图片不存在：${p.image}`);requireThat(fs.statSync(asset.path).size<=100000,'图片超过性能预算');
        fs.copyFileSync(asset.path,target);assets.push(`dist/assets/${p.image}`);
      }
    }
    const catalog={schemaVersion:1,products};
    fs.writeFileSync(path.join(root,'content/catalog.json'),JSON.stringify(catalog,null,2)+'\n');
    await command(process.execPath,['scripts/build-catalog.mjs']);await command(process.execPath,['scripts/check.mjs']);
    await command('git',['add','--','content/catalog.json','dist/products.js','dist/index.html',...assets]);
    if(await command('git',['diff','--cached','--name-only']))await command('git',['commit','-m','Publish reviewed product archives']);
    const sha=await command('git',['rev-parse','HEAD']);store.updateRelease(id,'syncing',sha);
    await command('git',['push','origin','main']);store.completeRelease(id,sha);synced=true;
    if(monitor){
      for(let attempt=0;attempt<60;attempt++){
        const raw=await command('gh',['run','list','--repo',repository,'--commit',sha,'--workflow','pages.yml','--limit','1','--json','status,conclusion']);
        const run=JSON.parse(raw)[0];
        if(run?.status==='completed'){store.updateRelease(id,run.conclusion==='success'?'deployed':'deployment_failed',sha,run.conclusion==='success'?null:`GitHub Pages 发布结果：${run.conclusion}`);return;}
        await sleep(5000);
      }
      store.updateRelease(id,'synced',sha,'已同步代码；部署尚未确认，请查看 GitHub Actions');
    }
  }catch(error){
    const detail=error.message?.startsWith('Command failed')?'发布命令执行失败；本地文件与提交已保留，可检查后重试。':error.message;
    if(synced)store.updateRelease(id,'synced',null,'代码已同步；无法查询 GitHub 部署状态');else store.failRelease(id,detail?.slice(0,1000)??'发布失败');
  }
}
