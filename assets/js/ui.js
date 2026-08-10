export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function debounce(fn, ms = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function setUrlParam(key, val, opts = {}) {
  const options = typeof opts === "boolean" ? { replace: opts } : (opts || {});
  const u = new URL(location.href);
  if (val == null || val === "") u.searchParams.delete(key);
  else u.searchParams.set(key, val);
  const method = options.replace ? "replaceState" : "pushState";
  history[method]({}, "", u);
}

export function updateUrlParams(updates = {}, opts = {}) {
  const options = typeof opts === "boolean" ? { replace: opts } : (opts || {});
  const u = new URL(location.href);
  for (const [key, val] of Object.entries(updates || {})) {
    if (val == null || val === "") u.searchParams.delete(key);
    else u.searchParams.set(key, val);
  }
  const method = options.replace ? "replaceState" : "pushState";
  history[method]({}, "", u);
}

export function getUrlParam(key, fallback = "") {
  const u = new URL(location.href);
  return u.searchParams.get(key) || fallback;
}

export function urlWithUpdatedParams(pathname = location.pathname, updates = {}) {
  const u = new URL(location.href);
  u.pathname = pathname;
  for (const [key, val] of Object.entries(updates || {})) {
    if (val == null || val === "") u.searchParams.delete(key);
    else u.searchParams.set(key, val);
  }
  return u;
}

export function removeUrlParamFromHref(href, key) {
  const u = new URL(href, window.location.origin);
  u.searchParams.delete(key);
  return u.toString();
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

const RESTRICTED_ASSET_ACKNOWLEDGEMENT = "I acknowledge that these assets are for viewing and educational purposes only, and I will not repurpose, extract, or plagiarize the assets in any way.";

export function confirmRestrictedAssetDownload(item) {
  const files = [
    ...Object.values(item?.files || {}),
    ...(Array.isArray(item?.formats) ? item.formats : []),
    ...(Array.isArray(item?.variations) ? item.variations : []),
  ];
  const restricted = files.some((file) =>
    String(file?.name || file?.downloadName || "").trimStart().startsWith("!")
  );
  return !restricted || window.confirm(RESTRICTED_ASSET_ACKNOWLEDGEMENT);
}

let scrollLockY = 0;

export function lockBodyScroll() {
  if (document.body.classList.contains("modal-open")) return;
  scrollLockY = window.scrollY || window.pageYOffset || 0;
  document.body.classList.add("modal-open");
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollLockY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

export function unlockBodyScroll() {
  if (!document.body.classList.contains("modal-open")) return;
  document.body.classList.remove("modal-open");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollLockY || 0);
}

// --- Mobile nav dropdown ----------------------------------------------------

export function initMobileNav() {
  const nav = document.querySelector(".topnav");
  if (!nav) return;

  // Inject burger + dropdown only once
  if (nav.querySelector(".topnav__burger")) return;

  const linksWrap = nav.querySelector(".topnav__links");
  if (!linksWrap) return;

  const burger = document.createElement("button");
  burger.type = "button";
  burger.className = "topnav__burger";
  burger.setAttribute("aria-label", "Menu");
  burger.innerHTML = '<span class="topnav__burger-icon" aria-hidden="true"><span></span><span></span><span></span></span>';

  const dropdown = document.createElement("div");
  dropdown.className = "topnav__dropdown";

  // Clone existing nav buttons into dropdown
  const btns = [...linksWrap.querySelectorAll("a, button")];
  for (const b of btns) {
    const a = document.createElement("a");
    a.className = "topnav__dropitem";
    const href = b.getAttribute?.("href");
    if (href) a.href = href;
    else {
      // For button-like nav items, emulate click
      a.href = "#";
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        b.click();
      });
    }
    const color = b.style?.getPropertyValue("--item-color") || b.getAttribute?.("data-color") || "";
    if (color) a.style.setProperty("--item-color", color);
    if (b.classList?.contains("is-active")) a.classList.add("is-active");
    a.textContent = (b.textContent || "").trim() || "Link";
    dropdown.appendChild(a);
  }

  burger.addEventListener("click", () => {
    dropdown.classList.toggle("is-open");
    burger.classList.toggle("is-open", dropdown.classList.contains("is-open"));
  });

  document.addEventListener("click", (ev) => {
    if (!dropdown.classList.contains("is-open")) return;
    if (dropdown.contains(ev.target) || burger.contains(ev.target)) return;
    dropdown.classList.remove("is-open");
    burger.classList.remove("is-open");
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 680) {
      dropdown.classList.remove("is-open");
      burger.classList.remove("is-open");
    }
  });

  nav.appendChild(burger);
  nav.appendChild(dropdown);
}

// --- Latest news (option 1) -------------------------------------------------

export async function initLatestNews() {
  const box = document.querySelector("[data-latest-news]");
  if (!box) return;

  try {
    const res = await fetch("/hive-resources/latest.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const text = String(data?.text || "").trim();
    if (!text) return;
    box.textContent = text;
  } catch {
    // ignore
  }
}
