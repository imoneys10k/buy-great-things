import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { validatePublic } from '../backend/catalog.mjs';

const catalog=JSON.parse(fs.readFileSync('content/catalog.json','utf8'));
validatePublic(catalog.products);
const source=`/* Generated from content/catalog.json. Edit through the private content backend. */\nwindow.PRODUCTS = ${JSON.stringify(catalog.products,null,2)};\n`;
fs.writeFileSync('dist/products.js',source);
const version=createHash('sha256').update(source).digest('hex').slice(0,12);
const html=fs.readFileSync('dist/index.html','utf8').replace(/src="\.\/products\.js(?:\?[^"\s]*)?"/,`src="./products.js?v=${version}"`);
fs.writeFileSync('dist/index.html',html);
console.log(`Generated ${catalog.products.length} public archives. Version ${version}.`);
