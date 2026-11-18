import { decodePacket, batchOverview } from './mesh.js';
import { vectorSurface } from './drawing.js';

let base, layout, lowRings, features;
const compressed=new Map(), detailedRings=new Map();
function rings(key,fine) {
  if(fine){
    if(!detailedRings.has(key)){
      if(!compressed.has(key))throw Error('Detail packet is no longer resident');
      detailedRings.set(key,decodePacket(compressed.get(key),layout,true)[0]);
    }
    return detailedRings.get(key);
  }
  lowRings ||= new Map(decodePacket(base,layout,true).map(t=>[t.key,t]));
  return lowRings.get(key);
}
self.onmessage = ({data}) => {
  try {
    if(data.type==='evict'){
      compressed.delete(data.key);detailedRings.delete(data.key);return;
    }
    if(data.type==='project'){
      if(data.ids)features=data.ids.map(id=>({id}));
      const tiles=data.keys.map(([key,fine])=>rings(key,fine));
      const surface=vectorSurface({features},data.frame,tiles,new Map(data.paints),new Set(data.selected),data.moving,data.pad);
      self.postMessage({id:data.id,surface});return;
    }
    layout=data.layout;
    const tiles=decodePacket(data.buffer,data.layout);
    if(data.overview){base=data.buffer;tiles.push(batchOverview(tiles));}
    else compressed.set(tiles[0].key,data.buffer);
    const transfer=new Set();
    for(const t of tiles){
      for(const array of [t.points,t.faces,t.edges,t.paintRuns,t.groundRuns,...(t.edgeRuns||[])])if(array)transfer.add(array.buffer);
      for(const s of t.shapes)transfer.add(s.coords.buffer);
    }
    self.postMessage({id:data.id,tiles},[...transfer]);
  } catch(error){ self.postMessage({id:data.id,error:error.message}); }
};
