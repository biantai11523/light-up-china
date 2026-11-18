import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { openApp, searchAndSelect, until } from './ui-harness.mjs';
import { createMapSnapshot } from '../src/export.js';
test('real zoom-handler move bursts paint once, avoid label writes and restore full geometry on release',async()=>{
  const f=fixture(),frames=new Map(),idles=[];let id=0;
  const w=await openApp(f,{configure(w){
    w.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};
    w.cancelAnimationFrame=key=>frames.delete(key);
    w.requestIdleCallback=callback=>{idles.push(callback);return idles.length;};
  }}),d=w.document;
  try{
    while(idles.length)idles.shift()();
    const svg=d.querySelector('.map-svg'),group=svg.querySelector('g'),labels=svg.querySelector('.city-labels');
    svg.getBoundingClientRect=()=>({left:0,top:0,width:390,height:356});
    // Happy DOM lacks SVGPoint.matrixTransform. Use a deterministic screen matrix
    // while exercising D3's real mouse gesture handlers and the application's frame scheduler.
    svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}});
    svg.getScreenCTM=()=>({inverse:()=>({a:1,b:0,c:0,d:1,e:0,f:0})});
    const paths=[...svg.querySelectorAll('.city-shape,.province-shape')];
    const original=paths.map(node=>node.getAttribute('d'));
    let transformWrites=0,labelWrites=0;
    const setGroup=group.setAttribute.bind(group),setLabels=labels.setAttribute.bind(labels);
    group.setAttribute=(name,value)=>{if(name==='transform')transformWrites++;setGroup(name,value);};
    labels.setAttribute=(name,value)=>{labelWrites++;setLabels(name,value);};
    svg.dispatchEvent(new w.MouseEvent('mousedown',{view:w,bubbles:true,cancelable:true,clientX:100,clientY:100,button:0}));
    for(let step=1;step<=20;step++)w.dispatchEvent(new w.MouseEvent('mousemove',{view:w,bubbles:true,cancelable:true,clientX:100+step*2,clientY:100+step,buttons:1}));
    assert.equal(frames.size,1);assert.equal(transformWrites,0);assert.ok(svg.classList.contains('is-moving'));
    assert.ok(paths.some((node,index)=>node.getAttribute('d')!==original[index]));
    [...frames.values()][0]();assert.equal(transformWrites,1);assert.equal(labelWrites,0);
    w.dispatchEvent(new w.MouseEvent('mouseup',{view:w,bubbles:true,cancelable:true,clientX:140,clientY:120,button:0}));
    assert.ok(!svg.classList.contains('is-moving'));assert.equal(frames.size,0);
    assert.deepEqual(paths.map(node=>node.getAttribute('d')),original);
    assert.equal(labelWrites,0);assert.match(group.getAttribute('transform'),/translate\(40,20\)/);
  }finally{await w.happyDOM.abort();f.db.close();}
});

test('city labels grow and shrink during a pinch, keep selected labels, and export at the displayed size', async () => {
  const f = fixture();
  const w = await openApp(f, { configure(w) {
    Object.defineProperty(w.navigator, 'maxTouchPoints', { value: 2 });
  } });
  const d = w.document, svg = d.querySelector('.map-svg');
  try {
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 356 });
    svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return {x: this.x, y: this.y}; } });
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    searchAndSelect(w, '330100');
    const names = svg.querySelector('.city-labels');
    const selected = [...names.children].find(n => n.textContent === '杭州市');
    assert.ok(selected);
    const pixelSize = () => Number(names.getAttribute('font-size')) * svg.__zoom.k * 390 / 720;
    const startSize = pixelSize();
    const startZoom = svg.__zoom.k;
    const touches = distance => [-1, 1].map((sign, i) => ({
      identifier: i, clientX: 470 + sign * distance / 2, clientY: 330, target: svg
    }));
    function pinch(type, active, changed = active) {
      const event = new w.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { touches: active, changedTouches: changed });
      svg.dispatchEvent(event);
    }
    pinch('touchstart', touches(100));
    let previous = startSize;
    for (const distance of [107, 114, 121]) {
      pinch('touchmove', touches(distance));
      await until(() => svg.querySelector(':scope > g').getAttribute('transform') === svg.__zoom.toString());
      assert.ok(svg.classList.contains('is-moving'));
      assert.ok(pixelSize() > previous + .1 && pixelSize() < previous + .4);
      assert.ok(selected.isConnected, 'the focused label is reused during the gesture');
      previous = pixelSize();
    }
    pinch('touchmove', touches(100));
    await until(() => Math.abs(pixelSize() - startSize) < .005);
    pinch('touchend', [], touches(100));
    assert.ok(Math.abs(svg.__zoom.k - startZoom) < .001);
    assert.ok(names.children.length > 1 && names.children.length < 80);
    const rects = [...names.children].map(node => {
      const [x, y] = svg.__zoom.apply([+node.getAttribute('x'), +node.getAttribute('y')]);
      const px = (x - 110) * 390 / 720, py = (y - 25) * 390 / 720 + (356 - 610 * 390 / 720) / 2;
      const half = node.textContent.length * pixelSize() / 2;
      return [px - half, py - pixelSize(), px + half, py + 2];
    });
    for (const [i, a] of rects.entries()) {
      assert.ok(a[0] >= 0 && a[1] >= 0 && a[2] <= 390 && a[3] <= 356);
      for (const b of rects.slice(i + 1)) assert.ok(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
    }
    const image = createMapSnapshot(d.querySelector('.map-card'), {count: 0, total: 370, provinces: 0});
    const vector = new w.DOMParser().parseFromString(image.svg, 'image/svg+xml');
    assert.equal(vector.querySelector('.map-city-label').getAttribute('font-size'), names.getAttribute('font-size'));
  } finally { await w.happyDOM.abort(); f.db.close(); }
});

test('rapid zoom button presses accumulate and reset returns to the national view', async () => {
  const f = fixture(), w = await openApp(f), d = w.document;
  try {
    const svg = d.querySelector('.map-svg');
    d.querySelector('[data-map="plus"]').click();
    d.querySelector('[data-map="plus"]').click();
    await until(() => svg.__zoom.k > 1 && svg.__zoom.k < 2.55);
    await until(() => Math.abs(svg.__zoom.k - 2.56) < .00001 && !svg.classList.contains('is-moving'));
    d.querySelector('[data-map="reset"]').click();
    await until(() => svg.__zoom.k === 1 && !svg.classList.contains('is-moving'));
    assert.deepEqual([svg.__zoom.x, svg.__zoom.y], [0, 0]);
  } finally { await w.happyDOM.abort(); f.db.close(); }
});
