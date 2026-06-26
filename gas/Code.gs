/**
 * 北方カメラ - GAS Web App バックエンド(チャンク分割 GET 受信方式)
 *
 * 写真は Base64 を 8000 文字ずつ分割して GET で送られてくる。
 * チャンクを CacheService に一時保存し、全部揃ったら結合して Drive に保存。
 *
 * デプロイ設定:
 *   ・実行ユーザー: 自分
 *   ・アクセスできるユーザー: 全員
 */

var SHARED_TOKEN     = 'kitagata-photo-2026';   // ⚠️ アプリ側 config.js と一致させる
var PARENT_FOLDER_ID = '1kI1oXJOify1XWtcTuUsbVAuKYRXv1XmS';

// ============================================================
// セットアップ
// ============================================================

function setup() {
  var folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  Logger.log('親フォルダ確認OK: ' + folder.getName());
  return 'OK: ' + folder.getName();
}

// ============================================================
// エンドポイント
// ============================================================

function doGet(e)  { return handleRequest((e && e.parameter) ? e.parameter : {}); }
function doPost(e) {
  var p = {};
  try { if (e.postData && e.postData.contents) p = JSON.parse(e.postData.contents); }
  catch (err) {}
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
    if      (action === 'ping')    result = handlePing();
    else if (action === 'upchunk') result = handleUpChunk(params);
    else if (action === 'upload')  result = handleUploadDirect(params);  // 後方互換
    else if (action === 'list')    result = handleList(params);
    else                           result = { ok: false, error: 'unknown action: ' + action };
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
  return { ok: true, version: '2.0.0', folder: folder.getName(), time: new Date().toISOString() };
}

// ============================================================
// upchunk: 分割されたチャンクを受け取り、最後に結合して保存
// ============================================================

function handleUpChunk(params) {
  var uid   = String(params.uid   || '').trim();
  var idx   = parseInt(params.idx || '0', 10);
  var total = parseInt(params.total || '1', 10);
  var chunk = String(params.chunk || '');

  if (!uid) throw new Error('uid required');

  var cache = CacheService.getScriptCache();

  // チャンクを保存(個別キー)
  cache.put(uid + '_' + idx, chunk, 600);  // 10分保持

  // 最初のチャンクならメタ情報も保存
  if (idx === 0) {
    var metaObj = {
      folder: String(params.folder || '').trim(),
      name:   String(params.name   || '').trim(),
      mime:   String(params.mime   || 'image/jpeg').trim(),
      meta:   String(params.meta   || ''),
      total:  total,
    };
    cache.put(uid + '_meta', JSON.stringify(metaObj), 600);
  }

  // 最後のチャンクでなければ、ここで受領応答を返す
  if (idx < total - 1) {
    return { ok: true, received: idx };
  }

  // ===== 最後のチャンク: 全部揃えて結合 =====
  var metaStr = cache.get(uid + '_meta');
  if (!metaStr) throw new Error('meta not found (cache expired?)');
  var metaObj = JSON.parse(metaStr);

  if (!metaObj.folder) throw new Error('folder is required');
  if (!metaObj.name)   throw new Error('name is required');

  // 全チャンクを結合
  var keys = [];
  for (var i = 0; i < total; i++) keys.push(uid + '_' + i);
  var all = cache.getAll(keys);

  var base64 = '';
  for (var j = 0; j < total; j++) {
    var part = all[uid + '_' + j];
    if (part === null || part === undefined) {
      throw new Error('チャンク欠落: ' + j + '/' + total + ' (再送信してください)');
    }
    base64 += part;
  }

  // Base64 → Blob → Drive 保存
  var bytes = Utilities.base64Decode(base64);
  var blob  = Utilities.newBlob(bytes, metaObj.mime, metaObj.name);

  var parent    = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var subFolder = getOrCreateSubFolder(parent, metaObj.folder);

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

  // キャッシュ掃除
  cache.remove(uid + '_meta');
  for (var x = 0; x < total; x++) cache.remove(uid + '_' + x);

  return {
    ok:         true,
    fileId:     file.getId(),
    fileName:   file.getName(),
    folderId:   subFolder.getId(),
    folderName: subFolder.getName(),
    url:        file.getUrl(),
  };
}

// ============================================================
// upload: 一括(後方互換、小さいデータ用)
// ============================================================

function handleUploadDirect(params) {
  var folderName = String(params.folder || '').trim();
  var name       = String(params.name   || '').trim();
  var mime       = String(params.mime   || 'image/jpeg').trim();
  var data       = String(params.data   || '').trim();
  var metaStr    = String(params.meta   || '').trim();

  if (!folderName) throw new Error('folder is required');
  if (!name)       throw new Error('name is required');
  if (!data)       throw new Error('data is required');

  var bytes = Utilities.base64Decode(data);
  var blob  = Utilities.newBlob(bytes, mime, name);

  var parent    = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var subFolder = getOrCreateSubFolder(parent, folderName);

  var description = '';
  if (metaStr) {
    try {
      var m = JSON.parse(metaStr);
      var lines = [];
      for (var k in m) lines.push(k + ': ' + m[k]);
      description = lines.join('\n');
    } catch (e) { description = metaStr; }
  }

  var file = subFolder.createFile(blob);
  if (description) file.setDescription(description);

  return { ok: true, fileId: file.getId(), fileName: file.getName(), url: file.getUrl() };
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
  var sub = iter.next();
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
