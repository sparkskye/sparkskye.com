import { fetchModels, fetchModelGames, fileViewUrl, trackedDownloadUrl, driveBrowserDownloadUrl } from "./api.js";
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
import { CardPreview, ModalPreview } from "./preview3d.js";

const MAX_CARD_LOAD_CONCURRENCY = 4;

const els = {
  gameChips: qs("#gameChips"),
  folderChips: qs("#folderChips"),
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
  modalCopy: qs("#modalCopy"),
};

const state = {
  games: [],
  game: slugify(getUrlParam("game", "")),
  folder: String(getUrlParam("folder", "all") || "all").toLowerCase(),
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

const modalPreview = new ModalPreview(els.modalViewer);
const liveCardPreviews = new Map();
const queuedCards = new Set();
const loadingCards = new Set();
const previewQueue = [];
let io = null;
let gridLoadingEl = null;
let gridLoadingStop = null;

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeGameLabel(key) {
  return titleCase(key).toUpperCase();
}

function buildPathText(gameKey, folderLabel) {
  const g = (gameKey || "").toUpperCase();
  const p = String(folderLabel || "")
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

function parseGameList(raw) {
  const arr = Array.isArray(raw?.games) ? raw.games : Array.isArray(raw) ? raw : [];
  return arr
    .map((g) => {
      if (typeof g === "string") {
        const key = slugify(g);
        return key ? { key, label: normalizeGameLabel(g) } : null;
      }

      if (g && typeof g === "object") {
        const labelCandidate =
          (typeof g.label === "string" ? g.label : "") ||
          (typeof g.name === "string" ? g.name : "") ||
          (typeof g.title === "string" ? g.title : "") ||
          (typeof g.key === "string" ? g.key : "") ||
          (typeof g.slug === "string" ? g.slug : "");

        const key = slugify(String(g.key || g.slug || labelCandidate || ""));
        const label = normalizeGameLabel(String(labelCandidate || key || ""));
        return key ? { key, label } : null;
      }

      return null;
    })
    .filter(Boolean);
}

function mergeGameLists(...lists) {
  const out = [];
  const seen = new Set();

  for (const list of lists) {
    for (const g of list || []) {
      const key = slugify(g?.key || g?.label || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: normalizeGameLabel(g.label || key) });
    }
  }

  return out;
}

async function loadGameListIfNeeded() {
  const fallback = parseGameList(window.__HIVE_GAMES);
  const manual = [{ key: "replay-cinema", label: "REPLAY CINEMA" }];

  try {
    const res = await fetchModelGames();
    const fromApi = parseGameList(res);

    // If the API/Apps Script returns a real folder list, use it.
    // If not, keep the current fallback list so the existing model tags do not disappear.
    state.games = fromApi.length >= 4
      ? mergeGameLists(fromApi, manual)
      : mergeGameLists(fallback, fromApi, manual);
    return;
  } catch {
    state.games = mergeGameLists(fallback, manual);
  }
}

function renderGameChips() {
  clearNode(els.gameChips);

  const games = state.games.length
    ? state.games
    : [{ key: state.game || "bedwars", label: normalizeGameLabel(state.game || "bedwars") }];

  const sorted = [...games].sort((a, b) => a.label.localeCompare(b.label));

  for (const g of sorted) {
    const active = g.key === state.game;
    els.gameChips.appendChild(makeChip({
      label: g.label,
      active,
      onClick: async () => {
        if (state.game === g.key) return;
        state.game = g.key;
        setUrlParam("game", state.game);
        renderGameChips();
        loadDataAndRender();
      },
    }));
  }
}

function folderKeyFromGroup(group) {
  return String(group.key || slugify(group.label) || "").toLowerCase();
}

function renderFolderChips(groups) {
  clearNode(els.folderChips);

  els.folderChips.appendChild(makeChip({
    label: "ALL MODELS",
    active: (state.folder || "all") === "all",
    extraClass: "chip--folder",
    onClick: () => {
      if (state.folder === "all") return;
      state.folder = "all";
      setUrlParam("folder", state.folder);
      renderFolderChips(state.groups);
      applyFiltersAndRenderGrid();
    },
  }));

  for (const grp of groups) {
    if ((grp.key || "").toLowerCase() === "all") continue;
    const key = folderKeyFromGroup(grp);
    const label = (grp.label || key).toUpperCase();
    const active = key === state.folder;

    els.folderChips.appendChild(makeChip({
      label,
      active,
      extraClass: "chip--folder",
      onClick: () => {
        if (state.folder === key) return;
        state.folder = key;
        setUrlParam("folder", state.folder);
        renderFolderChips(state.groups);
        applyFiltersAndRenderGrid();
      },
    }));
  }
}

function flattenItemsFromGroups(groups) {
  const out = [];
  const seen = new Set();

  for (const g of groups || []) {
    if ((g.key || "").toLowerCase() === "all") continue;

    const groupKey = folderKeyFromGroup(g);
    const groupLabel = g.label || groupKey;

    for (const it of g.items || []) {
      const modelId = it.modelId || it.id || it.fileId;
      const dedupeKey = modelId || `${it.name || ""}::${it.path || it.folderLabel || groupLabel || ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        name: it.name,
        modelId,
        relPath: it.path || it.folderLabel || groupLabel || "",
        folderKey: groupKey,
        folderLabel: it.folderLabel || groupLabel || "",
        ext: "gltf",
      });
    }
  }

  const allGroup = (groups || []).find((g) => (g.key || "").toLowerCase() === "all");
  for (const it of allGroup?.items || []) {
    const modelId = it.modelId || it.id || it.fileId;
    const dedupeKey = modelId || `${it.name || ""}::${it.path || it.folderLabel || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      name: it.name,
      modelId,
      relPath: it.path || it.folderLabel || "",
      folderKey: slugify(it.folderLabel || "") || "root",
      folderLabel: it.folderLabel || "",
      ext: "gltf",
    });
  }

  if (!out.length) {
    for (const it of allGroup?.items || []) {
      out.push({
        name: it.name,
        modelId: it.modelId || it.id || it.fileId,
        relPath: it.path || it.folderLabel || "",
        folderKey: slugify(it.folderLabel || "") || "all",
        folderLabel: it.folderLabel || "",
        ext: "gltf",
      });
    }
  }

  out.sort((a, b) => (a.name || "").localeCompare(b.name || "") || (a.relPath || "").localeCompare(b.relPath || ""));
  return out;
}

function applyFiltersAndRenderGrid() {
  const q = (state.q || "").trim().toLowerCase();
  const folder = (state.folder || "all").toLowerCase();

  const items = state.items.filter((it) => {
    const okFolder =
      folder === "all"
        ? true
        : it.folderKey === folder || slugify(it.folderLabel) === folder || (it.folderLabel || "").toLowerCase() === folder;

    if (!okFolder) return false;
    if (!q) return true;

    return (it.name || "").toLowerCase().includes(q) || (it.folderLabel || "").toLowerCase().includes(q);
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

function teardownCardPreviewSystem() {
  try { io?.disconnect(); } catch {}
  io = null;

  for (const preview of liveCardPreviews.values()) {
    try { preview.destroy(true); } catch {}
  }
  liveCardPreviews.clear();
  queuedCards.clear();
  loadingCards.clear();
  previewQueue.length = 0;
}

function queueCardPreview(card, opts = {}) {
  if (!card) return;
  if (!opts.force && card.dataset.previewLoaded === "1") return;
  if (loadingCards.has(card) || queuedCards.has(card)) return;

  queuedCards.add(card);
  if (opts.priority) previewQueue.unshift(card);
  else previewQueue.push(card);

  pumpPreviewQueue();
}

function pumpPreviewQueue() {
  while (loadingCards.size < MAX_CARD_LOAD_CONCURRENCY && previewQueue.length) {
    const card = previewQueue.shift();
    queuedCards.delete(card);
    if (!card || card.dataset.previewLoaded === "1" || loadingCards.has(card)) continue;
    loadCardPreview(card);
  }
}

async function loadCardPreview(card) {
  const viewer = card.querySelector(".card__viewer");
  const ph = viewer?.querySelector(".card__placeholder");
  const reload = viewer?.querySelector(".card__reload");
  const modelUrl = viewer?.dataset.modelUrl;
  if (!viewer || !modelUrl) return;

  loadingCards.add(card);
  const oldImg = viewer.querySelector("img.card__thumb--rendered");
  if (oldImg) oldImg.remove();

  if (reload) reload.style.display = "none";
  if (ph) {
    ph.style.display = "flex";
    if (card._phStop) card._phStop();
    card._phStop = startDotLoader(ph, "LOADING");
  }

  const preview = new CardPreview(viewer);
  liveCardPreviews.set(card, preview);

  try {
    await preview.init(modelUrl);
    const frozen = preview.freezeToImage();
    liveCardPreviews.delete(card);
    if (!frozen) throw new Error("Failed to freeze preview");

    card.dataset.failed = "";
    card.dataset.previewLoaded = "1";
    if (card._phStop) card._phStop();
    card._phStop = null;
    if (ph) {
      ph.style.display = "none";
      ph.textContent = "";
    }
    if (reload) reload.style.display = "none";
    try { io?.unobserve(card); } catch {}
  } catch {
    const live = liveCardPreviews.get(card);
    if (live) {
      try { live.destroy(true); } catch {}
      liveCardPreviews.delete(card);
    }
    card.dataset.failed = "1";
    card.dataset.previewLoaded = "";
    if (card._phStop) card._phStop();
    card._phStop = null;
    if (ph) {
      ph.style.display = "flex";
      ph.textContent = "PREVIEW FAILED";
    }
    if (reload) reload.style.display = "inline-flex";
  } finally {
    loadingCards.delete(card);
    pumpPreviewQueue();
  }
}

function renderGrid(items) {
  els.grid.innerHTML = "";
  teardownCardPreviewSystem();

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";

    const filename = `${slugify(it.name)}.gltf`;
    const trackedDownload = trackedDownloadUrl(it.modelId, slugify(it.name) || "model", "gltf", {
      kind: "model-gltf",
      asset: it.name,
      game: state.game,
      path: it.relPath || it.folderLabel || "",
    });
    const view = fileViewUrl(it.modelId);

    viewer.dataset.modelUrl = view;
    viewer.dataset.filename = filename;

    const ph = document.createElement("div");
    ph.className = "card__placeholder";
    ph.textContent = "";

    const reload = document.createElement("button");
    reload.className = "card__reload";
    reload.type = "button";
    reload.textContent = "RELOAD";
    reload.style.display = "none";

    viewer.appendChild(ph);
    viewer.appendChild(reload);

    const meta = document.createElement("div");
    meta.className = "card__meta";

    const nameRow = document.createElement("div");
    nameRow.className = "card__top";

    const name = document.createElement("a");
    name.className = "card__name";
    name.href = "#";
    name.textContent = it.name;
    name.addEventListener("click", async (ev) => {
      if (ev.currentTarget?.dataset?.downloadFallbackReady === "1") { ev.stopPropagation(); return; }
      ev.preventDefault();
      ev.stopPropagation();
      await downloadViaFetch(trackedDownload, filename, {
        button: name,
        fallbackUrl: it.modelId ? driveBrowserDownloadUrl(it.modelId) : "",
      });
    });

    nameRow.appendChild(name);

    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = buildPathText(state.game, it.relPath || it.folderLabel || "");

    meta.appendChild(nameRow);
    meta.appendChild(path);

    card.appendChild(viewer);
    card.appendChild(meta);

    card.addEventListener("click", (ev) => {
      if (ev.target === name || ev.target === reload) return;
      openModal(it);
    });

    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openModal(it);
      }
    });

    reload.addEventListener("click", (ev) => {
      if (ev.currentTarget?.dataset?.downloadFallbackReady === "1") { ev.stopPropagation(); return; }
      ev.preventDefault();
      ev.stopPropagation();
      card.dataset.failed = "";
      card.dataset.previewLoaded = "";
      queueCardPreview(card, { priority: true, force: true });
    });

    els.grid.appendChild(card);
  }

  io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      queueCardPreview(entry.target);
    }
  }, { root: null, threshold: 0.01, rootMargin: "480px 0px 480px 0px" });

  for (const card of els.grid.querySelectorAll(".card")) io.observe(card);
}

