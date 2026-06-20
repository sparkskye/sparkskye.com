import { fetchArtCategories, fetchArtItems, trackedDownloadUrl, driveBrowserDownloadUrl } from "./api.js";
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
import { CardPreview, ModalPreview } from "/hive-resources/js/preview3d.js";

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
];

const state = {
  category: getUrlParam("category", "all"),
  sort: getUrlParam("sort", "date"),
  q: getUrlParam("q", ""),
  categories: [],
  items: [],
  filtered: [],
  lastFocus: null,
  lastNonPreviewUrl: "",
};

let gridLoadingStop = null;
let panZoomViewer = null;
let modelPreview = null;
let activePreview = "image";
let imagePreviewButton = null;
let timelapsePreviewButton = null;
let activeVariationIndex = 0;
let variantLabelEl = null;

const cardPreviews = new Map();
let io = null;

function clearNode(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function extFor(file) { return String(file?.ext || file?.key || "file").replace(/^\./, "").toLowerCase(); }
function dateValue(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }
function filenameFor(it, file) {
  const ext = extFor(file);
  const base = slugify(file?.downloadName || [it.name, file?.variantLabel].filter(Boolean).join(" ") || "art");
  return `${base || "art"}.${ext}`;
}
function itemKind(it) { return String(it?.kind || (it?.files?.gltf || it?.files?.glb ? "model" : it?.trailer ? "texture-pack" : "image")).toLowerCase(); }
function isModelItem(it) { return itemKind(it) === "model"; }
function isTexturePackItem(it) { return itemKind(it) === "texture-pack"; }
function modelFile(it) { return it.files?.gltf || it.files?.glb || it.formats?.find((f) => ["gltf", "glb"].includes(f.key)); }
function imageFile(it) { return currentVariation(it) || it.files?.image; }
function inlineFileUrl(file) {
  const params = new URLSearchParams();
  params.set("id", file?.fileId || file?.id || "");
  params.set("inline", "1");
  if (file?.name) params.set("name", file.name);
  if (file?.ext) params.set("ext", extFor(file));
  return `/api/file?${params.toString()}`;
}
function formatList(it) {
  if (isTexturePackItem(it)) {
    const labels = [];
    if (it.trailer) labels.push("trailer");
    for (const f of it.formats || []) if (f?.key) labels.push(String(f.key).toLowerCase());
    return [...new Set(labels)].join(", ");
  }
  const preferred = isModelItem(it)
    ? ["gltf", "glb", "bbmodel", "texture", "json", "zip", "blend"]
    : ["image", "timelapse", "psd", "blend", "nomad", "bbmodel", "zip"];
  const files = it.files || {};
  return preferred
    .filter((key) => files[key])
    .concat((it.formats || []).map((f) => f.key).filter((key) => key && !preferred.includes(key)))
    .filter((key, idx, arr) => arr.indexOf(key) === idx)
    .map((key) => String(key).toLowerCase())
    .join(", ");
}
function variationsFor(it) {
  const list = Array.isArray(it?.variations) ? it.variations.filter((v) => v?.fileId || v?.id) : [];
  if (list.length) return list;
  return it?.files?.image ? [{ ...it.files.image, label: it.files.image.variantLabel || "", variantKey: it.files.image.variantKey || "default" }] : [];
}
function currentVariation(it) {
  const list = variationsFor(it);
  if (!list.length) return null;
  activeVariationIndex = Math.max(0, Math.min(activeVariationIndex, list.length - 1));
  return list[activeVariationIndex];
}
function firstVariation(it) { return variationsFor(it)[0] || null; }
function imageUrl(it, opts = {}) {
  const f = opts.current ? currentVariation(it) : firstVariation(it);
  return f?.previewUrl || f?.thumbnailUrl || it.imagePreviewUrl || it.thumbnailUrl || "";
}
function cardThumbUrl(it) {
  if (isModelItem(it)) return "";
  if (isTexturePackItem(it)) return it.thumbnailUrl || it.trailer?.thumbnail || "/public/img/favicon.png";
  return imageUrl(it);
}
function thumbRatio(it) {
  if (isTexturePackItem(it)) {
    const w = Number(it.trailer?.thumbnailWidth || 0);
    const h = Number(it.trailer?.thumbnailHeight || 0);
    return w > 0 && h > 0 ? `${w} / ${h}` : "16 / 9";
  }
  const w = Number(it.imageWidth || it.files?.image?.width || 0);
  const h = Number(it.imageHeight || it.files?.image?.height || 0);
  return w > 0 && h > 0 ? `${w} / ${h}` : "16 / 9";
}
function createdTime(it) {
  return it.imageCreatedTime || it.videoCreatedTime || it.packCreatedTime || it.createdTime || it.files?.image?.createdTime || it.files?.gltf?.createdTime || it.files?.glb?.createdTime || it.files?.mcpack?.createdTime || it.files?.zip?.createdTime || it.files?.pack?.createdTime || "";
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
    label: "ALL ART",
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
  if (state.sort === "az") return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return out.sort((a, b) => dateValue(createdTime(b)) - dateValue(createdTime(a)) || (a.name || "").localeCompare(b.name || ""));
}
function applyFiltersAndRenderGrid() {
  const q = String(state.q || "").trim().toLowerCase();
  const items = sortItems(state.items.filter((it) =>
    !q ||
    (it.name || "").toLowerCase().includes(q) ||
    (it.categoryLabel || "").toLowerCase().includes(q) ||
    (it.variationLabels || []).join(" ").toLowerCase().includes(q) ||
    (it.trailer?.title || "").toLowerCase().includes(q) ||
    formatList(it).toLowerCase().includes(q)
  ));
  state.filtered = items;
  els.count.textContent = `${items.length} shown`;
  renderGrid(items);
}

function disposeCardPreviews() {
  for (const preview of cardPreviews.values()) preview.dispose?.();
  cardPreviews.clear();
  io?.disconnect?.();
  io = null;
}
function scheduleModelCardPreview(card, it) {
  const viewer = card.querySelector(".card__viewer");
  const file = modelFile(it);
  if (!viewer || !file) return;
  const url = inlineFileUrl(file);
  const start = async () => {
    if (cardPreviews.has(card)) return;
    const preview = new CardPreview(viewer);
    cardPreviews.set(card, preview);
    try { await preview.init(url); }
    catch { viewer.innerHTML = '<div class="card__placeholder">NO MODEL PREVIEW</div>'; }
  };
  if ("IntersectionObserver" in window) {
    if (!io) io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target;
        io.unobserve(target);
        target.__loadPreview?.();
      }
    }, { rootMargin: "180px" });
    card.__loadPreview = start;
    io.observe(card);
  } else start();
}

