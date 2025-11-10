// ===[ src/core/LightingEffect.js ]===
// Three.js LightingEffect (self-contained, no external GLSL files)
// - Dual custom depth shadow maps:
//   • Earth→Moon (lunar eclipse, blood-red umbra/penumbra on moon)
//   • Moon→Earth (solar eclipse, umbra/penumbra on earth)
// - RawShaderMaterial shaders are embedded as strings below.
// - Exposes `update({ sun, earth, moon, camera })` per-frame.
//
// Project structure expected by Hanju:
//   Assets/textures/{earth_day.jpg, moon.jpg, stars_background.jpg}
//   src/core/{CameraManager.js, SceneManager.js, TimeController.js, LightingEffect.js}
//   src/ui/UIController.js, src/utils/math3d.js, src/main.js
//
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

export class LightingEffect {
  constructor(sceneManager, renderer, opts={}){
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getScene();
    this.renderer = renderer;

    // Tunables
    this.shadowRes = opts.shadowRes ?? 1024;
    this.orthoSize = opts.orthoSize ?? 7.0; // light box half-size
    this.lightNear = 0.1; this.lightFar = 40.0;
    this.redness = opts.redness ?? 1.0;     // blood moon strength
    this.atmIntensity = opts.atmIntensity ?? 1.0;
    this.pcf = opts.pcf ?? 2;               // 0~3

    // Light camera
    this.lightCam = new THREE.OrthographicCamera(-this.orthoSize, this.orthoSize, this.orthoSize, -this.orthoSize, this.lightNear, this.lightFar);

    // Depth RTs
    this.rtEarthToMoon = new THREE.WebGLRenderTarget(this.shadowRes, this.shadowRes, { depthBuffer: true });
    this.rtEarthToMoon.depthTexture = new THREE.DepthTexture(this.shadowRes, this.shadowRes, THREE.UnsignedIntType);
    this.rtEarthToMoon.depthTexture.format = THREE.DepthFormat;

    this.rtMoonToEarth = new THREE.WebGLRenderTarget(this.shadowRes, this.shadowRes, { depthBuffer: true });
    this.rtMoonToEarth.depthTexture = new THREE.DepthTexture(this.shadowRes, this.shadowRes, THREE.UnsignedIntType);
    this.rtMoonToEarth.depthTexture.format = THREE.DepthFormat;

    // Geometry used for depth-only occluders
    this.geoSphere = new THREE.SphereGeometry(1, 64, 64);

    // Build materials from embedded GLSL
    this._buildMaterials();

    // Attach materials to scene meshes
    this._applyMaterials();
  }

