// SVG uses xMidYMid meet. Include the letterboxing when placing labels in CSS pixels.
export const MAP_BOX = { x: 110, y: 25, width: 720, height: 610 };
// Each doubling of map scale adds two screen pixels to city names.
export function labelPixels(type, zoom) {
  const levels = Math.log2(Math.max(1, zoom));
  return type === 'city' ? 11 + 2 * levels : 10.5 + 1.5 * levels;
}

export function mapViewport(width, height) {
  const scale = Math.min(width / MAP_BOX.width, height / MAP_BOX.height);
  return {
    width, height, scale,
    left: (width - MAP_BOX.width * scale) / 2 - MAP_BOX.x * scale,
    top: (height - MAP_BOX.height * scale) / 2 - MAP_BOX.y * scale
  };
}

// Earlier candidates have priority. Chinese map labels use full-width characters.
export function placeLabels(candidates, viewport, transform) {
  // The compass occupies the same corner on the interactive map and in exports.
  const boxes = [{ left: viewport.width - 38, right: viewport.width - 7, top: 0, bottom: 50 }];
  const visible = { city: [], province: [] };
  const fonts = { city: labelPixels('city', transform.k), province: labelPixels('province', transform.k) };
  for (const label of candidates) {
    const [cx, cy] = label.center;
    const x = (cx * transform.k + transform.x) * viewport.scale + viewport.left;
    const y = (cy * transform.k + transform.y) * viewport.scale + viewport.top;
    const font = fonts[label.type];
    const city = label.type === 'city';
    const half = label.name.length * font / 2 + (city ? 3 : 1.5);
    const box = { left: x - half, right: x + half, top: y - font - (city ? 2 : 1), bottom: y + (city ? 4 : 2) };
    if (box.left < 0 || box.right > viewport.width || box.top < 0 || box.bottom > viewport.height) continue;
    if (boxes.some(b => b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top)) continue;
    boxes.push(box);
    visible[label.type].push(label);
  }
  return visible;
}
