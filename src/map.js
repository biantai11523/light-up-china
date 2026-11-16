import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { escapeHtml } from './store.js';
import { frameUpdates, simplifyMapPath } from './motion.js';
import { PROFILE_PATTERNS } from './profiles.js';

const NS = 'http://www.w3.org/2000/svg';
const shortProvince = name => name.replace(/壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市/g, '');
export function createMap(container, data, onSelect) {
  const svg = container.querySelector('.map-svg');
  svg.setAttribute('viewBox', '110 25 720 610');
  const defs=document.createElementNS(NS,'defs');defs.innerHTML=PROFILE_PATTERNS;svg.append(defs);
  const group = document.createElementNS(NS, 'g');
  svg.append(group);
  group.innerHTML = `<g class="cities">${data.cities.map(c => `<path class="city-shape" data-city="${c.id}" d="${c.path}" aria-label="${escapeHtml(c.name)}"><title>${escapeHtml(c.name)}</title></path>`).join('')}</g><g>${data.provinces.map(p => `<path class="province-shape" d="${p.path}"/>`).join('')}</g><g>${data.decorations.map(d => `<path class="map-decoration" d="${d}"/>`).join('')}</g><g class="province-labels">${data.provinces.filter(p => !['810000','820000'].includes(p.id)).map(p => `<text class="province-label" x="${p.center[0]}" y="${p.id === '460000' ? 599 : p.center[1]}">${shortProvince(p.name)}</text>`).join('')}</g><g class="city-labels"></g>`;
  const inset = container.querySelector('.sea-inset svg');
  inset.setAttribute('viewBox', '552 535 166 340');
  inset.innerHTML = `<g>${data.cities.filter(c => ['460000','440000','810000','820000'].includes(c.provinceId)).map(c => `<path class="city-shape" data-city="${c.id}" d="${c.path}"/>`).join('')}${data.decorations.map(d => `<path class="map-decoration" d="${d}"/>`).join('')}</g>`;
  const nodesByCity = new Map();
  container.querySelectorAll('[data-city]').forEach(node => {
    const nodes = nodesByCity.get(node.dataset.city) || [];
    nodes.push(node); nodesByCity.set(node.dataset.city,nodes);
  });
  const motionPaths = [...group.querySelectorAll('.city-shape,.province-shape')].map(node => ({node,full:node.getAttribute('d'),coarse:null,fine:null}));
  let selected = new Set(), lit = new Set(), transform = zoomIdentity;
  const paintKeys=new Map();
  let labelKey = '', labelsDirty = true, activeGesture = false, moving = false, motionTier = 'full', screenScale = 1;
  let suppressClickUntil = 0, gestureMoved = false, pointerStart = null;
  const pointers = new Map();
  const provinceLabels = group.querySelector('.province-labels');
  const cityLabels = group.querySelector('.city-labels');
  const plus = container.querySelector('[data-map="plus"]');
  const minus = container.querySelector('[data-map="minus"]');
  let paintedScale = 1;
  const frames = frameUpdates(next => {
    group.setAttribute('transform',next.toString());
    if (moving && next.k !== paintedScale) {
      provinceLabels.style.display = next.k > 2.3 ? 'none' : '';
      cityLabels.setAttribute('font-size',String(Math.max(1.2,11/next.k)));
      cityLabels.setAttribute('stroke-width',String(1.8/next.k));
    }
    paintedScale = next.k;
    if (!moving) drawLabels();
  });

  // Prepare lightweight paths in small idle chunks, never during a gesture.
  let preparing = 0;
  const prepareCount = motionPaths.length * 2;
  function preparePaths() {
    if (activeGesture) { setTimeout(preparePaths,120); return; }
    const started = performance.now();
    do {
      const path = motionPaths[preparing % motionPaths.length];
      const tier = preparing < motionPaths.length ? 'coarse' : 'fine';
      path[tier] = simplifyMapPath(path.full,tier === 'coarse' ? .2 : .05);
      preparing++;
    } while (preparing < prepareCount && performance.now() - started < 5);
    if (preparing < prepareCount) schedulePreparation();
  }
  function schedulePreparation() {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(preparePaths,{timeout:1000});
    else setTimeout(preparePaths,30);
  }
  schedulePreparation();
  function detail(tier) {
    if (tier === motionTier) return;
    motionTier = tier;
    for (const path of motionPaths) path.node.setAttribute('d',path[tier] || path.full);
  }
  function beginMotion() {
    const started = !moving;
    if (started) { moving = true; svg.classList.add('is-moving'); }
    const effectiveScale = screenScale * transform.k;
    const tier = effectiveScale <= 3 ? 'coarse' : effectiveScale <= 12 ? 'fine' : 'full';
    const rank = {coarse:0,fine:1,full:2};
    if (started || rank[tier] > rank[motionTier]) detail(tier);
  }
  function finishMotion() {
    frames.flush();
    moving = false; svg.classList.remove('is-moving'); detail('full'); drawLabels();
  }
  svg.addEventListener('pointerdown',event => {
    if (!pointers.size) { gestureMoved = false; suppressClickUntil = 0; pointerStart = [event.clientX,event.clientY]; }
    pointers.set(event.pointerId,[event.clientX,event.clientY]);
    if (pointers.size > 1) gestureMoved = true;
  },{passive:true});
  svg.addEventListener('pointermove',event => {
    const start = pointers.get(event.pointerId);
    if (start && Math.hypot(event.clientX-start[0],event.clientY-start[1]) > 7) gestureMoved = true;
  },{passive:true});
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    if (gestureMoved || event.type === 'pointercancel') suppressClickUntil = Date.now()+400;
    pointers.delete(event.pointerId);
  }
  window.addEventListener('pointerup',endPointer,{passive:true});
  window.addEventListener('pointercancel',endPointer,{passive:true});
  svg.addEventListener('pointerup',endPointer,{passive:true});
  svg.addEventListener('pointercancel',endPointer,{passive:true});
  function click(event) {
    const city = event.target.closest('[data-city]');
    if (city && !event.defaultPrevented && Date.now() >= suppressClickUntil) onSelect(city.dataset.city);
  }
  svg.addEventListener('click',click); inset.addEventListener('click',click);
  const zoomer = zoom().scaleExtent([1,12]).translateExtent([[40,-30],[930,720]]).extent([[110,25],[830,635]]).clickDistance(7)
    .on('start',event => {
      if (!event.sourceEvent) return;
      activeGesture = true;
      const rect = svg.getBoundingClientRect();
      screenScale = rect.width && rect.height ? Math.min(rect.width/720,rect.height/610) : 1;
      if (event.sourceEvent.type === 'mousedown') pointerStart = [event.sourceEvent.clientX,event.sourceEvent.clientY];
    })
    .on('zoom',event => {
      const scaleChanged = event.transform.k !== transform.k;
      transform = event.transform;
      if (scaleChanged) labelsDirty = true;
      const source = event.sourceEvent;
      if (source?.type === 'mousemove' && pointerStart && Math.hypot(source.clientX-pointerStart[0],source.clientY-pointerStart[1]) > 7) gestureMoved = true;
      if (source && (gestureMoved || scaleChanged || moving)) beginMotion();
      frames.queue(transform);
      if (!source) frames.flush();
    })
    .on('end',event => {
      if (event.sourceEvent) activeGesture = false;
      finishMotion();
    });
  select(svg).call(zoomer).on('dblclick.zoom',null);
  function drawLabels() {
    if (!labelsDirty) return;
    labelsDirty = false;
    const k = transform.k;
    provinceLabels.style.display = k > 2.3 ? 'none' : '';
    const selectedLabels = new Set([...selected].slice(-8));
    const shown = data.cities.filter(c => c.id !== '460300' && (selectedLabels.has(c.id) || (k > 2.3 && lit.has(c.id)) || k > 4.5));
    const key = shown.map(c=>c.id).join(',');
    if (key !== labelKey) {
      labelKey = key;
      cityLabels.innerHTML = shown.map(c=>`<text class="map-city-label" x="${c.center[0]}" y="${c.center[1]}">${escapeHtml(c.name)}</text>`).join('');
    }
    cityLabels.setAttribute('font-size',String(Math.max(1.2,11/k)));
    cityLabels.setAttribute('stroke-width',String(1.8/k));
    plus.disabled = k >= 12; minus.disabled = k <= 1;
  }
  function reset() { select(svg).call(zoomer.transform,zoomIdentity); }
  plus.onclick = () => select(svg).call(zoomer.scaleBy,1.6);
  minus.onclick = () => select(svg).call(zoomer.scaleBy,1/1.6);
  container.querySelector('[data-map="reset"]').onclick = reset;
  drawLabels();
  return {
    update(records,ids,appearances={}) {
      const next = new Set(ids || []);
      const nextLit = new Set(data.cities.filter(c=>records[c.id]?.active).map(c=>c.id));
      const changed = new Set();
      for (const id of new Set([...selected,...next])) if (selected.has(id) !== next.has(id)) changed.add(id);
      for (const id of new Set([...lit,...nextLit])) if (lit.has(id) !== nextLit.has(id)) changed.add(id);
      for(const city of data.cities){
        const paint=appearances[city.id] || {active:nextLit.has(city.id),fill:nextLit.has(city.id)?'#c5f567':'#f8f7ef',stroke:nextLit.has(city.id)?'#6b7b51':'#929986'};
        const key=`${paint.fill}|${paint.stroke}|${paint.category||''}`;
        if(paintKeys.get(city.id)!==key){changed.add(city.id);paintKeys.set(city.id,key);}
      }
      selected = next; lit = nextLit;
      for (const id of changed) for (const node of nodesByCity.get(id) || []) {
        const paint=appearances[id] || {active:lit.has(id),fill:lit.has(id)?'#c5f567':'#f8f7ef',stroke:lit.has(id)?'#6b7b51':'#929986'};
        node.classList.toggle('is-lit',paint.active); node.classList.toggle('is-selected',selected.has(id));
        node.dataset.paintFill=paint.fill;node.dataset.paintStroke=paint.stroke;node.dataset.profileCategory=paint.category||'';
        node.style.fill=selected.has(id)?'#ff976f':paint.fill;node.style.stroke=selected.has(id)?'#252a24':paint.stroke;
      }
      if (changed.size) labelsDirty = true;
      if (!moving) drawLabels();
    },
    focus(city) {
      if (city.id === '460300') { reset(); return; }
      const [[x0,y0],[x1,y1]] = city.bounds;
      const k = Math.min(7,Math.max(1.8,.63/Math.max((x1-x0)/720,(y1-y0)/610)));
      select(svg).call(zoomer.transform,zoomIdentity.translate(470,330).scale(k).translate(-(x0+x1)/2,-(y0+y1)/2));
    },
    prepareExport: finishMotion,
    get interacting() { return activeGesture; },
    reset
  };
}
