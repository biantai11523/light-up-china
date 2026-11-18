export const RAD = Math.PI / 180;
export const HOME = { lon: 104, lat: 28, zoom: 1 };
export const MAX_ZOOM = 4096;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;
export const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export function unit(lon, lat) {
  const c = Math.cos(lat*RAD);
  return [c*Math.sin(lon*RAD), Math.sin(lat*RAD), c*Math.cos(lon*RAD)];
}
export function frame(view, width, height) {
  const {lon,lat,zoom} = view;
  const a = lon*RAD, b = lat*RAD;
  const east = [Math.cos(a), 0, -Math.sin(a)];
  const north = [-Math.sin(b)*Math.sin(a), Math.cos(b), -Math.sin(b)*Math.cos(a)];
  const forward = unit(lon,lat);
  const radius = .46*Math.min(width,height)*zoom;
  const angle = Math.asin(Math.min(1, Math.hypot(width,height)*.52/radius)) / RAD;
  const dlon = Math.abs(lat)+angle >= 90 ? 180 : Math.asin(Math.min(1,Math.sin(angle*RAD)/Math.cos(b)))/RAD;
  return { ...view,width,height,east,north,forward,radius,angle,dlon };
}
export function project(v, f) {
  return [f.width/2+f.radius*dot(v,f.east), f.height/2-f.radius*dot(v,f.north), dot(v,f.forward)];
}
export function unproject(x, y, f) {
  const u=(x-f.width/2)/f.radius, v=(f.height/2-y)/f.radius;
  const sq=1-u*u-v*v;
  if (sq < 0) return null;
  const z=Math.sqrt(sq);
  const p=f.forward.map((n,i)=>u*f.east[i]+v*f.north[i]+z*n);
  return [Math.atan2(p[0],p[2])/RAD, Math.asin(clamp(p[1],-1,1))/RAD];
}
export function intersects([west,south,east,north], f) {
  if (south > f.lat+f.angle || north < f.lat-f.angle) return false;
  return Math.abs(wrap((west+east)/2-f.lon)) <= (east-west)/2 + f.dlon;
}
// Solve the north-up orthographic inverse for camera orientation. Both polar
// solutions can be valid; prefer the one continuous with the previous pose.
export function anchored(view, anchor, point, width, height) {
  if (!anchor) return view;
  const radius=.46*Math.min(width,height)*view.zoom;
  const latitude=anchor[1]*RAD;
  const maxX=Math.max(1e-8,Math.cos(latitude));
  const x=clamp((point[0]-width/2)/radius,-maxX,maxX);
  const y=(height/2-point[1])/radius;
  const front=Math.sqrt(Math.max(0,1-x*x-y*y));
  const beta=Math.atan2(y,front);
  const angle=Math.asin(clamp(Math.sin(latitude)/Math.max(1e-10,Math.hypot(y,front)),-1,1));
  let best, bestScore=Infinity;
  for(const candidate of [angle-beta,Math.PI-angle-beta]){
    const raw=wrap(candidate/RAD), lat=clamp(raw,-89.999,89.999), p=lat*RAD;
    const lon=wrap(anchor[0]-Math.atan2(x,front*Math.cos(p)-y*Math.sin(p))/RAD);
    const score=(lat-view.lat)**2 + (wrap(lon-view.lon)*Math.cos(p))**2 + 1000*(raw-lat)**2;
    if(score<bestScore){bestScore=score;best={lon,lat,zoom:view.zoom};}
  }
  return best;
}
