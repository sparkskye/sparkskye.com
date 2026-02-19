import * as THREE from "https://unpkg.com/three@0.158.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js";

function setNearestFiltering(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const maps = ["map", "emissiveMap", "metalnessMap", "roughnessMap", "normalMap", "aoMap", "alphaMap"];
      for (const k of maps) {
        const t = m[k];
        if (t && t.isTexture) {
          t.magFilter = THREE.NearestFilter;
          // keep mips, but nearest to preserve pixel look
          t.minFilter = THREE.NearestMipmapNearestFilter;
          t.anisotropy = 1;
          t.needsUpdate = true;
        }
      }
      m.needsUpdate = true;
    }
  });
}

function fitCameraToObject(camera, object, { padding = 1.25, yBias = 0.15 } = {}) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Recenter object at origin
  object.position.x += (object.position.x - center.x);
  object.position.y += (object.position.y - center.y);
  object.position.z += (object.position.z - center.z);

  // Use largest dimension for a stable "fits everything" framing
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * padding;

  camera.position.set(0, maxDim * yBias, dist);
  camera.near = Math.max(0.01, dist / 100);
  camera.far = dist * 100;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  return { maxDim };
}

export class CardPreview {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;

    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.root = null;

    // Use the existing placeholder (preferred), otherwise create one.
    this.loadingEl = this.container.querySelector(".ph") || null;

    this._disposed = false;

    this._setup();
  }

  _setup() {
    // Don't nuke the container (it already has placeholder + reload button)
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "pvCanvas";
      this.container.prepend(this.canvas);
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // crisp pixels
      alpha: true,
      powerPreference: "low-power",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();

    // Flat lighting: ambient only (no dramatic shading)
    const amb = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(amb);

    const w = this.container.clientWidth || 320;
    const h = this.container.clientHeight || 220;

    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 1000);
    this.renderer.setSize(w, h, false);
  }

  _renderOnce() {
    if (this._disposed) return;
    const w = this.container.clientWidth || 320;
    const h = this.container.clientHeight || 220;
    if (this.camera && this.renderer) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      this.renderer.render(this.scene, this.camera);
    }
  }

  async init(modelId, filename) {
    if (!modelId) return;
    const apiBase = this.opts.apiBase || window.__HIVE_API_BASE || "";
    const url = apiBase.replace(/\/$/, "") + `/api/file?id=${encodeURIComponent(modelId)}&name=${encodeURIComponent(filename || "model.gltf")}`;

    if (this.loadingEl) this.loadingEl.textContent = "Loading…";

    // Load GLTF
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });

    // Clear previous
    if (this.root) {
      this.scene.remove(this.root);
      this.root = null;
    }

    this.root = gltf.scene || gltf.scenes?.[0];
    if (!this.root) throw new Error("No scene in GLTF");

    // Face front: rotate 180° around vertical axis ONLY
    this.root.rotation.set(0, Math.PI, 0);

    this.scene.add(this.root);

    // Nearest-neighbor textures
    setNearestFiltering(this.root);

    // Fit + center
    fitCameraToObject(this.camera, this.root);

    // First render
    this._renderOnce();

    if (this.loadingEl) this.loadingEl.textContent = "";
  }

  destroy(keepPlaceholder = true) {
    this._disposed = true;

    if (this.root && this.scene) {
      this.scene.remove(this.root);
      this.root = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null;
    }

    if (!keepPlaceholder && this.loadingEl) {
      this.loadingEl.textContent = "";
    }
  }
}

export class ModalPreview {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;

    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.root = null;

    this._onResize = () => this._render();
    this._disposed = false;

    this._setup();
  }

  _setup() {
    this.container.innerHTML = "";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "mvCanvas";
    this.container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 2000);
    this.renderer.setSize(w, h, false);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.6;
    this.controls.addEventListener("change", () => this._render());

    window.addEventListener("resize", this._onResize);
  }

  _render() {
    if (this._disposed) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);

    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  async open(url) {
    if (!url) return;

    // Remove old
    if (this.root) {
      this.scene.remove(this.root);
      this.root = null;
    }

    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });

    this.root = gltf.scene || gltf.scenes?.[0];
    if (!this.root) throw new Error("No scene in GLTF");

    // Face front only
    this.root.rotation.set(0, Math.PI, 0);

    this.scene.add(this.root);
    setNearestFiltering(this.root);

    fitCameraToObject(this.camera, this.root, { padding: 1.15, yBias: 0.10 });

    // Orbit target stays at origin since we recentered model
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this._render();
  }

  close() {
    this._disposed = true;
    window.removeEventListener("resize", this._onResize);

    try { this.controls?.dispose(); } catch {}
    this.controls = null;

    if (this.root && this.scene) {
      this.scene.remove(this.root);
      this.root = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null;
    }
    this.container.innerHTML = "";
  }
}
