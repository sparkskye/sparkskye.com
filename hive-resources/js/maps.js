import { fetchMaps, fetchMapGames, fileViewUrl, trackedDownloadUrl } from "./api.js";
import {
  qs,
  debounce,
  setUrlParam,
  getUrlParam,
  copyToClipboard,
  titleCase,
  initMobileNav,
  lockBodyScroll,
  unlockBodyScroll,
} from "./ui.js";

const els = {
  gameChips: qs("#gameChips"),
  modeChips: qs("#modeChips"),
  search: qs("#searchInput"),
  count: qs("#countLabel"),
  grid: qs("#grid"),

  modal: qs("#modal"),
  modalBackdrop: qs("#modalBackdrop"),
  modalClose: qs("#modalClose"),
  modalViewer: qs("#modalViewer"),
  modalLoading: qs("#modalLoading"),
  modalName: qs("#modalName"),
  modalPath: qs("#modalPath"),
  modalDownload: qs("#modalDownload"),
  modalDownloadPng: qs("#modalDownloadPng"),
  modalCopy: qs("#modalCopy"),
};

const state = {
  games: [],
  game: slugify(getUrlParam("game", "")),
  mode: String(getUrlParam("mode", "all") || "all").toLowerCase(),
  q: getUrlParam("q", ""),
  previewId: getUrlParam("preview", ""),
  data: null,
  groups: [],
  items: [],
  filtered: [],
  lastFocus: null,
  lastNonPreviewUrl: "",
  activePreviewId: "",
  downloadCountRequest: 0,
};

let gridLoadingEl = null;
let gridLoadingStop = null;
let imgIO = null;
let loadSeq = 0;

