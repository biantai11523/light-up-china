import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { geoPath } from 'd3-geo';
import { MAP_WIDTH, MAP_HEIGHT, NORTH, SOUTH, geographicOutline, worldProjection, printPolygon } from '../src/earth/mercator.js';
import { prepareWorldMap } from '../src/earth/world-print.js';
import { decodePacket } from '../src/earth/mesh.js';
import { catalog } from '../src/earth/atlas.js';

const root = new URL('../public/data/earth/', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('atlas.json', root)));
function readPrint(name) {
  const bytes = readFileSync(new URL(name, root));
  assert.ok(name.endsWith(createHash('sha256').update(bytes).digest('hex').slice(0,10) + '.mapz'));
  return JSON.parse(gunzipSync(bytes));
}

test('Pacific-centred Mercator clips at the Atlantic, preserves the date line and does not bow long parallels', () => {
  const p = worldProjection(), x = lon => p([lon,0])[0], y = lat => p([0,lat])[1];
  assert.equal(x(150), MAP_WIDTH/2);
  assert.ok(x(10)<x(105) && x(105)<x(150) && x(150)<x(-120));
  assert.ok(x(-30.001)>MAP_WIDTH-1 && x(-29.999)<1);
  assert.ok(Math.abs(x(179.999)-x(-179.999))<.01);
  assert.ok(Math.abs(y(NORTH))<.001 && Math.abs(y(SOUTH)-MAP_HEIGHT)<1);
  assert.ok(y(60)-y(70)>2*(y(0)-y(10)));
  const path = geoPath(p);
  const cross = {type:'Polygon',coordinates:[[[-31,-5],[-31,5],[-29,5],[-29,-5],[-31,-5]]]};
  assert.equal(path(cross).split('M').length-1,2);
  assert.ok(path.area(cross)>300 && path.area(cross)<330);
  assert.ok(!path({type:'Point',coordinates:[0,89]}));
  const originalCut = {type:'Polygon',coordinates:[[[180,5],[179,5],[179,8],[180,8],[180,5]]]};
  for(const line of geographicOutline(originalCut).coordinates) {
    assert.ok(!line.some((b,i)=>i && Math.abs(b[0])===180 && Math.abs(line[i-1][0])===180));
  }
  const parallel = printPolygon({geometry:{type:'Polygon',coordinates:[[[-122,49],[-95,49],[-95,48],[-122,48],[-122,49]]]}});
  const ring = parallel.coordinates[0];
  const line = ring.slice(0,ring.findIndex(point=>point[1]!==49));
  const box=path.bounds({type:'LineString',coordinates:line});
  assert.ok(box[1][1]-box[0][1]<.12);
});

test('the print assets cover every selectable region and all country coastlines', () => {
  const base=readPrint(raw.print.base), batches=raw.print.batches.map(readPrint);
  assert.equal(new Set([...Object.keys(base.land),...Object.keys(base.cut)]).size,raw.countries.length);
  for(const [i,[id]] of raw.regions.entries()) {
    const d=batches[Math.floor(i/raw.print.batchSize)][id];
    assert.ok(d.startsWith('M') && d.endsWith('Z') && !/NaN|Infinity/.test(d),id);
  }
  const macau=raw.regions.findIndex(([id])=>id==='820000');
  const parts=batches[Math.floor(macau/raw.print.batchSize)]['820000'].match(/M[^Z]+Z/g);
  assert.ok(parts.length>=2 && parts.every(ring=>ring.split(' ').length>8), 'the peninsula and islands retain their coastlines');
});

test('unavailable print assets fall back to local world geometry and recover on the next export', async () => {
  const data=catalog(raw);
  data.byId=new Map(data.cities.map(c=>[c.id,c]));
  data.low=decodePacket(readFileSync(new URL(raw.base,root)),data.layout,true);
  const id='820000', ca='ne-USA-3521', paints=new Map([[ca,{fill:'#9ed9c5',category:'xuan'}]]);
  let fail=true;
  const requests=[];
  data.readPrintFile=async file=>{
    requests.push(file);
    if(fail)throw Error('Offline');
    return readPrint(file);
  };
  const fallback=await prepareWorldMap(data,paints,new Set([id]));
  assert.equal(fallback.coarse,true);
  for(const code of [id,ca])assert.ok(fallback.body.includes('data-city="'+code+'"'));
  assert.ok(fallback.body.includes('data-country="BRA"'));
  assert.doesNotMatch(fallback.body,/<circle\b|data-pin=/);
  fail=false;requests.length=0;
  const fine=await prepareWorldMap(data,paints,new Set([id]));
  assert.equal(fine.coarse,false);assert.equal(requests.length,3);
  assert.ok(fine.body.includes('data-country="GRL"') && fine.body.includes('data-city="'+ca+'"'));
  assert.doesNotMatch(fine.body,/<circle\b|data-pin=/);
  assert.ok(fine.body.indexOf('data-city="820000"') > fine.body.indexOf('data-boundary="country"'));
  const macau=data.byId.get(id), [cx,cy]=worldProjection()([macau.lon,macau.lat]);
  const label=fine.body.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>澳门<\/text>/);
  assert.ok(label && (Math.abs(+label[1]-cx)>macau.emWidth*5+1 || +label[2]+3<cy || +label[2]-10>cy));
});