function renderGrid(items) {
  disposeCardPreviews();
  els.grid.innerHTML = "";
  if (!items.length) {
    const q = String(state.q || "").trim();
    const empty = document.createElement("div");
    empty.className = q ? "empty-state empty-state--search" : "empty-state";
    empty.textContent = q ? "THERE ARE NO RESULTS FOR THAT SEARCH." : "NO ART FILES FOUND.";
    els.grid.appendChild(empty);
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    card.className = `card card--media card--art card--${itemKind(it)}`;
    card.tabIndex = 0;
    card.style.setProperty("--thumb-ratio", thumbRatio(it));

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";

    if (isModelItem(it)) {
      viewer.innerHTML = '<div class="viewer__loading">LOADING...</div>';
    } else {
      const img = document.createElement("img");
      img.className = "card__thumb";
      img.loading = "lazy";
      img.alt = it.name || "Art preview";
      img.src = cardThumbUrl(it);
      img.addEventListener("error", () => {
        img.replaceWith(Object.assign(document.createElement("div"), { className: "card__placeholder", textContent: "NO PREVIEW" }));
      }, { once: true });
      viewer.appendChild(img);
    }

    const meta = document.createElement("div");
    meta.className = "card__meta";
    const name = document.createElement("h2");
    name.className = "card__name";
    name.textContent = it.name || "Untitled art";
    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = formatList(it) || (isTexturePackItem(it) ? "texture pack" : isModelItem(it) ? "model" : "image");
    meta.appendChild(name);
    meta.appendChild(path);
    card.appendChild(viewer);
    card.appendChild(meta);

    card.addEventListener("click", () => openModal(it));
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openModal(it); }
    });
    els.grid.appendChild(card);
    if (isModelItem(it)) scheduleModelCardPreview(card, it);
  }
}