const mapView = {
  shell: null,
  viewport: null,
  img: null,
  res: null,
  controls: null,
  helper: null,
  baseScale: 1,
  zoom: 1,
  minZoom: 0.1,
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

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeGameLabel(key) {
  return titleCase(key).toUpperCase();
}

function buildPathText(gameKey, modePath) {
  const g = (gameKey || "").toUpperCase();
  const p = String(modePath || "")
    .replace(/^\/+/, "")
    .replace(/\//g, " \\ ");
  return p ? `${g} \\ ${p.toUpperCase()}` : `${g}`;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function makeChip({ label, active, onClick, extraClass = "" }) {
  const b = document.createElement("button");
  b.className = `chip ${extraClass} ${active ? "is-active" : ""}`.trim();
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

async function loadGameListIfNeeded() {
  try {
    const res = await fetchMapGames();
    const raw = Array.isArray(res?.games) ? res.games : Array.isArray(res) ? res : [];

    const parsed = raw
      .map((g) => {
        if (typeof g === "string") {
          const key = slugify(g);
          return key ? { key, label: normalizeGameLabel(g) } : null;
        }
        if (g && typeof g === "object") {
          const labelCandidate =
            (typeof g.label === "string" ? g.label : (g.label && (g.label.label || g.label.name))) ||
            (typeof g.name === "string" ? g.name : (g.name && (g.name.label || g.name.name))) ||
            (typeof g.title === "string" ? g.title : "") ||
            (typeof g.key === "string" ? g.key : "") ||
            (typeof g.slug === "string" ? g.slug : "");

          let key = slugify(String(g.key || g.slug || labelCandidate || ""));
          const label = normalizeGameLabel(String(labelCandidate || key || ""));
          if (!key) key = slugify(label);
          return key ? { key, label } : null;
        }
        return null;
      })
      .filter(Boolean);

    const seen = new Set();
    state.games = parsed.filter((g) => {
      if (seen.has(g.key)) return false;
      seen.add(g.key);
      return true;
    });
    return;
  } catch {
    const provided = window.__HIVE_GAMES;
    if (Array.isArray(provided) && provided.length) {
      state.games = provided
        .map((x) => {
          if (typeof x === "string") return { key: slugify(x), label: normalizeGameLabel(x) };
          const label = String(x?.label || x?.name || x?.title || x?.key || "");
          const key = slugify(String(x?.key || x?.slug || label));
          return { key, label: normalizeGameLabel(label || key) };
        })
        .filter((g) => g.key);
      return;
    }
    state.games = [];
  }
}

function renderGameChips() {
  clearNode(els.gameChips);

  const games = state.games.length
    ? state.games
    : [{ key: state.game || "bedwars", label: normalizeGameLabel(state.game || "bedwars") }];

  els.gameChips.appendChild(
    makeChip({
      label: "ALL MAPS",
      active: state.game === "all",
      onClick: () => {
        if (state.game === "all") return;
        state.game = "all";
        setUrlParam("game", state.game);
        renderGameChips();
        loadDataAndRender();
      },
    })
  );

  const sorted = [...games].sort((a, b) => a.label.localeCompare(b.label));
  for (const g of sorted) {
    const active = g.key === state.game;
    els.gameChips.appendChild(
      makeChip({
        label: String(g.label || g.key || "").toUpperCase(),
        active,
        onClick: () => {
          if (state.game === g.key) return;
          state.game = g.key;
          setUrlParam("game", state.game);
          renderGameChips();
          loadDataAndRender();
        },
      })
    );
  }
}

function modeKeyFromGroup(group) {
  return String(group.key || slugify(group.label) || "").toLowerCase();
}

function renderModeChips(groups) {
  clearNode(els.modeChips);

  els.modeChips.appendChild(
    makeChip({
      label: "ALL MODES",
      active: (state.mode || "all") === "all",
      extraClass: "chip--folder",
      onClick: () => {
        if (state.mode === "all") return;
        state.mode = "all";
        setUrlParam("mode", state.mode);
        renderModeChips(state.groups);
        applyFiltersAndRenderGrid();
      },
    })
  );

  if (state.game === "all") return;

  for (const grp of groups) {
    if ((grp.key || "").toLowerCase() === "all") continue;
    const key = modeKeyFromGroup(grp);
    const label = (grp.label || key).toUpperCase();
    const active = key === state.mode;

    els.modeChips.appendChild(
      makeChip({
        label,
        active,
        extraClass: "chip--folder",
        onClick: () => {
          if (state.mode === key) return;
          state.mode = key;
          setUrlParam("mode", state.mode);
          renderModeChips(state.groups);
          applyFiltersAndRenderGrid();
        },
      })
    );
  }
}

function pickGlbId(it) {
  return it.glbId || it.modelId || it.mapId || it.id || it.fileId || it.assetId || null;
}

function pickThumb(it) {
  const id = it.thumbId || it.pngId || it.imageId || it.minimapId || it.thumbnailId || it.previewId || null;
  const url = it.thumbUrl || it.pngUrl || it.thumbnailUrl || it.previewUrl || null;
  return { id, url };
}

function flattenItemsFromGroups(groups, gameKey) {
  const out = [];
  const seen = new Set();

  for (const g of groups || []) {
    if ((g.key || "").toLowerCase() === "all") continue;
    const groupKey = modeKeyFromGroup(g);
    const groupLabel = g.label || groupKey;

    for (const it of g.items || []) {
      const glbId = pickGlbId(it);
      const dedupeKey = glbId || `${it.name || ""}::${it.path || it.modeLabel || it.folderLabel || groupLabel || ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const thumb = pickThumb(it);
      out.push({
        name: it.name || it.title || "(untitled)",
        gameKey: gameKey || state.game,
        glbId,
        thumbId: thumb.id,
        thumbUrl: thumb.url,
        relPath: it.path || it.modeLabel || it.folderLabel || groupLabel || "",
        modeKey: groupKey,
        modeLabel: it.modeLabel || it.folderLabel || groupLabel || "",
        ext: "glb",
      });
    }
  }

  const allGroup = (groups || []).find((g) => (g.key || "").toLowerCase() === "all");
  for (const it of allGroup?.items || []) {
    const glbId = pickGlbId(it);
    const dedupeKey = glbId || `${it.name || ""}::${it.path || it.modeLabel || it.folderLabel || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const thumb = pickThumb(it);
    out.push({
      name: it.name || it.title || "(untitled)",
      gameKey: gameKey || state.game,
      glbId,
      thumbId: thumb.id,
      thumbUrl: thumb.url,
      relPath: it.path || it.modeLabel || it.folderLabel || "",
      modeKey: slugify(it.modeLabel || it.folderLabel || "") || "all",
      modeLabel: it.modeLabel || it.folderLabel || "",
      ext: "glb",
    });
  }

  if (!out.length) {
    for (const it of allGroup?.items || []) {
      const glbId = pickGlbId(it);
      const thumb = pickThumb(it);
      out.push({
        name: it.name || it.title || "(untitled)",
        gameKey: gameKey || state.game,
        glbId,
        thumbId: thumb.id,
        thumbUrl: thumb.url,
        relPath: it.path || it.modeLabel || it.folderLabel || "",
        modeKey: slugify(it.modeLabel || it.folderLabel || "") || "all",
        modeLabel: it.modeLabel || it.folderLabel || "",
        ext: "glb",
      });
    }
  }

  out.sort((a, b) => (a.name || "").localeCompare(b.name || "") || (a.relPath || "").localeCompare(b.relPath || ""));
  return out;
}

function applyFiltersAndRenderGrid() {
  const q = (state.q || "").trim().toLowerCase();
  const mode = (state.mode || "all").toLowerCase();

  const items = state.items.filter((it) => {
    const okMode =
      mode === "all"
        ? true
        : it.modeKey === mode || slugify(it.modeLabel) === mode || (it.modeLabel || "").toLowerCase() === mode;

    if (!okMode) return false;
    if (!q) return true;

    return (
      (it.name || "").toLowerCase().includes(q) ||
      (it.modeLabel || "").toLowerCase().includes(q) ||
      (it.relPath || "").toLowerCase().includes(q)
    );
  });

  state.filtered = items;
  els.count.textContent = `${items.length} shown`;
  renderGrid(items);
}

function startDotLoader(el, baseText) {
  if (!el) return () => {};
  let n = 0;
  el.textContent = baseText;
  const t = setInterval(() => {
    n = (n + 1) % 4;
    el.textContent = baseText + ".".repeat(n);
  }, 350);
  return () => clearInterval(t);
}

function showGridLoading(show) {
  if (show) {
    if (!gridLoadingEl) {
      gridLoadingEl = document.createElement("div");
      gridLoadingEl.className = "grid__loading";
      els.grid.innerHTML = "";
      els.grid.appendChild(gridLoadingEl);
    }
    if (gridLoadingStop) gridLoadingStop();
    gridLoadingStop = startDotLoader(gridLoadingEl, "LOADING");
  } else {
    if (gridLoadingStop) gridLoadingStop();
    gridLoadingStop = null;
    gridLoadingEl = null;
  }
}

function renderGrid(items) {
  els.grid.innerHTML = "";

  try { imgIO?.disconnect(); } catch {}
  imgIO = null;

  imgIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      const src = img.dataset.src;
      if (!src || img.src) continue;
      img.src = src;
    }
  }, { root: null, threshold: 0.01, rootMargin: "700px 0px 700px 0px" });

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";

    const ph = document.createElement("div");
    ph.className = "card__placeholder";
    ph.textContent = "";

    const thumbSrc = it.thumbUrl ? it.thumbUrl : it.thumbId ? fileViewUrl(it.thumbId) : "";

    if (thumbSrc) {
      const img = document.createElement("img");
      img.className = "card__thumb";
      img.alt = it.name;
      img.dataset.src = thumbSrc;
      imgIO.observe(img);
      ph.style.display = "flex";
      ph.textContent = "";

      img.addEventListener("load", () => {
        ph.style.display = "none";
      });
      img.addEventListener("error", () => {
        ph.style.display = "flex";
        ph.textContent = "NO PREVIEW";
      });

      viewer.appendChild(img);
    } else {
      ph.style.display = "flex";
      ph.textContent = "NO PREVIEW";
    }
    viewer.appendChild(ph);

    const meta = document.createElement("div");
    meta.className = "card__meta";

    const nameRow = document.createElement("div");
    nameRow.className = "card__top";

    const name = document.createElement("a");
    name.className = "card__name";
    name.href = "#";
    name.textContent = it.name;

    const filename = `${slugify(it.name) || "map"}.glb`;
    const dl = it.glbId
      ? trackedDownloadUrl(it.glbId, slugify(it.name) || "map", "glb", {
          kind: "map-glb",
          asset: it.name,
          game: it.gameKey || state.game,
          path: it.relPath || it.modeLabel || "",
        })
      : "";

    name.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!dl) return;
      await downloadViaFetch(dl, filename);
    });

    nameRow.appendChild(name);

    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = buildPathText(it.gameKey || state.game, it.relPath || it.modeLabel || "");

    meta.appendChild(nameRow);
    meta.appendChild(path);

    card.appendChild(viewer);
    card.appendChild(meta);

    card.addEventListener("click", () => openModal(it));
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openModal(it);
      }
    });

    els.grid.appendChild(card);
  }
}

