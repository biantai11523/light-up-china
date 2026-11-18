import { meshLayout } from '../src/earth/boundaries.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodePacket,batchOverview} from '../src/earth/mesh.js';
import {frame,HOME} from '../src/earth/camera.js';
import {globeGPU} from '../src/earth/webgl.js';
import {lineStyles} from '../src/earth/boundaries.js';

test('every detail packet matches its published hash and every region has drawable land at full detail',()=>{
  const raw=JSON.parse(readFileSync('public/data/earth/atlas.json'));
  const covered=new Set();
  for(const [key,file] of Object.entries(raw.detail)){
    const bytes=readFileSync('public/data/earth/'+file);
    const hash=createHash('sha256').update(bytes).digest('hex').slice(0,10);
    assert.equal(file,key+'-'+hash+'.orb');
    const [tile]=decodePacket(bytes,meshLayout(raw));
    assert.equal(tile.key,Number(key));
    for(let i=0;i<tile.faces.length-tile.ground;i+=3)covered.add(tile.points[4*tile.faces[i]+3]);
    assert.ok(tile.edges.every(i=>i<tile.points.length/4));
  }
  assert.equal(covered.size,raw.regions.length);
});

test('rotation reuses the whole-world GPU buffers and palette across animation frames',()=>{
  const raw=JSON.parse(readFileSync('public/data/earth/atlas.json'));
  const tiles=decodePacket(readFileSync('public/data/earth/'+raw.base),meshLayout(raw));
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

test('world and country views submit no prefecture strokes or neutral leaf triangles; fine uploads never demote a ready neighbour',()=>{
  const raw=JSON.parse(readFileSync('public/data/earth/atlas.json')),layout=meshLayout(raw);
  const load=f=>decodePacket(readFileSync('public/data/earth/'+f),layout);
  const low=load(raw.base),root=batchOverview(low);
  low.forEach((t,i)=>{t.shared=root;t.slice=root.slices[i];});
  const candidates=low.filter(t=>t.lineCounts[0]>1000).sort((a,b)=>b.faces.length-a.faces.length).slice(0,2);
  const fine=candidates.map(t=>{const [hi]=load(raw.detail[t.key]);hi.fallback=t;return hi;});
  const colors=lineStyles.map(s=>[1,3,5].map(i=>parseInt(s.color.slice(i,i+2),16)/255));
  let mode, ink, uploadBytes=0;
  const lines=[],fills=[];
  const constants={LINES:1,TRIANGLES:4,UNSIGNED_INT:5125,FLOAT:5126};
  const gl=new Proxy(constants,{get(obj,key){
    if(key in obj)return obj[key];
    if(key.toUpperCase()===key)return 2;
    if(key==='getParameter')return ()=>[1,1];
    if(key==='getUniformLocation')return (_,name)=>name;
    if(key==='uniform1f')return (k,v)=>{if(k==='mode')mode=v;};
    if(key==='uniform3fv')return (k,v)=>{if(k==='ink')ink=colors.findIndex(rgb=>rgb.every((x,i)=>x===v[i]));};
    if(key==='drawElements')return (primitive,count)=>{if(primitive===1)lines.push(ink);else if(mode===0)fills.push(count);};
    if(key==='bufferSubData')return (_,offset,bytes)=>{uploadBytes+=bytes.byteLength;};
    return ()=>true;
  }});
  globalThis.window={devicePixelRatio:3};
  try{
    const gpu=globeGPU({getContext:()=>gl},layout.regions),bytes=new Uint8Array(256*Math.ceil(layout.regions/256)*4);
    const pose=z=>frame({lon:112,lat:33,zoom:z},402,406);
    gpu.palette(bytes);gpu.draw(pose(1),[root]);
    assert.deepEqual([...new Set(lines)],[2]);assert.deepEqual(fills,[]);
    bytes[3]=1;gpu.palette(bytes);
    lines.length=0;gpu.draw(pose(4),[root]);
    assert.ok(fills.length);assert.ok(fills.reduce((s,n)=>s+n,0)<root.faces.length*.02);
    assert.ok(lines.includes(1)&&!lines.includes(0));
    function paint(tiles){
      uploadBytes=0;gpu.draw(pose(18),tiles,true);
      assert.ok(uploadBytes<=192*1024);
    }
    for(let i=0;i<220 && gpu.displayed[0]!==fine[0];i++)paint([fine[0]]);
    assert.equal(gpu.displayed[0],fine[0]);
    paint(fine);
    assert.equal(gpu.displayed[0],fine[0]);
    assert.equal(gpu.displayed[1],candidates[1]);
    for(let i=0;i<220 && gpu.displayed[1]!==fine[1];i++)paint(fine);
    assert.equal(gpu.displayed[1],fine[1]);
  }finally{delete globalThis.window;}
});
