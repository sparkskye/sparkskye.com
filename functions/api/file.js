export async function onRequest(context) {
  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  const driveUrl = `https://drive.google.com/uc?export=download&id=${id}`;
  const res = await fetch(driveUrl);

  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400"
    }
  });
}
