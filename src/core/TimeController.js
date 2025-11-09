// utils/math3d.js 함수 사용
import {
    vec3, add, sub, dot, length, normalize, mul, rotateZXY, angleBetween,
} from '../utils/math3d.js';

/** 
 * 유틸(내부): 외적/거리/투영 등
 */
function cross(a, b) {
    const az = a.z || 0, bz = b.z || 0;
    return {
        x: a.y * bz - (a.z || 0) * b.y,
        y: (a.z || 0) * b.x - a.x * bz,
        z: a.x * b.y - a.y * b.x,
    };
}
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function rad(deg) { return deg * Math.PI / 180; }
function deg(rad) { return rad * 180 / Math.PI; }
function vadd3(a, b, c) { return add(add(a, b), c); }
function vscale(v, s) { return mul(v, s); }
function dist(a, b) { return length(sub(a, b)); }
function nearZero(x, eps = 1e-9) { return Math.abs(x) < eps; }


const DEFAULTS = {
    time: { startEpochMs: Date.now(), timeScale: 24 }, // 1sec(real) = 24sec(sim)
    // 태양은 원점으로 고정 (필요시 소폭 진동/자전 구현 가능)
    sun: { position: vec3(0, 0, 0), radius: 3.0 },
    earth: {
        a: 10.0, e: 0.0167, i: rad(0.41), Ω: 0.0, ω: 0.0, M0: 0.0,
        // 365일 주기 (초)
        periodSec: 365 * 24 * 3600,
        radius: 1.0,
    },
    moon: {
        // 지구 상대 표준값 (스케일 맞춰 튜닝)
        a: 2.5, e: 0.0549, i: rad(5.145), Ω: 0.0, ω: 0.0, M0: 0.0,
        // 27.321661일
        periodSec: 27.321661 * 24 * 3600,
        radius: 0.27,
    },
    detection: {
        // 정렬 임계각(도): 빠른 1차 필터
        alignThreshDegSolar: 1.8,
        alignThreshDegLunar: 1.8,
        // 펜움브라 허용 마진(시각적 안정화)
        penumbraScale: 1.02,
        // 근방 반복 알림 방지 시간(시뮬레이션 초)
        eclipseCooldownSimSec: 6 * 3600, // 6시간
    }
};

/**
 * config 보정: n(평균운동) 자동계산
 */
function finalizeConfig(cfg) {
    const c = JSON.parse(JSON.stringify(cfg));
    const twoPi = 2 * Math.PI;
    if (c.earth && !c.earth.n && c.earth.periodSec) {
        c.earth.n = twoPi / c.earth.periodSec;
    }
    if (c.moon && !c.moon.n && c.moon.periodSec) {
        c.moon.n = twoPi / c.moon.periodSec;
    }
    // 반지름 추출
    c.radii = {
        sun: c.sun?.radius ?? DEFAULTS.sun.radius,
        earth: c.earth?.radius ?? DEFAULTS.earth.radius,
        moon: c.moon?.radius ?? DEFAULTS.moon.radius,
    };
    return c;
}

/**
 * 타원 궤도 → 3D 좌표 (케플러 방정식)
 * Rz(Ω) * Rx(i) * Rz(ω) * r'(x',y',0)
 */
function orbitalPositionAt(t, refStartMs, p) {
    const dt = (t - refStartMs) / 1000; // sec
    const M = p.M0 + p.n * dt;
    const E = solveKeplerE(M, p.e);
    const cosE = Math.cos(E), sinE = Math.sin(E);
    const x = p.a * (cosE - p.e);
    const y = p.a * (Math.sqrt(1 - p.e * p.e) * sinE);
    return rotateZXY({ x, y, z: 0 }, p.ω || 0, p.i || 0, p.Ω || 0);
}

function solveKeplerE(M, e) {
    // M을 -π~π로 정규화
    let Mm = ((M + Math.PI) % (2 * Math.PI)) - Math.PI;
    let E = e < 0.8 ? Mm : Math.PI; // 초기값 힌트
    for (let k = 0; k < 8; k++) {
        const f = E - e * Math.sin(E) - Mm;
        const fp = 1 - e * Math.cos(E);
        const dE = f / fp;
        E -= dE;
        if (Math.abs(dE) < 1e-12) break;
    }
    return E;
}

