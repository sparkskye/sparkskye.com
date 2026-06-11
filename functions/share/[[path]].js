const ACCENT = "#00aaff";

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const parts = normalizeParts_(context.params?.path);
  const kind = (parts[0] || "").toLowerCase();
  const id = decodeURIComponent(parts.slice(1).join("/") || "").trim();

  if (!id || !["editing", "design"].includes(kind)) {
    return htmlResponse_(renderShareHtml_({
      title: "sparkskye",
      description: "sparkskye creations",
      image: `${requestUrl.origin}/public/img/favicon.png`,
      destination: "/",
    }), 404);
  }

  let meta = null;
  try {
    meta = kind === "editing"
      ? await getEditingMeta_(requestUrl, id)
      : await getDesignMeta_(requestUrl, id);
  } catch (err) {
    meta = null;
  }

  const fallbackDestination = kind === "editing"
    ? `/editing/?preview=${encodeURIComponent(id)}`
    : `/design/?preview=${encodeURIComponent(id)}`;

  const destination = safeGo_(requestUrl.searchParams.get("go")) || fallbackDestination;
  const title = meta?.title || (kind === "editing" ? "sparkskye video" : "sparkskye design");
  const description = meta?.description || (kind === "editing" ? "my youtube videos" : "thumbnails, profiles, banners, and other graphic design work");
  const image = absoluteUrl_(meta?.image || "/public/img/favicon.png", requestUrl.origin);

  return htmlResponse_(renderShareHtml_({ title, description, image, destination, pageUrl: requestUrl.toString() }), 200);
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
    description: formatList_(item) || "design file",
    image: item.imagePreviewUrl || item.files?.image?.previewUrl || item.thumbnailUrl || "/public/img/favicon.png",
  };
}

function renderShareHtml_({ title, description, image, destination, pageUrl = "" }) {
  const t = esc_(title);
  const d = esc_(description);
  const img = esc_(image);
  const dest = esc_(destination);
  const url = esc_(pageUrl || destination);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="theme-color" content="${ACCENT}">
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${dest}">
<style>body{margin:0;background:#141414;color:#f2f2f2;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}a{color:${ACCENT}}</style>
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

function formatList_(item) {
  const preferred = ["image", "psd", "timelapse", "blend", "nomad"];
  const files = item.files || {};
  return preferred
    .filter((key) => files[key])
    .concat((item.formats || []).map((f) => f.key).filter((key) => key && !preferred.includes(key)))
    .filter((key, idx, arr) => arr.indexOf(key) === idx)
    .map((key) => String(key).toLowerCase())
    .join(", ");
}
