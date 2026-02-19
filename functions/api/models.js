export async function onRequest(context) {
  const game = context.request.url
    ? new URL(context.request.url).searchParams.get("game") || ""
    : "";

  const upstream =
    "https://script.google.com/macros/s/AKfycbxwo50cJWxjW95aoG1QeoxBRlUAIVrYPc3VHuaDUw2Vkst-2k05fltz8s__nIku7JL7lQ/exec" +
    (game ? `?game=${encodeURIComponent(game)}` : "");

  const res = await fetch(upstream);
  const text = await res.text();

  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300"
    }
  });
}
