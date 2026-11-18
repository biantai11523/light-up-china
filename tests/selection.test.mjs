import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,input } from './helpers.mjs';
import { openApp,until,searchAndSelect } from './ui-harness.mjs';
function tap(w,id){w.document.querySelector(`.map-svg [data-city="${id}"]`).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));}
function submit(w){w.document.querySelector('#visit-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
test('direct map taps toggle multiple cities and use the original light button and form',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{
    assert.equal(d.querySelector('[data-action="batch"]'),null);
    tap(w,'330100');tap(w,'510100');tap(w,'330200');tap(w,'330200');
    assert.equal(d.querySelectorAll('.map-svg .city-shape.is-selected').length,2);
    assert.match(d.querySelector('#selection-dock').textContent,/已选 2 个城市/);
    assert.equal(d.querySelector('#stat-count').textContent,'00');
    assert.equal(d.querySelector('.sheet'),null);
    d.querySelector('#selection-dock [data-action="edit"]').click();
    assert.equal(d.querySelector('#dialog-title').textContent,'点亮 2 个城市');
    assert.ok(d.querySelector('#visit-form'));assert.equal(d.querySelector('[name="date"]'),null);
    d.querySelector('[name="note"]').value='同一趟行程';submit(w);
    await until(()=>d.querySelector('#stat-count').textContent==='02');
    const state=await(await f.request('/api/state')).json();
    for(const id of ['330100','510100']){assert.equal(state.records[id].note,'同一趟行程');assert.equal(state.records[id].date,'');}
    assert.equal(state.records['330200'],undefined);
    const second=await openApp(f);assert.equal(second.document.querySelector('#stat-count').textContent,'02');await second.happyDOM.abort();
    d.querySelector('#toast button').click();await until(()=>d.querySelector('#stat-count').textContent==='00');
    d.querySelector('[data-action="deselect"]').click();assert.equal(d.querySelectorAll('.map-svg .is-selected').length,0);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('search adds a city without clearing map selections or toggling it off on a second search',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{
    tap(w,'330100');
    for(let i=0;i<2;i++)searchAndSelect(w,'510100');
    assert.equal(d.querySelectorAll('.map-svg .city-shape.is-selected').length,2);
    assert.ok(d.querySelector('.map-svg [data-city="330100"]').classList.contains('is-selected'));
    tap(w,'510100');assert.match(d.querySelector('#selection-dock').textContent,/杭州市/);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('mixed selections skip lit cities and a conflicting save preserves everyone else notes',async()=>{
  const f=fixture(),token=await f.session();await f.write(token,'330100',input({note:'原有备注'}));
  const w=await openApp(f),d=w.document;
  try{
    for(const id of ['330100','330200','330300'])tap(w,id);
    d.querySelector('#selection-dock [data-action="edit"]').click();
    assert.equal(d.querySelector('#dialog-title').textContent,'点亮 2 个城市');d.querySelector('[name="note"]').value='统一备注';
    await f.write(token,'330200',input({note:'另一位用户的备注'}));submit(w);
    await until(()=>d.querySelector('.form-error')?.textContent.includes('本次未保存'));
    assert.equal(Object.keys((await(await f.request('/api/state')).json()).records).length,2);
    assert.equal(d.querySelector('[name="note"]').value,'统一备注');
    assert.equal(d.querySelector('#dialog-title').textContent,'点亮 1 个城市');
    submit(w);await until(()=>d.querySelector('#stat-count').textContent==='03');
    const state=await(await f.request('/api/state')).json();assert.equal(state.records['330100'].note,'原有备注');assert.equal(state.records['330200'].note,'另一位用户的备注');assert.equal(state.records['330300'].note,'统一备注');
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('lost-response retry preserves direct selections and reuses operation IDs',async()=>{
  const f=fixture();const sent=[];
  const w=await openApp(f,{configure(w){
    const fetch=w.fetch;
    w.fetch=async(url,options)=>{
      const response=await fetch(url,options);
      if(String(url).endsWith('/api/cities/batch')){
        sent.push(JSON.parse(options.body));
        if(sent.length===1)throw new TypeError('连接中断');
        if(sent.length===2){
          const result=await response.json();
          delete result.records['330200'];
          return Response.json(result);
        }
      }
      return response;
    };
  }}),d=w.document;
  try{
    tap(w,'330100');tap(w,'330200');d.querySelector('#selection-dock [data-action="edit"]').click();d.querySelector('[name="note"]').value='保留内容';submit(w);
    await until(()=>d.querySelector('.form-error')?.textContent.includes('可重试'));assert.equal(d.querySelector('[name="note"]').value,'保留内容');
    assert.equal(d.querySelectorAll('.map-svg .city-shape.is-selected').length,2);
    submit(w);await until(()=>d.querySelector('.form-error')?.textContent.includes('未收到全部城市'));
    assert.equal(d.querySelector('#stat-count').textContent,'00');
    submit(w);await until(()=>d.querySelector('#stat-count').textContent==='02');
    assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[1],sent[2]);
    assert.equal((await(await f.request('/api/state')).json()).activity.length,2);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('single-city editing still preserves a hidden historical date',async()=>{
  const f=fixture(),token=await f.session();await f.write(token,'330100',input({date:'2024-03-01',note:'旧备注'}));
  const w=await openApp(f),d=w.document;
  try{
    tap(w,'330100');d.querySelector('#selection-dock [data-action="edit"]').click();assert.equal(d.querySelector('[name="date"]'),null);
    d.querySelector('[name="note"]').value='更新备注';submit(w);await until(()=>!d.querySelector('.sheet'));
    const record=(await(await f.request('/api/state')).json()).records['330100'];assert.equal(record.date,'2024-03-01');assert.equal(record.note,'更新备注');
    assert.ok(d.querySelector('.map-bottom-actions [data-action="export-map"]'));
  }finally{await w.happyDOM.abort();f.db.close();}
});
