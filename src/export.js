import { escapeHtml } from './store.js';

const FONT = "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
const COLORS = { ink: '#252a24', paper: '#f6f5ed', unlit: '#f8f7ef', green: '#c5f567', selected: '#ff976f' };

// Copy only the map SVG. Inline every paint attribute so the saved image has no
// stylesheet, font URL, CDN, or foreignObject dependency.
export function standaloneMap(svg, { width, height }) {
  const copy = svg.cloneNode(true);
  copy.removeAttribute('class');
  copy.removeAttribute('role');
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('overflow', 'hidden');
  copy.querySelectorAll('title').forEach(el => el.remove());
  copy.querySelectorAll('.city-shape').forEach(el => {
    const selected = el.classList.contains('is-selected');
    const lit = el.classList.contains('is-lit');
    attributes(el, { fill: selected ? COLORS.selected : lit ? COLORS.green : COLORS.unlit,
      stroke: selected ? COLORS.ink : lit ? '#6b7b51' : '#929986',
      'stroke-width': selected ? 1.4 : .5, 'vector-effect': 'non-scaling-stroke' });
  });
  copy.querySelectorAll('.province-shape').forEach(el => attributes(el, {
    fill: 'none', stroke: '#3b4436', 'stroke-width': 1.15,
    'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round'
  }));
  copy.querySelectorAll('.map-decoration').forEach(el => attributes(el, {
    fill: COLORS.ink, stroke: COLORS.ink, 'stroke-width': .5, 'vector-effect': 'non-scaling-stroke'
  }));
  copy.querySelectorAll('text').forEach(el => {
    const city = el.classList.contains('map-city-label');
    const labelGroup = el.parentElement;
    attributes(el, { 'font-family': FONT,
      'font-size': city ? (labelGroup.getAttribute('font-size') || 8) : 10,
      'font-weight': city ? 500 : 600, fill: city ? '#30392b' : '#4c5348',
      stroke: COLORS.unlit, 'stroke-width': city ? (labelGroup.getAttribute('stroke-width') || 1.3) : 2,
      'text-anchor': 'middle', 'paint-order': 'stroke', 'stroke-linejoin': 'round' });
  });
  // Bake non-scaling strokes into user units. This keeps borders the same width
  // in browsers and rasterizers that do not implement SVG vector-effect.
  const [, , viewWidth, viewHeight] = copy.getAttribute('viewBox').split(/\s+/).map(Number);
  const viewportScale = Math.min(width / viewWidth, height / viewHeight);
  copy.querySelectorAll('[vector-effect="non-scaling-stroke"]').forEach(el => {
    let scale = viewportScale;
    for (let parent = el.parentElement; parent && parent !== copy; parent = parent.parentElement) {
      const transformScale = parent.getAttribute('transform')?.match(/scale\(\s*([\d.e+-]+)/i);
      if (transformScale) scale *= Number(transformScale[1]);
    }
    el.setAttribute('stroke-width', String(Number(el.getAttribute('stroke-width')) / scale));
    el.removeAttribute('vector-effect');
  });
  return copy;
}

function attributes(element, values) {
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, String(value));
}

