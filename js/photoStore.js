// js/photoStore.js
// 撮影写真の IndexedDB 保存・取得・状態管理

const DB_NAME = "kitagata-cam-db";
const DB_VERSION = 1;
const STORE_PHOTOS = "photos";  // 撮影写真本体 + メタ

let dbPromise = null;

/* ============================================================ DB 初期化 */

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("このブラウザは IndexedDB に対応していません"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const store = db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("uploadedAt", "uploadedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("DB 初期化失敗"));
  });
  return dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDb().then(db => {
    const t = db.transaction(storeName, mode);
    return t.objectStore(storeName);
  });
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("DB エラー"));
  });
}

/* ============================================================ 写真の追加 */

/**
 * 新しい写真をローカルに保存
 * @param {object} photo - { blob, board, fileName, roomKey }
 * @returns {Promise<string>} 採番された ID
 */
export async function addPhoto({ blob, board, fileName, roomKey }) {
  const id = generateId();
  const record = {
    id,
    blob,
    fileName,
    roomKey,
    board: { ...board },
    status: "pending",         // pending / uploading / uploaded / failed
    createdAt: Date.now(),
    uploadedAt: null,
    attempts: 0,
    lastError: null,
    driveFileId: null,
  };
  const store = await tx(STORE_PHOTOS, "readwrite");
  await promisify(store.add(record));
  return id;
}

/* ============================================================ 取得 */

export async function getPhoto(id) {
  const store = await tx(STORE_PHOTOS);
  return promisify(store.get(id));
}

export async function getAllPhotos() {
  const store = await tx(STORE_PHOTOS);
  return promisify(store.getAll());
}

export async function getPendingPhotos() {
  // v1.6.9: スマホで送信途中に止まった写真を再送対象へ戻せるよう、古い uploading も表示対象にする
  const all = await getAllPhotos();
  const staleMs = 30 * 1000;
  const now = Date.now();
  return all
    .filter(p =>
      p.status === "pending" ||
      p.status === "failed" ||
      (p.status === "uploading" && (!p.uploadingAt || (now - p.uploadingAt) > staleMs))
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getUploadedPhotos() {
  const all = await getAllPhotos();
  return all
    .filter(p => p.status === "uploaded")
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function countPending() {
  const list = await getPendingPhotos();
  return list.length;
}

export async function countAll() {
  const all = await getAllPhotos();
  return all.length;
}

/* ============================================================ 状態更新 */

export async function markUploading(id) {
  return updatePhoto(id, (p) => {
    p.status = "uploading";
    p.uploadingAt = Date.now();
    p.attempts = (p.attempts || 0) + 1;
  });
}

export async function markUploaded(id, driveFileId) {
  return updatePhoto(id, (p) => {
    p.status = "uploaded";
    p.uploadedAt = Date.now();
    p.uploadingAt = null;
    p.driveFileId = driveFileId;
    p.lastError = null;
  });
}

export async function markFailed(id, errorMessage) {
  return updatePhoto(id, (p) => {
    p.status = "failed";
    p.uploadingAt = null;
    p.lastError = errorMessage;
  });
}

export async function resetStaleUploading(maxAgeMs = 2 * 60 * 1000) {
  const all = await getAllPhotos();
  const now = Date.now();
  let reset = 0;
  for (const p of all) {
    if (p.status === "uploading" && (!p.uploadingAt || (now - p.uploadingAt) > maxAgeMs)) {
      await updatePhoto(p.id, (rec) => {
        rec.status = "failed";
        rec.uploadingAt = null;
        rec.lastError = "前回の送信が中断されたため、再送信待ちに戻しました";
      });
      reset++;
    }
  }
  return reset;
}

async function updatePhoto(id, updater) {
  const store = await tx(STORE_PHOTOS, "readwrite");
  const existing = await promisify(store.get(id));
  if (!existing) throw new Error(`Photo not found: ${id}`);
  updater(existing);
  await promisify(store.put(existing));
  return existing;
}

/* ============================================================ 削除 */

export async function deletePhoto(id) {
  const store = await tx(STORE_PHOTOS, "readwrite");
  return promisify(store.delete(id));
}

/**
 * Blob のみ削除(メタ情報は残す)
 * 送信済み写真の容量を解放するために使う
 */
export async function purgeBlob(id) {
  return updatePhoto(id, (p) => {
    p.blob = null;
    p.blobPurged = true;
  });
}

/**
 * 古い送信済み写真の Blob を自動削除
 * デフォルト: 7日経過した送信済み写真の Blob を削除
 */
export async function autoCleanupOldUploads(daysOld = 7) {
  const threshold = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
  const uploaded = await getUploadedPhotos();
  let cleaned = 0;
  for (const p of uploaded) {
    if (p.blob && p.uploadedAt && p.uploadedAt < threshold) {
      await purgeBlob(p.id);
      cleaned++;
    }
  }
  return cleaned;
}

/* ============================================================ 上限チェック */

export async function isAtLimit(limit = 100) {
  const n = await countPending();
  return n >= limit;
}

/* ============================================================ ID 生成 */

function generateId() {
  // タイムスタンプ + ランダム
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rnd}`;
}

/* ============================================================ Blob → Object URL (プレビュー用) */

const objectUrlCache = new Map();

export function getObjectUrl(id, blob) {
  if (objectUrlCache.has(id)) return objectUrlCache.get(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(id, url);
  return url;
}

export function revokeObjectUrl(id) {
  const url = objectUrlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(id);
  }
}

export function revokeAllObjectUrls() {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
}
