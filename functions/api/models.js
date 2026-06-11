const MODELS_SCRIPT = "https://script.google.com/macros/s/AKfycbxwo50cJWxjW95aoG1QeoxBRlUAIVrYPc3VHuaDUw2Vkst-2k05fltz8s__nIku7JL7lQ/exec";
const MODELS_ROOT_FOLDER_ID = "1EDvnoznesACjnSB6OwhR34w6WLjvZqbZ";

// Manual fallback/override for newly-added model folders that may not be returned
// by older Apps Script deployments yet.
const MANUAL_MODEL_GAMES = [
  { key: "replay-cinema", label: "REPLAY CINEMA", name: "Replay Cinema", folderId: "1P2sg0i5aX8Fhg91EA1r9IBiXjHw62hHJ" },
];

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsJsonHeaders_() });
  }

  if (requestUrl.searchParams.get("list") === "1") {
    const games = await listModelGames_();
    return jsonResponse_({ games }, 200, 300);
  }

  const selectedGame = slugify_(requestUrl.searchParams.get("game") || "");
  const manualMatch = MANUAL_MODEL_GAMES.find((g) => g.key === selectedGame);

  // Try the Apps Script first. For manual entries, also pass folderId in case the
  // Apps Script supports direct folder loading.
  const upstream = new URL(MODELS_SCRIPT);
  for (const [k, v] of requestUrl.searchParams.entries()) upstream.searchParams.set(k, v);
  if (manualMatch?.folderId) upstream.searchParams.set("folderId", manualMatch.folderId);

  let upstreamResponse = null;
  let upstreamText = "";

  try {
    upstreamResponse = await fetch(upstream.toString(), {
      headers: { "User-Agent": "sparkskye-pages-proxy" },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    upstreamText = await upstreamResponse.text();

    // If this is a normal gamemode, just return the Apps Script response.
    if (!manualMatch) {
      return new Response(upstreamText, {
        status: upstreamResponse.status,
        headers: corsJsonHeaders_(300),
      });
    }

    // If this is a manual gamemode and the Apps Script clearly returned data for it,
    // use that. Otherwise fall back to public Drive folder scraping below.
    if (upstreamResponse.ok && payloadLooksLikeSelectedGame_(upstreamText, selectedGame)) {
      return new Response(upstreamText, {
        status: upstreamResponse.status,
        headers: corsJsonHeaders_(300),
      });
    }
  } catch {}

  // Manual-drive fallback for newly added gamemode folders.
  if (manualMatch?.folderId) {
    const fallback = await buildManualModelGameResponse_(manualMatch).catch(() => null);
    if (fallback && countPayloadItems_(fallback) > 0) return jsonResponse_(fallback, 200, 300);
  }

  // Last resort: return whatever the Apps Script gave us, or a safe empty result.
  if (upstreamResponse) {
    return new Response(upstreamText || "{}", {
      status: upstreamResponse.status,
      headers: corsJsonHeaders_(300),
    });
  }

  return jsonResponse_({ game: { key: selectedGame, label: selectedGame.toUpperCase() }, groups: [] }, 200, 60);
}

async function listModelGames_() {
  const merged = new Map();
  const add = (g) => {
    const key = slugify_(g?.key || g?.slug || g?.name || g?.label || "");
    const label = String(g?.label || g?.name || g?.title || key || "").trim();
    if (!key) return;
    merged.set(key, {
      key,
      label: label.toUpperCase(),
      name: label,
      folderId: g?.folderId || g?.id || "",
    });
  };

  // First, ask the Apps Script in case it already supports list=1.
  try {
    const upstream = new URL(MODELS_SCRIPT);
    upstream.searchParams.set("list", "1");
    upstream.searchParams.set("root", MODELS_ROOT_FOLDER_ID);
    const res = await fetch(upstream.toString(), {
      headers: { "User-Agent": "sparkskye-pages-proxy" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (res.ok) {
      const parsed = await res.clone().json().catch(() => null);
      const raw = Array.isArray(parsed?.games) ? parsed.games : Array.isArray(parsed) ? parsed : [];
      for (const g of raw) add(g);
    }
  } catch {}

  // Best-effort public Drive fallback. This depends on the Drive folder being public.
  // If Drive changes its HTML, the static fallback in models/index.html still protects the UI.
  if (merged.size < 4) {
    try {
      const driveGames = await scrapeDriveFolderEntries_(MODELS_ROOT_FOLDER_ID);
      for (const g of driveGames.folders) add(g);
    } catch {}
  }

  for (const g of MANUAL_MODEL_GAMES) add(g);

  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function buildManualModelGameResponse_(game) {
  const top = await scrapeDriveFolderEntries_(game.folderId);
  const topLevelFolders = top.folders || [];
  const topLevelFiles = top.files || [];

  const groups = [];
  const allItems = [];

  for (const f of topLevelFiles) {
    if (!isModelFile_(f.name)) continue;
    const item = toModelItem_(f, game.name, game.name);
    allItems.push(item);
  }

  for (const folder of topLevelFolders) {
    const folderTree = await scrapeDriveFolderTree_(folder.id, folder.name, 1, 2).catch(() => ({ files: [], folders: [] }));
    const items = [];

    for (const file of folderTree.files || []) {
      if (!isModelFile_(file.name)) continue;
      const folderLabel = file.path || folder.name;
      const item = toModelItem_(file, folderLabel, folderLabel);
      items.push(item);
      allItems.push(item);
    }

    if (items.length) {
      groups.push({ key: slugify_(folder.name), label: folder.name, items });
    }
  }

  if (allItems.length) {
    groups.unshift({ key: "all", label: "ALL", items: allItems });
  }

  return {
    game: { key: game.key, label: game.label, name: game.name, folderId: game.folderId },
    groups,
  };
}

async function scrapeDriveFolderTree_(folderId, prefix = "", depth = 0, maxDepth = 2) {
  const entries = await scrapeDriveFolderEntries_(folderId);
  const files = entries.files.map((file) => ({ ...file, path: prefix || "" }));
  const folders = entries.folders.map((folder) => ({ ...folder, path: prefix ? `${prefix} / ${folder.name}` : folder.name }));

  if (depth < maxDepth) {
    for (const folder of entries.folders) {
      const childPrefix = prefix ? `${prefix} / ${folder.name}` : folder.name;
      const child = await scrapeDriveFolderTree_(folder.id, childPrefix, depth + 1, maxDepth).catch(() => ({ files: [], folders: [] }));
      files.push(...child.files);
      folders.push(...child.folders);
    }
  }

  return { files, folders };
}

async function scrapeDriveFolderEntries_(folderId) {
  const urls = [
    `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
    `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
  ];

  const out = { files: [], folders: [] };
  const seen = new Set();

  for (const url of urls) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 sparkskye-pages-proxy" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) continue;
    const html = await res.text();

    // Embedded folder view often includes normal links for files and folders.
    for (const m of html.matchAll(/href="https:\/\/drive\.google\.com\/(?:file\/d\/([a-zA-Z0-9_-]+)|drive\/folders\/([a-zA-Z0-9_-]+))[^\"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
      const fileId = m[1] || "";
      const folderIdMatch = m[2] || "";
      const name = cleanLinkText_(m[3]);
      const id = fileId || folderIdMatch;
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      if (folderIdMatch) out.folders.push({ id, name, label: name });
      else out.files.push({ id, name, fileId: id });
    }

    // Normal Drive pages often store names in escaped JSON blobs. These matches are
    // best-effort and intentionally secondary to the embedded view above.
    for (const m of html.matchAll(/\["([a-zA-Z0-9_-]{20,})"(?:,[^\]]+?){1,4},"([^"]{2,100})"/g)) {
      const id = m[1];
      const name = decodeHtml_(m[2]).trim();
      if (!id || !name || seen.has(id)) continue;
      if (/^(application\/|image\/|video\/|audio\/)/i.test(name)) continue;
      seen.add(id);
      if (isModelFile_(name)) out.files.push({ id, name, fileId: id });
      else out.folders.push({ id, name, label: name });
    }

    if (out.files.length || out.folders.length) break;
  }

  return out;
}

function toModelItem_(file, folderLabel, relPath) {
  return {
    name: stripModelExtension_(file.name),
    modelId: file.fileId || file.id,
    id: file.fileId || file.id,
    fileId: file.fileId || file.id,
    folderLabel,
    path: relPath || folderLabel || "",
    ext: getExtension_(file.name) || "gltf",
  };
}

function payloadLooksLikeSelectedGame_(text, selectedGame) {
  const parsed = safeJson_(text);
  if (!parsed) return false;

  const gameKey = slugify_(parsed?.game?.key || parsed?.game?.slug || parsed?.game?.name || parsed?.game?.label || "");
  if (gameKey && gameKey !== selectedGame) return false;

  return countPayloadItems_(parsed) > 0;
}

function countPayloadItems_(payload) {
  let total = 0;
  if (Array.isArray(payload?.rootItems)) total += payload.rootItems.length;
  if (Array.isArray(payload?.items)) total += payload.items.length;
  if (Array.isArray(payload?.models)) total += payload.models.length;
  if (Array.isArray(payload?.groups)) {
    for (const group of payload.groups) total += Array.isArray(group?.items) ? group.items.length : 0;
  }
  return total;
}

function isModelFile_(name) {
  return /\.(glb|gltf)$/i.test(String(name || ""));
}

function stripModelExtension_(name) {
  return String(name || "").replace(/\.(glb|gltf)$/i, "");
}

function getExtension_(name) {
  const m = String(name || "").match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function cleanLinkText_(html) {
  return decodeHtml_(String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function safeJson_(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function slugify_(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeHtml_(s) {
  return String(s || "")
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function jsonResponse_(payload, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsJsonHeaders_(maxAge),
  });
}

function corsJsonHeaders_(maxAge = 60) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": `public, max-age=${maxAge}`,
  };
}
