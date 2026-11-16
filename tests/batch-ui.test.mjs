import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,input } from './helpers.mjs';
import { openApp,until } from './ui-harness.mjs';
function choose(w,id){const box=w.document.querySelector(`[data-batch-city="${id}"]`);box.checked=true;box.dispatchEvent(new w.Event('change',{bubbles:true}));}
function submit(w){w.document.querySelector('#batch-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
test('batch selection persists across searches and saves notes once for all chosen cities',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{
    d.querySelector('[data-action="batch"]').click();choose(w,'330100');
    const search=d.querySelector('#batch-search');search.value='成都';search.dispatchEvent(new w.Event('input'));choose(w,'510100');
    assert.match(d.querySelector('[data-batch-count]').textContent,/2/);
    d.querySelector('[data-batch-next]').click();assert.equal(d.querySelector('input[type="date"]'),null);
    d.querySelector('[name="note"]').value='同一趟行程';submit(w);
    await until(()=>d.querySelector('#stat-count').textContent==='02');
    const state=await(await f.request('/api/state')).json();
    for(const id of ['330100','510100']){assert.equal(state.records[id].note,'同一趟行程');assert.equal(state.records[id].date,'');assert.equal(state.records[id].version,1);}
    const second=await openApp(f);assert.equal(second.document.querySelector('#stat-count').textContent,'02');await second.happyDOM.abort();
    d.querySelector('#toast button').click();await until(()=>d.querySelector('#stat-count').textContent==='00');
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('province select-all skips lit cities; conflicting batch is retried without replacing others notes',async()=>{
  const f=fixture(),token=await f.session();await f.write(token,'330100',input({note:'原有备注'}));
  const w=await openApp(f),d=w.document;
  try{
    d.querySelector('[data-action="batch"]').click();const province=d.querySelector('.province-select');province.value='330000';province.dispatchEvent(new w.Event('change'));
    d.querySelector('[data-batch-select-all]').click();assert.match(d.querySelector('[data-batch-count]').textContent,/10/);assert.equal(d.querySelector('[data-batch-city="330100"]').disabled,true);
    d.querySelector('[data-batch-next]').click();d.querySelector('[name="note"]').value='批量备注';
    await f.write(token,'330200',input({note:'另一位用户的备注'}));submit(w);
    await until(()=>d.querySelector('.form-error')?.textContent.includes('本批次未保存'));
    assert.equal(Object.keys((await(await f.request('/api/state')).json()).records).length,2);
    assert.match(d.querySelector('[data-batch-heading]').textContent,/9/);assert.equal(d.querySelector('[name="note"]').value,'批量备注');
    submit(w);await until(()=>d.querySelector('#stat-count').textContent==='11');
    const state=await(await f.request('/api/state')).json();assert.equal(state.records['330100'].note,'原有备注');assert.equal(state.records['330200'].note,'另一位用户的备注');
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('lost-response retry keeps the same operation IDs and does not duplicate the batch',async()=>{
  const f=fixture();const sent=[];let loseResponse=true;
  const w=await openApp(f,{configure(w){const fetch=w.fetch;w.fetch=async(url,options)=>{const response=await fetch(url,options);if(String(url).endsWith('/api/cities/batch')){sent.push(JSON.parse(options.body));if(loseResponse){loseResponse=false;throw new TypeError('连接中断');}}return response;};}}),d=w.document;
  try{
    d.querySelector('[data-action="batch"]').click();choose(w,'330100');choose(w,'330200');d.querySelector('[data-batch-next]').click();d.querySelector('[name="note"]').value='保留内容';submit(w);
    await until(()=>d.querySelector('.form-error')?.textContent.includes('可重试'));assert.equal(d.querySelector('[name="note"]').value,'保留内容');
    submit(w);await until(()=>d.querySelector('#stat-count').textContent==='02');assert.deepEqual(sent[0],sent[1]);assert.equal((await(await f.request('/api/state')).json()).activity.length,2);
  }finally{await w.happyDOM.abort();f.db.close();}
});
test('removing the date control preserves an older stored date while updating a note',async()=>{
  const f=fixture(),token=await f.session();await f.write(token,'330100',input({date:'2024-03-01',note:'旧备注'}));
  const w=await openApp(f),d=w.document;
  try{
    d.querySelector('.map-svg [data-city="330100"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    assert.ok(!d.querySelector('#city-panel').textContent.includes('2024-03-01'));
    d.querySelector('#selection-dock [data-action="edit"]').click();assert.equal(d.querySelector('[name="date"]'),null);
    d.querySelector('[name="note"]').value='更新备注';d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!d.querySelector('.sheet'));
    const record=(await(await f.request('/api/state')).json()).records['330100'];assert.equal(record.date,'2024-03-01');assert.equal(record.note,'更新备注');
    assert.equal(d.querySelector('.map-top [data-action="export-map"]'),null);assert.ok(d.querySelector('.map-bottom-actions [data-action="export-map"]'));
  }finally{await w.happyDOM.abort();f.db.close();}
});
