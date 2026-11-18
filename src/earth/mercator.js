import { geoMercator } from 'd3-geo';
import { polygon } from './mesh.js';

// The Pacific-centred atlas layout puts its cut in the Atlantic, at 30°W.
export const CENTRAL_MERIDIAN = 150;
export const NORTH = 84;
export const SOUTH = -78;
export const MAP_WIDTH = 1440;
const rad = Math.PI / 180;
const scale = MAP_WIDTH / (2 * Math.PI);
const northing = latitude => scale * Math.asinh(Math.tan(latitude * rad));
const equator = northing(NORTH);
export const MAP_HEIGHT = Math.ceil(equator - northing(SOUTH));

export function worldProjection() {
  return geoMercator().rotate([-CENTRAL_MERIDIAN, 0])
    .scale(scale).translate([MAP_WIDTH / 2, equator])
    .clipExtent([[0, 0], [MAP_WIDTH, equator - northing(SOUTH)]]).precision(.12);
}

export function printPolygon(shape) {
  // The source meshes simplify straight segments in longitude/latitude. Keep
  // long political parallels such as the US–Canada border straight in Mercator.
  const coordinates = polygon(shape).coordinates.map(ring => {
    const result = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i-1], b = ring[i];
      const dx = ((b[0] - a[0] + 540) % 360) - 180, dy = b[1] - a[1];
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
      for (let k = 1; k < steps; k++) result.push([a[0]+dx*k/steps, a[1]+dy*k/steps]);
      result.push(b);
    }
    return result;
  });
  return {type: 'Polygon', coordinates};
}

// Natural Earth's source polygons are already split at ±180°. The filled halves
// meet inside this map. Draw only real edges so the original cut has no ink.
export function geographicOutline(polygon) {
  const lines = [];
  for (const ring of polygon.coordinates) {
    let part = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      if (Math.abs(Math.abs(a[0]) - 180) < .0001 && Math.abs(Math.abs(b[0]) - 180) < .0001) {
        if (part.length > 1) lines.push(part);
        part = [];
      }
      part.push(b);
    }
    if (part.length > 1) lines.push(part);
  }
  return { type: 'MultiLineString', coordinates: lines };
}

export function collectCountry(base, id, shape, geometry, path) {
  const [w, s, e, n] = shape.box, seam = CENTRAL_MERIDIAN - 180;
  const cut = w <= -179.9999 || e >= 179.9999 || (w <= seam && seam <= e) || n >= NORTH || s <= SOUTH;
  const paths = cut ? base.cut : base.land;
  paths[id] = (paths[id] || '') + (path(geometry) || '');
  // Everywhere else the same closed path serves as both land and border.
  if (cut) base.borders.push(path(geographicOutline(geometry)) || '');
}
