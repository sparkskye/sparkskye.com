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
  burger.textContent = "≡";

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
    a.textContent = (b.textContent || "").trim() || "Link";
    dropdown.appendChild(a);
  }

  burger.addEventListener("click", () => {
    dropdown.classList.toggle("is-open");
  });

  document.addEventListener("click", (ev) => {
    if (!dropdown.classList.contains("is-open")) return;
    if (dropdown.contains(ev.target) || burger.contains(ev.target)) return;
    dropdown.classList.remove("is-open");
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 680) dropdown.classList.remove("is-open");
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
