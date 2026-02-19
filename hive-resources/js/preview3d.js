import * as THREE from "https://unpkg.com/three@0.158.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js";

export class CardPreview {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.root = null;
    this.failed = false;
    this.loadingEl = null;

    this.init();
  }

  init() {
    this.container.innerHTML = "";
    this.container.style.position = "relative";

    // Loading text
    this.loadingEl = document.createElement("div");
    this.loadingEl.textContent = "Loading…";
    this.loadingEl.style.position = "absolute";
    this.loadingEl.style.inset = "0";
    this.loadingEl.style.display = "flex";
    this.loadingEl.style.alignItems = "center";
    this.loadingEl.style.justifyContent = "center";
    this.loadingEl.style.fontFamily = "Minecraftia, monospace";
    this.loadingEl.style.fontSize = "12px";
    this.loadingEl.style.opacity = "0.7";
    this.container.appendChild(this.loadingEl);

    // Canvas
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.container.appendChild(this.canvas);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power"
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    // Scene
    this.scene = new THREE.Scene();

    // Flat lighting (NO shadows, NO drama)
    const lightA = new THREE.AmbientLight(0xffffff, 1.0);
    const lightB = new THREE.DirectionalLight(0xffffff, 0.6);
    lightB.position.set(5, 10, 5);
    this.scene.add(lightA, lightB);

    // Camera
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);

    this.loadModel();
  }

  loadModel() {
    const loader = new GLTFLoader();

    loader.load(
      this.opts.url,
      (gltf) => {
        this.root = gltf.scene;

        // Ensure pixel-art textures stay crisp
        this.root.traverse((obj) => {
          if (obj.isMesh && obj.material?.map) {
            obj.material.map.magFilter = THREE.NearestFilter;
            obj.material.map.minFilter = THREE.NearestFilter;
            obj.material.needsUpdate = true;
          }
        });

        // Center model FIRST
        const box = new THREE.Box3().setFromObject(this.root);
        const center = box.getCenter(new THREE.Vector3());
        this.root.position.sub(center);

        // ✅ ONLY rotate around Y (front-facing fix)
        this.root.rotation.set(0, Math.PI, 0);

        this.scene.add(this.root);

        // Camera fit AFTER transforms
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        this.camera.position.set(0, maxDim * 0.6, maxDim * 1.6);
        this.camera.lookAt(0, 0, 0);

        this.loadingEl.remove();
        this.animate();
      },
      undefined,
      () => {
        this.failed = true;
        this.loadingEl.textContent = "Preview failed";
      }
    );
  }

  animate() {
    if (this.failed) return;

    const renderLoop = () => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w && h) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(renderLoop);
    };

    renderLoop();
  }

  destroy() {
    this.renderer?.dispose();
    this.container.innerHTML = "";
  }
}
