import {test} from 'node:test';
import assert from 'node:assert/strict';
import {globeControls} from '../src/earth/gestures.js';
import {frame, HOME, project, unit, unproject, wrap} from '../src/earth/camera.js';

function replay(move, reduce=false, initial=HOME) {
  const saved=Object.fromEntries(['window','document','matchMedia'].map(k=>[k,globalThis[k]]));
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();
  globalThis.matchMedia=()=>({matches:reduce});
  let view={...initial},t=1000,solves=0,bounds=0,picks=0;
  const stage=new EventTarget(), dims=[402,406];
  stage.getBoundingClientRect=()=>{bounds++;return {left:0,top:0};};
  const controls=globeControls(stage,{get:()=>view,set:v=>{view=v;solves++;},size:()=>dims,now:()=>t,
    request(){},finish(){},pick(){picks++;}});
  const touch=(type,id,x,y)=>{
    const e=Object.assign(new Event(type),{pointerId:id,clientX:x,clientY:y,button:0});
    stage.dispatchEvent(e);
  };
  try{
    return move({touch,controls,step:ms=>{t+=ms;return controls.advance(t);},time:ms=>{t+=ms;},
      stats:()=>({view,solves,bounds,picks})});
  }finally{
    controls.stop();
    for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
  }
}

test('two fingers are sampled once per display frame, regardless of delivery order; the surviving finger keeps its anchor',()=>{
  const run=reverse=>replay(({touch,controls,step,time,stats})=>{
    touch('pointerdown',1,161,203);touch('pointerdown',2,241,203);
    for(let i=1;i<=12;i++){
      time(8.33);
      const points=[[1,161-i*2,203+i],[2,241+i*4,203+i]];
      for(const p of reverse?points.reverse():points)touch('pointermove',...p);
      assert.equal(stats().solves,i-1);
      step(0);
    }
    const v=stats().view, mid=[213,215];
    const p=project(unit(HOME.lon,HOME.lat),frame(v,402,406));
    assert.ok(Math.hypot(p[0]-mid[0],p[1]-mid[1])<.001);
    touch('pointerup',2,289,215);
    const grabbed=unproject(137,215,frame(stats().view,402,406));
    touch('pointermove',1,148,218);step(8.33);
    const q=project(unit(...grabbed),frame(stats().view,402,406));
    assert.ok(Math.hypot(q[0]-148,q[1]-218)<.001);
    touch('pointercancel',1,148,218);
    assert.equal(controls.interacting,false);assert.equal(stats().picks,0);assert.equal(stats().bounds,1);
    return stats().view;
  },true);
  assert.deepEqual(run(false),run(true));
});

test('coast distance is independent of 60/120 Hz and a new touch stops it immediately',()=>{
  function run(rate, interrupt=false){
    return replay(({touch,step,time,stats})=>{
      touch('pointerdown',1,160,201);
      for(let i=1;i<=8;i++){time(12);touch('pointermove',1,160+i*5,201);step(0);}
      touch('pointerup',1,200,201);
      const start=stats().view.lon;
      for(let i=0;i<300;i++){
        const again=step(1000/rate);
        if(interrupt && i===3){
          const held=stats().view.lon;
          touch('pointerdown',3,200,201);step(80);assert.equal(stats().view.lon,held);
          touch('pointercancel',3,200,201);return;
        }
        if(!again)break;
      }
      assert.ok(Math.abs(wrap(stats().view.lon-start))>1);
      return stats().view.lon;
    });
  }
  assert.ok(Math.abs(wrap(run(60)-run(120)))<.04);
  run(120,true);
});

test('slow rim drags and reversals cannot flip hemispheres at the north-up pole constraint',()=>{
  for(const [lat,x,y,dir] of [[35,-.8,-.55,1],[-35,-.8,.55,1],[-15,.85,-.05,1],[84,.6,.45,-1],[-84,.6,-.45,-1]]){
    replay(({touch,step,time,stats})=>{
      const radius=frame(stats().view,402,406).radius;
      const px=201+x*radius, py=203+y*radius;
      const point=i=>[px+dir*i,py+dir*.13*i];
      touch('pointerdown',1,...point(0));
      let last=stats().view;
      for(const i of [...Array.from({length:70},(_,i)=>i+1),...Array.from({length:55},(_,i)=>69-i)]){
        time(9);touch('pointermove',1,...point(i));step(0);
        const v=stats().view,turn=Math.hypot(wrap(v.lon-last.lon),v.lat-last.lat);
        // The first sample also consumes the four-pixel tap dead zone.
        assert.ok(turn<(i===4?8:2.1),'one slow sample moved the camera '+turn+' degrees');
        assert.ok(Math.abs(v.lat)<=89.999);last=v;
      }
      touch('pointerup',1,...point(15));
      assert.equal(stats().picks,0);
    },true,{lon:179.7,lat,zoom:1});
  }
});
