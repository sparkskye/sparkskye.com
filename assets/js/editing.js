import { fetchEditingVideos } from "./api.js";
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
  typeChips: qs("#typeChips"),
  sortChips: qs("#sortChips"),
  search: qs("#searchInput"),
  count: qs("#countLabel"),
  grid: qs("#grid"),
  modal: qs("#modal"),
  modalBackdrop: qs("#modalBackdrop"),
  modalClose: qs("#modalClose"),
  modalViewer: qs("#modalViewer"),
  modalName: qs("#modalName"),
  modalStats: qs("#modalStats"),
  modalPath: qs("#modalPath"),
  modalWatch: qs("#modalWatch"),
  modalFullscreen: qs("#modalFullscreen"),
  modalCopy: qs("#modalCopy"),
};

const TYPES = [
  { key: "videos", label: "VIDEOS", matches: ["video"] },
  { key: "shorts", label: "SHORTS", matches: ["short"] },
  { key: "live", label: "LIVESTREAMS", matches: ["live", "livestream"] },
];

const SORTS = [
  { key: "date", label: "NEWEST" },
  { key: "views", label: "MOST VIEWED" },
  { key: "az", label: "A-Z" },
];

const state = {
  type: getUrlParam("type", "videos"),
  sort: getUrlParam("sort", "date"),
  q: getUrlParam("q", ""),
  previewId: getUrlParam("preview", ""),
  items: [],
  filtered: [],
  lastFocus: null,
  lastNonPreviewUrl: "",
};

let gridLoadingStop = null;


function clearNode(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function nfmt(n) { return n == null || Number.isNaN(Number(n)) ? "—" : new Intl.NumberFormat("en-US", { notation: Number(n) >= 100000 ? "compact" : "standard" }).format(Number(n)); }
function dateValue(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }
function shortDate(iso) {
  if (!iso) return "—";
  try { return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(iso)); }
  catch { return "—"; }
}
function itemType(it) {
  const raw = String(it.youtubeTab || it.type || it.kind || "video").toLowerCase();
  if (raw.includes("live") || raw.includes("stream")) return "live";
  if (raw.includes("short")) return "short";

  const w = Number(it.thumbnailWidth || 0);
  const h = Number(it.thumbnailHeight || 0);
  const seconds = Number(it.durationSeconds || 0);
  const portrait = w > 0 && h > 0 && h > w * 1.15;

  // Emergency fallback only. Do not classify by duration alone.
  if (portrait && seconds > 0 && seconds <= 180) return "short";
  return "video";
}
function cardLine(it) { return `${nfmt(it.viewCount)} views, ${shortDate(it.publishedAt)}`; }
function thumbRatio(it) {
  const type = itemType(it);
  const ratio = String(it.thumbnailAspectRatio || "").trim();
  if (/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(ratio)) return ratio;
  const w = Number(it.thumbnailWidth || 0);
  const h = Number(it.thumbnailHeight || 0);
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return type === "short" ? "9 / 16" : "16 / 9";
}
function thumbnailUrl(it) {
  const type = itemType(it);
  if (type === "short" && it.shortThumbnail) return it.shortThumbnail;
  return it.thumbnail || `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`;
}

