// js/sheets.js
// Google Sheets から現場設定(工事情報・棟と部屋・撮影内容)を読み取る

import {
  SHEETS_API_KEY, SHEETS_ID,
  SHEETS_VALUES_ENDPOINT,
  SHEET_RANGE_PROJECT, SHEET_RANGE_BUILDING, SHEET_RANGE_TYPES,
} from "./config.js";

/* ============================================================ Sheets API 共通 */

async function readRange(rangeStr) {
  if (!SHEETS_ID) throw new Error("シート ID が未設定です(config.js の SHEETS_ID)");
  if (!SHEETS_API_KEY) throw new Error("Sheets API キーが未設定です");

  const url = `${SHEETS_VALUES_ENDPOINT}/${encodeURIComponent(SHEETS_ID)}/values/${encodeURIComponent(rangeStr)}?key=${encodeURIComponent(SHEETS_API_KEY)}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    let msg = `Sheets API エラー (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg += ": " + err.error.message;
    } catch (e) {}
    if (res.status === 403) msg += "\nヒント: シートを「リンクを知っている全員(閲覧者)」にしてください。";
    if (res.status === 404) msg += "\nヒント: スプレッドシート ID とシート名を確認してください。";
    throw new Error(msg);
  }

  const data = await res.json();
  return data.values || [];
}

/* ============================================================ 工事情報 */

/**
 * シート①「工事情報」を読み取る
 * 形式: A列ラベル, B列値
 *   工事名     | 県営北方住宅...
 *   工事番号   | 県住工第1号
 *   工事場所   | 本巣郡北方町
 *   会社名     | 河口電機株式会社
 *   親フォルダID | 1kI1o...
 *
 * @returns {object} { name, number, location, company, driveFolderId }
 */
export async function readProjectInfo() {
  const rows = await readRange(SHEET_RANGE_PROJECT);
  const map = {};
  for (const row of rows) {
    const key = (row[0] || "").toString().trim();
    const val = (row[1] || "").toString().trim();
    if (key) map[key] = val;
  }

  // 日本語ラベルと内部キーの対応
  const aliases = {
    name:           ["工事名"],
    number:         ["工事番号", "工事 番号"],
    location:       ["工事場所", "場所"],
    company:        ["会社名", "会社"],
    driveFolderId:  ["親フォルダID", "Driveフォルダ ID", "Driveフォルダ", "フォルダID", "親フォルダ ID"],
  };

  const result = {};
  for (const [key, candidates] of Object.entries(aliases)) {
    for (const c of candidates) {
      if (map[c]) { result[key] = map[c]; break; }
    }
    if (!result[key]) result[key] = "";
  }
  return result;
}

/* ============================================================ 棟と部屋 */

/**
 * シート②「棟と部屋」を読み取る
 * 形式: A列=棟、B列以降=部屋番号(横並び)
 *   A1棟 | 101 | 102 | 103 | 104 | 201 | ...
 *   A2棟 | 101 | 102 | ...
 *
 * @returns {object} { "A1棟": ["101","102",...], "A2棟": [...] }
 */
export async function readBuildings() {
  const rows = await readRange(SHEET_RANGE_BUILDING);
  const result = {};
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const building = (row[0] || "").toString().trim();
    if (!building) continue;
    const rooms = [];
    for (let i = 1; i < row.length; i++) {
      const r = (row[i] || "").toString().trim();
      if (r) rooms.push(r);
    }
    if (rooms.length > 0) result[building] = rooms;
  }
  return result;
}

/* ============================================================ 撮影内容 */

/**
 * シート③「撮影内容」を読み取る
 * 形式: A列に1つずつ
 *
 * @returns {string[]}
 */
export async function readShootingTypes() {
  const rows = await readRange(SHEET_RANGE_TYPES);
  const list = [];
  for (const row of rows) {
    const v = (row[0] || "").toString().trim();
    if (v) list.push(v);
  }
  return list;
}

/* ============================================================ 全部まとめて */

/**
 * 3つのシートを並列で読み取って、まとめて返す
 * @returns {Promise<{project, buildings, types}>}
 */
export async function readAllConfig() {
  const [project, buildings, types] = await Promise.all([
    readProjectInfo(),
    readBuildings(),
    readShootingTypes(),
  ]);
  return { project, buildings, types };
}
