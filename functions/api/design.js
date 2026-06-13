const DESIGN_ROOT_FOLDER_ID = "1DUmxNnEdzNo55jmW32nxEQW4GtWFNyAk";

const MANUAL_CATEGORIES = [
  {
    key: "thumbnail",
    label: "THUMBNAIL",
    name: "Thumbnail",
    folderId: "1BdY45PsEiH_Ok7LOoz4gA9dh8oMKQAAe",
    formats: {
      image: "11glK03RH_oCvtEPodbcYlG_Cj1wEIRTf",
      timelapse: "10ZCgk3dc4NGbHip00qcbQQ2YEwbrsncs",
      psd: "1SLVCnMkZyEK7IzaVcEiFmFqFkYqsjr8B",
      blend: "1us9v1i-3iPRnHNTrfmV5VZC-CviFHc8s",
      nomad: "1O6TY6VK2k2hvY5MA16nid-4m4QyygW7U",
    },
  },
];

const FORMAT_LABELS = {
  image: "IMAGE",
  images: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  png: "IMAGE",
  webp: "IMAGE",
  timelapse: "TIMELAPSE",
  timelapses: "TIMELAPSE",
  mp4: "TIMELAPSE",
  mov: "TIMELAPSE",
  webm: "TIMELAPSE",
  psd: "PSD",
  blend: "BLEND",
  nomad: "NOMAD",
};

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const apiKey = context.env?.GOOGLE_API_KEY || context.env?.DRIVE_API_KEY || "";
  const debugMode = requestUrl.searchParams.get("debug") === "1";
  const debug = [];

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsJsonHeaders_(60) });
  }

  if (requestUrl.searchParams.get("list") === "1") {
    const categories = await listCategories_(apiKey, debug);
    return jsonResponse_({
      categories,
      driveApiEnabled: !!apiKey,
      ...(debugMode ? { debug } : {}),
    }, 200, debugMode ? 0 : 60);
  }

  const selected = canonicalCategoryKey_(requestUrl.searchParams.get("category") || "all");
  const categories = await listCategories_(apiKey, debug);
  const wanted = selected && selected !== "all"
    ? categories.filter((c) => canonicalCategoryKey_(c.key) === selected)
    : categories;

  const groups = [];
  const allItems = [];

  for (const category of wanted) {
    const built = await buildCategory_(category, apiKey, debug).catch((err) => {
      debug.push({ step: "build-category-error", category: category.key, message: String(err?.message || err) });
      return { items: [] };
    });
    groups.push({ key: category.key, label: category.label, folderId: category.folderId, items: built.items });
    allItems.push(...built.items);
  }

  if (selected === "all") groups.unshift({ key: "all", label: "ALL DESIGN", items: allItems });

  return jsonResponse_({
    root: { id: DESIGN_ROOT_FOLDER_ID, label: "DESIGN" },
    categories,
    groups,
    items: allItems,
    driveApiEnabled: !!apiKey,
    ...(debugMode ? { debug } : {}),
  }, 200, debugMode ? 0 : 60);
}