function getPreviewlessHref() {
  const u = new URL(window.location.href);
  u.searchParams.delete("preview");
  return u.toString();
}

function buildPreviewLink(it) {
  const url = new URL(`${window.location.origin}/hive-resources/models/`);
  url.searchParams.set("game", state.game);
  const folder = it.folderKey && it.folderKey !== "root" ? it.folderKey : "all";
  if (folder && folder !== "all") url.searchParams.set("folder", folder);
  url.searchParams.set("preview", it.modelId);
  return url.toString();
}

function buildShareLink(it) {
  const preview = new URL(buildPreviewLink(it));
  const url = new URL(`${window.location.origin}/share/models/${encodeURIComponent(it.modelId)}`);
  url.searchParams.set("go", `${preview.pathname}${preview.search}`);
  if (state.game) url.searchParams.set("game", state.game);
  if (it.folderKey && it.folderKey !== "root" && it.folderKey !== "all") url.searchParams.set("folder", it.folderKey);
  return url.toString();
}

function setModalDownloadStat(text, isOff = false) {
  if (!els.modalDownloads) return;
  els.modalDownloads.textContent = text;
  els.modalDownloads.classList.toggle("is-off", !!isOff);
}

async function refreshModalDownloadStat(modelId) {
  if (!modelId) {
    setModalDownloadStat("downloads: —", true);
    return;
  }

  const reqId = ++state.downloadCountRequest;
  setModalDownloadStat("downloads: ...", true);

  try {
    const stats = await fetchDownloadCount(modelId, "model-gltf");
    if (reqId !== state.downloadCountRequest) return;
    if (!stats?.enabled) {
      setModalDownloadStat("tracking off", true);
      return;
    }
    const count = Number(stats.count) || 0;
    setModalDownloadStat(`downloads: ${count}`, false);
  } catch {
    if (reqId !== state.downloadCountRequest) return;
    setModalDownloadStat("downloads unavailable", true);
  }
}

