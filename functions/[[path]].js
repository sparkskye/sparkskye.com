const ACCENT = "#00aaff";

const KIND_ALIASES = {
  animation: "animations",
  animations: "animations",
  editing: "editing",
  video: "editing",
  videos: "editing",
  design: "design",
  designs: "design",
  art: "art",
  arts: "art",
  map: "maps",
  maps: "maps",
  model: "models",
  models: "models",
};

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const previewId = requestUrl.searchParams.get("preview");

  // Let normal visitors receive the real static page. Social/Discord bots get
  // the metadata-only page for the same clean preview URL.
  if (!previewId || !shouldServeEmbed_(context.request)) {
    return context.next();
  }

  const kind = kindFromPath_(requestUrl.pathname);
  if (!kind) return context.next();

  const id = decodeURIComponent(previewId).trim();
  let meta = null;
  try {
    if (kind === "animations") meta = await getAnimationMeta_(requestUrl, id);
    if (kind === "editing") meta = await getEditingMeta_(requestUrl, id);
    if (kind === "design") meta = await getDesignMeta_(requestUrl, id);
    if (kind === "art") meta = await getArtMeta_(requestUrl, id);
    if (kind === "maps") meta = await getMapMeta_(requestUrl, id);
    if (kind === "models") meta = await getModelMeta_(requestUrl, id);
  } catch {
    meta = null;
  }

  const destination = `${requestUrl.pathname}${requestUrl.search}`;
  const title = meta?.title || fallbackTitle_(kind);
  const description = meta?.description || fallbackDescription_(kind);
  const image = meta?.image === null ? null : absoluteUrl_(meta?.image || fallbackImage_(kind), requestUrl.origin);
  const accent = themeColor_(kind);

  return htmlResponse_(renderShareHtml_({
    title,
    description,
    image,
    destination,
    pageUrl: requestUrl.toString(),
    accent,
  }), 200);
}

function shouldServeEmbed_(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("embed") === "1") return true;
  const ua = String(request.headers.get("user-agent") || "").toLowerCase();
  return /discordbot|twitterbot|slackbot|facebookexternalhit|facebot|linkedinbot|whatsapp|telegrambot|skypeuripreview|pinterest|embedly|quora link preview|applebot|messages/i.test(ua);
}

function kindFromPath_(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "").toLowerCase();
  if (p === "/animations") return "animations";
  if (p === "/editing") return "editing";
  if (p === "/design") return "design";
  if (p === "/art") return "art";
  if (p === "/hive-resources/maps") return "maps";
  if (p === "/hive-resources/models") return "models";
  return "";
}

function themeColor_(kind) {
  if (kind === "animations") return "#598ffe";
  if (kind === "editing") return "#f0593a";
  if (kind === "design") return "#894bdd";
  if (kind === "art") return "#fbbc42";
  if (kind === "maps" || kind === "models") return "#00aaff";
  return "#00aaff";
}

async function getAnimationMeta_(requestUrl, id) {
  const api = new URL("/api/animations", requestUrl.origin);
  api.searchParams.set("category", "all");
  const res = await fetch(api.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`animations api ${res.status}`);
  const json = await res.json();
  const item = (json.items || []).find((x) => String(x.id) === String(id));
  if (!item) throw new Error("animation not found");
  return {
    title: item.name || "sparkskye animation",
    description: formatAnimationList_(item) || "animation file",
    image: item.thumbnailUrl || item.files?.video?.thumbnailUrl || "/public/img/favicon.png",
  };
}

