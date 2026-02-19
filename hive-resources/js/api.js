export const API_BASE = (window.__HIVE_API_BASE || "").replace(/\/+$/, "");

export function apiUrl(path) {
  if (!API_BASE) return path;
  return API_BASE + path;
}

export async function fetchModels(gameKey) {
  const url = apiUrl(`/api/models${gameKey ? `?game=${encodeURIComponent(gameKey)}` : ""}`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return await res.json();
}

export function fileDownloadUrl(modelId, filename) {
  const name = filename ? `&name=${encodeURIComponent(filename)}` : "";
  return apiUrl(`/api/file?id=${encodeURIComponent(modelId)}${name}`);
}