function bumpModalDownloadStat() {
  if (!els.modalDownloads) return;
  const match = els.modalDownloads.textContent.match(/(\d+)/);
  if (!match) return;
  const next = Number(match[1]) + 1;
  setModalDownloadStat(`downloads: ${next}`, false);
}

async function openModal(it, opts = {}) {
  const wasOpen = els.modal.classList.contains("is-open");
  if (!wasOpen) state.lastNonPreviewUrl = getPreviewlessHref();

  const previewLink = buildPreviewLink(it);
  state.previewId = it.modelId;
  state.activePreviewId = it.modelId;

  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  els.modalLoading.style.display = "flex";
  els.modalLoading.textContent = "Loading…";
  state.lastFocus = document.activeElement;
  try { els.modalClose?.focus?.(); } catch {}
  lockBodyScroll();

  if (!opts.skipUrlUpdate) history.replaceState({}, "", previewLink);

  const baseName = slugify(it.name) || "model";
  const filename = `${baseName}.gltf`;
  const dl = trackedDownloadUrl(it.modelId, baseName, "gltf", {
    kind: "model-gltf",
    asset: it.name,
    game: state.game,
    path: it.relPath || it.folderLabel || "",
  });
  const view = fileViewUrl(it.modelId);

  els.modalName.textContent = it.name;
  els.modalPath.textContent = buildPathText(state.game, it.relPath || it.folderLabel || "");
  els.modalDownload.href = dl;
  els.modalDownload.download = filename;
  els.modalDownload.onclick = async (ev) => {
    if (ev.currentTarget?.dataset?.downloadFallbackReady === "1") { ev.stopPropagation(); return; }
    ev.preventDefault();
    ev.stopPropagation();
    await downloadViaFetch(dl, filename, {
      button: els.modalDownload,
      fallbackUrl: it.modelId ? driveBrowserDownloadUrl(it.modelId) : "",
    });
  };

  els.modalCopy.onclick = async () => {
    await copyToClipboard(buildShareLink(it));
    els.modalCopy.textContent = "COPIED!";
    setTimeout(() => (els.modalCopy.textContent = "COPY LINK"), 900);
  };

  try {
    await modalPreview.open(view);
    els.modalLoading.style.display = "none";
  } catch (err) {
    console.error(err);
    els.modalLoading.style.display = "flex";
    els.modalLoading.textContent = "FAILED TO LOAD";
    try { modalPreview.close(); } catch {}
  }
}

