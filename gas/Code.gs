/**
 * 北方カメラ - GAS Web App バックエンド v3.4.0
 * v3.4.0: 保存先(親)フォルダの指定に対応。アプリから parent が送られてきたら
 *         そのフォルダの中に部屋フォルダを作って保存する。
 *         parent が無い場合は従来どおり PARENT_FOLDER_ID を使う。
 *         指定フォルダに書き込めない場合は自動で既定フォルダへ保存する(写真を失わない)。
 * v3.3.0: no-cors POST/iframe POST 両対応。スマホ連続送信の状態確認を安定化。
 * 旧来の分割GET(JSONP)もフォールバックとして残しています。
 *
 * デプロイ設定:
 *   ・実行ユーザー: 自分
 *   ・アクセスできるユーザー: 全員
 */

var SHARED_TOKEN     = 'kitagata-photo-2026';   // ⚠️ アプリ側 config.js と一致
var PARENT_FOLDER_ID = '1kI1oXJOify1XWtcTuUsbVAuKYRXv1XmS';   // 既定の保存先(親フォルダ)
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
// 保存先(親)フォルダの解決  ★v3.4.0で追加
// ============================================================

/**
 * アプリから parent が送られてきたらそのフォルダを、無ければ既定フォルダを返す。
 * ID が違う/権限が無い場合も既定フォルダにフォールバックする。
 */
function resolveParentFolder_(params) {
  var pid = (params && params.parent) ? String(params.parent).trim() : '';
  if (pid) {
    try {
      return DriveApp.getFolderById(pid);
    } catch (err) {
      // 見つからない・アクセスできない → 既定フォルダを使う
    }
  }
  return DriveApp.getFolderById(PARENT_FOLDER_ID);
}

// ============================================================
// エンドポイント
// ============================================================

function doGet(e)  { return handleRequest((e && e.parameter) ? e.parameter : {}); }

function doPost(e) {
  var p = {};

  // form POST の場合は e.parameter に入る
  try {
    if (e && e.parameter) {
      for (var k in e.parameter) p[k] = e.parameter[k];
    }
  } catch (err) {}

  // JSON POST も一応対応
  try {
    if ((!p.action) && e && e.postData && e.postData.contents) {
      var j = JSON.parse(e.postData.contents);
      for (var jk in j) p[jk] = j[jk];
    }
  } catch (err2) {}

  if (String(p.action || '') === 'upload_form') {
    return handleUploadFormResponse_(p);
  }

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
    if      (action === 'ping')        result = handlePing(params);     // ★params を渡す
    else if (action === 'upload_form') result = handleUploadForm_(params);
    else if (action === 'upload_status') result = handleUploadStatus_(params);
    else if (action === 'up_start')    result = handleUpStart(params);
    else if (action === 'up_chunk')    result = handleUpChunk(params);
    else if (action === 'up_finish')   result = handleUpFinish(params);
    else if (action === 'list')        result = handleList(params);
    else                               result = { ok: false, error: 'unknown action: ' + action };
    return respond(result, callback);
  } catch (err) {
    return respond({ ok: false, error: String(err.message || err) }, callback);
  }
}

// ============================================================
// ping
// ============================================================

function handlePing(params) {
  var folder = resolveParentFolder_(params);   // ★指定があればその保存先名を返す
  var requested = (params && params.parent) ? String(params.parent).trim() : '';
  return {
    ok: true,
    version: '3.4.0',
    folder: folder.getName(),
    folderId: folder.getId(),
    // 指定したフォルダが使えなかった場合は false になる(既定フォルダに保存される)
    parentApplied: requested ? (folder.getId() === requested) : true,
    time: new Date().toISOString()
  };
}

// ============================================================
// v3.3.0 form POST upload
// ============================================================

function handleUploadFormResponse_(params) {
  var requestId = String(params.requestId || '');
  var token = params.secret || params.token || '';
  var result;

  try {
    if (token !== SHARED_TOKEN) {
      result = { ok: false, error: 'invalid token' };
    } else {
      result = handleUploadForm_(params);
    }
  } catch (err) {
    result = { ok: false, error: String(err.message || err) };
  }

  result.requestId = requestId;
  storeUploadStatus_(requestId, result);
  return respondHtmlPostMessage_(requestId, result);
}

function handleUploadStatus_(params) {
  var requestId = String(params.requestId || '').trim();
  if (!requestId) return { ok: false, error: 'requestId required' };

  var result = readUploadStatus_(requestId);
  if (!result) {
    return { ok: true, done: false, requestId: requestId };
  }

  return { ok: true, done: true, requestId: requestId, response: result };
}

function storeUploadStatus_(requestId, result) {
  if (!requestId) return;
  try {
    CacheService.getScriptCache().put('upload_status_' + requestId, JSON.stringify(result), 600);
  } catch (e) {}
}