function destroyMapViewer() {
  if (mapView.viewport && mapView.wheelHandler) mapView.viewport.removeEventListener("wheel", mapView.wheelHandler);
  if (mapView.viewport && mapView.pointerDownHandler) mapView.viewport.removeEventListener("pointerdown", mapView.pointerDownHandler);
  if (window && mapView.pointerMoveHandler) window.removeEventListener("pointermove", mapView.pointerMoveHandler);
  if (window && mapView.pointerUpHandler) {
    window.removeEventListener("pointerup", mapView.pointerUpHandler);
    window.removeEventListener("pointercancel", mapView.pointerUpHandler);
  }
  if (window && mapView.resizeHandler) window.removeEventListener("resize", mapView.resizeHandler);

  mapView.shell = null;
  mapView.viewport = null;
  mapView.img = null;
  mapView.res = null;
  mapView.controls = null;
  mapView.helper = null;
  mapView.baseScale = 1;
  mapView.zoom = 1;
  mapView.minZoom = 0.1;
  mapView.maxZoom = 8;
  mapView.x = 0;
  mapView.y = 0;
  mapView.dragging = false;
  mapView.pointerId = null;
  mapView.startX = 0;
  mapView.startY = 0;
  mapView.pointers = new Map();
  mapView.pinching = false;
  mapView.pinchStartDist = 0;
  mapView.pinchStartZoom = 1;
  mapView.pinchLastMidX = 0;
  mapView.pinchLastMidY = 0;
  mapView.wheelHandler = null;
  mapView.pointerDownHandler = null;
  mapView.pointerMoveHandler = null;
  mapView.pointerUpHandler = null;
  mapView.resizeHandler = null;
}

