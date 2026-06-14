const ANIMATION_ROOT_FOLDER_ID = "1dYQ5xLsWSdGxB63mbHS06u7ZlDMuJq3L";

// Fallback so the first animation type works even before Drive category
// discovery succeeds. The API also tries to resolve the parent folder of the
// manual video folder, so matching sibling folders like blend/thumbnail can be
// discovered automatically.
const MANUAL_CATEGORIES = [
  {
    key: "blender",
    label: "BLENDER",
    name: "Blender",
    formats: {
      video: "1t2KxPLonWkLvdPehtr-RA63bvO_Ml1Ax",
      thumbnail: "1hMfcWAjSPF6LA_5-DpzTvDhvOwZ7FmCh",
    },
  },
];

const FORMAT_LABELS = {
  video: "VIDEO",
  videos: "VIDEO",
  animation: "VIDEO",
  animations: "VIDEO",
  mp4: "VIDEO",
  mov: "VIDEO",
  webm: "VIDEO",
  m4v: "VIDEO",
  thumbnail: "THUMBNAIL",
  thumbnails: "THUMBNAIL",
  preview: "THUMBNAIL",
  blend: "BLEND",
  blender: "BLEND",
  project: "PROJECT",
  source: "SOURCE",
};

function isRootFormatFolderName_(name) {
  const key = slugify_(name);
  // At the animation root, folders like "blender" are type/category folders,
  // not format folders. Only exact format-folder names should be hijacked
  // into the fallback category here.
  return ["video", "videos", "thumbnail", "thumbnails", "thumb", "preview", "blend", "blends"].includes(key);
}

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

  if (selected === "all") groups.unshift({ key: "all", label: "ALL ANIMATION", items: allItems });

  return jsonResponse_({
    root: { id: ANIMATION_ROOT_FOLDER_ID, label: "ANIMATION" },
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

  for (const c of MANUAL_CATEGORIES) {
    add(c);

    // If we only know the manual video/thumbnail folders, ask Drive for the
    // parent type folder. That lets us discover sibling format folders such as
    // blend without hard-coding every folder ID.
    if (apiKey && !c.folderId && c.formats?.video) {
      try {
        const videoFolder = await getDriveFileMetadata_(c.formats.video, apiKey, debug, `manual-video-folder:${c.key}`);
        const parentId = Array.isArray(videoFolder?.parents) ? videoFolder.parents[0] : "";
        if (parentId) {
          const parent = await getDriveFileMetadata_(parentId, apiKey, debug, `manual-parent-folder:${c.key}`);
          add({
            ...c,
            // Keep the manual key stable, but use the real Drive folder name for
            // the visible type chip. Example: folder "blender" -> BLENDER.
            key: c.key,
            name: parent?.name || c.name,
            label: String(parent?.name || c.label || c.name || c.key).toUpperCase(),
            folderId: parentId,
          });
        }
      } catch (err) {
        debug.push({ step: "manual-category-parent-error", category: c.key, message: String(err?.message || err) });
      }
    }
  }

  try {
    const root = await listDriveFolderEntries_(ANIMATION_ROOT_FOLDER_ID, apiKey, debug, "animation-root");
    for (const folder of root.folders || []) {
      // If a format folder accidentally lives at root, attach it to the fallback
      // Blender category rather than creating a weird type chip.
      const fmt = isRootFormatFolderName_(folder.name) ? canonicalFormatKey_(folder.name) : "";
      if (fmt === "video" || fmt === "blend" || fmt === "thumbnail") {
        const existing = merged.get("blender") || { key: "blender", label: "BLENDER", name: "Blender", formats: {} };
        existing.formats = { ...(existing.formats || {}), [fmt]: folder.id };
        merged.set("blender", existing);
      } else {
        add({ name: folder.name, folderId: folder.id });
      }
    }
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

  if (category.folderId) {
    try {
      const entries = await listDriveFolderEntries_(category.folderId, apiKey, debug, `category:${category.key}`);
      for (const folder of entries.folders || []) {
        const key = canonicalFormatKey_(folder.name);
        if (!key || formatFolders.has(key)) continue;
        formatFolders.set(key, { key, label: FORMAT_LABELS[key] || folder.name.toUpperCase(), folderId: folder.id });
      }

      // If the category folder itself contains videos, treat it like the video folder.
      if (!formatFolders.has("video") && (entries.files || []).some((f) => isVideoFile_(f.name) || String(f.mimeType || "").startsWith("video/"))) {
        formatFolders.set("video", { key: "video", label: "VIDEO", folderId: category.folderId, directFiles: entries.files });
      }
      if (!formatFolders.has("thumbnail") && (entries.files || []).some((f) => isImageFile_(f.name) || String(f.mimeType || "").startsWith("image/"))) {
        formatFolders.set("thumbnail", { key: "thumbnail", label: "THUMBNAIL", folderId: category.folderId, directFiles: entries.files });
      }
    } catch (err) {
      debug.push({ step: "category-folder-list-error", category: category.key, message: String(err?.message || err) });
    }
  }

  const collected = [];

  for (const format of formatFolders.values()) {
    const entries = format.directFiles
      ? { files: format.directFiles, folders: [] }
      : await listDriveFolderEntries_(format.folderId, apiKey, debug, `format:${category.key}/${format.key}`).catch((err) => {
          debug.push({ step: "format-folder-list-error", category: category.key, format: format.key, folderId: format.folderId, message: String(err?.message || err) });
          return { files: [], folders: [] };
        });

    for (const file of entries.files || []) {
      const rawExt = getExtension_(file.name) || extFromMime_(file.mimeType) || format.key;
      const rawBaseName = stripExtension_(file.name);
      const baseKey = normalizeBase_(rawBaseName);
      if (!baseKey) continue;
      let canonicalKey = format.key;
      if (!canonicalKey || canonicalKey === "unknown") {
        canonicalKey = isVideoFile_(file.name) || String(file.mimeType || "").startsWith("video/")
          ? "video"
          : canonicalFormatKey_(rawExt || format.key);
      }
      const label = FORMAT_LABELS[canonicalKey] || (format.label || canonicalKey.toUpperCase());
      const fileId = file.fileId || file.id;
      if (!fileId) continue;

      collected.push({
        baseKey,
        baseName: rawBaseName,
        formatKey: canonicalKey,
        file: buildFileInfo_({ file, fileId, label, canonicalKey, ext: rawExt, baseName: rawBaseName }),
      });
    }
  }

  const byBase = new Map();

  // Only files from video folders create animation cards. Other folders attach
  // to those cards as alternate downloadable formats.
  for (const entry of collected.filter((x) => x.formatKey === "video")) {
    if (!byBase.has(entry.baseKey)) {
      byBase.set(entry.baseKey, {
        id: entry.baseKey,
        name: prettyName_(entry.baseName),
        categoryKey: category.key,
        categoryLabel: category.label,
        files: {},
        formats: [],
        matchAliases: buildMatchAliases_(entry.baseName, entry.baseKey),
        videoId: entry.file.fileId,
        videoPreviewUrl: entry.file.previewUrl,
        thumbnailUrl: entry.file.thumbnailUrl || driveThumbnailUrl_(entry.file.fileId, 1600),
        videoWidth: entry.file.width || null,
        videoHeight: entry.file.height || null,
        videoDurationMillis: entry.file.durationMillis || null,
        videoModifiedTime: entry.file.modifiedTime || "",
        videoCreatedTime: entry.file.createdTime || "",
        videoSize: entry.file.size || null,
        blendSize: null,
      });
    }
    attachFormat_(byBase.get(entry.baseKey), entry.file);
  }

  const unmatchedFormats = [];
  const fuzzyMatches = [];
  for (const entry of collected.filter((x) => x.formatKey !== "video")) {
    const match = byBase.get(entry.baseKey)
      ? { item: byBase.get(entry.baseKey), score: 1, reason: "exact" }
      : findLooseItemMatch_(byBase, entry.baseKey, entry.baseName);
    const item = match?.item || null;
    if (!item) {
      unmatchedFormats.push(entry);
      continue;
    }
    attachFormat_(item, entry.file);
    if (entry.formatKey === "blend") item.blendSize = numberOrNull_(entry.file.size);
    if (match?.reason && match.reason !== "exact") {
      fuzzyMatches.push({ format: entry.formatKey, file: entry.file.name, attachedTo: item.name, score: match.score, reason: match.reason });
    }
  }

  // If there is only one animation card in a type, attach any remaining formats
  // to it. This is handy while a new gallery has just one test asset.
  if (byBase.size === 1 && unmatchedFormats.length) {
    const onlyItem = [...byBase.values()][0];
    for (const entry of unmatchedFormats.splice(0)) {
      if (onlyItem.files?.[entry.formatKey]) continue;
      attachFormat_(onlyItem, entry.file);
      if (entry.formatKey === "blend") onlyItem.blendSize = numberOrNull_(entry.file.size);
      fuzzyMatches.push({ format: entry.formatKey, file: entry.file.name, attachedTo: onlyItem.name, score: 0.5, reason: "single-item-fallback" });
    }
  }

  // Last-resort but very useful for Drive galleries: if matching by filename
  // failed, and a format folder has the same number of files as the video
  // folder, attach them by sorted order. This mirrors how people usually keep
  // parallel Drive folders organized and fixes cases where Drive/API filename
  // metadata is slightly different from what the browser UI displays.
  if (byBase.size > 1 && unmatchedFormats.length) {
    const itemsByName = [...byBase.values()].sort(compareAnimationItemsForFallback_);
    const remaining = [];
    const byFormat = new Map();
    for (const entry of unmatchedFormats) {
      if (!byFormat.has(entry.formatKey)) byFormat.set(entry.formatKey, []);
      byFormat.get(entry.formatKey).push(entry);
    }

    for (const [formatKey, entries] of byFormat.entries()) {
      const openItems = itemsByName.filter((item) => !item.files?.[formatKey]);
      const sortedEntries = [...entries].sort(compareCollectedEntriesForFallback_);
      if (sortedEntries.length && sortedEntries.length <= openItems.length) {
        sortedEntries.forEach((entry, index) => {
          const item = openItems[index];
          if (!item || item.files?.[entry.formatKey]) {
            remaining.push(entry);
            return;
          }
          attachFormat_(item, entry.file);
          if (entry.formatKey === "blend") item.blendSize = numberOrNull_(entry.file.size);
          fuzzyMatches.push({
            format: entry.formatKey,
            file: entry.file.name,
            attachedTo: item.name,
            score: 0.25,
            reason: "parallel-folder-order-fallback",
          });
        });
      } else {
        remaining.push(...entries);
      }
    }
    unmatchedFormats.splice(0, unmatchedFormats.length, ...remaining);
  }

  const items = [...byBase.values()].map((item) => {
    item.formats = (item.formats || []).sort((a, b) => formatOrder_(a.key) - formatOrder_(b.key) || String(a.label || a.key).localeCompare(String(b.label || b.key)));
    const thumb = item.files?.thumbnail;
    item.thumbnailUrl = thumb?.previewUrl || thumb?.thumbnailUrl || item.thumbnailUrl || item.files?.video?.thumbnailUrl || "/public/img/favicon.png";
    item.thumbnailWidth = thumb?.width || item.thumbnailWidth || null;
    item.thumbnailHeight = thumb?.height || item.thumbnailHeight || null;
    item.videoPreviewUrl = item.videoPreviewUrl || item.files?.video?.previewUrl || "";
    item.blendSize = item.blendSize ?? numberOrNull_(item.files?.blend?.size);
    return item;
  }).sort((a, b) => new Date(b.videoCreatedTime || 0) - new Date(a.videoCreatedTime || 0) || a.name.localeCompare(b.name));

  debug.push({
    step: "animation-category-built",
    category: category.key,
    formatFolders: [...formatFolders.values()].map((f) => ({ key: f.key, folderId: f.folderId })),
    collectedCount: collected.length,
    collectedSamples: collected.slice(0, 12).map((e) => ({ format: e.formatKey, baseKey: e.baseKey, name: e.file?.name })),
    fuzzyMatches,
    unmatchedFormats: unmatchedFormats.slice(0, 12).map((e) => ({ format: e.formatKey, baseKey: e.baseKey, name: e.file?.name })),
    itemCount: items.length,
    sampleItems: items.slice(0, 5).map((i) => ({ name: i.name, formats: (i.formats || []).map((f) => f.key), files: Object.keys(i.files || {}) })),
  });

  return { items };
}


function compareAnimationItemsForFallback_(a, b) {
  return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { numeric: true, sensitivity: "base" });
}

function compareCollectedEntriesForFallback_(a, b) {
  return String(a?.baseName || a?.file?.name || "").localeCompare(String(b?.baseName || b?.file?.name || ""), undefined, { numeric: true, sensitivity: "base" });
}

function buildFileInfo_({ file, fileId, label, canonicalKey, ext, baseName }) {
  const width = file.videoMediaMetadata?.width || file.imageMediaMetadata?.width || null;
  const height = file.videoMediaMetadata?.height || file.imageMediaMetadata?.height || null;
  const durationMillis = numberOrNull_(file.videoMediaMetadata?.durationMillis);
  return {
    key: canonicalKey,
    label,
    ext,
    id: fileId,
    fileId,
    name: file.name || `${baseName}.${ext || canonicalKey}`,
    downloadName: file.name || `${baseName}.${ext || canonicalKey}`,
    size: numberOrNull_(file.size),
    createdTime: file.createdTime || "",
    modifiedTime: file.modifiedTime || "",
    width,
    height,
    durationMillis,
    thumbnailUrl: file.thumbnailUrl || file.thumbnailLink || driveThumbnailUrl_(fileId, 1600),
    previewUrl: inlineFileUrl_(fileId, file.name || "", ext),
    webViewLink: file.webViewLink || "",
  };
}

function attachFormat_(item, fileInfo) {
  if (!item.files) item.files = {};
  item.files[fileInfo.key] = fileInfo;

  // Thumbnail files are used only for the prettier gallery/modal poster image.
  // They should not show as downloadable formats.
  if (fileInfo.key === "thumbnail") {
    item.thumbnailUrl = fileInfo.previewUrl || fileInfo.thumbnailUrl || item.thumbnailUrl;
    item.thumbnailWidth = fileInfo.width || item.thumbnailWidth || null;
    item.thumbnailHeight = fileInfo.height || item.thumbnailHeight || null;
    return;
  }

  item.formats = item.formats || [];
  const idx = item.formats.findIndex((f) => f.key === fileInfo.key);
  const summary = { key: fileInfo.key, label: fileInfo.label, ext: fileInfo.ext, fileId: fileInfo.fileId, size: fileInfo.size, createdTime: fileInfo.createdTime, modifiedTime: fileInfo.modifiedTime };
  if (idx >= 0) item.formats[idx] = { ...item.formats[idx], ...summary };
  else item.formats.push(summary);
}

async function listDriveFolderEntries_(folderId, apiKey, debug, label) {
  if (!folderId) return { files: [], folders: [] };
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

async function getDriveFileMetadata_(fileId, apiKey, debug, label) {
  if (!fileId || !apiKey) return null;
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,parents");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    debug.push({ step: "drive-metadata-error", label, fileId, status: res.status, body: safeSnippet_(body) });
    return null;
  }
  const json = await res.json();
  debug.push({ step: "drive-metadata", label, fileId, name: json?.name || "", parentCount: Array.isArray(json?.parents) ? json.parents.length : 0 });
  return json;
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
        thumbnailUrl: f.thumbnailLink || (String(f.mimeType || "").startsWith("video/") ? driveThumbnailUrl_(f.id, 1600) : ""),
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
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 sparkskye-pages-proxy" }, cf: { cacheTtl: 0, cacheEverything: false } });
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
      else out.files.push({ id, name, fileId: id, thumbnailUrl: isVideoFile_(name) ? driveThumbnailUrl_(id, 1600) : "" });
    }

    for (const m of html.matchAll(/\["([a-zA-Z0-9_-]{20,})"(?:,[^\]]+?){1,6},"([^"]{2,220})"/g)) {
      const id = m[1];
      const name = decodeHtml_(m[2]).trim();
      if (!id || !name || seen.has(id)) continue;
      if (/^(application\/|image\/|video\/|audio\/)/i.test(name)) continue;
      seen.add(id);
      if (looksLikeFile_(name)) out.files.push({ id, name, fileId: id, thumbnailUrl: isVideoFile_(name) ? driveThumbnailUrl_(id, 1600) : "" });
      else out.folders.push({ id, name, label: name, mimeType: "application/vnd.google-apps.folder" });
    }

    if (out.files.length || out.folders.length) break;
  }

  debug.push({ step: "drive-scrape-list", label, folderId, fileCount: out.files.length, folderCount: out.folders.length, sampleFiles: out.files.slice(0, 5).map((f) => f.name), sampleFolders: out.folders.slice(0, 5).map((f) => f.name) });
  return out;
}