function closeModal(opts = {}) {
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalLoading.style.display = "flex";
  modalPreview.close();
  unlockBodyScroll();
  state.activePreviewId = "";
  state.previewId = "";
  state.downloadCountRequest += 1;
  setModalDownloadStat("downloads: —", true);

  if (!opts.skipUrlRestore) {
    history.replaceState({}, "", state.lastNonPreviewUrl || getPreviewlessHref());
  }
}

function maybeOpenPreviewFromUrl() {
  const previewId = String(getUrlParam("preview", "") || "").trim();
  if (!previewId) return;
  if (els.modal.classList.contains("is-open") && state.activePreviewId === previewId) return;

  const match = state.items.find((it) => String(it.modelId || "") === previewId);
  if (!match) return;
  openModal(match, { skipUrlUpdate: true });
}

els.modalBackdrop.addEventListener("click", () => closeModal());
els.modalClose.addEventListener("click", () => closeModal());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.modal.classList.contains("is-open")) closeModal();
});

els.search.value = state.q || "";
els.search.addEventListener("input", debounce(() => {
  state.q = els.search.value || "";
  setUrlParam("q", state.q || "");
  applyFiltersAndRenderGrid();
}, 120));

async function loadDataAndRender() {
  showGridLoading(true);

  try {
    const json = await fetchModels(state.game);
    state.data = json;

    if (json?.game?.key) state.game = json.game.key;

    await loadGameListIfNeeded();
    renderGameChips();

    const groups = json.groups || [];
    state.groups = groups;

    const rootItems = json.rootItems || json.items || json.models || [];
    if (Array.isArray(rootItems) && rootItems.length) {
      let allGroup = groups.find((g) => folderKeyFromGroup(g) === "all");
      if (!allGroup) {
        allGroup = { key: "all", label: "ALL", items: [] };
        groups.unshift(allGroup);
      }
      allGroup.items = (allGroup.items || []).concat(rootItems);
    }
    groups.sort((a, b) => (a.key === "all" ? -1 : b.key === "all" ? 1 : (a.label || "").localeCompare(b.label || "")));

    const folderKeys = new Set(groups.map((g) => folderKeyFromGroup(g)).concat(["all"]));
    if (!folderKeys.has(state.folder)) {
      state.folder = "all";
      setUrlParam("folder", "all");
    }

    renderFolderChips(groups);
    state.items = flattenItemsFromGroups(groups);
    applyFiltersAndRenderGrid();
    maybeOpenPreviewFromUrl();
  } finally {
    showGridLoading(false);
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
    state.folder = String(getUrlParam("folder", "all") || "all").toLowerCase();
    state.q = getUrlParam("q", "");
    state.previewId = getUrlParam("preview", "");
    els.search.value = state.q;
    if (!state.previewId && els.modal.classList.contains("is-open")) closeModal({ skipUrlRestore: true });
    await loadDataAndRender();
  });

  await loadDataAndRender();
})();

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
