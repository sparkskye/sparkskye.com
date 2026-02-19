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
  // We’ll derive games from root listing by asking API with no game,
  // then using returned game + also allowing user to switch by querying different keys.
  // Your current API returns chosen game + groups; the worker currently supports ?game=.
  // So we keep a curated list from folder names in Drive by calling the API once per session:
  // BUT to avoid N calls, we store a static list here and still let API validate.
  //
  // If your API already returns full list elsewhere, we can upgrade later.
  //
  // For now: the list appears to be working already on your site (from earlier screenshot),
  // so we’ll accept it from the first response (it includes chosen.key/name only),
  // and also allow a “known games” array via window.__HIVE_GAMES.
  const provided = window.__HIVE_GAMES;
  if (Array.isArray(provided) && provided.length) {
    state.games = provided.map(x => ({ key: slugify(x), label: normalizeGameLabel(x) }));
    return;
  }
  // fallback: minimal list if none provided (still works if user switches URL manually)
  state.games = [];
}

function renderGameChips() {
  clearNode(els.gameChips);

  // If we don't have a list, at least show current game as active so UI isn't empty
  const games = state.games.length
    ? state.games
    : [{ key: state.game || "bedwars", label: normalizeGameLabel(state.game || "bedwars") }];

  // Ensure alphabetical
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
        await loadDataAndRender(); // IMPORTANT: no full page reload
      }
    }));
  }
}

function folderKeyFromGroup(group) {
  return group.key || slugify(group.label);
}

function renderFolderChips(groups) {
  clearNode(els.folderChips);

  // groups includes "all"
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
    ext: "gltf", // models page: always gltf for you
  }));

  // Stable sort by name then folderLabel
  items.sort((a, b) => (a.name || "").localeCompare(b.name || "") || (a.folderLabel || "").localeCompare(b.folderLabel || ""));
  return items;
}

function applyFiltersAndRenderGrid() {
  const q = (state.q || "").trim().toLowerCase();
  const folder = (state.folder || "all").toLowerCase();

  const items = state.items.filter((it) => {
    const okFolder = folder === "all" ? true : (slugify(it.folderLabel) === folder || (it.folderLabel || "").toLowerCase() === folder);
    if (!okFolder) return false;
    if (!q) return true;
    return (it.name || "").toLowerCase().includes(q) || (it.folderLabel || "").toLowerCase().includes(q);
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

  // Map is iterable (WeakMap is not) – we need to cleanly destroy previews
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
    viewer.dataset.modelId = it.modelId;
    viewer.dataset.filename = `${slugify(it.name)}.gltf`;

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
      const fn = viewer.dataset.filename;
      const dl = fileDownloadUrl(it.modelId, fn);
      await downloadViaFetch(dl, fn);
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

    // Reload retries just this preview
    reload.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const prev = previewByCard.get(card);
      if (prev) {
        try { prev.destroy(true); } catch {}
        previewByCard.delete(card);
      }
      reload.style.display = "none";
      ph.textContent = "Loading…";
      const preview = new CardPreview(viewer, { apiBase: window.__HIVE_API_BASE });
      previewByCard.set(card, preview);
      preview.init(it.modelId, viewer.dataset.filename).then(() => {
        ph.textContent = "";
      }).catch(() => {
        ph.textContent = "PREVIEW FAILED";
        reload.style.display = "inline-flex";
      });
    });

    els.grid.appendChild(card);
  }

  // Lazy 3D previews (create/destroy as you scroll)
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const card = e.target;
      const viewer = card.querySelector(".preview");
      const ph = viewer?.querySelector(".ph");
      const reload = viewer?.querySelector(".reloadBtn");
      if (!viewer) continue;

      if (e.isIntersecting) {
        if (previewByCard.has(card)) continue;

        const modelId = viewer.dataset.modelId;
        const filename = viewer.dataset.filename;
        if (!modelId || !filename) continue;

        if (ph) ph.textContent = "Loading…";
        if (reload) reload.style.display = "none";

        const preview = new CardPreview(viewer, { apiBase: window.__HIVE_API_BASE });
        previewByCard.set(card, preview);

        preview.init(modelId, filename).then(() => {
          if (ph) ph.textContent = "";
        }).catch(() => {
          if (ph) ph.textContent = "PREVIEW FAILED";
          if (reload) reload.style.display = "inline-flex";
        });
      } else {
        const preview = previewByCard.get(card);
        if (preview) {
          try { preview.destroy(true); } catch {}
          previewByCard.delete(card);
          if (ph) ph.textContent = "SELECT TO PREVIEW";
        }
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
  // keep UI responsive
  els.grid.innerHTML = "";

  const json = await fetchModels(state.game);
  state.data = json;

  // Track current game from server response (canonical)
  if (json?.game?.key) state.game = json.game.key;

  // If we don't have a games list, we can infer just current.
  await loadGameListIfNeeded();
  renderGameChips();

  // folders from groups
  const groups = json.groups || [];
  // ensure "all" first
  groups.sort((a, b) => (a.key === "all" ? -1 : b.key === "all" ? 1 : (a.label || "").localeCompare(b.label || "")));

  // If URL folder is missing in new game, reset to all
  const folderKeys = new Set(groups.map(g => folderKeyFromGroup(g)));
  if (!folderKeys.has(state.folder)) {
    state.folder = "all";
    setUrlParam("folder", "all");
  }

  renderFolderChips(groups);

  // items
  state.items = flattenItemsFromGroups(groups);

  // count + grid
  applyFiltersAndRenderGrid();
}

// Init
(async function init() {
  if (!state.game) {
    // default: first tag should be bedwars if user didn't specify
    state.game = "bedwars";
    setUrlParam("game", state.game);
  }

  // Listen to back/forward
  window.addEventListener("popstate", async () => {
    state.game = getUrlParam("game", "bedwars");
    state.folder = getUrlParam("folder", "all");
    state.q = getUrlParam("q", "");
    els.search.value = state.q;
    await loadDataAndRender();
  });

  await loadDataAndRender();
})();
