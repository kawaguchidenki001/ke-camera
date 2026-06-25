// js/gas-uploader.js
// GAS Web App と通信
//   ・写真送信: no-cors POST (GenCan と同じ方式、レスポンスは読まない)
//   ・確認 / 疎通: JSONP GET (レスポンスを読める)

import { GAS_WEB_APP_URL, SHARED_TOKEN, GAS_TIMEOUT_MS } from "./config.js";

let _seq = 0;

/* ============================================================ ping (JSONP GET) */

export function pingGas() {
  return callGasJsonp({ action: "ping" });
}

/* ============================================================ upload (no-cors POST) */

/**
 * 写真を GAS 経由でアップロード
 * @param {object} params
 *   - blob: Blob
 *   - fileName: string
 *   - folderName: string
 *   - mimeType: string
 *   - meta: object
 * @returns {Promise<{ok:boolean}>}  no-cors のためレスポンスは読めない、送信完了で resolve
 */
export async function uploadViaGas({ blob, fileName, folderName, mimeType, meta }) {
  if (!GAS_WEB_APP_URL) throw new Error("GAS_WEB_APP_URL が未設定");
  if (!blob)            throw new Error("blob is required");
  if (!fileName)        throw new Error("fileName is required");
  if (!folderName)      throw new Error("folderName is required");

  const base64 = await blobToBase64NoPrefix(blob);
  const mime   = mimeType || blob.type || "image/jpeg";
  const metaStr = meta ? JSON.stringify(meta) : "";

  // FormData(URL エンコードされた form-data、CORS preflight 不要)
  const form = new FormData();
  form.append("token",  SHARED_TOKEN);
  form.append("action", "upload");
  form.append("folder", folderName);
  form.append("name",   fileName);
  form.append("mime",   mime);
  form.append("data",   base64);
  form.append("meta",   metaStr);

  // タイムアウト付き fetch
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GAS_TIMEOUT_MS);
  try {
    await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      mode: "no-cors",
      body: form,
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

  // no-cors のためレスポンスを読めない → 成功と仮定して返す
  return { ok: true, mode: "no-cors" };
}

/* ============================================================ list 確認 (JSONP GET) */

/**
 * 特定フォルダの最近のファイルを確認(任意)
 * 送信後に「本当に保存されたか」をチェックしたい場合に使う
 */
export function listFolder(folderName) {
  return callGasJsonp({ action: "list", folder: folderName });
}

/* ============================================================ JSONP 呼び出し(小さいデータ向け) */

function callGasJsonp(params) {
  return new Promise((resolve, reject) => {
    if (!GAS_WEB_APP_URL) {
      reject(new Error("GAS_WEB_APP_URL が未設定"));
      return;
    }

    const cbName = "_gasCb_" + (++_seq) + "_" + Date.now().toString(36);
    let timer = null;

    const data = Object.assign({
      token: SHARED_TOKEN,
      callback: cbName,
    }, params);

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

    window[cbName] = (resp) => {
      cleanup();
      resolve(resp);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("GAS への通信失敗(ネットワーク or URL 不正)"));
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("GAS タイムアウト"));
    }, 15000);  // ping/list は 15 秒

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
