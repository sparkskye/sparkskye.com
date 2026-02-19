// 3D preview helpers (Three.js)
// - CardPreview: lightweight, non-interactive, renders once while card is visible
// - ModalPreview: interactive orbit controls, renders continuously while modal is open

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

function applyNearestNeighborTextures(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      // Any texture-like slot we commonly care about
      const texKeys = ["map", "emissiveMap", "metalnessMap", "roughnessMap", "normalMap", "aoMap", "alphaMap"];
      for (const k of texKeys) {
        const t = m[k];
        if (t && t.isTexture) {
          t.magFilter = THREE.NearestFilter;
          t.minFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
          t.needsUpdate = true;
        }
      }
      // Keep shading clean + simple (no fancy highlights)
      m.toneMapped = false;
    }
  });
}

async function loadGltfFromUrl(url) {
  const loader = new GLTFLoader();
  return await new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (err) => reject(err)
    );
  });
}

function centerAndScale(root, targetSize = 1.2) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Center at origin
  root.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = targetSize / maxDim;
  root.scale.setScalar(s);

  // Recompute for camera framing
  const box2 = new THREE.Box3().setFromObject(root);
  const size2 = new THREE.Vector3();
  box2.getSize(size2);
  const maxDim2 = Math.max(size2.x, size2.y, size2.z) || 1;

  return { maxDim: maxDim2 };
}

function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NoToneMapping;
  r.setClearColor(0x000000, 0); // transparent
  r.shadowMap.enabled = false;
  return r;
}

function addFlatLights(scene) {
  // Mostly ambient / soft so pixel art stays clean
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.6);
  scene.add(hemi);
}

export class CardPreview {
  constructor(container, opts = {}) {
    this.container = container; // .preview
    this.opts = opts;

    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.root = null;

    this.phEl = null;       // .ph placeholder
    this.retryEl = null;    // .reloadBtn

    this.resizeObserver = null;
    this._disposed = false;
  }

  _attachUi() {
    this.phEl = this.container.querySelector(".ph") || null;
    this.retryEl = this.container.querySelector(".reloadBtn") || null;
    if (this.retryEl) this.retryEl.style.display = "none";
    if (this.phEl) this.phEl.textContent = "Loading…";
  }

  _resize() {
    if (!this.renderer || !this.camera) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderOnce();
  }

  async init(modelUrl) {
    this._disposed = false;
    this._attachUi();
    if (this.phEl) this.phEl.textContent = "Loading…";

    // Canvas
    this.canvas = document.createElement("canvas");
    this.canvas.className = "thumbCanvas";
    this.canvas.style.pointerEvents = "none"; // not interactable in grid
    this.container.appendChild(this.canvas);

    // Scene
    this.scene = new THREE.Scene();
    addFlatLights(this.scene);

    // Camera
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.camera.up.set(0, 1, 0);

    // Renderer
    this.renderer = makeRenderer(this.canvas);

    // Robust sizing (prevents "off screen" framing when layout is 0px)
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(this.container);

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    this._resize();

    const gltf = await loadGltfFromUrl(modelUrl);
    if (this._disposed) return;

    this.root = gltf.scene || gltf.scenes?.[0];
    if (!this.root) throw new Error("No scene in GLTF/GLB");

    // Keep default orientation; only face forward
    this.root.rotation.set(0, Math.PI, 0);

    this.scene.add(this.root);
    applyNearestNeighborTextures(this.root);

    const { maxDim } = centerAndScale(this.root, 1.4);

    // Frame from the front
    this.camera.position.set(0, maxDim * 0.25, maxDim * 2.2);
    this.camera.lookAt(0, 0, 0);

    this.renderOnce();
    if (this.phEl) this.phEl.textContent = "";
  }

  renderOnce() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }

  destroy(removeDom = true) {
    this._disposed = true;

    try { this.resizeObserver?.disconnect(); } catch {}
    this.resizeObserver = null;

    if (this.root && this.scene) this.scene.remove(this.root);

    if (this.root) {
      this.root.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry?.dispose?.();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (!m) continue;
            for (const k in m) {
              const v = m[k];
              if (v && v.isTexture) v.dispose?.();
            }
            m.dispose?.();
          }
        }
      });
    }

    try { this.renderer?.dispose?.(); } catch {}

    if (removeDom) {
      try { this.canvas?.remove(); } catch {}
    }

    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.root = null;
  }
}

export class ModalPreview {
  constructor(container) {
    this.container = container;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.root = null;

    this._raf = null;
    this._open = false;
    this._currentUrl = null;

    this._resizeObserver = null;
    this._loadingEl = null;
  }

  _ensureCanvas() {
    if (this.canvas) return;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "modalCanvas";
    this.container.innerHTML = "";
    this.container.appendChild(this.canvas);

    this._loadingEl = document.createElement("div");
    this._loadingEl.className = "modalLoading";
    this._loadingEl.textContent = "Loading…";
    this.container.appendChild(this._loadingEl);

    this.renderer = makeRenderer(this.canvas);

    this.scene = new THREE.Scene();
    addFlatLights(this.scene);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
    this.camera.up.set(0, 1, 0);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.7;
    this.controls.target.set(0, 0, 0);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.container);
    this._resize();
  }

  _resize() {
    if (!this.renderer || !this.camera) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._render();
  }

  async open(modelUrl) {
    this._open = true;
    this._currentUrl = modelUrl;
    this._ensureCanvas();
    this._loadingEl.style.display = "flex";
    this._loadingEl.textContent = "Loading…";

    // Cleanup existing
    if (this.root) this.scene.remove(this.root);
    this.root = null;

    try {
      const gltf = await loadGltfFromUrl(modelUrl);
      if (!this._open) return;

      this.root = gltf.scene || gltf.scenes?.[0];
      if (!this.root) throw new Error("No scene in GLTF/GLB");

      // Face forward (Y 180) only
      this.root.rotation.set(0, Math.PI, 0);

      this.scene.add(this.root);
      applyNearestNeighborTextures(this.root);

      const { maxDim } = centerAndScale(this.root, 2.0);

      this.camera.position.set(0, maxDim * 0.25, maxDim * 2.6);
      this.controls.target.set(0, 0, 0);
      this.controls.update();

      this._loadingEl.style.display = "none";
      this._loop();
    } catch (err) {
      console.error("ModalPreview failed:", err);
      this._loadingEl.style.display = "flex";
      this._loadingEl.textContent = "Failed to load";
    }
  }

  _loop() {
    if (!this._open) return;
    this._raf = requestAnimationFrame(() => this._loop());
    this.controls?.update();
    this._render();
  }

  _render() {
    try { this.renderer?.render(this.scene, this.camera); } catch {}
  }

  close() {
    this._open = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._currentUrl = null;
    // keep scene around; model removed on next open
  }

  destroy() {
    this.close();
    try { this._resizeObserver?.disconnect(); } catch {}
    this._resizeObserver = null;

    if (this.root && this.scene) this.scene.remove(this.root);

    if (this.root) {
      this.root.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry?.dispose?.();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (!m) continue;
            for (const k in m) {
              const v = m[k];
              if (v && v.isTexture) v.dispose?.();
            }
            m.dispose?.();
          }
        }
      });
    }

    try { this.renderer?.dispose?.(); } catch {}
    this.container.innerHTML = "";
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.root = null;
  }
}
