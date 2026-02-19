import { fetchModels, fileDownloadUrl } from "./api.js";
import { qs, debounce, setUrlParam, getUrlParam, copyToClipboard, titleCase } from "./ui.js";
import { CardPreview, ModalPreview } from "./preview3d.js";

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
  game: getUrlParam("game", ""),
  folder: getUrlParam("folder", "all"),
  q: getUrlParam("q", ""),
  data: null,
  items: [],
  filtered: [],
};

const modalPreview = new ModalPreview(els.modalViewer);

// per-card preview instances
const previewByCard = new Map();
let io = null;

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
  const f = (folderLabel || "").toUpperCase();
  return `${g} \\ ${f}`;
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
  return group.key || slugify(group.label);
}

function renderFolderChips(groups) {
  clearNode(els.folderChips);

  for (const grp of groups) {
    const key = folderKeyFromGroup(grp);
    const label = (grp.label || key).toUpperCase();
    const active = key === state.folder;

    els.folderChips.appendChild(makeChip({
      label,
      active,
      extraClass: "chip--folder",
      onClick: () => {
        state.folder = key;
        setUrlParam("folder", state.folder);
        applyFiltersAndRenderGrid();
      }
    }));
  }
}

function flattenItemsFromGroups(groups) {
  const allGroup = groups.find(g => (g.key || "").toLowerCase() === "all");
  if (!allGroup) return [];

  const items = (allGroup.items || []).map((it) => ({
    name: it.name,
    modelId: it.modelId || it.id || it.fileId,
    folderLabel: it.folderLabel || "",
    ext: "gltf",
  }));

  items.sort((a, b) =>
    (a.name || "").localeCompare(b.name || "") ||
    (a.folderLabel || "").localeCompare(b.folderLabel || "")
  );

  return items;
}

function applyFiltersAndRenderGrid() {
  const q = (state.q || "").trim().toLowerCase();
  const folder = (state.folder || "all").toLowerCase();

  const items = state.items.filter((it) => {
    const okFolder =
      folder === "all"
        ? true
        : (slugify(it.folderLabel) === folder || (it.folderLabel || "").toLowerCase() === folder);

    if (!okFolder) return false;
    if (!q) return true;

    return (it.name || "").toLowerCase().includes(q) ||
           (it.folderLabel || "").toLowerCase().includes(q);
  });

  state.filtered = items;
  els.count.textContent = `${items.length} shown`;
  renderGrid(items);
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

  // Build cards
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;

    const viewer = document.createElement("div");
    viewer.className = "preview";

    const filename = `${slugify(it.name)}.gltf`;
    const dl = fileDownloadUrl(it.modelId, filename);

    viewer.dataset.modelUrl = dl;
    viewer.dataset.filename = filename;

    const ph = document.createElement("div");
    ph.className = "ph";
    ph.textContent = "SELECT TO PREVIEW";

    const reload = document.createElement("button");
    reload.className = "reloadBtn";
    reload.type = "button";
    reload.textContent = "RELOAD";
    reload.style.display = "none";

    viewer.appendChild(ph);
    viewer.appendChild(reload);

    const meta = document.createElement("div");
    meta.className = "meta";

    const nameRow = document.createElement("div");
    nameRow.className = "nameRow";

    const name = document.createElement("a");
    name.className = "modelName";
    name.href = "#";
    name.textContent = it.name;
    name.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await downloadViaFetch(dl, filename);
    });

    const ext = document.createElement("span");
    ext.className = "extTag";
    ext.textContent = ".GLTF";

    nameRow.appendChild(name);
    nameRow.appendChild(ext);

    const path = document.createElement("div");
    path.className = "pathLine";
    path.textContent = `${(state.game || "").toUpperCase()} \\ ${(it.folderLabel || "all").toUpperCase()}`;

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
      ph.textContent = "Loading…";

      const preview = new CardPreview(viewer);
      previewByCard.set(card, preview);

      try {
        await preview.init(dl);
        ph.textContent = "";
      } catch {
        card.dataset.failed = "1";
        ph.textContent = "PREVIEW FAILED";
        reload.style.display = "inline-flex";
      }
    });

    els.grid.appendChild(card);
  }

  // Lazy 3D previews (create as you scroll IN)
  // IMPORTANT: we do NOT destroy on scroll OUT (prevents flashing/retry spam)
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const card = e.target;
      const viewer = card.querySelector(".preview");
      const ph = viewer?.querySelector(".ph");
      const reload = viewer?.querySelector(".reloadBtn");
      if (!viewer) continue;

      if (e.isIntersecting) {
        if (previewByCard.has(card)) continue;
        if (card.dataset.failed === "1") continue;

        const modelUrl = viewer.dataset.modelUrl;
        if (!modelUrl) continue;

        if (ph) ph.textContent = "Loading…";
        if (reload) reload.style.display = "none";

        const preview = new CardPreview(viewer);
        previewByCard.set(card, preview);

        preview.init(modelUrl).then(() => {
          if (ph) ph.textContent = "";
        }).catch(() => {
          card.dataset.failed = "1";
          if (ph) ph.textContent = "PREVIEW FAILED";
          if (reload) reload.style.display = "inline-flex";
        });
      }
    }
  }, { root: null, threshold: 0.15 });

  for (const card of els.grid.querySelectorAll(".card")) io.observe(card);
}

async function openModal(it) {
  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  els.modalLoading.style.display = "flex";

  const filename = `${slugify(it.name) || "model"}.gltf`;
  const dl = fileDownloadUrl(it.modelId, filename);

  els.modalName.textContent = it.name;
  els.modalPath.textContent = buildPathText(state.game, it.folderLabel);

  els.modalDownload.href = dl;
  els.modalDownload.download = filename;

  els.modalCopy.onclick = async () => {
    await copyToClipboard(dl);
    els.modalCopy.textContent = "COPIED!";
    setTimeout(() => (els.modalCopy.textContent = "COPY LINK"), 900);
  };

  try {
    await modalPreview.open(dl);
  } finally {
    els.modalLoading.style.display = "none";
  }
}

function closeModal() {
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
  els.grid.innerHTML = "";

  const json = await fetchModels(state.game);
  state.data = json;

  if (json?.game?.key) state.game = json.game.key;

  await loadGameListIfNeeded();
  renderGameChips();

  const groups = json.groups || [];
  groups.sort((a, b) =>
    (a.key === "all" ? -1 : b.key === "all" ? 1 : (a.label || "").localeCompare(b.label || ""))
  );

  const folderKeys = new Set(groups.map(g => folderKeyFromGroup(g)));
  if (!folderKeys.has(state.folder)) {
    state.folder = "all";
    setUrlParam("folder", "all");
  }

  renderFolderChips(groups);
  state.items = flattenItemsFromGroups(groups);
  applyFiltersAndRenderGrid();
}

// Init
(async function init() {
  if (!state.game) {
    state.game = "bedwars";
    setUrlParam("game", state.game);
  }

  window.addEventListener("popstate", async () => {
    state.game = getUrlParam("game", "bedwars");
    state.folder = getUrlParam("folder", "all");
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
