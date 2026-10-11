import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context = {window:{}};
vm.runInNewContext(fs.readFileSync('dist/products.js','utf8'), context);
const products = context.window.PRODUCTS;
assert.equal(new Set(products.map(p=>p.id)).size,products.length);
for (const p of products) {
  for (const field of ['id','brand','name','model','country','material','source','originScope','checked','pending','status']) assert.ok(p[field],`${p.id}: missing ${field}`);
  assert.ok(fs.existsSync(`dist/assets/${p.image}`),`${p.id}: missing image`);
  assert.equal(p.status,'资料建档',`${p.id}: initial entries are not independently verified`);
  assert.ok(!['中国','China','CN'].includes(p.country),`${p.id}: requires documented exception review`);
}
const html = fs.readFileSync('dist/index.html','utf8');
assert.ok(!/href=["']https?:/i.test(html),'No external visitor links');
for(const file of ['app.js','products.js']) {
  const source=fs.readFileSync(`dist/${file}`,'utf8');
  new vm.Script(source);
  assert.ok(!/https?:\/\//i.test(source),'No external visitor URLs in data or app');
}
for (const src of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) assert.ok(fs.existsSync(`dist/${src[1]}`),`Missing ${src[1]}`);
console.log(`Verified ${products.length} product archives, assets, JavaScript syntax, evidence status and absence of external visitor links.`);
