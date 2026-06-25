// js/auth.js
// Google Identity Services の token client(drive.file スコープ)

import { OAUTH_CLIENT_ID, OAUTH_SCOPES } from "./config.js";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let pendingResolve = null;
let pendingReject = null;

function waitForGsi(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Google 認証サービスの読み込みに失敗しました。通信状態をご確認ください。"));
      } else {
        setTimeout(poll, 80);
      }
    })();
  });
}

export async function initAuth() {
  await waitForGsi();

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPES,
    prompt: "",
    callback: (response) => {
      if (response && response.access_token) {
        accessToken = response.access_token;
        const lifeSec = parseInt(response.expires_in || "3600", 10);
        tokenExpiresAt = Date.now() + (lifeSec - 30) * 1000;
        if (pendingResolve) pendingResolve(accessToken);
      } else {
        if (pendingReject) pendingReject(new Error("認証が拒否されました"));
      }
      pendingResolve = pendingReject = null;
    },
    error_callback: (err) => {
      console.warn("OAuth error:", err);
      if (pendingReject) pendingReject(new Error(err?.message || "認証エラー"));
      pendingResolve = pendingReject = null;
    },
  });

  // セッション中のトークン復元(同一タブ内)
  try {
    const raw = sessionStorage.getItem("kc:token");
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj?.token && obj.expiresAt > Date.now() + 60000) {
        accessToken = obj.token;
        tokenExpiresAt = obj.expiresAt;
      }
    }
  } catch (e) { /* ignore */ }

  return true;
}

export function getCachedToken() {
  if (accessToken && tokenExpiresAt > Date.now()) return accessToken;
  return null;
}

export function requestAccessToken({ forcePrompt = false } = {}) {
  if (!tokenClient) return Promise.reject(new Error("認証クライアント未初期化"));
  if (!forcePrompt) {
    const cached = getCachedToken();
    if (cached) return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    pendingResolve = (tok) => {
      try {
        sessionStorage.setItem("kc:token", JSON.stringify({ token: tok, expiresAt: tokenExpiresAt }));
      } catch (e) { /* ignore */ }
      resolve(tok);
    };
    pendingReject = reject;
    try {
      tokenClient.requestAccessToken({ prompt: forcePrompt ? "consent" : "" });
    } catch (e) {
      pendingResolve = pendingReject = null;
      reject(e);
    }
  });
}

export async function signOut() {
  const t = accessToken;
  accessToken = null;
  tokenExpiresAt = 0;
  try { sessionStorage.removeItem("kc:token"); } catch (e) {}
  if (t && window.google?.accounts?.oauth2?.revoke) {
    return new Promise((resolve) => {
      try { google.accounts.oauth2.revoke(t, () => resolve()); }
      catch (e) { resolve(); }
    });
  }
}

export function isSignedIn() {
  return !!getCachedToken();
}
