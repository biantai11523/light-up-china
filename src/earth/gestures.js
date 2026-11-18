import { anchored, clamp, frame, HOME, MAX_ZOOM, RAD, unproject, wrap } from './camera.js';

const TAP_SLOP = 4;
const COAST_TIME = 145;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Near the limb a north-up inverse can demand tens of degrees of spin for
// one pixel of input. Ease that gain only in the ill-conditioned part; include
// the radial displacement of a pinch as well as midpoint translation.
function limitRimTurn(previous, next, from, to, dims) {
  const r = .46 * Math.min(...dims);
  const delta = d => (to[d]-dims[d]/2)/(r*next.zoom) - (from[d]-dims[d]/2)/(r*previous.zoom);
  const travel = Math.hypot(delta(0),delta(1))/RAD;
  const yaw = wrap(next.lon-previous.lon), pitch = next.lat-previous.lat;
  const turn = Math.hypot(yaw,pitch);
  if(turn<=4*travel+1e-8)return next;
  const gain = travel ? 4-2*Math.expm1(-(turn/travel-4)/2) : 0;
  const fraction = gain*travel/turn;
  return {...next,lon:wrap(previous.lon+yaw*fraction),lat:previous.lat+pitch*fraction};
}

// Event handlers collect positions. advance() is called by the renderer's ONE
// animation clock, so two finger samples describe one pinch and one displayed pose.
export function globeControls(stage, {get,set,size,request,finish,pick,now:clock=()=>performance.now()}) {
  const fingers = new Map();
  let origin, grip, dirty=false, moved=false, lastUp=-Infinity, lastSample=0;
  let animation=null, wheel=null, wheelTimer, velocity=null, lastApplied=0;
  const readOrigin = () => { const r=stage.getBoundingClientRect(); origin=[r.left,r.top]; };
  const local = e => [e.clientX-origin[0], e.clientY-origin[1]];
  function stop() {
    animation=null; wheel=null; clearTimeout(wheelTimer);wheelTimer=null;
    fingers.clear(); dirty=false; grip=null; velocity=null;
  }
  function contacts() {
    const iterator=fingers.values(), a=iterator.next().value.p, b=iterator.next().value?.p;
    if (!b) return {mid:a, distance:0};
    return {mid:[(a[0]+b[0])/2,(a[1]+b[1])/2], distance:Math.max(2,Math.hypot(a[0]-b[0],a[1]-b[1]))};
  }
  function rebase() {
    const {mid,distance}=contacts(), v={...get()};
    grip={view:v,mid,distance,anchor:unproject(...mid,frame(v,...size())), previous:mid};
    dirty=false; velocity=null; lastApplied=clock();
  }
  function orbit(v,from,to) {
    const radius=.46*Math.min(...size())*v.zoom;
    return {...v, lon:wrap(v.lon-(to[0]-from[0])/(radius*RAD*Math.max(.24,Math.cos(v.lat*RAD)))),
      lat:clamp(v.lat+(to[1]-from[1])/(radius*RAD),-89.999,89.999)};
  }
  function consume() {
    if(!dirty || !grip)return;
    dirty=false;
    const {mid,distance}=contacts(), previous=get(), dims=size();
    const zoom=grip.distance ? clamp(grip.view.zoom*distance/grip.distance,1,MAX_ZOOM) : previous.zoom;
    const base={...previous,zoom};
    let next;
    if(grip.anchor && unproject(...mid,frame(base,...dims))) {
      const exact=anchored(base,grip.anchor,mid,...dims);
      next=limitRimTurn(previous,exact,grip.previous,mid,dims);
      const radius=.46*Math.min(...dims)*zoom;
      if(next!==exact || Math.abs(next.lat)>=89.999 || Math.abs(mid[0]-dims[0]/2)>=radius*Math.cos(grip.anchor[1]*RAD)){
        // The north-up constraint has exhausted this grab. Start from what is
        // actually under the finger so reversing direction responds immediately.
        grip.anchor=unproject(...mid,frame(next,...dims));
      }
    } else {
      next=orbit(base,grip.previous,mid);
      // Reacquire a surface anchor after a finger crosses the silhouette.
      grip.anchor=unproject(...mid,frame(next,...dims));
    }
    if(!grip.distance) {
      const dt=clamp(lastSample-lastApplied,4,100), mix=1-Math.exp(-dt/32);
      const v=[wrap(next.lon-previous.lon)/dt,(next.lat-previous.lat)/dt];
      velocity=velocity ? v.map((n,i)=>velocity[i]+mix*(n-velocity[i])) : v;
    }
    grip.previous=mid; lastApplied=lastSample;
    set(next);
  }
  function advance(now) {
    consume();
    if(wheel) {
      const v=get(), dims=size(), f=frame(v,...dims), anchor=unproject(...wheel.point,f);
      const zoomed=anchored({...v,zoom:clamp(v.zoom*Math.exp(wheel.delta),1,MAX_ZOOM)},anchor,wheel.point,...dims);
      set(limitRimTurn(v,zoomed,wheel.point,wheel.point,dims));
      wheel=null;
    }
    if(!animation)return false;
    const a=animation, elapsed=Math.max(0,now-a.time);
    if(a.type==='coast') {
      const decay=Math.exp(-elapsed/COAST_TIME), travel=COAST_TIME*(1-decay);
      set({...a.start,lon:wrap(a.start.lon+a.v[0]*travel),lat:clamp(a.start.lat+a.v[1]*travel,-89.999,89.999)});
      if(a.speed*decay*COAST_TIME>.4 && elapsed<1000)return true;
    } else {
      const t=clamp(elapsed/a.duration,0,1), ease=1-(1-t)**3;
      set({lon:wrap(a.start.lon+wrap(a.end.lon-a.start.lon)*ease),lat:a.start.lat+(a.end.lat-a.start.lat)*ease,
        zoom:a.start.zoom*(a.end.zoom/a.start.zoom)**ease});
      if(t<1)return true;
    }
    animation=null; finish();
    return false;
  }
  function animate(end,duration=190) {
    const start={...get()};
    stop();
    if(reduced()){set(end);finish();return;}
    animation={type:'zoom',time:clock(),start,end,duration};
    request();
  }
  function step(factor) {
    const zoom=clamp((animation?.end?.zoom ?? get().zoom)*factor,1,MAX_ZOOM);
    animate({...get(),zoom});
  }
  function sample(entry,p) {
    if(entry.p[0]===p[0] && entry.p[1]===p[1])return;
    entry.p=p;
    if(!moved && Math.hypot(p[0]-entry.start[0],p[1]-entry.start[1])<TAP_SLOP)return;
    moved=true;dirty=true;lastSample=clock();
  }
  stage.addEventListener('pointerdown',e=>{
    if(e.button>0 || fingers.size>=2 || fingers.has(e.pointerId))return;
    if(!fingers.size){stop();readOrigin();moved=false;}
    else consume();
    const p=local(e);
    fingers.set(e.pointerId,{p,start:p,target:e.target});
    if(fingers.size===2)moved=true;
    rebase();
    try{stage.setPointerCapture(e.pointerId);}catch{}
  },{passive:true});
  stage.addEventListener('pointermove',e=>{
    const entry=fingers.get(e.pointerId);
    if(!entry)return;
    sample(entry,local(e));
    if(dirty)request();
  },{passive:true});
  function end(e,cancelled=false) {
    const entry=fingers.get(e.pointerId);
    if(!entry)return;
    if(!cancelled){sample(entry,local(e));consume();}
    else { moved=true; dirty=false; velocity=null; }
    fingers.delete(e.pointerId);
    lastUp=clock();
    if(fingers.size){rebase();return;}
    if(!cancelled && !moved)pick(entry.p,entry.target);
    const v=get(), radius=.46*Math.min(...size())*v.zoom;
    const speed=velocity ? Math.hypot(velocity[0]*Math.cos(v.lat*RAD),velocity[1])*radius*RAD : 0;
    if(!cancelled && moved && !reduced() && speed>.085 && lastUp-lastSample<75){
      const cap=Math.min(1,2/speed);
      animation={type:'coast',time:lastUp,start:{...v},v:velocity.map(n=>n*cap),speed:speed*cap};
      request();
    }else finish();
    grip=null;velocity=null;
  }
  for(const target of [stage,window]){
    target.addEventListener('pointerup',e=>end(e),{passive:true});
    target.addEventListener('pointercancel',e=>end(e,true),{passive:true});
  }
  stage.addEventListener('lostpointercapture',e=>end(e,true));
  const abandon=()=>{if(fingers.size||animation||wheel){lastUp=clock();stop();finish();}};
  window.addEventListener('blur',abandon);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)abandon();});
  stage.addEventListener('click',e=>{
    if(clock()-lastUp>450){readOrigin();pick(local(e),e.target);}
  });
  stage.addEventListener('wheel',e=>{
    e.preventDefault();
    if(fingers.size)return;
    if(!wheelTimer)readOrigin();
    animation=null;
    const dy=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?size()[1]:1);
    wheel={point:local(e), delta:clamp((wheel?.delta||0)-clamp(dy,-250,250)*(e.ctrlKey?.007:.0028),-1.5,1.5)};
    request();clearTimeout(wheelTimer);
    wheelTimer=setTimeout(()=>{wheelTimer=null;finish();},110);
  },{passive:false});
  stage.addEventListener('keydown',e=>{
    const v=get(),d=16/v.zoom;
    if(!['+','=','-','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();
    if(e.key==='Home')animate({...HOME});
    else if(['+','=','-'].includes(e.key))step(e.key==='-'?1/1.65:1.65);
    else animate({...v,lon:wrap(v.lon+(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0)),
      lat:clamp(v.lat+(e.key==='ArrowUp'?d:e.key==='ArrowDown'?-d:0),-89.999,89.999)});
  });
  return {advance,stop,step,reset:()=>animate({...HOME},240),get interacting(){return !!(fingers.size||animation||wheel);}};
}