async function getEditingMeta_(requestUrl, id) {
  const api = new URL("/api/youtube", requestUrl.origin);
  api.searchParams.set("handle", "@sparkskye");
  api.searchParams.set("typeMode", "youtube-tabs-v1");
  const res = await fetch(api.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`youtube api ${res.status}`);
  const json = await res.json();
  const item = (json.items || []).find((x) => String(x.id) === String(id));
  if (!item) throw new Error("video not found");
  return {
    title: item.title || "sparkskye video",
    description: `${formatViews_(item.viewCount)} views, ${shortDate_(item.publishedAt)}`,
    image: item.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`,
  };
}

async function getDesignMeta_(requestUrl, id) {
  const api = new URL("/api/design", requestUrl.origin);
  api.searchParams.set("category", "all");
  const res = await fetch(api.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`design api ${res.status}`);
  const json = await res.json();
  const item = (json.items || []).find((x) => String(x.id) === String(id));
  if (!item) throw new Error("design not found");
  return {
    title: item.name || "sparkskye design",
    description: formatDesignList_(item) || "design file",
    image: item.imagePreviewUrl || item.files?.image?.previewUrl || item.thumbnailUrl || "/public/img/favicon.png",
  };
}

async function getArtMeta_(requestUrl, id) {
  const api = new URL("/api/art", requestUrl.origin);
  api.searchParams.set("category", "all");
  const res = await fetch(api.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`art api ${res.status}`);
  const json = await res.json();
  const item = (json.items || []).find((x) => String(x.id) === String(id));
  if (!item) throw new Error("art not found");
  const isModel = String(item.kind || "").toLowerCase() === "model";
  const isTexture = String(item.kind || "").toLowerCase() === "texture-pack";
  return {
    title: item.name || "sparkskye art",
    description: formatArtList_(item) || "art file",
    image: isModel ? null : (isTexture ? (item.thumbnailUrl || item.trailer?.thumbnail || "/public/img/favicon.png") : (item.imagePreviewUrl || item.files?.image?.previewUrl || item.thumbnailUrl || "/public/img/favicon.png")),
  };
}

async function getMapMeta_(requestUrl, id) {
  const go = parseGoUrl_(requestUrl);
  const game = requestUrl.searchParams.get("game") || go.searchParams.get("game") || "all";
  const api = new URL("/api/maps", requestUrl.origin);
  if (game) api.searchParams.set("game", game);
  const res = await fetch(api.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`maps api ${res.status}`);
  const json = await res.json();
  const items = flattenMapItems_(json, game);
  const item = items.find((x) => String(x.glbId || x.thumbId || "") === String(id));
  if (!item) throw new Error("map not found");
  const image = item.thumbUrl || (item.thumbId ? `/api/file?id=${encodeURIComponent(item.thumbId)}&inline=1` : "/public/img/favicon.png");
  return {
    title: item.name || "hive map",
    description: buildPathText_(item.gameKey || game, item.relPath || item.modeLabel || ""),
    image,
  };
}

async function getModelMeta_(requestUrl, id) {
  const go = parseGoUrl_(requestUrl);
  const game = requestUrl.searchParams.get("game") || go.searchParams.get("game") || "all";
  const api = new URL("/api/models", requestUrl.origin);
  if (game) api.searchParams.set("game", game);
  const res = await fetch(api.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`models api ${res.status}`);
  const json = await res.json();
  const items = flattenModelItems_(json, game);
  const item = items.find((x) => String(x.modelId || "") === String(id));
  if (!item) throw new Error("model not found");
  return {
    title: item.name || "hive model",
    description: buildPathText_(game, item.relPath || item.folderLabel || ""),
    image: null,
  };
}

function renderShareHtml_({ title, description, image, destination, pageUrl = "", accent = ACCENT }) {
  const t = esc_(title);
  const d = esc_(description);
  const img = image ? esc_(image) : "";
  const dest = esc_(destination);
  const url = esc_(pageUrl || destination);
  const imageTags = img ? `\n<meta property="og:image" content="${img}">\n<meta property="og:image:alt" content="${t}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${img}">` : `\n<meta name="twitter:card" content="summary">`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="theme-color" content="${esc_(accent)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="sparkskye">
<meta name="author" content="sparkskye">
<link rel="author" href="https://sparkskye.com/">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">${imageTags}
<meta property="og:url" content="${url}">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta http-equiv="refresh" content="0; url=${dest}">
<style>body{margin:0;background:#141414;color:#f2f2f2;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}a{color:${esc_(accent)}}</style>
</head>
<body>
  <p><a href="${dest}">Open ${t}</a></p>
  <script>location.replace(${JSON.stringify(destination)});</script>
</body>
</html>`;
}

function htmlResponse_(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

function flattenMapItems_(json, gameKey) {
  const groups = json.groups || json.modes || json.folders || [];
  const out = [];
  const seen = new Set();

  const addItem = (it, group = {}) => {
    const glbId = pickMapGlbId_(it);
    const thumb = pickMapThumb_(it);
    const dedupeKey = glbId || thumb.id || `${it.name || it.title || ""}::${it.path || it.modeLabel || it.folderLabel || group.label || ""}`;
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({
      name: it.name || it.title || "hive map",
      gameKey,
      glbId,
      thumbId: thumb.id,
      thumbUrl: thumb.url,
      relPath: it.path || it.modeLabel || it.folderLabel || group.label || "",
      modeLabel: it.modeLabel || it.folderLabel || group.label || "",
    });
  };

  for (const group of groups) {
    const key = String(group.key || "").toLowerCase();
    if (key === "all") continue;
    for (const it of group.items || []) addItem(it, group);
  }

  const allGroup = groups.find((g) => String(g.key || "").toLowerCase() === "all");
  for (const it of allGroup?.items || []) addItem(it, allGroup || {});

  for (const it of json.items || json.maps || json.rootItems || []) addItem(it, {});
  return out;
}

function flattenModelItems_(json, gameKey) {
  const groups = json.groups || json.folders || json.modes || [];
  const out = [];
  const seen = new Set();

  const addItem = (it, group = {}) => {
    const modelId = it.modelId || it.id || it.fileId || it.assetId || "";
    const dedupeKey = modelId || `${it.name || it.title || ""}::${it.path || it.folderLabel || group.label || ""}`;
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({
      name: it.name || it.title || "hive model",
      modelId,
      relPath: it.path || it.folderLabel || group.label || "",
      folderLabel: it.folderLabel || group.label || "",
      gameKey,
    });
  };

  for (const group of groups) {
    const key = String(group.key || "").toLowerCase();
    if (key === "all") continue;
    for (const it of group.items || []) addItem(it, group);
  }

  const allGroup = groups.find((g) => String(g.key || "").toLowerCase() === "all");
  for (const it of allGroup?.items || []) addItem(it, allGroup || {});

  for (const it of json.items || json.models || json.rootItems || []) addItem(it, {});
  return out;
}

function pickMapGlbId_(it) {
  return it.glbId || it.modelId || it.mapId || it.id || it.fileId || it.assetId || "";
}

function pickMapThumb_(it) {
  return {
    id: it.thumbId || it.pngId || it.imageId || it.minimapId || it.thumbnailId || it.previewId || "",
    url: it.thumbUrl || it.pngUrl || it.thumbnailUrl || it.previewUrl || "",
  };
}

function fallbackDestination_(kind, id, requestUrl) {
  if (kind === "animations") return `/animations/?preview=${encodeURIComponent(id)}`;
  if (kind === "editing") return `/editing/?preview=${encodeURIComponent(id)}`;
  if (kind === "design") return `/design/?preview=${encodeURIComponent(id)}`;
  if (kind === "maps") {
    const game = requestUrl.searchParams.get("game") || "all";
    const mode = requestUrl.searchParams.get("mode") || "";
    const qs = new URLSearchParams();
    if (game) qs.set("game", game);
    if (mode) qs.set("mode", mode);
    qs.set("preview", id);
    return `/hive-resources/maps/?${qs.toString()}`;
  }
  if (kind === "models") {
    const game = requestUrl.searchParams.get("game") || "all";
    const folder = requestUrl.searchParams.get("folder") || "";
    const qs = new URLSearchParams();
    if (game) qs.set("game", game);
    if (folder) qs.set("folder", folder);
    qs.set("preview", id);
    return `/hive-resources/models/?${qs.toString()}`;
  }
  return "/";
}

function fallbackTitle_(kind) {
  if (kind === "animations") return "sparkskye animation";
  if (kind === "editing") return "sparkskye video";
  if (kind === "design") return "sparkskye design";
  if (kind === "art") return "sparkskye art";
  if (kind === "maps") return "hive map";
  if (kind === "models") return "hive model";
  return "sparkskye";
}

function fallbackDescription_(kind) {
  if (kind === "animations") return "2d and 3d animations i've made";
  if (kind === "editing") return "my youtube videos";
  if (kind === "design") return "thumbnails, profiles, banners, and other graphic design work";
  if (kind === "art") return "pixel art, texture packs, and other arts";
  if (kind === "maps") return "hive resources map";
  if (kind === "models") return "hive resources model";
  return "sparkskye creations";
}

function fallbackImage_(kind) {
  if (kind === "models") return null;
  return "/public/img/favicon.png";
}

function parseGoUrl_(requestUrl) {
  try {
    const raw = requestUrl.searchParams.get("go") || "/";
    return new URL(raw, requestUrl.origin);
  } catch {
    return new URL("/", requestUrl.origin);
  }
}

function normalizeParts_(path) {
  if (Array.isArray(path)) return path;
  return String(path || "").split("/").filter(Boolean);
}

function safeGo_(go) {
  const s = String(go || "").trim();
  if (!s || !s.startsWith("/")) return "";
  if (s.startsWith("//")) return "";
  return s;
}

function absoluteUrl_(url, origin) {
  if (url === null) return null;
  try { return new URL(url, origin).toString(); }
  catch { return `${origin}/public/img/favicon.png`; }
}

function esc_(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" }[ch]));
}

function formatViews_(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("en-US").format(num);
}

function shortDate_(iso) {
  if (!iso) return "—";
  try { return new Intl.DateTimeFormat("en-US", { year:"numeric", month:"numeric", day:"numeric" }).format(new Date(iso)); }
  catch { return "—"; }
}

function formatAnimationList_(item) {
  const preferred = ["video", "blend"];
  const files = item.files || {};
  return preferred
    .filter((key) => files[key])
    .concat((item.formats || []).map((f) => f.key).filter((key) => key && !preferred.includes(key)))
    .filter((key, idx, arr) => arr.indexOf(key) === idx)
    .map((key) => String(key).toLowerCase())
    .join(", ");
}

function formatDesignList_(item) {
  const preferred = ["image", "psd", "timelapse", "blend", "nomad"];
  const files = item.files || {};
  return preferred
    .filter((key) => files[key])
    .concat((item.formats || []).map((f) => f.key).filter((key) => key && !preferred.includes(key)))
    .filter((key, idx, arr) => arr.indexOf(key) === idx)
    .map((key) => String(key).toLowerCase())
    .join(", ");
}

function formatArtList_(item) {
  const kind = String(item.kind || "").toLowerCase();
  const preferred = kind === "model"
    ? ["gltf", "glb", "bbmodel", "texture", "json", "zip", "blend"]
    : kind === "texture-pack"
      ? ["trailer", "mcpack", "zip", "mcaddon"]
      : ["image", "timelapse", "psd", "blend", "nomad", "bbmodel", "zip"];
  const files = item.files || {};
  const labels = preferred
    .filter((key) => key === "trailer" ? item.trailer : files[key])
    .concat((item.formats || []).map((f) => f.key).filter((key) => key && !preferred.includes(key)))
    .filter((key, idx, arr) => arr.indexOf(key) === idx)
    .map((key) => String(key).toLowerCase());
  return labels.join(", ");
}

function buildPathText_(gameKey, path) {
  const g = String(gameKey || "").toUpperCase();
  const p = String(path || "")
    .replace(/^\/+/, "")
    .replace(/\//g, " \\ ")
    .trim();
  return p ? `${g} \\ ${p.toUpperCase()}` : g;
}
