import { rasterizer } from './type-raster.js';
let raster;
self.onmessage=({data})=>{
  try{
    raster ||= rasterizer(new OffscreenCanvas(1,1),data.ratio);
    const glyphs=data.words.map(raster);
    self.postMessage({glyphs},glyphs.map(g=>g.pixels.buffer));
  }catch{self.postMessage({unsupported:true});}
};
