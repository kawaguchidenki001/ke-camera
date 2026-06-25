// js/storage.js
// localStorage 管理 — 撮影者・追加部屋・フォルダIDキャッシュ・連番・直近選択

const KEYS = {
  PHOTOGRAPHER:  "kc:photographer",   // 撮影者名
  KNOWN_PHOTOGS: "kc:knownPhotogs",   // 撮影者の候補リスト(過去使った人)
  CUSTOM_ROOMS:  "kc:customRooms",    // { "A1棟": ["111","112"], ... } 追加された部屋
  FOLDER_CACHE:  "kc:folderCache",    // { "A1-101": "<folderId>", ... } サブフォルダID
  LAST_BLDG:     "kc:lastBldg",
  LAST_ROOM:     "kc:lastRoom",
  LAST_TYPE:     "kc:lastType",
  SEQ_PREFIX:    "kc:seq:",           // 連番(日付+部屋ごと)
};

/* ============================================================ 撮影者 */

export function getPhotographer() {
  return localStorage.getItem(KEYS.PHOTOGRAPHER) || "";
}

export function setPhotographer(name) {
  const v = (name || "").trim();
  if (v) {
    localStorage.setItem(KEYS.PHOTOGRAPHER, v);
    addKnownPhotographer(v);
  }
}

export function getKnownPhotographers() {
  try {
    const raw = localStorage.getItem(KEYS.KNOWN_PHOTOGS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

export function addKnownPhotographer(name) {
  const list = getKnownPhotographers();
  if (!list.includes(name)) {
    list.unshift(name);
    if (list.length > 20) list.pop();
    localStorage.setItem(KEYS.KNOWN_PHOTOGS, JSON.stringify(list));
  } else {
    // 既存なら先頭に移動
    const filtered = list.filter(n => n !== name);
    filtered.unshift(name);
    localStorage.setItem(KEYS.KNOWN_PHOTOGS, JSON.stringify(filtered));
  }
}

export function removeKnownPhotographer(name) {
  const list = getKnownPhotographers().filter(n => n !== name);
  localStorage.setItem(KEYS.KNOWN_PHOTOGS, JSON.stringify(list));
}

/* ============================================================ 追加部屋 */

export function getCustomRooms() {
  try {
    const raw = localStorage.getItem(KEYS.CUSTOM_ROOMS);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

export function addCustomRoom(building, room) {
  const data = getCustomRooms();
  if (!data[building]) data[building] = [];
  const v = (room || "").trim();
  if (v && !data[building].includes(v)) {
    data[building].push(v);
    data[building].sort();
    localStorage.setItem(KEYS.CUSTOM_ROOMS, JSON.stringify(data));
  }
}

export function removeCustomRoom(building, room) {
  const data = getCustomRooms();
  if (data[building]) {
    data[building] = data[building].filter(r => r !== room);
    if (data[building].length === 0) delete data[building];
    localStorage.setItem(KEYS.CUSTOM_ROOMS, JSON.stringify(data));
  }
}

/* ============================================================ フォルダIDキャッシュ */

export function getFolderCache() {
  try {
    const raw = localStorage.getItem(KEYS.FOLDER_CACHE);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

export function getCachedFolderId(roomKey) {
  return getFolderCache()[roomKey] || null;
}

export function setCachedFolderId(roomKey, folderId) {
  const cache = getFolderCache();
  cache[roomKey] = folderId;
  localStorage.setItem(KEYS.FOLDER_CACHE, JSON.stringify(cache));
}

export function clearFolderCache() {
  localStorage.removeItem(KEYS.FOLDER_CACHE);
}

/* ============================================================ 直近選択 */

export function getLastBuilding() { return localStorage.getItem(KEYS.LAST_BLDG) || ""; }
export function setLastBuilding(b) { localStorage.setItem(KEYS.LAST_BLDG, b); }

export function getLastRoom()     { return localStorage.getItem(KEYS.LAST_ROOM) || ""; }
export function setLastRoom(r)    { localStorage.setItem(KEYS.LAST_ROOM, r); }

export function getLastType()     { return localStorage.getItem(KEYS.LAST_TYPE) || ""; }
export function setLastType(t)    { localStorage.setItem(KEYS.LAST_TYPE, t); }

/* ============================================================ 連番(部屋+日付ごと) */

export function nextSeq(roomKey, dateStr) {
  const key = KEYS.SEQ_PREFIX + (dateStr || "x") + ":" + (roomKey || "x");
  let n = parseInt(localStorage.getItem(key) || "0", 10);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n += 1;
  localStorage.setItem(key, String(n));
  return n;
}

export function rollbackSeq(roomKey, dateStr) {
  const key = KEYS.SEQ_PREFIX + (dateStr || "x") + ":" + (roomKey || "x");
  const n = parseInt(localStorage.getItem(key) || "0", 10);
  if (Number.isFinite(n) && n > 0) {
    localStorage.setItem(key, String(n - 1));
  }
}

export function peekSeq(roomKey, dateStr) {
  const key = KEYS.SEQ_PREFIX + (dateStr || "x") + ":" + (roomKey || "x");
  return parseInt(localStorage.getItem(key) || "0", 10) || 0;
}
