import { meshLayout } from '../src/earth/boundaries.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.mjs';
import { openApp, searchAndSelect, until, worldAtlas } from './ui-harness.mjs';
import { frame, HOME, project, unit, unproject, wrap } from '../src/earth/camera.js';
import { decodePacket, contains } from '../src/earth/mesh.js';
import { catalog } from '../src/earth/atlas.js';
import { labelsFor } from '../src/earth/drawing.js';

test('front-side geographic coordinates round-trip across the date line and near both poles',()=>{
  for(const [lon,lat,zoom] of [[179,0,1],[-179,70,1.2],[80,89,20],[-120,-87,8],[113.57,22.16,570]]){
    const f=frame({lon,lat,zoom},390,390);
    for(const [x,y] of [[195,195],[185,180],[240,215]]){
      const ll=unproject(x,y,f),p=project(unit(...ll),f);
      assert.ok(p[2]>0 && Math.hypot(p[0]-x,p[1]-y)<1e-6);
    }
    assert.ok(project(unit(wrap(lon+180),-lat),f)[2]<0);
  }
  assert.equal(unproject(0,0,frame(HOME,390,390)),null);
});

test('all writable regions have a real mesh, with precise land anchors for Macau, Monaco and Vatican City',()=>{
  const load=file=>decodePacket(readFileSync('public/data/earth/'+file),meshLayout(worldAtlas));
  const shapes=load(worldAtlas.base).flatMap(t=>t.shapes.filter(s=>s.level===0));
  assert.equal(new Set(shapes.map(s=>s.idx)).size,worldAtlas.regions.length);
  for(const id of ['820000','ne-MCO-p00-q','ne-VAT-p00-q']){
    const i=worldAtlas.regions.findIndex(r=>r[0]===id),r=worldAtlas.regions[i];
    const keys=Object.entries(worldAtlas.bounds).filter(([,b])=>r[5]>=b[0] && r[5]<=b[2] && r[6]>=b[1] && r[6]<=b[3]);
    assert.ok(keys.some(([key])=>load(worldAtlas.detail[key])[0].shapes.some(s=>s.idx===i && contains(s,r[5],r[6]))),id);
  }
});

test('unselected Macau is discoverable by zooming into the Pearl River Delta, then its name grows with the globe',()=>{
  const data=catalog(worldAtlas);data.byId=new Map(data.cities.map(c=>[c.id,c]));
  const macau=data.byId.get('820000');
  const at=k=>labelsFor(data,frame({lon:macau.lon,lat:macau.lat,zoom:k},390,390),new Set(),new Map()).find(l=>l.item.id==='820000');
  const nearby=at(12), close=at(600);
  assert.equal(nearby.text,'澳门');assert.equal(nearby.pin,true);
  assert.equal(close.item.type,'region');assert.ok(close.size>nearby.size);assert.equal(close.pin,false);
});

test('pointer drags coalesce and rotate without a ghost tap; pinch scales continuously without selecting',async()=>{
  const f=fixture(),frames=new Map();let handle=0;
  const w=await openApp(f,{configure(w){
    w.requestAnimationFrame=fn=>{frames.set(++handle,fn);return handle;};
    w.cancelAnimationFrame=id=>frames.delete(id);
    w.matchMedia=()=>({matches:true});
  }}),d=w.document,stage=d.querySelector('.map-stage');
  try{
    const present=()=>{
      const scheduled=[...frames.values()];frames.clear();
      for(const paint of scheduled)paint(w.performance.now()+40);
    };
    const dispatch=(type,id,x,y)=>stage.dispatchEvent(new w.PointerEvent(type,{pointerId:id,clientX:x,clientY:y,bubbles:true,button:0}));
    const read=()=>d.querySelector('.earth-readout').textContent;
    const before=read();
    dispatch('pointerdown',1,170,180);
    for(let i=1;i<=20;i++)dispatch('pointermove',1,170+i*2,180+i);
    assert.equal(frames.size,1);assert.equal(read(),before);
    dispatch('pointerup',1,210,200);
    present();
    assert.notEqual(read(),before);
    stage.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:210,clientY:200}));
    assert.equal(d.querySelector('#selection-dock').hidden,true);
    const radius=()=>+d.querySelector('.earth-surface circle').getAttribute('r');
    const initial=radius();
    dispatch('pointerdown',2,145,180);dispatch('pointerdown',3,245,180);
    dispatch('pointermove',2,130,180);dispatch('pointermove',3,260,180);
    dispatch('pointerup',2,130,180);dispatch('pointerup',3,260,180);
    present();
    assert.ok(Math.abs(radius()/initial-1.3)<.001);
    assert.equal(d.querySelector('#selection-dock').hidden,true);
  }finally{await w.happyDOM.abort();f.db.close();}
});

test('search focuses the real Macau shape, labels it, and tapping inside toggles the existing selection',async()=>{
  const f=fixture(),w=await openApp(f),d=w.document;
  try{
    searchAndSelect(w,'820000');
    const stage=d.querySelector('.map-stage'), svg=d.querySelector('.map-svg');
    const [, ,width,height]=svg.getAttribute('viewBox').split(' ').map(Number);
    assert.ok(+svg.querySelector('.earth-surface circle').getAttribute('r')>width*100);
    assert.match(svg.querySelector('[data-label-region="820000"]').textContent,/澳门/);
    await until(()=>svg.querySelector('.earth-surface [data-city="820000"]'));
    const region=catalog(worldAtlas).cities.find(c=>c.id==='820000');
    const f=frame({lon:region.focusLon,lat:region.focusLat,zoom:1.4/(Math.PI/180*region.focusSpan)},width,height);
    const [x,y]=project(region.v,f);
    stage.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:x,clientY:y}));
    assert.equal(d.querySelector('#selection-dock').hidden,true);
    stage.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:x,clientY:y}));
    assert.match(d.querySelector('#selection-dock').textContent,/澳门/);
  }finally{await w.happyDOM.abort();f.db.close();}
});
