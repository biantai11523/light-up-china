import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { frame, HOME, project, unit } from '../src/earth/camera.js';
export const worldAtlas=JSON.parse(readFileSync('public/data/earth/atlas.json','utf8'));
export function tapRegion(w,id){
  const d=w.document,stage=d.querySelector('.map-stage');
  const visible=d.querySelector('.earth-surface [data-city="'+id+'"]');
  if(visible){visible.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));return;}
  const r=worldAtlas.regions.find(r=>r[0]===id);
  const [, ,width,height]=d.querySelector('.map-svg').getAttribute('viewBox').split(' ').map(Number);
  const [x,y]=project(unit(r[5],r[6]),frame(HOME,width,height));
  stage.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:x,clientY:y}));
}
const bundled=await build({entryPoints:['src/main.js'],bundle:true,write:false,format:'iife',loader:{'.css':'empty'},define:{'import.meta.env.VITE_API_URL':'"https://api.test"','import.meta.env.BASE_URL':'"/"'}});
const script=bundled.outputFiles[0].text;
export function typeQuery(w, value) {
  const input = w.document.querySelector('#city-search');
  input.value = value;
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
}
export function searchAndSelect(w, id) {
  w.document.querySelector('.search-trigger').click();
  typeQuery(w, id);
  w.document.querySelector(`[data-pick="${id}"]`).click();
}
export function enterDemo(document) {
  document.querySelector('[data-action="about"]').click();
  document.querySelector('[data-show-demo]').click();
}
export async function until(condition){for(let i=0;i<150;i++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw new Error('DOM condition timed out');}
export async function openApp(f,{offline=false,width=390,configure=()=>{}}={}){
  const window=new Window({url:'https://biantai11523.github.io/light-up-china/',width,height:844});
  window.document.body.innerHTML='<div id="app"></div><div id="modal-root"></div><div id="toast"></div>';
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.SVGElement.prototype.scrollIntoView=function(){};
  window.fetch=async(url,options)=>{
    const path=new URL(url,window.location.href).pathname.split('/data/earth/')[1];
    if(path && /^[a-z0-9.-]+$/.test(path))return new Response(readFileSync('public/data/earth/'+path));
    if(String(url).endsWith('/data/china.json'))return Response.json(f.map);
    if(offline)throw new TypeError('Offline');
    const {signal,...rest}=options || {};
    return f.request(new URL(url).pathname,rest);
  };
  configure(window);
  window.eval(script);
  await until(()=>window.document.querySelector('.map-stage[data-renderer]')&&!window.document.querySelector('.earth-loading'));
  if(!offline){try{await until(()=>window.document.querySelector('#sync-status').textContent.includes('已同步'));}catch(error){await window.happyDOM.abort();throw error;}}
  return window;
}
