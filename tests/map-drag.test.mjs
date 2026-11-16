import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { openApp } from './ui-harness.mjs';
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
