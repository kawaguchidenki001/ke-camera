// js/gas-uploader.js
// GAS Web App と通信(すべて JSONP GET、応答が読める方式)
//   ・ping:   疎通確認
//   ・upload: 写真を 8000 文字ずつ分割して送信 → GAS 側で結合

import { GAS_WEB_APP_URL, SHARED_TOKEN, GAS_TIMEOUT_MS } from "./config.js";

let _seq = 0;
const CHUNK_SIZE = 8000;  // Base64 を分割するサイズ(URL 長制限の安全圏)

/* ============================================================ ping */

export function pingGas() {
  return callGasJsonp({ action: "ping" }, 15000);
}

/* ============================================================ upload(分割GET送信) */

export async function uploadViaGas({ blob, fileName, folderName, mimeType, meta }) {
  if (!GAS_WEB_APP_URL) throw new Error("GAS_WEB_APP_URL が未設定");
  if (!blob)            throw new Error("blob is required");
  if (!fileName)        throw new Error("fileName is required");
  if (!folderName)      throw new Error("folderName is required");

  const base64 = await blobToBase64NoPrefix(blob);
  const mime   = mimeType || blob.type || "image/jpeg";
  const metaStr = meta ? JSON.stringify(meta) : "";

  // アップロードセッション ID(この写真を一意に識別)
  const uploadId = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // チャンクに分割
  const total = Math.ceil(base64.length / CHUNK_SIZE);
  if (total === 0) throw new Error("画像データが空です");

  // 各チャンクを順番に送信
  for (let i = 0; i < total; i++) {
    const chunk = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const isFirst = (i === 0);
    const isLast  = (i === total - 1);

    const params = {
      action: "upchunk",
      uid:    uploadId,
      idx:    String(i),
      total:  String(total),
      chunk:  chunk,
    };
    // 最初のチャンクにメタ情報を載せる
    if (isFirst) {
      params.folder = folderName;
      params.name   = fileName;
      params.mime   = mime;
      params.meta   = metaStr;
    }

    const resp = await callGasJsonp(params, GAS_TIMEOUT_MS);
    if (!resp || !resp.ok) {
      throw new Error(resp?.error || `チャンク送信失敗 (${i + 1}/${total})`);
    }

    // 最後のチャンクの応答に fileId が含まれる
    if (isLast) {
      return resp;
    }
  }

  return { ok: true };
}

/* ============================================================ JSONP GET */

function callGasJsonp(params, timeoutMs) {
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
    script.onerror = () => { cleanup(); reject(new Error("GAS 通信失敗(ネットワーク or URL 不正)")); };
    timer = setTimeout(() => { cleanup(); reject(new Error("GAS タイムアウト")); }, timeoutMs || 30000);

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
