import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

/**
 * Dual-shadow eclipse lighting:
 *  - rtEarthToMoon : 지구 → 달(월식) 깊이맵
 *  - rtMoonToEarth : 달   → 지구(일식) 깊이맵
 *  - 지구 대기 산란: 얇은 셸(BackSide) + Additive
 *  - 지구/달 텍스처(Map) 있으면 함께 곱해서 표시
 *
 * 사용법:
 *   const fx = new LightingEffect(sceneManager, renderer, { shadowRes: 1024 });
 *   매 프레임: fx.update({ sun: v3, earth: v3, moon: v3, camera })
 */
export class LightingEffect {
  constructor(sceneManager, renderer, opts = {}) {
    this.sceneMgr = sceneManager;
    this.scene = sceneManager.getScene();
    this.renderer = renderer;

    this.shadowRes  = opts.shadowRes  ?? 1024;
    this.orthoSize  = opts.orthoSize  ?? 7.0;
    this.lightNear  = opts.lightNear  ?? 0.1;
    this.lightFar   = opts.lightFar   ?? 40.0;
    this.pcfRadius  = opts.pcf        ?? 2;     // 0~3
    this.redness    = opts.redness    ?? 1.0;   // 월식 붉은 기
    this.atmPower   = opts.atmosphere ?? 1.0;   // 대기 강도

    // light camera (directional)
    this.lightCam = new THREE.OrthographicCamera(
      -this.orthoSize, this.orthoSize,
       this.orthoSize, -this.orthoSize,
       this.lightNear, this.lightFar
    );

    // depth targets
    this.rtEarthToMoon = new THREE.WebGLRenderTarget(this.shadowRes, this.shadowRes, { depthBuffer: true });
    this.rtEarthToMoon.depthTexture = new THREE.DepthTexture(this.shadowRes, this.shadowRes, THREE.UnsignedIntType);
    this.rtEarthToMoon.depthTexture.format = THREE.DepthFormat;

    this.rtMoonToEarth = new THREE.WebGLRenderTarget(this.shadowRes, this.shadowRes, { depthBuffer: true });
    this.rtMoonToEarth.depthTexture = new THREE.DepthTexture(this.shadowRes, this.shadowRes, THREE.UnsignedIntType);
    this.rtMoonToEarth.depthTexture.format = THREE.DepthFormat;

    // occluder geo (unit sphere, 스케일/트랜슬레이트로 위치 맞춤)
    this.geoSphere = new THREE.SphereGeometry(1, 64, 64);

    this._buildMaterials();
    this._applyToScene();
  }

