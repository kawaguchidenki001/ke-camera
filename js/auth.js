// js/auth.js
// Google Identity Services の token client を使った OAuth 2.0 認証

import { OAUTH_SCOPES } from "./config.js";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;       // ミリ秒(epoch)
let userEmail = null;          // ID トークンを取らない設計なので、ユーザー識別は別途
let pendingResolve = null;
let pendingReject = null;

/**
 * GIS のスクリプトロード完了を待つ
 */
function waitForGsi(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Google Identity Services の読み込みに失敗しました"));
      } else {
        setTimeout(poll, 80);
      }
    })();
  });
}

/**
 * token client の初期化(クライアント ID 設定後に毎回呼び直す)
 */
export async function initAuth(clientId) {
  if (!clientId) throw new Error("OAuth クライアント ID が未設定です");
  await waitForGsi();

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: OAUTH_SCOPES,
    prompt: "",                  // 初回のみ consent。再認可は静かに。
    callback: (response) => {
      if (response && response.access_token) {
        accessToken = response.access_token;
        // expires_in は秒
        const lifeSec = parseInt(response.expires_in || "3600", 10);
        tokenExpiresAt = Date.now() + (lifeSec - 30) * 1000; // 30 秒余裕を見る
        if (pendingResolve) pendingResolve(accessToken);
      } else {
        if (pendingReject) pendingReject(new Error("認可が拒否されました"));
      }
      pendingResolve = pendingReject = null;
    },
    error_callback: (err) => {
      console.warn("OAuth error:", err);
      if (pendingReject) pendingReject(new Error(err?.message || "認証エラー"));
      pendingResolve = pendingReject = null;
    },
  });

  // ストレージから過去のトークンを試しに復元(セッション間で 1 時間程度生きる)
  try {
    const raw = sessionStorage.getItem("ke-camera:token");
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.token && obj.expiresAt > Date.now() + 60000) {
        accessToken = obj.token;
        tokenExpiresAt = obj.expiresAt;
      }
    }
  } catch (e) { /* ignore */ }

  return true;
}

/**
 * 現在のトークンを返す(期限切れなら null)
 */
export function getCachedToken() {
  if (accessToken && tokenExpiresAt > Date.now()) return accessToken;
  return null;
}

/**
 * 有効なトークンを返す。なければ取得する。
 * - 明示的ユーザー操作(クリック等)の中で呼ぶこと(ポップアップブロッカー対策)
 */
export function requestAccessToken({ forcePrompt = false } = {}) {
  if (!tokenClient) {
    return Promise.reject(new Error("認証クライアント未初期化"));
  }
  // キャッシュトークンが有効ならそれを返す
  if (!forcePrompt) {
    const cached = getCachedToken();
    if (cached) return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    pendingResolve = (tok) => {
      // セッションに保存
      try {
        sessionStorage.setItem("ke-camera:token", JSON.stringify({
          token: tok, expiresAt: tokenExpiresAt,
        }));
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

/**
 * サインアウト(トークン破棄 + revoke)
 */
export async function signOut() {
  const t = accessToken;
  accessToken = null;
  tokenExpiresAt = 0;
  try { sessionStorage.removeItem("ke-camera:token"); } catch (e) {}
  if (t && window.google?.accounts?.oauth2?.revoke) {
    return new Promise((resolve) => {
      try {
        google.accounts.oauth2.revoke(t, () => resolve());
      } catch (e) { resolve(); }
    });
  }
}

export function isSignedIn() {
  return !!getCachedToken();
}