function getPreviewlessHref() { const u = new URL(window.location.href); u.searchParams.delete("preview"); return u.toString(); }
function buildPreviewLink(it) { const url = new URL(`${window.location.origin}/art/`); url.searchParams.set("preview", it.id); return url.toString(); }
function buildShareLink(it) { return buildPreviewLink(it); }

function showImagePreview(it) {
  panZoomViewer?.destroy?.();
  panZoomViewer = null;
  els.modalViewer.innerHTML = "";
  const file = imageFile(it);
  if (!file) { els.modalViewer.innerHTML = '<div class="viewer__loading">NO IMAGE PREVIEW</div>'; return; }
  panZoomViewer = createPanZoomImageViewer({
    container: els.modalViewer,
    src: file.previewUrl || imageUrl(it, { current: true }),
    alt: it.name || "Art preview",
    unitLabel: "pixels",
  });
  renderVariationArrows(it);
}
function showVideoFilePreview(it, file) {
  panZoomViewer?.destroy?.();
  panZoomViewer = null;
  els.modalViewer.innerHTML = "";
  if (!file) { els.modalViewer.innerHTML = '<div class="viewer__loading">NO VIDEO PREVIEW</div>'; return; }
  const wrap = document.createElement("div");
  wrap.className = "timelapse-preview art-video-preview";
  const video = document.createElement("video");
  video.className = "timelapse-preview__video art-video-preview__video";
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = file.previewUrl || inlineFileUrl(file);
  video.title = it.name || "Art video preview";
  wrap.appendChild(video);
  els.modalViewer.appendChild(wrap);
}

async function showModelPreview(it) {
  panZoomViewer?.destroy?.();
  panZoomViewer = null;
  els.modalViewer.innerHTML = '<div class="viewer__loading">LOADING...</div>';
  const file = modelFile(it);
  if (!file) { els.modalViewer.innerHTML = '<div class="viewer__loading">NO MODEL PREVIEW</div>'; return; }
  modelPreview = new ModalPreview(els.modalViewer);
  modelPreview.open(inlineFileUrl(file)).catch(() => {
    els.modalViewer.innerHTML = '<div class="viewer__loading">NO MODEL PREVIEW</div>';
  });
}
function showTrailerPreview(it) {
  panZoomViewer?.destroy?.();
  panZoomViewer = null;
  els.modalViewer.innerHTML = "";
  const trailer = it.trailer || null;
  if (!trailer?.embedUrl) { els.modalViewer.innerHTML = '<div class="viewer__loading">NO TRAILER PREVIEW</div>'; return; }
  const iframe = document.createElement("iframe");
  iframe.src = `${trailer.embedUrl}?autoplay=0&rel=0&modestbranding=1`;
  iframe.title = trailer.title || it.name || "Texture pack trailer";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  iframe.loading = "lazy";
  els.modalViewer.appendChild(iframe);
}
function renderVariationArrows(it) {
  const list = variationsFor(it);
  if (list.length <= 1) return;
  const add = (label, dir) => {
    const b = document.createElement("button");
    b.className = `design-variant-arrow design-variant-arrow--${dir < 0 ? "prev" : "next"}`;
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      activeVariationIndex = (activeVariationIndex + dir + list.length) % list.length;
      updateVariationLabel(it);
      showImagePreview(it);
    });
    els.modalViewer.appendChild(b);
  };
  add("‹", -1);
  add("›", 1);
}
function updateVariationLabel(it) {
  if (!variantLabelEl) return;
  const label = currentVariation(it)?.label || currentVariation(it)?.variantLabel || "";
  variantLabelEl.textContent = label;
  variantLabelEl.hidden = !label;
}

