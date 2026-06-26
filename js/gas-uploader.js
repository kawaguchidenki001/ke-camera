// js/gas-uploader.js
// GAS Web App と通信
// v1.6.7: 画像は no-cors POST + JSONP状態確認。未対応時は iframe form POST にフォールバック。

import { GAS_WEB_APP_URL as CONFIG_GAS_WEB_APP_URL, SHARED_TOKEN as CONFIG_SHARED_TOKEN, GAS_TIMEOUT_MS } from "./config.js?v=1.6.7";

let _seq = 0;
const CHUNK_SIZE = 1200;  // JSONPフォールバック用。URL長制限を避けるため小さめ。
const FORM_POST_TIMEOUT_MS = Math.max(90000, (GAS_TIMEOUT_MS || 60000) + 30000);
const STATUS_POLL_FIRST_DELAY_MS = 650;
const STATUS_POLL_INTERVAL_MS = 850;

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

/* ============================================================ upload */

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

  log(`GAS URL: ${maskGasUrl(getGasWebAppUrl())}`);
  log(`送信開始: ${fileName} (${Math.round(base64.length/1024)}KB)`);

  // v1.6.7: まず fetch(no-cors) POST で送る。スマホの hidden iframe 固まり対策。
  // 応答本文は読めないため、requestId を使って GAS 側の保存結果を JSONP で確認する。
  let resp;
  if (typeof fetch === "function" && typeof URLSearchParams === "function") {
    try {
      resp = await uploadViaGasFetchPost({
        base64, fileName, folderName, mime, metaStr,
        timeoutMs: FORM_POST_TIMEOUT_MS,
        onLog: log,
      });
    } catch (e) {
      // fetch 自体が即時失敗する古い環境のみ iframe POST へ切替。長時間待った後の再送は重複防止のため行わない。
      if (!e || e.maybeSent) throw e;
      log(`高速POST不可のため iframe POST に切替: ${e.message || e}`);
      resp = await uploadViaGasFormPost({ base64, fileName, folderName, mime, metaStr, timeoutMs: FORM_POST_TIMEOUT_MS, onLog: log });
    }
  } else {
    resp = await uploadViaGasFormPost({ base64, fileName, folderName, mime, metaStr, timeoutMs: FORM_POST_TIMEOUT_MS, onLog: log });
  }
  log(`POST送信応答: ${JSON.stringify(resp)}`);
  if (!resp || !resp.ok) throw new Error(resp?.error || "POST送信失敗");
  return resp;
}


/* ============================================================ fetch no-cors POST */

function uploadViaGasFetchPost({ base64, fileName, folderName, mime, metaStr, timeoutMs, onLog }) {
  const log = (msg) => { if (typeof onLog === "function") onLog(msg); };
  const gasUrl = getGasWebAppUrl();
  const gasProblem = validateGasUrl(gasUrl);
  if (gasProblem) return Promise.reject(new Error(gasProblem));

  const requestId = "fp_" + (++_seq) + "_" + Date.now().toString(36);
  const body = new URLSearchParams();
  body.set("action", "upload_form");
  body.set("secret", getSharedToken());
  body.set("requestId", requestId);
  body.set("folder", folderName);
  body.set("name", fileName);
  body.set("mime", mime);
  body.set("meta", metaStr || "");
  body.set("data", base64);

  log(`高速POST送信: ${fileName} requestId=${requestId}`);

  const controller = (typeof AbortController === "function") ? new AbortController() : null;
  let sendStartedAt = Date.now();
  let sendFailedQuickly = false;

  const sendPromise = fetch(gasUrl, {
    method: "POST",
    mode: "no-cors",
    cache: "no-store",
    credentials: "omit",
    redirect: "follow",
    body,
    signal: controller ? controller.signal : undefined,
  }).catch((e) => {
    // 送信直後の失敗なら未送信の可能性が高い。数秒後の失敗はGAS側で実行済みの可能性がある。
    sendFailedQuickly = (Date.now() - sendStartedAt) < 3000;
    if (sendFailedQuickly) {
      const err = new Error("高速POST送信を開始できませんでした: " + (e.message || e));
      err.maybeSent = false;
      throw err;
    }
    log(`高速POST送信警告: ${e.message || e}`);
  });

  const statusPromise = pollUploadStatus(requestId, timeoutMs, log);

  return Promise.race([
    sendPromise.then(() => statusPromise),
    statusPromise,
  ]).finally(() => {
    if (controller) {
      try { controller.abort(); } catch (e) {}
    }
    // URLSearchParams に保持した大きな文字列を早めに解放するための保険
    try { body.set("data", ""); } catch (e) {}
  }).catch((e) => {
    if (sendFailedQuickly) e.maybeSent = false;
    else e.maybeSent = true;
    throw e;
  });
}

