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

export function absoluteUrl(pathOrUrl) {
  try {
    return new URL(pathOrUrl, window.location.origin).toString();
  } catch {
    return String(pathOrUrl);
  }
}

// Download URL (forces attachment naming). Use ext to ensure correct filename on Safari/iOS.
export function fileDownloadUrl(fileId, filename, ext = "") {
  let outName = filename || "";
  const cleanExt = String(ext || "").replace(/^\./, "");
  if (outName && cleanExt && !outName.toLowerCase().endsWith(`.${cleanExt.toLowerCase()}`)) {
    outName = `${outName}.${cleanExt}`;
  }
  const name = outName ? `&name=${encodeURIComponent(outName)}` : "";
  const extQ = cleanExt ? `&ext=${encodeURIComponent(cleanExt)}` : "";
  return apiUrl(`/api/file?id=${encodeURIComponent(fileId)}${name}${extQ}`);
}

// For image/video previews (no forced attachment name)
export function fileViewUrl(fileId) {
  return apiUrl(`/api/file?id=${encodeURIComponent(fileId)}`);
}
