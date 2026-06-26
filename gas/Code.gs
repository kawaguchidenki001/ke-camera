/**
 * 北方カメラ - GAS Web App バックエンド
 * GenCan と同じ方式: text/plain + JSON.stringify で受け取る
 *
 * デプロイ設定:
 *   ・実行ユーザー: 自分(あなた)
 *   ・アクセスできるユーザー: 全員
 */

// ============================================================
// 設定(必ず変更)
// ============================================================

var SHARED_TOKEN     = 'kitagata-photo-2026';   // ⚠️ 推測されにくい文字列に変更
var PARENT_FOLDER_ID = '1kI1oXJOify1XWtcTuUsbVAuKYRXv1XmS';

// ============================================================
// セットアップ(初回のみ実行)
// ============================================================

function setup() {
  var folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  Logger.log('親フォルダ確認OK: ' + folder.getName());
  return 'OK: ' + folder.getName();
}

// ============================================================
// エンドポイント
// ============================================================

function doGet(e) {
  return handleRequest(parseGet(e));
}

function doPost(e) {
  return handleRequest(parsePost(e));
}

function parseGet(e) {
  // JSONP GET(ping など)
  var p = (e && e.parameter) ? e.parameter : {};
  p._token_field = 'secret';  // トークンフィールド名
  return p;
}

function parsePost(e) {
  // GenCan方式: text/plain + JSON.stringify(obj) で送られてくる
  var params = {};
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    Logger.log('POST body parse error: ' + err);
  }
  params._token_field = 'secret';
  return params;
}

function handleRequest(params) {
  var callback = params.callback || '';
  var action   = params.action   || 'ping';

  // トークンチェック(GET は secret または token、POST は secret)
  var token = params.secret || params.token || '';
  if (token !== SHARED_TOKEN) {
    Logger.log('invalid token: ' + token);
    return respond({ ok: false, error: 'invalid token' }, callback);
  }

  try {
    var result;
    if      (action === 'ping')   result = handlePing();
    else if (action === 'upload') result = handleUpload(params);
    else if (action === 'list')   result = handleList(params);
    else                          result = { ok: false, error: 'unknown action: ' + action };
    return respond(result, callback);
  } catch (err) {
    Logger.log('handleRequest error: ' + err);
    return respond({ ok: false, error: String(err.message || err) }, callback);
  }
}

// ============================================================
// ping
// ============================================================

function handlePing() {
  var folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  return { ok: true, version: '1.1.0', folder: folder.getName(), time: new Date().toISOString() };
}

// ============================================================
// upload
// ============================================================

function handleUpload(params) {
  var folderName = String(params.folder || '').trim();
  var name       = String(params.name   || '').trim();
  var mime       = String(params.mime   || 'image/jpeg').trim();
  var data       = String(params.data   || '').trim();
  var metaStr    = String(params.meta   || '').trim();

  Logger.log('upload: folder=' + folderName + ' name=' + name + ' dataLen=' + data.length);

  if (!folderName) throw new Error('folder is required');
  if (!name)       throw new Error('name is required');
  if (!data)       throw new Error('data is required (empty)');

  var bytes = Utilities.base64Decode(data);
  var blob  = Utilities.newBlob(bytes, mime, name);

  var parent    = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var subFolder = getOrCreateSubFolder(parent, folderName);

  var description = '';
  if (metaStr) {
    try {
      var meta  = JSON.parse(metaStr);
      var lines = [];
      for (var k in meta) lines.push(k + ': ' + meta[k]);
      description = lines.join('\n');
    } catch (e) {
      description = metaStr;
    }
  }

  var file = subFolder.createFile(blob);
  if (description) file.setDescription(description);

  Logger.log('upload OK: ' + file.getId() + ' / ' + file.getName());

  return {
    ok:         true,
    fileId:     file.getId(),
    fileName:   file.getName(),
    folderId:   subFolder.getId(),
    folderName: subFolder.getName(),
    url:        file.getUrl(),
  };
}

function getOrCreateSubFolder(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

// ============================================================
// list
// ============================================================

function handleList(params) {
  var folderName = String(params.folder || '').trim();
  if (!folderName) throw new Error('folder is required');

  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var iter   = parent.getFoldersByName(folderName);
  if (!iter.hasNext()) return { ok: true, files: [] };

  var sub   = iter.next();
  var files = [];
  var fi    = sub.getFiles();
  while (fi.hasNext() && files.length < 200) {
    var f = fi.next();
    files.push({ id: f.getId(), name: f.getName(), url: f.getUrl(), size: f.getSize() });
  }
  return { ok: true, folder: folderName, files: files };
}

// ============================================================
// レスポンス
// ============================================================

function respond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
