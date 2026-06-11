const DESIGN_ROOT_FOLDER_ID = "1DUmxNnEdzNo55jmW32nxEQW4GtWFNyAk";

const MANUAL_CATEGORIES = [
  {
    key: "thumbnails",
    label: "THUMBNAILS",
    name: "Thumbnails",
    folderId: "1BdY45PsEiH_Ok7LOoz4gA9dh8oMKQAAe",
    formats: {
      blend: "1us9v1i-3iPRnHNTrfmV5VZC-CviFHc8s",
      image: "11glK03RH_oCvtEPodbcYlG_Cj1wEIRTf",
      nomad: "1O6TY6VK2k2hvY5MA16nid-4m4QyygW7U",
      psd: "1SLVCnMkZyEK7IzaVcEiFmFqFkYqsjr8B",
      timelapse: "10ZCgk3dc4NGbHip00qcbQQ2YEwbrsncs",
    },
  },
];

const FORMAT_LABELS = {
  blend: "BLEND",
  image: "IMAGE",
  images: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  png: "IMAGE",
  nomad: "NOMAD",
  psd: "PSD",
  timelapse: "TIMELAPSE",
  timelapses: "TIMELAPSE",
};

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const apiKey = context.env?.GOOGLE_API_KEY || context.env?.DRIVE_API_KEY || "";

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsJsonHeaders_(60) });
  }

  if (requestUrl.searchParams.get("list") === "1") {
    return jsonResponse_({ categories: await listCategories_(apiKey), driveApiEnabled: !!apiKey }, 200, 300);
  }

  const selected = canonicalCategoryKey_(requestUrl.searchParams.get("category") || "all");
  const categories = await listCategories_(apiKey);
  const wanted = selected && selected !== "all"
    ? categories.filter((c) => canonicalCategoryKey_(c.key) === selected)
    : categories;

  const groups = [];
  const allItems = [];

  for (const category of wanted) {
    const built = await buildCategory_(category, apiKey).catch(() => ({ items: [] }));
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
  }, 200, 300);
}

