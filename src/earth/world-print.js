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
  const path = geoPath(projection).digits(2);
  for (const tile of data.low) for (const shape of tile.shapes) {
    const id = data.features[shape.idx].id;
    if (!base && shape.level === 2) collectCountry(fallback, id, shape, printPolygon(shape), path);
    if (shape.level === 0 && missing.has(id)) {
      regions.set(id, (regions.get(id) || '') + (path(printPolygon(shape)) || ''));
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
  const boxes = [], labels = [], pins = [];
  function place(item, size, color, bold, offsets) {
    if (item.lat < SOUTH || item.lat > NORTH) return;
    const [x, y] = projection([item.lon, item.lat]), half = size * item.emWidth / 2 + 2;
    for (const [dx, dy] of offsets(half)) {
      const tx = x + dx, ty = y + dy;
      const box = {l: tx-half, r: tx+half, t: ty-size, b: ty+3};
      if (box.l < 3 || box.r > MAP_WIDTH-3 || box.t < 3 || box.b > MAP_HEIGHT-3) continue;
      if (boxes.some(b => b.l < box.r && b.r > box.l && b.t < box.b && b.b > box.t)) continue;
      boxes.push(box);
      labels.push(`<text x="${fixed(tx)}" y="${fixed(ty)}" font-size="${size}" font-weight="${bold ? 700 : 500}" fill="${color}">${esc(item.label)}</text>`);
      break;
    }
  }
  const center = () => [[0, 3]];
  const offsets = half => [[half + 4, 3], [-half - 4, 3], [0, -6], [0, 13]];
  for (const {item, ink, pin, emphasized} of marks) if (pin) {
    const [x, y] = projection([item.lon, item.lat]);
    pins.push(`<circle data-pin="${esc(item.id)}" cx="${fixed(x)}" cy="${fixed(y)}" r="2.7" fill="${ink}" stroke="${emphasized ? '#344334' : '#9aa99b'}" stroke-width=".75"/>`);
    boxes.push({l: x-2.7, r: x+2.7, t: y-2.7, b: y+2.7});
  }
  // Selected regions get first choice of label positions. All pins are drawn
  // independently so a crowded label cannot erase a small recorded place.
  for (const {item, pin, emphasized} of [...marks].reverse()) {
    if (emphasized) place(item, 10, '#294033', true, pin || sizeOnMap(item) < item.emWidth*10+8 ? offsets : center);
  }
  const countries = data.countries.filter(item => sizeOnMap(item) > 32).sort((a,b) => b.span-a.span);
  for (const item of countries) {
    const large = sizeOnMap(item) >= 115;
    place(item, large ? 14 : 10.5, '#505f50', large, center);
  }
  for (const [label, lon, lat] of [['太平洋', -151, -9], ['大西洋', -14, -25], ['印度洋', 77, -27], ['北冰洋', 98, 82]]) {
    place({label, lon, lat, emWidth: label.length}, 15, '#6a8b7c', false, center);
  }
  return `<g text-anchor="middle" paint-order="stroke" stroke="#f6f6ee" stroke-opacity=".84" stroke-width="1.9" stroke-linejoin="round">${labels.join('')}</g>${pins.join('')}`;
}

export async function prepareWorldMap(data, paints, selected) {
  const marks = [];
  for (const id of new Set([...paints.keys(), ...selected])) {
    const item = data.byId.get(id);
    if (!item) continue;
    const on = selected.has(id), paint = paints.get(id);
    marks.push({item, on, emphasized: on || !!paint?.emphasized, category: paint?.category || '',
      ink: on ? '#ff976f' : paint.fill, pin: sizeOnMap(item) < 7});
  }
  marks.sort((a,b) => Number(a.on)-Number(b.on) || Number(a.emphasized)-Number(b.emphasized) || b.item.span-a.item.span || a.item.idx-b.item.idx);
  const {base, regions, coarse} = await printGeometry(data, marks);
  const landPaths = paths => Object.entries(paths).map(([id, d]) =>
    `<path data-country="${esc(id)}" d="${d}"/>`).join('');
  const ground = use('print-land');
  const footprints = marks.map(({item, category, ink}) =>
    `<path data-city="${esc(item.id)}" data-profile-category="${category}" fill="${ink}" d="${regions.get(item.id) || ''}"/>`).join('');
  const body = `<defs><g id="print-land">${landPaths(base.land)}</g></defs>
    <rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#d4e4d9"/>${grid()}
    <g fill="#f8f7ef">${ground}${landPaths(base.cut)}</g>${footprints}
    <g data-boundary="country" fill="none" stroke="#566453" stroke-width=".6" stroke-linejoin="round">${ground}<path d="${base.borders}"/></g>
    ${annotations(data, marks)}`;
  return {width: MAP_WIDTH, height: MAP_HEIGHT, body, coarse};
}
