import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { geoConicConformal, geoPath, geoArea } from 'd3-geo';

await mkdir('.cache/geo', { recursive: true });
await mkdir('public/data', { recursive: true });
async function get(code) {
  const path = `.cache/geo/${code}_full.json`;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch {}
  const url = `https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status}: ${code}`);
      const data = await res.json();
      if (!data.features?.length) throw new Error(`Empty map ${code}`);
      await writeFile(path, JSON.stringify(data));
      return data;
    } catch (error) { if (attempt === 2) throw error; }
  }
}
const country = await get('100000');
console.log('Country features:', country.features.map(f => [f.properties.adcode, f.properties.name, f.properties.childrenNum]));
const provinceFeatures = country.features.filter(f => /^\d{6}$/.test(String(f.properties.adcode)));
const aggregate = new Set([110000, 120000, 310000, 500000, 710000, 810000, 820000]);
const children = new Map();
for (let start = 0; start < provinceFeatures.length; start += 5) {
  await Promise.all(provinceFeatures.slice(start, start + 5).map(async f => {
    const id = f.properties.adcode;
    children.set(id, aggregate.has(id) ? [f] : (await get(id)).features.filter(g => g.properties.adcode));
    console.log(f.properties.name, children.get(id).length);
  }));
}
function oriented(feature) {
  const copy = structuredClone(feature);
  if (geoArea(copy) > 2 * Math.PI) {
    if (copy.geometry.type === 'MultiPolygon') copy.geometry.coordinates.forEach(p => p.forEach(r => r.reverse()));
    if (copy.geometry.type === 'Polygon') copy.geometry.coordinates.forEach(r => r.reverse());
  }
  return copy;
}
// Keep source geometry intact; the viewport shows the mainland with a separate South China Sea inset.
const projection = geoConicConformal().parallels([25, 47]).rotate([-105, 0]).center([0, 35]).scale(900).translate([500, 350]);
const path = geoPath(projection).digits(1);
const provinces = provinceFeatures.map(f => {
  const center = f.properties.centroid || f.properties.center;
  return { id: String(f.properties.adcode), name: f.properties.name, path: path(oriented(f)), center: projection(center) };
});
const cities = provinceFeatures.flatMap(province => children.get(province.properties.adcode).map(f => {
  const shape = oriented(f);
  return {
    id: String(f.properties.adcode), name: f.properties.name,
    provinceId: String(province.properties.adcode), province: province.properties.name,
    center: projection(f.properties.centroid || f.properties.center),
    bounds: path.bounds(shape), path: path(shape),
    kind: aggregate.has(province.properties.adcode) ? 'region' : f.properties.level === 'district' ? 'direct' : 'city'
  };
}));
const decorations = country.features.filter(f => !/^\d{6}$/.test(String(f.properties.adcode))).map(f => path(oriented(f)));
const bounds = path.bounds({ type: 'FeatureCollection', features: provinceFeatures.filter(f => f.properties.adcode !== 460000).map(oriented) });
const result = { source: '阿里云 DataV.GeoAtlas', sourceUrl: 'https://datav.aliyun.com/portal/school/atlas/area_selector', fetchedAt: new Date().toISOString(), provinces, cities, decorations, bounds };
await writeFile('public/data/china.json', JSON.stringify(result));
console.log(`Saved ${provinces.length} provinces and ${cities.length} lighting units; ${(JSON.stringify(result).length / 1024).toFixed(0)} KB. Bounds: ${JSON.stringify(bounds)}`);