function clampMapView() {
  if (!mapView.viewport || !mapView.img) return;
  const vw = mapView.viewport.clientWidth || 1;
  const vh = mapView.viewport.clientHeight || 1;
  const iw = mapView.img.naturalWidth || 1;
  const ih = mapView.img.naturalHeight || 1;

  // Pan bounds should NOT tighten/loosen as you zoom.
  // We clamp against the maximum zoomed size so you can always reach edges at any zoom,
  // and still "fly off" the map a bit. HOME snaps back to the clean centered view.
  const maxOverallScale = (mapView.baseScale || 1) * (mapView.maxZoom || 8);
  const scaledW = iw * maxOverallScale;
  const scaledH = ih * maxOverallScale;

  const overscroll = Math.min(700, Math.max(240, Math.min(vw, vh) * 0.55));

  const baseMaxX = Math.max(0, (scaledW - vw) / 2);
  const baseMaxY = Math.max(0, (scaledH - vh) / 2);

  const maxX = baseMaxX + overscroll;
  const maxY = baseMaxY + overscroll;

  mapView.x = Math.min(maxX, Math.max(-maxX, mapView.x));
  mapView.y = Math.min(maxY, Math.max(-maxY, mapView.y));
}

function overallScale_() {
  return (mapView.baseScale || 1) * (mapView.zoom || 1);
}

function applyMapTransform() {
  if (!mapView.img) return;
  clampMapView();
  const s = overallScale_();
  mapView.img.style.transform = `translate(-50%, -50%) translate(${mapView.x}px, ${mapView.y}px) scale(${s})`;
  if (mapView.helper) {
    mapView.helper.textContent = `${Math.round((mapView.zoom || 1) * 100)}%`;
  }
}

function applyFitScale_(fitScale) {
  // This "fit" is our baseline. We label it as 100% for every map.
  mapView.baseScale = fitScale;
  mapView.zoom = 1;

  // Allow zooming out a good bit past the fitted view.
  mapView.minZoom = 0.15;

  // Cap zoom-in (relative to fit).
  mapView.maxZoom = 8;

  mapView.x = 0;
  mapView.y = 0;
  applyMapTransform();
}

function fitMapToView() {
  if (!mapView.viewport || !mapView.img) return;

  const vw = mapView.viewport.clientWidth || 0;
  const vh = mapView.viewport.clientHeight || 0;
  const iw = mapView.img.naturalWidth || 0;
  const ih = mapView.img.naturalHeight || 0;

  if (vw < 10 || vh < 10 || iw < 2 || ih < 2) return;

  const fitScale = Math.min(vw / iw, vh / ih);
  if (!Number.isFinite(fitScale) || fitScale <= 0) return;

  applyFitScale_(fitScale);
}

