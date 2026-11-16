// Coalesce high-frequency pointer events into one DOM update per display frame.
export function frameUpdates(commit, request = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let frame = null, latest = null;
  function flush() {
    if (frame !== null) cancel(frame);
    frame = null;
    if (latest !== null) { const value = latest; latest = null; commit(value); }
  }
  return {
    queue(value) { latest = value; if (frame === null) frame = request(flush); },
    flush,
    cancel() { if (frame !== null) cancel(frame); frame = null; latest = null; }
  };
}

// Display-only, subpixel detail reduction for moving polygon boundaries. Original
// geometry is restored when the gesture ends, and always used for PNG export.
export function simplifyMapPath(path, tolerance = .2) {
  if (/[^MLZ\d.,\s-]/.test(path)) return path;
  return (path.match(/M[^M]+/g) || [path]).map(ring => {
    const points = [...ring.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
    if (points.length < 6 || !ring.endsWith('Z')) return ring;
    const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
    if (!closed) points.push(points[0]);
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]], squared = tolerance * tolerance;
    while (stack.length) {
      const [start, end] = stack.pop();
      const [ax, ay] = points[start], [bx, by] = points[end];
      const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
      let furthest = -1, maximum = squared;
      for (let i = start + 1; i < end; i++) {
        const [x, y] = points[i];
        const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
        const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
        if (distance > maximum) { maximum = distance; furthest = i; }
      }
      if (furthest !== -1) { keep[furthest] = 1; stack.push([start, furthest], [furthest, end]); }
    }
    const result = points.filter((_, index) => keep[index]);
    if (new Set(result.map(point => point.join(','))).size < 3) return ring;
    if (result[0][0] === result.at(-1)[0] && result[0][1] === result.at(-1)[1]) result.pop();
    return `M${result.map(point => point.join(',')).join('L')}Z`;
  }).join('');
}
