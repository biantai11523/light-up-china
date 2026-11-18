import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frame, unit, project, unproject, anchored, wrap} from '../src/earth/camera.js';
import {decodePacket} from '../src/earth/mesh.js';
import {catalog} from '../src/earth/atlas.js';
import {boundaryOpacity, COUNTRY, PROVINCE, PREFECTURE, NO_BORDER} from '../src/earth/boundaries.js';
import {vectorSurface} from '../src/earth/drawing.js';

const raw=JSON.parse(readFileSync('public/data/earth/atlas.json'));
const atlas=catalog(raw), coarse=decodePacket(readFileSync('public/data/earth/'+raw.base),atlas.layout);
const view=k=>frame({lon:115,lat:32,zoom:k},402,406);

test('a national, provincial and city close-up have distinct borders in the actual exported SVG',()=>{
  const id='330100', marks=new Map(), selected=new Set([id]);
  const outline=(s,name)=>s.match(new RegExp('data-boundary="'+name+'"[^>]*stroke-opacity="([\\d.]+)"'))?.[1];
  const at=k=>vectorSurface(atlas,view(k),coarse,marks,selected);
  const world=at(1),china=at(3.2), province=at(6.8),near=at(12), close=at(20);
  assert.ok(outline(world,'country'));
  assert.equal(outline(world,'province'),undefined);
  for(const s of [world,china,province]){
    assert.equal(outline(s,'prefecture'),undefined);
    assert.ok(s.includes('data-city="330100"'));
    assert.doesNotMatch(s.match(/<path class="earth-region[^>]*>/)[0],/stroke=/);
  }
  assert.ok(+outline(china,'province')>0 && +outline(china,'province')<+outline(province,'province'));
  assert.ok(+outline(near,'prefecture')>0 && +outline(near,'prefecture')<+outline(close,'prefecture'));
  assert.ok(Math.abs(+outline(near,'prefecture')-boundaryOpacity(view(12))[PREFECTURE])<1e-5);
  const index=id=>atlas.cities.find(c=>c.id===id).idx;
  assert.equal(atlas.layout.edges[index(id)],PREFECTURE);
  assert.equal(atlas.layout.edges[index('ne-USA-3521')],PROVINCE);
  assert.equal(atlas.layout.edges[index('820000')],NO_BORDER);
  assert.equal(atlas.layout.edges[atlas.cities.length],PROVINCE);
  assert.equal(atlas.layout.edges[atlas.cities.length+atlas.provinces.length],COUNTRY);
  // Same map scale on two screens: backing-store pixels must not control the fade.
  assert.deepEqual(boundaryOpacity(frame({lon:0,lat:0,zoom:12},402,406)),
    boundaryOpacity(frame({lon:0,lat:0,zoom:6},804,812)));
});

test('a grabbed point tracks a moving pinch midpoint across the date line and at high latitude',()=>{
  const w=402,h=406;
  for(const [lon,lat,zoom] of [[179.8,21,2.4],[-178.9,-68,3.1],[40,81,18],[12,-83,26],[113.6,22.2,640]]){
    const old={lon,lat,zoom}, a=unproject(208,207,frame(old,w,h));
    const truth={lon:wrap(lon+.9/zoom),lat:lat-.3/zoom,zoom:zoom*1.15};
    const [x,y]=project(unit(...a),frame(truth,w,h));
    const solved=anchored({...old,zoom:truth.zoom},a,[x,y],w,h);
    const result=project(unit(...a),frame(solved,w,h));
    assert.ok(Math.hypot(result[0]-x,result[1]-y)<.001);
    assert.ok(Math.abs(wrap(solved.lon-truth.lon))<.00001);
  }
});
