import { frame, HOME, MAX_ZOOM, clamp, dot, unproject, RAD } from './camera.js';
import { contains } from './mesh.js';
import { globeGPU } from './webgl.js';
import { globeControls } from './gestures.js';
import { globeDefs } from './drawing.js';
import { prepareWorldMap } from './world-print.js';
import { cityAppearance } from '../profiles.js';
import { glyphLayer, labelTracker } from './label-layer.js';
import { vectorDisplay } from './vector-display.js';

const NS='http://www.w3.org/2000/svg';
export function createGlobe(container,data,onSelect){
  const stage=container.querySelector('.map-stage'), canvas=stage.querySelector('canvas'), svg=stage.querySelector('.map-svg');
  svg.innerHTML='<defs>'+globeDefs+'</defs><g class="earth-surface"></g><g class="earth-labels"></g>';
  const surface=svg.querySelector('.earth-surface'), labels=svg.querySelector('.earth-labels');
  const readout=container.querySelector('.earth-readout'), plus=container.querySelector('[data-map="plus"]'),minus=container.querySelector('[data-map="minus"]');
  data.byId=new Map(data.cities.map(c=>[c.id,c]));
  let view={...HOME}, width=390,height=390, selected=new Set(), paints=new Map();
  let gpu,controls,raf=0,inFrame=false,moving=false,detailTimer,displayed=[];
  let sceneDirty=true,paletteDirty=true,shownSurface=null,labelsDirty=true,labelFrame=null;
  let lastDetailFrame=null,lastDetailTime=-Infinity,lastReadout=-Infinity;
  const trackLabels=labelTracker(data);
  let typePlane=null,disposed=false,retryTimer=0,attempts=0;
  const vectors=vectorDisplay(surface,data,schedule);
  const labelNodes=new Map(), palette=new Uint8Array(256*Math.ceil(data.cities.length/256)*4);
  function initGPU(){
    attempts++;
    try{gpu=globeGPU(canvas,data.cities.length);}catch{gpu=null;}
    if(gpu){
      vectors.clear();
      if(!typePlane)try{typePlane=glyphLayer(schedule);}catch{typePlane=null;}
    }
    canvas.hidden=!gpu;stage.dataset.renderer=gpu?'webgl':'svg';paletteDirty=true;sceneDirty=true;labelsDirty=true;
  }
  initGPU();
  function retryGraphics(delay){
    if(disposed || gpu || attempts>=3 || retryTimer || typeof WebGLRenderingContext!=='function')return;
    retryTimer=setTimeout(()=>{
      retryTimer=0;
      if(document.hidden||disposed||gpu)return;
      if(moving||controls?.interacting){retryGraphics(900);return;}
      initGPU();schedule();if(!gpu)retryGraphics(2500);
    },delay);
  }
  function measure(){
    const rect=stage.getBoundingClientRect();
    width=Math.round(rect.width||Math.min(window.innerWidth||390,760));height=Math.round(rect.height||Math.max(345,width*.96));
    svg.setAttribute('viewBox','0 0 '+width+' '+height);
  }
  const camera=()=>frame(view,width,height);
  function drawLabels(f,now){
    const same=!labelsDirty && labelFrame && f.lon===labelFrame.lon && f.lat===labelFrame.lat &&
       f.zoom===labelFrame.zoom && f.width===labelFrame.width && f.height===labelFrame.height;
    if(!same){
      displayed=trackLabels(f,selected,paints,moving,now,labelsDirty);
      labelFrame=f;labelsDirty=false;
    }
    if(gpu && typePlane){
      if(labels.firstChild){labels.replaceChildren();labelNodes.clear();}
      try{
        if(same && !typePlane.dirty){typePlane.replay(f,gpu);return false;}
        return typePlane.draw(f,displayed,paints,selected,gpu,moving);
      }catch{typePlane.dispose();typePlane=null;}
    }else if(same)return false;
    const keep=new Set();
    for(const l of displayed){
      const item=l.item,key=item.type+item.id;keep.add(key);
      let entry=labelNodes.get(key);
      if(!entry){
        const node=document.createElementNS(NS,'g');node.innerHTML='<circle/><circle class="pin-hit" fill="transparent" r="10"/><text/>';
        if(item.type==='region')node.dataset.labelRegion=item.id;
        labels.append(node);
        node.lastElementChild.textContent=l.text;
        entry={node,pin:node.children[0],hit:node.children[1],text:node.children[2]};
        labelNodes.set(key,entry);
      }
      const {node,pin,hit,text}=entry;
      const position='translate('+l.x.toFixed(2)+' '+l.y.toFixed(2)+')';
      if(position!==entry.position){node.setAttribute('transform',position);entry.position=position;}
      const ink=selected.has(item.id)?'#ff976f':paints.get(item.id)?.fill||'#fffef8';
      const dx=(l.tx-l.x).toFixed(2),dy=(l.ty-l.y).toFixed(2),size=l.size.toFixed(2);
      const weight=l.emphasis||item.type==='country'?'700':'500';
      const style=[l.pin,ink,dx,dy,size,weight].join('/');
      if(entry.style===style)continue;
      entry.style=style;
      pin.style.display=hit.style.display=l.pin?'':'none';
      if(l.pin){
        pin.setAttribute('r','3.2');pin.setAttribute('stroke','#30392b');pin.setAttribute('stroke-width','1.4');
        pin.setAttribute('fill',ink);
        hit.dataset.pin=item.id;
      }else delete hit.dataset.pin;
      text.setAttribute('x',dx);text.setAttribute('y',dy);
      text.setAttribute('font-size',size);text.setAttribute('font-weight',weight);
    }
    for(const [key,entry] of labelNodes)if(!keep.has(key)){entry.node.remove();labelNodes.delete(key);}
  }
  function updateControls(f,now){
    const atMax=f.zoom>=MAX_ZOOM, atMin=f.zoom<=1;
    if(plus.disabled!==atMax)plus.disabled=atMax;
    if(minus.disabled!==atMin)minus.disabled=atMin;
    if(moving && now-lastReadout<110)return;
    const precision=f.zoom<12?1:f.zoom<120?2:3;
    const coordinates=Math.abs(f.lat).toFixed(precision)+'°'+(f.lat<0?'S':'N')+'  '+Math.abs(f.lon).toFixed(precision)+'°'+(f.lon<0?'W':'E');
    if(readout.textContent!==coordinates)readout.textContent=coordinates;
    lastReadout=now;
  }
  function prefetch(f,now){
    if(!moving || f.zoom<3 || now-lastDetailTime<=180)return;
    const far=!lastDetailFrame || lastDetailFrame.zoom/f.zoom>1.4 || f.zoom/lastDetailFrame.zoom>1.4 ||
      Math.sqrt(Math.max(0,2*(1-dot(f.forward,lastDetailFrame.forward))))*f.radius>Math.min(width,height)*.22;
    if(far)detail();
  }
  function draw(now=performance.now()){
    raf=0;inFrame=true;
    let next=false;
    try{
      next=controls?.advance(now)||false;
      const f=camera();
      if(paletteDirty){gpu?.palette(palette);paletteDirty=false;}
      if(gpu){
        const tiles=f.zoom<3?[data.overview]:data.visible(f);
        if(gpu.draw(f,tiles,moving))next=true;
        shownSurface={pose:f,tiles:f.zoom<3?null:gpu.displayed};
      }else{
        shownSurface=vectors.draw(f,moving,paints,selected,sceneDirty,now);
        if(shownSurface.another)next=true;
      }
      sceneDirty=false;
      if((gpu || shownSurface.tiles) && drawLabels(shownSurface.pose,now))next=true;
      updateControls(f,now);
      prefetch(f,now);
    }finally{inFrame=false;if(next)schedule();}
  }
  function schedule(){if(!disposed&&!document.hidden&&!inFrame&&!raf)raf=requestAnimationFrame(draw);}
  function flush(){if(raf)cancelAnimationFrame(raf);raf=0;draw();}
  function detail(){
    if(disposed || document.hidden)return;
    lastDetailFrame=camera();lastDetailTime=performance.now();
    data.loadDetail(lastDetailFrame).catch(()=>{});
  }
  function finish(){
    if(moving){labelsDirty=true;sceneDirty=true;}
    moving=false;stage.classList.remove('is-moving');schedule();
    clearTimeout(detailTimer);detailTimer=setTimeout(detail,80);
  }
  function move(next){
    view=next;sceneDirty=true;
    if(!moving){moving=true;stage.classList.add('is-moving');clearTimeout(detailTimer);}
  }
  function pick([x,y],target){
    const explicit=target?.closest?.('[data-pin],[data-city]');
    if(explicit){onSelect(explicit.dataset.pin||explicit.dataset.city);return;}
    const f=shownSurface?.pose||camera(), ll=unproject(x,y,f);if(!ll)return;
    const directPin=gpu && typePlane && displayed.find(l=>l.pin && Math.hypot(l.x-x,l.y-y)<3.5);
    if(directPin){onSelect(directPin.item.id);return;}
    let chosen=null, area=Infinity;
    for(const t of (shownSurface?.tiles||data.visible(f,f.zoom<3)))for(const s of t.shapes){
      if(s.level!==0 || !contains(s,...ll))continue;
      const span=(s.box[2]-s.box[0])*(s.box[3]-s.box[1]);
      if(span<area){area=span;chosen=data.features[s.idx];}
    }
    if(chosen){onSelect(chosen.id);return;}
    const pin=displayed.find(l=>l.pin && Math.hypot(l.x-x,l.y-y)<9);
    if(pin)onSelect(pin.item.id);
  }
  controls=globeControls(stage,{get:()=>view,set:move,size:()=>[width,height],request:schedule,finish,pick});
  data.onDetail=()=>{sceneDirty=true;schedule();};data.onEvict=tile=>gpu?.evict(tile);
  plus.onclick=()=>controls.step(1.65);minus.onclick=()=>controls.step(1/1.65);
  container.querySelector('[data-map="reset"]').onclick=controls.reset;
  canvas.addEventListener('webglcontextlost',e=>{
    e.preventDefault();if(disposed)return;
    gpu=null;typePlane?.dispose();typePlane=null;canvas.hidden=true;stage.dataset.renderer='svg';labelsDirty=sceneDirty=true;finish();
  });
  canvas.addEventListener('webglcontextrestored',()=>{if(!disposed){initGPU();finish();}});
  window.addEventListener('pagehide',e=>{
    controls.stop();cancelAnimationFrame(raf);raf=0;clearTimeout(detailTimer);clearTimeout(retryTimer);retryTimer=0;
    if(!e.persisted){disposed=true;typePlane?.dispose();gpu?.release();data.dispose?.();}
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&!disposed){retryGraphics(750);labelsDirty=sceneDirty=true;schedule();}
  });
  window.addEventListener('pageshow',e=>{if(e.persisted&&!disposed){measure();finish();retryGraphics(750);}});
  window.addEventListener('online',detail);
  measure();draw();retryGraphics(850);
  const resize=()=>{const w=width,h=height;measure();if(width!==w||height!==h){controls.stop();vectors.invalidate();labelsDirty=sceneDirty=true;finish();}};
  if(typeof ResizeObserver==='function')new ResizeObserver(resize).observe(stage);else window.addEventListener('resize',resize);
  return {
    update(layers,viewName,ids,paintNow=true){
      const previous=selected, oldPaints=paints;
      selected=new Set(ids);
      const entries=new Map();
      for(const id of new Set(Object.values(layers).flatMap(Object.keys))){
        if(!data.byId.has(id))continue;
        const p=cityAppearance(layers,id,viewName);if(p.active)entries.set(id,p);
      }
      paints=entries;
      let changed=false;
      for(const id of new Set([...selected,...previous,...entries.keys(),...oldPaints.keys()])){
        const c=data.byId.get(id);if(!c)continue;
        const p=entries.get(id),on=selected.has(id),stripe=!on && p?.category==='both';
        const hex=on?'#ff976f':stripe?(p.emphasized?'#9ed9c5':'#e0ece5'):p?.fill;
        const rgb=hex?parseInt(hex.slice(1),16):0, offset=c.idx*4;
        const flag=stripe?(p.emphasized?2:3):hex?1:0;
        if(palette[offset]===rgb>>16 && palette[offset+1]===((rgb>>8)&255) &&
           palette[offset+2]===(rgb&255) && palette[offset+3]===flag && previous.has(id)===on &&
           oldPaints.get(id)?.category===p?.category)continue;
        palette[offset]=rgb>>16;palette[offset+1]=(rgb>>8)&255;palette[offset+2]=rgb&255;palette[offset+3]=flag;
        changed=true;
      }
      if(!changed)return;
      vectors.invalidate();paletteDirty=labelsDirty=sceneDirty=true;
      if(paintNow){if(moving)schedule();else flush();}
    },
    focus(item){
      controls.stop();
      view={lon:item.focusLon,lat:item.focusLat,zoom:clamp(1.4/(RAD*item.focusSpan),1,MAX_ZOOM)};
      vectors.invalidate();labelsDirty=sceneDirty=true;finish();flush();
    },
    reset(){controls.stop();view={...HOME};vectors.invalidate();labelsDirty=sceneDirty=true;finish();flush();},
    prepareExport(){
      if (moving) { controls.stop(); finish(); }
      return prepareWorldMap(data, paints, selected);
    },
    get interacting(){return moving || controls.interacting;},
    get camera(){return camera();}
  };
}
