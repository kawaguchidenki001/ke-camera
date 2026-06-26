// js/sheets.js
// Google Sheets から現場設定を読み取る

import {
  SHEETS_API_KEY, SHEETS_ID,
  SHEETS_VALUES_ENDPOINT,
  SHEET_RANGE_PROJECT, SHEET_RANGE_BUILDING,
  SHEET_RANGE_FIXTURES, SHEET_RANGE_STAGES,
} from "./config.js?v=1.6.2";

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

export async function readProjectInfo() {
  const rows = await readRange(SHEET_RANGE_PROJECT);
  const map = {};
  for (const row of rows) {
    const key = (row[0] || "").toString().trim();
    const val = (row[1] || "").toString().trim();
    if (key) map[key] = val;
  }
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

/* ============================================================ 照明器具 / 施工段階(縦並び) */

async function readSingleColumn(rangeStr) {
  const rows = await readRange(rangeStr);
  const list = [];
  for (const row of rows) {
    const v = (row[0] || "").toString().trim();
    if (v) list.push(v);
  }
  return list;
}

export function readFixtures() { return readSingleColumn(SHEET_RANGE_FIXTURES); }
export function readStages()   { return readSingleColumn(SHEET_RANGE_STAGES); }

/* ============================================================ 全部まとめて */

export async function readAllConfig() {
  const [project, buildings, fixtures, stages] = await Promise.all([
    readProjectInfo(),
    readBuildings(),
    readFixtures(),
    readStages(),
  ]);
  return { project, buildings, fixtures, stages };
}
