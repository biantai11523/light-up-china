import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodePacket,batchOverview} from '../src/earth/mesh.js';
import {frame,HOME} from '../src/earth/camera.js';
import {globeGPU} from '../src/earth/webgl.js';

test('every detail packet matches its published hash and every region has drawable land at full detail',()=>{
  const raw=JSON.parse(readFileSync('public/data/earth/atlas.json'));
  const covered=new Set();
  for(const [key,file] of Object.entries(raw.detail)){
    const bytes=readFileSync('public/data/earth/'+file);
    const hash=createHash('sha256').update(bytes).digest('hex').slice(0,10);
    assert.equal(file,key+'-'+hash+'.orb');
    const [tile]=decodePacket(bytes,raw.regions.length,raw.provinces.length);
    assert.equal(tile.key,Number(key));
    for(let i=0;i<tile.faces.length-tile.ground;i+=3)covered.add(tile.points[4*tile.faces[i]+3]);
    assert.ok(tile.edges.every(i=>i<tile.points.length/4));
  }
  assert.equal(covered.size,raw.regions.length);
});

test('rotation reuses the whole-world GPU buffers and palette across animation frames',()=>{
  const raw=JSON.parse(readFileSync('public/data/earth/atlas.json'));
  const tiles=decodePacket(readFileSync('public/data/earth/'+raw.base),raw.regions.length,raw.provinces.length);
  const whole=batchOverview(tiles);
  assert.equal(whole.points.length,tiles.reduce((n,t)=>n+t.points.length,0));
  assert.equal(whole.faces.length,tiles.reduce((n,t)=>n+t.faces.length,0));
  for(const array of [whole.faces,whole.edges])assert.ok(array.every(i=>i<whole.points.length/4));
  let buffers=0,draws=0,textures=0;
  const gl=new Proxy({}, {get(_,key){
    if(key.toUpperCase()===key)return 1;
    if(key==='bufferData')return ()=>buffers++;
    if(key==='texImage2D')return ()=>textures++;
    if(key==='drawElements'||key==='drawArrays')return ()=>draws++;
    return ()=>true;
  }});
  globalThis.window={devicePixelRatio:2};
  try{
    const renderer=globeGPU({getContext:()=>gl},raw.regions.length);
    renderer.palette(new Uint8Array(256*Math.ceil(raw.regions.length/256)*4));
    renderer.draw(frame(HOME,390,390),[whole]);
    const uploaded=buffers;
    for(let lon=-180;lon<180;lon+=4){
      draws=0;
      renderer.draw(frame({...HOME,lon},390,390),[whole]);
      assert.ok(draws<=4);
    }
    assert.equal(buffers,uploaded);assert.equal(textures,1);
  }finally{delete globalThis.window;}
});
