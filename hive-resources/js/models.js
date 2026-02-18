/* =========================
   Config
   ========================= */
const API_BASE = "https://delicate-bush-cf6f.sparkskye-minecraft.workers.dev";

const els = {
  gamePills: document.getElementById("gamePills"),
  folderPills: document.getElementById("folderPills"),
  search: document.getElementById("searchInput"),
  count: document.getElementById("countBadge"),
  grid: document.getElementById("grid"),

  modal: document.getElementById("modal"),
  modalViewer: document.getElementById("modalViewer"),
  modalName: document.getElementById("modalName"),
  modalPath: document.getElementById("modalPath"),
  modalDownload: document.getElementById("modalDownload"),
  modalCopy: document.getElementById("modalCopy"),

  toast: document.getElementById("toast"),
};

let state = {
  games: [],
  game: "",
  groups: [],
  items: [],
  folderKey: "all",
  q: "",
};

let io = null;

/* =========================
   Utils
   ========================= */
function qs(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function setQS(name, value, replace = false) {
  const u = new URL(location.href);
  if (!value) u.searchParams.delete(name);
  else u.searchParams.set(name, value);
  const next = u.pathname + u.search;
  if (replace) history.replaceState({}, "", next);
  else history.pushState({}, "", next);
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 1200);
}

function safeFileName(name) {
  return (name || "model")
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80) || "model";
}

function buildDownloadUrl(item, ext) {
  // Worker will set Content-Disposition to the right filename
  const fname = safeFileName(item.name);
  return `${API_BASE}/api/file?id=${encodeURIComponent(item.modelId)}&name=${encodeURIComponent(fname)}&ext=${encodeURIComponent(ext)}`;
}

/* =========================
   API
   ========================= */
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

async function loadGames() {
  // Prefer dynamic list from worker. Falls back gracefully if not implemented.
  try {
    const data = await fetchJSON(`${API_BASE}/api/games`);
    if (Array.isArray(data.games) && data.games.length) return data.games;
  } catch (e) {
    // ignore
  }

  // Fallback: minimal list (you can add to this if needed)
  return [
    { key: "bedwars", name: "bedwars" },
    { key: "skywars", name: "skywars" },
    { key: "murder", name: "murder" },
    { key: "survival", name: "survival games" },
  ];
}

async function loadModels(gameKey) {
  const url = `${API_BASE}/api/models${gameKey ? `?game=${encodeURIComponent(gameKey)}` : ""}`;
  return await fetchJSON(url);
}

/* =========================
   Render pills
   ========================= */
function pill(label, key, active, onClick) {
  const b = document.createElement("button");
  b.className = "pill" + (active ? " is-active" : "");
  b.type = "button";
  b.textContent = label;
  b.dataset.key = key;
  b.addEventListener("click", onClick);
  return b;
}

function renderGamePills() {
  els.gamePills.innerHTML = "";
  for (const g of state.games) {
    els.gamePills.appendChild(
      pill(g.name, g.key, g.key === state.game, async () => {
        if (state.game === g.key) return;
        await switchGame(g.key, false);
      })
    );
  }
}

function renderFolderPills() {
  els.folderPills.innerHTML = "";

  // Always include "all models"
  els.folderPills.appendChild(
    pill("all models", "all", state.folderKey === "all", () => {
      state.folderKey = "all";
      renderFolderPills();
      renderGrid();
    })
  );

  for (const grp of state.groups) {
    if (grp.key === "all") continue;
    els.folderPills.appendChild(
      pill(grp.label, grp.key, grp.key === state.folderKey, () => {
        state.folderKey = grp.key;
        renderFolderPills();
        renderGrid();
      })
    );
  }
}

/* =========================
   Grid + Lazy previews
   ========================= */
function destroyObserver() {
  if (io) {
    io.disconnect();
    io = null;
  }
}

function setupObserver() {
  destroyObserver();
  io = new IntersectionObserver(onIntersect, {
    root: null,
    rootMargin: "600px 0px",
    threshold: 0.01,
  });

  document.querySelectorAll("[data-preview]").forEach((el) => io.observe(el));
}

function onIntersect(entries) {
  for (const ent of entries) {
    const host = ent.target;
    const viewer = host.querySelector("model-viewer");
    const phIdle = host.querySelector(".ph.idle");
    const phLoading = host.querySelector(".ph.loading");

    if (!viewer) continue;

    if (ent.isIntersecting) {
      // Load preview
      if (!viewer.getAttribute("src")) {
        phIdle?.classList.add("hidden");
        phLoading?.classList.remove("hidden");

        viewer.setAttribute("src", host.dataset.src);
        viewer.setAttribute("poster", ""); // ensure no default poster
      }
    } else {
      // Unload to keep memory low (and reload properly when scrolling back)
      if (viewer.getAttribute("src")) {
        viewer.removeAttribute("src");
        phLoading?.classList.add("hidden");
        phIdle?.classList.remove("hidden");
      }
    }
  }
}

