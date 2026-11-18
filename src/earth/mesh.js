import { gunzipSync } from 'fflate';
import { geoArea } from 'd3-geo';
import { RAD } from './camera.js';
import { COUNTRY } from './boundaries.js';
import { cellKey, indicesFor, packRuns } from './draw-ranges.js';

// ORB1 stores polygon rings, extra vertices for the curved surface, and offline
// triangulation. The original rings are also the source for hit testing and SVG.
export function decodePacket(compressed, layout) {
  const {regions:regionCount, provinces:provinceCount} = layout;
  const bytes=gunzipSync(new Uint8Array(compressed));
  const a=new Int32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  if(a[0]!==0x3142524f) throw new Error('边界文件格式不正确');
  let pos=2;
  const tiles=[];
  for(let t=0;t<a[1];t++){
    const key=a[pos++], count=a[pos++], shapes=[];
    let vertices=0, triangles=0, ground=0;
    for(let p=0;p<count;p++){
      const idx=a[pos++], nr=a[pos++], nv=a[pos++], nt=a[pos++];
      const ends=a.subarray(pos,pos+=nr);
      const coords=a.subarray(pos,pos+=nv*2);
      const indices=a.subarray(pos,pos+=nt);
      let x=0,y=0,west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
      for(let i=0;i<coords.length;i+=2){
        x+=coords[i];y+=coords[i+1];coords[i]=x;coords[i+1]=y;
        west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);
      }
      for(let i=1;i<nt;i++)indices[i]+=indices[i-1];
      const level=idx<regionCount?0:idx<regionCount+provinceCount?1:2;
      shapes.push({idx,ends,coords,indices,offset:vertices,level,boundary:layout.edges[idx],box:[west/1e5,south/1e5,east/1e5,north/1e5]});
      vertices+=nv;triangles+=nt;
      if(level===2)ground+=nt;
    }
    const points=new Float32Array(vertices*4), faces=new Uint32Array(triangles);
    const countryBuckets = new Map(), regionRuns = [];
    const coordinateIds = new Uint32Array(vertices), coordinates = new Map();
    let face=0;
    for(const s of shapes){
      let q=s.offset*4;
      for(let i=0;i<s.coords.length;i+=2){
        const x=s.coords[i],y=s.coords[i+1];
        const lon=x*(RAD/1e5),lat=y*(RAD/1e5),c=Math.cos(lat);
        if (i < s.ends[s.ends.length-1]*2) {
          const key=(x+18000000)*18000001+(y+9000000);
          let id=coordinates.get(key);
          if(id===undefined){id=coordinates.size;coordinates.set(key,id);}
          coordinateIds[q/4]=id;
        }
        points[q++]=c*Math.sin(lon);points[q++]=Math.sin(lat);points[q++]=c*Math.cos(lon);points[q++]=s.idx;
      }
      if (s.level===COUNTRY) {
        for(let i=0;i<s.indices.length;i+=3){
          const a=s.indices[i], b=s.indices[i+1], c=s.indices[i+2], xy=s.coords;
          const key=cellKey((xy[2*a]+xy[2*b]+xy[2*c])/3,(xy[2*a+1]+xy[2*b+1]+xy[2*c+1])/3);
          indicesFor(countryBuckets,key).push(a+s.offset,b+s.offset,c+s.offset);
        }
      } else if(s.indices.length) {
        regionRuns.push(s.idx,face,s.indices.length);
        for(const i of s.indices)faces[face++]=i+s.offset;
      }
      delete s.indices;
    }
    const groundRuns=packRuns(countryBuckets,faces,face,points);
    const lines=[new Map(),new Map(),new Map()],lineCounts=[0,0,0], seen=new Set();
    // Shared borders get one stroke. A higher-order border wins when the same
    // source segment is present in both a province and a prefecture ring.
    for(let level=COUNTRY;level>=0;level--)for(const s of shapes){
      if(s.boundary!==level)continue;
      let first=0;
      for(const end of s.ends){
        for(let i=first;i<end;i++){
          const j=i+1===end?first:i+1, a=s.offset+i, b=s.offset+j;
          const ca=coordinateIds[a], cb=coordinateIds[b];
          if(ca===cb)continue;
          const code=Math.min(ca,cb)*vertices+Math.max(ca,cb);
          if(seen.has(code))continue;
          seen.add(code);
          const xy=s.coords, key=cellKey((xy[2*i]+xy[2*j])/2,(xy[2*i+1]+xy[2*j+1])/2);
          indicesFor(lines[level],key).push(a,b);lineCounts[level]+=2;
        }
        first=end;
      }
    }
    const edges=new Uint32Array(lineCounts.reduce((n,v)=>n+v,0));
    let cursor=0;
    const edgeRuns=lines.map((buckets,i)=>{
      const runs=packRuns(buckets,edges,cursor,points);
      cursor+=lineCounts[i];
      return runs;
    });
    tiles.push({key,shapes,points,faces,edges,lineCounts,ground,groundRuns,edgeRuns,paintRuns:Uint32Array.from(regionRuns)});
  }
  if(pos!==a.length) throw new Error('边界文件不完整');
  return tiles;
}
export function polygon(shape) {
  if (shape.geometry) return shape.geometry;
  let start=0;
  const coordinates=[];
  for(const end of shape.ends) {
    const ring=[];
    for(let i=start;i<end;i++)ring.push([shape.coords[i*2]/1e5,shape.coords[i*2+1]/1e5]);
    ring.push(ring[0]);coordinates.push(ring);start=end;
  }
  const g={type:'Polygon',coordinates};
  // Very narrow islands can reverse spherical winding when their coastline
  // is simplified. Never let such a ring paint the rest of the planet.
  if(geoArea(g)>2*Math.PI)coordinates.forEach(r=>r.reverse());
  return shape.geometry=g;
}
export function batchOverview(tiles) {
  const count=key=>tiles.reduce((n,t)=>n+t[key].length,0);
  const points=new Float32Array(count('points')),faces=new Uint32Array(count('faces')),edges=new Uint32Array(count('edges'));
  const lineCounts=[0,1,2].map(i=>tiles.reduce((n,t)=>n+t.lineCounts[i],0));
  const ground=tiles.reduce((n,t)=>n+t.ground,0);
  const offsets=[0,lineCounts[0],lineCounts[0]+lineCounts[1]];
  let vertex=0,fill=0,back=faces.length-ground;
  const slices=[], paintRuns=[];
  for(const t of tiles){
    slices.push({key:t.key,fill,ground:back-(faces.length-ground),edges:offsets.slice()});
    for(let i=0;i<t.paintRuns.length;i+=3)paintRuns.push(t.paintRuns[i],fill+t.paintRuns[i+1],t.paintRuns[i+2]);
    points.set(t.points,vertex*4);
    for(let i=0;i<t.faces.length;i++){
      const pos=i<t.faces.length-t.ground?fill++:back++;
      faces[pos]=t.faces[i]+vertex;
    }
    let start=0;
    for(let level=0;level<3;level++)for(let i=0;i<t.lineCounts[level];i++)edges[offsets[level]++]=t.edges[start++]+vertex;
    vertex+=t.points.length/4;
  }
  return {key:-1,shapes:[],points,faces,edges,lineCounts,ground,slices,paintRuns:Uint32Array.from(paintRuns)};
}
export function contains(shape, lon, lat) {
  const [w,s,e,n]=shape.box;
  if(lon<w || lon>e || lat<s || lat>n)return false;
  let inside=false, begin=0;
  const x=lon*1e5,y=lat*1e5,c=shape.coords;
  for(const end of shape.ends){
    for(let i=begin,j=end-1;i<end;j=i++){
      const ax=c[2*i],ay=c[2*i+1],bx=c[2*j],by=c[2*j+1];
      if((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
    }
    begin=end;
  }
  return inside;
}
