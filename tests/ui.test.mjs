import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { fixture } from './helpers.mjs';
const bundled=await build({entryPoints:['src/main.js'],bundle:true,write:false,format:'iife',loader:{'.css':'empty'},define:{'import.meta.env.VITE_API_URL':'"https://api.test"','import.meta.env.BASE_URL':'"/"'}});
const script=bundled.outputFiles[0].text;
async function until(condition){for(let i=0;i<100;i++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw new Error('DOM condition timed out');}
async function openApp(f,{offline=false,width=390}={}){
  const window=new Window({url:'https://biantai11523.github.io/light-up-china/',width,height:844});
  window.document.body.innerHTML='<div id="app"></div><div id="modal-root"></div><div id="toast"></div>';
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.SVGElement.prototype.scrollIntoView=function(){};
  window.fetch=async(url,options)=>{
    if(String(url).endsWith('/data/china.json'))return Response.json(f.map);
    if(offline)throw new TypeError('Offline');
    const {signal,...rest}=options || {};
    return f.request(new URL(url).pathname,rest);
  };
  window.eval(script);
  await until(()=>window.document.querySelectorAll('.map-svg .city-shape').length===370);
  if(!offline){try{await until(()=>window.document.querySelector('#sync-status').textContent.includes('已同步'));}catch(error){await window.happyDOM.abort();throw error;}}
  return window;
}
test('mobile DOM flow: search, select, save a memory, and see it from another visitor',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{
    assert.equal(d.querySelector('#stat-count').textContent,'00');
    d.querySelector('[data-action="search"]').click();
    const search=d.querySelector('#city-search');search.value='杭州';search.dispatchEvent(new w.Event('input'));
    assert.equal(d.querySelectorAll('[data-pick]').length,1);
    d.querySelector('[data-pick="330100"]').click();assert.match(d.querySelector('#city-panel').textContent,/杭州市/);
    d.querySelector('[data-action="edit"]').click();
    d.querySelector('[name="author"]').value='同行 A';d.querySelector('[name="date"]').value='2025-05-01';d.querySelector('[name="note"]').value='日落 <img src=x onerror=alert(1)>';
    d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await until(()=>d.querySelector('#stat-count').textContent==='01');
    assert.equal(d.querySelector('#city-panel img'),null);assert.match(d.querySelector('.place-note').textContent,/<img/);
    assert.equal(d.querySelector('#stat-provinces').textContent,'01');assert.equal(d.querySelector('#stat-memories').textContent,'01');
    const other=await openApp(f);assert.equal(other.document.querySelector('#stat-count').textContent,'01');await other.happyDOM.abort();
    d.querySelector('#toast button').click();await until(()=>d.querySelector('#stat-count').textContent==='00');
    assert.equal((await(await f.request('/api/state')).json()).records['330100'].active,false);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('demo changes never reach the shared database',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{d.querySelector('[data-action="demo"]').click();assert.equal(d.querySelector('#stat-count').textContent,'18');assert.match(d.querySelector('#demo-banner').textContent,/示例/);assert.deepEqual((await(await f.request('/api/state')).json()).records,{});d.querySelector('#demo-banner button').click();await until(()=>d.querySelector('#stat-count').textContent==='00');}finally{await w.happyDOM.abort();f.db.close();}
});
test('offline state is visible and cannot claim a successful shared save',async()=>{
 const f=fixture(),w=await openApp(f,{offline:true}),d=w.document;
 try{await until(()=>d.querySelector('#offline-banner').classList.contains('visible'));assert.ok(!d.querySelector('#sync-status').textContent.includes('已同步'));assert.equal(d.querySelector('#stat-count').textContent,'00');}finally{await w.happyDOM.abort();f.db.close();}
});