function phaseMetrics(sun, earth, moon) {
    const vSM = sub(moon, sun);
    const vEM = sub(moon, earth);
    const phi = angleBetween(vSM, vEM); // 0..π
    const k = (1 + Math.cos(phi)) / 2;  // 0..1
    return { phaseAngle: phi, illuminatedFraction: k };
}
function phaseNameFromAngle(phiRad, epsDeg = 8) {
    const d = deg(phiRad);
    if (Math.abs(d - 180) < epsDeg) return 'new';
    if (Math.abs(d - 0) < epsDeg) return 'full';
    if (Math.abs(d - 90) < epsDeg) return 'quarter'; // 상현/하현 구분은 추가 파생
    return null;
}

function coneShadowHit({ light, apex, occluderR, target, targetR, sunR, penumbraScale = 1.0 }) {
    // 벡터/스칼라 준비
    const axis = normalize(sub(light, apex));
    const D = dist(light, apex);
    // 정사영
    const vAT = sub(target, apex);
    const proj = dot(vAT, axis); // apex 기준 축 방향 거리

    // 축에서 target 중심까지의 최소 거리
    const closest = add(apex, vscale(axis, proj));
    const dPerp = dist(target, closest);

    // 태양이 가림체보다 훨씬 큼: 일반적으로 R_sun >> r_occ
    const R = sunR, r = occluderR;
    if (R <= r) {
        // 이론적으로 umbra가 무한대로 길어지거나 이상해짐. 방어적으로 penumbra만 처리
        const rPenOnly = (proj >= 0) ? (proj * (R / (D + 1e-9))) : 0;
        const hits = dPerp <= (rPenOnly + targetR * penumbraScale);
        return hits ? { hit: true, subtype: 'penumbra', dPerp, proj } : { hit: false };
    }

    const Lu = (D * r) / (R - r); // 우산길이

    // 현재 proj 구간의 이론적 그림자 반경(umbra/penumbra 각각)
    let rUmbra = -1; // 음수면 없음
    let rPen = -1;

    if (proj >= 0 && proj <= Lu) {
        // umbra 내부: 선형적으로 반경이 줄어듦 (apex에서는 r_occ)
        rUmbra = (Lu - proj) * (r / Lu); // proj=0→r, proj=Lu→0
        rPen = rUmbra; // 내부에선 동일 반경 기준으로 처리
    } else if (proj > Lu) {
        // antumbra/penumbra 구간: 태양의 기하를 선형 근사로 확장
        // D-Lu 분모가 0에 근접하지 않도록 보호
        const denom = Math.max(1e-6, (D - Lu));
        rUmbra = 0; // 엄브라는 소멸
        rPen = (proj - Lu) * (R / denom); // 축에서 멀수록 반경 증가
    } else {
        // proj < 0: 타깃이 occluder 뒤로 너무 들어간 경우 → penumbra 근사
        rUmbra = 0;
        rPen = 0;
    }

    const penAllowance = targetR * penumbraScale;

    // hit 판정
    if (rUmbra > 0) {
        if (dPerp <= (rUmbra + targetR)) {
            return { hit: true, subtype: 'umbra', dPerp, proj, rUmbra, rPen };
        }
    }
    if (rPen >= 0) {
        if (dPerp <= (rPen + penAllowance)) {
            // 금환식 영역(antumbra) 힌트: solar에서 proj > Lu 이고 중심부 관통
            const isAntumbra = (proj > Lu) && (dPerp <= Math.max(1e-6, rPen - targetR * 0.4));
            return { hit: true, subtype: isAntumbra ? 'antumbra' : 'penumbra', dPerp, proj, rUmbra, rPen };
        }
    }
    return { hit: false };
}

export class TimeController {
    constructor(userConfig = {}, callbacks = {}) {
        this.cfg = finalizeConfig({ ...DEFAULTS, ...userConfig });
        this.cb = callbacks;

        this.state = {
            now: this.cfg.time.startEpochMs,    // epoch ms
            timeScale: this.cfg.time.timeScale, // sim-sec / real-sec
            playing: true,

            currentPhase: null,
            illuminatedFraction: null,

            _lastPhaseKey: null,
            lastEclipse: null,
            _eclipseLatch: null,
            _eclipseCooldownUntil: -Infinity, // sim-sec
        };
    }

