const DEFAULT_HANDLE = "@sparkskye";
const DEFAULT_CHANNEL_ID = "UC7goIyC98-qIrlHfto--zWg";

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsJsonHeaders_(60) });
  }

  const handle = normalizeHandle_(requestUrl.searchParams.get("handle") || DEFAULT_HANDLE);
  const apiKey = context.env?.GOOGLE_API_KEY || context.env?.YOUTUBE_API_KEY || "";

  let channelId = handle.toLowerCase() === DEFAULT_HANDLE ? DEFAULT_CHANNEL_ID : "";
  let channelTitle = "Sparkskye";

  if (apiKey && !channelId) {
    try {
      const resolved = await resolveChannelWithApi_(handle, apiKey);
      channelId = resolved.channelId || channelId;
      channelTitle = resolved.title || channelTitle;
    } catch {}
  }

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

  let items = [];
  if (apiKey) {
    try {
      items = await fetchChannelVideosWithApi_(channelId, apiKey);
    } catch {
      items = [];
    }
  }

  if (!items.length) {
    const rssItems = await fetchRssItems_(channelId).catch(() => []);
    items = rssItems.map((item) => ({
      ...item,
      type: looksLikeShortWithoutApi_(item) ? "short" : "video",
      url: `https://www.youtube.com/watch?v=${item.id}`,
      embedUrl: `https://www.youtube.com/embed/${item.id}`,
      thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      publishedLabel: formatDate_(item.publishedAt),
      statsReady: false,
    }));
  }

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

async function resolveChannelWithApi_(handle, apiKey) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,snippet");
  url.searchParams.set("forHandle", handle.replace(/^@/, ""));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) return { channelId: "", title: "" };
  const json = await res.json();
  const item = json?.items?.[0] || null;
  return { channelId: item?.id || "", title: item?.snippet?.title || "" };
}

async function fetchChannelVideosWithApi_(channelId, apiKey) {
  const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
  channelUrl.searchParams.set("part", "snippet,contentDetails");
  channelUrl.searchParams.set("id", channelId);
  channelUrl.searchParams.set("key", apiKey);

  const channelRes = await fetch(channelUrl.toString(), { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!channelRes.ok) return [];
  const channelJson = await channelRes.json();
  const uploadsPlaylistId = channelJson?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || "";
  if (!uploadsPlaylistId) return [];

  const ids = [];
  let pageToken = "";

  for (let page = 0; page < 3; page += 1) {
    const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    playlistUrl.searchParams.set("part", "contentDetails");
    playlistUrl.searchParams.set("playlistId", uploadsPlaylistId);
    playlistUrl.searchParams.set("maxResults", "50");
    playlistUrl.searchParams.set("key", apiKey);
    if (pageToken) playlistUrl.searchParams.set("pageToken", pageToken);

    const playlistRes = await fetch(playlistUrl.toString(), { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!playlistRes.ok) break;
    const playlistJson = await playlistRes.json();
    for (const item of playlistJson?.items || []) {
      const id = item?.contentDetails?.videoId || "";
      if (id) ids.push(id);
    }
    pageToken = playlistJson?.nextPageToken || "";
    if (!pageToken) break;
  }

  return await fetchVideoDetails_(ids, apiKey);
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
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics,contentDetails,liveStreamingDetails");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString(), { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!res.ok) continue;
    const json = await res.json();
    for (const item of json?.items || []) {
      const stats = item.statistics || {};
      const snip = item.snippet || {};
      const thumbs = snip.thumbnails || {};
      const durationRaw = item.contentDetails?.duration || "";
      const durationSeconds = durationSeconds_(durationRaw);
      const type = classifyVideo_(item, durationSeconds);
      out.push({
        id: item.id,
        title: snip.title || "",
        description: snip.description || "",
        publishedAt: snip.publishedAt || "",
        publishedLabel: formatDate_(snip.publishedAt || ""),
        thumbnail: thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
        duration: formatDuration_(durationRaw),
        durationRaw,
        durationSeconds,
        type,
        viewCount: numberOrNull_(stats.viewCount),
        likeCount: numberOrNull_(stats.likeCount),
        commentCount: numberOrNull_(stats.commentCount),
        url: `https://www.youtube.com/watch?v=${item.id}`,
        embedUrl: `https://www.youtube.com/embed/${item.id}`,
        statsReady: true,
      });
    }
  }
  return out.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
}

function classifyVideo_(item, durationSeconds) {
  const live = item.liveStreamingDetails || item.snippet?.liveBroadcastContent === "live" || item.snippet?.liveBroadcastContent === "upcoming";
  if (live) return "live";
  if (durationSeconds > 0 && durationSeconds <= 60) return "short";
  return "video";
}

function looksLikeShortWithoutApi_(item) {
  return /(^|\s)#?shorts?(\s|$)/i.test(`${item?.title || ""}`);
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

function durationSeconds_(iso) {
  const m = String(iso || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function formatDuration_(iso) {
  const total = durationSeconds_(iso);
  if (!total) return "";
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
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
