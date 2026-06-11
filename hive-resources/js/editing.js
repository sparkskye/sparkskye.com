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
  sortChips: qs("#sortChips"),
  search: qs("#searchInput"),
  count: qs("#countLabel"),
  grid: qs("#grid"),
  modal: qs("#modal"),
  modalBackdrop: qs("#modalBackdrop"),
  modalClose: qs("#modalClose"),
  modalViewer: qs("#modalViewer"),
  modalLoading: qs("#modalLoading"),
  modalName: qs("#modalName"),
  modalStats: qs("#modalStats"),
  modalPath: qs("#modalPath"),
  modalWatch: qs("#modalWatch"),
  modalFullscreen: qs("#modalFullscreen"),
  modalCopy: qs("#modalCopy"),
};

const SORTS = [
  { key: "date", label: "NEWEST" },
  { key: "views", label: "MOST VIEWED" },
  { key: "az", label: "A-Z" },
];

const state = {
  sort: getUrlParam("sort", "date"),
  q: getUrlParam("q", ""),
  previewId: getUrlParam("preview", ""),
  items: [],
  filtered: [],
  lastFocus: null,
  lastNonPreviewUrl: "",
};

function clearNode(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function nfmt(n) { return n == null || Number.isNaN(Number(n)) ? "—" : new Intl.NumberFormat("en-US", { notation: Number(n) >= 100000 ? "compact" : "standard" }).format(Number(n)); }
function dateValue(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }
function textDate(iso) {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso)); }
  catch { return ""; }
}

function makeChip({ label, active, onClick }) {
  const b = document.createElement("button");
  b.className = `chip ${active ? "is-active" : ""}`.trim();
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
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
  let items = state.items.filter((it) => !q || (it.title || "").toLowerCase().includes(q));
  items = sortItems(items);
  state.filtered = items;
  els.count.textContent = `${items.length} shown`;
  renderGrid(items);
}

function stat(label, value) {
  const s = document.createElement("span");
  s.className = "card__stat";
  s.textContent = `${label}: ${value}`;
  return s;
}

function renderGrid(items) {
  els.grid.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "NO VIDEOS FOUND. IF THIS STAYS EMPTY, THE YOUTUBE CHANNEL RSS/API MAY NEED A REDEPLOY OR API KEY.";
    els.grid.appendChild(empty);
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card card--media";
    card.tabIndex = 0;

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = it.title || "Video thumbnail";
    img.src = it.thumbnail || `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`;
    viewer.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "card__meta";
    const nameRow = document.createElement("div");
    nameRow.className = "card__top";
    const name = document.createElement("h2");
    name.className = "card__name";
    name.textContent = it.title || "Untitled video";
    nameRow.appendChild(name);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = it.duration || "VIDEO";
    nameRow.appendChild(badge);

    const stats = document.createElement("div");
    stats.className = "card__stats";
    stats.appendChild(stat("views", nfmt(it.viewCount)));
    if (it.likeCount != null) stats.appendChild(stat("likes", nfmt(it.likeCount)));
    stats.appendChild(stat("date", it.publishedLabel || textDate(it.publishedAt) || "—"));

    meta.appendChild(nameRow);
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
  if (state.sort && state.sort !== "date") url.searchParams.set("sort", state.sort);
  if (state.q) url.searchParams.set("q", state.q);
  return url.toString();
}

function renderModalStats(it) {
  clearNode(els.modalStats);
  const stats = [
    ["views", nfmt(it.viewCount)],
    ["likes", nfmt(it.likeCount)],
    ["comments", nfmt(it.commentCount)],
    ["date", it.publishedLabel || textDate(it.publishedAt) || "—"],
    ["length", it.duration || "—"],
  ];
  for (const [label, value] of stats) {
    const el = document.createElement("span");
    el.className = "modal__stat";
    el.textContent = `${label}: ${value}`;
    els.modalStats.appendChild(el);
  }
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

  els.modalName.textContent = it.title || "Untitled video";
  els.modalPath.textContent = it.statsReady ? "YOUTUBE VIDEO" : "YOUTUBE VIDEO • BASIC RSS DATA";
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
    await copyToClipboard(previewLink);
    els.modalCopy.textContent = "COPIED!";
    setTimeout(() => (els.modalCopy.textContent = "COPY LINK"), 900);
  };
}

function closeModal(opts = {}) {
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
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

function showLoading() {
  els.grid.innerHTML = '<div class="grid__loading">LOADING...</div>';
}

async function loadDataAndRender() {
  showLoading();
  renderSortChips();
  const json = await fetchEditingVideos(state.sort).catch((err) => ({ items: [], error: err.message }));
  state.items = Array.isArray(json?.items) ? json.items : [];
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
  state.sort = getUrlParam("sort", "date");
  state.q = getUrlParam("q", "");
  els.search.value = state.q;
  if (!getUrlParam("preview", "") && els.modal.classList.contains("is-open")) closeModal({ skipUrlRestore: true });
  await loadDataAndRender();
});

initMobileNav();
loadDataAndRender();
