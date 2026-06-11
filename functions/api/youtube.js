const DEFAULT_HANDLE = "@sparkskye";

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsJsonHeaders_(60) });
  }

  const handle = normalizeHandle_(requestUrl.searchParams.get("handle") || DEFAULT_HANDLE);
  const apiKey = context.env?.YOUTUBE_API_KEY || "";

  let channelId = "";
  let channelTitle = "Sparkskye";

  try {
    channelId = apiKey ? await resolveChannelIdWithApi_(handle, apiKey) : "";
  } catch {}

  if (!channelId) {
    try {
      const resolved = await resolveChannelFromHandlePage_(handle);
      channelId = resolved.channelId || "";
      channelTitle = resolved.title || channelTitle;
    } catch {}
  }

  if (!channelId) {
    return jsonResponse_({
      source: "youtube",
      handle,
      channel: { id: "", title: channelTitle, url: `https://www.youtube.com/${handle}` },
      apiStatsEnabled: !!apiKey,
      items: [],
      error: "Could not resolve YouTube channel id from handle.",
    }, 200, 60);
  }

  const rssItems = await fetchRssItems_(channelId).catch(() => []);
  const videoIds = rssItems.map((v) => v.id).filter(Boolean);

  let apiDetails = new Map();
  if (apiKey && videoIds.length) {
    try {
      apiDetails = await fetchVideoDetails_(videoIds, apiKey);
    } catch {}
  }

  const items = rssItems.map((item) => {
    const detail = apiDetails.get(item.id) || {};
    return {
      ...item,
      ...detail,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      embedUrl: `https://www.youtube.com/embed/${item.id}`,
      thumbnail: detail.thumbnail || item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      publishedLabel: formatDate_(detail.publishedAt || item.publishedAt),
      statsReady: !!apiKey && !!detail.statsReady,
    };
  });

  return jsonResponse_({
    source: "youtube",
    handle,
    channel: { id: channelId, title: channelTitle, url: `https://www.youtube.com/${handle}` },
    apiStatsEnabled: !!apiKey,
    items,
  }, 200, 300);
}

function normalizeHandle_(raw) {
  const s = String(raw || DEFAULT_HANDLE).trim();
  if (!s) return DEFAULT_HANDLE;
  if (s.startsWith("http")) {
    try {
      const u = new URL(s);
      const handle = u.pathname.split("/").filter(Boolean).find((part) => part.startsWith("@"));
      return handle || DEFAULT_HANDLE;
    } catch { return DEFAULT_HANDLE; }
  }
  return s.startsWith("@") ? s : `@${s}`;
}

async function resolveChannelIdWithApi_(handle, apiKey) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,snippet");
  url.searchParams.set("forHandle", handle.replace(/^@/, ""));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) return "";
  const json = await res.json();
  return json?.items?.[0]?.id || "";
}

async function resolveChannelFromHandlePage_(handle) {
  const res = await fetch(`https://www.youtube.com/${encodeURIComponent(handle)}`, {
    headers: { "User-Agent": "Mozilla/5.0 sparkskye-pages-proxy" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) return { channelId: "", title: "" };
  const html = await res.text();
  const channelId =
    firstMatch_(html, /"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/) ||
    firstMatch_(html, /"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/) ||
    firstMatch_(html, /<meta itemprop="channelId" content="(UC[a-zA-Z0-9_-]{20,})">/i) ||
    "";
  const title = decodeHtml_(
    firstMatch_(html, /<meta property="og:title" content="([^"]+)"/i) ||
    firstMatch_(html, /"title"\s*:\s*"([^"]+)"/) ||
    ""
  );
  return { channelId, title };
}

async function fetchRssItems_(channelId) {
  const rss = new URL("https://www.youtube.com/feeds/videos.xml");
  rss.searchParams.set("channel_id", channelId);
  const res = await fetch(rss.toString(), {
    headers: { "User-Agent": "sparkskye-pages-proxy" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const entries = xml.split(/<entry>/g).slice(1);
  return entries.map((entry) => {
    const id = textTag_(entry, "yt:videoId");
    const title = decodeXml_(textTag_(entry, "title"));
    const publishedAt = textTag_(entry, "published");
    const updatedAt = textTag_(entry, "updated");
    const thumbnail = firstMatch_(entry, /<media:thumbnail[^>]+url="([^"]+)"/i) || "";
    return { id, title, publishedAt, updatedAt, thumbnail };
  }).filter((v) => v.id && v.title);
}

async function fetchVideoDetails_(ids, apiKey) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics,contentDetails");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString(), { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!res.ok) continue;
    const json = await res.json();
    for (const item of json?.items || []) {
      const stats = item.statistics || {};
      const snip = item.snippet || {};
      const thumbs = snip.thumbnails || {};
      out.set(item.id, {
        title: snip.title || "",
        description: snip.description || "",
        publishedAt: snip.publishedAt || "",
        thumbnail: thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || "",
        duration: formatDuration_(item.contentDetails?.duration || ""),
        durationRaw: item.contentDetails?.duration || "",
        viewCount: numberOrNull_(stats.viewCount),
        likeCount: numberOrNull_(stats.likeCount),
        commentCount: numberOrNull_(stats.commentCount),
        statsReady: true,
      });
    }
  }
  return out;
}

function firstMatch_(text, re) {
  const m = String(text || "").match(re);
  return m ? m[1] : "";
}

function textTag_(xml, tag) {
  const safe = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${safe}[^>]*>([\\s\\S]*?)<\\/${safe}>`, "i");
  return decodeXml_(firstMatch_(xml, re));
}

function numberOrNull_(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatDate_(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
  } catch { return ""; }
}

function formatDuration_(iso) {
  const m = String(iso || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return "";
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  if (h) return `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${min}:${String(s).padStart(2, "0")}`;
}

function decodeXml_(s) { return decodeHtml_(s); }
function decodeHtml_(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function jsonResponse_(payload, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(payload), { status, headers: corsJsonHeaders_(maxAge) });
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
