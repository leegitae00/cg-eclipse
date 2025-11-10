// === src/main.js (with minimal additions) ===
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import { CameraManager } from "./core/CameraManager.js";
import { UIController } from "./ui/UIController.js";
import { SceneManager } from "./core/SceneManager.js";
import { TimeController } from "./core/TimeController.js";
import { LightingEffect } from "./core/LightingEffect.js"; // [ADD]

// --------------------------
// 전역 변수
// --------------------------
let scene, renderer, cameraManager, ui, sceneManager, timeController;
// ◀ sun, earth, moon, theta 변수 삭제 (각 매니저가 관리)
let clock = new THREE.Clock(); // ◀ TimeController에 실제 시간을 전달하기 위한 시계
let lightingEffect; // [ADD]

// --------------------------
// 초기화
// --------------------------
window.onload = function init() {
  const canvas = document.getElementById("gl-canvas");

  // 🔹 렌더러 설정
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); // alpha:true는 배경 CSS 유지용 [ADD: alpha]
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0); // 투명 배경으로 변경 [ADD: 투명도 0]
  // ◀ 그림자 맵 활성화
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // 🔹 SceneManager 초기화
  sceneManager = new SceneManager();
  scene = sceneManager.getScene(); // ◀ 3번이 만든 scene을 가져옴

  // 🔹 카메라 매니저 초기화
  cameraManager = new CameraManager(renderer);
  const camera = cameraManager.getCamera();

  // -----------------------------------------------------------------
  // ◀ 임시 조명 추가 (LightEffect 추가 전까지)
  // LightEffect.js 추가 되면 이 부분 삭제, 새로 main.js 작성하셔도 무방합니다
  // 태양 위치에서 비추는 강한 직사광 (그림자용)
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  sunLight.position.set(0, 0, 0); // 태양의 위치
  sunLight.castShadow = true; // 3번의 castShadow와 연결됨
  scene.add(sunLight);

  // 씬 전체에 은은하게 비추는 약한 환경광 (어두운 면 확인용)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambientLight);
  // -----------------------------------------------------------------

  // 🔹 TimeController 초기화
  // onPositions(data)를 호출하면 -> sceneManager.update(data)가 실행됨
  const callbacks = {
    onPositions: (data) => {
      sceneManager.update(data); 
    },
    onEclipseEvent: (event) => {
      // LightingEffect에게 일식/월식 이벤트 전달 (추후 구현)
      // lightingEffect.handleEclipse(event); 
    }
  };
  timeController = new TimeController({}, callbacks);

  // 🔹 UI 컨트롤러 연결 (TimeController 추가)
  ui = new UIController(cameraManager, timeController); // ◀ timeController 전달
  // ◀ UI -> Time 이벤트 연결
  ui.onPlayToggle = (isPlaying) => {
    isPlaying ? timeController.play() : timeController.pause();
  };
  ui.onReset = () => { 
    timeController.setSimTime(Date.now()); // 시간 리셋
  };
  ui.onSpeedChange = (speed) => {
    timeController.setTimeScale(speed); // 속도 조절
  };
  // (참고) 퀵 점프(위상 점프)도 UIController.js에서 연결 필요

  // 🔹 LightingEffect 생성 및 장착 [ADD]
  // SceneManager가 만든 지구/달 메쉬에 맞춰 커스텀 셰이더/섀도우를 적용한다.
  lightingEffect = new LightingEffect(sceneManager, renderer, {
    shadowRes: 1024,
    orthoSize: 8.0,
    pcf: 2,
    redness: 1.0,
    atmIntensity: 1.0,
  });

  // 🔹 창 리사이즈 대응
  window.addEventListener("resize", () => onResize());

  // 🔹 렌더 루프 시작
  animate();
};

// --------------------------
// 렌더 루프
// --------------------------
function animate() {
  requestAnimationFrame(animate);

  const dtRealSec = clock.getDelta(); // 실제 경과 시간

  // TimeController 물리 계산 실행
  timeController.tick(dtRealSec);
  // (3번의 update는 tick 안의 콜백으로 자동 실행됨)

  // TimeController로부터 {x, y, z} 형식의 좌표 받기
  const positions = timeController.getPositions();

  // {x, y, z}를 THREE.Vector3로 변환
  const sunPosVec3 = new THREE.Vector3().copy(positions.sun);
  const earthPosVec3 = new THREE.Vector3().copy(positions.earth);
  const moonPosVec3 = new THREE.Vector3().copy(positions.moon);

  // CameraManager의 update 함수 호출 
  cameraManager.update(sunPosVec3, earthPosVec3, moonPosVec3);

  // LightingEffect 업데이트 (섀도우맵 렌더 + 셰이더 유니폼 갱신) [ADD]
  if (lightingEffect) {
    lightingEffect.update({
      sun: sunPosVec3,
      earth: earthPosVec3,
      moon: moonPosVec3,
      camera: cameraManager.getCamera(),
    });
  }

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
