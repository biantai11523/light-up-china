import { frame, HOME, MAX_ZOOM, clamp, dot, project, unproject, RAD } from './camera.js';
import { contains } from './mesh.js';
import { globeGPU } from './webgl.js';
import { globeControls } from './gestures.js';
import { globeDefs, labelsFor, labelMarkup, vectorSurface, BLANK } from './drawing.js';
import { cityAppearance } from '../profiles.js';

const NS='http://www.w3.org/2000/svg';
export function createGlobe(container,data,onSelect){
  const stage=container.querySelector('.map-stage'), canvas=stage.querySelector('canvas'), svg=stage.querySelector('.map-svg');
  svg.innerHTML='<defs>'+globeDefs+'</defs><g class="earth-surface"></g><g class="earth-labels"></g>';
  const surface=svg.querySelector('.earth-surface'), labels=svg.querySelector('.earth-labels');
  const readout=container.querySelector('.earth-readout'), plus=container.querySelector('[data-map="plus"]'),minus=container.querySelector('[data-map="minus"]');
  data.byId=new Map(data.cities.map(c=>[c.id,c]));
  let view={...HOME}, width=390,height=390, selected=new Set(), paints=new Map();
  let gpu,raf=0,moving=false,lastVectorTime=-Infinity,detailTimer,detailEpoch=0,displayed=[];
  let sceneDirty=true,paletteDirty=true,vectorFrame=null;
  const labelNodes=new Map(), palette=new Uint8Array(256*Math.ceil(data.cities.length/256)*4);
  function initGPU(){
    try{gpu=globeGPU(canvas,data.cities.length);}catch{gpu=null;}
    canvas.hidden=!gpu;stage.dataset.renderer=gpu?'webgl':'svg';paletteDirty=true;sceneDirty=true;
  }
  initGPU();
  function measure(){
    const rect=stage.getBoundingClientRect();
    width=Math.round(rect.width||Math.min(window.innerWidth||390,760));height=Math.round(rect.height||Math.max(345,width*.96));
    svg.setAttribute('viewBox','0 0 '+width+' '+height);
  }
  const camera=()=>frame(view,width,height);
  function updatePalette(){
    for(const c of data.cities){
      const p=paints.get(c.id)||BLANK, on=selected.has(c.id);
      const stripe=!on && p.category==='both';
      const hex=on?'#ff976f':stripe?(p.emphasized?'#9ed9c5':'#e0ece5'):p.fill;
      const rgb=parseInt(hex.slice(1),16),offset=c.idx*4;
      palette[offset]=rgb>>16;palette[offset+1]=(rgb>>8)&255;palette[offset+2]=rgb&255;
      palette[offset+3]=stripe?(p.emphasized?1:2):0;
    }
    gpu?.palette(palette);paletteDirty=false;
  }
  function drawLabels(f){
    displayed=labelsFor(data,f,selected,paints);
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
  function reuseCloseup(f){
    if(!moving||!vectorFrame||f.zoom<5||vectorFrame.zoom<5)return false;
    const old=vectorFrame, scale=f.radius/old.radius, [x,y,z]=project(old.forward,f);
    if(z<=0||scale<.82||scale>1.24||Math.hypot(x-width/2,y-height/2)>Math.min(width,height)*.15)return false;
    // Over a small geographic window the tangent plane follows the fingers.
    // Refresh the exact spherical projection as soon as this margin is used.
    const a=scale*dot(old.east,f.east), b=-scale*dot(old.east,f.north);
    const c=-scale*dot(old.north,f.east), d=scale*dot(old.north,f.north);
    surface.setAttribute('transform','matrix('+[a,b,c,d,x-a*width/2-c*height/2,y-b*width/2-d*height/2].join(' ')+')');
    return true;
  }
  function draw(now=performance.now()){
    raf=0;
    const f=camera(), tiles=data.visible(f,!gpu&&moving&&view.zoom<5);
    const reuse=!gpu && reuseCloseup(f);
    if(!gpu && !reuse && moving && now-lastVectorTime<32){schedule();return;}
    if(paletteDirty)updatePalette();
    if(gpu){
      // While rotating, stay on buffers already in graphics memory. Upload
      // newly arrived detail when the fingers lift instead of stalling a frame.
      const globeOnly=f.zoom<3 || moving && tiles.some(t=>!gpu.resident(t));
      gpu.draw(f,globeOnly?[data.overview]:tiles);
      if(surface.firstChild)surface.replaceChildren();
    }else if(sceneDirty&&!reuse){
      const pad=f.zoom>=5?Math.ceil(Math.min(width,height)*.32):0;
      const expanded=pad?frame(view,width+2*pad,height+2*pad):f;
      // Increase only the angular bounds for overscan; keep the screen projection.
      const angle=pad?Math.asin(Math.min(1,Math.hypot(expanded.width,expanded.height)*.52/f.radius))/RAD:f.angle;
      const dlon=Math.abs(f.lat)+angle>=90?180:Math.asin(Math.min(1,Math.sin(angle*RAD)/Math.cos(f.lat*RAD)))/RAD;
      const region={...f,angle,dlon};
      surface.removeAttribute('transform');
      surface.innerHTML=vectorSurface(data,region,data.visible(region,moving&&view.zoom<5),paints,selected,moving,pad);
      vectorFrame=f;lastVectorTime=now;
    }
    sceneDirty=false;drawLabels(f);
    plus.disabled=view.zoom>=MAX_ZOOM;minus.disabled=view.zoom<=1;
    const precision=f.zoom<12?1:f.zoom<120?2:3;
    readout.textContent=Math.abs(f.lat).toFixed(precision)+'°'+(f.lat<0?'S':'N')+'  '+Math.abs(f.lon).toFixed(precision)+'°'+(f.lon<0?'W':'E');
  }
  function schedule(){if(!raf)raf=requestAnimationFrame(draw);}
  function flush(){if(raf)cancelAnimationFrame(raf);raf=0;draw();}
  function detail(){
    const epoch=++detailEpoch;
    data.loadDetail(camera(),tile=>gpu?.evict(tile)).then(changed=>{
      if(changed || epoch===detailEpoch){sceneDirty=true;schedule();}
    }).catch(()=>{});
  }
  function finish(){
    moving=false;stage.classList.remove('is-moving');sceneDirty=true;flush();
    clearTimeout(detailTimer);detailTimer=setTimeout(detail,80);
  }
  function move(next){
    view=next;moving=true;stage.classList.add('is-moving');sceneDirty=true;schedule();
    clearTimeout(detailTimer);
  }
  function pick([x,y],target){
    const explicit=target?.closest?.('[data-pin],[data-city]');
    if(explicit){onSelect(explicit.dataset.pin||explicit.dataset.city);return;}
    const f=camera(), ll=unproject(x,y,f);if(!ll)return;
    let chosen=null, area=Infinity;
    for(const t of data.visible(f))for(const s of t.shapes){
      if(s.level!==0 || !contains(s,...ll))continue;
      const span=(s.box[2]-s.box[0])*(s.box[3]-s.box[1]);
      if(span<area){area=span;chosen=data.features[s.idx];}
    }
    if(chosen){onSelect(chosen.id);return;}
    const pin=displayed.find(l=>l.pin && Math.hypot(l.x-x,l.y-y)<9);
    if(pin)onSelect(pin.item.id);
  }
  const controls=globeControls(stage,{get:()=>view,set:move,size:()=>[width,height],finish,pick});
  plus.onclick=()=>controls.step(1.65);minus.onclick=()=>controls.step(1/1.65);
  container.querySelector('[data-map="reset"]').onclick=controls.reset;
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();gpu=null;canvas.hidden=true;stage.dataset.renderer='svg';finish();});
  canvas.addEventListener('webglcontextrestored',()=>{initGPU();finish();});
  window.addEventListener('online',detail);
  measure();draw();
  const resize=()=>{measure();finish();};
  if(typeof ResizeObserver==='function')new ResizeObserver(resize).observe(stage);else window.addEventListener('resize',resize);
  return {
    update(layers,viewName,ids){
      selected=new Set(ids);
      const entries=new Map();
      for(const id of new Set(Object.values(layers).flatMap(Object.keys))){
        if(!data.byId.has(id))continue;
        const p=cityAppearance(layers,id,viewName);if(p.active)entries.set(id,p);
      }
      paints=entries;paletteDirty=true;sceneDirty=true;
      if(moving)schedule();else flush();
    },
    focus(item){
      controls.stop();
      view={lon:item.focusLon,lat:item.focusLat,zoom:clamp(1.4/(RAD*item.focusSpan),1,MAX_ZOOM)};
      finish();
    },
    reset(){controls.stop();view={...HOME};finish();},
    async prepareExport(){
      controls.stop();clearTimeout(detailTimer);moving=false;stage.classList.remove('is-moving');measure();
      const f=camera(),selection=new Set(selected),colors=new Map(paints);
      await data.loadDetail(f,t=>gpu?.evict(t));sceneDirty=true;flush();
      return {width:f.width,height:f.height,coarse:!data.detailReady(f),
        body:'<defs>'+globeDefs+'</defs>'+vectorSurface(data,f,data.visible(f),colors,selection)+
          labelsFor(data,f,selection,colors).map(l=>labelMarkup(l,colors,selection)).join('')};
    },
    get interacting(){return moving;},
    get camera(){return camera();}
  };
}
