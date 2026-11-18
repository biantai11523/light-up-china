import { dot, project } from './camera.js';
import { labelsFor, labelSize } from './drawing.js';

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
export function glyphLayer() {
  const sample=document.createElement('canvas').getContext('2d');
  if(!sample || typeof sample.fillText!=='function')return null;
  const pages=[], cache=new Map(), sheetSize=1024, em=20, ratio=Math.min(window.devicePixelRatio||1,2);
  let version=0;
  function newPage(){
    const sheet=document.createElement('canvas');sheet.width=sheet.height=sheetSize;
    const p={sheet,ctx:sheet.getContext('2d'),x:0,y:0,row:0,used:-1,length:0,vertices:new Float32Array(1536)};
    pages.push(p);return p;
  }
  function allocate(w,h){
    let p=pages[pages.length-1]||newPage();
    if(p.x+w>sheetSize){p.y+=p.row;p.x=0;p.row=0;}
    if(p.y+h>sheetSize){
      const victim=pages.filter(v=>v.used!==version).sort((a,b)=>a.used-b.used)[0];
      if(pages.length<2 || (!victim && pages.length<3))p=newPage();
      else if(victim){
        p=victim;
        for(const [key,g] of cache)if(g.page===p)cache.delete(key);
        p.ctx.clearRect(0,0,sheetSize,sheetSize);p.x=p.y=p.row=0;
        pages.splice(pages.indexOf(p),1);pages.push(p);
      }else return null;
    }
    const g={page:p,x:p.x,y:p.y,w,h};
    const q=p.dirty;
    p.dirty=q?{x:Math.min(q.x,g.x),y:Math.min(q.y,g.y),right:Math.max(q.right,g.x+w),bottom:Math.max(q.bottom,g.y+h)}
      :{x:g.x,y:g.y,right:g.x+w,bottom:g.y+h};
    p.x+=w;p.row=Math.max(p.row,h);p.used=version;
    return g;
  }
  function glyph(l){
    const bold=l.emphasis||l.item.type==='country',key=(bold?'b':'m')+l.text;
    let g=cache.get(key);
    if(g){g.page.used=version;return g;}
    const family='"PingFang SC","Microsoft YaHei",sans-serif';
    let raster=em*ratio;
    sample.font=(bold?'700 ':'500 ')+raster+'px '+family;
    const measured=sample.measureText(l.text).width;
    raster*=Math.min(1,(sheetSize-8*ratio)/Math.max(1,measured));
    const cover=Math.ceil(Math.min(sheetSize,measured*raster/(em*ratio)+8*ratio));
    g=allocate(cover,Math.ceil(raster*1.75));if(!g)return null;
    g.raster=raster;g.baseline=Math.round(raster*1.16);
    const c=g.page.ctx;c.font=(bold?'700 ':'500 ')+raster+'px '+family;
    c.textAlign='center';c.lineJoin='round';c.lineWidth=raster*.13;
    c.strokeStyle='#f8f7ef';c.fillStyle='#30392b';
    const x=g.x+g.w/2,y=g.y+g.baseline;
    c.strokeText(l.text,x,y);c.fillText(l.text,x,y);cache.set(key,g);return g;
  }
  function pin(color){
    const key='pin:'+color;
    let g=cache.get(key);if(g){g.page.used=version;return g;}
    const side=Math.ceil(12*ratio);g=allocate(side,side);if(!g)return null;
    const c=g.page.ctx,x=g.x+side/2,y=g.y+side/2;
    const stripes=color.startsWith('url'),muted=color.includes('muted');
    c.beginPath();c.arc(x,y,3.2*ratio,0,Math.PI*2);
    c.fillStyle=stripes?(muted?'#e0ece5':'#9ed9c5'):color;c.fill();
    if(stripes){c.save();c.clip();c.fillStyle=muted?'#e6eaf3':'#bccdf3';c.fillRect(x,y-side/2,side/2,side);c.restore();}
    c.strokeStyle='#30392b';c.lineWidth=1.35*ratio;c.stroke();cache.set(key,g);return g;
  }
  const corners=[0,0,1,0,0,1,0,1,1,0,1,1];
  function quad(g,left,top,w,h){
    const p=g.page;
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
    replay(f,gpu){gpu.drawType(f,pages,version);},
    draw(f,labels,paints,selected,gpu){
      version++;for(const page of pages)page.length=0;
      for(const l of labels){
        if(l.pin){
          const mark=pin(selected.has(l.item.id)?'#ff976f':paints.get(l.item.id)?.fill||'#fffef8');
          if(mark)quad(mark,l.x-6,l.y-6,12,12);
        }
        const g=glyph(l);if(!g)continue;
        const s=l.size/g.raster;
        quad(g,l.tx-g.w*s/2,l.ty-g.baseline*s,g.w*s,g.h*s);
      }
      gpu.drawType(f,pages,version);
    }
  };
}
