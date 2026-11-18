import { decodePacket, batchOverview } from './mesh.js';
import { unit, intersects } from './camera.js';

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
  return {cities,countries,provinces,features:[...cities,...provinces,...countries],raw};
}
async function response(url){
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),18000);
  try {
    const r=await fetch(url,{signal:controller.signal});
    if(!r.ok)throw new Error('边界数据加载失败');
    // Include the body in the timeout, including when a connection stalls midway.
    return new Response(await r.arrayBuffer());
  } finally { clearTimeout(timer); }
}
export async function loadEarth() {
  const root=dataRoot();
  const data=catalog(await (await response(new URL('atlas.json',root))).json());
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
    const buffer=await (await response(new URL(file,root))).arrayBuffer();
    if(worker){
      try{return await new Promise((resolve,reject)=>{
        const id=++sequence;jobs.set(id,{resolve,reject});
        worker.postMessage({id,buffer,regions:data.cities.length,provinces:data.provinces.length,overview:file===data.raw.base},[buffer]);
      });}catch{if(!buffer.byteLength)return decodePacket(await (await response(new URL(file,root))).arrayBuffer(),data.cities.length,data.provinces.length);}
    }
    return decodePacket(buffer,data.cities.length,data.provinces.length);
  }
  const low=await load(data.raw.base);
  data.overview=low.at(-1)?.key===-1?low.pop():batchOverview(low);
  const fine=new Map(), pending=new Map(), retryAt=new Map();
  data.visible=(f,coarse=false)=>low.filter(t=>intersects(data.raw.bounds[t.key],f)).map(t=>{
    const detailed=!coarse && f.zoom>=3 && fine.get(t.key);
    if(detailed)detailed.seen=performance.now();
    return detailed||t;
  });
  data.detailReady=f=>f.zoom<3 || low.every(t=>!intersects(data.raw.bounds[t.key],f)||fine.has(t.key));
  let generation=0;
  data.loadDetail=async(f,onEvict)=>{
    const current=++generation;
    if(f.zoom<3)return false;
    const visible=low.filter(t=>intersects(data.raw.bounds[t.key],f)).map(t=>t.key);
    const missing=visible.filter(k=>!fine.has(k) && (retryAt.get(k)||0)<Date.now());
    let changed=false;
    for(let i=0;i<missing.length && current===generation;i+=3)await Promise.all(missing.slice(i,i+3).map(async key=>{
      if(!pending.has(key))pending.set(key,load(data.raw.detail[key]).then(([t])=>{
        t.seen=performance.now();t.bytes=(t.shapes[0]?.coords.buffer.byteLength||0)+2*(t.points.byteLength+t.faces.byteLength+t.edges.byteLength);
        fine.set(key,t);changed=true;
      })
        .catch(()=>{retryAt.set(key,Date.now()+12000);}).finally(()=>pending.delete(key)));
      await pending.get(key);
    }));
    // Protect the current view. Reclaim old CPU geometry and GPU buffers together.
    if(current===generation){
      let bytes=[...fine.values()].reduce((n,t)=>n+t.bytes,0);
      for(const t of [...fine.values()].filter(t=>!visible.includes(t.key)).sort((a,b)=>a.seen-b.seen)){
        if(fine.size<=16 && bytes<=48*1024*1024)break;
        fine.delete(t.key);bytes-=t.bytes;onEvict?.(t);
      }
    }
    return changed;
  };
  data.low=low;
  return data;
}