async function listCategories_(apiKey) {
  const merged = new Map();
  const add = (c) => {
    const key = slugify_(c?.key || c?.name || c?.label || "");
    const canonical = canonicalCategoryKey_(key || c?.name || c?.label || "");
    if (!canonical) return;
    const label = String(c?.label || c?.name || key || "").trim().toUpperCase();
    const current = merged.get(canonical) || {};
    merged.set(canonical, {
      key: current.key || key || canonical,
      label: current.label || label,
      name: current.name || c?.name || titleCase_(label),
      folderId: current.folderId || c?.folderId || c?.id || "",
      formats: { ...(c?.formats || {}), ...(current.formats || {}) },
    });
  };

  for (const c of MANUAL_CATEGORIES) add(c);

  try {
    const root = await listDriveFolderEntries_(DESIGN_ROOT_FOLDER_ID, apiKey);
    for (const folder of root.folders || []) add({ name: folder.name, folderId: folder.id });
  } catch {}

  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function buildCategory_(category, apiKey) {
  const formatFolders = new Map();

  for (const [key, id] of Object.entries(category.formats || {})) {
    const fmtKey = canonicalFormatKey_(key);
    formatFolders.set(fmtKey, { key: fmtKey, label: FORMAT_LABELS[fmtKey] || key.toUpperCase(), folderId: id });
  }

  // Future-friendly fallback: if the category folder itself contains folders named
  // image/psd/blend/etc., pick them up automatically.
  if (category.folderId) {
    try {
      const entries = await listDriveFolderEntries_(category.folderId, apiKey);
      for (const folder of entries.folders || []) {
        const key = canonicalFormatKey_(folder.name);
        if (!key || formatFolders.has(key)) continue;
        formatFolders.set(key, { key, label: FORMAT_LABELS[key] || folder.name.toUpperCase(), folderId: folder.id });
      }
    } catch {}
  }

  const byBase = new Map();

  for (const format of formatFolders.values()) {
    if (!format.folderId) continue;
    const entries = await listDriveFolderEntries_(format.folderId, apiKey).catch(() => ({ files: [] }));

    for (const file of entries.files || []) {
      const ext = getExtension_(file.name) || extFromMime_(file.mimeType);
      const baseName = stripExtension_(file.name);
      const baseKey = normalizeBase_(baseName);
      if (!baseKey) continue;

      if (!byBase.has(baseKey)) {
        byBase.set(baseKey, {
          id: baseKey,
          name: prettyName_(baseName),
          categoryKey: category.key,
          categoryLabel: category.label,
          files: {},
          formats: [],
          thumbId: "",
          imageId: "",
          timelapseId: "",
          thumbnailUrl: "",
        });
      }

      const item = byBase.get(baseKey);
      const fileId = file.fileId || file.id;
      const fileInfo = {
        key: format.key,
        label: format.label,
        fileId,
        id: fileId,
        name: file.name,
        ext,
        mimeType: file.mimeType || "",
        downloadName: baseName,
        thumbnailUrl: file.thumbnailUrl || file.thumbnailLink || "",
        driveUrl: file.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
        drivePreviewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      };

      item.files[format.key] = fileInfo;
      if (!item.formats.some((f) => f.key === format.key)) item.formats.push(fileInfo);

      if (format.key === "image" || isImageFile_(file.name) || String(file.mimeType || "").startsWith("image/")) {
        item.thumbId = item.thumbId || fileInfo.fileId;
        item.imageId = item.imageId || fileInfo.fileId;
        item.thumbnailUrl = item.thumbnailUrl || fileInfo.thumbnailUrl;
      }
      if (format.key === "timelapse" || isVideoFile_(file.name) || String(file.mimeType || "").startsWith("video/")) {
        item.timelapseId = item.timelapseId || fileInfo.fileId;
      }
    }
  }

  const items = [...byBase.values()].map((item) => {
    item.formats.sort((a, b) => formatOrder_(a.key) - formatOrder_(b.key) || a.label.localeCompare(b.label));
    return item;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return { items };
}

async function listDriveFolderEntries_(folderId, apiKey) {
  if (apiKey) {
    const viaApi = await listDriveFolderWithApi_(folderId, apiKey).catch(() => null);
    if (viaApi && (viaApi.files.length || viaApi.folders.length)) return viaApi;
  }
  return await scrapeDriveFolderEntries_(folderId);
}

async function listDriveFolderWithApi_(folderId, apiKey) {
  const out = { files: [], folders: [] };
  let pageToken = "";

  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,webContentLink,modifiedTime,size)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "folder,name");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!res.ok) break;
    const json = await res.json();
    for (const f of json?.files || []) {
      const entry = {
        id: f.id,
        fileId: f.id,
        name: f.name,
        mimeType: f.mimeType || "",
        thumbnailUrl: f.thumbnailLink || "",
        thumbnailLink: f.thumbnailLink || "",
        webViewLink: f.webViewLink || "",
        webContentLink: f.webContentLink || "",
        modifiedTime: f.modifiedTime || "",
        size: f.size || "",
      };
      if (f.mimeType === "application/vnd.google-apps.folder") out.folders.push(entry);
      else out.files.push(entry);
    }
    pageToken = json?.nextPageToken || "";
    if (!pageToken) break;
  }

  return out;
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

    for (const m of html.matchAll(/\["([a-zA-Z0-9_-]{20,})"(?:,[^\]]+?){1,4},"([^"]{2,180})"/g)) {
      const id = m[1];
      const name = decodeHtml_(m[2]).trim();
      if (!id || !name || seen.has(id)) continue;
      if (/^(application\/|image\/|video\/|audio\/)/i.test(name)) continue;
      seen.add(id);
      if (looksLikeFile_(name)) out.files.push({ id, name, fileId: id });
      else out.folders.push({ id, name, label: name, mimeType: "application/vnd.google-apps.folder" });
    }

    if (out.files.length || out.folders.length) break;
  }

  return out;
}

function canonicalCategoryKey_(s) {
  const key = slugify_(s);
  if (!key) return "";
  if (key === "thumbnails") return "thumbnail";
  return key.replace(/s$/, "");
}
function canonicalFormatKey_(s) {
  const key = slugify_(s);
  if (key === "images" || key === "jpg" || key === "jpeg" || key === "png") return "image";
  if (key === "timelapses") return "timelapse";
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
function formatOrder_(key) { return ["image", "timelapse", "psd", "blend", "nomad"].indexOf(key) < 0 ? 99 : ["image", "timelapse", "psd", "blend", "nomad"].indexOf(key); }
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
function jsonResponse_(payload, status = 200, maxAge = 60) { return new Response(JSON.stringify(payload), { status, headers: corsJsonHeaders_(maxAge) }); }
function corsJsonHeaders_(maxAge = 60) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": `public, max-age=${maxAge}`,
  };
}
