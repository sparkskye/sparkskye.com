export async function onRequest(context) {
  const url = new URL(context.request.url);

  // ✅ paste your MODELS Apps Script webapp URL here
  const MODELS_SCRIPT = "https://script.google.com/macros/s/AKfycbxwo50cJWxjW95aoG1QeoxBRlUAIVrYPc3VHuaDUw2Vkst-2k05fltz8s__nIku7JL7lQ/exec";

  const upstream = new URL(MODELS_SCRIPT);
  // forward query params (game=..., list=1)
  for (const [k, v] of url.searchParams.entries()) upstream.searchParams.set(k, v);

  const res = await fetch(upstream.toString(), {
    headers: { "User-Agent": "sparkskye-pages-proxy" },
    cf: { cacheTtl: 60, cacheEverything: true },
  });

  const body = await res.text();

  return new Response(body, {
    status: res.status,
    headers: corsJsonHeaders_(),
  });
}

function corsJsonHeaders_() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=60",
  };
}
