// js/gas-uploader.js
// GAS Web App と通信(すべて JSONP GET。応答を必ず読む)
//   ・写真は分割して GET 送信、GAS 側で Drive 一時ファイルに追記して結合
//   ・各ステップでログを出せる(onLog コールバック)

import { GAS_WEB_APP_URL, SHARED_TOKEN, GAS_TIMEOUT_MS } from "./config.js";

let _seq = 0;
const CHUNK_SIZE = 7000;  // Base64 を分割するサイズ(URL 長の安全圏)

/* ============================================================ ping */

export function pingGas() {
  return callGasJsonp({ action: "ping" }, 15000);
}

/* ============================================================ upload(分割GET → Drive一時ファイル追記方式) */

export async function uploadViaGas({ blob, fileName, folderName, mimeType, meta, onLog }) {
  const log = (msg) => { if (typeof onLog === "function") onLog(msg); };

  if (!GAS_WEB_APP_URL) throw new Error("GAS_WEB_APP_URL が未設定");
  if (!blob)            throw new Error("blob is required");
  if (!fileName)        throw new Error("fileName is required");
  if (!folderName)      throw new Error("folderName is required");

  const base64 = await blobToBase64NoPrefix(blob);
  const mime    = mimeType || blob.type || "image/jpeg";
  const metaStr = meta ? JSON.stringify(meta) : "";

  const uploadId = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const total = Math.ceil(base64.length / CHUNK_SIZE);
  if (total === 0) throw new Error("画像データが空です");

  log(`送信開始: ${fileName} (${total}分割, ${Math.round(base64.length/1024)}KB)`);

  // ① 開始: 一時ファイルを作る
  const startResp = await callGasJsonp({
    action: "up_start",
    uid:    uploadId,
    folder: folderName,
    name:   fileName,
    mime:   mime,
    meta:   metaStr,
    total:  String(total),
  }, GAS_TIMEOUT_MS);
  log(`開始応答: ${JSON.stringify(startResp)}`);
  if (!startResp || !startResp.ok) {
    throw new Error("開始失敗: " + (startResp?.error || "不明"));
  }

  // ② 各チャンクを順番に追記
  for (let i = 0; i < total; i++) {
    const chunk = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const resp = await callGasJsonp({
      action: "up_chunk",
      uid:    uploadId,
      idx:    String(i),
      chunk:  chunk,
    }, GAS_TIMEOUT_MS);
    if (!resp || !resp.ok) {
      throw new Error(`チャンク ${i + 1}/${total} 失敗: ${resp?.error || "不明"}`);
    }
    log(`チャンク ${i + 1}/${total} OK`);
  }

  // ③ 完了: 結合して Drive に保存
  const finResp = await callGasJsonp({
    action: "up_finish",
    uid:    uploadId,
  }, GAS_TIMEOUT_MS);
  log(`完了応答: ${JSON.stringify(finResp)}`);
  if (!finResp || !finResp.ok) {
    throw new Error("結合失敗: " + (finResp?.error || "不明"));
  }

  return finResp;
}

/* ============================================================ JSONP GET */

function callGasJsonp(params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!GAS_WEB_APP_URL) { reject(new Error("GAS_WEB_APP_URL が未設定")); return; }

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
    script.onerror = () => { cleanup(); reject(new Error("通信失敗(ネットワーク or URL不正)")); };
    timer = setTimeout(() => { cleanup(); reject(new Error("タイムアウト")); }, timeoutMs || 30000);

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
