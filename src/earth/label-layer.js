import { dot, project } from './camera.js';
import { labelsFor, labelSize } from './drawing.js';
import { rasterizer } from './type-raster.js';

// Collision detection runs after meaningful screen travel. The anchors and type
// size still follow the exact camera on every presented frame.
export function labelTracker(data) {
  let origin, at=0, plan=[], preferred=new Set();
  return (f,selected,paints,moving,now,force=false)=>{
    const distance=origin ? Math.sqrt(Math.max(0,2*(1-dot(origin.forward,f.forward))))*f.radius : Infinity;
    const scale=origin ? Math.abs(Math.log(f.zoom/origin.zoom)) : Infinity;
    if(!moving || force || !origin || origin.width!==f.width || origin.height!==f.height ||
        distance>36 || scale>.12 || (now-at>=72 && (distance>3 || scale>.018))){
      plan=labelsFor(data,f,selected,paints,moving?preferred:undefined);
      preferred=new Set(plan.map(l=>l.item));origin=f;at=now;
      return plan;
    }
    const placed=[], pixels=labelSize(f.zoom);
    for(const l of plan){
      const [x,y,z]=project(l.item.v,f);
      if(z<=0 || x<0 || x>f.width || y<0 || y>f.height)continue;
      const size=pixels+(l.emphasis?.7:0), factor=size/l.size;
      placed.push({...l,x,y,size,tx:x+(l.tx-l.x)*factor,ty:y+(l.ty-l.y)*factor});
    }
    return placed;
  };
}

// Rasterize words on demand into bounded atlas pages. The visible layer is
// rendered as textured quads in the same WebGL pass sequence as the geography.
export function glyphLayer(notify) {
  const pages=[], cache=new Map(), ready=new Map(), sheetSize=1024, ratio=Math.min(window.devicePixelRatio||1,2);
  let version=0, worker=null, busy=false, dirty=false, local;
  // The fallback rasterizer is also a capability check for the UI-only test
  // environment and browsers with restricted canvas access.
  try{local=rasterizer(document.createElement('canvas'),ratio);}catch{return null;}
  function failed(){
    worker?.terminate();worker=null;busy=false;dirty=true;notify();
  }
  try{
    if(typeof Worker==='function' && typeof OffscreenCanvas==='function'){
      worker=new Worker(new URL('./type-worker.js',import.meta.url),{type:'module'});
      worker.onerror=worker.onmessageerror=failed;
      worker.onmessage=({data})=>{
        if(data.unsupported){failed();return;}
        busy=false;
        for(const g of data.glyphs)ready.set(g.key,g);
        while(ready.size>160)ready.delete(ready.keys().next().value);
        dirty=true;notify();
      };
    }
  }catch{worker=null;}

  function pack(g){
    let p=pages.at(-1);
    if(p && p.x+g.w>sheetSize){p.y+=p.row;p.x=0;p.row=0;}
    if(!p || p.y+g.h>sheetSize){
      const victim=pages.filter(v=>v.used!==version).sort((a,b)=>a.used-b.used)[0];
      if(pages.length<2 || (!victim && pages.length<3)){
        p={x:0,y:0,row:0,entries:[],generation:0,used:-1,length:0,vertices:new Float32Array(1536)};
        pages.push(p);
      }else if(victim){
        p=victim;
        for(const old of p.entries)cache.delete(old.key);
        p.x=p.y=p.row=0;p.entries=[];p.generation++;
        pages.splice(pages.indexOf(p),1);pages.push(p);
      }else return null;
    }
    g.page=p;g.x=p.x;g.y=p.y;p.x+=g.w;p.row=Math.max(p.row,g.h);p.entries.push(g);
    cache.set(g.key,g);return g;
  }
  const corners=[0,0,1,0,0,1,0,1,1,0,1,1];
  function quad(g,left,top,w,h){
    const p=g.page;p.used=version;
    if(p.length+24>p.vertices.length){const large=new Float32Array(p.vertices.length*2);large.set(p.vertices);p.vertices=large;}
    let i=p.length;
    for(let k=0;k<corners.length;k+=2){
      const x=corners[k],y=corners[k+1];
      p.vertices[i++]=left+x*w;p.vertices[i++]=top+y*h;
      p.vertices[i++]=(g.x+x*g.w)/sheetSize;p.vertices[i++]=(g.y+y*g.h)/sheetSize;
    }
    p.length=i;
  }
  return {
    get dirty(){return dirty;},
    dispose(){worker?.terminate();},
    replay(f,gpu){gpu.drawType(f,pages,version);},
    draw(f,labels,paints,selected,gpu,moving){
      version++;dirty=false;
      for(const page of pages)page.length=0;
      const wanted=new Map();
      let budget=moving?96*1024:384*1024, accepted=0;
      const deadline=performance.now()+(moving?1.2:3);
      function obtain(spec){
        let g=cache.get(spec.key);
        if(g)return g;
        g=ready.get(spec.key);
        if(!g && worker){wanted.set(spec.key,spec);return null;}
        if(accepted && (budget<=0 || performance.now()>=deadline)){dirty=true;return null;}
        if(!g)g=local(spec);
        ready.delete(spec.key);budget-=g.pixels.byteLength;accepted++;
        return pack(g);
      }
      for(const l of labels){
        if(l.pin){
          const color=selected.has(l.item.id)?'#ff976f':paints.get(l.item.id)?.fill||'#fffef8';
          const mark=obtain({key:'pin:'+color,pin:true,color});
          if(mark)quad(mark,l.x-6,l.y-6,12,12);
        }
        const bold=l.emphasis||l.item.type==='country', key=(bold?'b':'m')+l.text;
        const g=obtain({key,text:l.text,bold});
        if(!g)continue;
        const s=l.size/g.raster;
        quad(g,l.tx-g.w*s/2,l.ty-g.baseline*s,g.w*s,g.h*s);
      }
      if(worker && !busy && wanted.size){
        busy=true;worker.postMessage({ratio,words:[...wanted.values()].slice(0,16)});
      }
      gpu.drawType(f,pages,version);
      return dirty;
    }
  };
}
