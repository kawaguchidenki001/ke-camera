// js/drive.js
// Google Drive にファイル(画像)をアップロードする

import { DRIVE_UPLOAD_ENDPOINT, DRIVE_FILES_ENDPOINT } from "./config.js";

/**
 * Blob を Drive にアップロード(multipart)
 * @param {Blob} blob - アップロードするファイル
 * @param {object} opts - { name, mimeType, parents, accessToken, description, properties }
 * @returns {Promise<object>} Drive API のレスポンス JSON
 */
export async function uploadBlob({ blob, name, mimeType, parents, accessToken, description, properties }) {
  if (!accessToken) throw new Error("アクセストークンがありません");
  if (!blob) throw new Error("ファイルがありません");
  if (!name) throw new Error("ファイル名がありません");

  const metadata = {
    name,
    mimeType: mimeType || blob.type || "application/octet-stream",
  };
  if (parents && parents.length) metadata.parents = parents;
  if (description) metadata.description = description;
  if (properties && Object.keys(properties).length) metadata.properties = properties;

  // multipart は FormData で組むのが最も簡単・確実
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", blob);

  const res = await fetch(DRIVE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!res.ok) {
    let msg = `Drive アップロード失敗 (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg += ": " + err.error.message;
    } catch (e) { /* ignore */ }
    if (res.status === 401) msg += "\nトークン切れの可能性 — 再ログインしてください。";
    if (res.status === 403) msg += "\nフォルダへの書き込み権限がない可能性 — フォルダ ID と共有設定を確認してください。";
    if (res.status === 404) msg += "\n保存先フォルダが見つかりません — フォルダ ID を確認してください。";
    throw new Error(msg);
  }

  return res.json();
}

/**
 * Drive のフォルダ存在 + 書き込み可否を簡易チェック(ファイル一覧の取得を試みる)
 */
export async function checkFolderAccess({ folderId, accessToken }) {
  if (!folderId) return { ok: false, reason: "フォルダ ID が空" };
  if (!accessToken) return { ok: false, reason: "アクセストークンがありません" };
  const url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(folderId)}?fields=id,name,mimeType,capabilities&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, reason: `(${res.status}) アクセス不可` };
  }
  const data = await res.json();
  if (data.mimeType !== "application/vnd.google-apps.folder") {
    return { ok: false, reason: "ID がフォルダではありません" };
  }
  if (data.capabilities && data.capabilities.canAddChildren === false) {
    return { ok: false, reason: "書き込み権限がありません" };
  }
  return { ok: true, name: data.name };
}
