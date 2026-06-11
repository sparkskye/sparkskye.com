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

const state = {
  category: getUrlParam("category", "all"),
  q: getUrlParam("q", ""),
  previewId: getUrlParam("preview", ""),
  categories: [],
  items: [],
  filtered: [],
  lastFocus: null,
  lastNonPreviewUrl: "",
};

function clearNode(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function formatList(it) { return (it.formats || []).map((f) => f.label || f.key).join(" • "); }
function extFor(file) { return String(file?.ext || file?.key || "file").replace(/^\./, "").toLowerCase(); }
function filenameFor(it, file) { const ext = extFor(file); return `${slugify(it.name) || "design"}.${ext}`; }

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

function applyFiltersAndRenderGrid() {
  const q = String(state.q || "").trim().toLowerCase();
  const items = state.items
    .filter((it) => !q || (it.name || "").toLowerCase().includes(q) || (it.categoryLabel || "").toLowerCase().includes(q) || formatList(it).toLowerCase().includes(q))
    .sort((a, b) => (a.categoryLabel || "").localeCompare(b.categoryLabel || "") || (a.name || "").localeCompare(b.name || ""));
  state.filtered = items;
  els.count.textContent = `${items.length} shown`;
  renderGrid(items);
}

function renderGrid(items) {
  els.grid.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "NO DESIGN FILES FOUND. MAKE SURE THE DRIVE FOLDERS ARE SHARED PUBLICLY, THEN REDEPLOY/REFRESH.";
    els.grid.appendChild(empty);
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card card--media card--design";
    card.tabIndex = 0;

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";
    if (it.thumbId || it.imageId) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = it.name || "Design preview";
      img.src = it.thumbnailUrl || fileViewUrl(it.thumbId || it.imageId);
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
    path.textContent = formatList(it) || "NO DOWNLOADS";
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
  if (state.q) url.searchParams.set("q", state.q);
  url.searchParams.set("preview", it.id);
  return url.toString();
}

function showImagePreview(it) {
  els.modalViewer.innerHTML = "";
  if (it.imageId || it.thumbId) {
    const img = document.createElement("img");
    img.alt = it.name || "Design preview";
    img.src = it.thumbnailUrl || fileViewUrl(it.imageId || it.thumbId);
    els.modalViewer.appendChild(img);
    return;
  }
  if (it.timelapseId && it.files?.timelapse?.drivePreviewUrl) {
    showTimelapsePreview(it);
    return;
  }
  els.modalViewer.innerHTML = '<div class="viewer__loading">NO PREVIEW AVAILABLE</div>';
}

function showTimelapsePreview(it) {
  els.modalViewer.innerHTML = "";
  const iframe = document.createElement("iframe");
  const file = it.files?.timelapse || (it.formats || []).find((f) => f.key === "timelapse");
  iframe.src = file?.drivePreviewUrl || `https://drive.google.com/file/d/${it.timelapseId}/preview`;
  iframe.allow = "autoplay; fullscreen";
  iframe.allowFullscreen = true;
  iframe.title = `${it.name || "Design"} timelapse`;
  els.modalViewer.appendChild(iframe);
}

function addActionButton(label, onClick, primary = false) {
  const b = document.createElement("button");
  b.className = `btn ${primary ? "btn--primary" : ""}`.trim();
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  els.modalActions.appendChild(b);
  return b;
}

function addDownloadButton(it, file, primary = false) {
  const a = document.createElement("a");
  a.className = `btn ${primary ? "btn--primary" : ""}`.trim();
  a.href = trackedDownloadUrl(file.fileId, slugify(it.name) || "design", extFor(file), {
    kind: `design-${file.key}`,
    asset: it.name,
    path: it.categoryLabel || "design",
    label: file.label || file.key,
  });
  a.download = filenameFor(it, file);
  a.textContent = `DOWNLOAD .${extFor(file).toUpperCase()}`;
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
  els.modalPath.textContent = `${it.categoryLabel || "DESIGN"} • ${formatList(it) || "NO DOWNLOADS"}`;
  clearNode(els.modalActions);
  showImagePreview(it);

  if (it.imageId || it.thumbId) addActionButton("IMAGE PREVIEW", () => showImagePreview(it), false);
  if (it.timelapseId) addActionButton("PREVIEW TIMELAPSE", () => showTimelapsePreview(it), false);

  const formats = it.formats || [];
  formats.forEach((file, idx) => addDownloadButton(it, file, idx === 0));

  addActionButton("FULL SCREEN", async () => {
    try { await els.modalViewer.requestFullscreen?.(); } catch {}
  }, false);
  addActionButton("COPY LINK", async (ev) => {
    await copyToClipboard(previewLink);
    ev.currentTarget.textContent = "COPIED!";
    setTimeout(() => (ev.currentTarget.textContent = "COPY LINK"), 900);
  }, false);
}

function closeModal(opts = {}) {
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

function showLoading() {
  els.grid.innerHTML = '<div class="grid__loading">LOADING...</div>';
}

async function loadCategories() {
  const res = await fetchDesignCategories().catch(() => ({ categories: [] }));
  state.categories = Array.isArray(res?.categories) ? res.categories : [];
  if (!state.categories.length) state.categories = [{ key: "thumbnails", label: "THUMBNAILS" }];
  renderCategoryChips();
}

async function loadDataAndRender() {
  showLoading();
  const res = await fetchDesignItems(state.category).catch(() => ({ items: [], groups: [] }));
  const direct = Array.isArray(res?.items) ? res.items : [];
  const fromGroups = [];
  for (const g of res?.groups || []) {
    if ((g.key || "").toLowerCase() === "all") continue;
    for (const it of g.items || []) fromGroups.push(it);
  }
  state.items = direct.length ? direct : fromGroups;
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
  state.q = getUrlParam("q", "");
  els.search.value = state.q;
  if (!getUrlParam("preview", "") && els.modal.classList.contains("is-open")) closeModal({ skipUrlRestore: true });
  renderCategoryChips();
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
