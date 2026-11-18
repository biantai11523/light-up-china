import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { createMapSnapshot, exportDimensions } from '../src/export.js';
import { fixture } from './helpers.mjs';
import { openApp, until, searchAndSelect, enterDemo } from './ui-harness.mjs';

function measureMap(document,width=390,height=390){
  document.querySelector('.map-stage').getBoundingClientRect=()=>({width,height,left:0,top:0});
}
test('the real globe export preserves the camera, Macau selection, demo status and vector geometry',async()=>{
  const f=fixture(), blobs=new Map();
  const w=await openApp(f,{configure(w){
    w.URL.createObjectURL=blob=>{const key='blob:https://example.test/'+crypto.randomUUID();blobs.set(key,blob);return key;};
    w.URL.revokeObjectURL=()=>{};
    w.Image=class{set src(url){if(url)queueMicrotask(()=>this.onerror?.());}};
  }}),d=w.document;
  try{
    measureMap(d);enterDemo(d);
    async function exported(){
      d.querySelector('[data-action="export-map"]').click();
      await until(()=>d.querySelector('[data-save-svg]'));
      const svg=await blobs.get(d.querySelector('.export-preview img').src).text();
      d.querySelector('[data-close]').click();
      return svg;
    }
    const overview=await exported();
    assert.match(overview,/示例/);assert.match(overview,/Natural Earth/);assert.match(overview,/fill="#c5f567"/);
    assert.ok(!/<image|<foreignObject|<script|data:image/i.test(overview));
    const image=new Resvg(overview,{fitTo:{mode:'width',value:780}}).render().asPng();
    await mkdir('artifacts',{recursive:true});await writeFile('artifacts/globe-overview.png',image);
    searchAndSelect(w,'820000');
    const local=await exported();
    assert.match(local,/data-city="820000"/);assert.match(local,/>澳门<\/text>/);
    assert.match(local,/fill="#ff976f"/);
    await writeFile('artifacts/globe-macau.png',new Resvg(local,{fitTo:{mode:'width',value:780}}).render().asPng());
    assert.notEqual(local,overview);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('large viewport globe exports stay within the pixel budget and label cached maps',()=>{
  const s=createMapSnapshot({width:2400,height:1600,body:'<circle r="200"/>'},{count:0,total:4901,countries:0},{offline:true});
  assert.ok(s.pixelWidth*s.pixelHeight<=12000000);assert.match(s.svg,/离线缓存/);
  assert.ok(!s.svg.includes('undefined'));
});
test('export dialog supplies a PNG download even when system file sharing is unsupported',async()=>{
  const f=fixture();const blobs=new Map(),downloads=[];
  const w=await openApp(f,{configure(w){
    w.URL.createObjectURL=blob=>{const url=`blob:https://example.test/${crypto.randomUUID()}`;blobs.set(url,blob);return url;};
    w.URL.revokeObjectURL=url=>blobs.delete(url);
    w.Image=class{set src(url){if(url)blobs.get(url).text().then(text=>{this.svg=text;this.onload?.();});}};
    w.HTMLCanvasElement.prototype.getContext=function(){return{drawImage:image=>{this.sourceSvg=image.svg;}};};
    w.HTMLCanvasElement.prototype.toBlob=function(callback){const bytes=new Resvg(this.sourceSvg,{fitTo:{mode:'width',value:this.width}}).render().asPng();callback(new w.Blob([bytes],{type:'image/png'}));};
    w.HTMLAnchorElement.prototype.click=function(){downloads.push({url:this.href,name:this.download});};
    Object.defineProperty(w.navigator,'canShare',{value:()=>false});
  }}),d=w.document;
  try{
    measureMap(d);d.querySelector('[data-action="export-map"]').click();
    await until(()=>d.querySelector('[data-save-svg]'));assert.equal(d.querySelector('[data-save-svg]').disabled,false);
    d.querySelector('[data-save-svg]').click();assert.equal(downloads.length,1);assert.match(downloads[0].name,/\.svg$/);
    const vector=blobs.get(downloads[0].url);assert.match(vector.type,/image\/svg\+xml/);assert.ok(!(await vector.text()).includes('data:image/png'));
    await until(()=>d.querySelector('[data-save-png]')?.disabled===false);
    const preview=d.querySelector('.export-preview img');assert.ok(preview);assert.equal(d.querySelector('[data-share-png]'),null);
    const blob=blobs.get(preview.src);assert.equal(blob.type,'image/png');assert.ok(blob.size>30000);
    d.querySelector('[data-save-png]').click();assert.equal(downloads.length,2);assert.match(downloads[1].name,/\.png$/);assert.equal(downloads[1].url,preview.src);
    assert.deepEqual((await(await f.request('/api/state')).json()).records,{});
    d.querySelector('[data-close]').click();assert.equal(d.querySelector('.sheet'),null);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('high-resolution output is independent of phone size and respects the pixel budget',()=>{
  for(const [width,height] of [[320,540],[390,606],[700,640],[900,900],[3000,2200]]){
    const result=exportDimensions(width,height);
    assert.ok(result.pixelWidth*result.pixelHeight<=12000000);
    assert.ok(Math.max(result.pixelWidth,result.pixelHeight)<=4096);
    assert.ok(Math.max(result.pixelWidth,result.pixelHeight)>=3464);
    assert.ok(Math.abs(result.pixelWidth/result.pixelHeight-width/height)<.001);
  }
});
test('SVG remains downloadable if the device cannot create the high-resolution PNG',async()=>{
  const f=fixture(),blobs=new Map(),downloads=[];
  const w=await openApp(f,{configure(w){
    w.URL.createObjectURL=blob=>{const url=`blob:https://example.test/${crypto.randomUUID()}`;blobs.set(url,blob);return url;};
    w.URL.revokeObjectURL=url=>blobs.delete(url);
    w.Image=class{set src(url){if(url)Promise.resolve().then(()=>this.onload?.());}};
    w.HTMLCanvasElement.prototype.getContext=()=>null;
    w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,url:this.href});};
  }}),d=w.document;
  try{
    measureMap(d);d.querySelector('[data-action="export-map"]').click();
    await until(()=>d.querySelector('[data-export-error]')?.hidden===false);
    assert.equal(d.querySelector('[data-save-png]').disabled,true);
    d.querySelector('[data-save-svg]').click();assert.equal(downloads.length,1);
    assert.match(downloads[0].name,/\.svg$/);assert.match((await blobs.get(downloads[0].url).text()),/<path /);
    assert.equal(d.querySelector('[data-retry-export]').hidden,false);
  }finally{await w.happyDOM.abort();f.db.close();}
});
