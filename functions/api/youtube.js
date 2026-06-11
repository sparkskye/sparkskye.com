const DEFAULT_HANDLE = "@sparkskye";
const DEFAULT_CHANNEL_ID = "UC7goIyC98-qIrlHfto--zWg";

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsJsonHeaders_(60) });
  }

  const handle = normalizeHandle_(requestUrl.searchParams.get("handle") || DEFAULT_HANDLE);
  const apiKey = context.env?.GOOGLE_API_KEY || context.env?.YOUTUBE_API_KEY || "";
  const debugMode = requestUrl.searchParams.has("debug") || requestUrl.searchParams.get("test") === "1";
  const debug = {
    apiKeySeen: !!apiKey,
    channelIdSource: "default",
    attempts: [],
  };

  let channelId = handle.toLowerCase() === DEFAULT_HANDLE ? DEFAULT_CHANNEL_ID : "";
  let channelTitle = "Sparkskye";

  if (apiKey && !channelId) {
    const resolved = await resolveChannelWithApi_(handle, apiKey, debug);
    channelId = resolved.channelId || channelId;
    channelTitle = resolved.title || channelTitle;
    if (channelId) debug.channelIdSource = "youtube-api";
  }

  if (!channelId) {
    try {
      const resolved = await resolveChannelFromHandlePage_(handle);
      channelId = resolved.channelId || "";
      channelTitle = resolved.title || channelTitle;
      if (channelId) debug.channelIdSource = "handle-page";
    } catch (error) {
      debug.attempts.push({ step: "resolve-handle-page", ok: false, error: String(error?.message || error) });
    }
  }

  if (!channelId) {
    return jsonResponse_({
      source: "youtube",
      handle,
      channel: { id: "", title: channelTitle, url: `https://www.youtube.com/${handle}` },
      apiStatsEnabled: !!apiKey,
      items: [],
      error: "Could not resolve YouTube channel id from handle.",
      ...(debugMode ? { debug } : {}),
    }, 200, debugMode ? 0 : 60);
  }

  let items = [];

  // First try the full YouTube API path: channel -> uploads playlist -> video details.
  if (apiKey) {
    try {
      items = await fetchChannelVideosWithApi_(channelId, apiKey, debug);
    } catch (error) {
      debug.attempts.push({ step: "full-api", ok: false, error: String(error?.message || error) });
      items = [];
    }
  }

  // Fallback: RSS already works for public uploads. If the API key works for videos.list,
  // hydrate those RSS video IDs with views/likes/comments/duration.
  if (!items.length) {
    const rssItems = await fetchRssItems_(channelId, debug).catch((error) => {
      debug.attempts.push({ step: "rss", ok: false, error: String(error?.message || error) });
      return [];
    });

    if (apiKey && rssItems.length) {
      const rssIds = rssItems.map((item) => item.id).filter(Boolean);
      try {
        const hydrated = await fetchVideoDetails_(rssIds, apiKey, debug, "rss-video-details");
        if (hydrated.length) items = hydrated;
      } catch (error) {
        debug.attempts.push({ step: "rss-video-details", ok: false, error: String(error?.message || error) });
      }
    }

    if (!items.length) {
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
  }

  // The YouTube Data API does not provide a clean "Shorts vs Videos tab" flag.
  // Use the public channel tabs as the source of truth for the gallery chips,
  // then fall back to metadata heuristics only when a tab does not reveal an ID.
  if (items.length) {
    try {
      const tabTypes = await fetchChannelTabTypes_(handle, debug);
      if (tabTypes.map.size) {
        items = items.map((item) => {
          const tabType = tabTypes.map.get(item.id);
          return tabType ? { ...item, type: tabType, youtubeTab: tabType } : item;
        });
      }
    } catch (error) {
      debug.attempts.push({ step: "tab-type-map", ok: false, error: String(error?.message || error) });
    }
  }

  const responseMaxAge = debugMode ? 0 : 300;
  return jsonResponse_({
    source: "youtube",
    handle,
    channel: { id: channelId, title: channelTitle, url: `https://www.youtube.com/${handle}` },
    apiStatsEnabled: !!apiKey,
    items,
    ...(debugMode ? { debug } : {}),
  }, 200, responseMaxAge);
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

async function resolveChannelWithApi_(handle, apiKey, debug) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,snippet");
  url.searchParams.set("forHandle", handle.replace(/^@/, ""));
  url.searchParams.set("key", apiKey);
  const result = await fetchJson_(url, 3600, "resolve-channel-api", debug);
  if (!result.ok) return { channelId: "", title: "" };
  const item = result.json?.items?.[0] || null;
  return { channelId: item?.id || "", title: item?.snippet?.title || "" };
}

