import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import { CameraManager } from "./core/CameraManager.js";
import { UIController } from "./ui/UIController.js";
import { SceneManager } from "./core/SceneManager.js";
import { TimeController } from "./core/TimeController.js";
// [ADD] LightingEffect 추가
import { LightingEffect } from "./core/LightingEffect.js";

// --------------------------
// 전역 변수
// --------------------------
let scene, renderer, cameraManager, ui, sceneManager, timeController;
// ◀ sun, earth, moon, theta 변수 삭제 (각 매니저가 관리)
let clock = new THREE.Clock(); // ◀ TimeController에 실제 시간을 전달하기 위한 시계
// [ADD] 조명/그림자 & 셰이더 효과 매니저
let lightingEffect;

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

  // [ADD] LightingEffect 초기화 (지구/달 메쉬 이름 지정 후 생성)
  const earthMesh = sceneManager.getEarthMesh();
  const moonMesh  = sceneManager.getMoonMesh();
  if (earthMesh && !earthMesh.name) earthMesh.name = "earth";
  if (moonMesh  && !moonMesh.name)  moonMesh.name  = "moon";

  lightingEffect = new LightingEffect(sceneManager, renderer, {
    shadowRes: 1024,   // 그림자 맵 해상도
    orthoSize: 8.0,    // 태양(방향광) 직교 투영 박스 크기
    pcf: 2,            // PCF 반경(0~3)
    redness: 1.0,      // 월식 붉은 정도
    atmIntensity: 1.0  // 대기 산란 강도
  });

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
  const sunPosVec3   = new THREE.Vector3().copy(positions.sun);
  const earthPosVec3 = new THREE.Vector3().copy(positions.earth);
  const moonPosVec3  = new THREE.Vector3().copy(positions.moon);

  // CameraManager의 update 함수 호출 
  cameraManager.update(sunPosVec3, earthPosVec3, moonPosVec3);

  // [ADD] LightingEffect 업데이트 (그림자 맵 생성 + 셰이더 유니폼 갱신)
  if (lightingEffect) {
    lightingEffect.update({
      sun:   sunPosVec3,
      earth: earthPosVec3,
      moon:  moonPosVec3,
      camera: cameraManager.getCamera()
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