export function createMapSnapshot(container, summary, { date = new Date(), demo = false, offline = false } = {}) {
  const stage = container.querySelector('.map-stage');
  const rect = stage.getBoundingClientRect();
  const width = Math.round(rect.width || 700);
  const stageHeight = Math.round(rect.height || 490);
  const height = stageHeight + 150;
  const mapRect = container.querySelector('.map-svg').getBoundingClientRect();
  const mapHeight = Math.round(mapRect.height || stageHeight - 100);
  const mapWidth = Math.round(mapRect.width || width);
  const map = standaloneMap(container.querySelector('.map-svg'), { width: mapWidth, height: mapHeight });
  attributes(map, { x: 0, y: 84, width: mapWidth, height: mapHeight });
  const insetRect = container.querySelector('.sea-inset').getBoundingClientRect();
  const insetWidth = Math.round(insetRect.width || (width < 500 ? 62 : 83));
  const insetHeight = Math.round(insetRect.height || (width < 500 ? 87 : 119));
  const inset = standaloneMap(container.querySelector('.sea-inset svg'), { width: insetWidth - 2, height: insetHeight - 18 });
  const insetX = insetRect.width ? insetRect.left - rect.left : width - insetWidth - 15;
  const insetY = 84 + (insetRect.height ? insetRect.top - rect.top : stageHeight - insetHeight - 17);
  attributes(inset, { x: insetX + 1, y: insetY + 1, width: insetWidth - 2, height: insetHeight - 18 });
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const stamp = `${demo ? '示例 · ' : ''}${offline ? '离线缓存 · ' : ''}${day}`;
  const legendY = stageHeight + 103;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeHtml(FONT)}">
    <defs><pattern id="export-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#c5c7bb"/></pattern></defs>
    <rect width="${width}" height="${height}" fill="${COLORS.paper}"/>
    <rect x="0" y="0" width="${width}" height="84" fill="#fffef8"/>
    <text x="16" y="29" font-size="19" font-weight="800" fill="${COLORS.ink}">城市点亮地图</text>
    <text x="16" y="49" font-size="10" fill="#666d60">${escapeHtml(stamp)}</text>
    <text x="16" y="70" font-size="11" fill="${COLORS.ink}">全图已点亮 ${summary.count} / ${summary.total} 个地区 · ${summary.provinces} 个省级区域</text>
    <rect y="84" width="${width}" height="${stageHeight}" fill="#eeede5"/>
    <rect y="84" width="${width}" height="${stageHeight}" fill="url(#export-dots)"/>
    ${map.outerHTML}
    <text x="${width - 24}" y="103" font-size="9" text-anchor="middle" fill="${COLORS.ink}">N</text>
    <path d="M${width - 24} 110 l-5 17 10-2 Z" fill="${COLORS.ink}"/>
    <rect x="${insetX}" y="${insetY}" width="${insetWidth}" height="${insetHeight}" fill="${COLORS.paper}" stroke="${COLORS.ink}" stroke-width="1.5"/>
    ${inset.outerHTML}
    <path d="M${insetX} ${insetY + insetHeight - 16}h${insetWidth}" stroke="${COLORS.ink}"/>
    <text x="${insetX + insetWidth / 2}" y="${insetY + insetHeight - 5}" text-anchor="middle" font-size="8" fill="${COLORS.ink}">南海诸岛</text>
    <path d="M0 84H${width}M0 ${stageHeight + 84}H${width}" stroke="${COLORS.ink}" stroke-width="1.5"/>
    ${[[16,COLORS.green,'已点亮'],[99,COLORS.unlit,'未点亮'],[182,COLORS.selected,'选中']].map(([x,fill,label]) => `<rect x="${x}" y="${legendY - 8}" width="10" height="10" fill="${fill}" stroke="${COLORS.ink}"/><text x="${x + 16}" y="${legendY + 1}" font-size="10" fill="${COLORS.ink}">${label}</text>`).join('')}
    <path d="M16 ${legendY + 18}h20" stroke="#3b4436" stroke-width="1.6"/><text x="42" y="${legendY + 21}" font-size="9" fill="#626b5a">省界</text>
    <path d="M87 ${legendY + 18}h20" stroke="#929986" stroke-width=".7"/><text x="113" y="${legendY + 21}" font-size="9" fill="#626b5a">市界</text>
    <text x="16" y="${height - 9}" font-size="8" fill="#757d6d">边界数据：DataV.GeoAtlas</text>
  </svg>`;
  const scale = Math.min(3, 3840 / Math.max(width, height));
  return { svg, width, height, pixelWidth: Math.round(width * scale), pixelHeight: Math.round(height * scale),
    filename: `城市点亮地图-${demo ? '示例-' : ''}${day}.png` };
}

export async function renderMapPng(snapshot, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  const url = URL.createObjectURL(new Blob([snapshot.svg], { type: 'image/svg+xml;charset=utf-8' }));
  const canvas = document.createElement('canvas');
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      const fail = error => { cleanup(); reject(error); };
      const abort = () => fail(new DOMException('已取消', 'AbortError'));
      const timeout = setTimeout(() => fail(new Error('生成图片超时，请重试')), 15000);
      function cleanup() { clearTimeout(timeout); signal?.removeEventListener('abort', abort); img.onload = null; img.onerror = null; }
      img.onload = () => { cleanup(); resolve(); };
      img.onerror = () => fail(new Error('图片生成失败，请重试'));
      signal?.addEventListener('abort', abort, { once: true });
      img.src = url;
    });
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    canvas.width = snapshot.pixelWidth;
    canvas.height = snapshot.pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持图片导出，请更换浏览器');
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 生成失败，请重试')), 'image/png'));
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 1;
  }
}

export function downloadFile(url, filename) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