function makeDownloadUrl(it, file) {
  return trackedDownloadUrl(file.fileId, slugify(it.name) || "art", extFor(file), {
    kind: `art-${file.key}`,
    asset: it.name,
    path: it.categoryLabel || "art",
    label: file.label || file.key,
  });
}
async function downloadFile(it, file, button) {
  if (!file) return;
  await downloadViaFetch(makeDownloadUrl(it, file), filenameFor(it, file), { button, fallbackUrl: driveBrowserDownloadUrl(file.fileId) });
}
function makeActionButton(label, onClick, primary = false) {
  const b = document.createElement("button");
  b.className = `btn ${primary ? "btn--preview is-selected" : ""}`.trim();
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  els.modalActions.appendChild(b);
  return b;
}
function addDownloadButton(it, file, label) {
  if (!file) return null;
  const b = makeActionButton(label || `DOWNLOAD .${extFor(file).toUpperCase()}`, () => downloadFile(it, file, b));
  return b;
}
function renderImageActions(it) {
  imagePreviewButton = makeActionButton("DOWNLOAD IMAGE", async () => {
    if (activePreview === "image") await downloadFile(it, imageFile(it), imagePreviewButton);
    else { activePreview = "image"; showImagePreview(it); updatePreviewButtons(); }
  }, true);

  const shown = new Set(["image"]);
  if (it.files?.timelapse) {
    timelapsePreviewButton = makeActionButton("TIMELAPSE", async () => {
      if (activePreview === "timelapse") await downloadFile(it, it.files.timelapse, timelapsePreviewButton);
      else { activePreview = "timelapse"; showVideoFilePreview(it, it.files.timelapse); updatePreviewButtons(); }
    });
    shown.add("timelapse");
  }

  for (const key of ["psd", "blend", "nomad", "bbmodel", "zip"]) {
    if (it.files?.[key]) {
      addDownloadButton(it, it.files[key], `DOWNLOAD .${extFor(it.files[key]).toUpperCase()}`);
      shown.add(key);
    }
  }
  for (const f of it.formats || []) {
    if (!f?.key || shown.has(f.key)) continue;
    addDownloadButton(it, f, `DOWNLOAD .${extFor(f).toUpperCase()}`);
  }
}
function updatePreviewButtons() {
  if (imagePreviewButton) imagePreviewButton.classList.toggle("is-selected", activePreview === "image");
  if (timelapsePreviewButton) {
    const selected = activePreview === "timelapse";
    timelapsePreviewButton.classList.toggle("is-selected", selected);
    timelapsePreviewButton.textContent = selected ? "DOWNLOAD TIMELAPSE" : "TIMELAPSE";
  }
}
function renderModelActions(it) {
  const main = modelFile(it);
  if (main) {
    const b = makeActionButton(`DOWNLOAD .${extFor(main).toUpperCase()}`, () => downloadFile(it, main, b), true);
  }
  for (const f of it.formats || []) {
    if (!f || f.fileId === main?.fileId) continue;
    addDownloadButton(it, f, `DOWNLOAD .${extFor(f).toUpperCase()}`);
  }
}
function renderTextureActions(it) {
  if (it.trailer?.url) makeActionButton("WATCH TRAILER", () => window.open(it.trailer.url, "_blank", "noopener"), true);
  for (const f of it.formats || []) addDownloadButton(it, f, `DOWNLOAD .${extFor(f).toUpperCase()}`);
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

  els.modalName.textContent = it.name || "Untitled art";
  clearNode(els.modalActions);
  els.modalPath.textContent = formatList(it) || "art";
  variantLabelEl = null;
  activeVariationIndex = 0;

  if (!isModelItem(it) && !isTexturePackItem(it)) {
    variantLabelEl = document.createElement("div");
    variantLabelEl.className = "modal__variant";
    els.modalName.insertAdjacentElement("afterend", variantLabelEl);
    activePreview = "image";
    updateVariationLabel(it);
    showImagePreview(it);
    renderImageActions(it);
  } else if (isModelItem(it)) {
    activePreview = "model";
    els.modalViewer.classList.add("modal__viewer--model");
    showModelPreview(it);
    renderModelActions(it);
  } else {
    activePreview = "trailer";
    showTrailerPreview(it);
    renderTextureActions(it);
  }

  const copyButton = document.createElement("button");
  copyButton.className = "btn";
  copyButton.type = "button";
  copyButton.textContent = "COPY LINK";
  copyButton.addEventListener("click", async () => {
    await copyToClipboard(buildShareLink(it));
    copyButton.textContent = "COPIED!";
    setTimeout(() => (copyButton.textContent = "COPY LINK"), 900);
  });
  els.modalActions.appendChild(copyButton);
}

