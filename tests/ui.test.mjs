import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { openApp, until } from './ui-harness.mjs';
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
test('selecting on the map opens a mobile action bar without scrolling the page',async()=>{
  const f=fixture();let scrolls=0;
  const w=await openApp(f,{configure(w){w.HTMLElement.prototype.scrollIntoView=()=>scrolls++;w.SVGElement.prototype.scrollIntoView=()=>scrolls++;}}),d=w.document;
  try{
    d.querySelector('.map-svg [data-city="330100"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    assert.equal(scrolls,0);assert.equal(d.querySelector('#selection-dock').hidden,false);
    assert.match(d.querySelector('#selection-dock').textContent,/杭州市/);
    d.querySelector('#selection-dock [data-action="edit"]').click();assert.ok(d.querySelector('#visit-form'));
    d.querySelector('[data-close]').click();d.querySelector('[data-action="deselect"]').click();assert.equal(d.querySelector('#selection-dock').hidden,true);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('dragging the map does not accidentally select a city at pointer release',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document,svg=d.querySelector('.map-svg');
  try{
    svg.dispatchEvent(new w.PointerEvent('pointerdown',{pointerId:1,clientX:100,clientY:100}));
    svg.dispatchEvent(new w.PointerEvent('pointermove',{pointerId:1,clientX:130,clientY:125}));
    svg.dispatchEvent(new w.PointerEvent('pointerup',{pointerId:1,clientX:130,clientY:125}));
    d.querySelector('.map-svg [data-city="330100"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    assert.equal(d.querySelector('#selection-dock').hidden,true);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('search selection scrolls once, and reduced motion is respected',async()=>{
  const f=fixture();const scrolls=[];
  const w=await openApp(f,{configure(w){
    w.HTMLElement.prototype.scrollIntoView=options=>scrolls.push(options);
    const original=w.matchMedia.bind(w);
    w.matchMedia=query=>query==='(prefers-reduced-motion: reduce)'?{matches:true}:original(query);
  }}),d=w.document;
  try{d.querySelector('[data-action="search"]').click();d.querySelector('[data-pick="330100"]').click();assert.equal(scrolls.length,1);assert.equal(scrolls[0].behavior,'instant');assert.equal(d.querySelector('.sheet'),null);assert.equal(d.body.style.position,'');}finally{await w.happyDOM.abort();f.db.close();}
});