function cardTemplate(item) {
  const ext = "gltf"; // models page = gltf only
  const src = buildDownloadUrl(item, ext);

  const card = document.createElement("article");
  card.className = "card";
  card.dataset.item = "1";

  // Clicking the card opens modal
  card.addEventListener("click", (ev) => {
    // If they clicked the name (download link), don't open modal
    if (ev.target && ev.target.closest && ev.target.closest("a[data-download-name]")) return;
    openModal(item);
  });

  const preview = document.createElement("div");
  preview.className = "preview";
  preview.dataset.preview = "1";
  preview.dataset.src = src;

  // Placeholders
  const phIdle = document.createElement("div");
  phIdle.className = "ph idle";
  phIdle.textContent = "select to preview";

  const phLoading = document.createElement("div");
  phLoading.className = "ph loading hidden";
  phLoading.textContent = "loading…";

  const mv = document.createElement("model-viewer");
  mv.setAttribute("reveal", "auto");
  mv.setAttribute("shadow-intensity", "0");
  mv.setAttribute("environment-image", "neutral");
  mv.setAttribute("interaction-prompt", "none");
  mv.setAttribute("exposure", "1");
  mv.setAttribute("camera-controls", "false");
  mv.setAttribute("disable-zoom", "true");
  mv.setAttribute("disable-pan", "true");
  mv.setAttribute("disable-tap", "true");
  mv.setAttribute("touch-action", "none");
  mv.setAttribute("ar", "false");

  // Correct rotation: 180deg around Y to face front
  mv.setAttribute("orientation", "0deg 180deg 0deg");

  // When loaded, remove loading placeholder
  mv.addEventListener("load", () => {
    phLoading.classList.add("hidden");
  });
  mv.addEventListener("error", () => {
    phLoading.classList.add("hidden");
    phIdle.classList.remove("hidden");
    phIdle.textContent = "preview failed";
  });

  preview.appendChild(mv);
  preview.appendChild(phIdle);
  preview.appendChild(phLoading);

  const meta = document.createElement("div");
  meta.className = "meta";

  const nameRow = document.createElement("div");
  nameRow.className = "nameRow";

  // Name is a download link (only clicking the name downloads)
  const a = document.createElement("a");
  a.className = "modelName";
  a.href = src;
  a.download = `${safeFileName(item.name)}.gltf`;
  a.textContent = item.name;
  a.dataset.downloadName = "1";
  a.addEventListener("click", (ev) => {
    ev.stopPropagation();
  });

  const extTag = document.createElement("span");
  extTag.className = "extTag";
  extTag.textContent = ".gltf";

  nameRow.appendChild(a);
  nameRow.appendChild(extTag);

  const badges = document.createElement("div");
  badges.className = "badges";

  const b1 = document.createElement("span");
  b1.className = "badge";
  b1.textContent = item.folderLabel || "—";
  badges.appendChild(b1);

  const path = document.createElement("div");
  path.className = "path";
  path.textContent = `${state.game} \\ ${item.folderLabel || "—"}`;

  meta.appendChild(nameRow);
  meta.appendChild(badges);
  meta.appendChild(path);

  card.appendChild(preview);
  card.appendChild(meta);

  return card;
}

function filteredItems() {
  const q = (state.q || "").trim().toLowerCase();

  let list = state.items;

  // Folder filter
  if (state.folderKey && state.folderKey !== "all") {
    const grp = state.groups.find(g => g.key === state.folderKey);
    list = grp ? grp.items : list;
  }

  // Search filter
  if (q) {
    list = list.filter(it => (it.name || "").toLowerCase().includes(q));
  }

  return list;
}

function renderGrid() {
  const list = filteredItems();
  els.count.textContent = `${list.length} shown`;

  els.grid.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const item of list) {
    frag.appendChild(cardTemplate(item));
  }

  els.grid.appendChild(frag);
  setupObserver();
}

/* =========================
   Modal
   ========================= */
function openModal(item) {
  const ext = "gltf";
  const src = buildDownloadUrl(item, ext);

  els.modal.classList.remove("hidden");
  els.modal.setAttribute("aria-hidden", "false");

  els.modalName.textContent = item.name;
  els.modalPath.textContent = `${state.game} \\ ${item.folderLabel || "—"}`;
  els.modalDownload.textContent = "Download .gltf";
  els.modalDownload.href = src;
  els.modalDownload.download = `${safeFileName(item.name)}.gltf`;

  // Modal model viewer: interactive
  els.modalViewer.setAttribute("src", src);
  els.modalViewer.setAttribute("orientation", "0deg 180deg 0deg");
}

function closeModal() {
  els.modal.classList.add("hidden");
  els.modal.setAttribute("aria-hidden", "true");
  els.modalViewer.removeAttribute("src");
}

document.addEventListener("click", (ev) => {
  const close = ev.target?.dataset?.close;
  if (close) closeModal();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeModal();
});

els.modalCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("copied link");
  } catch {
    toast("copy failed");
  }
});

/* =========================
   Switching + Init
   ========================= */
async function switchGame(nextGame, replace) {
  state.game = nextGame;
  state.folderKey = "all";
  state.q = "";
  els.search.value = "";

  setQS("game", nextGame, replace);

  // Fetch data + render
  els.grid.innerHTML = "";
  els.count.textContent = "loading…";

  const data = await loadModels(nextGame);

  // groups includes "all" and subfolders
  state.groups = Array.isArray(data.groups) ? data.groups : [];
  state.items = (state.groups.find(g => g.key === "all")?.items) || [];

  renderGamePills();
  renderFolderPills();
  renderGrid();
}

async function init() {
  state.games = (await loadGames())
    .slice()
    .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));

  // use ?game or default first game
  const initial = (qs("game") || state.games[0]?.key || "").toLowerCase();
  state.game = initial;

  renderGamePills();

  // Search input
  els.search.addEventListener("input", () => {
    state.q = els.search.value || "";
    renderGrid();
  });

  // Load initial game
  await switchGame(state.game, true);
}

window.addEventListener("popstate", async () => {
  const g = (qs("game") || state.games[0]?.key || "").toLowerCase();
  if (g && g !== state.game) {
    await switchGame(g, true);
  }
});

init().catch((e) => {
  console.error(e);
  els.grid.innerHTML = `<div style="padding:14px;color:#bbb;font-family:MC Five">Failed to load models. Check console.</div>`;
});