  // ---------------- GLSL (embedded) ----------------
  // NOTE: Use Three.js default attribute names: position, normal, uv
  static GLSL = {
    commonVert: `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;

uniform mat4 uProj, uView, uModel;
uniform mat4 uLightVP; // proj * view
uniform vec3 uLightDir; // directional light (normalized)
uniform sampler2D uShadow;
uniform vec2 uShadowRes;
uniform int uPCF;

out vec3 vPosW; // world pos
out vec3 vNorW; // world normal
out vec2 vUV;
out vec4 vShadowPos; // light clip space

mat4 transpose_(mat4 m){
  return mat4(m[0][0], m[1][0], m[2][0], m[3][0],
              m[0][1], m[1][1], m[2][1], m[3][1],
              m[0][2], m[1][2], m[2][2], m[3][2],
              m[0][3], m[1][3], m[2][3], m[3][3]);
}
vec3 normalMatrix_(vec3 n, mat4 model){ return normalize(mat3(transpose_(inverse(model))) * n); }
`,
    commonFrag: `
precision highp float;
uniform vec3 uLightDir;
uniform sampler2D uShadow;
uniform vec2 uShadowRes;
uniform int uPCF;

in vec3 vPosW; in vec3 vNorW; in vec2 vUV; in vec4 vShadowPos;

float sampleShadowPCF_(vec4 sp){
  vec3 ndc = sp.xyz / sp.w; vec3 uvz = ndc * 0.5 + 0.5;
  if(uvz.x<0.0||uvz.x>1.0||uvz.y<0.0||uvz.y>1.0) return 1.0;
  float current=uvz.z; float dx=1.0/uShadowRes.x; float dy=1.0/uShadowRes.y; int r=uPCF; float sum=0.0; int taps=0;
  for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){
    if(i<-r||i>r||j<-r||j>r) continue; taps++;
    float d=texture(uShadow, vec2(uvz.x+float(i)*dx, uvz.y+float(j)*dy)).r;
    sum += current<=d?1.0:0.0;
  }
  return taps>0? sum/float(taps) : 1.0;
}
`,
    depthVert: `#version 300 es
#include <common_vert>
void main(){ vPosW=(uModel*vec4(position,1.0)).xyz; vNorW=normalMatrix_(normal,uModel); vUV=uv; vShadowPos=(uLightVP*vec4(vPosW,1.0)); gl_Position=vShadowPos; }`,
    depthFrag: `#version 300 es
precision highp float;
#include <common_frag>
void main(){ }`,
    earthVert: `#version 300 es
#include <common_vert>
void main(){ vPosW=(uModel*vec4(position,1.0)).xyz; vNorW=normalMatrix_(normal,uModel); vUV=uv; vShadowPos=(uLightVP*vec4(vPosW,1.0)); gl_Position=uProj*uView*vec4(vPosW,1.0); }`,
    earthFrag: `#version 300 es
precision highp float;
#include <common_frag>
uniform vec3 uColor; uniform float uAtmIntensity; out vec4 o;
vec3 lambert(vec3 n, vec3 l, vec3 base){ float ndl=max(dot(n,-l),0.0); vec3 diff=base*ndl; float ao=0.35+0.65*pow(max(n.y*0.5+0.5,0.0),0.6); return diff+vec3(0.03,0.05,0.07)*ao; }
void main(){ vec3 N=normalize(vNorW); float sh=sampleShadowPCF_(vShadowPos); vec3 lit=lambert(N,uLightDir,uColor); float horizon=pow(1.0-abs(N.y),3.0); vec3 haze=vec3(0.30,0.45,0.85)*horizon*0.25*uAtmIntensity; lit*=mix(0.15,1.0,sh); o=vec4(lit+haze,1.0); }`,
    moonVert: `#version 300 es
#include <common_vert>
void main(){ vPosW=(uModel*vec4(position,1.0)).xyz; vNorW=normalMatrix_(normal,uModel); vUV=uv; vShadowPos=(uLightVP*vec4(vPosW,1.0)); gl_Position=uProj*uView*vec4(vPosW,1.0); }`,
    moonFrag: `#version 300 es
precision highp float;
#include <common_frag>
uniform vec3 uColor; uniform float uRedness; out vec4 o;
vec3 lambert(vec3 n, vec3 l, vec3 base){ float ndl=max(dot(n,-l),0.0); return base*ndl+vec3(0.02); }
void main(){ vec3 N=normalize(vNorW); float vis=sampleShadowPCF_(vShadowPos); vec3 base=lambert(N,uLightDir,uColor); float umbra=1.0-vis; float pen=smoothstep(0.0,0.7,umbra); vec3 red=vec3(0.55,0.16,0.08)*(0.6+0.4*abs(N.y)); vec3 col=mix(base, red*uRedness, pen); float earthshine=0.06*(1.0-pen)*(0.5+0.5*pow(1.0-abs(N.y),2.0)); col+=earthshine; o=vec4(col,1.0);} `,
    atmVert: `#version 300 es
#include <common_vert>
void main(){ vPosW=(uModel*vec4(position,1.0)).xyz; vNorW=normalMatrix_(normal,uModel); vUV=uv; vShadowPos=(uLightVP*vec4(vPosW,1.0)); gl_Position=uProj*uView*vec4(vPosW,1.0);} `,
    atmFrag: `#version 300 es
precision highp float;
#include <common_frag>
uniform float uAtmIntensity; out vec4 o;
void main(){ vec3 N=normalize(vNorW); float viewFacing=pow(1.0-max(dot(N,vec3(0.0,0.0,1.0)),0.0),2.0); float forward=pow(max(dot(-uLightDir,N),0.0),8.0); vec3 sky=vec3(0.25,0.5,0.95)*(0.35*viewFacing+0.65*forward)*uAtmIntensity*0.8; o=vec4(sky,1.0);} `,
  };

  _makeRawMat(vsrc, fsrc, extraUniforms={}){
    const v = vsrc.replace('#include <common_vert>', LightingEffect.GLSL.commonVert);
    const f = fsrc.replace('#include <common_frag>', LightingEffect.GLSL.commonFrag);
    const baseUniforms = {
      uProj:{value:new THREE.Matrix4()}, uView:{value:new THREE.Matrix4()}, uModel:{value:new THREE.Matrix4()},
      uLightVP:{value:new THREE.Matrix4()}, uLightDir:{value:new THREE.Vector3(1,1,1).normalize()},
      uShadow:{value:null}, uShadowRes:{value:new THREE.Vector2(this.shadowRes, this.shadowRes)}, uPCF:{value:this.pcf},
    };
    return new THREE.RawShaderMaterial({
      vertexShader: v, fragmentShader: f, glslVersion: THREE.GLSL3,
      uniforms: Object.assign(baseUniforms, extraUniforms),
      depthTest: true, depthWrite: true,
    });
  }

