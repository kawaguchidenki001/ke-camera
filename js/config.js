// js/config.js
// 定数とデフォルト値

export const APP_VERSION = "0.1.0";
export const APP_NAME = "KE-Camera";

// OAuth スコープ: drive.file のみ。これだとアプリが作成 / 開いたファイルしか
// 触れないので「機密スコープ」扱いにならず、Google の OAuth 検証が不要になる。
// 取引先含む不特定ユーザーに公開できる重要な設計判断。
export const OAUTH_SCOPES = "https://www.googleapis.com/auth/drive.file";

// Discovery doc は使わず、各 API を直接 fetch する(GIS の token client + fetch 方式)。
export const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
export const DRIVE_FILES_ENDPOINT  = "https://www.googleapis.com/drive/v3/files";
export const SHEETS_VALUES_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";

// 既定値
export const DEFAULTS = Object.freeze({
  clientId:        "",
  apiKey:          "",
  sheetId:         "",
  sheetRange:      "工事一覧!A2:E",
  driveFolderId:   "",
  filenameTpl:     "{date}_{kouji}_{naiyou}_{seq}.jpg",
  defaultShikousha:"",
  boardPos:        "bottom",
  boardHeight:     0.28,
  showSeq:         true,
  jpegQuality:     0.92,
  cameraFacing:    "environment",
  cameraWidth:     1920,
  cameraHeight:    1440,
});

// 列マッピング(マスタシートの A2:E)
// 列順: 工事名 / 工種 / 施工者 / Drive フォルダ ID / 区分
export const SHEET_COLS = Object.freeze({
  KOUJI:     0,
  KOUSHU:    1,
  SHIKOUSHA: 2,
  FOLDER_ID: 3,
  KUBUN:     4,
});

// 通し番号管理キー(localStorage)
export const SEQ_KEY_PREFIX = "ke-camera:seq:";

// ファイル名で禁止される文字
export const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
