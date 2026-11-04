// =============================================================================
// Cheap bloom: bright pixels are extracted into a LOW-resolution texture,
// blurred there with a few Kawase passes, then added back on top of the
// full-resolution image. Much cheaper than blurring at full resolution and the
// main image stays perfectly crisp.
// =============================================================================
const PIXI = window.PIXI;

const EXTRACT = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputPixel;
uniform vec4 inputClamp;
uniform float threshold;
vec4 tap(vec2 o) { return texture2D(uSampler, clamp(vTextureCoord + o * inputPixel.zw, inputClamp.xy, inputClamp.zw)); }
void main() {
  vec4 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = c * smoothstep(threshold, threshold + 0.3, l);
}`;

const KAWASE = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputPixel;
uniform vec4 inputClamp;
uniform float uOffset;
void main() {
  vec2 o = inputPixel.zw * (uOffset + 0.5);
  vec4 c = texture2D(uSampler, clamp(vTextureCoord + vec2(-o.x, o.y), inputClamp.xy, inputClamp.zw));
  c += texture2D(uSampler, clamp(vTextureCoord + vec2(o.x, o.y), inputClamp.xy, inputClamp.zw));
  c += texture2D(uSampler, clamp(vTextureCoord + vec2(o.x, -o.y), inputClamp.xy, inputClamp.zw));
  c += texture2D(uSampler, clamp(vTextureCoord + vec2(-o.x, -o.y), inputClamp.xy, inputClamp.zw));
  gl_FragColor = c * 0.25;
}`;

const COMBINE = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D bloomTexture;
uniform vec2 bloomUV;
uniform vec4 bloomClamp;
uniform float bloomScale;
void main() {
  vec4 c = texture2D(uSampler, vTextureCoord);
  vec4 b = texture2D(bloomTexture, clamp(vTextureCoord * bloomUV, bloomClamp.xy, bloomClamp.zw));
  gl_FragColor = c + b * bloomScale;
}`;

export class BloomFilter extends PIXI.Filter {
  constructor({ threshold = 0.45, scale = 0.9, downsample = 0.25, passes = [0, 1, 2, 3] } = {}) {
    super(undefined, COMBINE, { bloomTexture: PIXI.Texture.EMPTY, bloomUV: new Float32Array([1, 1]), bloomClamp: new Float32Array([0, 0, 1, 1]), bloomScale: scale });
    this.extract = new PIXI.Filter(undefined, EXTRACT, { threshold });
    this.kawase = new PIXI.Filter(undefined, KAWASE, { uOffset: 0 });
    this.downsample = downsample;
    this.passes = passes;
  }

  set bloomScale(v) { this.uniforms.bloomScale = v; }
  get bloomScale() { return this.uniforms.bloomScale; }

  apply(fm, input, output, clear) {
    const res = Math.max(0.1, input.resolution * this.downsample);
    let a = fm.getFilterTexture(input, res);
    let b = fm.getFilterTexture(input, res);
    fm.applyFilter(this.extract, input, a, PIXI.CLEAR_MODES.CLEAR);
    for (const k of this.passes) {
      this.kawase.uniforms.uOffset = k;
      fm.applyFilter(this.kawase, a, b, PIXI.CLEAR_MODES.CLEAR);
      const t = a; a = b; b = t;
    }
    // map full-res UVs onto the low-res texture (pool textures are padded)
    const inW = input.baseTexture.realWidth, inH = input.baseTexture.realHeight;
    const bW = a.baseTexture.realWidth, bH = a.baseTexture.realHeight;
    const k = res / input.resolution;
    this.uniforms.bloomUV[0] = inW * k / bW;
    this.uniforms.bloomUV[1] = inH * k / bH;
    this.uniforms.bloomClamp[2] = (a.frame.width * res - 0.5) / bW;
    this.uniforms.bloomClamp[3] = (a.frame.height * res - 0.5) / bH;
    this.uniforms.bloomTexture = a;
    fm.applyFilter(this, input, output, clear);
    fm.returnFilterTexture(a);
    fm.returnFilterTexture(b);
  }
}