async function listCategories_(apiKey, debug) {
  const merged = new Map();
  const add = (c) => {
    const rawKey = c?.key || c?.name || c?.label || "";
    const canonical = canonicalCategoryKey_(rawKey);
    if (!canonical) return;
    const label = String(c?.label || c?.name || canonical || "").trim().toUpperCase();
    const current = merged.get(canonical) || {};
    merged.set(canonical, {
      key: canonical,
      label: current.label || label,
      name: current.name || c?.name || titleCase_(label),
      folderId: current.folderId || c?.folderId || c?.id || "",
      formats: { ...(current.formats || {}), ...(c?.formats || {}) },
    });
  };

  for (const c of MANUAL_CATEGORIES) add(c);

  try {
    const root = await listDriveFolderEntries_(DESIGN_ROOT_FOLDER_ID, apiKey, debug, "design-root");
    for (const folder of root.folders || []) add({ name: folder.name, folderId: folder.id });
  } catch (err) {
    debug.push({ step: "root-category-list-error", message: String(err?.message || err) });
  }

  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function buildCategory_(category, apiKey, debug) {
  const formatFolders = new Map();

  for (const [key, id] of Object.entries(category.formats || {})) {
    const fmtKey = canonicalFormatKey_(key);
    if (!fmtKey || !id) continue;
    formatFolders.set(fmtKey, { key: fmtKey, label: FORMAT_LABELS[fmtKey] || key.toUpperCase(), folderId: id });
  }

  // Future-friendly fallback: if the category folder contains folders named
  // image/psd/blend/etc., pick them up automatically.
  if (category.folderId) {
    try {
      const entries = await listDriveFolderEntries_(category.folderId, apiKey, debug, `category:${category.key}`);
      for (const folder of entries.folders || []) {
        const key = canonicalFormatKey_(folder.name);
        if (!key || formatFolders.has(key)) continue;
        formatFolders.set(key, { key, label: FORMAT_LABELS[key] || folder.name.toUpperCase(), folderId: folder.id });
      }
    } catch (err) {
      debug.push({ step: "category-folder-list-error", category: category.key, message: String(err?.message || err) });
    }
  }

  const collected = [];

  for (const format of formatFolders.values()) {
    if (!format.folderId) continue;
    const entries = await listDriveFolderEntries_(format.folderId, apiKey, debug, `format:${category.key}/${format.key}`).catch((err) => {
      debug.push({ step: "format-folder-list-error", category: category.key, format: format.key, folderId: format.folderId, message: String(err?.message || err) });
      return { files: [], folders: [] };
    });

    for (const file of entries.files || []) {
      const rawExt = getExtension_(file.name) || extFromMime_(file.mimeType) || format.key;
      const baseName = stripExtension_(file.name);
      const baseKey = normalizeBase_(baseName);
      if (!baseKey) continue;

      // Trust the folder/format first. Some source files (especially .psd) can report
      // image-like MIME types in Drive, but they should still attach as PSD downloads,
      // not become separate gallery cards.
      let canonicalKey = format.key;
      if (!canonicalKey || canonicalKey === "unknown") {
        const inferredImage = isImageFile_(file.name) || String(file.mimeType || "").startsWith("image/");
        const inferredVideo = isVideoFile_(file.name) || String(file.mimeType || "").startsWith("video/");
        canonicalKey = inferredImage ? "image" : inferredVideo ? "timelapse" : canonicalFormatKey_(rawExt || format.key);
      }
      const label = FORMAT_LABELS[canonicalKey] || (format.label || canonicalKey.toUpperCase());
      const fileId = file.fileId || file.id;
      if (!fileId) continue;

      collected.push({
        baseKey,
        baseName,
        formatKey: canonicalKey,
        file: buildFileInfo_({ file, fileId, label, canonicalKey, ext: rawExt, baseName }),
      });
    }
  }

  const byBase = new Map();

  // Important: only image-folder/image-format files create cards.
  // Other formats attach to an existing image with the same base filename.
  for (const entry of collected.filter((x) => x.formatKey === "image")) {
    if (!byBase.has(entry.baseKey)) {
      byBase.set(entry.baseKey, {
        id: entry.baseKey,
        name: prettyName_(entry.baseName),
        categoryKey: category.key,
        categoryLabel: category.label,
        files: {},
        formats: [],
        thumbId: entry.file.fileId,
        imageId: entry.file.fileId,
        timelapseId: "",
        thumbnailUrl: entry.file.previewUrl,
        imagePreviewUrl: entry.file.previewUrl,
        imageWidth: entry.file.width || null,
        imageHeight: entry.file.height || null,
        imageModifiedTime: entry.file.modifiedTime || "",
        imageCreatedTime: entry.file.createdTime || "",
        imageSize: entry.file.size || null,
        psdSize: null,
      });
    }
    attachFormat_(byBase.get(entry.baseKey), entry.file);
  }

  const unmatchedFormats = [];
  for (const entry of collected.filter((x) => x.formatKey !== "image")) {
    const item = byBase.get(entry.baseKey) || findLooseItemMatch_(byBase, entry.baseKey);
    if (!item) {
      unmatchedFormats.push(entry);
      continue;
    }
    attachFormat_(item, entry.file);
    if (entry.formatKey === "timelapse") item.timelapseId = item.timelapseId || entry.file.fileId;
    if (entry.formatKey === "psd") item.psdSize = numberOrNull_(entry.file.size);
  }

  // Friendly single-item fallback while building/testing folders:
  // if there is exactly one image card, attach unmatched format files to it rather than
  // dropping them. This keeps one test thumbnail from splitting/missing downloads when
  // a .psd/.blend filename differs slightly.
  if (byBase.size === 1 && unmatchedFormats.length) {
    const onlyItem = [...byBase.values()][0];
    for (const entry of unmatchedFormats) {
      if (onlyItem.files?.[entry.formatKey]) continue;
      attachFormat_(onlyItem, entry.file);
      if (entry.formatKey === "timelapse") onlyItem.timelapseId = onlyItem.timelapseId || entry.file.fileId;
      if (entry.formatKey === "psd") onlyItem.psdSize = numberOrNull_(entry.file.size);
    }
  }

  const items = [...byBase.values()].map((item) => {
    item.formats.sort((a, b) => formatOrder_(a.key) - formatOrder_(b.key) || a.label.localeCompare(b.label));
    item.formatLabels = item.formats.map((f) => String(f.key || f.label).toLowerCase());
    return item;
  }).sort((a, b) => a.name.localeCompare(b.name));

  debug.push({
    step: "category-built",
    category: category.key,
    formatFolderCount: formatFolders.size,
    collectedFileCount: collected.length,
    imageCardCount: items.length,
    unmatchedFormatCount: unmatchedFormats.length,
    unmatchedFormatNames: unmatchedFormats.slice(0, 10).map((x) => `${x.formatKey}:${x.file?.name || x.baseName}`),
    itemNames: items.slice(0, 10).map((it) => it.name),
    itemFormats: items.slice(0, 10).map((it) => ({ name: it.name, formats: Object.keys(it.files || {}) })),
  });
  return { items };
}

function buildFileInfo_({ file, fileId, label, canonicalKey, ext, baseName }) {
  const width = numberOrNull_(file?.imageMediaMetadata?.width || file?.videoMediaMetadata?.width || file?.width);
  const height = numberOrNull_(file?.imageMediaMetadata?.height || file?.videoMediaMetadata?.height || file?.height);
  const safeExt = String(ext || canonicalKey || "file").replace(/^\./, "").toLowerCase();
  return {
    key: canonicalKey,
    label,
    fileId,
    id: fileId,
    name: file.name,
    ext: safeExt,
    mimeType: file.mimeType || "",
    downloadName: baseName,
    size: numberOrNull_(file.size),
    modifiedTime: file.modifiedTime || "",
    createdTime: file.createdTime || "",
    width,
    height,
    thumbnailUrl: file.thumbnailUrl || file.thumbnailLink || (canonicalKey === "image" ? driveThumbnailUrl_(fileId, 1600) : ""),
    previewUrl: canonicalKey === "image" ? inlineFileUrl_(fileId, file.name, safeExt) : (file.thumbnailUrl || file.thumbnailLink || ""),
    driveUrl: file.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    drivePreviewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
  };
}

function attachFormat_(item, fileInfo) {
  item.files[fileInfo.key] = fileInfo;
  const existingIdx = item.formats.findIndex((f) => f.key === fileInfo.key);
  if (existingIdx >= 0) item.formats[existingIdx] = fileInfo;
  else item.formats.push(fileInfo);
}

async function listDriveFolderEntries_(folderId, apiKey, debug, label = "folder") {
  if (apiKey) {
    const viaApi = await listDriveFolderWithApi_(folderId, apiKey, debug, label).catch((err) => {
      debug.push({ step: "drive-api-exception", label, folderId, message: String(err?.message || err) });
      return null;
    });
    if (viaApi) return viaApi;
  } else {
    debug.push({ step: "drive-api-skipped", label, folderId, reason: "missing GOOGLE_API_KEY" });
  }
  return await scrapeDriveFolderEntries_(folderId, debug, label);
}

async function listDriveFolderWithApi_(folderId, apiKey, debug, label) {
  const out = { files: [], folders: [] };
  let pageToken = "";

  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime,size,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("spaces", "drive");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      debug.push({ step: "drive-api-error", label, folderId, status: res.status, body: safeSnippet_(body) });
      return null;
    }
    const json = await res.json();
    for (const f of json?.files || []) {
      const entry = {
        id: f.id,
        fileId: f.id,
        name: f.name,
        mimeType: f.mimeType || "",
        thumbnailUrl: f.thumbnailLink || (String(f.mimeType || "").startsWith("image/") ? driveThumbnailUrl_(f.id, 1600) : ""),
        thumbnailLink: f.thumbnailLink || "",
        webViewLink: f.webViewLink || "",
        webContentLink: f.webContentLink || "",
        createdTime: f.createdTime || "",
        modifiedTime: f.modifiedTime || "",
        size: f.size || "",
        imageMediaMetadata: f.imageMediaMetadata || null,
        videoMediaMetadata: f.videoMediaMetadata || null,
      };
      if (f.mimeType === "application/vnd.google-apps.folder") out.folders.push(entry);
      else out.files.push(entry);
    }
    pageToken = json?.nextPageToken || "";
    if (!pageToken) break;
  }

  debug.push({ step: "drive-api-list", label, folderId, fileCount: out.files.length, folderCount: out.folders.length, sampleFiles: out.files.slice(0, 5).map((f) => f.name), sampleFolders: out.folders.slice(0, 5).map((f) => f.name) });
  return out;
}

