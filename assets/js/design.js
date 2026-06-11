import { fetchDesignCategories, fetchDesignItems, fileViewUrl, trackedDownloadUrl, driveBrowserDownloadUrl } from "./api.js";
import {
  qs,
  debounce,
  setUrlParam,
  getUrlParam,
  copyToClipboard,
  initMobileNav,
  lockBodyScroll,
  unlockBodyScroll,
} from "./ui.js";

const els = {
  categoryChips: qs("#categoryChips"),
  sortChips: qs("#sortChips"),
  search: qs("#searchInput"),
  count: qs("#countLabel"),
  grid: qs("#grid"),
  modal: qs("#modal"),
  modalBackdrop: qs("#modalBackdrop"),
  modalClose: qs("#modalClose"),
  modalViewer: qs("#modalViewer"),
  modalName: qs("#modalName"),
  modalPath: qs("#modalPath"),
  modalActions: qs("#modalActions"),
};

const SORTS = [
  { key: "date", label: "NEWEST" },
  { key: "az", label: "A-Z" },
  { key: "psd-size", label: "PSD SIZE" },
];

const state = {
  category: getUrlParam("category", "all"),
  sort: getUrlParam("sort", "date"),
  q: getUrlParam("q", ""),
  previewId: getUrlParam("preview", ""),
  categories: [],
  items: [],
  filtered: [],
  lastFocus: null,
  lastNonPreviewUrl: "",
};

let gridLoadingStop = null;
let designView = null;

function clearNode(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function formatList(it) {
  const preferred = ["image", "psd", "timelapse", "blend", "nomad"];
  const files = it.files || {};
  return preferred
    .filter((key) => files[key])
    .concat((it.formats || []).map((f) => f.key).filter((key) => key && !preferred.includes(key)))
    .filter((key, idx, arr) => arr.indexOf(key) === idx)
    .map((key) => String(key).toLowerCase())
    .join(", ");
}
function extFor(file) { return String(file?.ext || file?.key || "file").replace(/^\./, "").toLowerCase(); }
function filenameFor(it, file) { const ext = extFor(file); return `${slugify(it.name) || "design"}.${ext}`; }
function dateValue(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }
function numberValue(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function imageUrl(it) {
  const f = it.files?.image;
  return it.imagePreviewUrl || f?.previewUrl || f?.thumbnailUrl || it.thumbnailUrl || fileViewUrl(it.imageId || it.thumbId);
}

function makeChip({ label, active, onClick }) {
  const b = document.createElement("button");
  b.className = `chip chip--folder ${active ? "is-active" : ""}`.trim();
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function renderCategoryChips() {
  clearNode(els.categoryChips);

  els.categoryChips.appendChild(makeChip({
    label: "ALL DESIGN",
    active: (state.category || "all") === "all",
    onClick: () => {
      if (state.category === "all") return;
      state.category = "all";
      setUrlParam("category", "all");
      renderCategoryChips();
      loadDataAndRender();
    },
  }));

  for (const cat of state.categories) {
    els.categoryChips.appendChild(makeChip({
      label: cat.label || cat.name || cat.key,
      active: state.category === cat.key,
      onClick: () => {
        if (state.category === cat.key) return;
        state.category = cat.key;
        setUrlParam("category", state.category);
        renderCategoryChips();
        loadDataAndRender();
      },
    }));
  }
}

function renderSortChips() {
  clearNode(els.sortChips);
  for (const sort of SORTS) {
    els.sortChips.appendChild(makeChip({
      label: sort.label,
      active: state.sort === sort.key,
      onClick: () => {
        if (state.sort === sort.key) return;
        state.sort = sort.key;
        setUrlParam("sort", state.sort);
        renderSortChips();
        applyFiltersAndRenderGrid();
      },
    }));
  }
}

function sortItems(items) {
  const out = [...items];
  if (state.sort === "az") {
    return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  if (state.sort === "psd-size") {
    return out.sort((a, b) => numberValue(b.psdSize || b.files?.psd?.size) - numberValue(a.psdSize || a.files?.psd?.size) || (a.name || "").localeCompare(b.name || ""));
  }
  return out.sort((a, b) => dateValue(b.imageModifiedTime || b.files?.image?.modifiedTime) - dateValue(a.imageModifiedTime || a.files?.image?.modifiedTime) || (a.name || "").localeCompare(b.name || ""));
}

function applyFiltersAndRenderGrid() {
  const q = String(state.q || "").trim().toLowerCase();
  const items = sortItems(state.items.filter((it) =>
    !q ||
    (it.name || "").toLowerCase().includes(q) ||
    (it.categoryLabel || "").toLowerCase().includes(q) ||
    formatList(it).toLowerCase().includes(q)
  ));
  state.filtered = items;
  els.count.textContent = `${items.length} shown`;
  renderGrid(items);
}

function renderGrid(items) {
  els.grid.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "NO DESIGN FILES FOUND. MAKE SURE THE IMAGE FOLDER HAS PUBLIC IMAGE FILES, THEN REDEPLOY/REFRESH.";
    els.grid.appendChild(empty);
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card card--media card--design";
    card.tabIndex = 0;

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";
    if (it.imageId || it.thumbId) {
      const img = document.createElement("img");
      img.className = "card__thumb";
      img.loading = "lazy";
      img.alt = it.name || "Design preview";
      if (it.imageWidth && it.imageHeight) img.style.setProperty("--thumb-ratio", `${it.imageWidth} / ${it.imageHeight}`);
      img.src = imageUrl(it);
      viewer.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "card__placeholder";
      ph.textContent = "NO IMAGE PREVIEW";
      viewer.appendChild(ph);
    }

    const meta = document.createElement("div");
    meta.className = "card__meta";
    const nameRow = document.createElement("div");
    nameRow.className = "card__top";
    const name = document.createElement("h2");
    name.className = "card__name";
    name.textContent = it.name || "Untitled design";
    nameRow.appendChild(name);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = it.categoryLabel || "DESIGN";
    nameRow.appendChild(badge);
    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = formatList(it) || "no downloads";
    meta.appendChild(nameRow);
    meta.appendChild(path);
    card.appendChild(viewer);
    card.appendChild(meta);

    card.addEventListener("click", () => openModal(it));
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openModal(it); }
    });
    els.grid.appendChild(card);
  }
}