function findLooseItemMatch_(byBase, baseKey, baseName = "") {
  if (!baseKey || !byBase?.size) return null;
  if (byBase.has(baseKey)) return { item: byBase.get(baseKey), score: 1, reason: "exact" };

  const candidates = buildMatchAliases_(baseName, baseKey);
  let best = null;

  for (const [key, item] of byBase.entries()) {
    const itemAliases = Array.isArray(item.matchAliases) && item.matchAliases.length
      ? item.matchAliases
      : buildMatchAliases_(item.name, key);

    for (const a of candidates) {
      for (const b of itemAliases) {
        if (!a || !b) continue;
        if (a === b) {
          const exactish = { item, score: 1, reason: "alias" };
          return exactish;
        }
        if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) {
          const score = Math.min(a.length, b.length) / Math.max(a.length, b.length);
          if (!best || score > best.score) best = { item, score, reason: "contains" };
        }
      }
    }

    const score = tokenSimilarity_(candidates.join(" "), itemAliases.join(" "));
    if (!best || score > best.score) best = { item, score, reason: "token-similarity" };
  }

  return best && best.score >= 0.58 ? best : null;
}

function buildMatchAliases_(baseName = "", baseKey = "") {
  const values = [baseName, baseKey, stripExtension_(baseName), stripFormatTail_(baseName), stripFormatTail_(baseKey)];
  const out = new Set();
  for (const value of values) {
    const normalized = normalizeBase_(value);
    if (!normalized) continue;
    out.add(normalized);
    out.add(stripFormatTail_(normalized));
    out.add(normalized.replace(/-/g, ""));
  }
  return [...out].filter(Boolean);
}

