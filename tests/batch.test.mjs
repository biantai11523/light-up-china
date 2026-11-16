import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,input } from './helpers.mjs';
const rows=ids=>ids.map(id=>({id,...input({date:'',note:'统一备注'})}));
const send=(f,token,updates)=>f.request('/api/cities/batch',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({updates})});
test('a batch lights several cities with one note and can be undone as one batch',async()=>{
  const f=fixture(),token=await f.session(),updates=rows(['330100','330200','510100']);
  try{
    const response=await send(f,token,updates);assert.equal(response.status,200);
    const result=await response.json();assert.equal(Object.keys(result.records).length,3);
    const state=await(await f.request('/api/state')).json();assert.equal(state.activity.length,3);
    for(const row of updates){assert.equal(state.records[row.id].active,true);assert.equal(state.records[row.id].date,'');assert.equal(state.records[row.id].note,'统一备注');}
    const undo=updates.map(row=>({...row,active:false,expectedVersion:1,operationId:crypto.randomUUID()}));
    assert.equal((await send(f,token,undo)).status,200);
    assert.ok(Object.values((await(await f.request('/api/state')).json()).records).every(r=>!r.active&&r.version===2));
  }finally{f.db.close();}
});
test('one stale city prevents all changes and all history from a batch',async()=>{
  const f=fixture(),token=await f.session();
  try{
    await f.write(token,'330100',input({note:'其他人的备注'}));
    const response=await send(f,token,rows(['330200','330100','510100']));assert.equal(response.status,409);
    assert.deepEqual((await response.json()).conflicts,['330100']);
    const state=await(await f.request('/api/state')).json();assert.deepEqual(Object.keys(state.records),['330100']);assert.equal(state.records['330100'].note,'其他人的备注');assert.equal(state.activity.length,1);
  }finally{f.db.close();}
});
test('retrying a completed batch does not duplicate history or overwrite newer notes',async()=>{
  const f=fixture(),token=await f.session(),updates=rows(['330100','330200']);
  try{
    await send(f,token,updates);await f.write(token,'330100',input({expectedVersion:1,note:'较新的备注'}));
    const response=await send(f,token,updates);assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.idempotent,true);assert.equal(result.records['330100'].version,1);assert.equal(result.current['330100'].version,2);assert.equal(result.current['330100'].note,'较新的备注');
    assert.equal((await(await f.request('/api/state')).json()).activity.length,3);
  }finally{f.db.close();}
});
test('a full 370-region batch commits all rows despite per-request limits',async()=>{
  const f=fixture(),token=await f.session();
  try{
    const updates=rows(f.map.cities.map(c=>c.id));
    const response=await send(f,token,updates);assert.equal(response.status,200);
    assert.equal(Object.keys((await response.json()).records).length,370);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM visits WHERE active=1').get().n,370);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM activity').get().n,370);
  }finally{f.db.close();}
});
test('invalid, duplicate, unauthenticated and overlapping operation batches leave data untouched',async()=>{
  const f=fixture(),token=await f.session();
  try{
    const update=rows(['330100'])[0];
    for(const updates of [[],[update,update],rows(['330100','999999']),[{...update,note:'x'.repeat(241)}]])assert.equal((await send(f,token,updates)).status,400);
    assert.equal((await send(f,'invalid',[update])).status,401);
    assert.deepEqual((await(await f.request('/api/state')).json()).records,{});
    await send(f,token,[update]);
    assert.equal((await send(f,token,[update,...rows(['330200'])])).status,400);
    assert.equal(Object.keys((await(await f.request('/api/state')).json()).records).length,1);
  }finally{f.db.close();}
});
