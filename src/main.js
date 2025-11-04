import * as THREE from 'three';
import { SceneManager } from './core/SceneManager.js';
import { CameraManager } from './core/CameraManager.js';
import { TimeController } from './core/TimeController.js';

const appEl = document.getElementById('app');

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
appEl.appendChild(renderer.domElement);

// Scene & Camera
const sceneMgr = new SceneManager();
const cameraMgr = new CameraManager(window.innerWidth, window.innerHeight);
sceneMgr.attachTo(sceneMgr.scene); // noop, placeholder

// TimeController 설정(가벼운 초기 파라미터)
const time = new TimeController({
    time: { startEpochMs: Date.now(), timeScale: 24 }, // 1초=24초(=24x)
    earth: { a: 10, e: 0.0167, i: 0.41, Ω: 0.0, ω: 0.0, M0: 0.0, n: (2 * Math.PI) / (365 * 24 * 3600), radius: 1 },
    moon: { a: 2.5, e: 0.0549, i: 0.089, Ω: 0.0, ω: 0.0, M0: 0.0, n: (2 * Math.PI) / (27.3 * 24 * 3600), radius: 0.27 },
    sun: { position: { x: 0, y: 0, z: 0 } },
    radii: { sun: 3.0, earth: 1.0, moon: 0.27 },
    detection: { alignThreshDeg: 1.5, penumbraMargin: 1.2 }
}, {
    onPositions: ({ sun, earth, moon }) => sceneMgr.updatePositions({ sun, earth, moon }),
    onPhaseChange: ({ phase }) => updateStat({ phase }),
    onEclipseEvent: (e) => console.log('ECLIPSE', e),
});

// UI 훅
const btnPlay = document.getElementById('playPause');
const rngSpeed = document.getElementById('speed');
const btnNew = document.getElementById('newMoon');
const btnFull = document.getElementById('fullMoon');
const statEl = document.getElementById('stat');

btnPlay.onclick = () => time.toggle();
rngSpeed.oninput = (e) => time.setTimeScale(parseFloat(e.target.value));
btnNew.onclick = () => time.jumpToNewMoon();
btnFull.onclick = () => time.jumpToFullMoon();

function updateStat(extra = {}) {
    const s = time.getState();
    statEl.textContent = `t=${new Date(s.now).toLocaleString()} | phase=${s.currentPhase || '?'} | x${s.timeScale}`;
    if (extra.phase) statEl.textContent += ` | changed→${extra.phase}`;
}

// 첫 프레임용 초기 위치 반영
sceneMgr.updatePositions(time.getPositions());
updateStat();

// 리사이즈
window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    cameraMgr.onResize(w, h);
    renderer.setSize(w, h);
});

// 루프
let last = performance.now();
function loop(now) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;

    time.tick(dt);
    renderer.render(sceneMgr.scene, cameraMgr.camera);
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
