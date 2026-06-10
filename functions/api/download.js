import { onRequest as fileHandler } from "./file.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  const fileUrl = new URL(context.request.url);
  fileUrl.pathname = "/api/file";
  const proxiedRequest = new Request(fileUrl.toString(), context.request);
  const response = await fileHandler({ request: proxiedRequest });

  // Download counting should never block the file stream. On the free plan,
  // Workers KV write limits are easy to hit, so this runs in the background
  // and safely fails open if KV is unavailable or over quota.
  if (response.ok) {
    const tracking = trackDownload(context.env, url);
    if (typeof context.waitUntil === "function") context.waitUntil(tracking);
    else tracking.catch(() => {});
  }

  return response;
}

async function trackDownload(env, url) {
  const kv = env?.DOWNLOAD_COUNTS;
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind") || "asset";
  const name = url.searchParams.get("name") || "";
  const asset = url.searchParams.get("asset") || "";
  const game = url.searchParams.get("game") || "";
  const path = url.searchParams.get("path") || "";

  console.log(JSON.stringify({
    type: "download",
    id,
    kind,
    name,
    asset,
    game,
    path,
    ts: Date.now(),
  }));

  const trackingEnabled = String(env?.ENABLE_DOWNLOAD_COUNTS || "").toLowerCase() === "1";
  if (!trackingEnabled || !kv || !id) return;

  const key = `download:${kind}:${id}`;
  const totalKey = `download:total:${kind}`;

  try {
    const [currentRaw, totalRaw] = await Promise.all([kv.get(key), kv.get(totalKey)]);
    const current = Number(currentRaw) || 0;
    const total = Number(totalRaw) || 0;
    await Promise.all([
      kv.put(key, String(current + 1)),
      kv.put(totalKey, String(total + 1)),
    ]);
  } catch (err) {
    console.log("download tracking skipped", err?.message || String(err));
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
