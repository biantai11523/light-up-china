// Injected into a local test copy by run.py. Never included in the published site.
(() => {
  const nativeFetch = window.fetch.bind(window);
  const raf = window.requestAnimationFrame.bind(window);
  const frame = () => new Promise(resolve => raf(resolve));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const sample = location.pathname.split('/')[1];
  let work = null;
  window.requestAnimationFrame = callback => raf(time => {
    const start = performance.now();
    try { callback(time); } finally { work?.push(performance.now() - start); }
  });
  window.fetch = (url, options) => {
    const address = new URL(url, document.baseURI);
    if (address.pathname === '/api/state') return Promise.resolve(Response.json({
      records: {}, layers: {together: {}, xuan: {}, xi: {}}, activity: [], activityAll: []
    }));
    if (address.origin !== location.origin) throw Error('Unexpected external request in test');
    return nativeFetch(url, options);
  };

  async function waitFor(check, ms = 25000) {
    const deadline = performance.now() + ms;
    while (!check()) {
      if (performance.now() > deadline) throw Error('Timeout: ' + check.toString());
      await sleep(50);
    }
  }
  function quantile(numbers, q) {
    if (!numbers.length) return 0;
    const sorted = numbers.slice().sort((a, b) => a - b);
    return +sorted[Math.floor((sorted.length - 1) * q)].toFixed(2);
  }
  async function run() {
    await waitFor(() => document.querySelector('.map-stage[data-renderer]') &&
      !document.querySelector('.earth-loading') && document.querySelector('#sync-status')?.textContent.includes('已同步'));
    const stage = document.querySelector('.map-stage');
    stage.scrollIntoView({block: 'center', behavior: 'instant'});
    await sleep(350);
    const box = stage.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const report = {engine: navigator.userAgent, renderer: stage.dataset.renderer,
      viewport: [innerWidth, innerHeight, devicePixelRatio], scenarios: {}};
    const dispatch = (type, id, px, py) => stage.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true,
      buttons: type === 'pointerup' ? 0 : 1, button: type === 'pointermove' ? -1 : 0, clientX: px, clientY: py
    }));
    async function trace(name, move, duration = 1600) {
      const intervals = [], handler = [];
      work = [];
      let previous = await frame(), start = previous;
      let elapsed = 0;
      while (elapsed < duration) {
        const now = await frame();
        intervals.push(now - previous); previous = now; elapsed = now - start;
        const t = performance.now();
        move(Math.min(1, elapsed / duration));
        handler.push(performance.now() - t);
      }
      report.scenarios[name] = {frames: intervals.length, intervalP50: quantile(intervals,.5),
        intervalP95: quantile(intervals,.95), over33ms: intervals.filter(v=>v>33.5).length,
        inputP95: quantile(handler,.95), appRafP95: quantile(work,.95)};
      work = null;
    }
    await trace('idle',()=>{},750);
    const before = stage.parentElement.querySelector('.earth-readout').textContent;
    dispatch('pointerdown',1,x-70,y);
    await trace('rotate', t=>{
      for(let i=0;i<3;i++) dispatch('pointermove',1,x-70+t*140+i*.15,y+20*Math.sin(t*Math.PI));
    });
    dispatch('pointerup',1,x+70,y); await sleep(500);
    if(before===document.querySelector('.earth-readout').textContent)throw Error('Rotation did not change the camera');
    dispatch('pointerdown',1,x-10,y);dispatch('pointerdown',2,x+10,y);
    await trace('pinch', t=>{
      const distance=10*Math.pow(13,t), drift=14*t;
      dispatch('pointermove',2,x+distance+drift,y);
      dispatch('pointermove',1,x-distance+drift,y);
    });
    dispatch('pointerup',2,x+144,y);
    await trace('one-finger-after-pinch',t=>dispatch('pointermove',1,x-116+80*t,y+22*t),950);
    dispatch('pointerup',1,x-36,y+22);
    await sleep(650);
    if(!document.querySelector('#selection-dock').hidden)throw Error('Rotation or pinch selected a region');
    // Exercise a real search, close-up render, local detail and export in WebKit.
    document.querySelector('.search-trigger').click();
    const input=document.querySelector('#city-search');input.value='820000';input.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-pick="820000"]').click();
    await waitFor(()=>document.querySelector('#selection-dock').textContent.includes('澳门'));
    await sleep(650);
    document.querySelector('[data-action="export-map"]').click();
    await waitFor(()=>document.querySelector('[data-save-svg]'));
    report.exportReady=true;
    return report;
  }
  addEventListener('load',async()=>{
    let result;
    try { result=await run(); } catch(error) { result={error:String(error.stack||error)}; }
    await nativeFetch('/result/'+sample,{method:'POST',body:JSON.stringify(result)});
  },{once:true});
})();
