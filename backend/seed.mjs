import fs from 'node:fs';
import path from 'node:path';

export function readSeed(root){
  const products=JSON.parse(fs.readFileSync(path.join(root,'content/catalog.json'),'utf8')).products;
  const rows=fs.readFileSync(path.join(root,'SOURCES.md'),'utf8').split('\n').filter(line=>/^\| (HARIO|Le Creuset|LAMY|Kent|Opinel|Victorinox)/.test(line));
  return products.map(p=>{
    const row=rows.find(line=>line.toLowerCase().includes(p.brand.toLowerCase()));
    const urls=row?.match(/https?:\/\/[^\s|;]+/g)??[];
    const url=['lamy','kent','opinel'].includes(p.id)?urls.at(-1):urls[0];
    return {...p,seedEvidence:url?[{type:'origin',sourceType:'manufacturer',title:p.source,summary:p.facts[0],url,checked:p.checked}]:[]};
  });
}
