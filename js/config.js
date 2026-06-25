// js/config.js
// 北方カメラ - 設定値

export const APP_VERSION = "1.3.0";
export const APP_NAME = "北方カメラ";

// ===== Google OAuth(既存のKE-Cameraのものを流用) =====
export const OAUTH_CLIENT_ID = "162115394945-581sp1s3u4je8c158ee336dadpc6mrss.apps.googleusercontent.com";
export const OAUTH_SCOPES = "https://www.googleapis.com/auth/drive.file";

// ===== Sheets 連携(現場の設定を Sheets から読む) =====
// KE-Camera v0.1.0 で作ったAPIキーを流用(Sheets API 限定 + HTTPリファラ制限済み)
export const SHEETS_API_KEY = "AIzaSyA1EPCXjMfkhso-kiu7SHRDmdts027GpQs";

// 「北方カメラ 設定」シートのスプレッドシート ID
// ⚠️ Kさんが Sheets を新規作成したら、その ID をここに記入してください。
// 編集後は GitHub に push → Pages が更新されると新シートが反映されます。
export const SHEETS_ID = "";  // ← ここに新シートの ID を入れる

// シート名(タブ名)。固定。
export const SHEET_TAB_PROJECT  = "工事情報";    // A列ラベル / B列値
export const SHEET_TAB_BUILDING = "棟と部屋";    // A列=棟、B列以降=部屋番号
export const SHEET_TAB_TYPES    = "撮影内容";    // A列=撮影内容

// 各シートの読み取り範囲
export const SHEET_RANGE_PROJECT  = `${SHEET_TAB_PROJECT}!A2:B`;
export const SHEET_RANGE_BUILDING = `${SHEET_TAB_BUILDING}!A2:Z`;
export const SHEET_RANGE_TYPES    = `${SHEET_TAB_TYPES}!A2:A`;

// Sheets/Drive API エンドポイント
export const SHEETS_VALUES_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";
export const DRIVE_UPLOAD_ENDPOINT  = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
export const DRIVE_FILES_ENDPOINT   = "https://www.googleapis.com/drive/v3/files";

// ===== Sheets が読めない場合のフォールバック(初回起動・オフライン時) =====
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

export const FALLBACK_TYPES = Object.freeze([
  "灯具(設置前)",
  "灯具(設置後)",
  "銘板",
  "結線状況",
  "絶縁抵抗測定",
  "接地抵抗測定",
  "撤去状況",
  "産廃処理",
  "完了写真",
  "その他",
]);

// ===== ファイル名テンプレート =====
export const FILENAME_TEMPLATE = "{date}_{bldg}-{room}_{type}_{seq}.jpg";

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
