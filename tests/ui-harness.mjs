import { build } from 'esbuild';
import { Window } from 'happy-dom';
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
    if(String(url).endsWith('/data/china.json'))return Response.json(f.map);
    if(offline)throw new TypeError('Offline');
    const {signal,...rest}=options || {};
    return f.request(new URL(url).pathname,rest);
  };
  configure(window);
  window.eval(script);
  await until(()=>window.document.querySelectorAll('.map-svg .city-shape').length===370);
  if(!offline){try{await until(()=>window.document.querySelector('#sync-status').textContent.includes('已同步'));}catch(error){await window.happyDOM.abort();throw error;}}
  return window;
}
