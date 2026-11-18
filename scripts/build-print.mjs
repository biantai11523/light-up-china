// Build once from the checked-in fine meshes. The phone reads finished vector
// paths for the base and only the batches that contain its marked regions.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { geoStream } from 'd3-geo';
import { meshLayout } from '../src/earth/boundaries.js';
import { decodePacket } from '../src/earth/mesh.js';
import { collectCountry, MAP_WIDTH, printPolygon, worldProjection } from '../src/earth/mercator.js';

const root = new URL('../public/data/earth/', import.meta.url);
const catalogFile = new URL('atlas.json', root);
const atlas = JSON.parse(readFileSync(catalogFile));
const layout = meshLayout(atlas);
const projection = worldProjection();
const batchSize = 256;
const base = {land: {}, cut: {}, borders: []};
const batches = Array.from({length: Math.ceil(layout.regions / batchSize)}, () => ({}));

// Simplify after projection. A geographic tolerance would remove visibly more
// coastline near Greenland than near the equator at the same print resolution.
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  const last = points.length - 1;
  keep[0] = keep[last] = 1;
  const stack = [0, last];
  while (stack.length) {
    const end = stack.pop(), start = stack.pop();
    const [ax, ay] = points[start], [ex, ey] = points[end];
    const dx = ex - ax, dy = ey - ay, length2 = dx * dx + dy * dy;
    let best = tolerance ** 2, pivot = 0;
    for (let i = start + 1; i < end; i++) {
      const [x, y] = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((x-ax)*dx + (y-ay)*dy) / length2)) : 0;
      const d2 = (x-ax-t*dx)**2 + (y-ay-t*dy)**2;
      if (d2 > best) { best = d2; pivot = i; }
    }
    if (pivot) { keep[pivot] = 1; stack.push(start, pivot, pivot, end); }
  }
  return points.filter((_, i) => keep[i]);
}

function printPath(geometry, tolerance = .12) {
  let closed = false, points;
  const paths = [];
  const precision = tolerance < .02 ? 10000 : tolerance < .08 ? 1000 : 100;
  const stream = projection.stream({
    polygonStart() { closed = true; }, polygonEnd() { closed = false; },
    lineStart() { points = []; },
    point(x, y) { points.push([x, y]); },
    lineEnd() {
      let line = simplify(points, tolerance);
      if (closed && line.length < 3) line = points;
      if (line.length < (closed ? 3 : 2)) return;
      const coords = line.map(([x,y]) => Math.round(x*precision)/precision + ',' + Math.round(y*precision)/precision);
      paths.push('M' + coords.join(' ') + (closed ? 'Z' : ''));
    }
  });
  geoStream(geometry, stream);
  return paths.join('');
}

for (const file of Object.values(atlas.detail)) {
  const [tile] = decodePacket(readFileSync(new URL(file, root)), layout, true);
  for (const s of tile.shapes) {
    if (s.level === 1) continue;
    const region = s.level === 0;
    const id = region ? atlas.regions[s.idx][0] : atlas.countries[s.idx-layout.regions-layout.provinces][0];
    const geometry = printPolygon(s);
    if (region) {
      const group = batches[Math.floor(s.idx / batchSize)];
      const row = atlas.regions[s.idx];
      const span = row[7] * (MAP_WIDTH / 360) / Math.cos(row[6] * Math.PI / 180);
      // A print-scale tolerance alone can turn Macau's islands into triangles.
      group[id] = (group[id] || '') + printPath(geometry, Math.min(.12, span / 80));
    } else {
      collectCountry(base, id, s, geometry, printPath);
    }
  }
}

function save(name, paths) {
  const bytes = gzipSync(JSON.stringify(paths), {level: 9});
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const file = 'print-' + name + '-' + hash + '.mapz';
  writeFileSync(new URL(file, root), bytes);
  return file;
}
for (const [i, [id]] of atlas.regions.entries()) {
  if (!batches[Math.floor(i/batchSize)][id]) throw Error('Missing printable region ' + id);
}
for (const [id] of atlas.countries) if (!base.land[id] && !base.cut[id]) throw Error('Missing printable country ' + id);
base.borders = base.borders.join('');
atlas.print = { base: save('world', base), batchSize,
  batches: batches.map((paths, i) => save(i, paths)) };
writeFileSync(catalogFile, JSON.stringify(atlas));
const current = new Set([atlas.print.base, ...atlas.print.batches]);
for (const file of readdirSync(root)) {
  if (/^print-(world|\d+)-[0-9a-f]{10}\.mapz$/.test(file) && !current.has(file)) unlinkSync(new URL(file, root));
}
console.log('Prepared ' + atlas.countries.length + ' countries and ' + atlas.regions.length + ' regions for print.');
