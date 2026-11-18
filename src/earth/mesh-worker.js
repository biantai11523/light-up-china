import { decodePacket, batchOverview } from './mesh.js';
self.onmessage = ({data}) => {
  try {
    const tiles=decodePacket(data.buffer,data.regions,data.provinces);
    if(data.overview)tiles.push(batchOverview(tiles));
    const transfer=new Set();
    for(const t of tiles){
      for(const array of [t.points,t.faces,t.edges])transfer.add(array.buffer);
      for(const s of t.shapes)transfer.add(s.coords.buffer);
    }
    self.postMessage({id:data.id,tiles},[...transfer]);
  } catch(error){ self.postMessage({id:data.id,error:error.message}); }
};
