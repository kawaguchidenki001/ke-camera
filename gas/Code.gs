/**
 * 北方カメラ - GAS Web App バックエンド v3.0.0
 * 分割 GET 受信 → Drive 一時ファイルに追記 → 結合して保存
 *
 * すべて GET(JSONP)で動作。POST は使わない(no-cors POST が届かない問題を回避)。
 * チャンクは Drive 上の一時テキストファイルに追記するので、
 * GAS の実行インスタンスをまたいでも確実にデータが残る。
 *
 * デプロイ設定:
 *   ・実行ユーザー: 自分
 *   ・アクセスできるユーザー: 全員
 */

var SHARED_TOKEN     = 'kitagata-photo-2026';   // ⚠️ アプリ側 config.js と一致
var PARENT_FOLDER_ID = '1kI1oXJOify1XWtcTuUsbVAuKYRXv1XmS';
var TEMP_FOLDER_NAME = '_uploading_tmp';        // 一時ファイル置き場

// ============================================================
// セットアップ
// ============================================================

function setup() {
  var folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  Logger.log('親フォルダ確認OK: ' + folder.getName());
  return 'OK: ' + folder.getName();
}

// ============================================================
// エンドポイント(GET のみ使用)
// ============================================================

function doGet(e)  { return handleRequest((e && e.parameter) ? e.parameter : {}); }
function doPost(e) {
  var p = {};
  try { if (e.postData && e.postData.contents) p = JSON.parse(e.postData.contents); } catch (err) {}
  return handleRequest(p);
}

function handleRequest(params) {
  var callback = params.callback || '';
  var action   = params.action   || 'ping';
  var token    = params.secret || params.token || '';

  if (token !== SHARED_TOKEN) {
    return respond({ ok: false, error: 'invalid token' }, callback);
  }

  try {
    var result;
    if      (action === 'ping')      result = handlePing();
    else if (action === 'up_start')  result = handleUpStart(params);
    else if (action === 'up_chunk')  result = handleUpChunk(params);
    else if (action === 'up_finish') result = handleUpFinish(params);
    else if (action === 'list')      result = handleList(params);
    else                             result = { ok: false, error: 'unknown action: ' + action };
    return respond(result, callback);
  } catch (err) {
    return respond({ ok: false, error: String(err.message || err) }, callback);
  }
}

// ============================================================
// ping
// ============================================================

function handlePing() {
  var folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  return { ok: true, version: '3.0.0', folder: folder.getName(), time: new Date().toISOString() };
}

// ============================================================
// 一時フォルダ取得
// ============================================================

function getTempFolder_() {
  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var it = parent.getFoldersByName(TEMP_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return parent.createFolder(TEMP_FOLDER_NAME);
}

// 一時ファイル(メタ情報JSON と データ本体)を uid で探す
function findTempFile_(tmp, name) {
  var it = tmp.getFilesByName(name);
  if (it.hasNext()) return it.next();
  return null;
}

// ============================================================
// up_start: メタ情報を一時ファイルに保存、データ用ファイルを空で作る
// ============================================================

function handleUpStart(params) {
  var uid    = String(params.uid    || '').trim();
  var folder = String(params.folder || '').trim();
  var name   = String(params.name   || '').trim();
  var mime   = String(params.mime   || 'image/jpeg').trim();
  var meta   = String(params.meta   || '');
  var total  = parseInt(params.total || '0', 10);

  if (!uid)    throw new Error('uid required');
  if (!folder) throw new Error('folder required');
  if (!name)   throw new Error('name required');

  var tmp = getTempFolder_();

  // 既存の同 uid ファイルがあれば消す(作り直し)
  removeTempByUid_(tmp, uid);

  // メタ情報ファイル
  var metaObj = { folder: folder, name: name, mime: mime, meta: meta, total: total };
  tmp.createFile(uid + '.meta.json', JSON.stringify(metaObj), 'application/json');

  // データ本体ファイル(空で開始)
  tmp.createFile(uid + '.data.txt', '', 'text/plain');

  return { ok: true, uid: uid, started: true };
}

// ============================================================
// up_chunk: データファイルにチャンクを追記
// ============================================================

function handleUpChunk(params) {
  var uid   = String(params.uid   || '').trim();
  var idx   = parseInt(params.idx || '0', 10);
  var chunk = String(params.chunk || '');

  if (!uid) throw new Error('uid required');

  var tmp = getTempFolder_();
  var dataFile = findTempFile_(tmp, uid + '.data.txt');
  if (!dataFile) throw new Error('data file not found (start されていない or 期限切れ)');

  // 既存内容に追記(GAS は追記APIがないので read → write)
  var current = dataFile.getBlob().getDataAsString();
  dataFile.setContent(current + chunk);

  return { ok: true, idx: idx };
}

// ============================================================
// up_finish: データを結合して Drive 本フォルダに保存、一時ファイル削除
// ============================================================

function handleUpFinish(params) {
  var uid = String(params.uid || '').trim();
  if (!uid) throw new Error('uid required');

  var tmp = getTempFolder_();

  var metaFile = findTempFile_(tmp, uid + '.meta.json');
  var dataFile = findTempFile_(tmp, uid + '.data.txt');
  if (!metaFile) throw new Error('meta file not found');
  if (!dataFile) throw new Error('data file not found');

  var metaObj = JSON.parse(metaFile.getBlob().getDataAsString());
  var base64  = dataFile.getBlob().getDataAsString();

  if (!base64 || base64.length < 100) {
    throw new Error('データが空または不足 (len=' + base64.length + ')');
  }

  // Base64 → Blob
  var bytes = Utilities.base64Decode(base64);
  var blob  = Utilities.newBlob(bytes, metaObj.mime, metaObj.name);

  // 本フォルダのサブフォルダへ保存
  var parent    = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var subFolder = getOrCreateSubFolder_(parent, metaObj.folder);

  var description = '';
  if (metaObj.meta) {
    try {
      var m = JSON.parse(metaObj.meta);
      var lines = [];
      for (var k in m) lines.push(k + ': ' + m[k]);
      description = lines.join('\n');
    } catch (e) { description = metaObj.meta; }
  }

  var file = subFolder.createFile(blob);
  if (description) file.setDescription(description);

  // 一時ファイル削除
  removeTempByUid_(tmp, uid);

  return {
    ok:         true,
    fileId:     file.getId(),
    fileName:   file.getName(),
    folderName: subFolder.getName(),
    url:        file.getUrl(),
    bytes:      bytes.length,
  };
}

function removeTempByUid_(tmp, uid) {
  ['.meta.json', '.data.txt'].forEach(function(suffix) {
    var it = tmp.getFilesByName(uid + suffix);
    while (it.hasNext()) {
      it.next().setTrashed(true);
    }
  });
}

function getOrCreateSubFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

// ============================================================
// list
// ============================================================

function handleList(params) {
  var folderName = String(params.folder || '').trim();
  if (!folderName) throw new Error('folder required');
  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var it = parent.getFoldersByName(folderName);
  if (!it.hasNext()) return { ok: true, files: [] };
  var sub = it.next();
  var files = [];
  var fi = sub.getFiles();
  while (fi.hasNext() && files.length < 200) {
    var f = fi.next();
    files.push({ id: f.getId(), name: f.getName(), url: f.getUrl() });
  }
  return { ok: true, folder: folderName, files: files };
}

// ============================================================
// レスポンス
// ============================================================

function respond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
