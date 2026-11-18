// Render only a newly requested word or pin. Sending small RGBA rectangles
// avoids synchronous canvas-to-WebGL copies in the iOS display callback.
export function rasterizer(canvas, ratio) {
  canvas.width=1024; canvas.height=112;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx || typeof ctx.getImageData!=='function' || typeof ctx.strokeText!=='function')throw Error('No glyph canvas');
  return spec=>{
    let w,h,raster=20*ratio,baseline=0;
    ctx.lineJoin='round';
    if(spec.pin){
      w=h=Math.ceil(12*ratio);ctx.clearRect(0,0,w,h);
      ctx.beginPath();ctx.arc(w/2,h/2,3.2*ratio,0,2*Math.PI);
      const striped=spec.color.startsWith('url'), muted=spec.color.includes('muted');
      ctx.fillStyle=striped?(muted?'#e0ece5':'#9ed9c5'):spec.color;ctx.fill();
      if(striped){
        ctx.save();ctx.clip();ctx.fillStyle=muted?'#e6eaf3':'#bccdf3';ctx.fillRect(w/2,0,w/2,h);ctx.restore();
      }
      ctx.strokeStyle='#30392b';ctx.lineWidth=1.35*ratio;ctx.stroke();
    }else{
      const font=px=>(spec.bold?'700 ':'500 ')+px+'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.font=font(raster);
      const measured=ctx.measureText(spec.text).width;
      raster*=Math.min(1,(canvas.width-8*ratio)/Math.max(1,measured));
      w=Math.min(canvas.width,Math.ceil(measured*raster/(20*ratio)+8*ratio));
      h=Math.ceil(raster*1.75);baseline=Math.round(raster*1.16);
      ctx.clearRect(0,0,w,h);ctx.textAlign='center';ctx.font=font(raster);
      ctx.lineWidth=raster*.13;ctx.strokeStyle='#f8f7ef';ctx.fillStyle='#30392b';
      ctx.strokeText(spec.text,w/2,baseline);ctx.fillText(spec.text,w/2,baseline);
    }
    const data=ctx.getImageData(0,0,w,h).data;
    return {key:spec.key,w,h,raster,baseline,pixels:new Uint8Array(data.buffer,data.byteOffset,data.byteLength)};
  };
}
