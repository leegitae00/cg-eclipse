// =========================
// main.js (Three.js 버전)
// =========================
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import { CameraManager } from "./core/CameraManager.js";
import { UIController } from "./ui/UIController.js";

// --------------------------
// 전역 변수
// --------------------------
let scene, renderer, cameraManager, ui;
let sun, earth, moon;
let theta = 0;

// --------------------------
// 초기화
// --------------------------
window.onload = function init() {
  const canvas = document.getElementById("gl-canvas");

  // 🔹 렌더러 설정
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000);

  // 🔹 장면(Scene)
  scene = new THREE.Scene();

  // 🔹 카메라 매니저 초기화
  cameraManager = new CameraManager(renderer);
  const camera = cameraManager.getCamera();

  // 🔹 UI 컨트롤러 연결
  ui = new UIController(cameraManager);
  ui.onReset = () => { theta = 0; };

  // 🔹 기본 조명
  const light = new THREE.PointLight(0xffffff, 2, 100);
  light.position.set(0, 0, 0);
  scene.add(light);

  // 🔹 천체 생성
  createCelestialBodies();

  // 🔹 창 리사이즈 대응
  window.addEventListener("resize", () => onResize());

  // 🔹 렌더 루프 시작
  animate();
};

// --------------------------
// 천체 생성 함수
// --------------------------
function createCelestialBodies() {
  // 태양 (노란색)
  const sunGeom = new THREE.SphereGeometry(1.0, 32, 32);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  sun = new THREE.Mesh(sunGeom, sunMat);
  scene.add(sun);

  // 지구 (파란색)
  const earthGeom = new THREE.SphereGeometry(0.6, 32, 32);
  const earthMat = new THREE.MeshPhongMaterial({ color: 0x2a6eff });
  earth = new THREE.Mesh(earthGeom, earthMat);
  scene.add(earth);

  // 달 (회색)
  const moonGeom = new THREE.SphereGeometry(0.3, 32, 32);
  const moonMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
  moon = new THREE.Mesh(moonGeom, moonMat);
  scene.add(moon);
}

// --------------------------
// 렌더 루프
// --------------------------
function animate() {
  requestAnimationFrame(animate);

  theta += 0.01;

  // 궤도 좌표 갱신
  const sunPos = new THREE.Vector3(0, 0, 0);
  const earthPos = new THREE.Vector3(Math.cos(theta) * 5, 0, Math.sin(theta) * 5);
  const moonPos = new THREE.Vector3(
    earthPos.x + Math.cos(theta * 10) * 1.5,
    0,
    earthPos.z + Math.sin(theta * 10) * 1.5
  );

  // 천체 위치 갱신
  sun.position.copy(sunPos);
  earth.position.copy(earthPos);
  moon.position.copy(moonPos);

  // 카메라 업데이트
  cameraManager.update(sunPos, earthPos, moonPos);

  // 렌더링
  renderer.render(scene, cameraManager.getCamera());
}

// --------------------------
// 창 크기 변경 시
// --------------------------
function onResize() {
  const canvas = renderer.domElement;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  cameraManager.resize();
}