    /** 메인 루프에서 호출 */
    tick(dtRealSec) {
        if (!this.state.playing) return;

        const dtSimSec = dtRealSec * this.state.timeScale;
        this.state.now += dtSimSec * 1000;

        const sun = this._sun();
        const earth = this._earth(this.state.now);
        const moon = add(earth, this._moonRel(this.state.now));

        // 위상 계산
        const { phaseAngle, illuminatedFraction } = phaseMetrics(sun, earth, moon);
        const pKey = phaseNameFromAngle(phaseAngle, 8);

        if (pKey && pKey !== this.state._lastPhaseKey) {
            this.state._lastPhaseKey = pKey;
            this.state.currentPhase = pKey;
            this.state.illuminatedFraction = illuminatedFraction;
            this.cb.onPhaseChange?.({ phase: pKey, t: this.state.now, phaseAngle, illuminatedFraction });
        } else {
            // 업데이트만 유지
            this.state.currentPhase = this.state.currentPhase ?? pKey;
            this.state.illuminatedFraction = illuminatedFraction;
        }

        // 일식/월식 감지 (정렬각 1차 필터 → 원뿔 판정)
        const eclipse = this._detectEclipse({ sun, earth, moon, dtSimSec });
        if (eclipse) {
            this.state.lastEclipse = { ...eclipse, t: this.state.now };
            this.cb.onEclipseEvent?.(this.state.lastEclipse);
        }

        // 좌표 브로드캐스트
        this.cb.onPositions?.({ sun, earth, moon, t: this.state.now });
    }

    // ---- Public Controls ----
    play() { this.state.playing = true; }
    pause() { this.state.playing = false; }
    toggle() { this.state.playing = !this.state.playing; }
    isPlaying() { return this.state.playing; }

    setTimeScale(scale) { this.state.timeScale = scale; }
    setSimTime(epochMsOrISO) {
        this.state.now = (typeof epochMsOrISO === 'number') ? epochMsOrISO : Date.parse(epochMsOrISO);
    }
    getSimTime() { return this.state.now; }

    getPositions() {
        const sun = this._sun();
        const earth = this._earth(this.state.now);
        const moon = add(earth, this._moonRel(this.state.now));
        return { sun, earth, moon };
    }
    getState() {
        const { now, timeScale, playing, currentPhase, illuminatedFraction, lastEclipse } = this.state;
        return { now, timeScale, isPlaying: playing, currentPhase, illuminatedFraction, lastEclipse };
    }

    // 위상 점프
    jumpToPhase(target /* 'new'|'full'|'firstQuarter'|'lastQuarter' */) {
        const goalDeg =
            target === 'new' ? 180 :
                target === 'full' ? 0 :
                    (target === 'firstQuarter' || target === 'lastQuarter') ? 90 : 0;

        // 이분법 + 간단 뉴턴 보정
        const maxHrs = (target === 'full' || target === 'new') ? 72 : 96;
        const res = this._rootFindPhase(goalDeg, maxHrs * 3600);
        if (res && isFinite(res.t)) {
            this.state.now = res.t;
            this.state._lastPhaseKey = target;
            this.state.currentPhase = target;
        }
    }
    jumpToNewMoon() { this.jumpToPhase('new'); }
    jumpToFullMoon() { this.jumpToPhase('full'); }

    // ---- Internals ----
    _sun() { return this.cfg.sun.position || vec3(0, 0, 0); }
    _earth(t) { return orbitalPositionAt(t, this.cfg.time.startEpochMs, this.cfg.earth); }
    _moonRel(t) { return orbitalPositionAt(t, this.cfg.time.startEpochMs, this.cfg.moon); }

    _phaseAngleDegAt(t) {
        const sun = this._sun();
        const earth = this._earth(t);
        const moon = add(earth, this._moonRel(t));
        const { phaseAngle } = phaseMetrics(sun, earth, moon);
        return deg(phaseAngle);
    }

