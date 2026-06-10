export async function onRequest(context) {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind") || "asset";
  const kv = context.env?.DOWNLOAD_COUNTS;

  if (!id) return json({ error: "Missing id" }, 400);
  if (!kv) return json({ enabled: false, count: null, kind, id });

  try {
    const key = `download:${kind}:${id}`;
    const count = Number(await kv.get(key)) || 0;
    return json({ enabled: true, count, kind, id });
  } catch {
    return json({ enabled: false, count: null, kind, id });
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
