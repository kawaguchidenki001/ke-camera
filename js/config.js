// js/config.js
// 北方カメラ - 設定値(v1.7.0: 画質向上版)

export const APP_VERSION = "1.7.0";
export const APP_NAME = "北方カメラ";

// ============================================================
// GAS Web App 連携
// ============================================================
// ⚠️ Kさんが GAS をデプロイ後、URL をここに記入してください
// https://script.google.com/macros/s/AKfycb.../exec の形式
export const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxNLOTttmi766ZZlWWe3hp4LUV7lw6zXTzxOFoMTSeqIz_hIslb4caasipD7w_MgA6M9Q/exec";

// GAS 側の SHARED_TOKEN と一致させる
// ⚠️ デフォルトのままにせず、推測されにくい文字列に変更してください
export const SHARED_TOKEN = "kitagata-photo-2026";

// JSONP のタイムアウト(ms)
export const GAS_TIMEOUT_MS = 60000;

// ============================================================
// Sheets 連携(現状維持)
// ============================================================
export const SHEETS_API_KEY = "AIzaSyA1EPCXjMfkhso-kiu7SHRDmdts027GpQs";
// ⚠️ 「北方カメラ 設定」スプレッドシートの ID を入れてください
// GitHub の config.js に入力済みの場合はその値をそのまま使用
export const SHEETS_ID = "1uPhgQOJqhFF4KDsB-VUPdU-83P552rCT8zyCCxHfZD0";

export const SHEET_TAB_PROJECT  = "工事情報";
export const SHEET_TAB_BUILDING = "棟と部屋";
export const SHEET_TAB_FIXTURES = "照明器具";
export const SHEET_TAB_STAGES   = "施工段階";

export const SHEET_RANGE_PROJECT  = `${SHEET_TAB_PROJECT}!A2:B`;
export const SHEET_RANGE_BUILDING = `${SHEET_TAB_BUILDING}!A2:Z`;
export const SHEET_RANGE_FIXTURES = `${SHEET_TAB_FIXTURES}!A2:A`;
export const SHEET_RANGE_STAGES   = `${SHEET_TAB_STAGES}!A2:A`;

export const SHEETS_VALUES_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";

// ============================================================
// フォールバック値
// ============================================================
export const FALLBACK_PROJECT = Object.freeze({
  name:    "県営北方住宅室内照明LED化改修工事",
  number:  "県住工第1号",
  location:"本巣郡北方町",
  company: "河口電機株式会社",
});

export const FALLBACK_BUILDINGS = Object.freeze({
  "A1棟": ["101","102","103","104","201","202","203","204","301","302","303","304","401","402","403","404","501","502","503","504"],
  "A2棟": ["101","102","103","104","201","202","203","204","301","302","303","304","401","402","403","404","501","502","503","504","601","602","603","604","701","702","703","704","801","802","803","804","901","902","903","904","1001","1002","1003","1004"],
  "A4棟": ["101","102","103","104","201","202","203","204","301","302","303","304","401","402","403","404","501","502","503","504","601","602","603","604","701","702","703","704","801","802","803","804","901","902","903","904","1001","1002","1003","1004"],
  "S1棟": ["101","102","103","104","201","202","203","204","301","302","303","304","401","402","403","404","501","502","503","504"],
  "S2棟": ["101","102","103","104","201","202","203","204","301","302","303","304","401","402","403","404","501","502","503","504"],
  "S3棟": ["101","102","103","104","201","202","203","204","301","302","303","304","401","402","403","404","501","502","503","504"],
  "S4棟": ["101","102","103","104","201","202","203","204","301","302","303","304","401","402","403","404","501","502","503","504"],
});

export const FALLBACK_FIXTURES = Object.freeze([
  "a059","a060","a061","a062","a063",
  "x037","x038","x039",
  "H098","H099",
  "LD10","LD11","LD12",
  "I250","I500",
  "a'13","a'14",
  "T1","T2",
  "その他",
]);

export const FALLBACK_STAGES = Object.freeze([
  "施工前", "施工中", "施工後",
]);

// ============================================================
// ファイル
// ============================================================
export const FILENAME_TEMPLATE = "{date}_{bldg}-{room}_{fixture}_{stage}_{seq}.jpg";
export const JPEG_QUALITY = 0.82;  // v1.7.0: 画質向上
export const PENDING_LIMIT = 100;
export const PENDING_WARN  = 80;
export const AUTO_CLEANUP_DAYS = 7;

// ============================================================
// カメラ
// ============================================================
export const CAMERA_DEFAULTS = Object.freeze({
  facing: "environment",
  width:  1600,
  height: 1200,
});

export const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
