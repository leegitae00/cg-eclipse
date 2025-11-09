/**
 * ============================================
 * File: UIController.js
 * Description:
 *   Manages user interface interactions and HUD updates.
 *   - Handles play/pause, reset, and simulation speed control
 *   - Responds to camera mode and direction change inputs
 *   - Updates HUD elements (time, FPS, camera status)
 * ============================================
 */

export class UIController {
  constructor(cameraManager) {
    this.cameraManager = cameraManager;
    this.isPlaying = false;
    this.simSpeed = 60; // default speed per second

   
    this.btnPlay = document.getElementById("btn-play");
    this.btnReset = document.getElementById("btn-reset");
    this.speedLine = document.getElementById("speedLine");

    this.sectionDirection = document.getElementById("sec-direction");
    this.btnNorth = document.getElementById("btn-north");
    this.btnSouth = document.getElementById("btn-south");
    this.btnEast = document.getElementById("btn-east");
    this.btnWest = document.getElementById("btn-west");
  
    // Displaying the initail section 
    this.updateDirectionSection();

    this.#bindEvents();
  }

  // =========================
  // 섹션 표시 (space 전용)
  // =========================
  updateDirectionSection() {
    if (!this.sectionDirection) return;
    this.sectionDirection.hidden = this.cameraManager.mode !== "space";
  }

  // =========================
  // Event binding
  // =========================
  #bindEvents() {
    //Start/Pause
    if (this.btnPlay)
      this.btnPlay.addEventListener("click", () => {
        this.isPlaying = !this.isPlaying;
        this.btnPlay.textContent = this.isPlaying ? "⏸ 일시정지" : "▶︎ 재생";
        if (this.onPlayToggle) this.onPlayToggle(this.isPlaying);
      });

    // Reset
    if (this.btnReset)
      this.btnReset.addEventListener("click", () => {
        this.isPlaying = false;
        this.btnPlay.textContent = "▶︎ 재생";
        if (this.onReset) this.onReset();
      });

    // Speed slider
    if (this.speedLine)
      this.speedLine.addEventListener("input", (e) => {
        this.simSpeed = Number(e.target.value);
        if (this.onSpeedChange) this.onSpeedChange(this.simSpeed);
      });

    // Change camera mode (space/observer))
    document.querySelectorAll('input[name="camMode"]').forEach((el) => {
      el.addEventListener("change", (e) => {
        const mode = e.target.value;
        this.cameraManager.setMode(mode);
        this.cameraManager.manualView = false;
        this.updateCamHUD();
        this.updateDirectionSection();
      });
    });

    // Change camera viewpoint(north/south/east/west)
    const dirButtons = [
      { el: this.btnNorth, dir: "north" },
      { el: this.btnSouth, dir: "south" },
      { el: this.btnEast, dir: "east" },
      { el: this.btnWest, dir: "west" },
    ];

    // Viewpoint switching is possible only in space mode.
    dirButtons.forEach(({ el, dir }) => {
      if (!el) return;
      el.addEventListener("click", () => {
        if (this.cameraManager.mode !== "space") {
          alert("⚠️ 시점 전환은 Space 모드에서만 가능합니다.");
          return;
        }
        this.cameraManager.setDirectionView(dir);
        this.updateCamHUD();
      });
    });

    // Eclipse event (solar/lunar)
    document.querySelectorAll('input[name="eventMode"]').forEach((el) => {
      el.addEventListener("change", (e) => {
        if (e.target.checked && this.onEventChange) {
          this.onEventChange(e.target.value);
        }
      });
    });

    //Window resize
    window.addEventListener("resize", () => this.updateCanvasSize());
    this.updateCanvasSize();
  }

  updateCanvasSize() {
    const canvas = document.getElementById("gl-canvas");
    if (!canvas) return;
  }

}