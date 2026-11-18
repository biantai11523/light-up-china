import { geoArea, geoGraticule, geoOrthographic, geoPath } from 'd3-geo';
import { escapeHtml as esc } from '../store.js';
import { PROFILE_PATTERNS } from '../profiles.js';
import { clamp, dot, intersects, project, RAD, unit } from './camera.js';
import { polygon } from './mesh.js';

export const BLANK = {fill:'#f8f7ef',stroke:'#929986',category:''};
export const globeDefs = PROFILE_PATTERNS + '<radialGradient id="ocean" cx=".40" cy=".34" r=".73"><stop stop-color="#d7e8de"/><stop offset=".77" stop-color="#c3d9ce"/><stop offset="1" stop-color="#a0bfb9"/></radialGradient>';
const graticule=geoGraticule().step([30,30])();
const shortName = f => f.countryId==='CHN' || f.type==='province' ? f.name.replace(/特别行政区$|壮族自治区$|回族自治区$|维吾尔自治区$|自治区$|省$|市$/,'') : f.name;
const widthOf = (text,size) => [...text].reduce((w,c)=>w+(c.charCodeAt(0)>255?1:.63)*size,0);
export function labelsFor(data,f,selected,paints) {
  const candidates=[], chosen=new Set(selected);
  const add=(item,priority,emphasis=false)=>{
    const [x,y,z]=project(item.v,f);
    if(z<(emphasis?.07:.23) || x<2 || x>f.width-2 || y<3 || y>f.height-3)return;
    const size=10.6+13*(1-Math.exp(-Math.log2(f.zoom)/8))+(emphasis?.7:0);
    const pixelSpan=item.span*RAD*f.radius;
    const pin=item.type==='region' && pixelSpan<27 && f.zoom>=3.3;
    candidates.push({item,x,y,size,pin,priority,span:pixelSpan,text:shortName(item),emphasis});
  };
  // Only touch the entire region index at regional scales. Unit vectors are cached.
  let order=-selected.size;
  for(const id of [...selected].reverse()){const city=data.byId.get(id);if(city)add(city,order++,true);}
  if(f.zoom>=2.2)for(const [id,paint] of paints){if(!chosen.has(id) && paint.active)add(data.byId.get(id),1,true);}
  if(f.zoom<11)for(const c of data.countries)if(c.span*RAD*f.radius>22)add(c,3);
  if(f.zoom>=2.5 && f.zoom<30)for(const p of data.provinces)if(p.span*RAD*f.radius>23)add(p,4);
  if(f.zoom>=3.3){
    for(const c of data.cities){
      if(chosen.has(c.id)||paints.has(c.id)||Math.abs(c.lat-f.lat)>f.angle)continue;
      const span=c.span*RAD*f.radius;
      const micro=c.span<.30 && f.zoom>=5;
      if(micro || span>Math.max(14,62-3*f.zoom))add(c,micro?2:5);
    }
  }
  candidates.sort((a,b)=>a.priority-b.priority || b.span-a.span || a.item.idx-b.item.idx);
  const boxes=[{l:f.width-41,r:f.width,t:0,b:49}], placed=[];
  for(const c of candidates){
    const half=widthOf(c.text,c.size)/2+3;
    const offsets=c.pin?[[0,-9],[0,c.size+9],[half+9,3],[-half-9,3]]:[[0,3]];
    for(const [dx,dy] of offsets){
      const tx=c.emphasis?clamp(c.x+dx,half+1,f.width-half-1):c.x+dx, ty=c.y+dy;
      const b={l:tx-half,r:tx+half,t:ty-c.size-2,b:ty+4};
      if(f.zoom<2 && !c.emphasis && Math.hypot(Math.max(Math.abs(b.l-f.width/2),Math.abs(b.r-f.width/2)),Math.max(Math.abs(b.t-f.height/2),Math.abs(b.b-f.height/2)))>f.radius-3)continue;
      if(b.l<0||b.r>f.width||b.t<0||b.b>f.height||boxes.some(v=>v.l<b.r&&v.r>b.l&&v.t<b.b&&v.b>b.t))continue;
      placed.push({...c,tx,ty});boxes.push(b);break;
    }
  }
  return placed;
}
export function labelMarkup(label, paints, selected) {
  const {item,x,y,size,pin,tx,ty,text,emphasis}=label;
  const fill=selected.has(item.id)?'#ff976f':paints.get(item.id)?.fill||'#fffef8';
  return (pin?`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.1" fill="${fill}" stroke="#252a24" stroke-width="1.35"/>`:'')+
    `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-size="${size.toFixed(2)}" font-weight="${emphasis||item.type==='country'?700:500}" text-anchor="middle" fill="#30392b" stroke="#f8f7ef" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;
}
function geometryFor(s, moving) {
  const full=polygon(s);
  if(!moving)return full;
  if(s.preview)return s.preview;
  const cos=Math.max(.13,Math.cos((s.box[1]+s.box[3])*RAD/2));
  const coordinates=full.coordinates.map(ring=>{
    const kept=[ring[0]];
    for(let i=1;i<ring.length-1;i++){
      const p=ring[i],last=kept[kept.length-1];
      if(((p[0]-last[0])*cos)**2+(p[1]-last[1])**2>.8**2)kept.push(p);
    }
    if(kept.length<3)return ring;
    kept.push(kept[0]);return kept;
  });
  const g={type:'Polygon',coordinates};
  if(geoArea(g)>2*Math.PI)g.coordinates=coordinates.map(r=>r.slice().reverse());
  return s.preview=g;
}
export function vectorSurface(data,f,tiles,paints,selected,moving=false,pad=0) {
  const projection=geoOrthographic().rotate([-f.lon,-f.lat]).translate([f.width/2,f.height/2]).scale(f.radius)
    .clipAngle(90).clipExtent([[-pad,-pad],[f.width+pad,f.height+pad]]).precision(moving?1.2:.22);
  const path=geoPath(projection).digits(2);
  const areas=new Map(), land=[], province=[], border=[];
  const showRegions=f.zoom>=1.5 && (!moving||f.zoom>=4);
  for(const tile of tiles)for(const s of tile.shapes){
    if(!intersects(s.box,f))continue;
    const [w,b,e,n]=s.box;
    if(!s.cap){const a=Math.min(Math.PI/2,(e-w+n-b)*RAD/2+.012);s.cap={v:unit((w+e)/2,(b+n)/2),back:-Math.sin(a)};}
    if(dot(s.cap.v,f.forward)<s.cap.back)continue;
    const item=data.features[s.idx], active=selected.has(item.id)||paints.has(item.id);
    if(s.level===0 && !showRegions && !active || s.level===1 && f.zoom<2)continue;
    if(moving && !active && Math.max(e-w,n-b)*RAD*f.radius<2.2)continue;
    const geometry=geometryFor(s,moving && f.zoom<3 && !active);
    if(s.level===2){
      const p=path(geometry);if(!p)continue;
      land.push(p);
      if(!moving){const l=path({type:'MultiLineString',coordinates:geometry.coordinates});if(l)border.push(l);}
    }else if(s.level===1){
      const l=path({type:'MultiLineString',coordinates:geometry.coordinates});if(l)province.push(l);
    }else{
      const p=path(geometry);if(!p)continue;
      if(!areas.has(item.id))areas.set(item.id,[]);
      areas.get(item.id).push(p);
    }
  }
  const cx=f.width/2, cy=f.height/2;
  const ocean=`<circle cx="${cx}" cy="${cy}" r="${f.radius}" fill="url(#ocean)" stroke="#323c34" stroke-width="1.5"/>`;
  const grid=f.zoom<8?`<path d="${path(graticule)||''}" fill="none" stroke="#78998d" stroke-opacity=".36" stroke-width=".55"/>`:'';
  const regions=[...areas].map(([id,paths])=>{
    const p=paints.get(id)||BLANK, on=selected.has(id);
    return `<path class="earth-region${on?' is-selected':''}" data-city="${id}" data-paint-fill="${p.fill}" data-profile-category="${p.category||''}" d="${paths.join('')}" fill="${on?'#ff976f':p.fill}" fill-rule="evenodd" stroke="${on?'#373d30':'#98a08d'}" stroke-width="${on?.9:showRegions?.42:0}" stroke-linejoin="round"/>`;
  }).join('');
  return ocean+grid+`<path d="${land.join('')}" fill="#f8f7ef" ${moving?'stroke="#525e50" stroke-width=".7"':''}/>`+regions+
    `<path d="${province.join('')}" fill="none" stroke="#66705e" stroke-width=".8"/><path d="${border.join('')}" fill="none" stroke="#434c40" stroke-width="1"/>`;
}
