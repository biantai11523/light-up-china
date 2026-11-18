// Geography is uploaded once. Rotation and zoom only change camera uniforms.
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
uniform float mode,ratio,zoom;
void main(){
  if(facing<0.)discard;
  if(mode<-.5){gl_FragColor=vec4(vec3(.973,.969,.937)*mix(.93,1.,clamp(facing*1.8,0.,1.)),1.);return;}
  if(mode>0.5){
    vec3 ink=mode>1.5?vec3(.23,.28,.23):vec3(.48,.53,.46);
    float alpha=mode>2.5?.90:mode>1.5?.78:smoothstep(1.4,6.,zoom)*.66;
    gl_FragColor=vec4(ink,alpha);return;
  }
  float id=floor(region+.5);
  vec4 paint=texture2D(palette,(vec2(mod(id,paletteSize.x),floor(id/paletteSize.x))+.5)/paletteSize);
  float kind=floor(paint.a*255.+.5);
  if(kind>.5 && mod((gl_FragCoord.x+gl_FragCoord.y)/ratio,8.)<4.)
    paint.rgb=kind<1.5?vec3(.737,.804,.953):vec3(.902,.918,.953);
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
  vec3 v=east*p.x+north*p.y+front*z;
  vec2 ll=vec2(atan(v.x,v.z),asin(clamp(v.y,-1.,1.)));
  vec2 grid=abs(fract(ll/0.523598776+.5)-.5)*.523598776*radius*vec2(max(.07,cos(ll.y)),1.);
  float line=(1.-smoothstep(.18,.85,min(grid.x,grid.y)))*(1.-smoothstep(3.,9.,zoom));
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
  const land=program(surfaceVertex,surfaceFragment,'east north front stretch palette paletteSize mode ratio zoom');
  const water=program(oceanVertex,oceanFragment,'east north front stretch radius zoom');
  function buffer(target,data){
    const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;
  }
  const quad=buffer(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]));
  const texture=gl.createTexture(), rows=Math.ceil(regionCount/256);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.NEAREST);
  for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
  const cache=new Map();
  function upload(t){
    if(!cache.has(t))cache.set(t,{
      points:buffer(gl.ARRAY_BUFFER,t.points),faces:buffer(gl.ELEMENT_ARRAY_BUFFER,t.faces),edges:buffer(gl.ELEMENT_ARRAY_BUFFER,t.edges)
    });
    return cache.get(t);
  }
  function camera(program,f){
    gl.useProgram(program.p);
    gl.uniform3fv(program.east,f.east);gl.uniform3fv(program.north,f.north);gl.uniform3fv(program.front,f.forward);
    gl.uniform2f(program.stretch,2*f.radius/f.width,2*f.radius/f.height);gl.uniform1f(program.zoom,f.zoom);
  }
  function attributes(loc,b,n){
    gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,n,gl.FLOAT,false,0,0);
  }
  return {
    resident(t){return cache.has(t);},
    palette(bytes){gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,rows,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);},
    evict(t){const v=cache.get(t);if(v)Object.values(v).forEach(b=>gl.deleteBuffer(b));cache.delete(t);},
    draw(f,tiles) {
      const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(1800000/(f.width*f.height)));
      const w=Math.round(f.width*ratio),h=Math.round(f.height*ratio);
      if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
      gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);camera(water,f);gl.uniform1f(water.radius,f.radius);attributes(water.point,quad,2);gl.drawArrays(gl.TRIANGLES,0,3);
      gl.disableVertexAttribArray(water.point);
      camera(land,f);gl.uniform1i(land.palette,0);gl.uniform2f(land.paletteSize,256,rows);gl.uniform1f(land.ratio,ratio);
      gl.uniform1f(land.mode,-1);
      for(const t of tiles){
        if(!t.ground)continue;
        const b=upload(t);attributes(land.point,b.points,4);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.faces);
        gl.drawElements(gl.TRIANGLES,t.ground,gl.UNSIGNED_INT,4*(t.faces.length-t.ground));
      }
      gl.uniform1f(land.mode,0);
      for(const t of tiles){
        const n=t.faces.length-t.ground;if(!n)continue;
        const b=upload(t);attributes(land.point,b.points,4);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.faces);
        gl.drawElements(gl.TRIANGLES,n,gl.UNSIGNED_INT,0);
      }
      gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      for(let level=0;level<3;level++){
        if(level===0 && f.zoom<1.45 || level===1 && f.zoom<2)continue;
        gl.uniform1f(land.mode,level+1);
        gl.lineWidth(Math.max(1,ratio*(level===2?1.15:level===1?.8:.48)));
        for(const t of tiles){
          const n=t.lineCounts[level];if(!n)continue;
          const b=upload(t);attributes(land.point,b.points,4);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.edges);
          const offset=level===0?0:level===1?t.lineCounts[0]:t.lineCounts[0]+t.lineCounts[1];
          gl.drawElements(gl.LINES,n,gl.UNSIGNED_INT,4*offset);
        }
      }
      gl.disableVertexAttribArray(land.point);
    }
  };
}