  // ---------- Embeded GLSL ----------
  static GLSL = {
    commonVert: /* glsl */`
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUV;

uniform mat4 uProj, uView, uModel;
uniform mat4 uLightVP;
uniform vec3 uLightDir;

out vec3 vPosW; out vec3 vNorW; out vec2 vUV;
out vec4 vShadowPos;

mat4 transpose_(mat4 m){
  return mat4(m[0][0],m[1][0],m[2][0],m[3][0],
              m[0][1],m[1][1],m[2][1],m[3][1],
              m[0][2],m[1][2],m[2][2],m[3][2],
              m[0][3],m[1][3],m[2][3],m[3][3]);
}
vec3 normalMatrix_(vec3 n, mat4 model){ return normalize(mat3(transpose_(inverse(model))) * n); }
`,

    commonFrag: /* glsl */`
precision highp float;
uniform sampler2D uShadow;
uniform vec2 uShadowRes;
uniform int uPCF;
uniform vec3 uLightDir;

in vec3 vPosW; in vec3 vNorW; in vec2 vUV; in vec4 vShadowPos;

float sampleShadowPCF_(vec4 sp){
  vec3 ndc = sp.xyz / sp.w;
  vec3 uvz = ndc * 0.5 + 0.5;
  if(uvz.x<0.0||uvz.x>1.0||uvz.y<0.0||uvz.y>1.0) return 1.0;
  float current = uvz.z;
  float dx=1.0/uShadowRes.x, dy=1.0/uShadowRes.y;
  int r = uPCF; float sum=0.0; int taps=0;
  for(int j=-3;j<=3;j++){
    for(int i=-3;i<=3;i++){
      if(i<-r||i>r||j<-r||j>r) continue;
      taps++;
      float d = texture(uShadow, vec2(uvz.x+float(i)*dx, uvz.y+float(j)*dy)).r;
      sum += current <= d ? 1.0 : 0.0;
    }
  }
  return taps>0 ? sum/float(taps) : 1.0;
}
`,

    depthV: /* glsl */`#version 300 es
#include <commonVert>
void main(){
  vPosW = (uModel * vec4(aPos,1.0)).xyz;
  vNorW = normalMatrix_(aNor, uModel);
  vUV   = aUV;
  vShadowPos = (uLightVP * vec4(vPosW,1.0));
  gl_Position = vShadowPos;
}`,

    depthF: /* glsl */`#version 300 es
precision highp float;
void main(){ }`,

    earthV: /* glsl */`#version 300 es
#include <commonVert>
void main(){
  vPosW = (uModel * vec4(aPos,1.0)).xyz;
  vNorW = normalMatrix_(aNor, uModel);
  vUV   = aUV;
  vShadowPos = (uLightVP * vec4(vPosW,1.0));
  gl_Position = uProj * uView * vec4(vPosW,1.0);
}`,

    earthF: /* glsl */`#version 300 es
precision highp float;
#include <commonFrag>
uniform vec3  uBaseColor;
uniform float uAtm;
uniform sampler2D uAlbedo;  // 지구 텍스처(있으면 사용)
out vec4 o;

vec3 lambert(vec3 n, vec3 l, vec3 base){
  float ndl = max(dot(n,-l),0.0);
  vec3 diff = base * ndl;
  float ao = 0.35 + 0.65 * pow(max(n.y*0.5+0.5,0.0), 0.6);
  return diff + vec3(0.03,0.05,0.07)*ao;
}

void main(){
  vec3 N = normalize(vNorW);
  float sh = sampleShadowPCF_(vShadowPos);
  vec3 albedo = texture(uAlbedo, vUV).rgb;
  if (albedo == vec3(0.0)) albedo = uBaseColor;

  vec3 lit = lambert(N, uLightDir, albedo);
  float horizon = pow(1.0 - abs(N.y), 3.0);
  vec3 haze = vec3(0.30,0.45,0.85) * horizon * 0.25 * uAtm;

  lit *= mix(0.15, 1.0, sh); // 달 그림자
  o = vec4(lit + haze, 1.0);
}`,

    moonV: /* glsl */`#version 300 es
#include <commonVert>
void main(){
  vPosW = (uModel * vec4(aPos,1.0)).xyz;
  vNorW = normalMatrix_(aNor, uModel);
  vUV   = aUV;
  vShadowPos = (uLightVP * vec4(vPosW,1.0));
  gl_Position = uProj * uView * vec4(vPosW,1.0);
}`,

    moonF: /* glsl */`#version 300 es
precision highp float;
#include <commonFrag>
uniform vec3  uBaseColor;
uniform float uRedness;        // 월식 붉은 정도
uniform sampler2D uAlbedo;     // 달 텍스처(있으면 사용)
out vec4 o;

vec3 lambert(vec3 n, vec3 l, vec3 base){
  float ndl = max(dot(n,-l),0.0);
  return base * ndl + vec3(0.02);
}

void main(){
  vec3 N = normalize(vNorW);
  float visible = sampleShadowPCF_(vShadowPos); // 1=해빛, 0=그림자
  vec3 albedo = texture(uAlbedo, vUV).rgb;
  if (albedo == vec3(0.0)) albedo = uBaseColor;

  vec3 base = lambert(N, uLightDir, albedo);

  float umbra = 1.0 - visible;
  float pen   = smoothstep(0.0, 0.7, umbra); // 반그림자→본그림자
  vec3 redTint = vec3(0.55, 0.16, 0.08) * (0.6 + 0.4*abs(N.y));
  vec3 col = mix(base, redTint*uRedness, pen);

  // earthshine (약간의 림)
  col += 0.06 * (1.0-pen) * (0.5 + 0.5*pow(1.0-abs(N.y),2.0));

  o = vec4(col, 1.0);
}`,

    atmV: /* glsl */`#version 300 es
#include <commonVert>
void main(){
  vPosW = (uModel * vec4(aPos,1.0)).xyz;
  vNorW = normalMatrix_(aNor, uModel);
  vUV   = aUV;
  vShadowPos = (uLightVP * vec4(vPosW,1.0));
  gl_Position = uProj * uView * vec4(vPosW,1.0);
}`,

    atmF: /* glsl */`#version 300 es
precision highp float;
#include <commonFrag>
uniform float uAtm; // 대기 강도
out vec4 o;
void main(){
  vec3 N = normalize(vNorW);
  float viewFacing = pow(1.0 - max(dot(N, vec3(0.0,0.0,1.0)), 0.0), 2.0);
  float forward = pow(max(dot(-uLightDir, N), 0.0), 8.0);
  vec3 sky = vec3(0.25,0.5,0.95) * (0.35*viewFacing + 0.65*forward) * uAtm * 0.8;
  o = vec4(sky, 1.0);
}`
  };