function closeModal(opts = {}) {
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  panZoomViewer?.destroy?.();
  panZoomViewer = null;
  modelPreview?.close?.();
  modelPreview = null;
  els.modalViewer.innerHTML = '<div class="viewer__loading" id="modalLoading">Loading...</div>';
  els.modalViewer.classList.remove("modal__viewer--model");
  variantLabelEl?.remove?.();
  variantLabelEl = null;
  imagePreviewButton = null;
  timelapsePreviewButton = null;
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
  const t = window.setInterval(() => { n = (n + 1) % 4; el.textContent = baseText + ".".repeat(n); }, 350);
  return () => window.clearInterval(t);
}
function showLoading() {
  if (gridLoadingStop) gridLoadingStop();
  els.grid.innerHTML = '<div class="grid__loading"></div>';
  gridLoadingStop = startDotLoader(els.grid.querySelector(".grid__loading"), "LOADING");
}
function stopLoading() { if (gridLoadingStop) gridLoadingStop(); gridLoadingStop = null; }
async function loadCategories() {
  const res = await fetchArtCategories().catch(() => ({ categories: [] }));
  state.categories = Array.isArray(res?.categories) ? res.categories : [];
  renderCategoryChips();
}
async function loadDataAndRender() {
  showLoading();
  renderSortChips();
  const res = await fetchArtItems(state.category).catch(() => ({ items: [], groups: [] }));
  const direct = Array.isArray(res?.items) ? res.items : [];
  const groups = Array.isArray(res?.groups) ? res.groups : [];
  const activeCategory = String(state.category || "all").toLowerCase();

  let fromGroups = [];
  if (activeCategory === "all") {
    const allGroup = groups.find((g) => String(g?.key || "").toLowerCase() === "all");
    fromGroups = Array.isArray(allGroup?.items) && allGroup.items.length
      ? allGroup.items
      : groups.flatMap((g) => Array.isArray(g?.items) ? g.items : []);
  } else {
    const activeGroup = groups.find((g) => String(g?.key || "").toLowerCase() === activeCategory);
    fromGroups = Array.isArray(activeGroup?.items) && activeGroup.items.length
      ? activeGroup.items
      : groups.flatMap((g) => Array.isArray(g?.items) ? g.items : [])
          .filter((it) => String(it?.categoryKey || "").toLowerCase() === activeCategory);
  }

  const seen = new Set();
  state.items = (direct.length ? direct : fromGroups).filter((it) => {
    const key = String(it?.id || it?.name || Math.random());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  stopLoading();
  applyFiltersAndRenderGrid();
  maybeOpenPreviewFromUrl();
}

async function downloadViaFetch(url, filename, opts = {}) {
  const button = opts.button;
  const original = button?.textContent;
  if (button) { button.setAttribute("aria-busy", "true"); button.textContent = "DOWNLOADING..."; }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "art";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    if (button) button.textContent = "DONE";
  } catch {
    if (opts.fallbackUrl) window.open(opts.fallbackUrl, "_blank", "noopener");
    if (button) button.textContent = "OPEN DRIVE";
  } finally {
    if (button) setTimeout(() => { button.removeAttribute("aria-busy"); button.textContent = original || button.textContent; }, 1000);
  }
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
  await loadDataAndRender();
});

initMobileNav();
loadCategories()
  .then(loadDataAndRender)
  .catch((err) => {
    console.error("Art gallery failed to initialize", err);
    els.count.textContent = "0 shown";
    els.grid.innerHTML = '<div class="empty-state">NO ART FILES FOUND.</div>';
  });
