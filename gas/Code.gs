/**
 * 北方カメラ - GAS Web App バックエンド
 * 
 * 役割:
 *   ・アプリから写真(Base64)を受け取り、Kさんの Drive に保存する
 *   ・棟-部屋のサブフォルダを自動で作る
 *   ・取引先・職人さんは Google アカウント認証不要で写真送信できる
 * 
 * デプロイ手順:
 *   1. https://script.google.com/ で新規プロジェクト
 *   2. このコードを丸ごと貼り付け
 *   3. 「setup」関数を実行(初回のみ、Drive 権限を承認)
 *   4. デプロイ → 新しいデプロイ → 種類: ウェブアプリ
 *      ・実行ユーザー: 自分(あなた)
 *      ・アクセスできるユーザー: 全員
 *   5. デプロイ後の URL をアプリの config.js に設定
 * 
 * 注意:
 *   ・SHARED_TOKEN は推測されにくい文字列に必ず変更してください
 *   ・写真は Base64 でアップロードされる(GAS の doPost 障害対策として GET ベース)
 *   ・1 リクエスト URL 長は実用上 5MB 程度まで(リサイズ済み写真は数百KB)
 */

// ============================================================
// 設定(初期セットアップ時に変更)
// ============================================================

/**
 * 共有トークン(URL に含まれる、推測されにくい文字列にする)
 * ⚠️ 必ず変更してください
 */
var SHARED_TOKEN = 'kitagata-photo-2026';

/**
 * 写真保存先の親フォルダ ID
 * 「KE-Camera 工事写真」フォルダ
 */
var PARENT_FOLDER_ID = '1kI1oXJOify1XWtcTuUsbVAuKYRXv1XmS';

/**
 * 受け入れる最大ファイルサイズ(MB)
 * Base64 デコード後の実サイズ。GAS 自体は最大 50MB 程度受けられる
 */
var MAX_FILE_SIZE_MB = 10;

// ============================================================
// セットアップ(初回のみ実行)
// ============================================================

function setup() {
  // Drive 権限を要求し、親フォルダが存在するか確認
  try {
    var folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
    Logger.log('親フォルダ確認OK: ' + folder.getName() + ' (ID: ' + PARENT_FOLDER_ID + ')');
    SpreadsheetApp.getUi && (function(){
      try { SpreadsheetApp.getUi().alert('セットアップOK\n親フォルダ: ' + folder.getName()); } catch(e) {}
    })();
    return 'OK: ' + folder.getName();
  } catch (e) {
    Logger.log('親フォルダの取得失敗: ' + e);
    throw new Error('PARENT_FOLDER_ID が間違っているか、アクセス権がありません。\n' + e.message);
  }
}

// ============================================================
// エンドポイント
// ============================================================

/**
 * GET エンドポイント(JSONP)
 * 
 * パラメータ:
 *   token:    SHARED_TOKEN と一致するか確認
 *   action:   "ping" | "upload" | "list"
 *   callback: JSONP コールバック関数名(省略可、省略時は JSON で返す)
 *   
 *   upload の場合:
 *     folder:  サブフォルダ名(例: "A1-101")
 *     name:    ファイル名
 *     mime:    MIME タイプ(image/jpeg など)
 *     data:    Base64 エンコード済み画像データ
 *     meta:    JSON 文字列(任意のメタデータ)
 */
function doGet(e) {
  return handleRequest(e);
}

/**
 * POST エンドポイント(将来用、現状は GET に統合)
 * GAS の doPost 障害(2025年11月以降)を考慮し、当面は doGet ベースで運用
 */
function doPost(e) {
  // POST でも body を取り出して処理(後方互換)
  try {
    if (e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      e.parameter = Object.assign({}, e.parameter || {}, body);
    }
  } catch (err) {}
  return handleRequest(e);
}

function handleRequest(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var callback = params.callback || '';
  var action = params.action || 'ping';

  try {
    // トークンチェック
    if (params.token !== SHARED_TOKEN) {
      return respond({ ok: false, error: 'invalid token' }, callback);
    }

    var result;
    if (action === 'ping') {
      result = handlePing();
    } else if (action === 'upload') {
      result = handleUpload(params);
    } else if (action === 'list') {
      result = handleList(params);
    } else {
      result = { ok: false, error: 'unknown action: ' + action };
    }

    return respond(result, callback);
  } catch (err) {
    return respond({ ok: false, error: String(err.message || err) }, callback);
  }
}

// ============================================================
// ping: 疎通確認
// ============================================================

function handlePing() {
  var folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  return {
    ok: true,
    version: '1.0.0',
    folder: folder.getName(),
    folderId: PARENT_FOLDER_ID,
    time: new Date().toISOString(),
  };
}

// ============================================================
// upload: 写真をアップロード
// ============================================================

function handleUpload(params) {
  var folderName = (params.folder || '').toString().trim();
  var name       = (params.name   || '').toString().trim();
  var mime       = (params.mime   || 'image/jpeg').toString().trim();
  var data       = (params.data   || '').toString().trim();
  var metaStr    = (params.meta   || '').toString().trim();

  if (!folderName) throw new Error('folder is required');
  if (!name)       throw new Error('name is required');
  if (!data)       throw new Error('data is required');

  // サイズチェック(Base64 を概算でデコードサイズに換算: × 0.75)
  var sizeMB = (data.length * 0.75) / (1024 * 1024);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    throw new Error('file too large: ' + sizeMB.toFixed(2) + ' MB (max ' + MAX_FILE_SIZE_MB + ')');
  }

  // Base64 → Blob
  var bytes = Utilities.base64Decode(data);
  var blob = Utilities.newBlob(bytes, mime, name);

  // サブフォルダ確保(なければ作る)
  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var subFolder = getOrCreateSubFolder(parent, folderName);

  // メタ情報を description にセット
  var description = '';
  if (metaStr) {
    try {
      var meta = JSON.parse(metaStr);
      var lines = [];
      for (var k in meta) {
        lines.push(k + ': ' + meta[k]);
      }
      description = lines.join('\n');
    } catch (e) {
      description = metaStr;
    }
  }

  // 作成
  var file = subFolder.createFile(blob);
  if (description) file.setDescription(description);

  return {
    ok: true,
    fileId: file.getId(),
    fileName: file.getName(),
    folderId: subFolder.getId(),
    folderName: subFolder.getName(),
    url: file.getUrl(),
    size: blob.getBytes().length,
  };
}

function getOrCreateSubFolder(parent, name) {
  // 既存フォルダ検索(同名複数あったら最初のを使う)
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

// ============================================================
// list: 指定サブフォルダの中身を返す(必要なら)
// ============================================================

function handleList(params) {
  var folderName = (params.folder || '').toString().trim();
  if (!folderName) throw new Error('folder is required');

  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var iter = parent.getFoldersByName(folderName);
  if (!iter.hasNext()) return { ok: true, files: [] };

  var sub = iter.next();
  var files = [];
  var fileIter = sub.getFiles();
  while (fileIter.hasNext()) {
    var f = fileIter.next();
    files.push({
      id: f.getId(),
      name: f.getName(),
      url: f.getUrl(),
      size: f.getSize(),
      mime: f.getMimeType(),
      createdAt: f.getDateCreated().toISOString(),
    });
    if (files.length >= 500) break;  // 安全制限
  }
  return { ok: true, folder: folderName, files: files };
}

// ============================================================
// レスポンス
// ============================================================

function respond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    // JSONP
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    // CORS 用 plain JSON(GAS は CORS ヘッダ自由に設定できないので JSONP 推奨)
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }
}
