// The effects layer of the HLL language, re-implemented without the React library:
// a cursor-driven gradient field in the spirit of the "jewel refraction" shader
// (sine warp, voronoi facets, vignette). Falls back to a plain gradient without WebGL.

export const GRADIENTS = {
  services: ['#F7A567', '#E05A35', '#EB3B3E'], industries: ['#0352B2', '#037A9F', '#6460D5'], engagement: ['#F9B535', '#FF9126', '#FF6302'],
  about: ['#9AB4D3', '#A28DD7', '#AD7ECF'], contact: ['#ABBFFF', '#2BB4EB', '#076EB8'],
  'hll-ai': ['#3773FF', '#7F8CEB', '#BCA6D6'], 'hll-trust': ['#129562', '#47A886', '#7CBAAA'], 'hll-foundation': ['#FF5A1E', '#E67258', '#CC8B93'],
  'hll-ontology': ['#7455FF', '#BA84B5', '#FFB26A'], 'hll-people': ['#FF9042', '#FFBF85', '#FFEEC7'], 'hll-application': ['#FF1F1F', '#B9658F', '#72AAFF'],
};
export const cssVarFor = (variant) => `var(--g-${variant.replace('hll-', '')})`;

const FRAG = `precision highp float;
uniform vec2 r; uniform float t; uniform vec2 m; uniform vec3 c0; uniform vec3 c1; uniform vec3 c2;
vec2 h2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / r;
  vec2 p = (gl_FragCoord.xy - .5*r) / r.y;
  p += .13*vec2(sin(p.y*3.18 + t*.35), cos(p.x*3.18 - t*.29));
  p += (m - .5)*.3;
  vec2 g = floor(p*3.2), f = fract(p*3.2); float d = 9.; vec2 id = g;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 o = h2(g + vec2(i,j)); o = .5 + .5*sin(t*.45 + 6.2831*o);
    vec2 q = vec2(i,j) + o - f; float dd = dot(q,q);
    if(dd < d){ d = dd; id = g + vec2(i,j); }
  }
  float h = fract(sin(dot(id, vec2(12.9898,78.233)))*43758.5453);
  float s = clamp(uv.x*.55 + uv.y*.2 + h*.45 + .12*sin(t*.2 + h*6.) + (m.x-.5)*.25, 0., 1.);
  vec3 col = s < .5 ? mix(c0, c1, s*2.) : mix(c1, c2, (s-.5)*2.);
  col *= 1.08 - .5*smoothstep(0., .85, sqrt(d));
  float v = smoothstep(1.25, .15, length(p*vec2(.75, 1.)));
  gl_FragColor = vec4(col*mix(.28, 1., v), 1.);
}`;

/** Paint the field into `canvas`. Returns a stop function. */
export function mountField(canvas, variant = 'services') {
  const colors = GRADIENTS[variant] || GRADIENTS.services;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!gl) { canvas.style.background = `linear-gradient(120deg, ${colors.join(',')})`; return () => {}; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.style.background = `linear-gradient(120deg, ${colors.join(',')})`; return () => {}; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  colors.forEach((c, i) => gl.uniform3fv(u(`c${i}`), rgb(c)));
  const mouse = [0.5, 0.5], aim = [0.5, 0.5];
  const move = (e) => { const b = canvas.getBoundingClientRect(); aim[0] = (e.clientX - b.left) / b.width; aim[1] = 1 - (e.clientY - b.top) / b.height; };
  window.addEventListener('pointermove', move);
  let raf = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); gl.viewport(0, 0, canvas.width, canvas.height); }
    mouse[0] += (aim[0] - mouse[0]) * 0.05; mouse[1] += (aim[1] - mouse[1]) * 0.05;
    gl.uniform2f(u('r'), canvas.width, canvas.height); gl.uniform1f(u('t'), reduce ? 4 : now / 1000); gl.uniform2f(u('m'), mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduce) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); };
}
