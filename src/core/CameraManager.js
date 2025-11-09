// =========================
//CameraManager.js 
//Description: 
//Handles camera logic and view transformations in Three.js.
//- Supports switching between 'space' and 'observer' modes
// - Provides directional presets (north, south, east, west)
//- Wraps a Three.js PerspectiveCamera to manage view/projection matrices
// =========================
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

export class CameraManager {
  constructor(renderer) {
    this.renderer = renderer;

    const aspect = renderer.domElement.clientWidth / renderer.domElement.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(0, 15, 30);
    this.camera.up.set(0, 1, 0);


    this.mode = "space";        // "space" or "observer"
    this.manualView = false;   
  }

  // =========================
  // change mode
  // =========================
  setMode(mode) {
    this.mode = mode;
    this.manualView = false;
  }

  // =======================
  //camera view conversion
  // =========================
  setDirectionView(dir, sunPos = new THREE.Vector3(0, 0, 0)) {
    if (this.mode !== "space") return;

    const dist = 15.0;
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    switch (dir) {
      case "north":
        pos.set(0, dist, 0);
        up.set(0, 0, -1);
        break;
      case "south":
        pos.set(0, -dist, 0);
        up.set(0, 0, 1);
        break;
      case "east":
        pos.set(dist, 0, 0);
        up.set(0, 1, 0);
        break;
      case "west":
        pos.set(-dist, 0, 0);
        up.set(0, 1, 0);
        break;
      default:
        pos.set(dist * 0.4, dist * 0.5, dist * 0.8);
        up.set(0, 1, 0);
        break;
    }
    //actual camera orientation/position application
    this.camera.position.copy(sunPos.clone().add(pos));
    this.camera.up.copy(up);
    this.camera.lookAt(sunPos);
    this.manualView = true;
  }

  // =========================
  // update camera every frame
  // =========================
  update(sunPos, earthPos, moonPos) {
    if (this.manualView) return; //when using setDirectionView, update x

    if (this.mode === "space") {
      // space mode 
      const camDist = 15.0;
      const viewDir = new THREE.Vector3(0.4, 0.6, 1.0).normalize();
      const newPos = sunPos.clone().add(viewDir.multiplyScalar(camDist));

      this.camera.position.copy(newPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(sunPos);

    } else if (this.mode === "observer") {
      //observer mode
      const earthRadius = 1.0;
      const eyeHeight = 0.02;
      const upVec = new THREE.Vector3(0, 1, 0);

      const offset = upVec.clone().multiplyScalar(earthRadius + eyeHeight);
      const newPos = earthPos.clone().add(offset);

      this.camera.position.copy(newPos);
      this.camera.lookAt(moonPos);
      this.camera.up.copy(upVec);
    }
  }

  // =========================
  // window size correspondence
  // =========================
  resize() {
    const aspect = this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

// object return
  getCamera() {
    return this.camera;
  }
}
