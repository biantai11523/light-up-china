import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize,escapeHtml } from '../src/store.js';
const data=JSON.parse(readFileSync('public/data/china.json','utf8'));
test('map has 34 provinces, unique city codes, finite geometry, and complete parent coverage',()=>{
 assert.equal(data.provinces.length,34);assert.equal(data.cities.length,370);assert.equal(new Set(data.cities.map(c=>c.id)).size,data.cities.length);
 for(const province of data.provinces)assert.ok(data.cities.some(c=>c.provinceId===province.id));
 for(const c of data.cities){assert.match(c.id,/^\d{6}$/);assert.ok(c.path.length>10);assert.ok(!/NaN|Infinity/.test(c.path));assert.ok(c.center.every(Number.isFinite));}
 assert.ok(data.decorations.length>0);assert.ok(data.cities.some(c=>c.id==='460300'));
});
test('municipalities and Hong Kong/Macao do not become district-level lighting units',()=>{
 for(const id of ['110000','120000','310000','500000','810000','820000'])assert.equal(data.cities.filter(c=>c.provinceId===id).length,1);
});
test('stats count active records only and ignore unknown administrative codes',()=>{
 const summary=summarize({'330100':{active:true},'330200':{active:true},'510100':{active:false},'999999':{active:true}},data.cities);assert.equal(summary.count,2);assert.equal(summary.provinces,1);
});
test('user notes cannot become active HTML',()=>{assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');});