function readUploadStatus_(requestId) {
  if (!requestId) return null;
  try {
    var txt = CacheService.getScriptCache().get('upload_status_' + requestId);
    if (!txt) return null;
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

function handleUploadForm_(params) {
  var folder = String(params.folder || '').trim();
  var name   = String(params.name   || '').trim();
  var mime   = String(params.mime   || 'image/jpeg').trim();
  var meta   = String(params.meta   || '');
  var base64 = String(params.data   || '');

  if (!folder) throw new Error('folder required');
  if (!name)   throw new Error('name required');
  if (!base64 || base64.length < 100) throw new Error('data required or too small (len=' + base64.length + ')');

  var parentFolder = resolveParentFolder_(params);   // ★保存先を解決
  return saveBase64ToDrive_(parentFolder, folder, name, mime, meta, base64);
}

function respondHtmlPostMessage_(requestId, result) {
  var payload = {
    kitagataGasResponse: true,
    requestId: requestId,
    response: result
  };
  var json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  var html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>(function(){var msg=' + json + ';try{parent.postMessage(msg,"*");}catch(e){}})();</script>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// 一時フォルダ取得(分割GET用。常に既定フォルダの下に置く)
// ============================================================

function getTempFolder_() {
  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var it = parent.getFoldersByName(TEMP_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return parent.createFolder(TEMP_FOLDER_NAME);
}

function findTempFile_(tmp, name) {
  var it = tmp.getFilesByName(name);
  if (it.hasNext()) return it.next();
  return null;
}

// ============================================================
// 分割GETフォールバック
// ============================================================

function handleUpStart(params) {
  var uid    = String(params.uid    || '').trim();
  var folder = String(params.folder || '').trim();
  var name   = String(params.name   || '').trim();
  var mime   = String(params.mime   || 'image/jpeg').trim();
  var meta   = String(params.meta   || '');
  var total  = parseInt(params.total || '0', 10);
  var parent = String(params.parent || '').trim();   // ★保存先も覚えておく

  if (!uid)    throw new Error('uid required');
  if (!folder) throw new Error('folder required');
  if (!name)   throw new Error('name required');

  var tmp = getTempFolder_();
  removeTempByUid_(tmp, uid);

  var metaObj = { folder: folder, name: name, mime: mime, meta: meta, total: total, parent: parent };
  tmp.createFile(uid + '.meta.json', JSON.stringify(metaObj), 'application/json');
  tmp.createFile(uid + '.data.txt', '', 'text/plain');

  return { ok: true, uid: uid, started: true };
}

function handleUpChunk(params) {
  var uid   = String(params.uid   || '').trim();
  var idx   = parseInt(params.idx || '0', 10);
  var chunk = String(params.chunk || '');

  if (!uid) throw new Error('uid required');

  var tmp = getTempFolder_();
  var dataFile = findTempFile_(tmp, uid + '.data.txt');
  if (!dataFile) throw new Error('data file not found (start されていない or 期限切れ)');

  var current = dataFile.getBlob().getDataAsString();
  dataFile.setContent(current + chunk);

  return { ok: true, idx: idx };
}

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

  // ★開始時に覚えた保存先を使う
  var parentFolder = resolveParentFolder_({ parent: metaObj.parent || '' });
  var result = saveBase64ToDrive_(parentFolder, metaObj.folder, metaObj.name, metaObj.mime, metaObj.meta, base64);
  removeTempByUid_(tmp, uid);
  return result;
}

function removeTempByUid_(tmp, uid) {
  ['.meta.json', '.data.txt'].forEach(function(suffix) {
    var it = tmp.getFilesByName(uid + suffix);
    while (it.hasNext()) {
      it.next().setTrashed(true);
    }
  });
}

// ============================================================
// Drive保存共通
// ============================================================

function saveBase64ToDrive_(parentFolder, folderName, fileName, mime, meta, base64) {
  var bytes = Utilities.base64Decode(base64);
  var blob  = Utilities.newBlob(bytes, mime || 'image/jpeg', fileName);

  // 指定の保存先に書き込めない場合は既定フォルダへ保存する(写真を失わないため)
  var usedDefault = false;
  var subFolder;
  try {
    subFolder = getOrCreateSubFolder_(parentFolder, folderName);
  } catch (err) {
    usedDefault = true;
    subFolder = getOrCreateSubFolder_(DriveApp.getFolderById(PARENT_FOLDER_ID), folderName);
  }

  var description = '';
  if (meta) {
    try {
      var m = JSON.parse(meta);
      var lines = [];
      for (var k in m) lines.push(k + ': ' + m[k]);
      description = lines.join('\n');
    } catch (e) { description = meta; }
  }

  var file = subFolder.createFile(blob);
  if (description) file.setDescription(description);

  return {
    ok:          true,
    fileId:      file.getId(),
    fileName:    file.getName(),
    folderName:  subFolder.getName(),
    usedDefault: usedDefault,   // true なら指定先に保存できず既定フォルダに保存
    url:         file.getUrl(),
    bytes:       bytes.length,
  };
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
  var parent = resolveParentFolder_(params);   // ★保存先に合わせる
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
// JSON/JSONP レスポンス
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
