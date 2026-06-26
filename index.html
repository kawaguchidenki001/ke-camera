// js/ui.js
// 画面遷移・トースト・モーダル・選択シート

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentScreen = "splash";

export function showScreen(name) {
  for (const s of $$(".screen")) {
    s.classList.toggle("active", s.dataset.screen === name);
  }
  currentScreen = name;

  const header = $("#appHeader");
  if (header) header.style.display = (name === "camera" || name === "preview") ? "none" : "";

  window.scrollTo({ top: 0, behavior: "instant" });
}

export function getCurrentScreen() { return currentScreen; }

/* ============================================================ Toast */

export function toast(message, kind = "info", durationMs = 2500) {
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

export const toastSuccess = (m, d) => toast(m, "success", d);
export const toastError   = (m, d) => toast(m, "error",   d ?? 3800);
export const toastInfo    = (m, d) => toast(m, "info",    d);

/* ============================================================ Loading modal */

export function showLoading(text = "処理中…") {
  const m = $("#loadingModal");
  const t = $("#loadingText");
  if (t) t.textContent = text;
  if (m) m.classList.add("open");
}
export function hideLoading() {
  $("#loadingModal")?.classList.remove("open");
}

/* ============================================================ Auth indicator */

export function setAuthIndicator(on) {
  // GAS 接続状態用に流用(true=緑、false=赤)
  const el = document.getElementById("authIndicator");
  if (!el) return;
  el.classList.toggle("on",  !!on);
  el.classList.toggle("off", !on);
}

/* ============================================================ Picker(タップ式選択シート) */

/**
 * オプションを下から出すシートで選択。
 * @param {object} opts
 *   - title: タイトル
 *   - options: 配列 [{value, label, sublabel?}]
 *   - allowInput: 自由入力欄を表示するか(true なら入力で確定)
 *   - inputPlaceholder
 *   - footerButton: {label, onClick} 追加のフッターボタン
 *   - selectedValue: 現在の選択(視覚的に強調)
 * @returns {Promise<string|null>} 選択値、キャンセル時は null
 */
export function pickFromList(opts) {
  return new Promise((resolve) => {
    const sheet = $("#picker");
    const titleEl = $("#pickerTitle");
    const listEl  = $("#pickerList");
    const inputWrap = $("#pickerInputWrap");
    const inputEl   = $("#pickerInput");
    const inputBtn  = $("#pickerInputConfirm");
    const footerWrap = $("#pickerFooter");

    titleEl.textContent = opts.title || "選択";
    listEl.innerHTML = "";

    for (const o of (opts.options || [])) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-item";
      if (o.value === opts.selectedValue) btn.classList.add("selected");
      btn.innerHTML = `
        <span class="pi-label">${escapeHtml(o.label)}</span>
        ${o.sublabel ? `<span class="pi-sub">${escapeHtml(o.sublabel)}</span>` : ""}
      `;
      btn.addEventListener("click", () => {
        close(o.value);
      });
      listEl.appendChild(btn);
    }

    if (opts.allowInput) {
      inputWrap.hidden = false;
      inputEl.value = "";
      inputEl.placeholder = opts.inputPlaceholder || "自由入力…";
      const onInputConfirm = () => {
        const v = inputEl.value.trim();
        if (v) close(v);
      };
      inputBtn.onclick = onInputConfirm;
      inputEl.onkeydown = (e) => { if (e.key === "Enter") onInputConfirm(); };
    } else {
      inputWrap.hidden = true;
      inputBtn.onclick = null;
      inputEl.onkeydown = null;
    }

    if (opts.footerButton) {
      footerWrap.hidden = false;
      footerWrap.innerHTML = "";
      const fb = document.createElement("button");
      fb.type = "button";
      fb.className = "btn btn-ghost";
      fb.textContent = opts.footerButton.label;
      fb.addEventListener("click", () => {
        opts.footerButton.onClick?.(close);
      });
      footerWrap.appendChild(fb);
    } else {
      footerWrap.hidden = true;
      footerWrap.innerHTML = "";
    }

    const backdrop = $("#pickerBackdrop");
    const closeBtn = $("#pickerClose");
    const close = (val) => {
      sheet.classList.remove("open");
      backdrop.removeEventListener("click", onCancel);
      closeBtn.removeEventListener("click", onCancel);
      setTimeout(() => resolve(val === undefined ? null : val), 180);
    };
    const onCancel = () => close(null);
    backdrop.addEventListener("click", onCancel);
    closeBtn.addEventListener("click", onCancel);

    sheet.classList.add("open");
  });
}

/* ============================================================ Util */

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const dom = { $, $$ };

/* ============================================================ confirm dialog */

export function confirmDialog(message) {
  return new Promise((resolve) => {
    resolve(window.confirm(message));
  });
}
