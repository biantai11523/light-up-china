import { escapeHtml } from './store.js';
import { PROFILES, PROFILE_PATTERNS } from './profiles.js';

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
  copy.querySelectorAll('defs').forEach(el => el.remove());
  copy.querySelectorAll('.city-shape').forEach(el => {
    const selected = el.classList.contains('is-selected');
    const lit = el.classList.contains('is-lit');
    attributes(el, { fill: selected ? COLORS.selected : el.dataset.paintFill || (lit ? COLORS.green : COLORS.unlit),
      stroke: selected ? COLORS.ink : el.dataset.paintStroke || (lit ? '#6b7b51' : '#929986'),
      'stroke-width': selected ? 1 : .3, 'vector-effect': 'non-scaling-stroke',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    el.style.removeProperty('fill');el.style.removeProperty('stroke');el.style.removeProperty('stroke-width');
  });
  copy.querySelectorAll('.province-shape').forEach(el => attributes(el, {
    fill: 'none', stroke: '#3b4436', 'stroke-width': .8,
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

export function exportDimensions(width, height, longEdge = 4096) {
  const maxPixels = 12000000;
  const scale = Math.min(longEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  let pixelWidth = Math.max(1, Math.round(width * scale));
  let pixelHeight = Math.max(1, Math.round(height * scale));
  if (pixelWidth * pixelHeight > maxPixels) {
    if (pixelWidth >= pixelHeight) pixelHeight = Math.floor(maxPixels / pixelWidth);
    else pixelWidth = Math.floor(maxPixels / pixelHeight);
  }
  return { pixelWidth, pixelHeight };
}

export function createMapSnapshot(container, summary, { date = new Date(), demo = false, offline = false, view = 'together' } = {}) {
  const stage = container.querySelector('.map-stage');
  const rect = stage.getBoundingClientRect();
  const width = Math.round(rect.width || 700);
  const stageHeight = Math.round(rect.height || 490);
  const height = stageHeight + 150;
  const { pixelWidth, pixelHeight } = exportDimensions(width, height);
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
  const viewName=view==='all'?'完整视图':PROFILES[view].label;
  const legend=[{label:'一起',fill:PROFILES.together.color},{label:'轩宝',fill:PROFILES.xuan.color},{label:'曦宝',fill:PROFILES.xi.color},{label:'分别去过',fill:'url(#personal-both)'},{label:'未去过',fill:COLORS.unlit},{label:'选中',fill:COLORS.selected}];
  // Give the SVG its final pixel dimensions before image decoding. Drawing a
  // phone-sized SVG image onto a larger canvas can otherwise blur in some engines.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${width} ${height}" font-family="${escapeHtml(FONT)}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
    <defs>${PROFILE_PATTERNS}</defs>
    <rect width="${width}" height="${height}" fill="${COLORS.paper}"/>
    <rect x="0" y="0" width="${width}" height="84" fill="#fffef8"/>
    <text x="16" y="29" font-size="19" font-weight="800" fill="${COLORS.ink}">${viewName}</text>
    <text x="16" y="49" font-size="10" fill="#666d60">${escapeHtml(stamp)}</text>
    <text x="16" y="70" font-size="11" fill="${COLORS.ink}">${view==='all'?'全部':'当前分类'} ${summary.count} / ${summary.total} 个地区 · ${summary.provinces} 个省级区域</text>
    <rect y="84" width="${width}" height="${stageHeight}" fill="${COLORS.paper}"/>
    ${map.outerHTML}
    <text x="${width - 24}" y="103" font-size="9" text-anchor="middle" fill="${COLORS.ink}">N</text>
    <path d="M${width - 24} 110 l-5 17 10-2 Z" fill="${COLORS.ink}"/>
    <rect x="${insetX}" y="${insetY}" width="${insetWidth}" height="${insetHeight}" fill="${COLORS.paper}" stroke="${COLORS.ink}" stroke-width="1.5"/>
    ${inset.outerHTML}
    <path d="M${insetX} ${insetY + insetHeight - 16}h${insetWidth}" stroke="${COLORS.ink}"/>
    <text x="${insetX + insetWidth / 2}" y="${insetY + insetHeight - 5}" text-anchor="middle" font-size="8" fill="${COLORS.ink}">南海诸岛</text>
    <path d="M0 84H${width}M0 ${stageHeight + 84}H${width}" stroke="${COLORS.ink}" stroke-width="1.5"/>
    ${legend.map(({fill,label},index)=>{const col=index%3,row=Math.floor(index/3),x=16+col*((width-32)/3),y=legendY+row*20;return `<rect x="${x}" y="${y-8}" width="10" height="10" fill="${fill}" stroke="${COLORS.ink}" stroke-width=".7"/><text x="${x+16}" y="${y+1}" font-size="9" fill="${COLORS.ink}">${label}</text>`;}).join('')}
    <text x="16" y="${height - 9}" font-size="8" fill="#757d6d">边界数据：DataV.GeoAtlas</text>
  </svg>`;
  const name = `城市点亮地图-${view==='all'?'完整':PROFILES[view].short}-${demo ? '示例-' : ''}${day}`;
  return { svg, width, height, pixelWidth, pixelHeight, filename: `${name}.png`, svgFilename: `${name}.svg` };
}

export function createMapSvgBlob(snapshot) {
  return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', snapshot.svg], { type: 'image/svg+xml;charset=utf-8' });
}

export async function renderMapPng(snapshot, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  const url = URL.createObjectURL(createMapSvgBlob(snapshot));
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
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 生成失败，请重试')), 'image/png'));
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    return blob;
  } finally {
    img.src = '';
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
