// A packet can include an entire coastline even when a close-up shows only
// a harbour. Group consecutive indices by geographic cell inside the worker.
const spread=Uint32Array.from({length:512},(_,n)=>{
  let v=0;
  for(let i=0;i<9;i++)v|=((n>>i)&1)<<(2*i);
  return v;
});
export function cellKey(x, y, step) {
  const lon=Math.floor((x+18000000)/step), lat=Math.floor((y+9000000)/step);
  return spread[lon] | spread[lat]<<1;
}

export function indicesFor(buckets, key) {
  let indices = buckets.get(key);
  if (!indices) { indices = []; buckets.set(key, indices); }
  return indices;
}

// Eight numbers per run: local offset/count, ECEF box centre, half-extents.
// Bounds of the actual Cartesian primitives stay valid at the poles and date line.
export function packRuns(buckets, output, start, points) {
  const runs = new Float64Array(buckets.size * 8);
  let pos = start, r = 0;
  for (const key of [...buckets.keys()].sort((a,b) => a-b)) {
    const ids = buckets.get(key);
    let x0=Infinity, y0=Infinity, z0=Infinity, x1=-Infinity, y1=-Infinity, z1=-Infinity;
    for (const id of ids) {
      const i = id * 4, x = points[i], y = points[i+1], z = points[i+2];
      x0=Math.min(x0,x); y0=Math.min(y0,y); z0=Math.min(z0,z);
      x1=Math.max(x1,x); y1=Math.max(y1,y); z1=Math.max(z1,z);
    }
    runs.set([pos-start, ids.length, (x0+x1)/2, (y0+y1)/2, (z0+z1)/2,
      (x1-x0)/2, (y1-y0)/2, (z1-z0)/2], r);
    output.set(ids, pos);
    r += 8; pos += ids.length;
  }
  return runs;
}

function outsidePlane(r, p, axis, limit) {
  const centre=r[p+2]*axis[0] + r[p+3]*axis[1] + r[p+4]*axis[2];
  const reach=r[p+5]*Math.abs(axis[0]) + r[p+6]*Math.abs(axis[1]) + r[p+7]*Math.abs(axis[2]);
  return Math.abs(centre) - reach > limit;
}

export function visibleRuns(f, runs, count, submit) {
  if (!count) return;
  if (!runs || !runs.length || f.zoom < 3) { submit(0, count); return; }
  const limitX = (f.width/2+3)/f.radius, limitY = (f.height/2+3)/f.radius;
  let first=0, length=0;
  for (let p=0; p<runs.length; p+=8) {
    const a=f.forward;
    const front=runs[p+2]*a[0]+runs[p+3]*a[1]+runs[p+4]*a[2] +
      runs[p+5]*Math.abs(a[0])+runs[p+6]*Math.abs(a[1])+runs[p+7]*Math.abs(a[2]);
    if (front < -.000001 || outsidePlane(runs,p,f.east,limitX) || outsidePlane(runs,p,f.north,limitY)) continue;
    const offset=runs[p], n=runs[p+1];
    // A short clipped gap costs less than another driver call on a phone.
    if (length && offset-first-length>(f.zoom<16?256:72)) { submit(first,length); length=0; }
    if (!length) first=offset;
    length=offset+n-first;
  }
  if (length) submit(first,length);
}