  _raw(vsrc, fsrc, extra = {}) {
    const v = vsrc.replace("#include <commonVert>", LightingEffect.GLSL.commonVert);
    const f = fsrc.replace("#include <commonFrag>", LightingEffect.GLSL.commonFrag);
    const base = {
      uProj:     { value: new THREE.Matrix4() },
      uView:     { value: new THREE.Matrix4() },
      uModel:    { value: new THREE.Matrix4() },
      uLightVP:  { value: new THREE.Matrix4() },
      uLightDir: { value: new THREE.Vector3(1,1,1).normalize() },
      uShadow:   { value: null },
      uShadowRes:{ value: new THREE.Vector2(this.shadowRes, this.shadowRes) },
      uPCF:      { value: this.pcfRadius },
    };
    return new THREE.RawShaderMaterial({
      vertexShader: v,
      fragmentShader: f,
      glslVersion: THREE.GLSL3,
      uniforms: Object.assign(base, extra),
      depthTest: true,
      depthWrite: true,
    });
  }

  _buildMaterials() {
    // depth mat
    this.matDepth = this._raw(LightingEffect.GLSL.depthV, LightingEffect.GLSL.depthF);

    // 지구/달 텍스처를 SceneManager에서 받아다가 셰이더로 전달
    const earthTex = this.sceneMgr.getEarthMaterial()?.map ?? null;
    const moonTex  = this.sceneMgr.getMoonMaterial()?.map  ?? null;

    // earth
    this.matEarth = this._raw(LightingEffect.GLSL.earthV, LightingEffect.GLSL.earthF, {
      uShadow:   { value: this.rtMoonToEarth.depthTexture },
      uBaseColor:{ value: new THREE.Color(0x0d1e2e) },
      uAtm:      { value: this.atmPower },
      uAlbedo:   { value: earthTex },
    });

    // moon
    this.matMoon = this._raw(LightingEffect.GLSL.moonV, LightingEffect.GLSL.moonF, {
      uShadow:   { value: this.rtEarthToMoon.depthTexture },
      uBaseColor:{ value: new THREE.Color(0xaaaaaa) },
      uRedness:  { value: this.redness },
      uAlbedo:   { value: moonTex },
    });

    // atmosphere (BackSide, additive)
    this.matAtm = this._raw(LightingEffect.GLSL.atmV, LightingEffect.GLSL.atmF, {
      uAtm: { value: this.atmPower },
    });
    this.matAtm.blending = THREE.AdditiveBlending;
    this.matAtm.depthWrite = false;
    this.matAtm.transparent = true;
    this.matAtm.side = THREE.BackSide;
  }

  _applyToScene() {
    const earth = this.sceneMgr.getEarthMesh();
    const moon  = this.sceneMgr.getMoonMesh();
    if (!earth || !moon) {
      console.warn("[LightingEffect] earth/moon mesh not found");
      return;
    }
    earth.material = this.matEarth;
    moon.material  = this.matMoon;

    if (!earth.getObjectByName("atmosphere")) {
      const atm = new THREE.Mesh(new THREE.SphereGeometry(1.03, 64, 64), this.matAtm);
      atm.name = "atmosphere";
      earth.add(atm);
    }
  }

