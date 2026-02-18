export async function onRequest(context) {
  const req = context.request;
  if (req.method === "OPTIONS") return preflight_();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError_(400, "Missing ?id=");

  // Drive "uc" endpoint (works when file is shared “Anyone with link”)
  const driveUrl = new URL("https://drive.google.com/uc");
  driveUrl.searchParams.set("export", "download");
  driveUrl.searchParams.set("id", id);

  const upstream = await fetch(driveUrl.toString(), {
    // Cloudflare cache helps a LOT for repeat loads
    cf: { cacheEverything: true, cacheTtl: 60 * 60 },
  });

  // If Drive returns HTML (permission error), surface it cleanly
  const ct = upstream.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    const txt = await upstream.text();
    return new Response(txt, { status: 403, headers: corsHeaders_({ "Content-Type": "text/html; charset=utf-8" }) });
  }

  const headers = new Headers(upstream.headers);

  // ✅ CORS fix
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Range");
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  // ✅ Better caching on your edge
  headers.set("Cache-Control", "public, max-age=3600");

  return new Response(upstream.body, { status: upstream.status, headers });
}

function preflight_() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders_(),
  });
}

function corsHeaders_(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    ...extra,
  };
}

function jsonError_(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders_({ "Content-Type": "application/json; charset=utf-8" }),
  });
}
