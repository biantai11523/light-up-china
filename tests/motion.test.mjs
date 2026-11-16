import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameUpdates,simplifyMapPath } from '../src/motion.js';
test('a burst of move events paints once per frame and always reaches the final position',()=>{
  const callbacks=new Map(),painted=[];let nextId=0;
  const frames=frameUpdates(value=>painted.push(value),callback=>{const id=++nextId;callbacks.set(id,callback);return id;},id=>callbacks.delete(id));
  for(let x=0;x<1000;x++)frames.queue({x,y:x*2});
  assert.equal(callbacks.size,1);assert.equal(painted.length,0);
  [...callbacks.values()][0]();assert.deepEqual(painted,[{x:999,y:1998}]);
  frames.queue({x:1200,y:2400});frames.flush();assert.equal(callbacks.size,0);assert.equal(painted.at(-1).x,1200);
  frames.queue({x:1500,y:3000});frames.cancel();assert.equal(callbacks.size,0);assert.equal(painted.length,2);
});
test('moving geometry retains every ring and small island while reducing vertex count',()=>{
  const data=JSON.parse(readFileSync('public/data/china.json','utf8'));
  let original=0,reduced=0;
  for(const region of [...data.cities,...data.provinces]){
    const path=simplifyMapPath(region.path,.2);
    assert.equal((path.match(/M/g)||[]).length,(region.path.match(/M/g)||[]).length);
    assert.equal((path.match(/Z/g)||[]).length,(region.path.match(/Z/g)||[]).length);
    assert.ok(!/NaN|Infinity/.test(path));
    original+=(region.path.match(/[ML]/g)||[]).length;reduced+=(path.match(/[ML]/g)||[]).length;
  }
  assert.ok(reduced<original*.45);
  const island='M0,0L.1,0L.1,.1L0,.1Z';assert.equal(simplifyMapPath(island,.2),island);
});
