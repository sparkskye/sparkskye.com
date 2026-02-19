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
    return new Response(body, { status });
  }

  const headers = new Headers();
  // Use Drive's content-type unless we can confidently infer it from the requested filename.
  const inferred = contentTypeFromName(safeName);
  headers.set(
    "Content-Type",
    inferred || driveRes.headers.get("Content-Type") || "application/octet-stream"
  );
  headers.set("Access-Control-Allow-Origin", "*");
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
        const inferred = sanitizeFilename(decoded);
        if (inferred) {
          const enc = encodeURIComponent(inferred);
          headers.set(
            "Content-Disposition",
            `attachment; filename=\"${inferred}\"; filename*=UTF-8''${enc}`
          );
        }
      } catch {
        // ignore
      }
    }
  }

  return new Response(driveRes.body, { headers });
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
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .map((part) => part.split(";")[0])
    .join("; ");
}

async function fetchDriveFile(id) {
  const base = `https://drive.google.com/uc?export=download&id=${id}`;
  const first = await fetch(base, { redirect: "follow" });
  const ct1 = (first.headers.get("Content-Type") || "").toLowerCase();

  // Normal path: we got the file stream.
  if (!ct1.includes("text/html")) return first;

  // Large/flagged files return an interstitial HTML page that requires a confirm token.
  const html = await first.text();

  let confirm = null;
  const mConfirm = html.match(/confirm=([0-9A-Za-z_]+)&/);
  if (mConfirm) confirm = mConfirm[1];

  const setCookie = first.headers.get("set-cookie") || "";
  const mCookie = setCookie.match(/download_warning[^=]*=([^;]+)/);
  if (mCookie) confirm = confirm || mCookie[1];

  // Sometimes the confirm URL is present as a form action.
  let actionUrl = null;
  const mAction = html.match(/action=\"([^\"]+)\"/);
  if (mAction) {
    const raw = mAction[1].replace(/&amp;/g, "&");
    if (raw.includes("uc?export=download")) {
      actionUrl = raw.startsWith("http") ? raw : `https://drive.google.com${raw}`;
    }
  }

  const cookie = cookieHeaderFromSetCookie(setCookie);
  const headers = cookie ? { cookie } : undefined;

  // Build second request URL.
  let url2 = actionUrl || base;
  try {
    const u = new URL(url2);
    if (confirm && !u.searchParams.get("confirm")) u.searchParams.set("confirm", confirm);
    url2 = u.href;
  } catch {
    if (confirm) url2 = `${base}&confirm=${confirm}`;
  }

  let second = await fetch(url2, { redirect: "follow", headers });
  let ct2 = (second.headers.get("Content-Type") || "").toLowerCase();

  // Still HTML? Try extracting a direct download link (drive.usercontent).
  if (ct2.includes("text/html")) {
    const html2 = await second.text();
    const mHref = html2.match(
      /href=\"(https:\/\/drive\.usercontent\.google\.com\/download[^\"]+)\"/
    );
    if (mHref) {
      const url3 = mHref[1].replace(/&amp;/g, "&");
      second = await fetch(url3, { redirect: "follow", headers });
      ct2 = (second.headers.get("Content-Type") || "").toLowerCase();
      if (!ct2.includes("text/html")) return second;
    }

    return new Response(
      "Drive returned an interstitial page that could not be bypassed.",
      { status: 502 }
    );
  }

  return second;
}
