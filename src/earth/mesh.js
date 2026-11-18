import { gunzipSync } from 'fflate';
import { geoArea } from 'd3-geo';
import { RAD } from './camera.js';

// ORB1 stores polygon rings, extra vertices for the curved surface, and offline
// triangulation. The original rings are also the source for hit testing and SVG.
export function decodePacket(compressed, regionCount, provinceCount) {
  const bytes=gunzipSync(new Uint8Array(compressed));
  const a=new Int32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  if(a[0]!==0x3142524f) throw new Error('边界文件格式不正确');
  let pos=2;
  const tiles=[];
  for(let t=0;t<a[1];t++){
    const key=a[pos++], count=a[pos++], shapes=[];
    let vertices=0, triangles=0, ground=0;
    const lineCounts=[0,0,0];
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
      shapes.push({idx,ends,coords,indices,offset:vertices,level,box:[west/1e5,south/1e5,east/1e5,north/1e5]});
      vertices+=nv;triangles+=nt;lineCounts[level]+=2*ends[nr-1];
      if(level===2)ground+=nt;
    }
    const points=new Float32Array(vertices*4), faces=new Uint32Array(triangles);
    const edges=new Uint32Array(lineCounts.reduce((a,b)=>a+b,0));
    const linePos=[0,lineCounts[0],lineCounts[0]+lineCounts[1]];
    const facePos=[0,triangles-ground];
    for(const s of shapes){
      let q=s.offset*4;
      for(let i=0;i<s.coords.length;i+=2){
        const lon=s.coords[i]*(RAD/1e5),lat=s.coords[i+1]*(RAD/1e5),c=Math.cos(lat);
        points[q++]=c*Math.sin(lon);points[q++]=Math.sin(lat);points[q++]=c*Math.cos(lon);points[q++]=s.idx;
      }
      const group=s.level===2?1:0;
      for(const i of s.indices)faces[facePos[group]++]=i+s.offset;
      let first=0, line=linePos[s.level];
      for(const end of s.ends){
        for(let i=first;i<end;i++){edges[line++]=s.offset+i;edges[line++]=s.offset+(i+1===end?first:i+1);}
        first=end;
      }
      linePos[s.level]=line;
      delete s.indices;
    }
    tiles.push({key,shapes,points,faces,edges,lineCounts,ground});
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
  for(const t of tiles){
    points.set(t.points,vertex*4);
    for(let i=0;i<t.faces.length;i++){
      const pos=i<t.faces.length-t.ground?fill++:back++;
      faces[pos]=t.faces[i]+vertex;
    }
    let start=0;
    for(let level=0;level<3;level++)for(let i=0;i<t.lineCounts[level];i++)edges[offsets[level]++]=t.edges[start++]+vertex;
    vertex+=t.points.length/4;
  }
  return {key:-1,shapes:[],points,faces,edges,lineCounts,ground};
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
