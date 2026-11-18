import { normalizeRecord } from './store.js';

export const PROFILES = {
  together: { label:'一起去过的地方', short:'一起', color:'#c5f567', muted:'#e6edce', stroke:'#6b7b51' },
  xuan: { label:'轩宝去过的地方', short:'轩宝', color:'#9ed9c5', muted:'#e0ece5', stroke:'#608d7d' },
  xi: { label:'曦宝去过的地方', short:'曦宝', color:'#bccdf3', muted:'#e6eaf3', stroke:'#7b8eae' }
};
export function emptyLayers(){return {together:{},xuan:{},xi:{}};}

export function visibleEntries(layers, id, view) {
  let profiles;
  if (view === 'all') profiles = Object.keys(PROFILES);
  else if (layers[view]?.[id]?.active) profiles = [view];
  else profiles = ['together'];
  return profiles.filter(profile => layers[profile][id]?.active)
    .map(profile => ({ profile, record: layers[profile][id] }));
}
export function cleanLayers(value, legacy = {}) {
  const result=emptyLayers();
  for(const profile of Object.keys(result)){
    const source=value?.[profile] || (profile==='together'?legacy:{});
    for(const [id,row] of Object.entries(source))result[profile][id]=normalizeRecord(row);
  }
  return result;
}
export function recordsForView(layers,profile){
  if(profile==='together')return layers.together;
  const result={};
  const ids=new Set(Object.values(layers).flatMap(records=>Object.keys(records)));
  for(const id of ids){
    const joint=layers.together[id],own=layers[profile]?.[id];
    if(profile==='all'){
      const rows=[joint,layers.xuan[id],layers.xi[id]].filter(row=>row?.active);
      result[id]={...normalizeRecord(rows[0]),active:!!rows.length,note:rows.find(row=>row.note)?.note||''};
    }else{
      result[id]={...normalizeRecord(own),active:!!(own?.active||joint?.active),
        note:own?.active?own.note:(joint?.active?joint.note:own?.note)||'',
        author:own?.active?own.author:(joint?.active?joint.author:own?.author)||'访客',inherited:!!joint?.active};
    }
  }
  return result;
}
export function cityAppearance(layers,id,focus='together'){
  const joint=!!layers.together[id]?.active,xuan=!!layers.xuan[id]?.active,xi=!!layers.xi[id]?.active;
  const category=joint?'together':xuan&&xi?'both':xuan?'xuan':xi?'xi':null;
  const active=!!category;
  const emphasized=active&&(focus==='all'||joint||focus==='xuan'&&xuan||focus==='xi'&&xi);
  if(!active)return {active:false,emphasized:false,category:null,fill:'#f8f7ef',stroke:'#929986'};
  if(category==='both')return {active:true,emphasized,category,fill:emphasized?'url(#personal-both)':'url(#personal-both-muted)',stroke:'#6a8d98'};
  const style=PROFILES[category];
  return {active:true,emphasized,category,fill:emphasized?style.color:style.muted,stroke:emphasized?style.stroke:'#a9b3a6'};
}
export const PROFILE_PATTERNS = `<pattern id="personal-both" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#9ed9c5"/><rect width="4" height="8" fill="#bccdf3"/></pattern><pattern id="personal-both-muted" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e0ece5"/><rect width="4" height="8" fill="#e6eaf3"/></pattern>`;