function makeChip({ label, active, onClick }) {
  const b = document.createElement("button");
  b.className = `chip ${active ? "is-active" : ""}`.trim();
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function renderTypeChips() {
  clearNode(els.typeChips);
  for (const type of TYPES) {
    els.typeChips.appendChild(makeChip({
      label: type.label,
      active: state.type === type.key,
      onClick: () => {
        if (state.type === type.key) return;
        state.type = type.key;
        setUrlParam("type", state.type);
        renderTypeChips();
        applyFiltersAndRenderGrid();
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
  const arr = [...items];
  if (state.sort === "views") return arr.sort((a, b) => (Number(b.viewCount) || 0) - (Number(a.viewCount) || 0) || dateValue(b.publishedAt) - dateValue(a.publishedAt));
  if (state.sort === "az") return arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  return arr.sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
}

function applyFiltersAndRenderGrid() {
  const q = String(state.q || "").trim().toLowerCase();
  const selectedType = TYPES.find((t) => t.key === state.type) || TYPES[0];
  let items = state.items.filter((it) => selectedType.matches.includes(itemType(it)));
  items = items.filter((it) => !q || (it.title || "").toLowerCase().includes(q));
  items = sortItems(items);
  state.filtered = items;
  els.count.textContent = `${items.length} shown`;
  renderGrid(items);
}

function renderGrid(items) {
  els.grid.innerHTML = "";

  if (!items.length) {
    const selected = TYPES.find((t) => t.key === state.type)?.label || "VIDEOS";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = `NO ${selected} FOUND.`;
    els.grid.appendChild(empty);
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    const type = itemType(it);
    card.className = `card card--media card--${type}`;
    card.tabIndex = 0;
    card.style.setProperty("--thumb-ratio", thumbRatio(it));

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";
    const img = document.createElement("img");
    img.className = "card__thumb";
    img.loading = "lazy";
    img.alt = it.title || "Video thumbnail";
    img.src = thumbnailUrl(it);
    img.addEventListener("error", () => {
      const fallback = it.thumbnail || `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`;
      if (img.src !== fallback) img.src = fallback;
    }, { once: true });
    viewer.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "card__meta";
    const name = document.createElement("h2");
    name.className = "card__name";
    name.textContent = it.title || "Untitled video";

    const stats = document.createElement("div");
    stats.className = "card__stats";
    const line = document.createElement("span");
    line.className = "card__stat";
    line.textContent = cardLine(it);
    stats.appendChild(line);

    meta.appendChild(name);
    meta.appendChild(stats);
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
  const url = new URL(`${window.location.origin}/editing/`);
  url.searchParams.set("preview", it.id);
  return url.toString();
}

function buildShareLink(it) {
  // Clean preview URL; the Pages Function serves embed metadata to social bots.
  return buildPreviewLink(it);
}

function renderModalStats(it) {
  clearNode(els.modalStats);
  const stats = [
    ["views", nfmt(it.viewCount)],
    ["likes", nfmt(it.likeCount)],
    ["comments", nfmt(it.commentCount)],
    ["date", shortDate(it.publishedAt)],
    ["length", it.duration || "—"],
  ];
  for (const [label, value] of stats) {
    const el = document.createElement("span");
    el.className = "modal__stat";
    el.textContent = `${label}: ${value}`;
    els.modalStats.appendChild(el);
  }
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
    els.modal.classList.add('lp-theater', 'lp-preview-active', 'lp-theater-used');
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

  els.modalName.textContent = it.title || "Untitled video";
  els.modalPath.textContent = "";
  els.modalWatch.href = it.url || `https://www.youtube.com/watch?v=${it.id}`;
  renderModalStats(it);

  els.modalViewer.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.src = `${it.embedUrl || `https://www.youtube.com/embed/${it.id}`}?rel=0`;
  iframe.title = it.title || "YouTube video";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  els.modalViewer.appendChild(iframe);

  els.modalFullscreen.onclick = async () => {
    const target = iframe || els.modalViewer;
    try { await target.requestFullscreen?.(); } catch { window.open(it.url, "_blank", "noopener"); }
  };

  els.modalCopy.onclick = async () => {
    await copyToClipboard(buildShareLink(it));
    els.modalCopy.textContent = "COPIED!";
    setTimeout(() => (els.modalCopy.textContent = "COPY LINK"), 900);
  };
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
  els.modal.classList.remove('lp-theater-used');
  els.modal.setAttribute("aria-hidden", "true");
  els.modalViewer.innerHTML = '<div class="viewer__loading" id="modalLoading">Loading...</div>';
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

async function loadDataAndRender() {
  showLoading();
  renderTypeChips();
  renderSortChips();
  const json = await fetchEditingVideos(state.sort).catch((err) => ({ items: [], error: err.message }));
  state.items = Array.isArray(json?.items) ? json.items : [];
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
  state.type = getUrlParam("type", "videos");
  state.sort = getUrlParam("sort", "date");
  state.q = getUrlParam("q", "");
  els.search.value = state.q;
  if (!getUrlParam("preview", "") && els.modal.classList.contains("is-open")) closeModal({ skipUrlRestore: true });
  await loadDataAndRender();
});

initMobileNav();
loadDataAndRender();

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
// Gallery swipes start only OUTSIDE the content viewer. Inside the viewer,
// one-finger panning and two-finger pinching always belong to the media.
let gallerySwipe = null;
els.modal.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !els.modal.classList.contains('is-open')) return;
  if (els.modalViewer.contains(e.target) || e.target.closest('button,a,input,video,iframe')) return;
  gallerySwipe = {id:e.pointerId,x:e.clientX,y:e.clientY};
}, true);
els.modal.addEventListener('pointerup', e => {
  if (!gallerySwipe || gallerySwipe.id !== e.pointerId) return;
  const dx=e.clientX-gallerySwipe.x, dy=e.clientY-gallerySwipe.y;
  gallerySwipe=null;
  if (Math.abs(dx)>64 && Math.abs(dx)>Math.abs(dy)*1.35)
    navigateGalleryItem(dx<0?1:-1);
}, true);
els.modal.addEventListener('pointercancel', e => {
  if (gallerySwipe?.id===e.pointerId) gallerySwipe=null;
}, true);
