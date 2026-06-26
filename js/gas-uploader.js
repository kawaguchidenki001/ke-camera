// js/gas-uploader.js
// GAS Web App と通信
//   ・写真送信: text/plain + JSON (GenCan と同じ方式)
//   ・疎通確認: JSONP GET

import { GAS_WEB_APP_URL, SHARED_TOKEN, GAS_TIMEOUT_MS } from "./config.js";

let _seq = 0;

/* ============================================================ ping (JSONP GET) */

export function pingGas() {
  return callGasJsonp({ action: "ping" });
}

/* ============================================================ upload (text/plain POST, GenCan方式) */

export async function uploadViaGas({ blob, fileName, folderName, mimeType, meta }) {
  if (!GAS_WEB_APP_URL) throw new Error("GAS_WEB_APP_URL が未設定");
  if (!blob)            throw new Error("blob is required");
  if (!fileName)        throw new Error("fileName is required");
  if (!folderName)      throw new Error("folderName is required");

  const base64 = await blobToBase64NoPrefix(blob);
  const mime   = mimeType || blob.type || "image/jpeg";

  const body = JSON.stringify({
    secret: SHARED_TOKEN,
    action: "upload",
    folder: folderName,
    name:   fileName,
    mime,
    data:   base64,
    meta:   meta ? JSON.stringify(meta) : "",
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GAS_TIMEOUT_MS);

  try {
    await fetch(GAS_WEB_APP_URL, {
      method:  "POST",
      mode:    "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`GAS タイムアウト(${Math.round(GAS_TIMEOUT_MS / 1000)}秒)`);
    }
    throw new Error("GAS 通信失敗: " + (e.message || e));
  } finally {
    clearTimeout(timer);
  }

  // no-cors のためレスポンスは読めない → 送信完了で成功とみなす
  return { ok: true, mode: "no-cors" };
}

/* ============================================================ JSONP GET (ping用) */

function callGasJsonp(params) {
  return new Promise((resolve, reject) => {
    if (!GAS_WEB_APP_URL) {
      reject(new Error("GAS_WEB_APP_URL が未設定"));
      return;
    }

    const cbName = "_gasCb_" + (++_seq) + "_" + Date.now().toString(36);
    let timer = null;

    const data = Object.assign({ secret: SHARED_TOKEN, callback: cbName }, params);
    const qs = Object.entries(data)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`)
      .join("&");
    const url = `${GAS_WEB_APP_URL}?${qs}`;

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[cbName] = (resp) => { cleanup(); resolve(resp); };
    script.onerror = () => { cleanup(); reject(new Error("GAS 通信失敗")); };
    timer = setTimeout(() => { cleanup(); reject(new Error("GAS タイムアウト")); }, 15000);

    document.body.appendChild(script);
  });
}

/* ============================================================ Base64 変換 */

function blobToBase64NoPrefix(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result || "";
      const idx = result.indexOf(",");
      if (idx < 0) { reject(new Error("Base64 変換失敗")); return; }
      resolve(result.slice(idx + 1));
    };
    r.onerror = () => reject(r.error || new Error("読み込み失敗"));
    r.readAsDataURL(blob);
  });
}
