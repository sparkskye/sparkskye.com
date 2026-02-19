import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { fileDownloadUrl } from "./api.js";

/**
 * IMPORTANT:
 * You said: forward is correct now, but upside down.
 * That means we flip around X by PI (not Y).
 */
const DEFAULT_MODEL_ROTATION = new THREE.Euler(Math.PI, 0, 0);

/** texture filtering for pixel art */
function forceNearestTextures(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      const maps = ["map", "emissiveMap", "metalnessMap", "roughnessMap", "normalMap", "aoMap"];
      for (const k of maps) {
        const tex = m[k];
        if (tex && tex.isTexture) {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.generateMipmaps = false;
          tex.needsUpdate = true;
        }
      }
    }
  });
}

/** fit camera to object */
function frameObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 1.4;

  camera.position.set(center.x + dist, center.y + dist * 0.65, center.z + dist);
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}

/** shared loader */
const loader = new GLTFLoader();

async function loadModel(modelId, filename) {
  const url = fileDownloadUrl(modelId, filename);
  const gltf = await loader.loadAsync(url);
  return gltf;
}

/**
 * Card preview manager
 */
export class CardPreview {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.anim = null;
    this.root = null;
    this.failed = false;

    this.placeholder = container.querySelector(".card__placeholder");
    this.reloadBtn = container.querySelector(".card__reload");
  }

  async start() {
    if (this.renderer || this.failed) return;

    // placeholder visible until first render
    if (this.placeholder) this.placeholder.style.display = "flex";
    if (this.reloadBtn) this.reloadBtn.style.display = "none";

    const { modelId, filename } = this.opts;

    try {
      this.scene = new THREE.Scene();

      // simple light, no gradients
      const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1.0);
      this.scene.add(hemi);
      const dir = new THREE.DirectionalLight(0xffffff, 0.85);
      dir.position.set(2, 4, 3);
      this.scene.add(dir);

      const w = this.container.clientWidth;
      const h = this.container.clientHeight;

      this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);

      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false
      });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setSize(w, h, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.canvas = this.renderer.domElement;
      this.container.appendChild(this.canvas);

      const gltf = await loadModel(modelId, filename);
      this.root = gltf.scene;

      // fix orientation: flip upside-down
      this.root.rotation.copy(DEFAULT_MODEL_ROTATION);

      forceNearestTextures(this.root);

      this.scene.add(this.root);

      // frame once (no controls on card)
      frameObject(this.camera, null, this.root);

      const renderOnce = () => {
        if (!this.renderer) return;
        const ww = this.container.clientWidth;
        const hh = this.container.clientHeight;
        this.camera.aspect = ww / hh;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(ww, hh, false);
        this.renderer.render(this.scene, this.camera);
      };

      // render loop kept minimal: only rerender on resize tick
      this.anim = requestAnimationFrame(() => renderOnce());

      if (this.placeholder) this.placeholder.style.display = "none";
    } catch (err) {
      console.error("Card preview failed:", err);
      this.failed = true;
      if (this.placeholder) {
        this.placeholder.textContent = "Preview failed — tap reload";
        this.placeholder.style.display = "flex";
      }
      if (this.reloadBtn) this.reloadBtn.style.display = "block";
    }
  }

  stop() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;

    if (this.root && this.scene) this.scene.remove(this.root);
    this.root = null;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.scene = null;
    this.camera = null;

    // keep placeholder when offscreen
    if (this.placeholder && !this.failed) {
      this.placeholder.textContent = "SELECT TO PREVIEW";
      this.placeholder.style.display = "flex";
    }
  }

  resetAndRetry() {
    this.failed = false;
    if (this.reloadBtn) this.reloadBtn.style.display = "none";
    this.stop();
    this.start();
  }
}

/**
 * Modal preview (interactive)
 */
export class ModalPreview {
  constructor(container) {
    this.container = container;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.root = null;
    this.raf = null;
  }

  async open(modelId, filename) {
    this.close(); // clean previous

    this.scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1.05);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.95);
    dir.position.set(2, 4, 3);
    this.scene.add(dir);

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.6;

    const gltf = await loadModel(modelId, filename);
    this.root = gltf.scene;

    // same orientation fix
    this.root.rotation.copy(DEFAULT_MODEL_ROTATION);

    forceNearestTextures(this.root);
    this.scene.add(this.root);

    frameObject(this.camera, this.controls, this.root);

    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const ww = this.container.clientWidth;
      const hh = this.container.clientHeight;
      this.camera.aspect = ww / hh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(ww, hh, false);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  close() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    if (this.root && this.scene) this.scene.remove(this.root);
    this.root = null;

    if (this.renderer) {
      const c = this.renderer.domElement;
      this.renderer.dispose();
      this.renderer = null;
      if (c && c.parentElement) c.parentElement.removeChild(c);
    }

    this.scene = null;
    this.camera = null;
  }
}