function scheduleFitMapToView(tries = 0) {
  if (!mapView.viewport || !mapView.img) return;
  const vw = mapView.viewport.clientWidth || 0;
  const vh = mapView.viewport.clientHeight || 0;

  if (vw < 10 || vh < 10) {
    if (tries < 12) requestAnimationFrame(() => scheduleFitMapToView(tries + 1));
    return;
  }

  fitMapToView();
}

function zoomTo_(nextZoom, clientX = null, clientY = null) {
  if (!mapView.viewport || !mapView.img) return;

  const oldZoom = mapView.zoom || 1;
  const clampedZoom = Math.min(mapView.maxZoom || 8, Math.max(mapView.minZoom || 0.15, nextZoom));
  if (!Number.isFinite(clampedZoom)) return;

  const oldS = (mapView.baseScale || 1) * oldZoom;
  const newS = (mapView.baseScale || 1) * clampedZoom;

  // Pivot relative to viewport center, in px
  let relX = 0;
  let relY = 0;

  if (clientX != null && clientY != null) {
    const r = mapView.viewport.getBoundingClientRect();
    relX = (clientX - r.left) - r.width / 2;
    relY = (clientY - r.top) - r.height / 2;
  }

  // Image-space point under pivot BEFORE zoom
  const ix = (relX - mapView.x) / (oldS || 1);
  const iy = (relY - mapView.y) / (oldS || 1);

  // Recompute translation so that image-space point stays under the pivot
  mapView.x = relX - ix * newS;
  mapView.y = relY - iy * newS;

  mapView.zoom = clampedZoom;
  applyMapTransform();
}

function zoomMap(multiplier, clientX = null, clientY = null) {
  zoomTo_((mapView.zoom || 1) * multiplier, clientX, clientY);
}

function panMap(dx, dy) {
  if (!mapView.img) return;
  mapView.x += dx;
  mapView.y += dy;
  applyMapTransform();
}