  _buildMaterials(){
    // Depth-only material
    this.depthMat = this._makeRawMat(LightingEffect.GLSL.depthVert, LightingEffect.GLSL.depthFrag);

    // Earth shading (receives Moon→Earth depth)
    this.matEarth = this._makeRawMat(LightingEffect.GLSL.earthVert, LightingEffect.GLSL.earthFrag, {
      uShadow:{ value: this.rtMoonToEarth.depthTexture },
      uColor:{ value: new THREE.Color(0x0d1e2e) },
      uAtmIntensity:{ value: this.atmIntensity },
    });

    // Moon shading (receives Earth→Moon depth)
    this.matMoon = this._makeRawMat(LightingEffect.GLSL.moonVert, LightingEffect.GLSL.moonFrag, {
      uShadow:{ value: this.rtEarthToMoon.depthTexture },
      uColor:{ value: new THREE.Color(0xaaaaaa) },
      uRedness:{ value: this.redness },
    });

    // Atmosphere shell (additive)
    this.matAtm = this._makeRawMat(LightingEffect.GLSL.atmVert, LightingEffect.GLSL.atmFrag, {
      uAtmIntensity:{ value: this.atmIntensity },
    });
    this.matAtm.blending = THREE.AdditiveBlending;
    this.matAtm.depthWrite = false;
    this.matAtm.transparent = true;
    this.matAtm.side = THREE.BackSide;
  }

  _applyMaterials(){
    const earth = this.sceneManager.getEarthMesh();
    const moon  = this.sceneManager.getMoonMesh();
    if (!earth || !moon){ console.warn('[LightingEffect] earth/moon meshes not found.'); return; }
    earth.material = this.matEarth;
    moon.material  = this.matMoon;
    if (!earth.getObjectByName('atmosphere')){
      const atm = new THREE.Mesh(new THREE.SphereGeometry(1.03, 64, 64), this.matAtm);
      atm.name = 'atmosphere';
      earth.add(atm);
    }
  }

  // Public setters
  setPCF(radius){ this.pcf = Math.max(0, Math.min(3, radius|0)); this.matEarth.uniforms.uPCF.value=this.pcf; this.matMoon.uniforms.uPCF.value=this.pcf; }
  setRedness(v){ this.redness = v; this.matMoon.uniforms.uRedness.value=v; }
  setAtmosphereIntensity(v){ this.atmIntensity = v; this.matEarth.uniforms.uAtmIntensity.value=v; this.matAtm.uniforms.uAtmIntensity.value=v; }

  update({ sun, earth, moon, camera }){
    if (!sun || !moon) return;

    // 1) setup light camera from sun dir
    const lightDir = new THREE.Vector3().copy(sun).normalize();
    const eye = new THREE.Vector3().copy(lightDir).multiplyScalar(-10.0);
    this.lightCam.position.copy(eye);
    this.lightCam.lookAt(0,0,0);
    this.lightCam.updateMatrixWorld(true);
    this.lightCam.updateProjectionMatrix();
    const lightVP = new THREE.Matrix4().multiplyMatrices(this.lightCam.projectionMatrix, this.lightCam.matrixWorldInverse);

    // 2) render depth maps
    const depthMesh = new THREE.Mesh(this.geoSphere, this.depthMat);
    const prevTarget = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.autoClear; this.renderer.autoClear = true;

    // Earth→Moon
    this.depthMat.uniforms.uModel.value.identity();
    this.depthMat.uniforms.uLightVP.value.copy(lightVP);
    this.renderer.setRenderTarget(this.rtEarthToMoon); this.renderer.clear();
    this._renderTemp(depthMesh);

    // Moon→Earth
    const mm = new THREE.Matrix4().makeTranslation(moon.x, moon.y, moon.z).multiply(new THREE.Matrix4().makeScale(0.27,0.27,0.27));
    this.depthMat.uniforms.uModel.value.copy(mm);
    this.depthMat.uniforms.uLightVP.value.copy(lightVP);
    this.renderer.setRenderTarget(this.rtMoonToEarth); this.renderer.clear();
    this._renderTemp(depthMesh);

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAuto;

    // 3) push uniforms to shading materials
    const cam = camera || this._findCamera();
    const P = cam.projectionMatrix; const V = cam.matrixWorldInverse;

    const earthModel = new THREE.Matrix4().identity();
    const moonModel  = mm;

    // Earth
    this.matEarth.uniforms.uProj.value.copy(P);
    this.matEarth.uniforms.uView.value.copy(V);
    this.matEarth.uniforms.uModel.value.copy(earthModel);
    this.matEarth.uniforms.uLightVP.value.copy(lightVP);
    this.matEarth.uniforms.uLightDir.value.copy(lightDir);

    // Moon
    this.matMoon.uniforms.uProj.value.copy(P);
    this.matMoon.uniforms.uView.value.copy(V);
    this.matMoon.uniforms.uModel.value.copy(moonModel);
    this.matMoon.uniforms.uLightVP.value.copy(lightVP);
    this.matMoon.uniforms.uLightDir.value.copy(lightDir);

    // Atmosphere
    this.matAtm.uniforms.uProj.value.copy(P);
    this.matAtm.uniforms.uView.value.copy(V);
    this.matAtm.uniforms.uModel.value.copy(new THREE.Matrix4().makeScale(1.03,1.03,1.03));
    this.matAtm.uniforms.uLightVP.value.copy(lightVP);
    this.matAtm.uniforms.uLightDir.value.copy(lightDir);
  }

