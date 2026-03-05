import { onRequest as fileHandler } from "./file.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  await trackDownload(context.env, url);

  const fileUrl = new URL(context.request.url);
  fileUrl.pathname = "/api/file";
  const proxiedRequest = new Request(fileUrl.toString(), context.request);
  return await fileHandler({ request: proxiedRequest });
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

  if (!kv || !id) return;

  const key = `download:${kind}:${id}`;
  const totalKey = `download:total:${kind}`;

  try {
    const current = Number(await kv.get(key)) || 0;
    const total = Number(await kv.get(totalKey)) || 0;
    await Promise.all([
      kv.put(key, String(current + 1)),
      kv.put(totalKey, String(total + 1)),
    ]);
  } catch (err) {
    console.log("download tracking failed", err?.message || String(err));
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
