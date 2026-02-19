import { fetchMaps, fileDownloadUrl, fileViewUrl } from "./api.js";
import { qs, debounce, setUrlParam, getUrlParam, copyToClipboard, titleCase } from "./ui.js";

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
  modalCopy: qs("#modalCopy"),
};

const state = {
  games: [],
  game: slugify(getUrlParam("game", "")),
  mode: String(getUrlParam("mode", "all") || "all").toLowerCase(),
  q: getUrlParam("q", ""),
  data: null,
  groups: [],
  items: [],
  filtered: [],
  lastFocus: null,
};

let gridLoadingEl = null;
let gridLoadingStop = null;
let imgIO = null;

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
  const provided = window.__HIVE_GAMES;
  if (Array.isArray(provided) && provided.length) {
    state.games = provided.map(x => ({ key: slugify(x), label: normalizeGameLabel(x) }));
    return;
  }
  state.games = [];
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
        await loadDataAndRender();
      }
    }));
  }
}

function modeKeyFromGroup(group) {
  return String(group.key || slugify(group.label) || "").toLowerCase();
}

function renderModeChips(groups) {
  clearNode(els.modeChips);

  // Always include ALL MAPS
  els.modeChips.appendChild(makeChip({
    label: "ALL MAPS",
    active: (state.mode || "all") === "all",
    extraClass: "chip--folder",
    onClick: () => {
      if (state.mode === "all") return;
      state.mode = "all";
      setUrlParam("mode", state.mode);
      renderModeChips(state.groups);
      applyFiltersAndRenderGrid();
    }
  }));

  for (const grp of groups) {
    if ((grp.key || "").toLowerCase() === "all") continue;
    const key = modeKeyFromGroup(grp);
    const label = (grp.label || key).toUpperCase();
    const active = key === state.mode;

    els.modeChips.appendChild(makeChip({
      label,
      active,
      extraClass: "chip--folder",
      onClick: () => {
        if (state.mode === key) return;
        state.mode = key;
        setUrlParam("mode", state.mode);
        renderModeChips(state.groups);
        applyFiltersAndRenderGrid();
      }
    }));
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

function flattenItemsFromGroups(groups) {
  const out = [];

  // Prefer non-"all" groups
  for (const g of (groups || [])) {
    if ((g.key || "").toLowerCase() === "all") continue;
    const groupKey = modeKeyFromGroup(g);
    const groupLabel = g.label || groupKey;

    for (const it of (g.items || [])) {
      const glbId = pickGlbId(it);
      const thumb = pickThumb(it);
      out.push({
        name: it.name || it.title || "(untitled)",
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

  // Fallback: if only an "all" group exists
  if (!out.length) {
    const allGroup = (groups || []).find(g => (g.key || "").toLowerCase() === "all");
    for (const it of (allGroup?.items || [])) {
      const glbId = pickGlbId(it);
      const thumb = pickThumb(it);
      out.push({
        name: it.name || it.title || "(untitled)",
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

  out.sort((a, b) =>
    (a.name || "").localeCompare(b.name || "") ||
    (a.relPath || "").localeCompare(b.relPath || "")
  );

  return out;
}

function applyFiltersAndRenderGrid() {
  const q = (state.q || "").trim().toLowerCase();
  const mode = (state.mode || "all").toLowerCase();

  const items = state.items.filter((it) => {
    const okMode =
      mode === "all"
        ? true
        : (it.modeKey === mode || slugify(it.modeLabel) === mode || (it.modeLabel || "").toLowerCase() === mode);

    if (!okMode) return false;
    if (!q) return true;

    return (it.name || "").toLowerCase().includes(q) ||
           (it.modeLabel || "").toLowerCase().includes(q) ||
           (it.relPath || "").toLowerCase().includes(q);
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

    const img = document.createElement("img");
    img.className = "card__thumb";
    img.alt = it.name;

    const thumbSrc = it.thumbUrl
      ? it.thumbUrl
      : (it.thumbId ? fileViewUrl(it.thumbId) : "");

    // Lazy-load the thumbnail to keep this page fast.
    if (thumbSrc) {
      img.dataset.src = thumbSrc;
      imgIO.observe(img);
    }

    img.addEventListener("load", () => {
      ph.style.display = "none";
    });
    img.addEventListener("error", () => {
      ph.style.display = "flex";
      ph.textContent = "FAILED TO LOAD";
    });

    viewer.appendChild(img);
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
    const dl = it.glbId ? fileDownloadUrl(it.glbId, filename) : "";

    // Click name to download directly (same behavior as models)
    name.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!dl) return;
      await downloadViaFetch(dl, filename);
    });

    nameRow.appendChild(name);

    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = buildPathText(state.game, it.relPath || it.modeLabel || "");

    meta.appendChild(nameRow);
    meta.appendChild(path);

    card.appendChild(viewer);
    card.appendChild(meta);

    card.addEventListener("click", () => openModal(it));

    els.grid.appendChild(card);
  }
}

function openModal(it) {
  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  state.lastFocus = document.activeElement;
  try { els.modalClose?.focus?.(); } catch {}

  els.modalLoading.style.display = "flex";
  els.modalLoading.textContent = "Loading…";

  els.modalName.textContent = it.name;
  els.modalPath.textContent = buildPathText(state.game, it.relPath || it.modeLabel || "");

  // Clear viewer
  while (els.modalViewer.firstChild) els.modalViewer.removeChild(els.modalViewer.firstChild);
  els.modalViewer.appendChild(els.modalLoading);

  const thumbSrc = it.thumbUrl
    ? it.thumbUrl
    : (it.thumbId ? fileViewUrl(it.thumbId) : "");

  if (thumbSrc) {
    const img = document.createElement("img");
    img.className = "modal__thumb";
    img.alt = it.name;
    img.src = thumbSrc;
    img.addEventListener("load", () => {
      els.modalLoading.style.display = "none";
    });
    img.addEventListener("error", () => {
      els.modalLoading.style.display = "flex";
      els.modalLoading.textContent = "FAILED TO LOAD";
    });
    els.modalViewer.appendChild(img);
  } else {
    els.modalLoading.textContent = "NO PREVIEW";
  }

  const filename = `${slugify(it.name) || "map"}.glb`;
  const dl = it.glbId ? fileDownloadUrl(it.glbId, filename) : "";

  els.modalDownload.href = dl || "#";
  els.modalDownload.download = filename;
  els.modalDownload.onclick = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!dl) return;
    await downloadViaFetch(dl, filename);
  };

  els.modalCopy.onclick = async () => {
    if (!dl) return;
    await copyToClipboard(dl);
    els.modalCopy.textContent = "COPIED!";
    setTimeout(() => (els.modalCopy.textContent = "COPY LINK"), 900);
  };
}

function closeModal() {
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalLoading.style.display = "flex";
}

els.modalBackdrop.addEventListener("click", closeModal);
els.modalClose.addEventListener("click", closeModal);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.modal.classList.contains("is-open")) closeModal();
});

// Search wiring
els.search.value = state.q || "";
els.search.addEventListener("input", debounce(() => {
  state.q = els.search.value || "";
  setUrlParam("q", state.q || "");
  applyFiltersAndRenderGrid();
}, 120));

async function loadDataAndRender() {
  showGridLoading(true);

  try {
    const json = await fetchMaps(state.game);
    state.data = json;

    if (json?.game?.key) state.game = slugify(json.game.key);

    await loadGameListIfNeeded();
    renderGameChips();

    const groups = json.groups || json.modes || json.folders || [];
    state.groups = groups;
    groups.sort((a, b) =>
      (a.key === "all" ? -1 : b.key === "all" ? 1 : (a.label || "").localeCompare(b.label || ""))
    );

    const modeKeys = new Set(groups.map(g => modeKeyFromGroup(g)).concat(["all"]));
    if (!modeKeys.has(state.mode)) {
      state.mode = "all";
      setUrlParam("mode", "all");
    }

    renderModeChips(groups);
    state.items = flattenItemsFromGroups(groups);
    applyFiltersAndRenderGrid();
  } finally {
    showGridLoading(false);
  }
}

(async function init() {
  if (!state.game) {
    state.game = "bedwars";
    setUrlParam("game", state.game);
  }

  window.addEventListener("popstate", async () => {
    state.game = slugify(getUrlParam("game", "bedwars"));
    state.mode = String(getUrlParam("mode", "all") || "all").toLowerCase();
    state.q = getUrlParam("q", "");
    els.search.value = state.q;
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
