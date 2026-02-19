export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function debounce(fn, ms = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function setUrlParam(key, val) {
  const u = new URL(location.href);
  if (val == null || val === "") u.searchParams.delete(key);
  else u.searchParams.set(key, val);
  history.pushState({}, "", u);
}

export function getUrlParam(key, fallback = "") {
  const u = new URL(location.href);
  return u.searchParams.get(key) || fallback;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  }
}

export function titleCase(str) {
  return (str || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
