import { fetchAnimationCategories, fetchAnimationItems, trackedDownloadUrl, driveBrowserDownloadUrl } from "./api.js";
import {
  qs,
  debounce,
  setUrlParam,
  getUrlParam,
  copyToClipboard,
  confirmRestrictedAssetDownload,
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
  { key: "file-size", label: "FILE SIZE" },
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
let activePreview = "video";
let videoPreviewButton = null;

function clearNode(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function extFor(file) { return String(file?.ext || file?.key || "file").replace(/^\./, "").toLowerCase(); }
function filenameFor(it, file) {
  const ext = extFor(file);
  const base = slugify(file?.downloadName || it.name || "animation");
  return `${base || "animation"}.${ext}`;
}
function dateValue(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }
function numberValue(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function videoFile(it) { return it.files?.video || (it.formats || []).find((f) => f.key === "video"); }
function inlineFileUrl(file) {
  const params = new URLSearchParams();
  params.set("id", file.fileId || file.id || "");
  params.set("inline", "1");
  if (file.name) params.set("name", file.name);
  if (file.ext) params.set("ext", extFor(file));
  return `/api/file?${params.toString()}`;
}
function formatList(it) {
  const preferred = ["video", "blend"];
  const files = it.files || {};
  return preferred
    .filter((key) => files[key])
    .concat((it.formats || []).map((f) => f.key).filter((key) => key && ![...preferred, "thumbnail"].includes(key)))
    .filter((key, idx, arr) => arr.indexOf(key) === idx)
    .map((key) => String(key).toLowerCase())
    .join(", ");
}
function thumbRatio(it) {
  const w = Number(it.thumbnailWidth || it.files?.thumbnail?.width || it.videoWidth || it.files?.video?.width || 0);
  const h = Number(it.thumbnailHeight || it.files?.thumbnail?.height || it.videoHeight || it.files?.video?.height || 0);
  return w > 0 && h > 0 ? `${w} / ${h}` : "16 / 9";
}
function thumbnailUrl(it) {
  return it.files?.thumbnail?.previewUrl || it.files?.thumbnail?.thumbnailUrl || it.thumbnailUrl || it.files?.video?.thumbnailUrl || "/public/img/favicon.png";
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
    label: "ALL ANIMATION",
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
  if (state.sort === "file-size") {
    return out.sort((a, b) =>
      numberValue(b.blendSize || b.files?.blend?.size || b.videoSize || b.files?.video?.size) - numberValue(a.blendSize || a.files?.blend?.size || a.videoSize || a.files?.video?.size) ||
      (a.name || "").localeCompare(b.name || "")
    );
  }
  return out.sort((a, b) =>
    dateValue(b.videoCreatedTime || b.files?.video?.createdTime || b.videoModifiedTime || b.files?.video?.modifiedTime) - dateValue(a.videoCreatedTime || a.files?.video?.createdTime || a.videoModifiedTime || a.files?.video?.modifiedTime) ||
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
    const empty = document.createElement("div");
    empty.className = q ? "empty-state empty-state--search" : "empty-state";
    empty.textContent = q ? "THERE ARE NO RESULTS FOR THAT SEARCH." : "NO ANIMATION FILES FOUND.";
    els.grid.appendChild(empty);
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card card--media card--animation";
    card.tabIndex = 0;
    card.style.setProperty("--thumb-ratio", thumbRatio(it));

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";
    const img = document.createElement("img");
    img.className = "card__thumb";
    img.loading = "lazy";
    img.alt = it.name || "Animation preview";
    img.src = thumbnailUrl(it);
    img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("div"), { className: "card__placeholder", textContent: "NO VIDEO PREVIEW" }));
    }, { once: true });
    viewer.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "card__meta";
    const name = document.createElement("h2");
    name.className = "card__name";
    name.textContent = it.name || "Untitled animation";

    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = formatList(it) || "video";

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
  const url = new URL(`${window.location.origin}/animations/`);
  url.searchParams.set("preview", it.id);
  return url.toString();
}
function buildShareLink(it) { return buildPreviewLink(it); }

