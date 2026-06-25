// js/drive.js
// Drive 操作 — フォルダ作成 + ファイルアップロード

import { DRIVE_UPLOAD_ENDPOINT, DRIVE_FILES_ENDPOINT } from "./config.js";

/**
 * 親フォルダ配下にサブフォルダを作成
 * @returns {Promise<string>} 作成されたフォルダID
 */
export async function createSubfolder({ name, parentId, accessToken }) {
  if (!accessToken) throw new Error("アクセストークンがありません");
  if (!name) throw new Error("フォルダ名がありません");
  if (!parentId) throw new Error("親フォルダ ID がありません");

  const url = DRIVE_FILES_ENDPOINT + "?supportsAllDrives=true&fields=id,name";
  const body = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [parentId],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `フォルダ作成失敗 (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg += ": " + err.error.message;
    } catch (e) {}
    if (res.status === 401) msg += "\n認証切れの可能性。再ログインしてください。";
    if (res.status === 403) msg += "\n親フォルダへの書き込み権限を確認してください。";
    if (res.status === 404) msg += "\n親フォルダが見つかりません。";
    throw new Error(msg);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Blob を Drive にアップロード(multipart)
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

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", blob);

  const res = await fetch(DRIVE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!res.ok) {
    let msg = `Drive 保存失敗 (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg += ": " + err.error.message;
    } catch (e) {}
    if (res.status === 401) msg += "\n認証切れ。再ログインしてください。";
    if (res.status === 403) msg += "\nフォルダの書き込み権限を確認してください。";
    if (res.status === 404) msg += "\n保存先フォルダが見つかりません。";
    throw new Error(msg);
  }

  return res.json();
}
