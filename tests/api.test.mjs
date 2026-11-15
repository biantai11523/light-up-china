import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,input } from './helpers.mjs';
test('two independent visitors see the same persisted city and can undo',async()=>{
 const f=fixture(),a=await f.session(),b=await f.session();
 assert.notEqual(a,b);
 let response=await f.write(a,'330100',input());assert.equal(response.status,200);
 let state=await(await f.request('/api/state')).json();assert.equal(state.records['330100'].active,true);assert.equal(state.activity.length,1);
 response=await f.write(b,'330100',input({active:false,expectedVersion:1}));assert.equal(response.status,200);
 state=await(await f.request('/api/state')).json();assert.equal(state.records['330100'].active,false);assert.equal(state.records['330100'].version,2);assert.equal(state.activity.length,2);
 f.db.close();
});
test('concurrent changes to different cities both persist',async()=>{
 const f=fixture(),token=await f.session();const responses=await Promise.all([f.write(token,'330100',input()),f.write(token,'510100',input())]);
 assert.deepEqual(responses.map(r=>r.status),[200,200]);const state=await(await f.request('/api/state')).json();assert.equal(Object.keys(state.records).length,2);f.db.close();
});
test('concurrent changes to the same city reject the stale version',async()=>{
 const f=fixture(),token=await f.session();const responses=await Promise.all([f.write(token,'330100',input({note:'A'})),f.write(token,'330100',input({note:'B'}))]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const conflict=await responses.find(r=>r.status===409).json();assert.equal(conflict.current.version,1);
 const state=await(await f.request('/api/state')).json();assert.equal(state.activity.length,1);f.db.close();
});
test('network retries are idempotent, including after another visitor edits',async()=>{
 const f=fixture(),token=await f.session(),op=input();await f.write(token,'330100',op);let retry=await(await f.write(token,'330100',op)).json();assert.equal(retry.idempotent,true);assert.equal(retry.record.version,1);
 await f.write(token,'330100',input({note:'新记忆',expectedVersion:1}));retry=await(await f.write(token,'330100',op)).json();assert.equal(retry.record.version,1);assert.equal(retry.current.version,2);assert.equal(retry.current.note,'新记忆');
 const undo=await f.write(token,'330100',input({active:false,expectedVersion:retry.record.version}));assert.equal(undo.status,409);
 const state=await(await f.request('/api/state')).json();assert.equal(state.activity.length,2);f.db.close();
});
test('writes require an allowed origin and a valid anonymous session',async()=>{
 const f=fixture();let r=await f.write('bad','330100',input());assert.equal(r.status,401);
 r=await f.request('/api/session',{method:'POST',headers:{Origin:'https://unrelated.example'}});assert.equal(r.status,403);
 r=await f.request('/api/state',{method:'OPTIONS'});assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://biantai11523.github.io');f.db.close();
});
test('invalid city, oversized notes, impossible dates, empty names are rejected',async()=>{
 const f=fixture(),token=await f.session();assert.equal((await f.write(token,'999999',input())).status,400);
 for(const bad of [{note:'x'.repeat(241)},{date:'2025-02-30'},{author:' '},{expectedVersion:-1},{active:'true'}])assert.equal((await f.write(token,'330100',input(bad))).status,400);
 assert.equal(Object.keys((await(await f.request('/api/state')).json()).records).length,0);f.db.close();
});
test('per-visitor write limits return 429 without corrupting records',async()=>{
 const f=fixture(),token=await f.session();f.db.exec("UPDATE rate_limits SET count=1000 WHERE id LIKE 'session:%'");
 assert.equal((await f.request('/api/session',{method:'POST'})).status,429);f.db.close();
});
