import { boundaryOpacity, lineStyles } from './boundaries.js';
import { visibleRuns } from './draw-ranges.js';
import { gpuType } from './gpu-type.js';

export const surfaceVertex = `
attribute vec4 point;
uniform vec3 east,north,front;
uniform vec2 stretch;
varying highp float facing;
varying highp float region;
void main(){
  facing=dot(front,point.xyz);
  region=point.w;
  gl_Position=vec4(vec2(dot(east,point.xyz),dot(north,point.xyz))*stretch,0.,1.);
}`;
export const surfaceFragment = `
precision highp float;
varying float facing,region;
uniform sampler2D palette;
uniform vec2 paletteSize;
uniform float mode,ratio,opacity;
uniform vec3 ink;
void main(){
  if(facing<0.)discard;
  if(mode<-.5){gl_FragColor=vec4(vec3(.973,.969,.937)*mix(.93,1.,clamp(facing*1.8,0.,1.)),1.);return;}
  if(mode>0.5){
    gl_FragColor=vec4(ink,opacity);return;
  }
  float id=floor(region+.5);
  vec4 paint=texture2D(palette,(vec2(mod(id,paletteSize.x),floor(id/paletteSize.x))+.5)/paletteSize);
  float kind=floor(paint.a*255.+.5);
  if(kind>1.5 && mod((gl_FragCoord.x+gl_FragCoord.y)/ratio,8.)<4.)
    paint.rgb=kind<2.5?vec3(.737,.804,.953):vec3(.902,.918,.953);
  float light=mix(.93,1.,clamp(facing*1.8,0.,1.));
  gl_FragColor=vec4(paint.rgb*light,1.);
}`;
export const oceanVertex = `
attribute vec2 point;varying vec2 screen;
void main(){screen=point;gl_Position=vec4(point,0.,1.);}`;
export const oceanFragment = `
precision highp float;
varying vec2 screen;
uniform vec2 stretch;
uniform vec3 east,north,front;
uniform float radius,zoom;
void main(){
  vec2 p=screen/stretch;
  float r=length(p);
  if(r>1.)discard;
  float z=sqrt(max(0.,1.-r*r));
  float line=0.;
  if(zoom<9.){
    vec3 v=east*p.x+north*p.y+front*z;
    vec2 ll=vec2(atan(v.x,v.z),asin(clamp(v.y,-1.,1.)));
    vec2 grid=abs(fract(ll/0.523598776+.5)-.5)*.523598776*radius*vec2(max(.07,sqrt(max(0.,1.-v.y*v.y))),1.);
    line=(1.-smoothstep(.18,.85,min(grid.x,grid.y)))*(1.-smoothstep(3.,9.,zoom));
  }
  vec3 sea=mix(vec3(.63,.76,.74),vec3(.83,.90,.86),clamp(.24+.68*z+.17*p.y-.12*p.x,0.,1.));
  sea=mix(sea,vec3(.38,.53,.49),.27*line);
  sea=mix(vec3(.15,.18,.15),sea,smoothstep(.2,1.55,(1.-r)*radius));
  gl_FragColor=vec4(sea,1.);
}`;