function createMapControl(label, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function mountMapPreview(it, thumbSrc) {
  destroyMapViewer();

  while (els.modalViewer.firstChild) els.modalViewer.removeChild(els.modalViewer.firstChild);
  els.modalViewer.appendChild(els.modalLoading);

  const shell = document.createElement("div");
  shell.className = "map-preview";

  const viewport = document.createElement("div");
  viewport.className = "map-preview__viewport";

  const img = document.createElement("img");
  img.className = "modal__thumb map-preview__img";
  img.alt = it.name;

  const resolution = document.createElement("div");
  resolution.className = "map-preview__resolution";
  resolution.textContent = "";

  const helper = document.createElement("div");
  helper.className = "map-preview__helper";
  helper.textContent = "";

  const controls = document.createElement("div");
  controls.className = "map-preview__controls";

  const zoomGroup = document.createElement("div");
  zoomGroup.className = "map-preview__group";
  zoomGroup.appendChild(createMapControl("+", "btn btn--nav", () => zoomMap(1.25)));
  zoomGroup.appendChild(createMapControl("-", "btn btn--nav", () => zoomMap(0.8)));
  zoomGroup.appendChild(createMapControl("HOME", "btn btn--nav", () => scheduleFitMapToView()));
  controls.appendChild(zoomGroup);


  viewport.appendChild(img);
  shell.appendChild(viewport);
  shell.appendChild(resolution);
  shell.appendChild(helper);
  shell.appendChild(controls);
  els.modalViewer.appendChild(shell);

  mapView.shell = shell;
  mapView.viewport = viewport;
  mapView.img = img;
  mapView.res = resolution;
  mapView.controls = controls;
  mapView.helper = helper;

  mapView.wheelHandler = (ev) => {
    ev.preventDefault();
    zoomMap(ev.deltaY < 0 ? 1.12 : 0.89, ev.clientX, ev.clientY);
  };
  mapView.pointerDownHandler = (ev) => {
    if (!mapView.img) return;
    mapView.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    try { viewport.setPointerCapture(ev.pointerId); } catch {}

    // Single pointer: drag
    if (mapView.pointers.size === 1) {
      mapView.pinching = false;
      mapView.dragging = true;
      mapView.pointerId = ev.pointerId;
      mapView.startX = ev.clientX;
      mapView.startY = ev.clientY;
      viewport.classList.add("is-dragging");
      return;
    }

    // Two pointers: pinch + pan
    if (mapView.pointers.size === 2) {
      mapView.dragging = false;
      mapView.pointerId = null;
      mapView.pinching = true;

      const pts = [...mapView.pointers.values()];
      const p1 = pts[0];
      const p2 = pts[1];
      mapView.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      mapView.pinchStartZoom = mapView.zoom;
      mapView.pinchLastMidX = (p1.x + p2.x) / 2;
      mapView.pinchLastMidY = (p1.y + p2.y) / 2;
      viewport.classList.add("is-dragging");
    }
  };
  mapView.pointerMoveHandler = (ev) => {
    if (!mapView.img) return;
    if (!mapView.pointers.has(ev.pointerId)) return;

    mapView.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    // Pinch mode (2+ pointers)
    if (mapView.pinching && mapView.pointers.size >= 2) {
      const pts = [...mapView.pointers.values()].slice(0, 2);
      const p1 = pts[0];
      const p2 = pts[1];

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      const dMidX = midX - mapView.pinchLastMidX;
      const dMidY = midY - mapView.pinchLastMidY;
      mapView.pinchLastMidX = midX;
      mapView.pinchLastMidY = midY;

      // Pan with the midpoint movement
      mapView.x += dMidX;
      mapView.y += dMidY;

      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const nextZoom = mapView.pinchStartZoom * (dist / (mapView.pinchStartDist || 1));
      // Zoom around the current midpoint so it behaves naturally at the edges.
      zoomTo_(nextZoom, midX, midY);
      return;
    }

    // Drag mode (single pointer)
    if (!mapView.dragging || ev.pointerId !== mapView.pointerId) return;
    const dx = ev.clientX - mapView.startX;
    const dy = ev.clientY - mapView.startY;
    mapView.startX = ev.clientX;
    mapView.startY = ev.clientY;
    panMap(dx, dy);
  };
  mapView.pointerUpHandler = (ev) => {
    if (mapView.pointers.has(ev.pointerId)) mapView.pointers.delete(ev.pointerId);

    // If two pointers remain, re-baseline pinch
    if (mapView.pointers.size >= 2) {
      mapView.pinching = true;
      mapView.dragging = false;
      mapView.pointerId = null;

      const pts = [...mapView.pointers.values()].slice(0, 2);
      const p1 = pts[0];
      const p2 = pts[1];
      mapView.pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      mapView.pinchStartZoom = mapView.zoom;
      mapView.pinchLastMidX = (p1.x + p2.x) / 2;
      mapView.pinchLastMidY = (p1.y + p2.y) / 2;
      return;
    }

    mapView.pinching = false;
    mapView.pinchStartDist = 0;

    // If one pointer remains, switch back to drag
    if (mapView.pointers.size === 1) {
      const remainingId = [...mapView.pointers.keys()][0];
      const p = mapView.pointers.get(remainingId);
      mapView.dragging = true;
      mapView.pointerId = remainingId;
      mapView.startX = p.x;
      mapView.startY = p.y;
      viewport.classList.add("is-dragging");
      return;
    }

    // No pointers left
    mapView.dragging = false;
    mapView.pointerId = null;
    viewport.classList.remove("is-dragging");
  };
  mapView.resizeHandler = () => scheduleFitMapToView();

  viewport.addEventListener("wheel", mapView.wheelHandler, { passive: false });
  viewport.addEventListener("pointerdown", mapView.pointerDownHandler);
  window.addEventListener("pointermove", mapView.pointerMoveHandler);
  window.addEventListener("pointerup", mapView.pointerUpHandler);
  window.addEventListener("pointercancel", mapView.pointerUpHandler);
  window.addEventListener("resize", mapView.resizeHandler);

  img.addEventListener("load", () => {
    if (mapView.img !== img) return;
    els.modalLoading.style.display = "none";
    resolution.textContent = `${img.naturalWidth} x ${img.naturalHeight} blocks`;
    scheduleFitMapToView();
  });

  img.addEventListener("error", () => {
    if (mapView.img !== img) return;
    els.modalLoading.style.display = "flex";
    els.modalLoading.textContent = "FAILED TO LOAD";
    resolution.textContent = "";
  });

  img.src = thumbSrc;
}

function getPreviewlessHref() {
  const u = new URL(window.location.href);
  u.searchParams.delete("preview");
  return u.toString();
}

function buildPreviewLink(it) {
  const url = new URL(`${window.location.origin}/hive-resources/maps/`);
  url.searchParams.set("game", it.gameKey || state.game);
  if (state.game !== "all") {
    const mode = it.modeKey && it.modeKey !== "all" ? it.modeKey : "all";
    if (mode && mode !== "all") url.searchParams.set("mode", mode);
  }
  url.searchParams.set("preview", it.glbId || it.thumbId || "");
  return url.toString();
}

function handleMapModalKeydown(e) {
  if (!els.modal.classList.contains("is-open") || !mapView.img) return false;
  if (e.key === "+" || e.key === "=") {
    e.preventDefault();
    zoomMap(1.12);
    return true;
  }
  if (e.key === "-" || e.key === "_") {
    e.preventDefault();
    zoomMap(0.89);
    return true;
  }
  if (e.key === "0" || e.key === "Home") {
    e.preventDefault();
    scheduleFitMapToView();
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    panMap(0, 64);
    return true;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    panMap(0, -64);
    return true;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    panMap(64, 0);
    return true;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    panMap(-64, 0);
    return true;
  }
  return false;
}

function openModal(it, opts = {}) {
  const wasOpen = els.modal.classList.contains("is-open");
  if (!wasOpen) state.lastNonPreviewUrl = getPreviewlessHref();

  const previewLink = buildPreviewLink(it);
  state.previewId = it.glbId || it.thumbId || "";
  state.activePreviewId = state.previewId;

  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  state.lastFocus = document.activeElement;
  try { els.modalClose?.focus?.(); } catch {}
  lockBodyScroll();

  if (!opts.skipUrlUpdate) history.replaceState({}, "", previewLink);

  els.modalLoading.style.display = "flex";
  els.modalLoading.textContent = "Loading…";
  els.modalName.textContent = it.name;
  els.modalPath.textContent = buildPathText(it.gameKey || state.game, it.relPath || it.modeLabel || "");

  const baseName = slugify(it.name) || "map";
  const glbFilename = `${baseName}.glb`;
  const glbDownload = it.glbId
    ? trackedDownloadUrl(it.glbId, baseName, "glb", {
        kind: "map-glb",
        asset: it.name,
        game: it.gameKey || state.game,
        path: it.relPath || it.modeLabel || "",
      })
    : "";

  els.modalDownload.href = glbDownload || "#";
  els.modalDownload.download = glbFilename;
  els.modalDownload.onclick = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!glbDownload) return;
    await downloadViaFetch(glbDownload, glbFilename);
};

  const pngFilename = `${baseName}.png`;
  const pngDownload = it.thumbId
    ? trackedDownloadUrl(it.thumbId, baseName, "png", {
        kind: "map-png",
        asset: `${it.name} minimap`,
        game: it.gameKey || state.game,
        path: it.relPath || it.modeLabel || "",
      })
    : "";

  els.modalDownloadPng.href = pngDownload || it.thumbUrl || "#";
  els.modalDownloadPng.download = pngFilename;
  els.modalDownloadPng.onclick = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (pngDownload) {
      await downloadViaFetch(pngDownload, pngFilename);
return;
    }
    if (it.thumbUrl) {
      await downloadViaFetch(it.thumbUrl, pngFilename);
    }
  };
  els.modalDownloadPng.style.display = it.thumbId || it.thumbUrl ? "inline-flex" : "none";

  els.modalCopy.onclick = async () => {
    await copyToClipboard(previewLink);
    els.modalCopy.textContent = "COPIED!";
    setTimeout(() => (els.modalCopy.textContent = "COPY LINK"), 900);
  };

  const thumbSrc = it.thumbUrl ? it.thumbUrl : it.thumbId ? fileViewUrl(it.thumbId) : "";
  if (thumbSrc) mountMapPreview(it, thumbSrc);
  else {
    destroyMapViewer();
    while (els.modalViewer.firstChild) els.modalViewer.removeChild(els.modalViewer.firstChild);
    els.modalViewer.appendChild(els.modalLoading);
    els.modalLoading.textContent = "NO PREVIEW";
  }
}

