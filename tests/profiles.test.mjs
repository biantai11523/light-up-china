import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,input } from './helpers.mjs';
import { recordsForView,cityAppearance,cleanLayers } from '../src/profiles.js';
import { openApp,until,typeQuery,tapRegion as tap,searchAndSelect } from './ui-harness.mjs';
const write=(f,token,profile,id,body)=>f.request(`/api/profiles/${profile}/cities/${id}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
const batch=(f,token,profile,updates)=>f.request(`/api/profiles/${profile}/cities/batch`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({updates})});
test('joint history remains compatible and all joint cities are inherited by both personal views',async()=>{
  const f=fixture(),token=await f.session();
  try{
    await f.write(token,'330100',input({note:'一起的备注'}));
    await write(f,token,'xuan','510100',input({note:'轩宝的备注'}));
    await write(f,token,'xi','350200',input({note:'曦宝的备注'}));
    const state=(await(await f.request('/api/state')).json());
    assert.deepEqual(Object.keys(state.records),['330100']);assert.equal(state.activity.length,1);
    for(const profile of ['xuan','xi'])assert.equal(recordsForView(state.layers,profile)['330100'].active,true);
    assert.equal(recordsForView(state.layers,'xuan')['350200'].active,false);
    assert.equal(recordsForView(state.layers,'xi')['510100'].active,false);
    assert.equal(Object.values(recordsForView(state.layers,'all')).filter(r=>r.active).length,3);
    assert.equal(state.layers.xuan['510100'].note,'轩宝的备注');assert.equal(state.layers.xi['350200'].note,'曦宝的备注');
  }finally{f.db.close();}
});
test('personal batch writes are isolated, atomic, idempotent and return unprefixed city IDs',async()=>{
  const f=fixture(),token=await f.session(),updates=['330100','330200'].map(id=>({id,...input({note:'个人多选'})}));
  try{
    const response=await batch(f,token,'xuan',updates);assert.equal(response.status,200);assert.deepEqual(Object.keys((await response.json()).records).sort(),['330100','330200']);
    const retry=await batch(f,token,'xuan',updates);assert.equal((await retry.json()).idempotent,true);
    const conflict=await batch(f,token,'xuan',['330300','330100'].map(id=>({id,...input()})));assert.equal(conflict.status,409);assert.deepEqual((await conflict.json()).conflicts,['330100']);
    const state=(await(await f.request('/api/state')).json());assert.equal(state.layers.xuan['330300'],undefined);assert.deepEqual(state.layers.together,{});assert.deepEqual(state.layers.xi,{});
    assert.equal((await write(f,token,'all','330100',input())).status,404);
  }finally{f.db.close();}
});
test('both independently visited cities are distinguished from having visited together',()=>{
  const layers=cleanLayers({together:{'110000':{active:true}},xuan:{'110000':{active:true},'330100':{active:true},'510100':{active:true}},xi:{'330100':{active:true},'350200':{active:true}}});
  assert.equal(cityAppearance(layers,'110000','all').category,'together');
  assert.equal(cityAppearance(layers,'330100','all').category,'both');
  assert.equal(cityAppearance(layers,'350200','xuan').emphasized,false);
  assert.equal(cityAppearance(layers,'110000','xi').emphasized,true);
  assert.equal(cityAppearance(layers,'330100','xuan').emphasized,true);
  assert.equal(cityAppearance(layers,'350200','all').fill,'#bccdf3');
});
test('an explicitly empty personal note does not reappear from the joint record',()=>{
  const layers=cleanLayers({together:{'330100':{active:true,note:'共同备注'}},xuan:{'330100':{active:true,note:''}},xi:{}});
  assert.equal(recordsForView(layers,'xuan')['330100'].note,'');
  assert.equal(recordsForView(layers,'xi')['330100'].note,'共同备注');
  layers.xuan['330100'].active=false;
  assert.equal(recordsForView(layers,'xuan')['330100'].note,'共同备注');
});
test('three buttons highlight their category; clicking the current one gives a read-only combined view',async()=>{
  const f=fixture(),token=await f.session();
  await f.write(token,'330100',input());await write(f,token,'xuan','510100',input());await write(f,token,'xi','350200',input());
  await write(f,token,'xuan','320100',input());await write(f,token,'xi','320100',input());
  const w=await openApp(f),d=w.document;
  try{
    assert.equal(d.querySelectorAll('[data-view]').length,3);assert.equal(d.querySelector('#stat-count').textContent,'01');
    assert.equal(d.querySelector('.map-svg [data-city="510100"]').dataset.paintFill,'#e0ece5');
    d.querySelector('[data-view="xuan"]').click();assert.equal(d.querySelector('#stat-count').textContent,'03');
    assert.equal(d.querySelector('.map-svg [data-city="510100"]').dataset.paintFill,'#9ed9c5');
    assert.equal(d.querySelector('.map-svg [data-city="350200"]').dataset.paintFill,'#e6eaf3');
    d.querySelector('[data-view="xuan"]').click();assert.equal(d.querySelector('#stat-count').textContent,'04');assert.match(d.querySelector('#view-status').textContent,/完整视图/);
    assert.equal(d.querySelectorAll('[data-view][aria-pressed="true"]').length,0);
    assert.equal(d.querySelector('.map-svg [data-city="320100"]').dataset.profileCategory,'both');
    tap(w,'330200');assert.equal(d.querySelector('#selection-dock [data-action="edit"]'),null);
    d.querySelector('[data-action="view-records"]').click();assert.equal(d.querySelector('#visit-form'),null);
    assert.match(d.querySelector('.record-list').textContent,/暂无点亮记录/);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('a personal note on an inherited joint city can be saved and undone without modifying the joint record',async()=>{
  const f=fixture(),token=await f.session();await f.write(token,'330100',input({note:'共同备注'}));
  const w=await openApp(f),d=w.document;
  try{
    d.querySelector('[data-view="xuan"]').click();tap(w,'330100');d.querySelector('#selection-dock [data-action="edit"]').click();
    assert.equal(d.querySelector('[name="note"]').value,'共同备注');assert.equal(d.querySelector('[data-remove-current]'),null);
    d.querySelector('[name="note"]').value='个人备注';d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!d.querySelector('.sheet'));
    let state=(await(await f.request('/api/state')).json());assert.equal(state.layers.xuan['330100'].note,'个人备注');assert.equal(state.records['330100'].note,'共同备注');
    d.querySelector('#toast button').click();await until(()=>d.querySelector('#toast').textContent.includes('已撤销'));
    state=(await(await f.request('/api/state')).json());assert.equal(state.layers.xuan['330100'].active,false);assert.equal(state.layers.xuan['330100'].note,'');assert.equal(recordsForView(state.layers,'xuan')['330100'].active,true);
    assert.equal(state.records['330100'].note,'共同备注');
  }finally{await w.happyDOM.abort();f.db.close();}
});

test('search and the read-only city sheet show the right notes across profiles, including external updates', async () => {
  const f = fixture(), token = await f.session();
  await f.write(token, '330100', input({note: '西湖'}));
  await write(f, token, 'xuan', '330100', input({note: '灵隐寺'}));
  await write(f, token, 'xi', '330100', input({note: '南宋御街 <街景>'}));
  await write(f, token, 'xi', '330200', input({active: false, note: '南宋御街'}));
  const w = await openApp(f), d = w.document;
  try {
    d.querySelector('.search-trigger').click();
    typeQuery(w, '南宋');
    assert.equal(d.querySelector('[data-pick]'), null, 'personal notes do not leak into joint search');
    d.querySelector('[data-close]').click();
    d.querySelector('[data-view="together"]').click();
    d.querySelector('[data-action="activity"]').click();
    assert.notEqual(d.activeElement.id, 'city-search', 'browsing lit cities should not bring up the phone keyboard');
    typeQuery(w, '浙江 南宋');
    assert.deepEqual([...d.querySelectorAll('[data-pick]')].map(n => n.dataset.pick), ['330100']);
    assert.match(d.querySelector('.result-note').textContent, /曦宝 · 南宋御街 <街景>/);
    d.querySelector('[data-pick]').click();
    d.querySelector('[data-action="view-records"]').click();
    assert.deepEqual([...d.querySelectorAll('.record-entry p')].map(n => n.textContent), ['西湖','灵隐寺','南宋御街 <街景>']);
    assert.equal(d.querySelector('[data-save], #visit-form'), null);
    await write(f, token, 'xuan', '330100', input({note: '灵隐寺和飞来峰', expectedVersion: 1}));
    w.dispatchEvent(new w.Event('online'));
    await until(() => d.querySelector('.record-list').textContent.includes('飞来峰'));
    d.querySelector('[data-close]').click();
    searchAndSelect(w, '330200');
    d.querySelector('[data-view="xi"]').click();
    assert.match(d.querySelector('#selection-dock').textContent,/已选 2 个地区/);
    d.querySelector('#selection-dock [data-action="edit"]').click();
    assert.match(d.querySelector('#dialog-title').textContent, /点亮 1 个地区/);
    const state = await (await f.request('/api/state')).json();
    assert.equal(state.layers.xi['330200'].active, false);
  } finally { await w.happyDOM.abort(); f.db.close(); }
});
