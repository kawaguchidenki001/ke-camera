// js/sheets.js
// Sheets API v4 から工事マスタを読み取る(APIキー方式 = 公開リンクシート)

import { SHEETS_VALUES_ENDPOINT, SHEET_COLS } from "./config.js";

/**
 * 工事マスタを読み込む
 * @param {object} cfg - { sheetId, sheetRange, apiKey }
 * @returns {Promise<Array<{koujiMei,koushu,shikousha,folderId,kubun,raw}>>}
 */
export async function loadProjects(cfg) {
  if (!cfg.sheetId) throw new Error("スプレッドシート ID が未設定");
  if (!cfg.apiKey)  throw new Error("Sheets API キーが未設定");
  if (!cfg.sheetRange) throw new Error("読み取り範囲が未設定");

  const url = `${SHEETS_VALUES_ENDPOINT}/${encodeURIComponent(cfg.sheetId)}/values/${encodeURIComponent(cfg.sheetRange)}?key=${encodeURIComponent(cfg.apiKey)}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    let msg = `Sheets API エラー (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg += ": " + err.error.message;
    } catch (e) { /* ignore */ }
    if (res.status === 403) {
      msg += "\nヒント: シートが「リンクを知っている全員(閲覧者)」公開になっているか、API キーの制限を確認してください。";
    }
    throw new Error(msg);
  }

  const data = await res.json();
  const rows = data.values || [];

  return rows
    .map((row) => normalizeRow(row))
    .filter((p) => p && p.koujiMei && p.koujiMei.trim());
}

function normalizeRow(row) {
  if (!Array.isArray(row)) return null;
  return {
    koujiMei:  (row[SHEET_COLS.KOUJI]     || "").toString().trim(),
    koushu:    (row[SHEET_COLS.KOUSHU]    || "").toString().trim(),
    shikousha: (row[SHEET_COLS.SHIKOUSHA] || "").toString().trim(),
    folderId:  (row[SHEET_COLS.FOLDER_ID] || "").toString().trim(),
    kubun:     (row[SHEET_COLS.KUBUN]     || "").toString().trim(),
    raw: row,
  };
}

/**
 * シンプルな検索フィルタ
 */
export function filterProjects(list, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) => {
    const hay = [p.koujiMei, p.koushu, p.shikousha, p.kubun].join("\n").toLowerCase();
    return hay.includes(q);
  });
}
