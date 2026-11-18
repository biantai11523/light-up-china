import { geoPath } from 'd3-geo';
import { escapeHtml as esc } from '../store.js';
import { collectCountry, MAP_HEIGHT, MAP_WIDTH, NORTH, SOUTH, printPolygon, worldProjection } from './mercator.js';

const projection = worldProjection();
const sizeOnMap = item => item.span * (MAP_WIDTH / 360) / Math.cos(item.lat * Math.PI / 180);
const fixed = n => Number(n.toFixed(2));
const use = id => `<use href="#${id}" xlink:href="#${id}"/>`;

async function printGeometry(data, marks) {
  const manifest = data.raw.print;
  const groups = new Map();
  if (manifest) for (const {item} of marks) {
    const file = manifest.batches[Math.floor(item.idx / manifest.batchSize)];
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file).push(item.id);
  }
  const files = manifest ? [manifest.base, ...groups.keys()] : [];
  const results = await Promise.allSettled(files.map(file => data.readPrintFile(file)));
  const base = results[0]?.value;
  const regions = new Map();
  [...groups.values()].forEach((ids, i) => {
    const batch = results[i + 1]?.value;
    if (batch) for (const id of ids) if (batch[id]) regions.set(id, batch[id]);
  });
  const missing = new Set(marks.filter(({item}) => !regions.has(item.id)).map(({item}) => item.id));
  if (base && !missing.size) return {base, regions, coarse: false};

  // The global mesh is already resident, including the opposite hemisphere.
  // A missing print batch only reduces detail for the affected paths.
  const fallback = {land: {}, cut: {}, borders: []};
  const path = geoPath(projection).digits(2), regionPath = geoPath(projection).digits(4);
  for (const tile of data.low) for (const shape of tile.shapes) {
    const id = data.features[shape.idx].id;
    if (!base && shape.level === 2) collectCountry(fallback, id, shape, printPolygon(shape), path);
    if (shape.level === 0 && missing.has(id)) {
      regions.set(id, (regions.get(id) || '') + (regionPath(printPolygon(shape)) || ''));
    }
  }
  fallback.borders = fallback.borders.join('');
  return {base: base || fallback, regions, coarse: true};
}

function grid() {
  const lines = [];
  for (let lon = -150; lon <= 180; lon += 30) {
    const [x] = projection([lon, 0]);
    if (x > 1 && x < MAP_WIDTH - 1) lines.push(`M${fixed(x)},0V${MAP_HEIGHT}`);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = projection([0, lat]);
    lines.push(`M0,${fixed(y)}H${MAP_WIDTH}`);
  }
  return `<path d="${lines.join('')}" fill="none" stroke="#9db8a9" stroke-width=".55"/>`;
}

function annotations(data, marks) {
  const boxes = [], labels = [];
  function place(item, size, color, bold, gap = 0) {
    if (item.lat < SOUTH || item.lat > NORTH) return;
    const [x, y] = projection([item.lon, item.lat]), half = size * item.emWidth / 2 + 2;
    const side = half + gap + 2, above = -gap - 4, below = gap + size + 2;
    const offsets = gap ? [[side,3],[-side,3],[0,above],[0,below],[side,above],[-side,above],[side,below],[-side,below]] : [[0,3]];
    for (const [dx, dy] of offsets) {
      const tx = x + dx, ty = y + dy;
      const box = {l: tx-half, r: tx+half, t: ty-size, b: ty+3};
      if (box.l < 3 || box.r > MAP_WIDTH-3 || box.t < 3 || box.b > MAP_HEIGHT-3) continue;
      if (boxes.some(b => b.l < box.r && b.r > box.l && b.t < box.b && b.b > box.t)) continue;
      boxes.push(box);
      labels.push(`<text x="${fixed(tx)}" y="${fixed(ty)}" font-size="${size}" font-weight="${bold ? 700 : 500}" fill="${color}">${esc(item.label)}</text>`);
      break;
    }
  }
  // Reserve the small coloured areas themselves before placing any names.
  for (const {item, gap} of marks) if (gap) {
    const [x, y] = projection([item.lon, item.lat]);
    boxes.push({l: x-gap, r: x+gap, t: y-gap, b: y+gap});
  }
  for (const {item, gap, emphasized} of [...marks].reverse()) {
    if (emphasized) place(item, 10, '#294033', true, gap);
  }
  const countries = data.countries.filter(item => sizeOnMap(item) > 32).sort((a,b) => b.span-a.span);
  for (const item of countries) {
    const large = sizeOnMap(item) >= 115;
    place(item, large ? 14 : 10.5, '#505f50', large);
  }
  for (const [label, lon, lat] of [['太平洋', -151, -9], ['大西洋', -14, -25], ['印度洋', 77, -27], ['北冰洋', 98, 82]]) {
    place({label, lon, lat, emWidth: label.length}, 15, '#6a8b7c', false);
  }
  return `<g text-anchor="middle" paint-order="stroke" stroke="#f6f6ee" stroke-opacity=".84" stroke-width="1.9" stroke-linejoin="round">${labels.join('')}</g>`;
}

export async function prepareWorldMap(data, paints, selected) {
  const marks = [];
  for (const id of new Set([...paints.keys(), ...selected])) {
    const item = data.byId.get(id);
    if (!item) continue;
    const on = selected.has(id), paint = paints.get(id);
    const span = sizeOnMap(item);
    const gap = span < item.emWidth*10+8 ? Math.min(12, 1+span/2) : 0;
    marks.push({item, on, emphasized: on || !!paint?.emphasized, category: paint?.category || '',
      ink: on ? '#ff976f' : paint.fill, gap, span});
  }
  marks.sort((a,b) => Number(a.on)-Number(b.on) || Number(a.emphasized)-Number(b.emphasized) || b.item.span-a.item.span || a.item.idx-b.item.idx);
  const {base, regions, coarse} = await printGeometry(data, marks);
  const landPaths = paths => Object.entries(paths).map(([id, d]) =>
    `<path data-country="${esc(id)}" d="${d}"/>`).join('');
  const ground = use('print-land');
  const footprints = [], smallFootprints = [];
  for (const {item, category, ink, span} of marks) {
    // A coastline stroke can cover an entire microstate. Keep its true fill visible.
    const paths = span < 7 ? smallFootprints : footprints;
    paths.push(`<path data-city="${esc(item.id)}" data-profile-category="${category}" fill="${ink}" d="${regions.get(item.id) || ''}"/>`);
  }
  const body = `<defs><g id="print-land">${landPaths(base.land)}</g></defs>
    <rect x="-1" y="-1" width="${MAP_WIDTH+2}" height="${MAP_HEIGHT+2}" fill="#d4e4d9"/>${grid()}
    <g fill="#f8f7ef">${ground}${landPaths(base.cut)}</g>${footprints.join('')}
    <g data-boundary="country" fill="none" stroke="#566453" stroke-width=".6" stroke-linejoin="round">${ground}<path d="${base.borders}"/></g>
    ${smallFootprints.join('')}${annotations(data, marks)}`;
  return {width: MAP_WIDTH, height: MAP_HEIGHT, body, coarse};
}
