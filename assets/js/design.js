import { fetchDesignCategories, fetchDesignItems, trackedDownloadUrl, driveBrowserDownloadUrl } from "./api.js";
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
import { createPanZoomImageViewer } from "./pan-zoom-viewer.js";

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
let activePreview = "image";
let panZoomViewer = null;
let imagePreviewButton = null;
let timelapsePreviewButton = null;

function clearNode(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function extFor(file) { return String(file?.ext || file?.key || "file").replace(/^\./, "").toLowerCase(); }
function filenameFor(it, file) { const ext = extFor(file); return `${slugify(it.name) || "design"}.${ext}`; }
function dateValue(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }
function numberValue(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

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

function imageUrl(it) {
  const f = it.files?.image;
  return it.imagePreviewUrl || f?.previewUrl || f?.thumbnailUrl || it.thumbnailUrl || "";
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
    return out.sort((a, b) =>
      numberValue(b.psdSize || b.files?.psd?.size) - numberValue(a.psdSize || a.files?.psd?.size) ||
      (a.name || "").localeCompare(b.name || "")
    );
  }
  return out.sort((a, b) =>
    dateValue(b.imageModifiedTime || b.files?.image?.modifiedTime) - dateValue(a.imageModifiedTime || a.files?.image?.modifiedTime) ||
    (a.name || "").localeCompare(b.name || "")
  );
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
    const q = String(state.q || "").trim();
    if (!q && state.items.length) return;

    const empty = document.createElement("div");
    empty.className = q ? "empty-state empty-state--search" : "empty-state";
    empty.textContent = q
      ? "THERE ARE NO RESULTS FOR THAT SEARCH."
      : "NO DESIGN FILES FOUND. MAKE SURE THE IMAGE FOLDER HAS PUBLIC IMAGE FILES, THEN REDEPLOY/REFRESH.";
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
    const name = document.createElement("h2");
    name.className = "card__name";
    name.textContent = it.name || "Untitled design";
    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = formatList(it) || "no downloads";
    meta.appendChild(name);
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
  if (!panZoomViewer) return;
  try { panZoomViewer.destroy?.(); } catch {}
  panZoomViewer = null;
}

function showImagePreview(it) {
  cleanupDesignView();
  if (!(it.imageId || it.thumbId)) {
    els.modalViewer.innerHTML = '<div class="viewer__loading">NO PREVIEW AVAILABLE</div>';
    return;
  }

  panZoomViewer = createPanZoomImageViewer({
    container: els.modalViewer,
    src: imageUrl(it),
    alt: it.name || "Design preview",
    units: "pixels",
    imageClass: "design-preview__img",
    loadingText: "LOADING PIXELS",
  });
}

function showTimelapsePreview(it) {
  cleanupDesignView();
  els.modalViewer.innerHTML = "";
  const file = it.files?.timelapse || (it.formats || []).find((f) => f.key === "timelapse");
  if (!file) {
    els.modalViewer.innerHTML = '<div class="viewer__loading">NO TIMELAPSE PREVIEW</div>';
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.src = file.drivePreviewUrl || `https://drive.google.com/file/d/${file.fileId || it.timelapseId}/preview`;
  iframe.allow = "autoplay; fullscreen";
  iframe.allowFullscreen = true;
  iframe.title = `${it.name || "Design"} timelapse`;
  els.modalViewer.appendChild(iframe);
}

function makeDownloadUrl(it, file) {
  return trackedDownloadUrl(file.fileId, slugify(it.name) || "design", extFor(file), {
    kind: `design-${file.key}`,
    asset: it.name,
    path: it.categoryLabel || "design",
    label: file.label || file.key,
  });
}

async function downloadFile(it, file, button) {
  if (!file) return;
  await downloadViaFetch(makeDownloadUrl(it, file), filenameFor(it, file), {
    button,
    fallbackUrl: driveBrowserDownloadUrl(file.fileId),
  });
}

function updatePreviewButtons() {
  if (imagePreviewButton) {
    const selected = activePreview === "image";
    imagePreviewButton.classList.toggle("is-selected", selected);
    imagePreviewButton.textContent = selected ? "DOWNLOAD IMAGE" : "IMAGE";
  }
  if (timelapsePreviewButton) {
    const selected = activePreview === "timelapse";
    timelapsePreviewButton.classList.toggle("is-selected", selected);
    timelapsePreviewButton.textContent = selected ? "DOWNLOAD TIMELAPSE" : "TIMELAPSE";
  }
}

function addPreviewButton(it, key) {
  const file = it.files?.[key];
  if (!file) return null;
  const b = document.createElement("button");
  b.className = "btn btn--preview";
  b.type = "button";
  b.addEventListener("click", async () => {
    if (activePreview === key) {
      await downloadFile(it, file, b);
      updatePreviewButtons();
      return;
    }
    activePreview = key;
    if (key === "image") showImagePreview(it);
    if (key === "timelapse") showTimelapsePreview(it);
    updatePreviewButtons();
  });
  els.modalActions.appendChild(b);
  return b;
}

function addDownloadButton(it, file, label) {
  const b = document.createElement("button");
  b.className = "btn";
  b.type = "button";
  b.textContent = label || `DOWNLOAD .${extFor(file).toUpperCase()}`;
  b.addEventListener("click", async () => downloadFile(it, file, b));
  els.modalActions.appendChild(b);
  return b;
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

  activePreview = "image";
  showImagePreview(it);
  imagePreviewButton = addPreviewButton(it, "image");
  timelapsePreviewButton = addPreviewButton(it, "timelapse");
  updatePreviewButtons();

  for (const key of ["psd", "blend", "nomad"]) {
    if (it.files?.[key]) addDownloadButton(it, it.files[key], `DOWNLOAD .${key.toUpperCase()}`);
  }
}

function closeModal(opts = {}) {
  cleanupDesignView();
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalViewer.innerHTML = '<div class="viewer__loading">Loading...</div>';
  unlockBodyScroll();
  imagePreviewButton = null;
  timelapsePreviewButton = null;
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
      updatePreviewButtons();
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
      button.addEventListener("click", () => window.open(fallbackUrl, "_blank", "noopener"), { once: true });
      return;
    }
    setButton("FAILED", false);
    restoreButton(1800);
  }
}