export function globeGPU(canvas, regionCount) {
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:false,stencil:false,premultipliedAlpha:false,powerPreference:'low-power'});
  if(!gl || !gl.getExtension('OES_element_index_uint'))return null;
  function program(vs,fs,names){
    const p=gl.createProgram();
    for(const [kind,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
      const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
      gl.attachShader(p,s);gl.deleteShader(s);
    }
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
    return {p,point:gl.getAttribLocation(p,'point'),...Object.fromEntries(names.split(' ').map(k=>[k,gl.getUniformLocation(p,k)]))};
  }
  const land=program(surfaceVertex,surfaceFragment,'east north front stretch palette paletteSize mode ratio ink opacity');
  const water=program(oceanVertex,oceanFragment,'east north front stretch radius zoom');
  function buffer(target,data){
    const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;
  }
  const quad=buffer(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]));
  const texture=gl.createTexture(), rows=Math.ceil(regionCount/256);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.NEAREST);
  for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
  const resources = new Map();
  const overlays = new Map();
  const active = new Uint8Array(regionCount);
  let revision = 0, textureReady = false;
  const inks = lineStyles.map(({color}) => [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255));
  const widths = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
  const maxWidth = widths?.[1] || 1;

  function material(tile) {
    let resource = resources.get(tile);
    if (resource) return resource;
    // Only country triangles need a permanent fill buffer. Colour overlays use
    // indices of the few areas with actual records or a current selection.
    const ground = tile.faces.subarray(tile.faces.length - tile.ground);
    resource = { ready: false, part: 0, offset: 0, parts: [
      {key:'points', target:gl.ARRAY_BUFFER, data:tile.points},
      {key:'ground', target:gl.ELEMENT_ARRAY_BUFFER, data:ground},
      {key:'edges', target:gl.ELEMENT_ARRAY_BUFFER, data:tile.edges}
    ]};
    resources.set(tile,resource);
    return resource;
  }

  function ensureBase(tile) {
    const resource = material(tile);
    if (!resource.ready) {
      for (const part of resource.parts) resource[part.key] = buffer(part.target, part.data);
      resource.ready = true;
      resource.parts = null;
    }
    return resource;
  }

  function uploadSome(tiles, moving) {
    let remaining = moving ? 192*1024 : 1024*1024;
    const deadline = performance.now() + (moving ? 1.0 : 2.5);
    for (const tile of tiles) {
      const r = material(tile);
      while (!r.ready) {
        const part = r.parts[r.part];
        if (!r[part.key]) {
          r[part.key] = gl.createBuffer();
          gl.bindBuffer(part.target,r[part.key]);
          gl.bufferData(part.target,part.data.byteLength,gl.STATIC_DRAW);
        } else gl.bindBuffer(part.target,r[part.key]);
        const bytes = Math.min(remaining,128*1024,part.data.byteLength-r.offset);
        if (bytes) {
          const first = r.offset / part.data.BYTES_PER_ELEMENT;
          gl.bufferSubData(part.target,r.offset,part.data.subarray(first,first+bytes/part.data.BYTES_PER_ELEMENT));
          remaining -= bytes;
          r.offset += bytes;
        }
        if (r.offset === part.data.byteLength) {
          r.offset = 0; r.part++;
          if (r.part === r.parts.length) { r.ready=true; r.parts=null; }
        }
        if (!remaining || performance.now() >= deadline) return;
      }
    }
  }

  function marks(tile) {
    let item = overlays.get(tile);
    if (item?.revision === revision) return item;
    const runs = tile.paintRuns;
    let count = 0;
    for (let i=0;i<runs.length;i+=3) if (active[runs[i]]) count += runs[i+2];
    if (!item) { item={buffer:null}; overlays.set(tile,item); }
    item.revision=revision; item.count=count;
    if (!count) return item;
    const indices = new Uint32Array(count);
    const mesh = tile.shared || tile, base = tile.slice?.fill || 0;
    let offset = 0;
    for (let i=0;i<runs.length;i+=3) if (active[runs[i]]) {
      const first = base+runs[i+1], length = runs[i+2];
      indices.set(mesh.faces.subarray(first,first+length),offset); offset+=length;
    }
    item.buffer ||= gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,item.buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.DYNAMIC_DRAW);
    return item;
  }

  function camera(program,f) {
    gl.useProgram(program.p);
    gl.uniform3fv(program.east,f.east);gl.uniform3fv(program.north,f.north);gl.uniform3fv(program.front,f.forward);
    gl.uniform2f(program.stretch,2*f.radius/f.width,2*f.radius/f.height);
  }
  function attributes(loc,b,n) {
    gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,n,gl.FLOAT,false,0,0);
  }
  function submit(primitive,f,ranges,count,base) {
    visibleRuns(f,ranges,count,(first,n)=>gl.drawElements(primitive,n,gl.UNSIGNED_INT,4*(base+first)));
  }
  let displayed=[],type=null;
  return {
    drawType(f,pages,version){
      type ||= gpuType(gl,program);
      type(f,pages,version);
    },
    get displayed(){return displayed;},
    palette(bytes) {
      let changed = false;
      for (let i=0;i<active.length;i++) {
        const next = bytes[i*4+3] ? 1 : 0;
        if (next !== active[i]) { active[i]=next; changed=true; }
      }
      if (changed) revision++;
      gl.bindTexture(gl.TEXTURE_2D,texture);
      if (textureReady) gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,rows,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,rows,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      textureReady = true;
    },
    evict(tile) {
      const r = resources.get(tile);
      if (r) for (const key of ['points','ground','edges']) if (r[key]) gl.deleteBuffer(r[key]);
      const marks = overlays.get(tile);
      if (marks?.buffer) gl.deleteBuffer(marks.buffer);
      resources.delete(tile); overlays.delete(tile);
    },
    draw(f,requested,moving=false) {
      const pending=[], tiles=[];
      for (const tile of requested) {
        // A fine packet replaces only its own coarse slice. Other coastlines
        // stay sharp even while a neighbouring packet is loading.
        const waiting = tile.fallback && !resources.get(tile)?.ready;
        if (waiting) pending.push(tile);
        const shown = waiting ? tile.fallback : tile;
        tiles.push({tile:shown,b:ensureBase(shown.shared || shown)});
      }
      displayed=tiles.map(item=>item.tile);
      const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(1800000/(f.width*f.height)));
      const w=Math.round(f.width*ratio), h=Math.round(f.height*ratio);
      if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
      gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);camera(water,f);
      gl.uniform1f(water.radius,f.radius);gl.uniform1f(water.zoom,f.zoom);
      attributes(water.point,quad,2);gl.drawArrays(gl.TRIANGLES,0,3);
      gl.disableVertexAttribArray(water.point);
      camera(land,f);gl.uniform1i(land.palette,0);gl.uniform2f(land.paletteSize,256,rows);gl.uniform1f(land.ratio,ratio);
      gl.uniform1f(land.mode,-1);
      for(const {tile,b} of tiles){
        if(!tile.ground)continue;
        attributes(land.point,b.points,4);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.ground);
        submit(gl.TRIANGLES,f,tile.groundRuns,tile.ground,tile.slice?.ground||0);
      }
      gl.uniform1f(land.mode,0);
      for(const {tile,b} of tiles){
        const overlay=marks(tile);if(!overlay.count)continue;
        attributes(land.point,b.points,4);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,overlay.buffer);
        gl.drawElements(gl.TRIANGLES,overlay.count,gl.UNSIGNED_INT,0);
      }
      gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(land.mode,1);
      const opacity=boundaryOpacity(f);
      for(let level=0;level<3;level++){
        if (opacity[level]===0) continue;
        const pixels=ratio*lineStyles[level].width;
        const lineWidth=Math.max(1,Math.min(maxWidth,pixels));
        gl.lineWidth(lineWidth);gl.uniform3fv(land.ink,inks[level]);
        gl.uniform1f(land.opacity,opacity[level]*Math.min(1,pixels/lineWidth));
        for(const {tile,b} of tiles){
          const n=tile.lineCounts[level];if(!n)continue;
          attributes(land.point,b.points,4);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.edges);
          const offset=tile.slice?.edges[level] ?? (level===0?0:level===1?tile.lineCounts[0]:tile.lineCounts[0]+tile.lineCounts[1]);
          submit(gl.LINES,f,tile.edgeRuns?.[level],n,offset);
        }
      }
      gl.disableVertexAttribArray(land.point);
      if (pending.length) uploadSome(pending,moving);
      return pending.length>0;
    }
  };
}
