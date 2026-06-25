// js/config.js
// 北方カメラ - 設定値

export const APP_VERSION = "1.4.0";
export const APP_NAME = "北方カメラ";

// ===== Google OAuth =====
export const OAUTH_CLIENT_ID = "162115394945-581sp1s3u4je8c158ee336dadpc6mrss.apps.googleusercontent.com";
export const OAUTH_SCOPES = "https://www.googleapis.com/auth/drive.file";

// ===== Sheets 連携 =====
export const SHEETS_API_KEY = "AIzaSyA1EPCXjMfkhso-kiu7SHRDmdts027GpQs";
// ⚠️ Sheets を新規作成したら、ID をここに記入してください
export const SHEETS_ID = "1uPhgQOJqhFF4KDsB-VUPdU-83P552rCT8zyCCxHfZD0";

// シート名(タブ名)
export const SHEET_TAB_PROJECT  = "工事情報";
export const SHEET_TAB_BUILDING = "棟と部屋";
export const SHEET_TAB_FIXTURES = "照明器具";   // ← 新規
export const SHEET_TAB_STAGES   = "施工段階";   // ← 新規

// 各シートの読み取り範囲
export const SHEET_RANGE_PROJECT  = `${SHEET_TAB_PROJECT}!A2:B`;
export const SHEET_RANGE_BUILDING = `${SHEET_TAB_BUILDING}!A2:Z`;
export const SHEET_RANGE_FIXTURES = `${SHEET_TAB_FIXTURES}!A2:A`;
export const SHEET_RANGE_STAGES   = `${SHEET_TAB_STAGES}!A2:A`;

// API エンドポイント
export const SHEETS_VALUES_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";
export const DRIVE_UPLOAD_ENDPOINT  = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
export const DRIVE_FILES_ENDPOINT   = "https://www.googleapis.com/drive/v3/files";

// ===== フォールバック値(Sheets が読めない場合) =====
export const FALLBACK_PROJECT = Object.freeze({
  name:    "県営北方住宅室内照明LED化改修工事",
  number:  "県住工第1号",
  location:"本巣郡北方町",
  company: "河口電機株式会社",
  driveFolderId: "1kI1oXJOify1XWtcTuUsbVAuKYRXv1XmS",
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

// 北方住宅の照明器具記号(過去の図面分析より、22種類)
export const FALLBACK_FIXTURES = Object.freeze([
  "a059", "a060", "a061", "a062", "a063",
  "x037", "x038", "x039",
  "H098", "H099",
  "LD10", "LD11", "LD12",
  "I250", "I500",
  "a'13", "a'14",
  "T1", "T2",
  "その他",
]);

// 施工段階(初期値)
export const FALLBACK_STAGES = Object.freeze([
  "施工前",
  "施工中",
  "施工後",
]);

// ===== ファイル名テンプレート =====
// トークン: {date} {bldg} {room} {fixture} {stage} {photographer} {seq}
export const FILENAME_TEMPLATE = "{date}_{bldg}-{room}_{fixture}_{stage}_{seq}.jpg";

// ===== JPEG 品質 =====
export const JPEG_QUALITY = 0.92;

// ===== ローカル保存(未送信)の上限と自動削除 =====
export const PENDING_LIMIT = 100;
export const PENDING_WARN  = 80;
export const AUTO_CLEANUP_DAYS = 7;

// ===== カメラ初期設定 =====
export const CAMERA_DEFAULTS = Object.freeze({
  facing: "environment",
  width:  1920,
  height: 1440,
});

// ===== ファイル名で禁止される文字 =====
export const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