function pollUploadStatus(requestId, timeoutMs, log) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    let timer = null;
    let polls = 0;

    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    async function tick() {
      if (settled) return;
      polls++;
      try {
        const status = await callGasJsonp({ action: "upload_status", requestId }, 10000);
        if (settled) return;
        if (status && status.ok && status.done) {
          const resp = status.response || {};
          if (resp && resp.ok) done(resolve, resp);
          else done(reject, new Error(resp.error || "GAS POST 保存結果がエラーでした"));
          return;
        }
        if (polls === 1 || polls % 6 === 0) log(`POST保存確認中: ${requestId}`);
      } catch (e) {
        if (polls === 1 || polls % 6 === 0) log(`POST保存確認待ち: ${e.message || e}`);
      }

      if ((Date.now() - started) > (timeoutMs || 90000)) {
        done(reject, new Error("POST送信結果の確認がタイムアウトしました。Driveに写真がある場合は、未送信一覧を再読み込みしてください。"));
        return;
      }
      timer = setTimeout(tick, polls < 3 ? STATUS_POLL_FIRST_DELAY_MS : STATUS_POLL_INTERVAL_MS);
    }

    timer = setTimeout(tick, STATUS_POLL_FIRST_DELAY_MS);
  });
}

/* ============================================================ iframe form POST */

function uploadViaGasFormPost({ base64, fileName, folderName, mime, metaStr, timeoutMs, onLog }) {
  return new Promise((resolve, reject) => {
    const log = (msg) => { if (typeof onLog === "function") onLog(msg); };
    const gasUrl = getGasWebAppUrl();
    const gasProblem = validateGasUrl(gasUrl);
    if (gasProblem) { reject(new Error(gasProblem)); return; }

    const requestId = "fp_" + (++_seq) + "_" + Date.now().toString(36);
    const iframeName = "gas_upload_iframe_" + requestId;
    let timer = null;
    let pollTimer = null;
    let settled = false;

    const iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");

    const form = document.createElement("form");
    form.method = "POST";
    form.action = gasUrl;
    form.target = iframeName;
    form.enctype = "application/x-www-form-urlencoded";
    form.acceptCharset = "UTF-8";
    form.style.display = "none";

    function add(name, value) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value == null ? "" : String(value);
      form.appendChild(input);
    }

    add("action", "upload_form");
    add("secret", getSharedToken());
    add("requestId", requestId);
    add("folder", folderName);
    add("name", fileName);
    add("mime", mime);
    add("meta", metaStr);
    add("data", base64);

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (pollTimer) clearTimeout(pollTimer);
      window.removeEventListener("message", onMessage);
      try { Array.from(form.elements || []).forEach(el => { el.value = ""; }); } catch (e) {}
      try { iframe.src = "about:blank"; } catch (e) {}
      if (form.parentNode) form.parentNode.removeChild(form);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    function finishOk(resp) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(resp);
    }

    function finishErr(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    function onMessage(event) {
      const data = event.data || {};
      if (!data || data.kitagataGasResponse !== true) return;
      if (data.requestId !== requestId) return;
      const resp = data.response || {};
      if (resp && resp.ok) finishOk(resp);
      else finishErr(new Error(resp.error || "GAS POST 応答がエラーでした"));
    }

    async function pollStatus() {
      if (settled) return;
      try {
        const status = await callGasJsonp({ action: "upload_status", requestId }, 15000);
        if (settled) return;
        if (status && status.ok && status.done) {
          const resp = status.response || {};
          if (resp && resp.ok) finishOk(resp);
          else finishErr(new Error(resp.error || "GAS POST 保存結果がエラーでした"));
          return;
        }
        if (status && status.ok && status.done === false) {
          log(`POST保存確認中: ${requestId}`);
        }
      } catch (e) {
        // POST中は一時的に status が取れないことがあるため、タイムアウトまでは再試行する。
        log(`POST保存確認待ち: ${e.message || e}`);
      }
      if (!settled) pollTimer = setTimeout(pollStatus, STATUS_POLL_INTERVAL_MS);
    }

    window.addEventListener("message", onMessage);
    timer = setTimeout(() => {
      finishErr(new Error("POST送信結果の確認がタイムアウトしました。Driveに写真が作成されている場合は、GAS側Code.gsをv3.3.0以降に貼り替えて、Webアプリを新バージョンで再デプロイしてください。"));
    }, timeoutMs || 120000);

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    try {
      form.submit();
      pollTimer = setTimeout(pollStatus, STATUS_POLL_FIRST_DELAY_MS);
    } catch (e) {
      finishErr(e);
    }
  });
}

/* ============================================================ JSONP chunk fallback */

async function uploadViaGasJsonpChunks({ base64, fileName, folderName, mime, metaStr, onLog }) {
  const log = (msg) => { if (typeof onLog === "function") onLog(msg); };
  const uploadId = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const total = Math.ceil(base64.length / CHUNK_SIZE);
  if (total === 0) throw new Error("画像データが空です");

  log(`分割GET送信: ${fileName} (${total}分割, ${Math.round(base64.length/1024)}KB)`);

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
    if (i === 0 || i === total - 1 || (i + 1) % 20 === 0) log(`チャンク ${i + 1}/${total} OK`);
  }

  const finResp = await callGasJsonp({ action: "up_finish", uid: uploadId }, GAS_TIMEOUT_MS);
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
      reject(new Error("通信失敗: GASへのGET通信が失敗しました。GAS URL、アクセス権限、またはURL長制限が原因の可能性があります。"));
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