async function scrapeDriveFolderEntries_(folderId, debug, label) {
  const urls = [
    `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
    `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
  ];

  const out = { files: [], folders: [] };
  const seen = new Set();

  for (const url of urls) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 sparkskye-pages-proxy" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) {
      debug.push({ step: "drive-scrape-error", label, folderId, status: res.status });
      continue;
    }
    const html = await res.text();

    for (const m of html.matchAll(/href="https:\/\/drive\.google\.com\/(?:file\/d\/([a-zA-Z0-9_-]+)|drive\/folders\/([a-zA-Z0-9_-]+))[^\"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
      const fileId = m[1] || "";
      const folderIdMatch = m[2] || "";
      const name = cleanLinkText_(m[3]);
      const id = fileId || folderIdMatch;
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      if (folderIdMatch) out.folders.push({ id, name, label: name, mimeType: "application/vnd.google-apps.folder" });
      else out.files.push({ id, name, fileId: id });
    }

    for (const m of html.matchAll(/\["([a-zA-Z0-9_-]{20,})"(?:,[^\]]+?){1,6},"([^"]{2,220})"/g)) {
      const id = m[1];
      const name = decodeHtml_(m[2]).trim();
      if (!id || !name || seen.has(id)) continue;
      if (/^(application\/|image\/|video\/|audio\/)/i.test(name)) continue;
      seen.add(id);
      if (looksLikeFile_(name)) out.files.push({ id, name, fileId: id, thumbnailUrl: isImageFile_(name) ? driveThumbnailUrl_(id, 1600) : "" });
      else out.folders.push({ id, name, label: name, mimeType: "application/vnd.google-apps.folder" });
    }

    if (out.files.length || out.folders.length) break;
  }

  debug.push({ step: "drive-scrape-list", label, folderId, fileCount: out.files.length, folderCount: out.folders.length, sampleFiles: out.files.slice(0, 5).map((f) => f.name), sampleFolders: out.folders.slice(0, 5).map((f) => f.name) });
  return out;
}


