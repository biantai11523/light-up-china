import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, input } from './helpers.mjs';
import { openApp, until, searchAndSelect, enterDemo, typeQuery, tapRegion, worldAtlas } from './ui-harness.mjs';
test('mobile DOM flow: search, select, save a memory, and see it from another visitor',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{
    assert.equal(d.querySelector('#stat-count').textContent,'00');
    d.querySelector('[data-action="search"]').click();
    const search=d.querySelector('#city-search');search.value='杭州';search.dispatchEvent(new w.Event('input'));
    assert.equal(d.querySelectorAll('[data-pick]').length,1);
    d.querySelector('[data-pick="330100"]').click();assert.match(d.querySelector('#selection-dock').textContent,/杭州市/);
    d.querySelector('[data-action="edit"]').click();
    d.querySelector('[name="author"]').value='同行 A';assert.equal(d.querySelector('[name="date"]'),null);d.querySelector('[name="note"]').value='日落 <img src=x onerror=alert(1)>';
    d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await until(()=>d.querySelector('#stat-count').textContent==='01');
    assert.equal(d.querySelector('#selection-dock img'),null);assert.match(d.querySelector('.dock-info').textContent,/<img/);
    assert.equal(d.querySelector('#stat-provinces').textContent,'01');assert.equal(d.querySelector('#stat-memories').textContent,'01');
    const other=await openApp(f);assert.equal(other.document.querySelector('#stat-count').textContent,'01');await other.happyDOM.abort();
    d.querySelector('#toast button').click();await until(()=>d.querySelector('#stat-count').textContent==='00');
    assert.equal((await(await f.request('/api/state')).json()).records['330100'].active,false);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('demo changes never reach the shared database',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{enterDemo(d);assert.equal(d.querySelector('#stat-count').textContent,'18');assert.match(d.querySelector('#demo-banner').textContent,/示例/);assert.deepEqual((await(await f.request('/api/state')).json()).records,{});d.querySelector('#demo-banner button').click();await until(()=>d.querySelector('#stat-count').textContent==='00');}finally{await w.happyDOM.abort();f.db.close();}
});
test('offline state is visible and cannot claim a successful shared save',async()=>{
 const f=fixture(),w=await openApp(f,{offline:true}),d=w.document;
 try{await until(()=>d.querySelector('#offline-banner').classList.contains('visible'));assert.ok(!d.querySelector('#sync-status').textContent.includes('已同步'));assert.equal(d.querySelector('#stat-count').textContent,'00');}finally{await w.happyDOM.abort();f.db.close();}
});
test('selecting on the map opens a mobile action bar without scrolling the page',async()=>{
  const f=fixture();let scrolls=0;
  const w=await openApp(f,{configure(w){w.HTMLElement.prototype.scrollIntoView=()=>scrolls++;w.SVGElement.prototype.scrollIntoView=()=>scrolls++;}}),d=w.document;
  try{
    tapRegion(w,'330100');
    assert.equal(scrolls,0);assert.equal(d.querySelector('#selection-dock').hidden,false);
    assert.match(d.querySelector('#selection-dock').textContent,/杭州市/);
    d.querySelector('#selection-dock [data-action="edit"]').click();assert.ok(d.querySelector('#visit-form'));
    d.querySelector('[data-close]').click();d.querySelector('[data-action="deselect"]').click();assert.equal(d.querySelector('#selection-dock').hidden,true);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('dragging the map does not accidentally select a city at pointer release',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document,svg=d.querySelector('.map-stage');
  try{
    svg.dispatchEvent(new w.PointerEvent('pointerdown',{pointerId:1,clientX:100,clientY:100}));
    svg.dispatchEvent(new w.PointerEvent('pointermove',{pointerId:1,clientX:130,clientY:125}));
    svg.dispatchEvent(new w.PointerEvent('pointerup',{pointerId:1,clientX:130,clientY:125}));
    tapRegion(w,'330100');
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
  try{searchAndSelect(w,'330100');assert.equal(scrolls.length,1);assert.equal(scrolls[0].behavior,'instant');assert.equal(d.querySelector('.sheet'),null);assert.equal(d.body.style.position,'');}finally{await w.happyDOM.abort();f.db.close();}
});

test('search can browse the whole country in pages or select a distant result from the keyboard', async () => {
  const f = fixture(), w = await openApp(f, {width: 320}), d = w.document;
  try {
    d.querySelector('.search-trigger').click();
    const more = d.querySelector('.more-results');
    const first = d.querySelector('[data-pick]');
    const firstCount = d.querySelectorAll('[data-pick]').length;
    assert.ok(firstCount > 0 && firstCount < 50);
    const list = d.querySelector('.search-results');
    list.dispatchEvent(new w.Event('scroll'));
    assert.ok(d.querySelectorAll('[data-pick]').length > firstCount);
    while (d.querySelectorAll('[data-pick]').length < 96 && !more.hidden) more.click();
    assert.equal(d.querySelector('[data-pick]'), first);
    assert.equal(new Set([...d.querySelectorAll('[data-pick]')].map(n => n.dataset.pick)).size, 96);
    assert.ok(d.querySelector('.search-meta').textContent.includes(String(worldAtlas.regions.length)));
    typeQuery(w, '６５０１００');
    const field = d.querySelector('#city-search');
    field.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Enter', isComposing: true, bubbles: true}));
    assert.ok(d.querySelector('.sheet'));
    field.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    assert.equal(d.querySelector('.sheet'), null);
    assert.match(d.querySelector('#selection-dock').textContent, /乌鲁木齐/);
  } finally { await w.happyDOM.abort(); f.db.close(); }
});

test('an invalid 200 response preserves the last shared records and an unchanged refresh preserves keyboard focus', async () => {
  const f = fixture(), token = await f.session();
  await f.write(token, '330100', input({note: '西湖'}));
  let responseOverride = null;
  const headers = [];
  const w = await openApp(f, {configure(w) {
    const fetch = w.fetch;
    w.fetch = (url, options) => {
      if (String(url).endsWith('/api/state')) {
        headers.push(options.headers);
        if (responseOverride) return Promise.resolve(responseOverride.clone());
      }
      return fetch(url, options);
    };
  }}), d = w.document;
  try {
    searchAndSelect(w, '330100');
    const action = d.querySelector('#selection-dock [data-action="edit"]');
    action.focus();
    const originalCache = w.localStorage.getItem('dianliang-cache-v1');
    for (const response of [new Response('<html>offline</html>'), Response.json({layers: {together: {}}})]) {
      responseOverride = response;
      d.querySelector('[data-action="refresh"]').click();
      await until(() => d.querySelector('#sync-status').textContent === '暂时离线');
      assert.equal(d.querySelector('#stat-count').textContent, '01');
      assert.equal(w.localStorage.getItem('dianliang-cache-v1'), originalCache);
      responseOverride = null;
      d.querySelector('[data-action="refresh"]').click();
      await until(() => d.querySelector('#sync-status').textContent === '已同步');
      assert.equal(d.activeElement, action);
    }
    assert.ok(headers.every(h => !new Headers(h).has('Content-Type')));
  } finally { await w.happyDOM.abort(); f.db.close(); }
});
