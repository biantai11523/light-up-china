import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { escapeHtml } from './store.js';
const NS = 'http://www.w3.org/2000/svg';
const shortProvince = name => name.replace(/壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市/g, '');
export function createMap(container, data, onSelect) {
  const svg = container.querySelector('.map-svg');
  // Reserve space to the east so the inset cannot cover Taiwan on narrow screens.
  svg.setAttribute('viewBox', '95 12 855 650');
  const group = document.createElementNS(NS, 'g');
  svg.append(group);
  group.innerHTML = `<g class="cities">${data.cities.map(c => `<path class="city-shape" data-city="${c.id}" d="${c.path}" aria-label="${escapeHtml(c.name)}"><title>${escapeHtml(c.name)}</title></path>`).join('')}</g><g>${data.provinces.map(p => `<path class="province-shape" d="${p.path}"/>`).join('')}</g><g>${data.decorations.map(d => `<path class="map-decoration" d="${d}"/>`).join('')}</g><g class="province-labels">${data.provinces.filter(p => !['810000','820000'].includes(p.id)).map(p => `<text class="province-label" x="${p.center[0]}" y="${p.id === '460000' ? 599 : p.center[1]}">${shortProvince(p.name)}</text>`).join('')}</g><g class="city-labels"></g>`;
  const inset = container.querySelector('.sea-inset svg');
  inset.setAttribute('viewBox', '552 535 166 340');
  inset.innerHTML = `<g>${data.cities.filter(c => c.provinceId === '460000' || c.provinceId === '440000' || c.provinceId === '810000' || c.provinceId === '820000').map(c => `<path class="city-shape" data-city="${c.id}" d="${c.path}"/>`).join('')}${data.decorations.map(d => `<path class="map-decoration" d="${d}"/>`).join('')}</g>`;
  let suppressClickUntil = 0;
  const pointers = new Map();
  let gestureMoved = false;
  svg.addEventListener('pointerdown', event => {
    if (!pointers.size) gestureMoved = false;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size > 1) gestureMoved = true;
  }, { passive: true });
  svg.addEventListener('pointermove', event => {
    const start = pointers.get(event.pointerId);
    if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 7) gestureMoved = true;
  }, { passive: true });
  function endPointer(event) {
    if (gestureMoved || event.type === 'pointercancel') suppressClickUntil = Date.now() + 400;
    pointers.delete(event.pointerId);
  }
  svg.addEventListener('pointerup', endPointer, { passive: true });
  svg.addEventListener('pointercancel', endPointer, { passive: true });
  function click(event) { const city = event.target.closest('[data-city]'); if (city && !event.defaultPrevented && Date.now() >= suppressClickUntil) onSelect(city.dataset.city); }
  svg.addEventListener('click', click); inset.addEventListener('click', click);
  let lastZoom = 1;
  let selectedId = null;
  let records = {};
  let labelKey = '';
  const provinceLabels = group.querySelector('.province-labels');
  const cityLabels = group.querySelector('.city-labels');
  const zoomer = zoom().scaleExtent([1, 12]).translateExtent([[40,-30],[1010,720]]).extent([[95,12],[950,662]]).clickDistance(7).on('zoom', event => {
    group.setAttribute('transform', event.transform.toString());
    lastZoom = event.transform.k;
    provinceLabels.style.display = lastZoom > 2.3 ? 'none' : '';
    drawLabels();
  });
  select(svg).call(zoomer).on('dblclick.zoom', null);
  function drawLabels() {
    const shown = data.cities.filter(c => c.id !== '460300' && (c.id === selectedId || (lastZoom > 2.3 && records[c.id]?.active) || lastZoom > 4.5));
    const key = shown.map(c => c.id).join(',');
    if (key !== labelKey) {
      labelKey = key;
      cityLabels.innerHTML = shown.map(c => `<text class="map-city-label" x="${c.center[0]}" y="${c.center[1]}">${escapeHtml(c.name)}</text>`).join('');
    }
    cityLabels.setAttribute('font-size', String(Math.max(1.2, 11 / lastZoom)));
    cityLabels.setAttribute('stroke-width', String(1.8 / lastZoom));
    container.querySelector('[data-map="plus"]').disabled = lastZoom >= 12;
    container.querySelector('[data-map="minus"]').disabled = lastZoom <= 1;
  }
  function reset() { select(svg).call(zoomer.transform, zoomIdentity); }
  container.querySelector('[data-map="plus"]').onclick = () => select(svg).call(zoomer.scaleBy, 1.6);
  container.querySelector('[data-map="minus"]').onclick = () => select(svg).call(zoomer.scaleBy, 1 / 1.6);
  container.querySelector('[data-map="reset"]').onclick = reset;
  drawLabels();
  return {
    update(nextRecords, nextId) {
      records = nextRecords; selectedId = nextId;
      container.querySelectorAll('[data-city]').forEach(el => { el.classList.toggle('is-lit', !!records[el.dataset.city]?.active); el.classList.toggle('is-selected', el.dataset.city === selectedId); });
      drawLabels();
    },
    focus(city) {
      if (city.id === '460300') { reset(); return; }
      const [[x0,y0],[x1,y1]] = city.bounds;
      const k = Math.min(7, Math.max(1.8, .63 / Math.max((x1 - x0) / 855, (y1 - y0) / 650)));
      select(svg).call(zoomer.transform, zoomIdentity.translate(522.5,337).scale(k).translate(-(x0+x1)/2, -(y0+y1)/2));
    },
    reset
  };
}
