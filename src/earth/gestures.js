import { anchored, clamp, frame, HOME, MAX_ZOOM, RAD, unproject, wrap } from './camera.js';

export function globeControls(stage, options) {
  const {get, set, size, finish, pick}=options;
  const pointers=new Map();
  let moved=false, wasPinch=false, lastUp=-Infinity, lastMove=0, velocity=[0,0];
  let anim=0, wheelTimer, targetZoom=null;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const point=e=>{const rect=stage.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top];};
  const stop=()=>{cancelAnimationFrame(anim);anim=0;targetZoom=null;clearTimeout(wheelTimer);};
  const currentFrame=()=>frame(get(),...size());
  function zoomAt(view, amount, before, after=before) {
    const dims=size(), anchor=unproject(...before,frame(view,...dims));
    return anchored({...view,zoom:clamp(view.zoom*amount,1,MAX_ZOOM)},anchor,after,...dims);
  }
  function animate(end,duration=190){
    stop();
    const start={...get()}, time=performance.now();
    if(reduced()){set(end);finish();return;}
    targetZoom=end.zoom;
    function tick(now){
      const t=clamp((now-time)/duration,0,1), ease=1-(1-t)**3;
      set({lon:wrap(start.lon+wrap(end.lon-start.lon)*ease),lat:start.lat+(end.lat-start.lat)*ease,
        zoom:start.zoom*(end.zoom/start.zoom)**ease});
      if(t<1)anim=requestAnimationFrame(tick);
      else{anim=0;targetZoom=null;finish();}
    }
    anim=requestAnimationFrame(tick);
  }
  function step(factor) {
    const zoom=clamp((targetZoom??get().zoom)*factor,1,MAX_ZOOM);
    animate({...get(),zoom});
  }
  function coast(){
    let last=performance.now(),elapsed=0;
    function tick(now){
      const dt=Math.min(32,Math.max(1,now-last));last=now;elapsed+=dt;
      const decay=Math.exp(-dt/90), v=get();
      velocity=velocity.map(x=>x*decay);
      set({...v,lon:wrap(v.lon+velocity[0]*dt),lat:clamp(v.lat+velocity[1]*dt,-89.999,89.999)});
      if(elapsed<260 && Math.hypot(...velocity)*currentFrame().radius*RAD>.025)anim=requestAnimationFrame(tick);
      else{anim=0;finish();}
    }
    anim=requestAnimationFrame(tick);
  }
  stage.addEventListener('pointerdown',e=>{
    if(e.button>0)return;
    stop();
    if(!pointers.size){moved=false;wasPinch=false;velocity=[0,0];lastMove=performance.now();}
    const p=point(e);
    pointers.set(e.pointerId,{p,start:p,target:e.target});
    if(pointers.size>1){wasPinch=true;moved=true;}
    try{stage.setPointerCapture(e.pointerId);}catch{}
  });
  stage.addEventListener('pointermove',e=>{
    const entry=pointers.get(e.pointerId);if(!entry)return;
    const current=point(e), prev=entry.p;
    if(!moved && Math.hypot(current[0]-entry.start[0],current[1]-entry.start[1])<5)return;
    moved=true;
    const other=[...pointers.values()].find(p=>p!==entry), v=get(), f=currentFrame();
    let next;
    if(other){
      const mid=p=>p.map((n,i)=>(n+other.p[i])/2);
      const distance=p=>Math.hypot(p[0]-other.p[0],p[1]-other.p[1]);
      next=zoomAt(v,distance(current)/Math.max(2,distance(prev)),mid(prev),mid(current));
      velocity=[0,0];
    }else{
      const anchor=unproject(...prev,f);
      if(anchor && unproject(...current,f)) next=anchored(v,anchor,current,...size());
      else next={...v,lon:wrap(v.lon-(current[0]-prev[0])/(f.radius*RAD*Math.max(.25,Math.cos(v.lat*RAD)))),
        lat:clamp(v.lat+(current[1]-prev[1])/(f.radius*RAD),-89.999,89.999)};
      const dt=clamp(performance.now()-lastMove,8,64), limit=1.4/(RAD*f.radius);
      velocity=[clamp(wrap(next.lon-v.lon)/dt,-limit,limit),clamp((next.lat-v.lat)/dt,-limit,limit)];
    }
    lastMove=performance.now();entry.p=current;set(next);
  });
  function end(e,cancelled=false){
    const entry=pointers.get(e.pointerId);if(!entry)return;
    pointers.delete(e.pointerId);lastUp=performance.now();
    if(pointers.size)return;
    if(!cancelled && !moved)pick(point(e),entry.target);
    if(!cancelled && moved && !wasPinch && !reduced() && performance.now()-lastMove<65 && Math.hypot(...velocity)*currentFrame().radius*RAD>.18)coast();
    else finish();
  }
  stage.addEventListener('pointerup',e=>end(e));
  stage.addEventListener('pointercancel',e=>end(e,true));
  stage.addEventListener('lostpointercapture',e=>end(e,true));
  window.addEventListener('pointerup',e=>end(e));
  window.addEventListener('pointercancel',e=>end(e,true));
  stage.addEventListener('click',e=>{if(performance.now()-lastUp>450)pick(point(e),e.target);});
  stage.addEventListener('wheel',e=>{
    e.preventDefault();stop();
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?size()[1]:1);
    set(zoomAt(get(),Math.exp(-clamp(delta,-250,250)*(e.ctrlKey?.007:.0028)),point(e)));
    wheelTimer=setTimeout(finish,110);
  },{passive:false});
  stage.addEventListener('keydown',e=>{
    const v=get(), d=16/v.zoom;
    if(['+','=','-','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();
      if(e.key==='Home')animate({...HOME});
      else if(['+','=','-'].includes(e.key))step(e.key==='-'?1/1.65:1.65);
      else animate({...v,lon:wrap(v.lon+(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0)),
        lat:clamp(v.lat+(e.key==='ArrowUp'?d:e.key==='ArrowDown'?-d:0),-89.999,89.999)});
    }
  });
  return {stop,step,reset:()=>animate({...HOME},240)};
}
