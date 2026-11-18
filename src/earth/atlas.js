import { decodePacket, batchOverview } from './mesh.js';
import { unit, intersects } from './camera.js';
import { meshLayout } from './boundaries.js';
import { indexLabels } from './drawing.js';

const dataRoot = () => new URL(import.meta.env.BASE_URL+'data/earth/', document.baseURI);
export function catalog(raw) {
  const countries=raw.countries.map(([id,name,alias,lon,lat,span])=>({id,name,alias,lon,lat,span,type:'country',v:unit(lon,lat)}));
  const provinces=raw.provinces.map(([id,name,lon,lat,span])=>({id,name,lon,lat,span,type:'province',v:unit(lon,lat)}));
  const cs=new Map(countries.map(c=>[c.id,c])), ps=new Map(provinces.map(p=>[p.id,p]));
  const cities=raw.regions.map(([id,name,alias,countryId,pid,lon,lat,span,focusLon,focusLat,focusSpan],idx)=>{
    const nation=cs.get(countryId), parent=ps.get(pid)||nation;
    const localAlias=({'820000':'Macau Macao','810000':'Hong Kong Hongkong','710000':'Taiwan','110000':'Beijing','310000':'Shanghai','ne-USA-3521':'加州','ne-JPN-1860':'东京都 東京都'})[id];
    return {id,name,alias:[alias,localAlias].filter(Boolean).join(' '),countryId,country:nation.name,countryAlias:nation.alias,provinceId:parent.id,province:parent.name,
      lon,lat,span,focusLon,focusLat,focusSpan,idx,type:'region',v:unit(lon,lat)};
  });
  const features=[...cities,...provinces,...countries];
  return {cities,countries,provinces,features,raw,layout:meshLayout(raw),visitLabels:indexLabels(features,cities)};
}
async function readAsset(url, type = 'arrayBuffer'){
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),18000);
  try {
    const r=await fetch(url,{signal:controller.signal});
    if(!r.ok)throw new Error('边界数据加载失败');
    // Include the body in the timeout, including when a connection stalls midway.
    return await r[type]();
  } finally { clearTimeout(timer); }
}
export async function loadEarth() {
  const root=dataRoot();
  const data=catalog(await readAsset(new URL('atlas.json',root), 'json'));
  let worker, sequence=0;
  const jobs=new Map();
  try {
    if(typeof Worker==='function'){
      worker=new Worker(new URL('./mesh-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data:r})=>{const j=jobs.get(r.id);if(!j)return;jobs.delete(r.id);r.error?j.reject(new Error(r.error)):j.resolve(r.tiles);};
      worker.onerror=()=>{worker.terminate();worker=null;for(const j of jobs.values())j.reject(new Error('边界线程不可用'));jobs.clear();};
    }
  } catch { worker=null; }
  async function load(file){
    const buffer=await readAsset(new URL(file,root));
    if(worker){
      try{return await new Promise((resolve,reject)=>{
        const id=++sequence;jobs.set(id,{resolve,reject});
        worker.postMessage({id,buffer,layout:data.layout,overview:file===data.raw.base},[buffer]);
      });}catch{if(!buffer.byteLength)return decodePacket(await readAsset(new URL(file,root)),data.layout);}
    }
    return decodePacket(buffer,data.layout);
  }
  const low=await load(data.raw.base);
  data.overview=low.at(-1)?.key===-1?low.pop():batchOverview(low);
  for(let i=0;i<low.length;i++) {
    low[i].shared=data.overview;
    low[i].slice=data.overview.slices[i];
  }
  const stored = new Map(), jobsByKey = new Map(), retryAt = new Map(), pinned = new Map();
  const coarseByKey = new Map(low.map(t=>[t.key,t]));
  let wanted = new Set(), active = 0;
  data.onDetail = () => {};
  data.onEvict = () => {};
  function visibleBase(f) {
    return low.filter(t=>intersects(data.raw.bounds[t.key],f));
  }
  data.visible = (f,coarse=false) => visibleBase(f).map(t=>{
    const fine=!coarse && f.zoom>=3 && stored.get(t.key);
    if(fine) fine.seen=performance.now();
    return fine||t;
  });
  data.detailReady = f => f.zoom<3 || visibleBase(f).every(t=>stored.has(t.key));

  function trim() {
    let bytes=0;
    for(const t of stored.values())bytes+=t.bytes;
    if(stored.size<=16 && bytes<=48*1024*1024)return;
    const old=[...stored.values()].filter(t=>!wanted.has(t.key)&&!pinned.has(t.key)).sort((a,b)=>a.seen-b.seen);
    for(const t of old){
      if(stored.size<=16 && bytes<=48*1024*1024)break;
      stored.delete(t.key);bytes-=t.bytes;data.onEvict(t);
    }
  }
  function start(job) {
    active++;job.started=true;
    load(data.raw.detail[job.key]).then(([tile])=>{
      tile.fallback=coarseByKey.get(tile.key);
      tile.seen=performance.now();
      tile.bytes=(tile.shapes[0]?.coords.buffer.byteLength||0)+tile.points.byteLength*2+
        tile.faces.byteLength+tile.ground*4+2*tile.edges.byteLength+tile.paintRuns.byteLength+
        tile.groundRuns.byteLength+tile.edgeRuns.reduce((n,r)=>n+r.byteLength,0);
      stored.set(tile.key,tile);
      job.resolve(true);
      if(wanted.has(tile.key))data.onDetail();
    }).catch(()=>{
      retryAt.set(job.key,Date.now()+12000);job.resolve(false);
    }).finally(()=>{active--;jobsByKey.delete(job.key);trim();pump();});
  }
  function pump() {
    for(const [key,job] of jobsByKey){
      if(!job.started && !wanted.has(key) && !pinned.has(key)){jobsByKey.delete(key);job.resolve(false);}
    }
    if(active>=3)return;
    const waiting=[...jobsByKey.values()].filter(job=>!job.started).sort((a,b)=>a.distance-b.distance);
    for(const job of waiting){if(active>=3)break;start(job);}
  }
  data.loadDetail = async(f,{hold=false}={})=>{
    const tiles=f.zoom>=3 ? visibleBase(f) : [];
    if(!hold)wanted=new Set(tiles.map(t=>t.key));
    const promises=[];
    for(const t of tiles){
      const key=t.key;
      if(hold)pinned.set(key,(pinned.get(key)||0)+1);
      if(stored.has(key)||(retryAt.get(key)||0)>Date.now())continue;
      if(!jobsByKey.has(key)){
        let resolve;
        const promise=new Promise(r=>{resolve=r;});
        jobsByKey.set(key,{key,promise,resolve,started:false,distance:0});
      }
      const job=jobsByKey.get(key),box=data.raw.bounds[key];
      const dx=Math.abs(((f.lon-(box[0]+box[2])/2+540)%360)-180)*Math.cos(f.lat*Math.PI/180);
      job.distance=Math.hypot(dx,f.lat-(box[1]+box[3])/2);
      promises.push(job.promise);
    }
    pump();
    try{
      const changed=(await Promise.all(promises)).some(Boolean);
      return hold ? {tiles:data.visible(f), coarse:!data.detailReady(f)} : changed;
    }
    finally{
      if(hold)for(const {key} of tiles){
        const n=pinned.get(key)-1;if(n)pinned.set(key,n);else pinned.delete(key);
      }
      trim();
    }
  };
  data.low=low;
  return data;
}