function stripFormatTail_(s) {
  return String(s || "")
    .replace(/\s*\[[^\]]+\]\s*$/g, "")
    .replace(/[\s_-]+(?:animation|animated|video|render|final|source|file|blend|blender|project|thumbnail|thumb|preview)$/i, "")
    .trim();
}

function tokenSimilarity_(a, b) {
  const stop = new Set(["animation", "animated", "video", "render", "final", "source", "file", "blend", "blender", "project", "thumbnail", "thumb", "preview", "mp4", "mov", "webm"]);
  const ta = new Set(String(a || "").split(/[^a-z0-9]+/i).filter((x) => x && !stop.has(x)));
  const tb = new Set(String(b || "").split(/[^a-z0-9]+/i).filter((x) => x && !stop.has(x)));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
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
  if (key === "blender-animations" || key === "blender-animation") return "blender";
  return key.replace(/s$/, "");
}
function canonicalFormatKey_(s) {
  const key = slugify_(s);
  if (!key) return "";
  if (key.includes("video") || key === "mp4" || key === "mov" || key === "webm" || key === "m4v" || key === "animation") return "video";
  if (key.includes("thumb") || key === "preview" || key === "poster") return "thumbnail";
  if (key === "blend" || key === "blends") return "blend";
  return key;
}
function looksLikeFile_(name) { return /\.[a-z0-9]{2,8}$/i.test(String(name || "")); }
function isVideoFile_(name) { return /\.(mp4|mov|webm|m4v)$/i.test(String(name || "")); }
function isImageFile_(name) { return /\.(png|jpe?g|webp|gif|avif)$/i.test(String(name || "")); }
function stripExtension_(name) { return String(name || "").replace(/\.[a-z0-9]{2,8}$/i, ""); }
function getExtension_(name) { const m = String(name || "").match(/\.([a-z0-9]{2,8})$/i); return m ? m[1].toLowerCase() : ""; }
function extFromMime_(mime) {
  const m = String(mime || "").toLowerCase();
  if (m === "video/mp4") return "mp4";
  if (m === "video/quicktime") return "mov";
  if (m === "video/webm") return "webm";
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "application/octet-stream") return "blend";
  return "";
}
function normalizeBase_(s) { return slugify_(String(s || "").replace(/\s*\[\d+\]\s*[^\[\]]+\s*$/g, "")); }
function prettyName_(s) { return String(s || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); }
function titleCase_(s) { return String(s || "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }
function formatOrder_(key) { const order = ["video", "blend"]; const i = order.indexOf(key); return i < 0 ? 99 : i; }
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
