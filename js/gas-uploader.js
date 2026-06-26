// js/gas-uploader.js
// GAS Web App と通信(すべて JSONP GET。応答を必ず読む)
// v1.6.4: 端末側で GAS URL / トークンを上書き保存できるようにした診断強化版

import { GAS_WEB_APP_URL as CONFIG_GAS_WEB_APP_URL, SHARED_TOKEN as CONFIG_SHARED_TOKEN, GAS_TIMEOUT_MS } from "./config.js?v=1.6.4";

let _seq = 0;
const CHUNK_SIZE = 7000;  // Base64 を分割するサイズ(URL 長の安全圏)

const LS_GAS_URL = "kitagata.gasWebAppUrl";
const LS_TOKEN   = "kitagata.sharedToken";

// キャッシュに古い config.js が残っていても送信先を失わないための保険
const FALLBACK_GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxNLOTttmi766ZZlWWe3hp4LUV7lw6zXTzxOFoMTSeqIz_hIslb4caasipD7w_MgA6M9Q/exec";
const FALLBACK_SHARED_TOKEN = "kitagata-photo-2026";

function getFallbackConfig() {
  try { return window.__KITAGATA_FALLBACK_CONFIG__ || {}; } catch (e) { return {}; }
}

function readLocalStorage(key) {
  try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
}

function writeLocalStorage(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) {}
}

export function getGasWebAppUrl() {
  return normalizeUrl(readLocalStorage(LS_GAS_URL) || CONFIG_GAS_WEB_APP_URL || getFallbackConfig().GAS_WEB_APP_URL || FALLBACK_GAS_WEB_APP_URL || "");
}

export function getConfiguredGasWebAppUrl() {
  return normalizeUrl(CONFIG_GAS_WEB_APP_URL || getFallbackConfig().GAS_WEB_APP_URL || FALLBACK_GAS_WEB_APP_URL || "");
}

export function setGasWebAppUrl(url) {
  writeLocalStorage(LS_GAS_URL, normalizeUrl(url));
}

export function clearGasWebAppUrlOverride() {
  writeLocalStorage(LS_GAS_URL, "");
}

export function hasGasWebAppUrlOverride() {
  return !!readLocalStorage(LS_GAS_URL);
}

export function getSharedToken() {
  return String(readLocalStorage(LS_TOKEN) || CONFIG_SHARED_TOKEN || getFallbackConfig().SHARED_TOKEN || FALLBACK_SHARED_TOKEN || "").trim();
}

export function setSharedToken(token) {
  writeLocalStorage(LS_TOKEN, String(token || "").trim());
}

export function clearSharedTokenOverride() {
  writeLocalStorage(LS_TOKEN, "");
}

export function getGasConfigStatus() {
  const url = getGasWebAppUrl();
  return {
    url,
    maskedUrl: maskGasUrl(url),
    hasUrlOverride: hasGasWebAppUrlOverride(),
    tokenSet: !!getSharedToken(),
    problem: validateGasUrl(url),
  };
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/[?#].*$/, "");
}

function validateGasUrl(url) {
  if (!url) return "GAS_WEB_APP_URL が未設定";
  if (url.includes("script.googleusercontent.com")) {
    return "GAS URL が script.googleusercontent.com になっています。これは実行後の転送先です。Apps Script の『ウェブアプリURL』に表示される https://script.google.com/macros/s/.../exec を設定してください。";
  }
  if (url.endsWith("/dev")) {
    return "GAS URL が /dev です。/dev は編集者用のテストURLです。デプロイ済みの /exec URL を設定してください。";
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
    return "GAS URL の形式が違います。https://script.google.com/macros/s/.../exec の形式を設定してください。";
  }
  return "";
}

function maskGasUrl(url) {
  const s = String(url || "");
  const m = s.match(/^(https:\/\/script\.google\.com\/macros\/s\/)([^/]+)(\/exec)$/);
  if (!m) return s || "未設定";
  const id = m[2];
  return `${m[1]}${id.slice(0, 10)}...${id.slice(-8)}${m[3]}`;
}

/* ============================================================ ping */

export function pingGas() {
  return callGasJsonp({ action: "ping" }, 15000);
}

/* ============================================================ upload(分割GET → Drive一時ファイル追記方式) */

export async function uploadViaGas({ blob, fileName, folderName, mimeType, meta, onLog }) {
  const log = (msg) => { if (typeof onLog === "function") onLog(msg); };

  const gasProblem = validateGasUrl(getGasWebAppUrl());
  if (gasProblem) throw new Error(gasProblem);
  if (!blob)            throw new Error("blob is required");
  if (!fileName)        throw new Error("fileName is required");
  if (!folderName)      throw new Error("folderName is required");

  const base64 = await blobToBase64NoPrefix(blob);
  const mime    = mimeType || blob.type || "image/jpeg";
  const metaStr = meta ? JSON.stringify(meta) : "";

  const uploadId = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const total = Math.ceil(base64.length / CHUNK_SIZE);
  if (total === 0) throw new Error("画像データが空です");

  log(`GAS URL: ${maskGasUrl(getGasWebAppUrl())}`);
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
    const gasUrl = getGasWebAppUrl();
    const gasProblem = validateGasUrl(gasUrl);
    if (gasProblem) { reject(new Error(gasProblem)); return; }

    const cbName = "_gasCb_" + (++_seq) + "_" + Date.now().toString(36);
    let timer = null;

    const data = Object.assign({ secret: getSharedToken(), callback: cbName }, params);
    const qs = Object.entries(data)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`)
      .join("&");
    const url = `${gasUrl}?${qs}`;

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[cbName] = (resp) => { cleanup(); resolve(resp); };
    script.onerror = () => {
      cleanup();
      reject(new Error("通信失敗: GASのWebアプリURLが無効、/execではない、またはデプロイのアクセス権限が『全員』になっていません。メニューの『GAS URL設定』で最新の /exec URL を設定してください。"));
    };
    timer = setTimeout(() => { cleanup(); reject(new Error("タイムアウト: GASが応答していません。GASを再デプロイし、/exec URLを確認してください。")); }, timeoutMs || 30000);

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
