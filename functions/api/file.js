export async function onRequest(context) {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");
  const requestedName = url.searchParams.get("name") || url.searchParams.get("filename") || "";
  const ext = (url.searchParams.get("ext") || "").replace(/^\./, "");

  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  let safeName = sanitizeFilename(requestedName);
  // If the caller provided a basename plus ext, enforce it so Safari/iOS doesn't
  // treat this as a generic binary and append ".bin".
  if (ext) {
    const lower = safeName.toLowerCase();
    const want = `.${ext.toLowerCase()}`;
    if (safeName && !lower.endsWith(want)) safeName = `${safeName}${want}`;
    if (!safeName) safeName = `download${want}`;
  }

  const driveRes = await fetchDriveFile(id);

  if (!driveRes || !driveRes.ok) {
    const status = driveRes?.status || 502;
    let body = "Failed to fetch file";
    try {
      body = await driveRes.text();
    } catch {}
    return new Response(body, corsTextHeaders(status));
  }

  const headers = new Headers();
  // Use Drive's content-type unless we can confidently infer it from the requested filename.
  const inferred = contentTypeFromName(safeName);
  headers.set(
    "Content-Type",
    inferred || driveRes.headers.get("Content-Type") || "application/octet-stream"
  );
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Range");
  headers.set("Cache-Control", "public, max-age=86400");

  // Force a consistent filename for downloads.
  if (safeName) {
    // iOS/Safari is picky — include both filename and filename* to avoid odd ".bin" naming.
    const enc = encodeURIComponent(safeName);
    headers.set(
      "Content-Disposition",
      `attachment; filename=\"${safeName}\"; filename*=UTF-8''${enc}`
    );
  } else {
    // Best-effort: preserve Drive's filename when the caller didn't provide one.
    const driveDisposition =
      driveRes.headers.get("Content-Disposition") ||
      driveRes.headers.get("content-disposition") ||
      "";
    const m =
      /filename\*=UTF-8''([^;]+)/i.exec(driveDisposition) ||
      /filename=\"?([^\";]+)\"?/i.exec(driveDisposition);
    if (m && m[1]) {
      try {
        const decoded = decodeURIComponent(String(m[1]).replace(/\+/g, "%20"));
        const inferredName = sanitizeFilename(decoded);
        if (inferredName) {
          const enc = encodeURIComponent(inferredName);
          headers.set(
            "Content-Disposition",
            `attachment; filename=\"${inferredName}\"; filename*=UTF-8''${enc}`
          );
        }
      } catch {
        // ignore
      }
    }
  }

  return new Response(driveRes.body, { headers });
}

function corsTextHeaders(status = 502) {
  return {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Cache-Control": "no-store",
    },
  };
}

function contentTypeFromName(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return null;
  if (n.endsWith(".gltf")) return "model/gltf+json; charset=utf-8";
  if (n.endsWith(".glb")) return "model/gltf-binary";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".json")) return "application/json; charset=utf-8";
  return null;
}

function sanitizeFilename(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  // Strip path separators + quotes + control chars.
  return s
    .replace(/[\\/]/g, "-")
    .replace(/[\"\n\r\t\0]/g, "")
    .slice(0, 180);
}

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  // Workers may collapse multiple Set-Cookie headers into one string.
  // This is a best-effort extraction of cookie pairs.
  return setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .map((part) => part.split(";")[0])
    .join("; ");
}

function decodeDriveUrl(raw) {
  return String(raw || "")
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absolutizeDriveUrl(raw) {
  const decoded = decodeDriveUrl(raw).trim();
  if (!decoded) return "";
  if (decoded.startsWith("//")) return `https:${decoded}`;
  if (decoded.startsWith("/")) return `https://drive.google.com${decoded}`;
  return decoded;
}

function extractDriveDownloadUrls(html, id) {
  const urls = [];
  const add = (raw) => {
    const absolute = absolutizeDriveUrl(raw);
    if (!absolute) return;
    if (!/https:\/\/(drive\.google\.com|drive\.usercontent\.google\.com)\//i.test(absolute)) return;
    if (!/(\/uc\?|\/download)/i.test(absolute)) return;
    if (!urls.includes(absolute)) urls.push(absolute);
  };

  const decoded = decodeDriveUrl(html);

  for (const re of [
    /(?:href|action)=["']([^"']+)["']/gi,
    /(https:\/\/drive\.usercontent\.google\.com\/download[^"'<>\s]+)/gi,
    /(https:\/\/drive\.google\.com\/uc\?[^"'<>\s]+)/gi,
  ]) {
    let m;
    while ((m = re.exec(decoded))) add(m[1] || m[0]);
  }

  const confirmMatch = /[?&]confirm=([^&"'<>\s]+)/i.exec(decoded);
  const confirm = confirmMatch ? decodeURIComponent(confirmMatch[1]) : "t";

  urls.push(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=${encodeURIComponent(confirm)}`);
  urls.push(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}&confirm=${encodeURIComponent(confirm)}`);

  return [...new Set(urls)];
}

async function fetchDriveUrl(url, cookie = "") {
  const headers = {
    "User-Agent": "sparkskye-pages-file-proxy",
  };
  if (cookie) headers.cookie = cookie;
  return await fetch(url, { redirect: "follow", headers });
}

function isHtmlResponse(res) {
  return (res.headers.get("Content-Type") || "").toLowerCase().includes("text/html");
}

async function fetchDriveFile(id) {
  const base = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  const initialCandidates = [
    // This URL often skips Drive's large-file warning page entirely.
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    `${base}&confirm=t`,
    base,
  ];

  let lastErrorResponse = null;
  const seen = new Set();

  async function tryCandidate(candidate, cookie = "") {
    const url = absolutizeDriveUrl(candidate);
    if (!url || seen.has(url)) return null;
    seen.add(url);

    const res = await fetchDriveUrl(url, cookie);
    if (res.ok && !isHtmlResponse(res)) return res;
    if (!isHtmlResponse(res)) {
      lastErrorResponse = res;
      return null;
    }

    const setCookie = res.headers.get("set-cookie") || "";
    const cookieHeader = cookieHeaderFromSetCookie(setCookie) || cookie;
    const html = await res.text();

    for (const nextUrl of extractDriveDownloadUrls(html, id)) {
      const nextRes = await tryCandidate(nextUrl, cookieHeader);
      if (nextRes) return nextRes;
    }

    lastErrorResponse = new Response(
      "Drive returned an interstitial page that could not be bypassed.",
      { status: 502 }
    );
    return null;
  }

  for (const candidate of initialCandidates) {
    const res = await tryCandidate(candidate);
    if (res) return res;
  }

  return lastErrorResponse || new Response("Failed to fetch file from Drive.", { status: 502 });
}
