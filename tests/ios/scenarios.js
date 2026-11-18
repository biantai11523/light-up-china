// Injected into a local test copy by run.py. Never included in the published site.
(() => {
  const nativeFetch = window.fetch.bind(window);
  const raf = window.requestAnimationFrame.bind(window);
  const frame = () => new Promise(resolve => raf(resolve));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const sample = location.pathname.split('/')[1];
  const pass = new URLSearchParams(location.search).get('pass') || '1';
  const fallback = new URLSearchParams(location.search).get('renderer')==='svg';
  if(fallback){
    const context=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...rest){
      return /webgl/.test(kind)?null:context.call(this,kind,...rest);
    };
  }
  let projections=0, glyphBatches=0, lastVector;
  const contextEvents=[];
  for(const type of ['webglcontextcreationerror','webglcontextlost','webglcontextrestored']){
    document.addEventListener(type,e=>contextEvents.push({type,message:e.statusMessage||''}),true);
  }
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...rest){
    if(message?.type==='project')projections++;
    if(message?.words)glyphBatches++;
    return post.call(this,message,...rest);
  };
  const makeURL=URL.createObjectURL.bind(URL);
  URL.createObjectURL=function(blob){
    if(blob.type?.startsWith('image/svg+xml'))lastVector=blob;
    return makeURL(blob);
  };
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
    let rectReads = 0;
    const bounds = stage.getBoundingClientRect.bind(stage);
    stage.getBoundingClientRect = () => { rectReads++; return bounds(); };
    const report = {engine: navigator.userAgent, renderer: stage.dataset.renderer,
      viewport: [innerWidth, innerHeight, devicePixelRatio], stage:[box.width,box.height], scenarios: {}};
    const dispatch = (type, id, px, py) => stage.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true,
      buttons: type === 'pointerup' ? 0 : 1, button: type === 'pointermove' ? -1 : 0, clientX: px, clientY: py
    }));
    async function trace(name, move, duration = 1600) {
      const intervals = [], handler = [];
      const initialReads=rectReads;
      const renderer=stage.dataset.renderer;
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
      report.scenarios[name] = {renderer, endRenderer:stage.dataset.renderer, frames: intervals.length, intervalP50: quantile(intervals,.5),
        intervalP95: quantile(intervals,.95), over33ms: intervals.filter(v=>v>33.5).length,
        inputP95: quantile(handler,.95), appRafP95: quantile(work,.95), layoutReads:rectReads-initialReads};
      work = null;
    }
    // Let both the web process and its shader cache warm up before timing.
    dispatch('pointerdown',1,x-30,y);
    for(let i=1;i<=36;i++){await frame();dispatch('pointermove',1,x-30+i*1.5,y);}
    dispatch('pointerup',1,x+24,y);document.querySelector('[data-map="reset"]').click();
    await sleep(600);
    for(let i=0;i<18;i++)await frame();
    report.renderer=stage.dataset.renderer;
    await trace('idle',()=>{},750);
    const before = stage.parentElement.querySelector('.earth-readout').textContent;
    const capture = name => nativeFetch('/capture/'+sample+'/'+pass+'/'+name,{method:'POST',body:''});
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
    if(sample==='candidate' && pass==='1'){
      document.querySelector('[data-map="reset"]').click();await sleep(450);
      for(let i=0;i<2;i++)document.querySelector('[data-map="plus"]').click();
      await sleep(1100);
      await capture('country');
      document.querySelector('[data-action="export-map"]').click();
      await waitFor(()=>document.querySelector('[data-save-svg]') && lastVector);
      const world=new DOMParser().parseFromString(await lastVector.text(),'image/svg+xml');
      const plate=world.documentElement;
      if(plate.getAttribute('data-projection')!=='mercator' || plate.getAttribute('data-central-meridian')!=='150' ||
        !world.querySelector('[data-country="CHN"]') || !world.querySelector('[data-country="BRA"]') ||
        world.querySelector('[data-boundary="province"],[data-boundary="prefecture"],svg svg') ||
        world.querySelector('desc')?.textContent.includes('概览边界'))throw Error('Expected the full-bleed world print map');
      report.worldViewBox=plate.getAttribute('viewBox');
      document.querySelector('[data-close]').click();

      // Reproduce a rim grab that used to jump from the north pole to a
      // different inverse solution. Do this outside the timed comparisons.
      document.querySelector('[data-map="reset"]').click();
      await sleep(500);
      const b=bounds(),cx=b.left+b.width/2,cy=b.top+b.height/2,r=.46*Math.min(b.width,b.height);
      const latitude=()=>{
        const m=document.querySelector('.earth-readout').textContent.match(/([\d.]+)°([NS])/);
        return Number(m[1])*(m[2]==='N'?1:-1);
      };
      dispatch('pointerdown',1,cx,cy);
      for(let i=1;i<=7;i++){
        dispatch('pointermove',1,cx,cy+r*Math.sin(i*Math.PI/180));await frame();
      }
      await sleep(130);dispatch('pointerup',1,cx,cy+r*Math.sin(7*Math.PI/180));
      await frame();await frame();
      const sx=cx-r*.8,sy=cy-r*.55;
      let previous=latitude(),maxStep=0;
      if(Math.abs(previous-35)>1)throw Error('Polar drag test did not reach its start pose');
      dispatch('pointerdown',1,sx,sy);
      for(const i of [...Array.from({length:72},(_,i)=>i+1),...Array.from({length:30},(_,i)=>71-i)]){
        dispatch('pointermove',1,sx+i,sy+i*.13);await frame();
        const lat=latitude();maxStep=Math.max(maxStep,Math.abs(lat-previous));previous=lat;
      }
      await sleep(130);dispatch('pointerup',1,sx+42,sy+42*.13);
      if(maxStep>32 || !document.querySelector('#selection-dock').hidden)throw Error('Polar drag jumped or selected a region');
      report.rimDragPassed=true;
    }
    // Exercise a real search, close-up render, local detail and export in WebKit.
    document.querySelector('.search-trigger').click();
    const input=document.querySelector('#city-search');input.value='820000';input.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-pick="820000"]').click();
    await waitFor(()=>document.querySelector('#selection-dock').textContent.includes('澳门'));
    await sleep(850);
    if(sample==='candidate' && pass==='1')await capture('macau');
    document.querySelector('[data-action="export-map"]').click();
    await waitFor(()=>document.querySelector('[data-save-svg]'));
    if(sample==='candidate'){
      const world=new DOMParser().parseFromString(await lastVector.text(),'image/svg+xml');
      if(!world.querySelector('[data-pin="820000"]') || !world.querySelector('[data-country="BRA"]') ||
        world.querySelector('[data-city="820000"]')?.getAttribute('fill')!=='#ff976f')throw Error('Missing Macau or the opposite hemisphere');
      if(report.worldViewBox && world.documentElement.getAttribute('viewBox')!==report.worldViewBox)throw Error('Export follows the local camera');
      await waitFor(()=>!document.querySelector('[data-save-png]').disabled || !document.querySelector('[data-export-error]').hidden);
      if(document.querySelector('[data-save-png]').disabled)throw Error(document.querySelector('[data-export-error]').textContent);
      const photo=document.querySelector('.export-preview img');
      await photo.decode();
      report.worldPng=[photo.naturalWidth,photo.naturalHeight];
      if(photo.naturalWidth!==4096 || photo.naturalHeight!==Number(world.documentElement.getAttribute('height')))throw Error('Unexpected PNG dimensions');
    }
    report.exportReady=true;report.workerProjections=projections;report.glyphBatches=glyphBatches;report.contextEvents=contextEvents;
    if(fallback && (report.renderer!=='svg'||!projections))throw Error('SVG worker fallback did not run');
    return report;
  }
  addEventListener('load',async()=>{
    let result;
    try { result=await run(); } catch(error) { result={error:String(error),stack:error.stack}; }
    const reply=await nativeFetch('/result/'+sample+'/'+pass,{method:'POST',body:JSON.stringify(result)});
    const {next}=await reply.json();
    if(next)location.replace(next);
  },{once:true});
})();
