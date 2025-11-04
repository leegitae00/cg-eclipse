import * as THREE from 'three';

export class SceneManager {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0b1020);

        // Sun (emissive)
        const sunGeo = new THREE.SphereGeometry(3, 32, 16);
        const sunMat = new THREE.MeshStandardMaterial({ emissive: 0xffcc55, emissiveIntensity: 2, color: 0x111111 });
        this.sun = new THREE.Mesh(sunGeo, sunMat);
        this.sun.castShadow = false;
        this.sun.receiveShadow = false;
        this.scene.add(this.sun);

        // Earth
        const eGeo = new THREE.SphereGeometry(1, 32, 16);
        const eMat = new THREE.MeshStandardMaterial({ color: 0x2a6df2, roughness: 0.6, metalness: 0.0 });
        this.earth = new THREE.Mesh(eGeo, eMat);
        this.earth.castShadow = true;
        this.earth.receiveShadow = true;
        this.scene.add(this.earth);

        // Moon
        const mGeo = new THREE.SphereGeometry(0.27, 32, 16);
        const mMat = new THREE.MeshStandardMaterial({ color: 0xb7b7b7, roughness: 0.8 });
        this.moon = new THREE.Mesh(mGeo, mMat);
        this.moon.castShadow = true;
        this.moon.receiveShadow = true;
        this.scene.add(this.moon);

        // Light (Sun as directional)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
        this.sunLight.position.set(10, 10, 10);
        this.sunLight.castShadow = true;
        this.scene.add(this.sunLight);

        // Ambient
        this.scene.add(new THREE.AmbientLight(0x404040, 0.3));

        // Ground (for shadows)
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(200, 200),
            new THREE.MeshStandardMaterial({ color: 0x11161f })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -2;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    updatePositions({ sun, earth, moon }) {
        // 간단히 XY 평면에 놓고 시각화 (Z도 들어오면 그대로 반영)
        if (sun) this.sun.position.set(sun.x, sun.y, sun.z || 0);
        if (earth) this.earth.position.set(earth.x, earth.y, earth.z || 0);
        if (moon) this.moon.position.set(moon.x, moon.y, moon.z || 0);

        // 태양광은 태양 위치에서 지구/달을 비추는 느낌으로 축 설정
        this.sunLight.position.copy(this.sun.position).addScalar(10);
        this.sunLight.target = this.earth;
    }
}