    _rootFindPhase(goalDeg /* 0/90/180 */, searchWindowSec) {
        // f(t) = wrapped(phaseDeg(t) - goalDeg) in [-180,180]
        const wrapErr = (d) => ((d + 540) % 360) - 180;

        let t0 = this.state.now - searchWindowSec * 1000 * 0.5;
        let t1 = this.state.now + searchWindowSec * 1000 * 0.5;

        let f0 = wrapErr(this._phaseAngleDegAt(t0) - goalDeg);
        let f1 = wrapErr(this._phaseAngleDegAt(t1) - goalDeg);

        // 이분법으로 부호 교차 구간 찾기 (조밀하게 스캔)
        const steps = 96;
        let found = false;
        let a = t0, fa = f0;
        for (let i = 1; i <= steps; i++) {
            const b = t0 + (i / steps) * (t1 - t0);
            const fb = wrapErr(this._phaseAngleDegAt(b) - goalDeg);
            if (fa === 0) { a = t0 + ((i - 1) / steps) * (t1 - t0); found = true; break; }
            if (fa * fb <= 0) { // 부호 교차
                a = t0 + ((i - 1) / steps) * (t1 - t0);
                found = true;
                break;
            }
            fa = fb;
        }
        if (!found) return null;

        // [a,b]에서 이분법 10회 + 뉴턴 2회
        let b = a + (t1 - t0) / steps;
        let fa2 = wrapErr(this._phaseAngleDegAt(a) - goalDeg);
        let fb2 = wrapErr(this._phaseAngleDegAt(b) - goalDeg);

        for (let k = 0; k < 10; k++) {
            const m = 0.5 * (a + b);
            const fm = wrapErr(this._phaseAngleDegAt(m) - goalDeg);
            if (Math.abs(fm) < 0.2) { a = b = m; fa2 = fb2 = fm; break; }
            if (fa2 * fm <= 0) { b = m; fb2 = fm; }
            else { a = m; fa2 = fm; }
        }
        let t = 0.5 * (a + b);

        // 뉴턴 보정 (수치 미분)
        for (let k = 0; k < 2; k++) {
            const f = wrapErr(this._phaseAngleDegAt(t) - goalDeg);
            const h = 60 * 1000; // 60s
            const fp = (wrapErr(this._phaseAngleDegAt(t + h) - goalDeg) - f) / (h / 1000); // deg/s
            if (nearZero(fp, 1e-3)) break;
            const dt = -f / fp; // 초 단위
            t += dt * 1000;
            if (Math.abs(f) < 0.05) break;
        }
        return { t };
    }

    _detectEclipse({ sun, earth, moon, dtSimSec }) {
        const nowSec = this.state.now / 1000;
        if (nowSec < this.state._eclipseCooldownUntil) return null;

        const rd = this.cfg.radii;
        const det = this.cfg.detection;

        // 1차: 정렬각 필터
        const aSolar = angleBetween(sub(moon, sun), sub(earth, moon)); // Sun–Moon vs Moon–Earth
        const aLunar = angleBetween(sub(earth, sun), sub(moon, earth)); // Sun–Earth vs Earth–Moon

        const solarAligned = deg(aSolar) < (det.alignThreshDegSolar ?? 1.8);
        const lunarAligned = deg(aLunar) < (det.alignThreshDegLunar ?? 1.8);

        // 2차: 원뿔 판정(유한 광원)
        // Solar: apex=Moon, target=Earth
        if (solarAligned) {
            const hit = coneShadowHit({
                light: sun, apex: moon, occluderR: rd.moon, target: earth, targetR: rd.earth,
                sunR: rd.sun, penumbraScale: det.penumbraScale ?? 1.02
            });
            if (hit.hit) {
                const subtype = hit.subtype; // 'umbra' | 'penumbra' | 'antumbra'
                const kind = (subtype === 'antumbra') ? 'annular' : (subtype === 'umbra' ? 'total' : 'partial');
                const ev = { type: 'solar', subtype, class: kind };
                // 쿨다운 설정(동일 이벤트 반복 방지)
                this.state._eclipseCooldownUntil = nowSec + (det.eclipseCooldownSimSec ?? 6 * 3600);
                this.state._eclipseLatch = `solar:${subtype}`;
                return ev;
            }
        }

        // Lunar: apex=Earth, target=Moon
        if (lunarAligned) {
            const hit = coneShadowHit({
                light: sun, apex: earth, occluderR: rd.earth, target: moon, targetR: rd.moon,
                sunR: rd.sun, penumbraScale: det.penumbraScale ?? 1.02
            });
            if (hit.hit) {
                const subtype = hit.subtype;
                const kind = (subtype === 'umbra') ? 'total' : 'partial'; // antumbra는 lunar에선 드묾
                const ev = { type: 'lunar', subtype, class: kind };
                this.state._eclipseCooldownUntil = nowSec + (det.eclipseCooldownSimSec ?? 6 * 3600);
                this.state._eclipseLatch = `lunar:${subtype}`;
                return ev;
            }
        }

        return null;
    }
}