  // ---- UI에서 조절하고 싶으면 이 메서드들 쓰면 됨 ----
  setPCF(r){ this.pcfRadius = Math.max(0, Math.min(3, r|0)); this.matEarth.uniforms.uPCF.value=this.pcfRadius; this.matMoon.uniforms.uPCF.value=this.pcfRadius; }
  setRedness(v){ this.redness = v; this.matMoon.uniforms.uRedness.value = v; }
  setAtmosphere(v){ this.atmPower = v; this.matEarth.uniforms.uAtm.value=v; this.matAtm.uniforms.uAtm.value=v; }

  // ---- per-frame ----
  update({ sun, earth, moon, camera }) {
    if (!sun || !moon) return;

    // 1) light camera from sun dir
    const lightDir = new THREE.Vector3().copy(sun).normalize();
    const eye = new THREE.Vector3().copy(lightDir).multiplyScalar(-10.0);
    this.lightCam.position.copy(eye);
    this.lightCam.lookAt(0,0,0);
    this.lightCam.updateMatrixWorld(true);
    this.lightCam.updateProjectionMatrix();
    const lightVP = new THREE.Matrix4().multiplyMatrices(this.lightCam.projectionMatrix, this.lightCam.matrixWorldInverse);

    // 2) depth maps
    const prevTarget = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.autoClear;
    this.renderer.autoClear = true;

    const depthMesh = new THREE.Mesh(this.geoSphere, this.matDepth);

    // Earth→Moon (지구 본체를 원점·반지름1로 그린다)
    this.matDepth.uniforms.uModel.value.identity();
    this.matDepth.uniforms.uLightVP.value.copy(lightVP);
    this.renderer.setRenderTarget(this.rtEarthToMoon);
    this.renderer.clear();
    this._renderTemp(depthMesh);

    // Moon→Earth (달 위치/스케일 적용)
    const mm = new THREE.Matrix4()
      .makeTranslation(moon.x, moon.y, moon.z)
      .multiply(new THREE.Matrix4().makeScale(0.27,0.27,0.27));
    this.matDepth.uniforms.uModel.value.copy(mm);
    this.matDepth.uniforms.uLightVP.value.copy(lightVP);
    this.renderer.setRenderTarget(this.rtMoonToEarth);
    this.renderer.clear();
    this._renderTemp(depthMesh);

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAuto;

    // 3) push uniforms to shading
    const cam = camera || this._findCamera();
    const P = cam.projectionMatrix, V = cam.matrixWorldInverse;

    // Earth
    this.matEarth.uniforms.uProj.value.copy(P);
    this.matEarth.uniforms.uView.value.copy(V);
    this.matEarth.uniforms.uModel.value.identity();
    this.matEarth.uniforms.uLightVP.value.copy(lightVP);
    this.matEarth.uniforms.uLightDir.value.copy(lightDir);

    // Moon
    this.matMoon.uniforms.uProj.value.copy(P);
    this.matMoon.uniforms.uView.value.copy(V);
    this.matMoon.uniforms.uModel.value.copy(mm);
    this.matMoon.uniforms.uLightVP.value.copy(lightVP);
    this.matMoon.uniforms.uLightDir.value.copy(lightDir);

    // Atmosphere
    this.matAtm.uniforms.uProj.value.copy(P);
    this.matAtm.uniforms.uView.value.copy(V);
    this.matAtm.uniforms.uModel.value.copy(new THREE.Matrix4().makeScale(1.03,1.03,1.03));
    this.matAtm.uniforms.uLightVP.value.copy(lightVP);
    this.matAtm.uniforms.uLightDir.value.copy(lightDir);
  }

  _renderTemp(mesh){ const tmp = new THREE.Scene(); tmp.add(mesh); this.renderer.render(tmp, this.lightCam); }
  _findCamera(){ let c=null; this.scene.traverse(o=>{ if(o.isCamera && !c) c=o; }); return c || new THREE.PerspectiveCamera(); }
}
