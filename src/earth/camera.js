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
// Longitude has two inverse solutions: sin(delta) fixes where the anchor
// appears horizontally. Stay on its current meridian branch even when the
// requested latitude exceeds a pole. Switching roots there flips the globe.
export function anchored(view, anchor, point, width, height) {
  if (!anchor) return view;
  const radius=.46*Math.min(width,height)*view.zoom;
  const latitude=anchor[1]*RAD;
  const reach=Math.cos(latitude);
  const previous=wrap(anchor[0]-view.lon)*RAD;
  const sinDelta=clamp((point[0]-width/2)/(radius*Math.max(1e-10,reach)),-1,1);
  const principal=Math.asin(sinDelta);
  const delta=reach<1e-8 ? previous : Math.cos(previous)<0 ? Math.PI-principal : principal;
  const x=reach*Math.sin(delta);
  const vertical=Math.sqrt(Math.max(0,1-x*x));
  const y=clamp((height/2-point[1])/radius,-vertical,vertical);
  const front=Math.sqrt(Math.max(0,vertical*vertical-y*y));
  const pitch=Math.atan2(Math.sin(latitude),reach*Math.cos(delta))-Math.atan2(y,front);
  return {lon:wrap(anchor[0]-delta/RAD),lat:vertical<1e-8 ? view.lat : clamp(pitch/RAD,-89.999,89.999),zoom:view.zoom};
}
