import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { createMapSnapshot } from '../src/export.js';
import { fixture } from './helpers.mjs';
import { openApp, until } from './ui-harness.mjs';

function measureMap(document,width=390,height=456){
  document.querySelector('.map-stage').getBoundingClientRect=()=>({width,height,left:0,top:200});
  document.querySelector('.map-svg').getBoundingClientRect=()=>({width,height:height-100,left:0,top:200});
  document.querySelector('.sea-inset').getBoundingClientRect=()=>({width:62,height:88,left:width-78,top:200+height-92});
}
const meta={count:18,provinces:14,total:370};
test('current-view export keeps zoom, selections, borders and inset, and rasterizes into a valid PNG',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{
    measureMap(d);d.querySelector('[data-action="demo"]').click();
    const card=d.querySelector('.map-card');
    const nationwide=createMapSnapshot(card,meta,{demo:true,date:new Date('2026-11-16T12:00:00Z')});
    assert.equal(nationwide.pixelWidth,1170);assert.equal(nationwide.pixelHeight,1818);assert.match(nationwide.svg,/示例/);
    assert.ok(!/<foreignObject|<image|https?:\/\/(?!www.w3.org)/.test(nationwide.svg));
    assert.match(nationwide.svg,/fill="#c5f567"/);assert.match(nationwide.svg,/南海诸岛/);
    const png=new Resvg(nationwide.svg,{fitTo:{mode:'width',value:nationwide.pixelWidth}}).render().asPng();
    assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1170);assert.equal(png.readUInt32BE(20),1818);assert.ok(png.length>30000);
    await mkdir('artifacts',{recursive:true});await writeFile('artifacts/export-mobile.png',png);
    d.querySelector('[data-action="search"]').click();d.querySelector('[data-pick="330100"]').click();
    const transform=d.querySelector('.map-svg>g').getAttribute('transform');
    const zoomed=createMapSnapshot(card,meta,{demo:true});
    assert.ok(zoomed.svg.includes(`transform="${transform}"`));assert.match(zoomed.svg,/fill="#ff976f"/);assert.match(zoomed.svg,/杭州市/);
    assert.equal(d.querySelector('.map-svg>g').getAttribute('transform'),transform);
    await writeFile('artifacts/export-zoomed.png',new Resvg(zoomed.svg,{fitTo:{mode:'width',value:zoomed.pixelWidth}}).render().asPng());
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('large viewport exports stay within the mobile-safe size limit; cached maps are identified',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{measureMap(d,2400,1600);const s=createMapSnapshot(d.querySelector('.map-card'),{count:0,provinces:0,total:370},{offline:true});assert.ok(Math.max(s.pixelWidth,s.pixelHeight)<=3840);assert.match(s.svg,/离线缓存/);assert.ok(!s.svg.includes('undefined'));}finally{await w.happyDOM.abort();f.db.close();}
});
test('export dialog supplies a PNG download even when system file sharing is unsupported',async()=>{
  const f=fixture();const blobs=new Map(),downloads=[];
  const w=await openApp(f,{configure(w){
    w.URL.createObjectURL=blob=>{const url=`blob:https://example.test/${crypto.randomUUID()}`;blobs.set(url,blob);return url;};
    w.URL.revokeObjectURL=url=>blobs.delete(url);
    w.Image=class{set src(url){blobs.get(url).text().then(text=>{this.svg=text;this.onload?.();});}};
    w.HTMLCanvasElement.prototype.getContext=function(){return{drawImage:image=>{this.sourceSvg=image.svg;}};};
    w.HTMLCanvasElement.prototype.toBlob=function(callback){const bytes=new Resvg(this.sourceSvg,{fitTo:{mode:'width',value:this.width}}).render().asPng();callback(new w.Blob([bytes],{type:'image/png'}));};
    w.HTMLAnchorElement.prototype.click=function(){downloads.push({url:this.href,name:this.download});};
    Object.defineProperty(w.navigator,'canShare',{value:()=>false});
  }}),d=w.document;
  try{
    measureMap(d);d.querySelector('[data-action="export-map"]').click();
    await until(()=>d.querySelector('[data-save-png]'));
    const preview=d.querySelector('.export-preview img');assert.ok(preview);assert.equal(d.querySelector('[data-share-png]'),null);
    const blob=blobs.get(preview.src);assert.equal(blob.type,'image/png');assert.ok(blob.size>30000);
    d.querySelector('[data-save-png]').click();assert.equal(downloads.length,1);assert.match(downloads[0].name,/\.png$/);assert.equal(downloads[0].url,preview.src);
    assert.deepEqual((await(await f.request('/api/state')).json()).records,{});
    d.querySelector('[data-close]').click();assert.equal(d.querySelector('.sheet'),null);
  }finally{await w.happyDOM.abort();f.db.close();}
});