async function fetchChannelVideosWithApi_(channelId, apiKey, debug) {
  const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
  channelUrl.searchParams.set("part", "snippet,contentDetails");
  channelUrl.searchParams.set("id", channelId);
  channelUrl.searchParams.set("key", apiKey);

  const channelResult = await fetchJson_(channelUrl, 3600, "channel-content-details", debug);
  if (!channelResult.ok) return [];
  const uploadsPlaylistId = channelResult.json?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || "";
  if (!uploadsPlaylistId) {
    debug.attempts.push({ step: "channel-content-details", ok: true, note: "No uploads playlist returned." });
    return [];
  }

  const ids = [];
  let pageToken = "";

  for (let page = 0; page < 3; page += 1) {
    const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    playlistUrl.searchParams.set("part", "contentDetails");
    playlistUrl.searchParams.set("playlistId", uploadsPlaylistId);
    playlistUrl.searchParams.set("maxResults", "50");
    playlistUrl.searchParams.set("key", apiKey);
    if (pageToken) playlistUrl.searchParams.set("pageToken", pageToken);

    const playlistResult = await fetchJson_(playlistUrl, 600, `playlist-items-page-${page + 1}`, debug);
    if (!playlistResult.ok) break;
    for (const item of playlistResult.json?.items || []) {
      const id = item?.contentDetails?.videoId || "";
      if (id) ids.push(id);
    }
    pageToken = playlistResult.json?.nextPageToken || "";
    if (!pageToken) break;
  }

  if (!ids.length) return [];
  return await fetchVideoDetails_(ids, apiKey, debug, "playlist-video-details");
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

async function fetchRssItems_(channelId, debug) {
  const rss = new URL("https://www.youtube.com/feeds/videos.xml");
  rss.searchParams.set("channel_id", channelId);
  const res = await fetch(rss.toString(), {
    headers: { "User-Agent": "sparkskye-pages-proxy" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  debug.attempts.push({ step: "rss", ok: res.ok, status: res.status });
  if (!res.ok) return [];
  const xml = await res.text();
  const entries = xml.split(/<entry>/g).slice(1);
  const items = entries.map((entry) => {
    const id = textTag_(entry, "yt:videoId");
    const title = decodeXml_(textTag_(entry, "title"));
    const publishedAt = textTag_(entry, "published");
    const updatedAt = textTag_(entry, "updated");
    const thumbnail = firstMatch_(entry, /<media:thumbnail[^>]+url="([^"]+)"/i) || "";
    return { id, title, publishedAt, updatedAt, thumbnail };
  }).filter((v) => v.id && v.title);
  debug.attempts.push({ step: "rss-parse", ok: true, count: items.length });
  return items;
}

async function fetchVideoDetails_(ids, apiKey, debug, stepPrefix = "video-details") {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics,contentDetails,liveStreamingDetails");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);
    const result = await fetchJson_(url, 600, `${stepPrefix}-${Math.floor(i / 50) + 1}`, debug);
    if (!result.ok) continue;
    for (const item of result.json?.items || []) {
      const stats = item.statistics || {};
      const snip = item.snippet || {};
      const thumbs = snip.thumbnails || {};
      const durationRaw = item.contentDetails?.duration || "";
      const durationSeconds = durationSeconds_(durationRaw);
      const thumbList = thumbnailList_(thumbs);
      const preliminaryType = classifyVideo_(item, durationSeconds, null);
      const thumb = chooseThumbnail_(thumbList, preliminaryType, item.id);
      const type = classifyVideo_(item, durationSeconds, thumb);
      const finalThumb = chooseThumbnail_(thumbList, type, item.id);
      out.push({
        id: item.id,
        title: snip.title || "",
        description: snip.description || "",
        publishedAt: snip.publishedAt || "",
        publishedLabel: formatDate_(snip.publishedAt || ""),
        thumbnail: finalThumb.url,
        thumbnailWidth: finalThumb.width || null,
        thumbnailHeight: finalThumb.height || null,
        thumbnailAspectRatio: finalThumb.aspectRatio || (type === "short" ? "9 / 16" : "16 / 9"),
        shortThumbnail: `https://i.ytimg.com/vi/${item.id}/oardefault.jpg`,
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
  debug.attempts.push({ step: `${stepPrefix}-complete`, ok: true, count: out.length });
  return out.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
}

async function fetchJson_(url, ttl, step, debug) {
  const res = await fetch(url.toString(), { cf: { cacheTtl: ttl, cacheEverything: true } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const entry = { step, ok: res.ok, status: res.status };
  const error = json?.error || null;
  if (error) {
    entry.errorCode = error.code || res.status;
    entry.errorStatus = error.status || "";
    entry.errorMessage = String(error.message || "").slice(0, 240);
    entry.errorReason = error.errors?.[0]?.reason || "";
  }
  if (res.ok && json?.items) entry.count = json.items.length;
  debug.attempts.push(entry);
  return { ok: res.ok, status: res.status, json };
}

async function fetchChannelTabTypes_(handle, debug) {
  const base = `https://www.youtube.com/${encodeURIComponent(handle)}`;
  const tabs = [
    { kind: "video", path: "/videos" },
    { kind: "live", path: "/streams" },
    { kind: "short", path: "/shorts" },
  ];

  const map = new Map();
  const counts = { video: 0, short: 0, live: 0 };

  // Intentional order: VIDEOS first, then LIVESTREAMS, then SHORTS.
  // If YouTube repeats an ID in more than one page, the more specific tabs win.
  for (const tab of tabs) {
    const ids = await fetchChannelTabIds_(`${base}${tab.path}`, tab.kind, debug);
    counts[tab.kind] = ids.size;
    for (const id of ids) map.set(id, tab.kind);
  }

  debug.attempts.push({ step: "tab-type-map-complete", ok: true, ...counts });
  return { map, counts };
}

async function fetchChannelTabIds_(url, kind, debug) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 sparkskye-pages-proxy",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  debug.attempts.push({ step: `youtube-tab-${kind}`, ok: res.ok, status: res.status });
  if (!res.ok) return new Set();

  const html = await res.text();
  const ids = extractIdsFromChannelTab_(html, kind);
  debug.attempts.push({ step: `youtube-tab-${kind}-parse`, ok: true, count: ids.size });
  return ids;
}

function extractIdsFromChannelTab_(html, kind) {
  const text = String(html || "");
  const ids = new Set();

  // Shorts are safest to identify from /shorts/<id> URLs.
  if (kind === "short") {
    addMatches_(ids, text, /\/(?:shorts)\/([a-zA-Z0-9_-]{11})/g);
    addMatches_(ids, text, /%2Fshorts%2F([a-zA-Z0-9_-]{11})/g);
    if (ids.size) return ids;
  }

  // Videos and livestream archives usually appear as videoId fields and watch URLs.
  addMatches_(ids, text, /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g);
  addMatches_(ids, text, /watch\?v=([a-zA-Z0-9_-]{11})/g);
  addMatches_(ids, text, /watch%3Fv%3D([a-zA-Z0-9_-]{11})/g);
  addMatches_(ids, text, /%2Fwatch%3Fv%3D([a-zA-Z0-9_-]{11})/g);
  return ids;
}

function addMatches_(set, text, regex) {
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(text))) {
    if (match[1]) set.add(match[1]);
  }
}

function classifyVideo_(item, durationSeconds, thumb = null) {
  const liveDetails = item.liveStreamingDetails || null;
  const liveState = String(item.snippet?.liveBroadcastContent || "").toLowerCase();
  if (
    liveState === "live" ||
    liveState === "upcoming" ||
    liveDetails?.actualStartTime ||
    liveDetails?.scheduledStartTime
  ) return "live";

  const text = `${item.snippet?.title || ""} ${item.snippet?.description || ""}`;
  if (/(^|\s)#?shorts?(\s|$)|youtube\s+shorts|\/shorts\//i.test(text)) return "short";

  const portraitThumb = thumb?.width && thumb?.height && Number(thumb.height) > Number(thumb.width) * 1.15;
  if (portraitThumb) return "short";

  // Do not classify by duration alone. Plenty of normal videos are under 3 minutes.
  // The channel tab scraper above is the main Shorts/Videos/Livestream source of truth.
  if (durationSeconds > 0 && durationSeconds <= 60 && portraitThumb) return "short";

  return "video";
}

function thumbnailList_(thumbs = {}) {
  return ["maxres", "standard", "high", "medium", "default"]
    .map((key) => ({
      key,
      url: thumbs?.[key]?.url || "",
      width: numberOrNull_(thumbs?.[key]?.width),
      height: numberOrNull_(thumbs?.[key]?.height),
    }))
    .filter((thumb) => thumb.url);
}

function chooseThumbnail_(thumbs, type, id) {
  const fallback = {
    url: `https://i.ytimg.com/vi/${id}/${type === "short" ? "oardefault" : "hqdefault"}.jpg`,
    width: type === "short" ? 720 : 480,
    height: type === "short" ? 1280 : 360,
    aspectRatio: type === "short" ? "9 / 16" : "16 / 9",
  };
  if (!Array.isArray(thumbs) || !thumbs.length) return fallback;

  const landscape = thumbs.find((thumb) => thumb.width && thumb.height && thumb.width >= thumb.height);
  const portrait = thumbs.find((thumb) => thumb.width && thumb.height && thumb.height > thumb.width);
  const chosen = type === "short" ? (portrait || thumbs[0]) : (landscape || thumbs[0]);
  const width = chosen.width || fallback.width;
  const height = chosen.height || fallback.height;
  return {
    url: chosen.url || fallback.url,
    width,
    height,
    aspectRatio: width && height ? `${width} / ${height}` : fallback.aspectRatio,
  };
}

function looksLikeShortWithoutApi_(item) {
  return /(^|\s)#?shorts?(\s|$)|youtube\s+shorts|\/shorts\//i.test(`${item?.title || ""}`);
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
    "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store, max-age=0",
  };
}