function closeModal(opts = {}) {
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalLoading.style.display = "flex";
  els.modalLoading.textContent = "Loading…";
  unlockBodyScroll();
  destroyMapViewer();
  state.activePreviewId = "";
  state.previewId = "";
  if (!opts.skipUrlRestore) {
    history.replaceState({}, "", state.lastNonPreviewUrl || getPreviewlessHref());
  }
}

function maybeOpenPreviewFromUrl() {
  const previewId = String(getUrlParam("preview", "") || "").trim();
  if (!previewId) return;
  if (els.modal.classList.contains("is-open") && state.activePreviewId === previewId) return;

  const match = state.items.find((it) => String(it.glbId || it.thumbId || "") === previewId);
  if (!match) return;
  openModal(match, { skipUrlUpdate: true });
}

els.modalBackdrop.addEventListener("click", () => closeModal());
els.modalClose.addEventListener("click", () => closeModal());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.modal.classList.contains("is-open")) {
    closeModal();
    return;
  }
  handleMapModalKeydown(e);
});

els.search.value = state.q || "";
els.search.addEventListener(
  "input",
  debounce(() => {
    state.q = els.search.value || "";
    setUrlParam("q", state.q || "");
    applyFiltersAndRenderGrid();
  }, 120)
);

async function loadDataAndRender() {
  const mySeq = ++loadSeq;
  showGridLoading(true);

  const mapLimit = async (arr, limit, fn) => {
    const out = new Array(arr.length);
    let i = 0;
    const workers = new Array(Math.min(limit, arr.length)).fill(0).map(async () => {
      while (i < arr.length) {
        const idx = i++;
        out[idx] = await fn(arr[idx]);
      }
    });
    await Promise.all(workers);
    return out;
  };

  const groupsFromItems = (items) => {
    const m = new Map();
    for (const it of items) {
      if (!it?.modeKey || it.modeKey === "all") continue;
      if (!m.has(it.modeKey)) m.set(it.modeKey, (it.modeLabel || it.modeKey).toUpperCase());
    }
    const groups = [...m.entries()].map(([key, label]) => ({ key, label }));
    groups.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
    return groups;
  };

  try {
    await loadGameListIfNeeded();
    if (mySeq !== loadSeq) return;
    renderGameChips();

    if (state.game === "all") {
      const gameKeys = state.games.map((g) => g.key).filter(Boolean);
      const results = await mapLimit(gameKeys, 4, async (gk) => {
        try {
          const json = await fetchMaps(gk);
          const groups = json.groups || json.modes || json.folders || [];
          return flattenItemsFromGroups(groups, gk);
        } catch {
          return [];
        }
      });
      if (mySeq !== loadSeq) return;

      state.data = { game: { key: "all" } };
      state.items = results.flat();
      state.groups = groupsFromItems(state.items);
      state.mode = "all";
      setUrlParam("mode", "all");

      renderModeChips([]);
      applyFiltersAndRenderGrid();
      maybeOpenPreviewFromUrl();
      return;
    }

    const json = await fetchMaps(state.game);
    if (mySeq !== loadSeq) return;
    state.data = json;

    if (json?.game?.key) state.game = slugify(json.game.key);

    const groups = json.groups || json.modes || json.folders || [];
    state.groups = groups;
    groups.sort((a, b) => (a.key === "all" ? -1 : b.key === "all" ? 1 : (a.label || "").localeCompare(b.label || "")));

    const modeKeys = new Set(groups.map((g) => modeKeyFromGroup(g)).concat(["all"]));
    if (!modeKeys.has(state.mode)) {
      state.mode = "all";
      setUrlParam("mode", "all");
    }

    renderModeChips(groups);
    state.items = flattenItemsFromGroups(groups, state.game);
    applyFiltersAndRenderGrid();
    maybeOpenPreviewFromUrl();
  } finally {
    if (mySeq === loadSeq) showGridLoading(false);
  }
}

(async function init() {
  initMobileNav();

  if (!state.game) {
    state.game = "bedwars";
    setUrlParam("game", state.game);
  }

  window.addEventListener("popstate", async () => {
    state.game = slugify(getUrlParam("game", "bedwars"));
    state.mode = String(getUrlParam("mode", "all") || "all").toLowerCase();
    state.q = getUrlParam("q", "");
    state.previewId = getUrlParam("preview", "");
    els.search.value = state.q;
    if (!state.previewId && els.modal.classList.contains("is-open")) closeModal({ skipUrlRestore: true });
    await loadDataAndRender();
  });

  await loadDataAndRender();
})();

async function downloadViaFetch(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}
