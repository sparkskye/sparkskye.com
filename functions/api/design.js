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
  nomad: "NOMAD",
  psd: "PSD",
  timelapse: "TIMELAPSE",
};

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsJsonHeaders_(60) });
  }

  if (requestUrl.searchParams.get("list") === "1") {
    return jsonResponse_({ categories: await listCategories_() }, 200, 300);
  }

  const selected = slugify_(requestUrl.searchParams.get("category") || "all");
  const categories = await listCategories_();
  const wanted = selected && selected !== "all"
    ? categories.filter((c) => c.key === selected)
    : categories;

  const groups = [];
  const allItems = [];

  for (const category of wanted) {
    const built = await buildCategory_(category).catch(() => ({ items: [] }));
    if (built.items.length) {
      groups.push({ key: category.key, label: category.label, folderId: category.folderId, items: built.items });
      allItems.push(...built.items);
    } else {
      groups.push({ key: category.key, label: category.label, folderId: category.folderId, items: [] });
    }
  }

  if (selected === "all") groups.unshift({ key: "all", label: "ALL DESIGN", items: allItems });

  return jsonResponse_({
    root: { id: DESIGN_ROOT_FOLDER_ID, label: "DESIGN" },
    categories,
    groups,
    items: allItems,
  }, 200, 300);
}

async function listCategories_() {
  const merged = new Map();
  const add = (c) => {
    const key = slugify_(c?.key || c?.name || c?.label || "");
    if (!key) return;
    const label = String(c?.label || c?.name || key || "").trim().toUpperCase();
    merged.set(key, {
      key,
      label,
      name: c?.name || titleCase_(label),
      folderId: c?.folderId || c?.id || "",
      formats: c?.formats || {},
    });
  };

  for (const c of MANUAL_CATEGORIES) add(c);

  try {
    const root = await scrapeDriveFolderEntries_(DESIGN_ROOT_FOLDER_ID);
    for (const folder of root.folders || []) add({ name: folder.name, folderId: folder.id });
  } catch {}

  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function buildCategory_(category) {
  const formatFolders = new Map();

  for (const [key, id] of Object.entries(category.formats || {})) {
    formatFolders.set(slugify_(key), { key: slugify_(key), label: FORMAT_LABELS[slugify_(key)] || key.toUpperCase(), folderId: id });
  }

  // Future-friendly fallback: if the category folder itself contains folders named
  // image/psd/blend/etc., pick them up automatically.
  if (category.folderId) {
    try {
      const entries = await scrapeDriveFolderEntries_(category.folderId);
      for (const folder of entries.folders || []) {
        const key = slugify_(folder.name);
        if (!key || formatFolders.has(key)) continue;
        formatFolders.set(key, { key, label: FORMAT_LABELS[key] || folder.name.toUpperCase(), folderId: folder.id });
      }
    } catch {}
  }

  const byBase = new Map();

  for (const format of formatFolders.values()) {
    if (!format.folderId) continue;
    const entries = await scrapeDriveFolderEntries_(format.folderId).catch(() => ({ files: [] }));

    for (const file of entries.files || []) {
      const ext = getExtension_(file.name);
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
        });
      }

      const item = byBase.get(baseKey);
      const fileInfo = {
        key: format.key,
        label: format.label,
        fileId: file.fileId || file.id,
        id: file.fileId || file.id,
        name: file.name,
        ext,
        downloadName: baseName,
        driveUrl: `https://drive.google.com/file/d/${file.fileId || file.id}/view`,
        drivePreviewUrl: `https://drive.google.com/file/d/${file.fileId || file.id}/preview`,
      };

      item.files[format.key] = fileInfo;
      if (!item.formats.some((f) => f.key === format.key)) item.formats.push(fileInfo);

      if (format.key === "image" || isImageFile_(file.name)) {
        item.thumbId = item.thumbId || fileInfo.fileId;
        item.imageId = item.imageId || fileInfo.fileId;
      }
      if (format.key === "timelapse" || isVideoFile_(file.name)) {
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
      if (folderIdMatch) out.folders.push({ id, name, label: name });
      else out.files.push({ id, name, fileId: id });
    }

    for (const m of html.matchAll(/\["([a-zA-Z0-9_-]{20,})"(?:,[^\]]+?){1,4},"([^"]{2,160})"/g)) {
      const id = m[1];
      const name = decodeHtml_(m[2]).trim();
      if (!id || !name || seen.has(id)) continue;
      if (/^(application\/|image\/|video\/|audio\/)/i.test(name)) continue;
      seen.add(id);
      if (looksLikeFile_(name)) out.files.push({ id, name, fileId: id });
      else out.folders.push({ id, name, label: name });
    }

    if (out.files.length || out.folders.length) break;
  }

  return out;
}

function looksLikeFile_(name) {
  return /\.[a-z0-9]{2,8}$/i.test(String(name || ""));
}
function isImageFile_(name) { return /\.(png|jpe?g|webp|gif)$/i.test(String(name || "")); }
function isVideoFile_(name) { return /\.(mp4|mov|webm|m4v)$/i.test(String(name || "")); }
function stripExtension_(name) { return String(name || "").replace(/\.[a-z0-9]{2,8}$/i, ""); }
function getExtension_(name) { const m = String(name || "").match(/\.([a-z0-9]{2,8})$/i); return m ? m[1].toLowerCase() : ""; }
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