function getPreviewlessHref() {
  const u = new URL(window.location.href);
  u.searchParams.delete("preview");
  return u.toString();
}

function buildPreviewLink(it) {
  const url = new URL(`${window.location.origin}/design/`);
  if (state.category && state.category !== "all") url.searchParams.set("category", state.category);
  if (state.sort && state.sort !== "date") url.searchParams.set("sort", state.sort);
  if (state.q) url.searchParams.set("q", state.q);
  url.searchParams.set("preview", it.id);
  return url.toString();
}

function cleanupDesignView() {
  if (!designView) return;
  try { designView.resizeObserver?.disconnect?.(); } catch {}
  designView = null;
}

function applyDesignTransform() {
  if (!designView?.img) return;
  const scale = (designView.baseScale || 1) * (designView.zoom || 1);
  designView.img.style.width = `${designView.naturalW || 1}px`;
  designView.img.style.height = `${designView.naturalH || 1}px`;
  designView.img.style.transform = `translate(-50%, -50%) translate(${designView.panX || 0}px, ${designView.panY || 0}px) scale(${scale})`;
  if (designView.zoomLabel) designView.zoomLabel.textContent = `${Math.round((designView.zoom || 1) * 100)}%`;
}

function fitDesignToView() {
  if (!designView?.viewport || !designView?.img) return;
  const rect = designView.viewport.getBoundingClientRect();
  const w = designView.naturalW || designView.img.naturalWidth || 1;
  const h = designView.naturalH || designView.img.naturalHeight || 1;
  designView.naturalW = w;
  designView.naturalH = h;
  designView.baseScale = Math.min(rect.width / w, rect.height / h) * 0.96;
  if (!Number.isFinite(designView.baseScale) || designView.baseScale <= 0) designView.baseScale = 1;
  designView.zoom = 1;
  designView.panX = 0;
  designView.panY = 0;
  applyDesignTransform();
}