function showVideoPreview(it) {
  els.modalViewer.innerHTML = "";
  const file = videoFile(it);
  if (!file) {
    els.modalViewer.innerHTML = '<div class="viewer__loading">NO VIDEO PREVIEW</div>';
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "timelapse-preview animation-preview";
  const video = document.createElement("video");
  video.className = "timelapse-preview__video animation-preview__video";
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.poster = thumbnailUrl(it);
  video.src = file.previewUrl || inlineFileUrl(file);
  video.title = it.name || "Animation preview";
  wrap.appendChild(video);
  els.modalViewer.appendChild(wrap);
}

function makeDownloadUrl(it, file) {
  return trackedDownloadUrl(file.fileId, slugify(it.name) || "animation", extFor(file), {
    kind: `animation-${file.key}`,
    asset: it.name,
    path: it.categoryLabel || "animation",
    label: file.label || file.key,
  });
}
async function downloadFile(it, file, button) {
  if (!file) return;
  if (!confirmRestrictedAssetDownload(it)) return;
  await downloadViaFetch(makeDownloadUrl(it, file), filenameFor(it, file), {
    button,
    fallbackUrl: driveBrowserDownloadUrl(file.fileId),
  });
}
function updatePreviewButtons() {
  if (videoPreviewButton) {
    const selected = activePreview === "video";
    videoPreviewButton.classList.toggle("is-selected", selected);
    videoPreviewButton.textContent = selected ? "DOWNLOAD VIDEO" : "VIDEO";
  }
}
function addVideoPreviewButton(it) {
  const file = videoFile(it);
  if (!file) return null;
  const b = document.createElement("button");
  b.className = "btn btn--preview";
  b.type = "button";
  b.addEventListener("click", async () => {
    if (activePreview === "video") {
      await downloadFile(it, videoFile(it), b);
      updatePreviewButtons();
      return;
    }
    activePreview = "video";
    showVideoPreview(it);
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

let currentGalleryItem = null, galleryNavigationBusy = false, modalCloseTimer = 0;
let itemMotion = null;
function stopItemMotion() { itemMotion?.cancel(); itemMotion = null; }
function exitTheater() { els.modal.classList.remove('lp-theater'); }
(function addTheaterControl(){
  const card = els.modal.querySelector('.modal__card');
  const viewer = els.modalViewer;
  const enter = document.createElement('button');
  enter.className = 'lp-theater-enter';
  enter.type = 'button';
  enter.title = 'Fullscreen';
  enter.setAttribute('aria-label', 'Fullscreen');
  enter.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>';
  enter.addEventListener('click', e => {
    e.stopPropagation();
    els.modal.classList.add('lp-theater', 'lp-preview-active');
  });
  // File and item changes recreate the viewer. Reattach the overlay afterward.
  const exit = document.createElement('button');
  exit.className = 'lp-theater-exit';
  exit.type = 'button';
  exit.title = 'Exit fullscreen';
  exit.setAttribute('aria-label', 'Exit fullscreen');
  exit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9h6V3M21 9h-6V3M21 15h-6v6M3 15h6v6"/></svg>';
  exit.addEventListener('click', e => { e.stopPropagation(); exitTheater(); });
  const keepInsideViewer = () => {
    let toolbar = viewer.querySelector(':scope > .lp-preview-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'lp-preview-toolbar';
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', 'Preview controls');
      viewer.appendChild(toolbar);
    }
    // The pan/zoom viewer is rebuilt for each image. Move its accessible
    // controls into the stable toolbar without recreating the handlers.
    const panzoom = viewer.querySelector('.shared-panzoom-preview');
    const dimensions = panzoom?.querySelector('.map-preview__resolution');
    const zoom = panzoom?.querySelector('.map-preview__controls');
    if (dimensions && dimensions.parentNode !== toolbar) {
      toolbar.insertBefore(dimensions, toolbar.firstChild);
    }
    if (zoom && zoom.parentNode !== toolbar) {
      toolbar.insertBefore(zoom, enter.parentNode === toolbar ? enter : null);
    }
    if (enter.parentNode !== toolbar) toolbar.appendChild(enter);
    if (exit.parentNode !== toolbar) toolbar.appendChild(exit);
  };
  keepInsideViewer();
  new MutationObserver(keepInsideViewer).observe(viewer, { childList: true });
  // Exit fullscreen reuses the centered toolbar control slot.
})();
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && els.modal.classList.contains('lp-theater')) {
    e.preventDefault(); e.stopImmediatePropagation(); exitTheater();
  }
}, true);
function openModal(it, opts = {}) {
  clearTimeout(modalCloseTimer);
  els.modal.classList.remove('is-closing');
  currentGalleryItem=it;
  const wasOpen = els.modal.classList.contains("is-open");
  if (!wasOpen) state.lastNonPreviewUrl = getPreviewlessHref();
  const previewLink = buildPreviewLink(it);

  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  if (!wasOpen) state.lastFocus = document.activeElement;
  try { els.modalClose?.focus?.(); } catch {}
  lockBodyScroll();
  if (!opts.skipUrlUpdate) history.replaceState({}, "", previewLink);

  els.modalName.textContent = it.name || "Untitled animation";
  els.modalPath.textContent = formatList(it) || "video";
  clearNode(els.modalActions);

  activePreview = "video";
  showVideoPreview(it);
  videoPreviewButton = addVideoPreviewButton(it);
  updatePreviewButtons();

  for (const key of ["blend"]) {
    if (it.files?.[key]) addDownloadButton(it, it.files[key], `DOWNLOAD .${key.toUpperCase()}`);
  }
  for (const f of it.formats || []) {
    if (["video", "blend"].includes(f.key) || !it.files?.[f.key]) continue;
    addDownloadButton(it, it.files[f.key], `DOWNLOAD .${String(f.ext || f.key).toUpperCase()}`);
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
  stopItemMotion();
  if (els.modal.classList.contains('lp-theater')) { exitTheater(); return; }
  if (!opts.afterAnimation && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (els.modal.classList.contains('is-closing')) return;
    els.modal.classList.add('is-closing');
    modalCloseTimer=setTimeout(()=>closeModal({...opts,afterAnimation:true}),360);
    return;
  }
  els.modal.classList.remove('is-closing');
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalViewer.innerHTML = '<div class="viewer__loading" id="modalLoading">Loading...</div>';
  unlockBodyScroll();
  videoPreviewButton = null;
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
  const res = await fetchAnimationCategories().catch(() => ({ categories: [] }));
  state.categories = Array.isArray(res?.categories) ? res.categories : [];
  if (!state.categories.length) state.categories = [{ key: "blender", label: "BLENDER" }];
  renderCategoryChips();
}
async function loadDataAndRender() {
  showLoading();
  renderSortChips();
  const res = await fetchAnimationItems(state.category).catch(() => ({ items: [], groups: [] }));
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
  await loadDataAndRender();
});

async function downloadViaFetch(url, filename, opts = {}) {
  const button = opts.button;
  const original = button?.textContent;
  if (button) {
    button.setAttribute("aria-busy", "true");
    button.textContent = "DOWNLOADING...";
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "animation";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    if (button) button.textContent = "DONE";
  } catch (err) {
    if (opts.fallbackUrl) window.open(opts.fallbackUrl, "_blank", "noopener");
    if (button) button.textContent = "OPEN DRIVE";
  } finally {
    if (button) {
      setTimeout(() => {
        button.removeAttribute("aria-busy");
        button.textContent = original || button.textContent;
        updatePreviewButtons();
      }, 1000);
    }
  }
}

initMobileNav();
loadCategories().then(loadDataAndRender);

// Navigate the currently filtered gallery; variations remain on their own buttons.
function navigateGalleryItem(direction) {
  if (!els.modal.classList.contains('is-open') || els.modal.classList.contains('is-closing')) return;
  const index = state.filtered.findIndex(it => it.id === currentGalleryItem?.id);
  const next = state.filtered[index + direction];
  if (index < 0 || !next) return;
  const rapid = Boolean(itemMotion);
  stopItemMotion();
  openModal(next);
  if (rapid || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Move the preview content, not the modal window. Fast input cancels motion.
  const distance = direction * 78;
  const frames = [
    { transform: `translateX(${distance}px)`, opacity: .18, offset: 0 },
    { transform: `translateX(${-direction * 6}px)`, opacity: 1, offset: .8 },
    { transform: 'translateX(0px)', opacity: 1, offset: 1 }
  ];
  const settings = { duration: 340, easing: 'cubic-bezier(.16,.82,.3,1)', fill: 'both' };
  const viewerMotion = els.modalViewer.animate(frames, settings);
  const metaMotion = els.modal.querySelector('.modal__meta').animate(frames, {...settings,duration:370});
  const pair = { cancel: () => { viewerMotion.cancel(); metaMotion.cancel(); } };
  itemMotion = pair;
  metaMotion.onfinish = () => {
    if (itemMotion === pair) {
      pair.cancel();
      itemMotion = null;
    }
  };
}

window.addEventListener('keydown',e=>{
  if(e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input,textarea,select,[contenteditable=true]')) return;
  if(els.modal.classList.contains('is-open') && ['ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault(); navigateGalleryItem(e.key==='ArrowRight'?1:-1);
  }
});
let gallerySwipe=null;
els.modal.addEventListener('pointerdown',e=>{
  if(e.pointerType!=='touch' || e.target.closest('button,a,input,video,iframe')) return;
  gallerySwipe={x:e.clientX,y:e.clientY,id:e.pointerId};
},true);
els.modal.addEventListener('pointerup',e=>{
  if (!gallerySwipe || gallerySwipe.id!==e.pointerId) return;
  const dx=e.clientX-gallerySwipe.x, dy=e.clientY-gallerySwipe.y; gallerySwipe=null;
  if(Math.abs(dx)>56 && Math.abs(dx)>Math.abs(dy)*1.35) navigateGalleryItem(dx<0?1:-1);
},true);
els.modal.addEventListener('pointercancel',()=>gallerySwipe=null,true);
