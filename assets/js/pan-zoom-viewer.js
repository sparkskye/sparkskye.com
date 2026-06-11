// Shared pixel/image preview viewer.
// This is the same interaction model used by the Hive Resources minimap viewer:
// fit-to-screen baseline = 100%, cursor-centered wheel zoom, drag-to-pan, pinch zoom, and HOME reset.
export function createPanZoomImageViewer({
  container,
  src,
  alt = "Preview",
  units = "pixels",
  imageClass = "",
  loadingText = "LOADING...",
  onLoad = null,
  onError = null,
} = {}) {
  if (!container) throw new Error("createPanZoomImageViewer requires a container");

  const state = {
    shell: null,
    viewport: null,
    img: null,
    res: null,
    helper: null,
    zoomLabel: null,
    baseScale: 1,
    zoom: 1,
    minZoom: 0.15,
    maxZoom: 8,
    x: 0,
    y: 0,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    pointers: new Map(),
    pinching: false,
    pinchStartDist: 0,
    pinchStartZoom: 1,
    pinchLastMidX: 0,
    pinchLastMidY: 0,
    wheelHandler: null,
    pointerDownHandler: null,
    pointerMoveHandler: null,
    pointerUpHandler: null,
    resizeHandler: null,
  };

  function clearNode(node) {
    while (node?.firstChild) node.removeChild(node.firstChild);
  }

  function createControl(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--nav";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function clamp() {
    if (!state.viewport || !state.img) return;
    const vw = state.viewport.clientWidth || 1;
    const vh = state.viewport.clientHeight || 1;
    const iw = state.img.naturalWidth || 1;
    const ih = state.img.naturalHeight || 1;

    // Match the Hive minimap behavior: pan bounds use the maximum zoom size,
    // not the current zoom size, so the pan limits do not tighten/loosen while zooming.
    const maxOverallScale = (state.baseScale || 1) * (state.maxZoom || 8);
    const scaledW = iw * maxOverallScale;
    const scaledH = ih * maxOverallScale;
    const overscroll = Math.min(700, Math.max(240, Math.min(vw, vh) * 0.55));
    const baseMaxX = Math.max(0, (scaledW - vw) / 2);
    const baseMaxY = Math.max(0, (scaledH - vh) / 2);
    const maxX = baseMaxX + overscroll;
    const maxY = baseMaxY + overscroll;

    state.x = Math.min(maxX, Math.max(-maxX, state.x));
    state.y = Math.min(maxY, Math.max(-maxY, state.y));
  }

  function overallScale() {
    return (state.baseScale || 1) * (state.zoom || 1);
  }

  function applyTransform() {
    if (!state.img) return;
    clamp();
    const s = overallScale();
    state.img.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${s})`;
    if (state.helper) state.helper.textContent = `${Math.round((state.zoom || 1) * 100)}%`;
    if (state.zoomLabel) state.zoomLabel.textContent = `${Math.round((state.zoom || 1) * 100)}%`;
  }

  function applyFitScale(fitScale) {
    state.baseScale = fitScale;
    state.zoom = 1;
    state.minZoom = 0.15;
    state.maxZoom = 8;
    state.x = 0;
    state.y = 0;
    applyTransform();
  }

  function fitToView() {
    if (!state.viewport || !state.img) return;
    const vw = state.viewport.clientWidth || 0;
    const vh = state.viewport.clientHeight || 0;
    const iw = state.img.naturalWidth || 0;
    const ih = state.img.naturalHeight || 0;
    if (vw < 10 || vh < 10 || iw < 2 || ih < 2) return;
    const fitScale = Math.min(vw / iw, vh / ih);
    if (!Number.isFinite(fitScale) || fitScale <= 0) return;
    applyFitScale(fitScale);
  }

  function scheduleFit(tries = 0) {
    if (!state.viewport || !state.img) return;
    const vw = state.viewport.clientWidth || 0;
    const vh = state.viewport.clientHeight || 0;
    if (vw < 10 || vh < 10) {
      if (tries < 12) requestAnimationFrame(() => scheduleFit(tries + 1));
      return;
    }
    fitToView();
  }

  function zoomTo(nextZoom, clientX = null, clientY = null) {
    if (!state.viewport || !state.img) return;
    const oldZoom = state.zoom || 1;
    const clampedZoom = Math.min(state.maxZoom || 8, Math.max(state.minZoom || 0.15, nextZoom));
    if (!Number.isFinite(clampedZoom)) return;

    const oldS = (state.baseScale || 1) * oldZoom;
    const newS = (state.baseScale || 1) * clampedZoom;

    let relX = 0;
    let relY = 0;
    if (clientX != null && clientY != null) {
      const r = state.viewport.getBoundingClientRect();
      relX = (clientX - r.left) - r.width / 2;
      relY = (clientY - r.top) - r.height / 2;
    }

    const ix = (relX - state.x) / (oldS || 1);
    const iy = (relY - state.y) / (oldS || 1);
    state.x = relX - ix * newS;
    state.y = relY - iy * newS;
    state.zoom = clampedZoom;
    applyTransform();
  }

  function zoomBy(multiplier, clientX = null, clientY = null) {
    zoomTo((state.zoom || 1) * multiplier, clientX, clientY);
  }

  function panBy(dx, dy) {
    if (!state.img) return;
    state.x += dx;
    state.y += dy;
    applyTransform();
  }

  function destroy() {
    if (state.viewport && state.wheelHandler) state.viewport.removeEventListener("wheel", state.wheelHandler);
    if (state.viewport && state.pointerDownHandler) state.viewport.removeEventListener("pointerdown", state.pointerDownHandler);
    if (window && state.pointerMoveHandler) window.removeEventListener("pointermove", state.pointerMoveHandler);
    if (window && state.pointerUpHandler) {
      window.removeEventListener("pointerup", state.pointerUpHandler);
      window.removeEventListener("pointercancel", state.pointerUpHandler);
    }
    if (window && state.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
    clearNode(container);
  }

  clearNode(container);

  const shell = document.createElement("div");
  shell.className = "map-preview shared-panzoom-preview";

  const viewport = document.createElement("div");
  viewport.className = "map-preview__viewport";

  const img = document.createElement("img");
  img.className = `modal__thumb map-preview__img ${imageClass}`.trim();
  img.alt = alt;
  img.draggable = false;

  const resolution = document.createElement("div");
  resolution.className = "map-preview__resolution";
  resolution.textContent = loadingText;

  const controls = document.createElement("div");
  controls.className = "map-preview__controls";

  const zoomGroup = document.createElement("div");
  zoomGroup.className = "map-preview__group";
  zoomGroup.appendChild(createControl("+", () => zoomBy(1.25)));
  zoomGroup.appendChild(createControl("-", () => zoomBy(0.8)));

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "map-preview__zoom";
  zoomLabel.textContent = "100%";
  zoomLabel.setAttribute("aria-live", "polite");
  zoomGroup.appendChild(zoomLabel);

  zoomGroup.appendChild(createControl("HOME", () => scheduleFit()));
  controls.appendChild(zoomGroup);

  viewport.appendChild(img);
  shell.appendChild(viewport);
  shell.appendChild(resolution);
  shell.appendChild(controls);
  container.appendChild(shell);

  state.shell = shell;
  state.viewport = viewport;
  state.img = img;
  state.res = resolution;
  state.controls = controls;
  state.zoomLabel = zoomLabel;

  state.wheelHandler = (ev) => {
    ev.preventDefault();
    zoomBy(ev.deltaY < 0 ? 1.12 : 0.89, ev.clientX, ev.clientY);
  };

  state.pointerDownHandler = (ev) => {
    if (!state.img) return;
    state.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { viewport.setPointerCapture(ev.pointerId); } catch {}

    if (state.pointers.size === 1) {
      state.pinching = false;
      state.dragging = true;
      state.pointerId = ev.pointerId;
      state.startX = ev.clientX;
      state.startY = ev.clientY;
      viewport.classList.add("is-dragging");
      return;
    }

    if (state.pointers.size === 2) {
      state.dragging = false;
      state.pointerId = null;
      state.pinching = true;
      const pts = [...state.pointers.values()];
      const p1 = pts[0];
      const p2 = pts[1];
      state.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      state.pinchStartZoom = state.zoom;
      state.pinchLastMidX = (p1.x + p2.x) / 2;
      state.pinchLastMidY = (p1.y + p2.y) / 2;
      viewport.classList.add("is-dragging");
    }
  };

  state.pointerMoveHandler = (ev) => {
    if (!state.img) return;
    if (!state.pointers.has(ev.pointerId)) return;
    state.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (state.pinching && state.pointers.size >= 2) {
      const pts = [...state.pointers.values()].slice(0, 2);
      const p1 = pts[0];
      const p2 = pts[1];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const dMidX = midX - state.pinchLastMidX;
      const dMidY = midY - state.pinchLastMidY;
      state.pinchLastMidX = midX;
      state.pinchLastMidY = midY;
      state.x += dMidX;
      state.y += dMidY;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const nextZoom = state.pinchStartZoom * (dist / (state.pinchStartDist || 1));
      zoomTo(nextZoom, midX, midY);
      return;
    }

    if (!state.dragging || ev.pointerId !== state.pointerId) return;
    const dx = ev.clientX - state.startX;
    const dy = ev.clientY - state.startY;
    state.startX = ev.clientX;
    state.startY = ev.clientY;
    panBy(dx, dy);
  };

  state.pointerUpHandler = (ev) => {
    if (state.pointers.has(ev.pointerId)) state.pointers.delete(ev.pointerId);

    if (state.pointers.size >= 2) {
      state.pinching = true;
      state.dragging = false;
      state.pointerId = null;
      const pts = [...state.pointers.values()].slice(0, 2);
      const p1 = pts[0];
      const p2 = pts[1];
      state.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      state.pinchStartZoom = state.zoom;
      state.pinchLastMidX = (p1.x + p2.x) / 2;
      state.pinchLastMidY = (p1.y + p2.y) / 2;
      return;
    }

    state.pinching = false;
    state.pinchStartDist = 0;

    if (state.pointers.size === 1) {
      const remainingId = [...state.pointers.keys()][0];
      const p = state.pointers.get(remainingId);
      state.dragging = true;
      state.pointerId = remainingId;
      state.startX = p.x;
      state.startY = p.y;
      viewport.classList.add("is-dragging");
      return;
    }

    state.dragging = false;
    state.pointerId = null;
    viewport.classList.remove("is-dragging");
  };

  state.resizeHandler = () => scheduleFit();

  viewport.addEventListener("wheel", state.wheelHandler, { passive: false });
  viewport.addEventListener("pointerdown", state.pointerDownHandler);
  window.addEventListener("pointermove", state.pointerMoveHandler);
  window.addEventListener("pointerup", state.pointerUpHandler);
  window.addEventListener("pointercancel", state.pointerUpHandler);
  window.addEventListener("resize", state.resizeHandler);

  img.addEventListener("load", () => {
    if (state.img !== img) return;
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    resolution.textContent = w && h ? `${w} x ${h} ${units}` : "";
    scheduleFit();
    if (typeof onLoad === "function") onLoad({ width: w, height: h, state });
  });

  img.addEventListener("error", () => {
    if (state.img !== img) return;
    resolution.textContent = "FAILED TO LOAD";
    if (typeof onError === "function") onError({ state });
  });

  img.src = src;

  return {
    state,
    destroy,
    fit: scheduleFit,
    zoomBy,
    zoomTo,
    panBy,
  };
}
