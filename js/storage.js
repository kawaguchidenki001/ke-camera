// js/storage.js
// localStorage を介した設定値の永続化

import { DEFAULTS, SEQ_KEY_PREFIX } from "./config.js";

const SETTINGS_KEY = "ke-camera:settings";
const LAST_BOARD_KEY = "ke-camera:lastBoard";
const LAST_PROJECT_KEY = "ke-camera:lastProject";

/** 設定を取得(デフォルトとマージ) */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULTS, ...parsed };
  } catch (e) {
    console.warn("loadSettings failed, returning defaults:", e);
    return { ...DEFAULTS };
  }
}

/** 設定を保存(部分更新可) */
export function saveSettings(patch) {
  const current = loadSettings();
  const next = { ...current, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/** 設定を初期化 */
export function resetSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  return { ...DEFAULTS };
}

/** 設定の書き出し用 JSON 文字列 */
export function exportSettings() {
  const s = loadSettings();
  // OAuth Client ID と API キーは出力するが、利用者が判断して扱うべき情報
  // (チームで共有する場合は必要、個人バックアップでも必要)
  return JSON.stringify({
    app: "KE-Camera",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: s,
  }, null, 2);
}

/** 設定の読み込み(JSON テキスト) */
export function importSettings(jsonText) {
  const obj = JSON.parse(jsonText);
  if (!obj || obj.app !== "KE-Camera" || !obj.settings) {
    throw new Error("KE-Camera の設定ファイルではありません");
  }
  const merged = { ...DEFAULTS, ...obj.settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

/* ------------------------------------------------------------ 黒板内容(下書き) */

/** 直前に入力した黒板内容を保存(撮り直し時の復元用) */
export function saveLastBoard(board) {
  try {
    localStorage.setItem(LAST_BOARD_KEY, JSON.stringify(board));
  } catch (e) { /* ignore */ }
}

export function loadLastBoard() {
  try {
    const raw = localStorage.getItem(LAST_BOARD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* ------------------------------------------------------------ 直近の工事 */

export function saveLastProject(project) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify(project));
  } catch (e) { /* ignore */ }
}

export function loadLastProject() {
  try {
    const raw = localStorage.getItem(LAST_PROJECT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* ------------------------------------------------------------ 通し番号(連番) */

/**
 * 工事 + 日付 ごとに通し番号を採番。同じ現場の撮影連続性を保ちつつ、
 * 日付が変わったらリセットする運用に向く。
 */
export function nextSeq(koujiMei, dateStr) {
  const key = SEQ_KEY_PREFIX + (dateStr || "x") + ":" + (koujiMei || "x");
  let n = parseInt(localStorage.getItem(key) || "0", 10);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n += 1;
  localStorage.setItem(key, String(n));
  return n;
}

/** 連番のロールバック(アップロード失敗時など) */
export function rollbackSeq(koujiMei, dateStr) {
  const key = SEQ_KEY_PREFIX + (dateStr || "x") + ":" + (koujiMei || "x");
  let n = parseInt(localStorage.getItem(key) || "0", 10);
  if (Number.isFinite(n) && n > 0) {
    localStorage.setItem(key, String(n - 1));
  }
}

/** 現在の連番(進めずに読むだけ) */
export function peekSeq(koujiMei, dateStr) {
  const key = SEQ_KEY_PREFIX + (dateStr || "x") + ":" + (koujiMei || "x");
  return parseInt(localStorage.getItem(key) || "0", 10) || 0;
}
