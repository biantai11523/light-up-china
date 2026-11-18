import { dot, project, RAD } from './camera.js';
import { vectorSurface } from './drawing.js';

function overscan(f,pad) {
  if(!pad)return f;
  const angle=Math.asin(Math.min(1,Math.hypot(f.width+2*pad,f.height+2*pad)*.52/f.radius))/RAD;
  const dlon=Math.abs(f.lat)+angle>=90?180:Math.asin(Math.min(1,Math.sin(angle*RAD)/Math.cos(f.lat*RAD)))/RAD;
  return {...f,angle,dlon};
}

// In the WebGL fallback, present the last complete projection while the worker
// calculates the next. Keep only one in flight and one latest request.
export function vectorDisplay(surface,data,schedule) {
  let epoch=0, running=false, queued=null, ready=null, workerFailed=false;
  let shown=null, lastDraw=-Infinity;
  function present(job,markup) {
    surface.removeAttribute('transform');
    surface.innerHTML=markup;
    shown=job;
  }
  function shift(f) {
    const old=shown?.f;
    if(!old||old.width!==f.width||old.height!==f.height||f.zoom<4||old.zoom<4)return false;
    const scale=f.radius/old.radius, [x,y,z]=project(old.forward,f);
    if(z<=0||scale<.84||scale>1.2||Math.hypot(x-f.width/2,y-f.height/2)>Math.min(f.width,f.height)*.14)return false;
    const a=scale*dot(old.east,f.east), b=-scale*dot(old.east,f.north);
    const c=-scale*dot(old.north,f.east), d=scale*dot(old.north,f.north);
    surface.setAttribute('transform','matrix('+[a,b,c,d,x-a*f.width/2-c*f.height/2,y-b*f.width/2-d*f.height/2].join(' ')+')');
    return true;
  }
  return {
    invalidate(){epoch++;queued=null;ready=null;},
    clear(){epoch++;queued=null;ready=null;shown=null;if(surface.firstChild)surface.replaceChildren();surface.removeAttribute('transform');},
    draw(f,moving,paints,selected,dirty,now){
      if(ready){present(ready.job,ready.markup);ready=null;}
      if(!shown && !surface.firstChild)surface.innerHTML='<circle cx="'+f.width/2+'" cy="'+f.height/2+'" r="'+f.radius+'" fill="url(#ocean)" stroke="#323c34"/>';
      let shifted=false;
      if(moving && shown?.epoch===epoch)shifted=shift(f);
      if(dirty && !shifted){
        const pad=f.zoom>=4?Math.ceil(Math.min(f.width,f.height)*.32):0, area=overscan(f,pad);
        queued={f,area,tiles:data.visible(area,moving&&f.zoom<5),paints,selected,moving,pad,epoch};
      }
      let another=false;
      if(queued && !running){
        const job=queued;
        if(data.projectFrame && !workerFailed){
          queued=null;running=true;
          data.projectFrame(job.area,job.tiles,job.paints,job.selected,job.moving,job.pad)
            .then(markup=>{if(job.epoch===epoch)ready={job,markup};})
            .catch(()=>{workerFailed=true;if(job.epoch===epoch)queued||=job;})
            .finally(()=>{running=false;schedule();});
        }else if(moving && now-lastDraw<26)another=true;
        else{
          queued=null;
          present(job,vectorSurface(data,job.area,job.tiles,job.paints,job.selected,job.moving,job.pad));
          lastDraw=now;shifted=false;
        }
      }
      return {pose:shifted?f:shown?.f||f,tiles:shown?.tiles,another};
    }
  };
}
