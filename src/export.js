import { escapeHtml } from './store.js';
import { PROFILES } from './profiles.js';

const FONT = "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
const COLORS = { ink: '#252a24', paper: '#f6f5ed', unlit: '#f8f7ef', green: '#c5f567', selected: '#ff976f' };

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

export function createMapSnapshot(globe, summary, { date = new Date(), demo = false, offline = false, view = 'together' } = {}) {
  const { width, height: stageHeight, body } = globe;
  const height = stageHeight + 150;
  const { pixelWidth, pixelHeight } = exportDimensions(width, height);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const stamp = `${demo ? '示例 · ' : ''}${offline ? '离线缓存 · ' : ''}${globe.coarse ? '概览边界 · ' : ''}${day}`;
  const legendY = stageHeight + 103;
  const viewName=view==='all'?'完整视图':PROFILES[view].label;
  const legend=[{label:'一起',fill:PROFILES.together.color},{label:'轩宝',fill:PROFILES.xuan.color},{label:'曦宝',fill:PROFILES.xi.color},{label:'分别去过',fill:'url(#personal-both)'},{label:'未去过',fill:COLORS.unlit},{label:'选中',fill:COLORS.selected}];
  // Give the SVG its final pixel dimensions before image decoding. Drawing a
  // phone-sized SVG image onto a larger canvas can otherwise blur in some engines.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${width} ${height}" font-family="${escapeHtml(FONT)}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">

    <rect width="${width}" height="${height}" fill="${COLORS.paper}"/>
    <rect x="0" y="0" width="${width}" height="84" fill="#fffef8"/>
    <text x="16" y="29" font-size="19" font-weight="800" fill="${COLORS.ink}">${viewName}</text>
    <text x="16" y="49" font-size="10" fill="#666d60">${escapeHtml(stamp)}</text>
    <text x="16" y="70" font-size="11" fill="${COLORS.ink}">${view==='all'?'全部':'当前分类'} ${summary.count} / ${summary.total} 个地区 · ${summary.countries || 0} 个国家和地区</text>
    <rect y="84" width="${width}" height="${stageHeight}" fill="${COLORS.paper}"/>
    <svg x="0" y="84" width="${width}" height="${stageHeight}" viewBox="0 0 ${width} ${stageHeight}" overflow="hidden">${body}</svg>
    <text x="${width-24}" y="102" font-size="9" text-anchor="middle" fill="${COLORS.ink}">N</text>
    <path d="M${width-24} 109 l-4 14 8 0 Z" fill="${COLORS.ink}"/>
    <path d="M0 84H${width}M0 ${stageHeight + 84}H${width}" stroke="${COLORS.ink}" stroke-width="1.5"/>
    ${legend.map(({fill,label},index)=>{const col=index%3,row=Math.floor(index/3),x=16+col*((width-32)/3),y=legendY+row*20;return `<rect x="${x}" y="${y-8}" width="10" height="10" fill="${fill}" stroke="${COLORS.ink}" stroke-width=".7"/><text x="${x+16}" y="${y+1}" font-size="9" fill="${COLORS.ink}">${label}</text>`;}).join('')}
    <text x="16" y="${height - 9}" font-size="8" fill="#757d6d">边界：DataV.GeoAtlas / Natural Earth</text>
  </svg>`;
  const name = `足迹地球-${view==='all'?'完整':PROFILES[view].short}-${demo ? '示例-' : ''}${day}`;
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
