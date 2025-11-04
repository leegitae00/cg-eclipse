import * as THREE from 'three';

export class CameraManager {
    constructor(width, height) {
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.camera.position.set(0, 8, 22);
        this.camera.lookAt(0, 0, 0);
    }
    onResize(w, h) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }
}
