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

export async function fetchMaps(gameKey) {
  const url = apiUrl(`/api/maps${gameKey ? `?game=${encodeURIComponent(gameKey)}` : ""}`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return await res.json();
}

// List available map gamemodes from the MAPS drive root (requires Apps Script support).
export async function fetchMapGames() {
  const url = apiUrl(`/api/maps?list=1`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return await res.json();
}

export function fileDownloadUrl(modelId, filename) {
  const name = filename ? `&name=${encodeURIComponent(filename)}` : "";
  return apiUrl(`/api/file?id=${encodeURIComponent(modelId)}${name}`);
}

// For image/video previews (no forced attachment name)
export function fileViewUrl(fileId) {
  return apiUrl(`/api/file?id=${encodeURIComponent(fileId)}`);
}
