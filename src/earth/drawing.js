import { geoArea, geoGraticule, geoOrthographic, geoPath } from 'd3-geo';
import { escapeHtml as esc } from '../store.js';
import { PROFILE_PATTERNS } from '../profiles.js';
import { clamp, dot, intersects, project, RAD, unit } from './camera.js';
import { polygon } from './mesh.js';
import { boundaryOpacity, lineStyles, COUNTRY, PREFECTURE, PROVINCE, NO_BORDER } from './boundaries.js';

export const BLANK = {fill:'#f8f7ef',stroke:'#929986',category:''};
export const globeDefs = PROFILE_PATTERNS + '<radialGradient id="ocean" cx=".40" cy=".34" r=".73"><stop stop-color="#d7e8de"/><stop offset=".77" stop-color="#c3d9ce"/><stop offset="1" stop-color="#a0bfb9"/></radialGradient>';
const graticule=geoGraticule().step([30,30])();
export const labelSize = zoom => 10.6+13*(1-Math.exp(-Math.log2(zoom)/8));

export function indexLabels(items,cities) {
  const bins=Array.from({length:36*30},()=>[]);
  for(const item of items){
    item.label=item.countryId==='CHN'||item.type==='province' ? item.name.replace(/特别行政区$|壮族自治区$|回族自治区$|维吾尔自治区$|自治区$|省$|市$/,'') : item.name;
    item.emWidth=[...item.label].reduce((width,c)=>width+(c.charCodeAt(0)>255?1:.64),0);
  }
  for(const c of cities){
    const x=((Math.floor((c.lon+180)/10)%36)+36)%36, y=clamp(Math.floor((c.lat+90)/6),0,29);
    bins[y*36+x].push(c);
  }
  return (f,visit)=>{
    const y0=clamp(Math.floor((f.lat-f.angle+90)/6),0,29),y1=clamp(Math.floor((f.lat+f.angle+90)/6),0,29);
    const x0=Math.floor((f.lon-f.dlon+180)/10);
    const cols=Math.min(36,Math.floor((f.lon+f.dlon+180)/10)-x0+1);
    for(let y=y0;y<=y1;y++)for(let i=0;i<cols;i++)for(const item of bins[y*36+((x0+i)%36+36)%36])visit(item);
  };
}
export function labelsFor(data,f,selected,paints,previous) {
  const candidates=[], sizeBase=labelSize(f.zoom), opacity=boundaryOpacity(f);
  const add=(item,priority,emphasis=false)=>{
    const [x,y,z]=project(item.v,f);
    if(z<(emphasis?.07:.23) || x<2 || x>f.width-2 || y<3 || y>f.height-3)return;
    const size=sizeBase+(emphasis?.7:0);
    const pixelSpan=item.span*RAD*f.radius;
    const pin=item.type==='region' && pixelSpan<27 && f.zoom>=3.3;
    candidates.push({item,x,y,size,pin,priority,span:pixelSpan,text:item.label,emphasis,sticky:previous?.has(item)||false});
  };
  // Only touch the entire region index at regional scales. Unit vectors are cached.
  let order=-selected.size;
  for(const id of [...selected].reverse()){const city=data.byId.get(id);if(city)add(city,order++,true);}
  if(f.zoom>=2.2)for(const [id,paint] of paints){if(!selected.has(id) && paint.active)add(data.byId.get(id),1,true);}
  if(f.zoom<11)for(const c of data.countries)if(c.span*RAD*f.radius>22)add(c,3);
  if(opacity[PROVINCE]>.035 && f.zoom<30)for(const p of data.provinces)if(p.span*RAD*f.radius>23)add(p,4);
  if(opacity[PROVINCE]>.025){
    data.visitLabels(f,c=>{
      if(selected.has(c.id)||paints.has(c.id))return;
      const span=c.span*RAD*f.radius;
      const micro=c.span<.30 && f.zoom>=5;
      if(!micro && c.countryId==='CHN' && opacity[PREFECTURE]<.025)return;
      if(micro || span>Math.max(14,62-3*f.zoom))add(c,micro?2:5);
    });
  }
  candidates.sort((a,b)=>a.priority-b.priority || Number(b.sticky)-Number(a.sticky) || b.span-a.span || (a.item.idx||0)-(b.item.idx||0));
  const boxes=[{l:f.width-41,r:f.width,t:0,b:49}], placed=[];
  for(const c of candidates){
    const half=c.item.emWidth*c.size/2+3;
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
  const areas=new Map(), land=[], lines=[[],[],[]];
  const opacity=boundaryOpacity(f);
  for(const tile of tiles)for(const s of tile.shapes){
    const item=data.features[s.idx];
    const ground=s.level===COUNTRY;
    const painted=s.level===0 && (selected.has(item.id)||paints.has(item.id));
    const stroked=s.boundary!==NO_BORDER && opacity[s.boundary]>0;
    if(!ground && !painted && !stroked)continue;
    if(!intersects(s.box,f))continue;
    const [w,b,e,n]=s.box;
    if(!s.cap){const a=Math.min(Math.PI/2,(e-w+n-b)*RAD/2+.012);s.cap={v:unit((w+e)/2,(b+n)/2),back:-Math.sin(a)};}
    if(dot(s.cap.v,f.forward)<s.cap.back)continue;
    if(moving && !painted && Math.max(e-w,n-b)*RAD*f.radius<2.2)continue;
    const geometry=geometryFor(s,moving && f.zoom<3 && !painted);
    if(ground || painted){
      const d=path(geometry);
      if(d && ground)land.push(d);
      if(d && painted){
        if(!areas.has(item.id))areas.set(item.id,[]);
        areas.get(item.id).push(d);
      }
    }
    if(stroked){
      // Stroke actual boundaries, never a viewport clip edge or the rim of a fill.
      const d=path({type:'MultiLineString',coordinates:geometry.coordinates});
      if(d)lines[s.boundary].push(d);
    }
  }
  const cx=f.width/2, cy=f.height/2;
  const ocean=`<circle cx="${cx}" cy="${cy}" r="${f.radius}" fill="url(#ocean)" stroke="#323c34" stroke-width="1.5"/>`;
  const grid=f.zoom<8?`<path d="${path(graticule)||''}" fill="none" stroke="#78998d" stroke-opacity=".36" stroke-width=".55"/>`:'';
  const regions=[...areas].map(([id,paths])=>{
    const p=paints.get(id)||BLANK, on=selected.has(id);
    return `<path class="earth-region${on?' is-selected':''}" data-city="${id}" data-paint-fill="${p.fill}" data-profile-category="${p.category||''}" d="${paths.join('')}" fill="${on?'#ff976f':p.fill}" fill-rule="evenodd"/>`;
  }).join('');
  const boundaries=lines.map((paths,i)=>{
    if(!paths.length)return '';
    const style=lineStyles[i];
    return `<path data-boundary="${style.name}" d="${paths.join('')}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-opacity="${opacity[i].toFixed(5)}" stroke-linejoin="round"/>`;
  }).join('');
  return ocean+grid+`<path d="${land.join('')}" fill="#f8f7ef"/>`+regions+boundaries;
}
