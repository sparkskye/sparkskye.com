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
const previewByCard = new WeakMap();
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
  // stop all previews
  if (io) io.disconnect();

  clearNode(els.grid);

  // new observer for this render
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const card = e.target;
      const preview = previewByCard.get(card);
      if (!preview) continue;

      if (e.isIntersecting) {
        preview.start();
      } else {
        preview.stop();
      }
    }
  }, { root: null, threshold: 0.15 });

  for (const it of items) {
    const card = document.createElement("article");
    card.className = "card";

    const viewer = document.createElement("div");
    viewer.className = "card__viewer";

    const placeholder = document.createElement("div");
    placeholder.className = "card__placeholder";
    placeholder.textContent = "SELECT TO PREVIEW";
    viewer.appendChild(placeholder);

    const reload = document.createElement("button");
    reload.className = "card__reload";
    reload.type = "button";
    reload.textContent = "RELOAD";
    viewer.appendChild(reload);

    const meta = document.createElement("div");
    meta.className = "card__meta";

    const top = document.createElement("div");
    top.className = "card__top";

    const name = document.createElement("h3");
    name.className = "card__name";
    name.textContent = it.name;

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = ".GLTF";

    top.appendChild(name);
    top.appendChild(badge);

    const path = document.createElement("div");
    path.className = "card__path";
    path.textContent = buildPathText(state.game, it.folderLabel);

    meta.appendChild(top);
    meta.appendChild(path);

    card.appendChild(viewer);
    card.appendChild(meta);
    els.grid.appendChild(card);

    // card click opens modal (but not reload button)
    card.addEventListener("click", (ev) => {
      if (ev.target === reload) return;
      openModal(it);
    });

    // preview instance
    const filename = `${slugify(it.name) || "model"}.gltf`;
    const preview = new CardPreview(viewer, { modelId: it.modelId, filename });
    previewByCard.set(card, preview);

    reload.addEventListener("click", (ev) => {
      ev.stopPropagation();
      preview.resetAndRetry();
    });

    io.observe(card);
  }
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
    await modalPreview.open(it.modelId, filename);
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