function zoomDesign(multiplier) {
  if (!designView) return;
  const next = Math.max(0.2, Math.min(8, (designView.zoom || 1) * multiplier));
  designView.zoom = next;
  applyDesignTransform();
}

function createNavButton(label, onClick) {
  const b = document.createElement("button");
  b.className = "btn btn--nav";
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function showImagePreview(it) {
  cleanupDesignView();
  els.modalViewer.innerHTML = "";
  if (!(it.imageId || it.thumbId)) {
    els.modalViewer.innerHTML = '<div class="viewer__loading">NO PREVIEW AVAILABLE</div>';
    return;
  }

  const shell = document.createElement("div");
  shell.className = "map-preview design-preview";

  const viewport = document.createElement("div");
  viewport.className = "map-preview__viewport";

  const img = document.createElement("img");
  img.className = "modal__thumb map-preview__img design-preview__img";
  img.alt = it.name || "Design preview";
  img.src = imageUrl(it);
  img.draggable = false;

  const resolution = document.createElement("div");
  resolution.className = "map-preview__resolution";
  resolution.textContent = it.imageWidth && it.imageHeight ? `${it.imageWidth} x ${it.imageHeight} PIXELS` : "LOADING PIXELS";

  const controls = document.createElement("div");
  controls.className = "map-preview__controls";
  const zoomGroup = document.createElement("div");
  zoomGroup.className = "map-preview__group";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "map-preview__zoom";
  zoomLabel.textContent = "100%";
  zoomLabel.setAttribute("aria-live", "polite");
  zoomGroup.appendChild(createNavButton("+", () => zoomDesign(1.25)));
  zoomGroup.appendChild(createNavButton("-", () => zoomDesign(0.8)));
  zoomGroup.appendChild(zoomLabel);
  zoomGroup.appendChild(createNavButton("HOME", () => fitDesignToView()));
  controls.appendChild(zoomGroup);

  viewport.appendChild(img);
  shell.appendChild(viewport);
  shell.appendChild(resolution);
  shell.appendChild(controls);
  els.modalViewer.appendChild(shell);

  designView = {
    viewport,
    img,
    zoomLabel,
    naturalW: Number(it.imageWidth || 0),
    naturalH: Number(it.imageHeight || 0),
    baseScale: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  };

  img.addEventListener("load", () => {
    designView.naturalW = Number(it.imageWidth || img.naturalWidth || 1);
    designView.naturalH = Number(it.imageHeight || img.naturalHeight || 1);
    resolution.textContent = `${designView.naturalW} x ${designView.naturalH} PIXELS`;
    fitDesignToView();
  }, { once: true });

  viewport.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    zoomDesign(ev.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (ev) => {
    if (!designView) return;
    designView.dragging = true;
    designView.startX = ev.clientX;
    designView.startY = ev.clientY;
    designView.startPanX = designView.panX || 0;
    designView.startPanY = designView.panY || 0;
    viewport.classList.add("is-dragging");
    try { viewport.setPointerCapture(ev.pointerId); } catch {}
  });
  viewport.addEventListener("pointermove", (ev) => {
    if (!designView?.dragging) return;
    designView.panX = designView.startPanX + (ev.clientX - designView.startX);
    designView.panY = designView.startPanY + (ev.clientY - designView.startY);
    applyDesignTransform();
  });
  const endDrag = (ev) => {
    if (!designView) return;
    designView.dragging = false;
    viewport.classList.remove("is-dragging");
    try { viewport.releasePointerCapture(ev.pointerId); } catch {}
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  designView.resizeObserver = new ResizeObserver(() => fitDesignToView());
  designView.resizeObserver.observe(viewport);
  window.setTimeout(() => fitDesignToView(), 80);
}

function showTimelapsePreview(it) {
  cleanupDesignView();
  els.modalViewer.innerHTML = "";
  const iframe = document.createElement("iframe");
  const file = it.files?.timelapse || (it.formats || []).find((f) => f.key === "timelapse");
  iframe.src = file?.drivePreviewUrl || `https://drive.google.com/file/d/${it.timelapseId}/preview`;
  iframe.allow = "autoplay; fullscreen";
  iframe.allowFullscreen = true;
  iframe.title = `${it.name || "Design"} timelapse`;
  els.modalViewer.appendChild(iframe);
}

function addDownloadButton(it, file, label, primary = false) {
  const a = document.createElement("a");
  a.className = `btn ${primary ? "btn--primary" : ""}`.trim();
  a.href = trackedDownloadUrl(file.fileId, slugify(it.name) || "design", extFor(file), {
    kind: `design-${file.key}`,
    asset: it.name,
    path: it.categoryLabel || "design",
    label: file.label || file.key,
  });
  a.download = filenameFor(it, file);
  a.textContent = label || `DOWNLOAD .${extFor(file).toUpperCase()}`;
  a.addEventListener("click", async (ev) => {
    if (ev.currentTarget?.dataset?.downloadFallbackReady === "1") return;
    ev.preventDefault();
    ev.stopPropagation();
    await downloadViaFetch(a.href, filenameFor(it, file), {
      button: a,
      fallbackUrl: driveBrowserDownloadUrl(file.fileId),
    });
  });
  els.modalActions.appendChild(a);
  return a;
}

function addTimelapseToggle(it) {
  const file = it.files?.timelapse;
  if (!file) return;
  let previewing = false;
  const b = document.createElement("button");
  b.className = "btn";
  b.type = "button";
  b.textContent = "TIMELAPSE";
  b.addEventListener("click", async () => {
    if (!previewing) {
      previewing = true;
      showTimelapsePreview(it);
      b.textContent = "DOWNLOAD TIMELAPSE";
      return;
    }
    await downloadViaFetch(trackedDownloadUrl(file.fileId, slugify(it.name) || "design", extFor(file), {
      kind: "design-timelapse",
      asset: it.name,
      path: it.categoryLabel || "design",
      label: file.label || file.key,
    }), filenameFor(it, file), { button: b, fallbackUrl: driveBrowserDownloadUrl(file.fileId) });
  });
  els.modalActions.appendChild(b);
}

function openModal(it, opts = {}) {
  const wasOpen = els.modal.classList.contains("is-open");
  if (!wasOpen) state.lastNonPreviewUrl = getPreviewlessHref();
  const previewLink = buildPreviewLink(it);

  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  state.lastFocus = document.activeElement;
  try { els.modalClose?.focus?.(); } catch {}
  lockBodyScroll();
  if (!opts.skipUrlUpdate) history.replaceState({}, "", previewLink);

  els.modalName.textContent = it.name || "Untitled design";
  els.modalPath.textContent = formatList(it) || "no downloads";
  clearNode(els.modalActions);
  showImagePreview(it);

  if (it.files?.image) addDownloadButton(it, it.files.image, "DOWNLOAD IMAGE", true);
  addTimelapseToggle(it);
  for (const key of ["psd", "blend", "nomad"]) {
    if (it.files?.[key]) addDownloadButton(it, it.files[key], `DOWNLOAD .${key.toUpperCase()}`, false);
  }
}

function closeModal(opts = {}) {
  cleanupDesignView();
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalViewer.innerHTML = '<div class="viewer__loading">Loading...</div>';
  unlockBodyScroll();
  if (!opts.skipUrlRestore) history.replaceState({}, "", state.lastNonPreviewUrl || getPreviewlessHref());
}

function maybeOpenPreviewFromUrl() {
  const previewId = String(getUrlParam("preview", "") || "").trim();
  if (!previewId) return;
  const match = state.items.find((it) => String(it.id) === previewId);
  if (match) openModal(match, { skipUrlUpdate: true });
}

function startDotLoader(el, baseText = "LOADING") {
  if (!el) return () => {};
  let n = 0;
  el.textContent = baseText;
  const t = window.setInterval(() => {
    n = (n + 1) % 4;
    el.textContent = baseText + ".".repeat(n);
  }, 350);
  return () => window.clearInterval(t);
}

function showLoading() {
  if (gridLoadingStop) gridLoadingStop();
  els.grid.innerHTML = '<div class="grid__loading"></div>';
  gridLoadingStop = startDotLoader(els.grid.querySelector(".grid__loading"), "LOADING");
}

function stopLoading() {
  if (gridLoadingStop) gridLoadingStop();
  gridLoadingStop = null;
}

async function loadCategories() {
  const res = await fetchDesignCategories().catch(() => ({ categories: [] }));
  state.categories = Array.isArray(res?.categories) ? res.categories : [];
  if (!state.categories.length) state.categories = [{ key: "thumbnail", label: "THUMBNAILS" }];
  renderCategoryChips();
}

async function loadDataAndRender() {
  showLoading();
  renderSortChips();
  const res = await fetchDesignItems(state.category).catch(() => ({ items: [], groups: [] }));
  const direct = Array.isArray(res?.items) ? res.items : [];
  const fromGroups = [];
  for (const g of res?.groups || []) {
    if ((g.key || "").toLowerCase() === "all") continue;
    for (const it of g.items || []) fromGroups.push(it);
  }
  state.items = direct.length ? direct : fromGroups;
  stopLoading();
  applyFiltersAndRenderGrid();
  maybeOpenPreviewFromUrl();
}

els.modalBackdrop.addEventListener("click", () => closeModal());
els.modalClose.addEventListener("click", () => closeModal());
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && els.modal.classList.contains("is-open")) closeModal(); });
els.search.value = state.q || "";
els.search.addEventListener("input", debounce(() => {
  state.q = els.search.value || "";
  setUrlParam("q", state.q || "");
  applyFiltersAndRenderGrid();
}, 120));

