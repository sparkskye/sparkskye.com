(() => {
  // ===== CONFIG =====
  const WORKER_BASE = "https://delicate-bush-cf6f.sparkskye-minecraft.workers.dev";
  const TYPE = document.documentElement.dataset.type || "models"; // "models" or "maps"
  const EXT = TYPE === "maps" ? "glb" : "gltf";

  const API_LIST_GAMES = `${WORKER_BASE}/api/games?type=${encodeURIComponent(TYPE)}`;
  const API_LIST_ITEMS = (game) => `${WORKER_BASE}/api/${TYPE}?game=${encodeURIComponent(game)}`;
  const API_FILE = (id, name) =>
    `${WORKER_BASE}/api/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&ext=${EXT}`;

  // Active previews cap (performance)
  const MAX_ACTIVE_VIEWERS = 12;

  // ===== DOM =====
  const elGameRow = document.querySelector("[data-games]");
  const elFolderRow = document.querySelector("[data-folders]");
  const elSearch = document.querySelector("[data-search]");
  const elCount = document.querySelector("[data-count]");
  const elGrid = document.querySelector("[data-grid]");
  const elStatus = document.querySelector("[data-status]");

  const modalBack = document.querySelector("[data-modal-back]");
  const modalTitle = document.querySelector("[data-modal-title]");
  const modalClose = document.querySelector("[data-modal-close]");
  const modalViewerHost = document.querySelector("[data-modal-viewer]");
  const modalDownload = document.querySelector("[data-modal-download]");
  const modalPath = document.querySelector("[data-modal-path]");

  // Global modal viewer (single)
  let modalViewer = null;

  // ===== STATE =====
  let games = [];
  let currentGame = null;
  let groups = [];
  let allItems = [];       // flattened items
  let folderFilter = "all";
  let searchTerm = "";

  // viewer management
  const activeViewers = new Map(); // cardId -> model-viewer element
  const viewerQueue = [];
  let pumping = false;

  // ===== Utilities =====
  const qs = (k) => new URL(location.href).searchParams.get(k);

  function setStatus(msg) {
    if (elStatus) elStatus.textContent = msg || "";
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function pill(label, { active = false, onClick } = {}) {
    const b = document.createElement("div");
    b.className = "pill" + (active ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function normalizeGameKey(nameOrKey) {
    return (nameOrKey || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // ===== Model Viewer loader =====
  function ensureModelViewerScript() {
    // already loaded?
    if (customElements.get("model-viewer")) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.type = "module";
      s.src = "https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load model-viewer"));
      document.head.appendChild(s);
    });
  }

  // ===== Fetch =====
  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  }

  async function loadGames() {
    const data = await fetchJSON(API_LIST_GAMES);
    games = (data.games || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadGameData(gameKey) {
    setStatus("Loading…");
    const data = await fetchJSON(API_LIST_ITEMS(gameKey));
    groups = data.groups || [];
    // Flatten while injecting useful fields
    const flat = [];
    for (const g of groups) {
      for (const it of (g.items || [])) {
        flat.push({
          ...it,
          game: data.game?.key || gameKey,
          groupKey: g.key,
          groupLabel: g.label,
          // if Apps Script "path" is relative inside game, make human-friendly
          displayPath: buildDisplayPath(data.game?.key || gameKey, it.path || it.folderLabel || ""),
        });
      }
    }
    allItems = flat;
    setStatus("");
  }

  function buildDisplayPath(gameKey, relPath) {
    const g = gameKey || "";
    const p = (relPath || "").replace(/\//g, " \\ ");
    return p ? `${g} \\ ${p}` : `${g}`;
  }

  // ===== Render =====
  function renderGamePills() {
    clearChildren(elGameRow);

    for (const g of games) {
      elGameRow.appendChild(
        pill(g.name, {
          active: currentGame === g.key,
          onClick: () => {
            if (currentGame === g.key) return;
            goToGame(g.key);
          },
        })
      );
    }
  }

  function renderFolderPills() {
    clearChildren(elFolderRow);

    // Build folder list from groups (excluding 'all' group)
    const folders = groups
      .filter((g) => g.key !== "all")
      .map((g) => ({ key: g.key, label: g.label }));

    // Sort alpha
    folders.sort((a, b) => a.label.localeCompare(b.label));

    elFolderRow.appendChild(
      pill("all " + (TYPE === "maps" ? "maps" : "models"), {
        active: folderFilter === "all",
        onClick: () => {
          folderFilter = "all";
          renderGrid();
        },
      })
    );

    for (const f of folders) {
      elFolderRow.appendChild(
        pill(f.label, {
          active: folderFilter === f.key,
          onClick: () => {
            folderFilter = f.key;
            renderGrid();
          },
        })
      );
    }
  }

  function applyFilters(items) {
    let out = items;

    if (folderFilter !== "all") {
      out = out.filter((it) => it.groupKey === folderFilter);
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      out = out.filter((it) => {
        const name = (it.name || "").toLowerCase();
        const path = (it.displayPath || "").toLowerCase();
        return name.includes(q) || path.includes(q);
      });
    }

    return out;
  }

  // progressive render
  let renderToken = 0;

  function renderGrid() {
    const token = ++renderToken;
    clearChildren(elGrid);
    destroyAllCardViewers();

    const filtered = applyFilters(allItems);

    if (elCount) elCount.textContent = `${filtered.length} shown`;

    // Render skeleton quickly, then let previews lazy-load
    const BATCH = 36;
    let idx = 0;

    function addBatch() {
      if (token !== renderToken) return;

      const slice = filtered.slice(idx, idx + BATCH);
      idx += slice.length;

      for (const item of slice) {
        elGrid.appendChild(createCard(item));
      }

      if (idx < filtered.length) {
        // Yield to keep UI snappy
        if ("requestIdleCallback" in window) {
          requestIdleCallback(addBatch, { timeout: 800 });
        } else {
          setTimeout(addBatch, 30);
        }
      }
    }

    addBatch();
  }

  function createCard(item) {
    const card = document.createElement("div");
    card.className = "card";
    const cardId = `${item.modelId}-${Math.random().toString(16).slice(2)}`;
    card.dataset.cardId = cardId;

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.dataset.lazy = "1";
    thumb.dataset.id = item.modelId;
    thumb.dataset.name = item.name;
    thumb.dataset.ext = item.ext || EXT;

    // No ugly "3D" label; keep empty until viewer appears
    // Optional: tiny loader
    const loader = document.createElement("div");
    loader.className = "smallMuted";
    loader.textContent = "";
    thumb.appendChild(loader);

    const meta = document.createElement("div");
    meta.className = "meta";

    const nameRow = document.createElement("div");
    nameRow.className = "name";

    const nameLink = document.createElement("a");
    nameLink.href = API_FILE(item.modelId, item.name);
    nameLink.textContent = item.name || "unnamed";
    nameLink.title = "Download";
    nameLink.addEventListener("click", (e) => {
      e.preventDefault();
      triggerDownload(item);
    });

    const extBadge = document.createElement("div");
    extBadge.className = "badge ext";
    extBadge.textContent = "." + (item.ext || EXT);

    nameRow.appendChild(nameLink);
    nameRow.appendChild(extBadge);

    const badges = document.createElement("div");
    badges.className = "badges";

    const groupBadge = document.createElement("div");
    groupBadge.className = "badge";
    groupBadge.textContent = (item.groupLabel || item.folderLabel || "folder").toString();
    badges.appendChild(groupBadge);

    const path = document.createElement("div");
    path.className = "path";
    path.textContent = item.displayPath || item.game;

    meta.appendChild(nameRow);
    meta.appendChild(badges);
    meta.appendChild(path);

    card.appendChild(thumb);
    card.appendChild(meta);

    // clicking card opens modal (but not clicking the name link)
    card.addEventListener("click", (e) => {
      // if they clicked the link, ignore (handled above)
      if (e.target && e.target.closest("a")) return;
      openModal(item);
    });

    // lazy attach viewer when visible
    observeThumb(thumb, cardId, item);

    return card;
  }

  function triggerDownload(item) {
    const a = document.createElement("a");
    a.href = API_FILE(item.modelId, item.name);
    a.download = `${item.name}.${EXT}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ===== Lazy viewers (fast) =====
  let io = null;

  function ensureObserver() {
    if (io) return;
    io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          const thumb = ent.target;
          if (ent.isIntersecting) {
            const cardId = thumb.closest(".card")?.dataset.cardId;
            if (!cardId) continue;

            // queue creation to keep concurrency sane
            queueViewerCreate({ thumb, cardId });
            io.unobserve(thumb);
          }
        }
      },
      { rootMargin: "250px 0px", threshold: 0.05 }
    );
  }

  function observeThumb(thumb) {
    ensureObserver();
    io.observe(thumb);
  }

  function queueViewerCreate(job) {
    viewerQueue.push(job);
    pumpQueue();
  }

  async function pumpQueue() {
    if (pumping) return;
    pumping = true;

    try {
      // ensure <model-viewer> available once
      await ensureModelViewerScript();

      while (viewerQueue.length) {
        // cap active viewers
        while (activeViewers.size >= MAX_ACTIVE_VIEWERS) {
          // remove the oldest viewer
          const firstKey = activeViewers.keys().next().value;
          if (!firstKey) break;
          destroyCardViewer(firstKey);
        }

        const job = viewerQueue.shift();
        if (!job) break;

        const { thumb, cardId } = job;

        // If thumb already has a viewer, skip
        if (activeViewers.has(cardId)) continue;

        const id = thumb.dataset.id;
        const name = thumb.dataset.name || "asset";

        // Build proxied model URL (CORS-safe)
        const src = API_FILE(id, name);

        // Make the viewer
        const mv = document.createElement("model-viewer");
        mv.setAttribute("src", src);
        mv.setAttribute("loading", "lazy");
        mv.setAttribute("reveal", "auto");
        mv.setAttribute("camera-controls", "");
        mv.setAttribute("touch-action", "pan-y");
        mv.setAttribute("interaction-prompt", "none");
        mv.setAttribute("shadow-intensity", "0");
        mv.setAttribute("environment-image", "neutral");
        mv.setAttribute("exposure", "1.0");
        mv.setAttribute("min-camera-orbit", "auto auto 0.5m");
        mv.setAttribute("max-camera-orbit", "auto auto 12m");

        // rotate 180° so it's not backwards
        mv.setAttribute("orientation", "0deg 180deg 0deg");

        // Keep it light
        mv.style.background = "transparent";
        mv.style.display = "block";

        // Replace thumb content
        thumb.textContent = "";
        thumb.appendChild(mv);

        activeViewers.set(cardId, mv);

        // small stagger so we don't spike
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      pumping = false;
    }
  }

  function destroyCardViewer(cardId) {
    const mv = activeViewers.get(cardId);
    if (!mv) return;
    const thumb = mv.parentElement;
    mv.remove();
    activeViewers.delete(cardId);

    // leave thumb empty (no "3D" label)
    if (thumb) {
      thumb.textContent = "";
    }
  }

  function destroyAllCardViewers() {
    for (const key of Array.from(activeViewers.keys())) {
      destroyCardViewer(key);
    }
  }

  // ===== Modal =====
  async function openModal(item) {
    await ensureModelViewerScript();

    modalBack.classList.add("open");
    modalTitle.textContent = item.name || "preview";
    modalPath.textContent = item.displayPath || "";

    const src = API_FILE(item.modelId, item.name);
    modalDownload.onclick = () => triggerDownload(item);

    // Create once
    if (!modalViewer) {
      modalViewer = document.createElement("model-viewer");
      modalViewer.setAttribute("camera-controls", "");
      modalViewer.setAttribute("touch-action", "none");
      modalViewer.setAttribute("interaction-prompt", "none");
      modalViewer.setAttribute("shadow-intensity", "0");
      modalViewer.setAttribute("environment-image", "neutral");
      modalViewer.setAttribute("exposure", "1.0");
      modalViewer.style.background = "transparent";
      modalViewer.style.width = "100%";
      modalViewer.style.height = "100%";
      modalViewerHost.appendChild(modalViewer);
    }

    modalViewer.setAttribute("src", src);
    modalViewer.setAttribute("orientation", "0deg 180deg 0deg");
  }

  function closeModal() {
    modalBack.classList.remove("open");
  }

  modalClose.addEventListener("click", closeModal);
  modalBack.addEventListener("click", (e) => {
    if (e.target === modalBack) closeModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ===== Routing =====
  async function goToGame(gameKey) {
    const sp = new URLSearchParams(location.search);
    sp.set("game", gameKey);
    history.replaceState({}, "", `${location.pathname}?${sp.toString()}`);

    currentGame = gameKey;
    renderGamePills();

    await loadGameData(gameKey);

    // reset filters
    folderFilter = "all";
    searchTerm = "";
    if (elSearch) elSearch.value = "";

    renderFolderPills();
    renderGrid();
  }

  // ===== Init =====
  async function init() {
    try {
      setStatus("Loading…");

      await loadGames();

      // Pick current game from URL or first
      const urlGame = normalizeGameKey(qs("game"));
      const first = games[0]?.key;

      currentGame = games.some((g) => g.key === urlGame) ? urlGame : first;

      renderGamePills();

      await loadGameData(currentGame);

      renderFolderPills();

      if (elSearch) {
        elSearch.addEventListener("input", () => {
          searchTerm = (elSearch.value || "").trim();
          renderGrid();
        });
      }

      setStatus("");
      renderGrid();
    } catch (err) {
      console.error(err);
      setStatus("Failed to load. Check console.");
    }
  }

  init();
})();
