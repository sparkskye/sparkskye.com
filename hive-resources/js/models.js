import { fetchModels, fileDownloadUrl } from "./api.js";
import { qs, debounce, setUrlParam, getUrlParam, copyToClipboard, titleCase } from "./ui.js";
import { CardPreview, ModalPreview } from "./preview3d.js";

// Keep WebGL contexts under the browser limit (prevents "Too many active WebGL contexts")
const MAX_ACTIVE_CARD_PREVIEWS = 12;

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
  data: null,
  groups: [],
  items: [],
  filtered: [],
  lastFocus: null,
};

const modalPreview = new ModalPreview(els.modalViewer);

// per-card preview instances
const previewByCard = new Map();
const visibleCards = new Set();
let pumpRaf = 0;
let io = null;

// grid loading (game/folder load)
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

function folderKeyFromGroup(group) {
  return String(group.key || slugify(group.label) || "").toLowerCase();
}

function renderFolderChips(groups) {
  clearNode(els.folderChips);

  // Always include ALL MODELS
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
    }
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
      }
    }));
  }
}

function flattenItemsFromGroups(groups) {
  const out = [];

  // Prefer non-"all" groups so each item carries its folder grouping cleanly.
  for (const g of (groups || [])) {
    if ((g.key || "").toLowerCase() === "all") continue;

    const groupKey = folderKeyFromGroup(g);
    const groupLabel = g.label || groupKey;

    for (const it of (g.items || [])) {
      out.push({
        name: it.name,
        modelId: it.modelId || it.id || it.fileId,
        // Full relative path if provided by Apps Script (preferred)
        relPath: it.path || it.folderLabel || groupLabel || "",
        folderKey: groupKey,
        folderLabel: it.folderLabel || groupLabel || "",
        ext: "gltf",
      });
    }
  }

  // Fallback: if the API only provided an "all" group, use it.
  if (!out.length) {
    const allGroup = (groups || []).find(g => (g.key || "").toLowerCase() === "all");
    for (const it of (allGroup?.items || [])) {
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

  out.sort((a, b) =>
    (a.name || "").localeCompare(b.name || "") ||
    (a.relPath || "").localeCompare(b.relPath || "")
  );

  return out;
}

function applyFiltersAndRenderGrid() {
  const q = (state.q || "").trim().toLowerCase();
  const folder = (state.folder || "all").toLowerCase();

  const items = state.items.filter((it) => {
    const okFolder =
      folder === "all"
        ? true
        : (it.folderKey === folder || slugify(it.folderLabel) === folder || (it.folderLabel || "").toLowerCase() === folder);

    if (!okFolder) return false;
    if (!q) return true;

    return (it.name || "").toLowerCase().includes(q) ||
           (it.folderLabel || "").toLowerCase().includes(q);
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
  return () => {
    clearInterval(t);
  };
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

  // tear down old observer + previews
  try { io?.disconnect(); } catch {}
  io = null;

  for (const preview of previewByCard.values()) {
    try { preview.destroy(true); } catch {}
  }
  previewByCard.clear();
  visibleCards.clear();

  // Build cards
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";

    const filename = `${slugify(it.name)}.gltf`;
    const dl = fileDownloadUrl(it.modelId, filename);

    viewer.dataset.modelUrl = dl;
    viewer.dataset.filename = filename;

    const ph = document.createElement("div");
    ph.className = "card__placeholder";
    // Keep placeholder but don't show extra text by default.
    // We'll only show LOADING / FAILED states.
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
    // Keep the quick-download behavior (requested previously)
    name.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await downloadViaFetch(dl, filename);
    });

    nameRow.appendChild(name);

    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = buildPathText(state.game, it.relPath || it.folderLabel || "");

    meta.appendChild(nameRow);
    meta.appendChild(path);

    card.appendChild(viewer);
    card.appendChild(meta);

    // Open modal on card click (but not on name/reload)
    card.addEventListener("click", (ev) => {
      if (ev.target === name || ev.target === reload) return;
      openModal(it);
    });

    // Reload retries just this preview (manual only)
    reload.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      card.dataset.failed = ""; // clear failure flag
      const prev = previewByCard.get(card);
      if (prev) {
        try { prev.destroy(true); } catch {}
        previewByCard.delete(card);
      }

      reload.style.display = "none";
      if (card._phStop) card._phStop();
      card._phStop = startDotLoader(ph, "LOADING");

      const preview = new CardPreview(viewer);
      previewByCard.set(card, preview);

      try {
        await preview.init(dl);
        if (card._phStop) card._phStop();
        card._phStop = null;
        ph.style.display = "none";
      } catch {
        card.dataset.failed = "1";
        if (card._phStop) card._phStop();
        card._phStop = null;
        ph.style.display = "flex";
        ph.textContent = "PREVIEW FAILED";
        reload.style.display = "inline-flex";
      }
    });

    els.grid.appendChild(card);
  }

  // Lazy 3D previews:
  // - Create when near viewport
  // - Destroy when far away (prevents WebGL context limit + ensures previews re-load when scrolling back up)
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const card = e.target;
      const viewer = card.querySelector(".card__viewer");
      const ph = viewer?.querySelector(".card__placeholder");
      const reload = viewer?.querySelector(".card__reload");
      if (!viewer) continue;

      if (e.isIntersecting) {
        visibleCards.add(card);
        // We'll fill previews via a pump so cards that were skipped due to the cap
        // will still load once slots free up (prevents "SELECT TO PREVIEW" getting stuck).
        schedulePump();
      } else {
        visibleCards.delete(card);

        // Destroy preview when far away
        const prev = previewByCard.get(card);
        if (prev) {
          try { prev.destroy(true); } catch {}
          previewByCard.delete(card);
        }
        if (card._phStop) card._phStop();
        card._phStop = null;
        if (ph) {
          ph.style.display = "flex";
          ph.textContent = (card.dataset.failed === "1") ? "PREVIEW FAILED" : "";
        }
        if (reload) {
          reload.style.display = (card.dataset.failed === "1") ? "inline-flex" : "none";
        }

        schedulePump();
      }
    }
  }, { root: null, threshold: 0.01, rootMargin: "280px 0px 280px 0px" });

  for (const card of els.grid.querySelectorAll(".card")) io.observe(card);
}