window.addEventListener("popstate", async () => {
  state.category = getUrlParam("category", "all");
  state.sort = getUrlParam("sort", "date");
  state.q = getUrlParam("q", "");
  els.search.value = state.q;
  if (!getUrlParam("preview", "") && els.modal.classList.contains("is-open")) closeModal({ skipUrlRestore: true });
  renderCategoryChips();
  renderSortChips();
  await loadDataAndRender();
});

initMobileNav();
await loadCategories();
await loadDataAndRender();

async function downloadViaFetch(url, filename, opts = {}) {
  const button = opts.button || null;
  const fallbackUrl = opts.fallbackUrl || "";
  const originalText = button ? button.textContent : "";
  const originalBusy = button ? button.getAttribute("aria-busy") : null;

  const setButton = (text, busy = true) => {
    if (!button) return;
    if (button.dataset) delete button.dataset.downloadFallbackReady;
    button.textContent = text;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    if ("disabled" in button) button.disabled = !!busy;
  };

  const restoreButton = (delay = 1200) => {
    if (!button) return;
    window.setTimeout(() => {
      button.textContent = originalText;
      if (originalBusy === null) button.removeAttribute("aria-busy");
      else button.setAttribute("aria-busy", originalBusy);
      if ("disabled" in button) button.disabled = false;
    }, delay);
  };

  try {
    setButton("PREPARING...");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    setButton("DOWNLOADING...");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    setButton("DONE", false);
    restoreButton();
  } catch (err) {
    console.error(err);
    if (fallbackUrl && button) {
      button.textContent = "OPEN DRIVE";
      button.setAttribute("aria-busy", "false");
      if ("disabled" in button) button.disabled = false;
      if (button.dataset) button.dataset.downloadFallbackReady = "1";
      button.href = fallbackUrl;
      button.target = "_blank";
      button.rel = "noopener";
      return;
    }
    setButton("FAILED", false);
    restoreButton(1800);
  }
}
