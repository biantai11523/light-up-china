const vertex = `
attribute vec4 point;
uniform vec2 viewport;
varying highp vec2 uv;
void main(){
  uv=point.zw;
  gl_Position=vec4(2.*point.x/viewport.x-1.,1.-2.*point.y/viewport.y,0.,1.);
}`;
const fragment = `
precision highp float;
uniform sampler2D atlas;
varying highp vec2 uv;
void main(){gl_FragColor=texture2D(atlas,uv);}`;

// Text and pins share the globe's drawing buffer. Panning changes a few small
// screen quads, not an entire transparent retina-sized canvas or SVG text tree.
export function gpuType(gl, program) {
  const shader=program(vertex,fragment,'viewport atlas');
  const resources=new WeakMap();
  return (f,pages,version)=>{
    gl.useProgram(shader.p);
    gl.uniform2f(shader.viewport,f.width,f.height);gl.uniform1i(shader.atlas,1);
    gl.activeTexture(gl.TEXTURE1);gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.enableVertexAttribArray(shader.point);
    for(const page of pages){
      if(!page.length)continue;
      let r=resources.get(page);
      if(!r){
        r={texture:gl.createTexture(),quads:gl.createBuffer(),capacity:0,version:0};
        resources.set(page,r);gl.bindTexture(gl.TEXTURE_2D,r.texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1024,1024,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      }else gl.bindTexture(gl.TEXTURE_2D,r.texture);
      if(r.generation!==page.generation){r.uploaded=0;r.generation=page.generation;}
      while(r.uploaded<page.entries.length){
        const g=page.entries[r.uploaded++];
        gl.texSubImage2D(gl.TEXTURE_2D,0,g.x,g.y,g.w,g.h,gl.RGBA,gl.UNSIGNED_BYTE,g.pixels);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,r.quads);
      if(r.version!==version){
        if(r.capacity<page.vertices.byteLength){
          r.capacity=page.vertices.byteLength;gl.bufferData(gl.ARRAY_BUFFER,r.capacity,gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER,0,page.vertices.subarray(0,page.length));
        r.version=version;
      }
      gl.vertexAttribPointer(shader.point,4,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLES,0,page.length/4);
    }
    gl.disableVertexAttribArray(shader.point);gl.activeTexture(gl.TEXTURE0);
  };
}
