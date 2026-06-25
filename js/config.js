// js/config.js
// 北方カメラ - 全設定をコード埋め込み(利用者は設定不要)

export const APP_VERSION = "1.1.0";
export const APP_NAME = "北方カメラ";

// ===== 工事情報(固定・変更不可) =====
export const PROJECT = Object.freeze({
  name:    "県営北方住宅室内照明LED化改修工事",
  number:  "県住工第1号",
  location:"本巣郡北方町",
  company: "河口電機株式会社",
});

// ===== Google OAuth(既存のKE-Cameraのものを流用) =====
export const OAUTH_CLIENT_ID = "162115394945-581sp1s3u4je8c158ee336dadpc6mrss.apps.googleusercontent.com";
export const OAUTH_SCOPES = "https://www.googleapis.com/auth/drive.file";

// ===== Drive 設定 =====
// 既存「KE-Camera 工事写真」フォルダを親として流用
export const DRIVE_PARENT_FOLDER_ID = "1kI1oXJOify1XWtcTuUsbVAuKYRXv1XmS";

// Drive API エンドポイント
export const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
export const DRIVE_FILES_ENDPOINT  = "https://www.googleapis.com/drive/v3/files";

// ===== 棟と部屋のプリセット(仮設定・後で調整可能) =====
// 過去のLED施工管理シート分析より、対象は A1/A2/A4/S1/S2/S3/S4 の7棟
// 階数・部屋数はざっくり仮設定(後でアプリ内「部屋を追加」で増減可)
export const BUILDING_PRESETS = Object.freeze({
  "A1棟": generateRooms(5, 4),   // 1F〜5F、各階4部屋
  "A2棟": generateRooms(10, 4),  // 1F〜10F、各階4部屋
  "A4棟": generateRooms(10, 4),  // 1F〜10F、各階4部屋
  "S1棟": generateRooms(5, 4),
  "S2棟": generateRooms(5, 4),
  "S3棟": generateRooms(5, 4),
  "S4棟": generateRooms(5, 4),
});

// 部屋番号生成: 1F=101〜104、2F=201〜204 ...
function generateRooms(floors, perFloor) {
  const rooms = [];
  for (let f = 1; f <= floors; f++) {
    for (let n = 1; n <= perFloor; n++) {
      rooms.push(`${f}${String(n).padStart(2, "0")}`);
    }
  }
  return rooms;
}

// ===== 撮影内容プリセット(仮設定・後で調整可能) =====
export const SHOOTING_TYPES = Object.freeze([
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
// 使用可能トークン: {date} {bldg} {room} {type} {photographer} {seq} {time}
export const FILENAME_TEMPLATE = "{date}_{bldg}-{room}_{type}_{seq}.jpg";

// ===== JPEG 品質 =====
export const JPEG_QUALITY = 0.92;

// ===== ローカル保存(未送信)の上限と自動削除 =====
export const PENDING_LIMIT = 100;         // 未送信写真の上限(撮影をブロック)
export const PENDING_WARN  = 80;          // 警告色を出す閾値
export const AUTO_CLEANUP_DAYS = 7;       // 送信済み写真の Blob を保持する日数

// ===== カメラ初期設定 =====
export const CAMERA_DEFAULTS = Object.freeze({
  facing: "environment",
  width:  1920,
  height: 1440,
});

// ===== ファイル名で禁止される文字 =====
export const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
