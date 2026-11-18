import { escapeHtml } from './store.js';
import { PROFILES, PROFILE_PATTERNS } from './profiles.js';
import { CENTRAL_MERIDIAN, NORTH, SOUTH } from './earth/mercator.js';

const FONT = "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif";

export function exportDimensions(width, height, longEdge = 4096) {
  const maxPixels = 14000000;
  const scale = Math.min(longEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  let pixelWidth = Math.max(1, Math.round(width * scale));
  let pixelHeight = Math.max(1, Math.round(height * scale));
  if (pixelWidth * pixelHeight > maxPixels) {
    if (pixelWidth >= pixelHeight) pixelHeight = Math.floor(maxPixels / pixelWidth);
    else pixelWidth = Math.floor(maxPixels / pixelHeight);
  }
  return { pixelWidth, pixelHeight };
}

export function createMapSnapshot(map, { date = new Date(), demo = false, offline = false, view = 'together' } = {}) {
  const {width, height, body} = map;
  const {pixelWidth, pixelHeight} = exportDimensions(width, height);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const stamp = [demo && '示例', offline && '离线缓存', map.coarse && '概览边界', day].filter(Boolean).join(' · ');
  const viewName = view === 'all' ? '完整视图' : PROFILES[view].label;
  // Metadata travels with the file. Every visible pixel belongs to the map.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" data-projection="mercator" data-central-meridian="${CENTRAL_MERIDIAN}" data-view="${view}" font-family="${escapeHtml(FONT)}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
    <title>${viewName} · 世界足迹地图</title><desc>${stamp}。墨卡托投影，中央经线 ${CENTRAL_MERIDIAN}°E，${NORTH}°N 至 ${Math.abs(SOUTH)}°S。边界来自 DataV.GeoAtlas / Natural Earth。</desc>
    <defs>${PROFILE_PATTERNS}</defs>${body}
  </svg>`;
  const name = `世界足迹地图-${view === 'all' ? '完整' : PROFILES[view].short}-${demo ? '示例-' : ''}${day}`;
  return {svg, width, height, pixelWidth, pixelHeight, coarse:map.coarse, filename:`${name}.png`, svgFilename:`${name}.svg`};
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