function schedulePump() {
  if (pumpRaf) return;
  pumpRaf = requestAnimationFrame(() => {
    pumpRaf = 0;
    pumpVisiblePreviews();
  });
}

function pumpVisiblePreviews() {
  // Fill up to MAX_ACTIVE_CARD_PREVIEWS using currently visible cards.
  if (previewByCard.size >= MAX_ACTIVE_CARD_PREVIEWS) return;

  for (const card of visibleCards) {
    if (previewByCard.size >= MAX_ACTIVE_CARD_PREVIEWS) break;
    if (previewByCard.has(card)) continue;
    if (card.dataset.failed === "1") continue;

    const viewer = card.querySelector(".card__viewer");
    if (!viewer) continue;
    const modelUrl = viewer.dataset.modelUrl;
    if (!modelUrl) continue;

    // If we're at the cap, evict one that's not visible (best effort)
    if (previewByCard.size >= MAX_ACTIVE_CARD_PREVIEWS) {
      for (const [c, prev] of previewByCard) {
        if (visibleCards.has(c)) continue;
        try { prev.destroy(true); } catch {}
        previewByCard.delete(c);
        break;
      }
    }

    // Still capped? stop.
    if (previewByCard.size >= MAX_ACTIVE_CARD_PREVIEWS) break;

    const ph = viewer.querySelector(".card__placeholder");
    const reload = viewer.querySelector(".card__reload");
    if (reload) reload.style.display = "none";
    if (ph) {
      ph.style.display = "flex";
      if (card._phStop) card._phStop();
      card._phStop = startDotLoader(ph, "LOADING");
    }

    const preview = new CardPreview(viewer);
    previewByCard.set(card, preview);

    preview.init(modelUrl).then(() => {
      if (card._phStop) card._phStop();
      card._phStop = null;
      if (ph) ph.style.display = "none";
      schedulePump();
    }).catch(() => {
      card.dataset.failed = "1";
      if (card._phStop) card._phStop();
      card._phStop = null;
      if (ph) {
        ph.style.display = "flex";
        ph.textContent = "PREVIEW FAILED";
      }
      if (reload) reload.style.display = "inline-flex";
      schedulePump();
    });
  }
}

async function openModal(it) {
  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  els.modalLoading.style.display = "flex";
  els.modalLoading.textContent = "Loading…";
  state.lastFocus = document.activeElement;
  // Move focus into the modal (prevents aria-hidden focus warnings)
  try { els.modalClose?.focus?.(); } catch {}

  const filename = `${slugify(it.name) || "model"}.gltf`;
  const dl = fileDownloadUrl(it.modelId, filename);

  els.modalName.textContent = it.name;
  els.modalPath.textContent = buildPathText(state.game, it.relPath || it.folderLabel || "");

  els.modalDownload.href = dl;
  els.modalDownload.download = filename;
  els.modalDownload.onclick = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await downloadViaFetch(dl, filename);
  };

  els.modalCopy.onclick = async () => {
    await copyToClipboard(dl);
    els.modalCopy.textContent = "COPIED!";
    setTimeout(() => (els.modalCopy.textContent = "COPY LINK"), 900);
  };

  try {
    await modalPreview.open(dl);
    els.modalLoading.style.display = "none";
  } catch (err) {
    console.error(err);
    els.modalLoading.style.display = "flex";
    els.modalLoading.textContent = "FAILED TO LOAD";
    // Ensure we don't leave a half-initialized renderer around.
    try { modalPreview.close(); } catch {}
  }
}

function closeModal() {
  // Restore focus BEFORE hiding the modal (prevents aria-hidden focus warnings)
  try { state.lastFocus?.focus?.(); } catch {}
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalLoading.style.display = "flex";
  modalPreview.close();
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
    const json = await fetchModels(state.game);
    state.data = json;

    if (json?.game?.key) state.game = json.game.key;

    await loadGameListIfNeeded();
    renderGameChips();

    const groups = json.groups || [];
    state.groups = groups;
    groups.sort((a, b) =>
      (a.key === "all" ? -1 : b.key === "all" ? 1 : (a.label || "").localeCompare(b.label || ""))
    );

    const folderKeys = new Set(groups.map(g => folderKeyFromGroup(g)).concat(["all"]));
    if (!folderKeys.has(state.folder)) {
      state.folder = "all";
      setUrlParam("folder", "all");
    }

    renderFolderChips(groups);
    state.items = flattenItemsFromGroups(groups);
    applyFiltersAndRenderGrid();
  } finally {
    showGridLoading(false);
  }
}

// Init
(async function init() {
  if (!state.game) {
    state.game = "bedwars";
    setUrlParam("game", state.game);
  }

  window.addEventListener("popstate", async () => {
    state.game = slugify(getUrlParam("game", "bedwars"));
    state.folder = String(getUrlParam("folder", "all") || "all").toLowerCase();
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
