import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { createMapSnapshot, exportDimensions } from '../src/export.js';
import { MAP_WIDTH, MAP_HEIGHT } from '../src/earth/mercator.js';
import { fixture } from './helpers.mjs';
import { openApp, until, searchAndSelect, enterDemo } from './ui-harness.mjs';

function measureMap(document,width=390,height=390){
  document.querySelector('.map-stage').getBoundingClientRect=()=>({width,height,left:0,top:0});
}
function decodePreview(w,blobs) {
  const proto=w.HTMLImageElement.prototype, src=Object.getOwnPropertyDescriptor(proto,'src');
  Object.defineProperty(proto,'src',{...src,set(url){
    src.set.call(this,url);
    const blob=blobs.get(url);
    if(blob?.type.startsWith('image/svg+xml'))blob.text().then(text=>{this.svg=text;this.onload?.();});
  }});
}
test('full-bleed world exports preserve all four view palettes and both hemispheres from any camera',async()=>{
  const f=fixture(), blobs=new Map();
  const w=await openApp(f,{configure(w){
    w.URL.createObjectURL=blob=>{const key='blob:https://example.test/'+crypto.randomUUID();blobs.set(key,blob);return key;};
    w.URL.revokeObjectURL=()=>{};
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
    const fill=(svg,id)=>svg.match(new RegExp('<path data-city="'+id+'"[^>]* fill="([^"]+)"'))?.[1];
    const overview=await exported();
    assert.match(overview,/示例/);assert.match(overview,/Natural Earth/);assert.match(overview,/fill="#c5f567"/);
    assert.match(overview,/data-projection="mercator" data-central-meridian="150" data-view="together"/);
    assert.ok(overview.includes('viewBox="0 0 '+MAP_WIDTH+' '+MAP_HEIGHT+'"'));
    assert.doesNotMatch(overview,/<text[^>]*>(一起去过的地方|图例|已点亮地区|未去过|DataV|墨卡托投影)/);
    assert.doesNotMatch(overview,/概览边界/);
    assert.equal(fill(overview,'ne-USA-3521'),'#c5f567');
    assert.equal(fill(overview,'ne-JPN-1860'),'#c5f567');
    assert.equal(fill(overview,'370100'),'#e0ece5');
    assert.equal(fill(overview,'360100'),'#e6eaf3');
    assert.equal(fill(overview,'370200'),'url(#personal-both-muted)');
    assert.ok(!/<image|<foreignObject|<script|data:image/i.test(overview));
    const rendered=new Resvg(overview,{fitTo:{mode:'width',value:780}}).render();
    const rgba=rendered.pixels;
    for(const i of [0,rendered.width-1,rendered.width*(rendered.height-1),rendered.width*rendered.height-1])assert.equal(rgba[i*4+3],255);
    const image=rendered.asPng();
    await mkdir('artifacts',{recursive:true});await writeFile('artifacts/world-mercator-preview.png',image);
    searchAndSelect(w,'820000');
    const local=await exported();
    assert.match(local,/data-city="820000"/);assert.match(local,/>澳门<\/text>/);
    assert.doesNotMatch(local,/<circle\b|data-pin=/);
    assert.match(local,/<path data-city="820000"[^>]* d="M[^"]+Z"/);
    assert.equal(fill(local,'820000'),'#ff976f');
    d.querySelector('[data-action="deselect"]').click();
    assert.equal(await exported()===overview,true,'a Macau close-up exports exactly the same world extent and geometry');
    for(const [button,view,xuan,xi] of [
      ['xuan','xuan','#9ed9c5','#e6eaf3'],['xi','xi','#e0ece5','#bccdf3'],['xi','all','#9ed9c5','#bccdf3']
    ]){
      d.querySelector('[data-view="'+button+'"]').click();
      const svg=await exported();
      assert.ok(svg.includes('data-view="'+view+'"'));
      assert.equal(fill(svg,'110000'),'#c5f567');assert.equal(fill(svg,'370100'),xuan);
      assert.equal(fill(svg,'360100'),xi);assert.equal(fill(svg,'370200'),'url(#personal-both)');
    }
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('the world plate is 4096 pixels wide and keeps offline and source information in metadata',()=>{
  const s=createMapSnapshot({width:MAP_WIDTH,height:MAP_HEIGHT,body:'<path/>'},{offline:true,view:'xuan'});
  assert.equal(s.pixelWidth,4096);assert.ok(s.pixelWidth*s.pixelHeight<=14000000);assert.match(s.svg,/<desc>离线缓存/);
  assert.ok(!s.svg.includes('<text'));assert.ok(s.filename.includes('轩宝'));
  assert.ok(!s.svg.includes('undefined'));
});
test('export dialog supplies a PNG download even when system file sharing is unsupported',async()=>{
  const f=fixture();const blobs=new Map(),downloads=[];let vectorFiles=0;
  const w=await openApp(f,{configure(w){
    w.URL.createObjectURL=blob=>{const url=`blob:https://example.test/${crypto.randomUUID()}`;blobs.set(url,blob);if(blob.type.startsWith('image/svg+xml'))vectorFiles++;return url;};
    w.URL.revokeObjectURL=url=>blobs.delete(url);
    decodePreview(w,blobs);
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
    const png=new DataView(await blob.arrayBuffer());
    assert.equal(vectorFiles,1,'the preview and PNG share one decoded vector file');
    assert.equal(png.getUint32(16),4096);assert.equal(png.getUint32(20),Math.round(4096*MAP_HEIGHT/MAP_WIDTH));
    d.querySelector('[data-save-png]').click();assert.equal(downloads.length,2);assert.match(downloads[1].name,/\.png$/);assert.equal(downloads[1].url,preview.src);
    assert.deepEqual((await(await f.request('/api/state')).json()).records,{});
    d.querySelector('[data-close]').click();assert.equal(d.querySelector('.sheet'),null);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('high-resolution output is independent of phone size and respects the pixel budget',()=>{
  for(const [width,height] of [[320,540],[390,606],[700,640],[900,900],[3000,2200]]){
    const result=exportDimensions(width,height);
    assert.ok(result.pixelWidth*result.pixelHeight<=14000000);
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
    decodePreview(w,blobs);
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
