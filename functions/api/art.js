const ART_ROOT_FOLDER_ID = "1g4qjb4Z3POnoqT4Kf4Twq8ya2z3CZBIa";
const TEXTURE_PACK_PLAYLIST_ID = "PLR9C_il07LK1xfpblj5aqs4dJ2shxGGko";

const MANUAL_CATEGORIES = [
  { key: "models", label: "MODELS", name: "Models", folderId: "1W2r2hjuuCNDd8Sqv7ocx-vo0IROIZZML" },
  { key: "texture-packs", label: "TEXTURE PACKS", name: "Texture Packs", folderId: "1a1Z6OQcNVJPY1TziXXN8MgzpUumj4AmA" },
];

const FORMAT_LABELS = {
  image: "IMAGE",
  images: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  png: "IMAGE",
  webp: "IMAGE",
  gif: "IMAGE",
  timelapse: "TIMELAPSE",
  timelapses: "TIMELAPSE",
  video: "VIDEO",
  videos: "VIDEO",
  trailer: "TRAILER",
  trailers: "TRAILER",
  mp4: "VIDEO",
  mov: "VIDEO",
  webm: "VIDEO",
  gltf: "GLTF",
  glb: "GLB",
  model: "GLTF",
  models: "GLTF",
  bbmodel: "BBMODEL",
  texture: "TEXTURE",
  textures: "TEXTURE",
  mcpack: "MCPACK",
  zip: "ZIP",
  mcaddon: "MCADDON",
  json: "JSON",
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

  if (selected === "all") groups.unshift({ key: "all", label: "ALL ART", items: allItems });

  return jsonResponse_({
    root: { id: ART_ROOT_FOLDER_ID, label: "ART" },
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
    const root = await listDriveFolderEntries_(ART_ROOT_FOLDER_ID, apiKey, debug, "art-root");
    for (const folder of root.folders || []) add({ name: folder.name, folderId: folder.id });
  } catch (err) {
    debug.push({ step: "root-category-list-error", message: String(err?.message || err) });
  }

  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function buildCategory_(category, apiKey, debug) {
  const key = canonicalCategoryKey_(category.key || category.name || category.label || "");
  if (key === "models" || key === "model") return await buildModelCategory_(category, apiKey, debug);
  if (key === "texture-pack" || key === "texture-packs" || key === "texturepacks") return await buildTexturePackCategory_(category, apiKey, debug);
  return await buildImageCategory_(category, apiKey, debug);
}

function collectManualAndChildFormatFolders_(category, entries, debug) {
  const formatFolders = new Map();
  for (const [key, id] of Object.entries(category.formats || {})) {
    const fmtKey = canonicalFormatKey_(key);
    if (!fmtKey || !id) continue;
    formatFolders.set(fmtKey, { key: fmtKey, label: FORMAT_LABELS[fmtKey] || key.toUpperCase(), folderId: id });
  }
  for (const folder of entries?.folders || []) {
    const key = canonicalFormatKey_(folder.name);
    if (!key || formatFolders.has(key)) continue;
    formatFolders.set(key, { key, label: FORMAT_LABELS[key] || folder.name.toUpperCase(), folderId: folder.id });
  }
  debug.push({ step: "format-folders", category: category.key, folders: [...formatFolders.values()].map((f) => ({ key: f.key, folderId: f.folderId })) });
  return formatFolders;
}

async function buildImageCategory_(category, apiKey, debug) {
  const categoryEntries = category.folderId
    ? await listDriveFolderEntries_(category.folderId, apiKey, debug, `category:${category.key}`).catch((err) => {
        debug.push({ step: "category-folder-list-error", category: category.key, message: String(err?.message || err) });
        return { files: [], folders: [] };
      })
    : { files: [], folders: [] };
  const formatFolders = collectManualAndChildFormatFolders_(category, categoryEntries, debug);

  // If a generic art category has public image files directly inside it, treat those as image previews too.
  if (categoryEntries.files?.some((f) => isImageFile_(f.name))) {
    formatFolders.set("__root_image", { key: "image", label: "IMAGE", folderId: category.folderId, rootFiles: categoryEntries.files.filter((f) => isImageFile_(f.name)) });
  }

  const collected = [];
  for (const format of formatFolders.values()) {
    const entries = format.rootFiles
      ? { files: format.rootFiles, folders: [] }
      : await listDriveFolderEntries_(format.folderId, apiKey, debug, `format:${category.key}/${format.key}`).catch((err) => {
          debug.push({ step: "format-folder-list-error", category: category.key, format: format.key, folderId: format.folderId, message: String(err?.message || err) });
          return { files: [], folders: [] };
        });
    for (const file of entries.files || []) {
      const rawExt = getExtension_(file.name) || extFromMime_(file.mimeType) || format.key;
      const rawBaseName = stripExtension_(file.name);
      const parsedName = parseArtName_(rawBaseName);
      const baseName = parsedName.baseName;
      const baseKey = parsedName.baseKey;
      if (!baseKey) continue;
      let canonicalKey = format.key === "__root_image" ? "image" : format.key;
      if (!canonicalKey || canonicalKey === "unknown") {
        const inferredImage = isImageFile_(file.name) || String(file.mimeType || "").startsWith("image/");
        const inferredVideo = isVideoFile_(file.name) || String(file.mimeType || "").startsWith("video/");
        canonicalKey = inferredImage ? "image" : inferredVideo ? "timelapse" : canonicalFormatKey_(rawExt || format.key);
      }
      const fileId = file.fileId || file.id;
      if (!fileId) continue;
      collected.push({
        baseKey,
        baseName,
        formatKey: canonicalKey,
        file: buildFileInfo_({
          file,
          fileId,
          label: FORMAT_LABELS[canonicalKey] || String(canonicalKey).toUpperCase(),
          canonicalKey,
          ext: rawExt,
          baseName: rawBaseName,
          variantLabel: parsedName.variantLabel,
          variantKey: parsedName.variantKey,
          variantOrder: parsedName.variantOrder,
        }),
      });
    }
  }

  const byBase = new Map();
  for (const entry of collected.filter((x) => x.formatKey === "image")) {
    if (!byBase.has(entry.baseKey)) {
      byBase.set(entry.baseKey, makeBaseItem_(entry, category, "image"));
    }
    const item = byBase.get(entry.baseKey);
    attachImageVariant_(item, entry.file);
    if (!item.files.image) attachFormat_(item, entry.file);
  }

  const unmatchedFormats = [];
  for (const entry of collected.filter((x) => x.formatKey !== "image")) {
    const item = byBase.get(entry.baseKey) || findLooseItemMatch_(byBase, entry.baseKey);
    if (!item) { unmatchedFormats.push(entry); continue; }
    attachFormat_(item, entry.file);
  }
  if (byBase.size === 1 && unmatchedFormats.length) {
    const only = [...byBase.values()][0];
    for (const entry of unmatchedFormats) if (!only.files?.[entry.formatKey]) attachFormat_(only, entry.file);
  }

  const items = finalizeImageItems_([...byBase.values()]);
  debug.push({ step: "art-image-category-built", category: category.key, collectedFileCount: collected.length, imageCardCount: items.length, itemFormats: items.slice(0, 10).map((it) => ({ name: it.name, formats: Object.keys(it.files || {}) })) });
  return { items };
}

async function buildModelCategory_(category, apiKey, debug) {
  const categoryEntries = category.folderId
    ? await listDriveFolderEntries_(category.folderId, apiKey, debug, `category:${category.key}`).catch((err) => {
        debug.push({ step: "model-category-list-error", category: category.key, message: String(err?.message || err) });
        return { files: [], folders: [] };
      })
    : { files: [], folders: [] };
  const formatFolders = collectManualAndChildFormatFolders_(category, categoryEntries, debug);

  // Direct GLTF/GLB files in the model category should work even without a nested gltf folder.
  if (categoryEntries.files?.some((f) => isModelFile_(f.name))) {
    formatFolders.set("__root_gltf", { key: "gltf", label: "GLTF", folderId: category.folderId, rootFiles: categoryEntries.files.filter((f) => isModelFile_(f.name)) });
  }

  const collected = [];
  for (const format of formatFolders.values()) {
    const entries = format.rootFiles
      ? { files: format.rootFiles, folders: [] }
      : await listDriveFolderEntries_(format.folderId, apiKey, debug, `format:${category.key}/${format.key}`).catch((err) => {
          debug.push({ step: "model-format-list-error", category: category.key, format: format.key, message: String(err?.message || err) });
          return { files: [], folders: [] };
        });
    for (const file of entries.files || []) {
      const rawExt = getExtension_(file.name) || extFromMime_(file.mimeType) || format.key;
      let canonicalKey = format.key === "__root_gltf" ? "gltf" : format.key;
      if (!canonicalKey || canonicalKey === "unknown") canonicalKey = canonicalFormatKey_(rawExt || format.key);
      if (isModelFile_(file.name) && !["bbmodel"].includes(canonicalKey)) canonicalKey = getExtension_(file.name) === "glb" ? "glb" : "gltf";
      const rawBaseName = stripExtension_(file.name);
      const parsedName = parseArtName_(rawBaseName);
      const baseKey = parsedName.baseKey;
      const fileId = file.fileId || file.id;
      if (!baseKey || !fileId) continue;
      collected.push({
        baseKey,
        baseName: parsedName.baseName,
        formatKey: canonicalKey,
        file: buildFileInfo_({ file, fileId, label: FORMAT_LABELS[canonicalKey] || canonicalKey.toUpperCase(), canonicalKey, ext: rawExt, baseName: rawBaseName }),
      });
    }
  }

  const byBase = new Map();
  for (const entry of collected.filter((x) => x.formatKey === "gltf" || x.formatKey === "glb")) {
    if (!byBase.has(entry.baseKey)) {
      byBase.set(entry.baseKey, {
        id: entry.baseKey,
        kind: "model",
        name: prettyName_(entry.baseName),
        categoryKey: category.key,
        categoryLabel: category.label,
        files: {},
        formats: [],
        modelId: entry.file.fileId,
        modelPreviewUrl: inlineFileUrl_(entry.file.fileId, entry.file.name, entry.file.ext),
        createdTime: entry.file.createdTime || "",
        modifiedTime: entry.file.modifiedTime || "",
        size: entry.file.size || null,
      });
    }
    const item = byBase.get(entry.baseKey);
    item.modelId = item.modelId || entry.file.fileId;
    item.modelPreviewUrl = item.modelPreviewUrl || inlineFileUrl_(entry.file.fileId, entry.file.name, entry.file.ext);
    attachFormat_(item, entry.file);
  }

  const unmatchedFormats = [];
  for (const entry of collected.filter((x) => x.formatKey !== "gltf" && x.formatKey !== "glb")) {
    const item = byBase.get(entry.baseKey) || findLooseItemMatch_(byBase, entry.baseKey);
    if (!item) { unmatchedFormats.push(entry); continue; }
    attachFormat_(item, entry.file);
  }
  if (byBase.size === 1 && unmatchedFormats.length) {
    const only = [...byBase.values()][0];
    for (const entry of unmatchedFormats) if (!only.files?.[entry.formatKey]) attachFormat_(only, entry.file);
  }

  const items = [...byBase.values()].map((item) => {
    item.formats.sort((a, b) => formatOrder_(a.key) - formatOrder_(b.key) || a.label.localeCompare(b.label));
    item.formatLabels = item.formats.map((f) => String(f.key || f.label).toLowerCase());
    return item;
  }).sort((a, b) => a.name.localeCompare(b.name));

  debug.push({ step: "art-model-category-built", category: category.key, collectedFileCount: collected.length, modelCardCount: items.length, unmatchedFormatNames: unmatchedFormats.slice(0, 10).map((x) => `${x.formatKey}:${x.file?.name || x.baseName}`), itemFormats: items.slice(0, 10).map((it) => ({ name: it.name, formats: Object.keys(it.files || {}) })) });
  return { items };
}

async function buildTexturePackCategory_(category, apiKey, debug) {
  const entries = category.folderId
    ? await listDriveFolderEntries_(category.folderId, apiKey, debug, `category:${category.key}`).catch((err) => {
        debug.push({ step: "texture-category-list-error", category: category.key, message: String(err?.message || err) });
        return { files: [], folders: [] };
      })
    : { files: [], folders: [] };

  const packFiles = [];
  for (const file of entries.files || []) {
    const ext = getExtension_(file.name) || extFromMime_(file.mimeType) || "file";
    if (!ext || ["jpg", "jpeg", "png", "webp", "mp4", "mov", "webm"].includes(ext)) continue;
    const baseName = stripExtension_(file.name);
    const baseKey = slugify_(baseName);
    const fileId = file.fileId || file.id;
    if (!baseKey || !fileId) continue;
    const key = canonicalFormatKey_(ext) || ext;
    packFiles.push({
      baseKey,
      baseName,
      file: buildFileInfo_({ file, fileId, label: FORMAT_LABELS[key] || ext.toUpperCase(), canonicalKey: key, ext, baseName }),
    });
  }

  // Also pick up format subfolders if texture packs later becomes structured.
  const formatFolders = collectManualAndChildFormatFolders_(category, entries, debug);
  for (const format of formatFolders.values()) {
    if (!format.folderId) continue;
    const fmtEntries = await listDriveFolderEntries_(format.folderId, apiKey, debug, `format:${category.key}/${format.key}`).catch(() => ({ files: [], folders: [] }));
    for (const file of fmtEntries.files || []) {
      const ext = getExtension_(file.name) || extFromMime_(file.mimeType) || format.key;
      const baseName = stripExtension_(file.name);
      const baseKey = slugify_(baseName);
      const fileId = file.fileId || file.id;
      if (!baseKey || !fileId) continue;
      const key = format.key || canonicalFormatKey_(ext) || ext;
      packFiles.push({ baseKey, baseName, file: buildFileInfo_({ file, fileId, label: FORMAT_LABELS[key] || key.toUpperCase(), canonicalKey: key, ext, baseName }) });
    }
  }

  const trailers = await fetchPlaylistVideos_(TEXTURE_PACK_PLAYLIST_ID, apiKey, debug).catch((err) => {
    debug.push({ step: "texture-playlist-error", message: String(err?.message || err) });
    return [];
  });

  const byBase = new Map();
  for (const pf of packFiles) {
    if (!byBase.has(pf.baseKey)) {
      byBase.set(pf.baseKey, {
        id: pf.baseKey,
        kind: "texture-pack",
        name: prettyName_(pf.baseName),
        categoryKey: category.key,
        categoryLabel: category.label,
        files: {},
        formats: [],
        packCreatedTime: pf.file.createdTime || "",
        packModifiedTime: pf.file.modifiedTime || "",
      });
    }
    attachFormat_(byBase.get(pf.baseKey), pf.file);
  }

  const unusedTrailers = [...trailers].sort((a, b) => dateNumber_(b.publishedAt) - dateNumber_(a.publishedAt));
  for (const trailer of trailers) {
    const tKey = slugify_(trailer.title || trailer.id || "");
    const item = findLooseItemMatch_(byBase, tKey) || findBestVideoMatch_(byBase, trailer);
    if (item) {
      item.trailer = trailer;
      item.trailerId = trailer.id;
      item.thumbnailUrl = trailer.thumbnail;
      item.videoCreatedTime = trailer.publishedAt || "";
      const idx = unusedTrailers.findIndex((x) => x.id === trailer.id);
      if (idx >= 0) unusedTrailers.splice(idx, 1);
    }
  }

  // If counts line up, pair remaining trailers and packs by sorted order.
  const withoutTrailer = [...byBase.values()].filter((it) => !it.trailer).sort((a, b) => a.name.localeCompare(b.name));
  if (withoutTrailer.length && unusedTrailers.length) {
    const sortedTrailers = [...unusedTrailers].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    for (let i = 0; i < Math.min(withoutTrailer.length, sortedTrailers.length); i += 1) {
      withoutTrailer[i].trailer = sortedTrailers[i];
      withoutTrailer[i].trailerId = sortedTrailers[i].id;
      withoutTrailer[i].thumbnailUrl = sortedTrailers[i].thumbnail;
      withoutTrailer[i].videoCreatedTime = sortedTrailers[i].publishedAt || "";
    }
  }

  // If trailers exist but no pack files are visible yet, still show them so the page is not empty while testing.
  if (!byBase.size && trailers.length) {
    for (const trailer of trailers) {
      const id = slugify_(trailer.title || trailer.id || "texture-pack");
      byBase.set(id, {
        id,
        kind: "texture-pack",
        name: trailer.title || "texture pack trailer",
        categoryKey: category.key,
        categoryLabel: category.label,
        files: {},
        formats: [],
        trailer,
        trailerId: trailer.id,
        thumbnailUrl: trailer.thumbnail,
        videoCreatedTime: trailer.publishedAt || "",
      });
    }
  }

  const items = [...byBase.values()].map((item) => {
    item.formats.sort((a, b) => formatOrder_(a.key) - formatOrder_(b.key) || a.label.localeCompare(b.label));
    item.formatLabels = item.formats.map((f) => String(f.key || f.label).toLowerCase());
    return item;
  }).sort((a, b) => a.name.localeCompare(b.name));

  debug.push({ step: "art-texture-category-built", category: category.key, packFileCount: packFiles.length, trailerCount: trailers.length, itemCount: items.length, itemFormats: items.slice(0, 10).map((it) => ({ name: it.name, formats: Object.keys(it.files || {}), trailer: it.trailerId || "" })) });
  return { items };
}

function makeBaseItem_(entry, category, kind) {
  return {
    id: entry.baseKey,
    kind,
    name: prettyName_(entry.baseName),
    categoryKey: category.key,
    categoryLabel: category.label,
    files: {},
    formats: [],
    thumbId: entry.file.fileId,
    imageId: entry.file.fileId,
    thumbnailUrl: entry.file.previewUrl,
    imagePreviewUrl: entry.file.previewUrl,
    imageWidth: entry.file.width || null,
    imageHeight: entry.file.height || null,
    imageModifiedTime: entry.file.modifiedTime || "",
    imageCreatedTime: entry.file.createdTime || "",
    imageSize: entry.file.size || null,
    variations: [],
  };
}

function finalizeImageItems_(items) {
  return items.map((item) => {
    item.variations = (item.variations || []).sort((a, b) => {
      const ao = Number.isFinite(Number(a.variantOrder)) ? Number(a.variantOrder) : 9999;
      const bo = Number.isFinite(Number(b.variantOrder)) ? Number(b.variantOrder) : 9999;
      const aDefault = a.variantKey === "default" ? -1 : 0;
      const bDefault = b.variantKey === "default" ? -1 : 0;
      return ao - bo || aDefault - bDefault || String(a.label || "").localeCompare(String(b.label || "")) || String(a.name || "").localeCompare(String(b.name || ""));
    });
    const firstImage = item.variations[0] || item.files.image;
    if (firstImage) {
      item.files.image = firstImage;
      item.thumbId = firstImage.fileId;
      item.imageId = firstImage.fileId;
      item.thumbnailUrl = firstImage.previewUrl || firstImage.thumbnailUrl || item.thumbnailUrl;
      item.imagePreviewUrl = firstImage.previewUrl || firstImage.thumbnailUrl || item.imagePreviewUrl;
      item.imageWidth = firstImage.width || item.imageWidth || null;
      item.imageHeight = firstImage.height || item.imageHeight || null;
      item.imageModifiedTime = firstImage.modifiedTime || item.imageModifiedTime || "";
      item.imageCreatedTime = firstImage.createdTime || item.imageCreatedTime || "";
      item.imageSize = firstImage.size || item.imageSize || null;
    }
    item.variationLabels = item.variations.map((v) => v.label).filter(Boolean);
    item.formats.sort((a, b) => formatOrder_(a.key) - formatOrder_(b.key) || a.label.localeCompare(b.label));
    item.formatLabels = item.formats.map((f) => String(f.key || f.label).toLowerCase());
    return item;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildFileInfo_({ file, fileId, label, canonicalKey, ext, baseName, variantLabel = "", variantKey = "default", variantOrder = 9999 }) {
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
    variantLabel,
    variantKey,
    variantOrder,
    size: numberOrNull_(file.size),
    modifiedTime: file.modifiedTime || "",
    createdTime: file.createdTime || "",
    width,
    height,
    durationMillis: numberOrNull_(file?.videoMediaMetadata?.durationMillis || file?.durationMillis),
    thumbnailUrl: file.thumbnailUrl || file.thumbnailLink || (canonicalKey === "image" ? driveThumbnailUrl_(fileId, 1600) : ""),
    previewUrl: ["image", "gltf", "glb"].includes(canonicalKey) ? inlineFileUrl_(fileId, file.name, safeExt) : (file.thumbnailUrl || file.thumbnailLink || ""),
    driveUrl: file.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    drivePreviewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
  };
}

function attachImageVariant_(item, fileInfo) {
  if (!item || !fileInfo) return;
  if (!Array.isArray(item.variations)) item.variations = [];
  const key = fileInfo.variantKey || "default";
  const variation = { ...fileInfo, key: "image", variantKey: key, label: fileInfo.variantLabel || "", variantOrder: Number.isFinite(Number(fileInfo.variantOrder)) ? Number(fileInfo.variantOrder) : 9999 };
  const existingIdx = item.variations.findIndex((v) => (v.variantKey || "default") === key);
  if (existingIdx >= 0) item.variations[existingIdx] = variation;
  else item.variations.push(variation);
}
function attachFormat_(item, fileInfo) {
  if (!item || !fileInfo) return;
  item.files[fileInfo.key] = fileInfo;
  const existingIdx = item.formats.findIndex((f) => f.key === fileInfo.key);
  if (existingIdx >= 0) item.formats[existingIdx] = fileInfo;
  else item.formats.push(fileInfo);
}

async function fetchPlaylistVideos_(playlistId, apiKey, debug) {
  if (!apiKey || !playlistId) return [];
  const ids = [];
  let pageToken = "";
  for (let page = 0; page < 4; page += 1) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await fetchJson_(url, 600, `art-playlist-items-${page + 1}`, debug);
    if (!result.ok) break;
    for (const item of result.json?.items || []) {
      const id = item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || "";
      if (id) ids.push(id);
    }
    pageToken = result.json?.nextPageToken || "";
    if (!pageToken) break;
  }
  if (!ids.length) return [];
  return await fetchVideoDetails_(ids, apiKey, debug, "art-playlist-video-details");
}

async function fetchVideoDetails_(ids, apiKey, debug, stepPrefix = "video-details") {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,statistics");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);
    const result = await fetchJson_(url, 600, `${stepPrefix}-${Math.floor(i / 50) + 1}`, debug);
    if (!result.ok) continue;
    for (const item of result.json?.items || []) {
      const snip = item.snippet || {};
      const thumbs = snip.thumbnails || {};
      const thumb = chooseYoutubeThumb_(thumbs, item.id);
      out.push({
        id: item.id,
        title: snip.title || "",
        description: snip.description || "",
        publishedAt: snip.publishedAt || "",
        thumbnail: thumb.url,
        thumbnailWidth: thumb.width || null,
        thumbnailHeight: thumb.height || null,
        url: `https://www.youtube.com/watch?v=${item.id}`,
        embedUrl: `https://www.youtube.com/embed/${item.id}`,
        duration: isoDurationLabel_(item.contentDetails?.duration || ""),
        viewCount: numberOrNull_(item.statistics?.viewCount),
      });
    }
  }
  return out;
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
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 sparkskye-pages-proxy" }, cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) { debug.push({ step: "drive-scrape-error", label, folderId, status: res.status }); continue; }
    const html = await res.text();
    for (const m of html.matchAll(/href="https:\/\/drive\.google\.com\/(?:file\/d\/([a-zA-Z0-9_-]+)|drive\/folders\/([a-zA-Z0-9_-]+))[^\"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
      const fileId = m[1] || "";
      const folderIdMatch = m[2] || "";
      const name = cleanLinkText_(m[3]);
      const id = fileId || folderIdMatch;
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      if (folderIdMatch) out.folders.push({ id, fileId: id, name, label: name, mimeType: "application/vnd.google-apps.folder" });
      else out.files.push({ id, fileId: id, name, thumbnailUrl: isImageFile_(name) ? driveThumbnailUrl_(id, 1600) : "" });
    }
    for (const m of html.matchAll(/\["([a-zA-Z0-9_-]{20,})"(?:,[^\]]+?){1,6},"([^"]{2,140})"/g)) {
      const id = m[1];
      const name = decodeHtml_(m[2]).trim();
      if (!id || !name || seen.has(id)) continue;
      if (/^(application\/|image\/|video\/|audio\/)/i.test(name)) continue;
      seen.add(id);
      if (looksLikeFile_(name)) out.files.push({ id, fileId: id, name, thumbnailUrl: isImageFile_(name) ? driveThumbnailUrl_(id, 1600) : "" });
      else out.folders.push({ id, fileId: id, name, label: name, mimeType: "application/vnd.google-apps.folder" });
    }
    if (out.files.length || out.folders.length) break;
  }
  debug.push({ step: "drive-scrape-list", label, folderId, fileCount: out.files.length, folderCount: out.folders.length, sampleFiles: out.files.slice(0, 5).map((f) => f.name), sampleFolders: out.folders.slice(0, 5).map((f) => f.name) });
  return out;
}

async function fetchJson_(url, ttl, step, debug) {
  const res = await fetch(url.toString(), { cf: { cacheTtl: ttl, cacheEverything: true } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  const ok = res.ok && !json?.error;
  debug?.push?.({ step, ok, status: res.status, error: json?.error?.message || json?.error?.errors?.[0]?.reason || "" });
  return { ok, json, status: res.status };
}

function findBestVideoMatch_(byBase, trailer) {
  const tKey = slugify_(trailer?.title || "");
  if (!tKey) return null;
  let best = null;
  let score = 0;
  for (const [key, item] of byBase.entries()) {
    const s = looseScore_(key, tKey);
    if (s > score) { score = s; best = item; }
  }
  return score >= 0.55 ? best : null;
}
function looseScore_(a, b) {
  const A = new Set(String(a).split("-").filter((x) => x.length > 2));
  const B = new Set(String(b).split("-").filter((x) => x.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / Math.max(A.size, B.size);
}
function findLooseItemMatch_(byBase, baseKey) {
  if (!baseKey || !byBase?.size) return null;
  if (byBase.has(baseKey)) return byBase.get(baseKey);
  const compact = stripCommonSuffixes_(baseKey);
  for (const [key, item] of byBase.entries()) {
    const itemCompact = stripCommonSuffixes_(key);
    if (compact && itemCompact && (compact === itemCompact || compact.includes(itemCompact) || itemCompact.includes(compact))) return item;
  }
  return null;
}
function stripCommonSuffixes_(s) { return String(s || "").replace(/-(thumbnail|thumbnails|image|images|preview|trailer|model|models|art|source|file|final|pack|texture-pack|texture)$/i, ""); }
function inlineFileUrl_(fileId, name = "", ext = "") { const params = new URLSearchParams(); params.set("id", fileId); params.set("inline", "1"); if (name) params.set("name", name); if (ext) params.set("ext", ext); return `/api/file?${params.toString()}`; }
function canonicalCategoryKey_(s) { const key = slugify_(s); if (!key) return ""; if (["texturepacks", "texture-pack", "texture-packs"].includes(key)) return "texture-packs"; if (key === "model") return "models"; return key; }
function canonicalFormatKey_(s) {
  const key = slugify_(s);
  if (!key) return "";
  if (["images", "jpg", "jpeg", "png", "webp", "gif"].includes(key) || key.includes("image") || key.includes("thumbnail")) return "image";
  if (["timelapses"].includes(key) || key.includes("timelapse")) return "timelapse";
  if (["videos", "mp4", "mov", "webm", "m4v"].includes(key) || key === "video") return "video";
  if (["trailers"].includes(key) || key.includes("trailer")) return "trailer";
  if (key.includes("bbmodel")) return "bbmodel";
  if (key.includes("gltf") || key.includes("glb") || key === "model" || key === "models") return "gltf";
  if (key.includes("texture-pack") || key === "pack" || key === "packs") return "mcpack";
  return key;
}
function looksLikeFile_(name) { return /\.[a-z0-9]{2,10}$/i.test(String(name || "")); }
function isImageFile_(name) { return /\.(png|jpe?g|webp|gif)$/i.test(String(name || "")); }
function isVideoFile_(name) { return /\.(mp4|mov|webm|m4v)$/i.test(String(name || "")); }
function isModelFile_(name) { return /\.(glb|gltf)$/i.test(String(name || "")); }
function stripExtension_(name) { return String(name || "").replace(/\.[a-z0-9]{2,10}$/i, ""); }
function getExtension_(name) { const m = String(name || "").match(/\.([a-z0-9]{2,10})$/i); return m ? m[1].toLowerCase() : ""; }
function extFromMime_(mime) { const m = String(mime || "").toLowerCase(); if (m === "image/jpeg") return "jpg"; if (m === "image/png") return "png"; if (m === "image/webp") return "webp"; if (m === "video/mp4") return "mp4"; if (m === "video/quicktime") return "mov"; if (m === "model/gltf-binary") return "glb"; if (m === "model/gltf+json") return "gltf"; if (m.includes("zip")) return "zip"; return ""; }
function parseArtName_(s) {
  const raw = String(s || "").trim();
  const ordered = raw.match(/^(.*?)\s*\[(\d+)\]\s*([^\[\]]+)\s*$/);
  if (ordered) {
    const baseName = String(ordered[1] || "").trim() || raw;
    const variantOrder = Number(ordered[2]);
    const variantLabel = String(ordered[3] || "").trim();
    return { baseName, baseKey: slugify_(baseName), variantLabel, variantKey: variantLabel ? `${String(variantOrder).padStart(4, "0")}-${slugify_(variantLabel)}` : `order-${variantOrder}`, variantOrder: Number.isFinite(variantOrder) ? variantOrder : 9999 };
  }
  const old = raw.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  const baseName = (old ? old[1] : raw).trim() || raw;
  const variantLabel = old ? String(old[2] || "").trim() : "";
  return { baseName, baseKey: slugify_(baseName), variantLabel, variantKey: variantLabel ? slugify_(variantLabel) : "default", variantOrder: variantLabel ? 9999 : 0 };
}
function chooseYoutubeThumb_(thumbs, id) {
  const pick = thumbs?.maxres || thumbs?.standard || thumbs?.high || thumbs?.medium || thumbs?.default || {};
  return { url: pick.url || `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`, width: pick.width || null, height: pick.height || null };
}
function isoDurationLabel_(iso) {
  const m = String(iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = Number(m[1] || 0), min = Number(m[2] || 0), sec = Number(m[3] || 0);
  return h ? `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${min}:${String(sec).padStart(2, "0")}`;
}
function dateNumber_(v) { const n = new Date(v || 0).getTime(); return Number.isFinite(n) ? n : 0; }
function prettyName_(s) { return String(s || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); }
function titleCase_(s) { return String(s || "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }
function formatOrder_(key) { const order = ["image", "video", "trailer", "timelapse", "gltf", "glb", "bbmodel", "mcpack", "zip", "mcaddon", "psd", "blend", "nomad"]; const i = order.indexOf(key); return i < 0 ? 99 : i; }
function cleanLinkText_(html) { return decodeHtml_(String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim(); }
function slugify_(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function decodeHtml_(s) { return String(s || "").replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function numberOrNull_(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function driveThumbnailUrl_(fileId, size = 1600) { return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${Number(size) || 1600}`; }
function safeSnippet_(body) { return String(body || "").slice(0, 1000).replace(/[A-Za-z0-9_-]{30,}/g, "[redacted]"); }
function jsonResponse_(payload, status = 200, maxAge = 60) { return new Response(JSON.stringify(payload), { status, headers: corsJsonHeaders_(maxAge) }); }
function corsJsonHeaders_(maxAge = 60) { return { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store" }; }
