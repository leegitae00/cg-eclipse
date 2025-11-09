import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
// import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Observer 뷰 구현 시 활성화

export class SceneManager {
    constructor() {
        /**
         * @type {THREE.Scene}
         */
        this.scene = new THREE.Scene();

        /**
         * @type {THREE.TextureLoader}
         */
        this.textureLoader = new THREE.TextureLoader();
        // this.gltfLoader = new GLTFLoader(); // Observer 뷰 구현 시 활성화

        /**
         * @type {THREE.Mesh}
         */
        this.sunMesh = null;
        /**
         * @type {THREE.Mesh}
         */
        this.earthMesh = null;
        /**
         * @type {THREE.Mesh}
         */
        this.moonMesh = null;

        /**
         * @type {THREE.MeshStandardMaterial}
         */
        this.earthMaterial = null;
        /**
         * @type {THREE.MeshStandardMaterial}
         */
        this.moonMaterial = null;

        // 생성자에서 객체 생성 및 애셋 로드 함수 호출
        this._createCelestialBodies();
        this._loadAssets();
    }

    _createCelestialBodies() {
        // --- 1. 태양 (radius: 3.0) ---
        // TimeController.js DEFAULTS.sun.radius
        const sunGeometry = new THREE.SphereGeometry(3.0, 32, 32); 
        const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
        this.scene.add(this.sunMesh);

        // --- 2. 지구 (radius: 1.0) ---
        // TimeController.js DEFAULTS.earth.radius
        // CameraManager.js 'observer' mode의 earthRadius
        const earthGeometry = new THREE.SphereGeometry(1.0, 64, 64);
        this.earthMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff, // 텍스처 로딩 전 기본 색
        });
        this.earthMesh = new THREE.Mesh(earthGeometry, this.earthMaterial);
        
        // LightingEffect가 사용할 그림자 속성 설정
        this.earthMesh.castShadow = true;
        this.earthMesh.receiveShadow = true;
        
        this.scene.add(this.earthMesh);
        
        // 

        // --- 3. 달 (radius: 0.27) ---
        // TimeController.js DEFAULTS.moon.radius
        const moonGeometry = new THREE.SphereGeometry(0.27, 32, 32); 
        this.moonMaterial = new THREE.MeshStandardMaterial({
            color: 0xbbbbbb, // 텍스처 로딩 전 기본 색
        });
        this.moonMesh = new THREE.Mesh(moonGeometry, this.moonMaterial);
        
        // LightingEffect가 사용할 그림자 속성 설정
        this.moonMesh.castShadow = true;
        this.moonMesh.receiveShadow = true;
        
        this.scene.add(this.moonMesh);
    }

    
    _loadAssets() {
        const assetsPath = 'Assets/textures/';

        // 1. 지구 텍스처 적용
        this.textureLoader.load(
            `${assetsPath}earth_day.jpg`,
            (texture) => {
                this.earthMaterial.map = texture;
                this.earthMaterial.needsUpdate = true;
            },
            undefined, // onProgress 콜백
            (err) => { console.error('지구 텍스처 로딩 실패:', err); }
        );

        // 2. 달 텍스처 적용
        this.textureLoader.load(
            `${assetsPath}moon.jpg`,
            (texture) => {
                this.moonMaterial.map = texture;
                this.moonMaterial.needsUpdate = true;
            },
            undefined,
            (err) => { console.error('달 텍스처 로딩 실패:', err); }
        );

        // 3. 우주 배경 (Skybox)
        this.textureLoader.load(
            `${assetsPath}stars_background.jpg`,
            (texture) => {
                // 큐브맵 대신 구체형 맵핑 사용
                texture.mapping = THREE.EquirectangularReflectionMapping;
                this.scene.background = texture;
                this.scene.environment = texture; 
            },
            undefined,
            (err) => { console.error('배경 텍스처 로딩 실패:', err); }
        );
    }

    /**
     * TimeController의 콜백을 통해 main.js가 호출합니다.
     * @param {object} celestialData - 1번이 onPositions 콜백으로 전달하는 데이터
     * (예: { sun, earth, moon, t, earthRotation, ... })
     */
    update(celestialData) {
        if (!celestialData) return;

        // 1. 공전(위치) 업데이트
        // (TimeController.js의 onPositions 콜백 데이터 형식 { sun, earth, moon } 사용)
        if (this.sunMesh && celestialData.sun) {
            this.sunMesh.position.copy(celestialData.sun);
        }
        if (this.earthMesh && celestialData.earth) {
            this.earthMesh.position.copy(celestialData.earth);
        }
        if (this.moonMesh && celestialData.moon) {
            this.moonMesh.position.copy(celestialData.moon);
        }

        // 2. 자전(회전) 업데이트 (향후 추가?)
        // (TimeController에서 celestialData에 earthRotation/moonRotation을 추가하면 동작)
        if (this.earthMesh && celestialData.earthRotation !== undefined) {
            this.earthMesh.rotation.y = celestialData.earthRotation;
        }
        if (this.moonMesh && celestialData.moonRotation !== undefined) {
            this.moonMesh.rotation.y = celestialData.moonRotation;
        }
    }

    // --- 다른 모듈(역할자)을 위한 Public Getter 함수 API ---

    /**
     * 렌더링 및 조명 추가를 위해 Scene 객체를 반환합니다.
     * @returns {THREE.Scene}
     */
    getScene() {
        return this.scene;
    }

    /**
     * 셰이더/효과를 적용할 지구 메쉬를 반환합니다.
     * @returns {THREE.Mesh}
     */
    getEarthMesh() {
        return this.earthMesh;
    }
    
    /**
     * 셰이더/효과를 적용할 달 메쉬를 반환합니다.
     * @returns {THREE.Mesh}
     */
    getMoonMesh() {
        return this.moonMesh;
    }

    /**
     * 셰이더/효과를 적용할 지구 재질(Material)을 반환합니다.
     * @returns {THREE.MeshStandardMaterial}
     */
    getEarthMaterial() {
        return this.earthMaterial;
    }

    /**
     * 셰이더/효과를 적용할 달 재질(Material)을 반환합니다.
     * @returns {THREE.MeshStandardMaterial}
     */
    getMoonMaterial() {
        return this.moonMaterial;
    }
}