  _renderTemp(mesh){ const temp = new THREE.Scene(); temp.add(mesh); this.renderer.render(temp, this.lightCam); }
  _findCamera(){ let c=null; this.scene.traverse(o=>{ if(o.isCamera && !c) c=o; }); return c || new THREE.PerspectiveCamera(); }
}

// ===[ PATCH: src/main.js ]===
/*
// 1) import
import { LightingEffect } from './core/LightingEffect.js';

// 2) after sceneManager/cameraManager/timeController are created
let lightingEffect;

window.onload = function init(){
  // ... (기존 내용)

  lightingEffect = new LightingEffect(sceneManager, renderer, { shadowRes: 1024, orthoSize: 8.0, pcf: 2, redness: 1.0, atmIntensity: 1.0 });
}

function animate(){
  requestAnimationFrame(animate);
  const dtRealSec = clock.getDelta();
  timeController.tick(dtRealSec);
  const pos = timeController.getPositions();
  const sun = new THREE.Vector3().copy(pos.sun);
  const earthV = new THREE.Vector3().copy(pos.earth);
  const moon  = new THREE.Vector3().copy(pos.moon);
  cameraManager.update(sun, earthV, moon);

  // ✔ update lighting/glsl
  lightingEffect.update({ sun, earth: earthV, moon, camera: cameraManager.getCamera() });

  renderer.render(scene, cameraManager.getCamera());
}
*/
/*
// 1) import
import { LightingEffect } from './core/LightingEffect.js';

// 2) after sceneManager/cameraManager/timeController are created
let lightingEffect;

window.onload = function init(){
  // ... (기존 내용)

  // 지구/달 이름 보장 (SceneManager에서 이미 했다면 생략)
  const earth = scene.getObjectByName('earth');
  const moon  = scene.getObjectByName('moon');
  if(!earth || !moon){ console.warn('earth/moon mesh not found. Ensure SceneManager names them.'); }

  lightingEffect = new LightingEffect(sceneManager, renderer, { shadowRes: 1024, orthoSize: 8.0, pcf: 2, redness: 1.0, atmIntensity: 1.0 });

  // ... (나머지 동일)
}

function animate(){
  requestAnimationFrame(animate);
  const dtRealSec = clock.getDelta();
  timeController.tick(dtRealSec);
  const pos = timeController.getPositions();
  const sun = new THREE.Vector3().copy(pos.sun);
  const earthV = new THREE.Vector3().copy(pos.earth);
  const moon  = new THREE.Vector3().copy(pos.moon);
  cameraManager.update(sun, earthV, moon);

  // ✔ update lighting/glsl
  lightingEffect.update({ sun, earth: earthV, moon, camera: cameraManager.getCamera() });

  renderer.render(scene, cameraManager.getCamera());
}
*/

// ===[ PATCH: src/core/SceneManager.js ]===
/*
// 생성 시 지구/달 Mesh에 이름 붙이기 (LightingEffect가 찾아서 재질을 교체함)
const R_EARTH = 1.0; const R_MOON = 0.27;
const earthGeo = new THREE.SphereGeometry(R_EARTH, 64, 64);
const earthMat = new THREE.MeshStandardMaterial({ color: 0x16304a, roughness: 0.9 });
const earth = new THREE.Mesh(earthGeo, earthMat); earth.name = 'earth'; earth.receiveShadow = true; scene.add(earth);

const moonGeo = new THREE.SphereGeometry(R_MOON, 48, 48);
const moonMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 1.0 });
const moon = new THREE.Mesh(moonGeo, moonMat); moon.name = 'moon'; moon.castShadow = true; scene.add(moon);
*/