function findLooseItemMatch_(byBase, baseKey) {
  if (!baseKey || !byBase?.size) return null;
  if (byBase.has(baseKey)) return byBase.get(baseKey);
  const compact = String(baseKey).replace(/-(thumbnail|thumbnails|image|images|design|source|file|final)$/i, "");
  for (const [key, item] of byBase.entries()) {
    const itemCompact = String(key).replace(/-(thumbnail|thumbnails|image|images|design|source|file|final)$/i, "");
    if (compact && itemCompact && (compact === itemCompact || compact.includes(itemCompact) || itemCompact.includes(compact))) return item;
  }
  return null;
}
function inlineFileUrl_(fileId, name = "", ext = "") {
  const params = new URLSearchParams();
  params.set("id", fileId);
  params.set("inline", "1");
  if (name) params.set("name", name);
  if (ext) params.set("ext", ext);
  return `/api/file?${params.toString()}`;
}
function canonicalCategoryKey_(s) {
  const key = slugify_(s);
  if (!key) return "";
  if (key === "thumbnails") return "thumbnail";
  return key.replace(/s$/, "");
}
function canonicalFormatKey_(s) {
  const key = slugify_(s);
  if (key === "images" || key === "jpg" || key === "jpeg" || key === "png" || key === "webp") return "image";
  if (key === "timelapses" || key === "mp4" || key === "mov" || key === "webm") return "timelapse";
  return key;
}
function looksLikeFile_(name) { return /\.[a-z0-9]{2,8}$/i.test(String(name || "")); }
function isImageFile_(name) { return /\.(png|jpe?g|webp|gif)$/i.test(String(name || "")); }
function isVideoFile_(name) { return /\.(mp4|mov|webm|m4v)$/i.test(String(name || "")); }
function stripExtension_(name) { return String(name || "").replace(/\.[a-z0-9]{2,8}$/i, ""); }
function getExtension_(name) { const m = String(name || "").match(/\.([a-z0-9]{2,8})$/i); return m ? m[1].toLowerCase() : ""; }
function extFromMime_(mime) {
  const m = String(mime || "").toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "video/mp4") return "mp4";
  if (m === "video/quicktime") return "mov";
  if (m === "application/vnd.adobe.photoshop") return "psd";
  return "";
}
function normalizeBase_(s) { return slugify_(stripExtension_(s)); }
function prettyName_(s) { return String(s || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); }
function titleCase_(s) { return String(s || "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }
function formatOrder_(key) { const order = ["image", "timelapse", "psd", "blend", "nomad"]; const i = order.indexOf(key); return i < 0 ? 99 : i; }
function cleanLinkText_(html) { return decodeHtml_(String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim(); }
function slugify_(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
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
function numberOrNull_(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function driveThumbnailUrl_(fileId, size = 1600) { return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${Number(size) || 1600}`; }
function safeSnippet_(body) { return String(body || "").slice(0, 1000).replace(/[A-Za-z0-9_-]{30,}/g, "[redacted]"); }
function jsonResponse_(payload, status = 200, maxAge = 60) { return new Response(JSON.stringify(payload), { status, headers: corsJsonHeaders_(maxAge) }); }
function corsJsonHeaders_(maxAge = 60) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
  };
}
