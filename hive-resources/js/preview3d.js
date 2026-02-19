// 3D preview helpers (cards + modal)
//
// Goals:
// - Flat lighting (no shaded look)
// - Crisp pixel textures (nearest-neighbor)
// - Auto-center + auto-frame the model
// - Cards are STATIC (not interactable)
// - Modal is INTERACTIVE (orbit)
// - Transparent preview background

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

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
          vertexColors: m.vertexColors ?? false,
        })
      );
    }

    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

function computeMeshBounds(root) {
  // More reliable than setFromObject() when glTF has far-away empties/helpers.
  root.updateWorldMatrix(true, true);

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const g = obj.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    tmp.copy(g.boundingBox).applyMatrix4(obj.matrixWorld);
    if (!has) {
      box.copy(tmp);
      has = true;
    } else {
      box.union(tmp);
    }
  });

  if (!has) {
    box.setFromObject(root);
  }

  return box;
}

function centerAndFrame(root, camera) {
  // IMPORTANT: only rotate around Y so the model faces forward.
  // No X flips (those make things upside down).
  root.rotation.set(0, Math.PI, 0);

  // Center at origin (mesh-only bounds)
  const box = computeMeshBounds(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.sub(center);

  // Frame camera to bounds
  const sphere = new THREE.Sphere();
  computeMeshBounds(root).getBoundingSphere(sphere);
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
  // Force ABS URL so three resolves buffers/resources correctly
  const absUrl = new URL(url, window.location.href).href;

  const loader = new GLTFLoader();
  loader.setCrossOrigin("anonymous");

  // Important: resource base for relative URIs inside glTF (buffers, etc.)
  // This prevents the browser from trying /hive-resources/models/<id> on Pages.
  loader.setResourcePath(new URL("./", absUrl).href);

  const gltf = await loader.loadAsync(absUrl);
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

    // Ensure one canvas per preview container
    // (prevents stacking canvases if init is called twice)
    const existing = this.container.querySelector("canvas.previewCanvas");
    if (existing) existing.remove();

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
    if (this.disposed) return;

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

    // DO NOT forceContextLoss() here — it can cause white previews / flicker.
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

    // Keep any existing overlay elements (e.g. the loading text) in the container.
    // Only swap canvases.
    try {
      for (const c of this.container.querySelectorAll("canvas")) c.remove();
    } catch {}
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
    if (this.disposed) return;

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

    try { this.renderer?.dispose?.(); } catch {}
    this.renderer = null;
    this.scene = null;
    this.camera = null;

    // Remove only canvases; keep the loading overlay element if present.
    try {
      for (const c of this.container.querySelectorAll("canvas")) c.remove();
    } catch {}
  }
}
