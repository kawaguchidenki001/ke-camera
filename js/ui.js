// js/ui.js
// 画面遷移・トースト・ローディングなど UI ユーティリティ

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentScreen = "home";

/** 画面切り替え */
export function showScreen(name) {
  const screens = $$(".screen");
  let found = false;
  for (const s of screens) {
    const match = s.dataset.screen === name;
    s.classList.toggle("active", match);
    if (match) found = true;
  }
  if (!found) {
    console.warn("Unknown screen:", name);
    return;
  }
  currentScreen = name;

  // ヘッダーをカメラ / プレビュー画面では隠す
  const header = $("#appHeader");
  if (header) header.style.display = (name === "camera" || name === "preview") ? "none" : "";

  // スクロール位置を先頭に
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function getCurrentScreen() { return currentScreen; }

/* ------------------------------------------------------------ トースト */

let toastTimer = null;
export function toast(message, kind = "info", durationMs = 3000) {
  const cont = $("#toastContainer");
  if (!cont) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  cont.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s ease, transform .25s ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(-4px)";
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

export function toastSuccess(m, d) { toast(m, "success", d); }
export function toastError(m, d)   { toast(m, "error", d ?? 4500); }
export function toastInfo(m, d)    { toast(m, "info", d); }

/* ------------------------------------------------------------ ローディング */

export function showLoading(text = "処理中…") {
  const m = $("#loadingModal");
  const t = $("#loadingText");
  if (t) t.textContent = text;
  if (m) m.classList.add("open");
}
export function hideLoading() {
  const m = $("#loadingModal");
  if (m) m.classList.remove("open");
}

/* ------------------------------------------------------------ ドロワー */

export function openDrawer() {
  const d = $("#navDrawer");
  if (d) {
    d.classList.add("open");
    d.setAttribute("aria-hidden", "false");
  }
}
export function closeDrawer() {
  const d = $("#navDrawer");
  if (d) {
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
  }
}

/* ------------------------------------------------------------ 認証インジケータ */

export function setAuthIndicator(on) {
  const el = document.getElementById("authIndicator");
  if (!el) return;
  el.classList.toggle("on", !!on);
  el.classList.toggle("off", !on);
}

/* ------------------------------------------------------------ ショートカット */

export const dom = { $, $$ };
