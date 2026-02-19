// 3D preview helpers (cards + modal)
//
// Goals:
// - Flat lighting (no shaded look)
// - Crisp pixel textures (nearest-neighbor)
// - Auto-center + auto-frame the model
// - Cards are STATIC (not interactable)
// - Modal is INTERACTIVE (orbit)
// - Transparent preview background

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MAX_DPR = 2;

function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });

  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NoToneMapping;
  r.shadowMap.enabled = false;
  return r;
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh) return;

    if (obj.geometry) obj.geometry.dispose();

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.dispose();
      if (m.emissiveMap) m.emissiveMap.dispose();
      if (m.normalMap) m.normalMap.dispose();
      if (m.roughnessMap) m.roughnessMap.dispose();
      if (m.metalnessMap) m.metalnessMap.dispose();
      if (m.aoMap) m.aoMap.dispose();
      m.dispose?.();
    }
  });
}

function forceNearestAndUnlit(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = [];

    for (const m of mats) {
      if (!m) continue;

      const map = m.map || null;
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.magFilter = THREE.NearestFilter;
        map.minFilter = THREE.NearestFilter;
        map.generateMipmaps = false;
        map.needsUpdate = true;
      }

      // Unlit material => no shading
      next.push(
        new THREE.MeshBasicMaterial({
          map,
          color: m.color ?? new THREE.Color(0xffffff),
          transparent: !!m.transparent,
          opacity: m.opacity ?? 1,
          alphaTest: m.alphaTest ?? 0,
          side: m.side ?? THREE.FrontSide,
          depthWrite: m.depthWrite ?? true,
        })
      );
    }

    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

function centerAndFrame(root, camera) {
  // Center at origin
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.sub(center);

  // IMPORTANT: only rotate around Y so the model faces forward.
  // No X flips (those make things upside down).
  root.rotation.set(0, Math.PI, 0);

  // Frame camera to bounds
  const sphere = new THREE.Sphere();
  box.setFromObject(root).getBoundingSphere(sphere);
  const radius = Math.max(sphere.radius, 0.0001);

  const fov = (camera.fov * Math.PI) / 180;
  const dist = (radius / Math.tan(fov / 2)) * 1.25;

  camera.near = Math.max(0.01, dist / 100);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();

  camera.position.set(0, radius * 0.15, dist);
  camera.lookAt(0, 0, 0);
}

async function loadScene(url) {
  const loader = new GLTFLoader();
  loader.setCrossOrigin("anonymous");
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

function attachResizeObserver(container, fn) {
  const ro = new ResizeObserver(fn);
  ro.observe(container);
  return ro;
}

/**
 * CardPreview: static, non-interactive.
 */
export class CardPreview {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "previewCanvas";

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.root = null;
    this.ro = null;
    this.disposed = false;
  }

  async init(modelUrl) {
    if (this.disposed) return;
    this.container.appendChild(this.canvas);

    this.renderer = makeRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 5000);

    const resize = () => {
      if (!this.renderer || !this.camera) return;
      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderOnce();
    };

    this.ro = attachResizeObserver(this.container, resize);
    resize();

    this.root = await loadScene(modelUrl);
    forceNearestAndUnlit(this.root);
    this.scene.add(this.root);
    centerAndFrame(this.root, this.camera);

    this.renderOnce();
  }

  renderOnce() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }

  destroy(removeCanvas = true) {
    this.disposed = true;
    try { this.ro?.disconnect(); } catch {}
    this.ro = null;

    if (this.scene && this.root) {
      this.scene.remove(this.root);
      disposeObject3D(this.root);
    }
    this.root = null;

    try { this.renderer?.forceContextLoss?.(); } catch {}
    try { this.renderer?.dispose?.(); } catch {}
    this.renderer = null;
    this.scene = null;
    this.camera = null;

    if (removeCanvas && this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

/**
 * ModalPreview: interactive.
 */
export class ModalPreview {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "previewCanvas previewCanvas--modal";

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.root = null;
    this.ro = null;
    this.raf = null;
    this.disposed = false;
  }

  async open(modelUrl) {
    this.close();
    this.disposed = false;

    this.container.innerHTML = "";
    this.container.appendChild(this.canvas);

    this.renderer = makeRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);

    const resize = () => {
      if (!this.renderer || !this.camera) return;
      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };

    this.ro = attachResizeObserver(this.container, resize);
    resize();

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;

    this.root = await loadScene(modelUrl);
    forceNearestAndUnlit(this.root);
    this.scene.add(this.root);
    centerAndFrame(this.root, this.camera);

    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const tick = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      this.controls?.update();
      this.renderer?.render(this.scene, this.camera);
    };

    tick();
  }

  close() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;

    try { this.ro?.disconnect(); } catch {}
    this.ro = null;

    if (this.scene && this.root) {
      this.scene.remove(this.root);
      disposeObject3D(this.root);
    }
    this.root = null;

    try { this.controls?.dispose(); } catch {}
    this.controls = null;

    try { this.renderer?.forceContextLoss?.(); } catch {}
    try { this.renderer?.dispose?.(); } catch {}
    this.renderer = null;
    this.scene = null;
    this.camera = null;

    try { this.container.innerHTML = ""; } catch {}
  }
}
