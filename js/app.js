// js/app.js
// 北方カメラ - メインエントリ(オフライン対応版)

import {
  APP_VERSION, PROJECT,
  DRIVE_PARENT_FOLDER_ID,
  BUILDING_PRESETS, SHOOTING_TYPES,
  FILENAME_TEMPLATE, JPEG_QUALITY, CAMERA_DEFAULTS, INVALID_FILENAME_CHARS,
  PENDING_LIMIT, PENDING_WARN, AUTO_CLEANUP_DAYS,
} from "./config.js";
import {
  getPhotographer, setPhotographer, getKnownPhotographers, removeKnownPhotographer,
  getCustomRooms, addCustomRoom, removeCustomRoom,
  getCachedFolderId, setCachedFolderId,
  getLastBuilding, setLastBuilding, getLastRoom, setLastRoom, getLastType, setLastType,
  nextSeq, rollbackSeq, peekSeq,
} from "./storage.js";
import {
  showScreen, toast, toastSuccess, toastError, toastInfo,
  showLoading, hideLoading, setAuthIndicator, pickFromList, escapeHtml, dom,
  confirmDialog,
} from "./ui.js";
import { initAuth, requestAccessToken, signOut, isSignedIn, getCachedToken } from "./auth.js";
import { uploadBlob, createSubfolder } from "./drive.js";
import { startCamera, switchCamera, stopCamera, grabFrame } from "./camera.js";
import { composePhoto } from "./composer.js";
import {
  addPhoto, getPhoto, getPendingPhotos, countPending,
  markUploading, markUploaded, markFailed, deletePhoto,
  autoCleanupOldUploads, isAtLimit, getObjectUrl, revokeAllObjectUrls,
} from "./photoStore.js";

const { $, $$ } = dom;

/* ============================================================ State */

const state = {
  photographer:  getPhotographer(),
  building:      getLastBuilding(),
  room:          getLastRoom(),
  type:          getLastType(),
  lastCaptured:  null,
  cameraOn:      false,
  uploading:     false,
  cancelBatch:   false,
};

window.addEventListener("DOMContentLoaded", async () => {
  initEvents();
  populateProjectInfo();

  // 古い送信済み写真の自動削除(バックグラウンド)
  autoCleanupOldUploads(AUTO_CLEANUP_DAYS).then((n) => {
    if (n > 0) console.log(`Auto-cleaned ${n} old uploaded photos`);
  }).catch(e => console.warn(e));

  refreshHomeCards();
  await refreshOutboxCard();

  try {
    await initAuth();
    updateAuthIndicator();
  } catch (e) {
    console.warn("Auth init failed:", e);
  }

  if (isSignedIn()) {
    showScreen("home");
  } else {
    showScreen("splash");
  }
});

/* ============================================================ Project info */

function populateProjectInfo() {
  $("#projName").textContent     = PROJECT.name;
  $("#projNumber").textContent   = PROJECT.number;
  $("#projLocation").textContent = PROJECT.location;
  $("#projCompany").textContent  = PROJECT.company;
  $("#appVersion").textContent   = "v" + APP_VERSION;
  const vm = $("#appVersionMenu");
  if (vm) vm.textContent = "v" + APP_VERSION;
}

/* ============================================================ Home cards */

function refreshHomeCards() {
  $("#cardPhotographerVal").textContent = state.photographer || "未設定";
  $("#cardPhotographerVal").classList.toggle("placeholder", !state.photographer);
  $("#cardBuildingVal").textContent = state.building || "未選択";
  $("#cardBuildingVal").classList.toggle("placeholder", !state.building);
  $("#cardRoomVal").textContent = state.room || "未選択";
  $("#cardRoomVal").classList.toggle("placeholder", !state.room);
  $("#cardTypeVal").textContent = state.type || "未選択";
  $("#cardTypeVal").classList.toggle("placeholder", !state.type);

  const roomKey = makeRoomKey(state.building, state.room);
  if (roomKey) {
    const next = peekSeq(roomKey, todayYmd()) + 1;
    $("#nextSeqHint").textContent = `次の保存番号: ${state.building}-${state.room} の #${pad3(next)}`;
  } else {
    $("#nextSeqHint").textContent = "棟と部屋を選択してください";
  }

  const ready = !!(state.photographer && state.building && state.room && state.type);
  $("#btnGoCamera").disabled = !ready;
}

/* ============================================================ Outbox card */

async function refreshOutboxCard() {
  let count = 0;
  try {
    count = await countPending();
  } catch (e) {
    console.warn("countPending failed:", e);
  }
  const card = $("#outboxCard");
  const cnt  = $("#outboxCount");
  if (!card || !cnt) return;
  if (count === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  cnt.textContent = `${count} 枚`;
  card.classList.toggle("warn", count >= PENDING_WARN);
}

/* ============================================================ Events */

function initEvents() {
  // スプラッシュ
  $("#btnLoginSplash").addEventListener("click", onLogin);
  $("#btnSkipLogin").addEventListener("click", onSkipLogin);

  // ホーム
  $("#cardPhotographer").addEventListener("click", pickPhotographer);
  $("#cardBuilding").addEventListener("click", pickBuilding);
  $("#cardRoom").addEventListener("click", pickRoom);
  $("#cardType").addEventListener("click", pickType);
  $("#btnGoCamera").addEventListener("click", goCamera);
  $("#outboxCard").addEventListener("click", openOutbox);

  // メニュー
  $("#btnMenu").addEventListener("click", openMenu);
  $$("[data-close-menu]").forEach(el => el.addEventListener("click", closeMenu));
  $("#menuSignOut").addEventListener("click", onSignOut);
  $("#menuChangePhoto").addEventListener("click", () => { closeMenu(); pickPhotographer(); });

  // 認証ドット
  $("#authStatusBtn").addEventListener("click", onAuthDotClick);

  // カメラ画面
  $("#btnCameraBack").addEventListener("click", leaveCamera);
  $("#btnShutter").addEventListener("click", onShutter);
  $("#btnSwitchCamera").addEventListener("click", onSwitchCamera);
  $("#camTypeBadge").addEventListener("click", pickType);

  // プレビュー画面
  $("#btnRetake").addEventListener("click", () => {
    state.lastCaptured = null;
    showScreen("camera");
  });
  $("#btnUpload").addEventListener("click", onUploadLastCaptured);

  // Outbox
  $("#btnOutboxBack").addEventListener("click", () => { showScreen("home"); refreshOutboxCard(); refreshHomeCards(); });
  $("#btnUploadAll").addEventListener("click", uploadAllPending);
  $("#btnRefreshOutbox").addEventListener("click", () => renderOutbox());

  window.addEventListener("pagehide", () => { stopCamera(); revokeAllObjectUrls(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.cameraOn) stopCamera();
  });
}

/* ============================================================ Login */

async function onLogin() {
  try {
    showLoading("Google にログイン中…");
    await initAuth();
    await requestAccessToken();
    updateAuthIndicator();
    toastSuccess("ログインしました");
    if (!state.photographer) {
      showScreen("home"); refreshHomeCards(); refreshOutboxCard();
      setTimeout(pickPhotographer, 200);
    } else {
      showScreen("home"); refreshHomeCards(); refreshOutboxCard();
    }
  } catch (e) {
    toastError(e.message);
  } finally {
    hideLoading();
  }
}

function onSkipLogin() {
  toastInfo("ログインせずに使用します。撮影写真は端末に保存され、後で送信できます。");
  showScreen("home");
  refreshHomeCards();
  refreshOutboxCard();
  if (!state.photographer) setTimeout(pickPhotographer, 200);
}

async function onSignOut() {
  closeMenu();
  await signOut();
  updateAuthIndicator();
  toastInfo("サインアウトしました");
  showScreen("splash");
}

async function onAuthDotClick() {
  if (isSignedIn()) {
    toastInfo("ログイン中(緑)");
  } else {
    onLogin();
  }
}

function updateAuthIndicator() {
  setAuthIndicator(isSignedIn());
}

/* ============================================================ Pickers */

async function pickPhotographer() {
  const known = getKnownPhotographers();
  const options = known.map(n => ({
    value: n, label: n,
    sublabel: (n === state.photographer) ? "現在の選択" : "",
  }));
  const v = await pickFromList({
    title: "撮影者を選ぶ",
    options,
    allowInput: true,
    inputPlaceholder: "新しい撮影者名を入力(例: 横田)",
    selectedValue: state.photographer,
    footerButton: known.length > 0 ? {
      label: "候補を整理する",
      onClick: (close) => { close(null); managePhotographers(); },
    } : null,
  });
  if (v) {
    state.photographer = v;
    setPhotographer(v);
    refreshHomeCards();
    toastInfo(`撮影者を「${v}」に設定`);
  }
}

async function managePhotographers() {
  const known = getKnownPhotographers();
  if (known.length === 0) { toastInfo("候補がありません"); return; }
  const v = await pickFromList({
    title: "削除する撮影者を選ぶ",
    options: known.map(n => ({ value: n, label: n, sublabel: "タップで削除" })),
  });
  if (v) {
    removeKnownPhotographer(v);
    if (state.photographer === v) {
      state.photographer = "";
      setPhotographer("");
    }
    refreshHomeCards();
    toastInfo(`「${v}」を削除`);
  }
}

async function pickBuilding() {
  const buildings = Object.keys(BUILDING_PRESETS);
  const options = buildings.map(b => ({ value: b, label: b }));
  const v = await pickFromList({
    title: "棟を選ぶ", options, selectedValue: state.building,
  });
  if (v && v !== state.building) {
    state.building = v;
    setLastBuilding(v);
    state.room = "";
    setLastRoom("");
    refreshHomeCards();
  }
}

async function pickRoom() {
  if (!state.building) { toastError("先に棟を選んでください"); return; }
  const preset = BUILDING_PRESETS[state.building] || [];
  const custom = (getCustomRooms()[state.building] || []);
  const all = Array.from(new Set([...preset, ...custom])).sort(roomNumberSort);
  const options = all.map(r => ({
    value: r, label: r,
    sublabel: custom.includes(r) ? "(追加)" : "",
  }));
  const v = await pickFromList({
    title: `${state.building} の部屋を選ぶ`,
    options,
    allowInput: true,
    inputPlaceholder: "部屋番号を追加(例: 511)",
    selectedValue: state.room,
    footerButton: custom.length > 0 ? {
      label: "追加した部屋を整理",
      onClick: (close) => { close(null); manageCustomRooms(state.building); },
    } : null,
  });
  if (v) {
    if (!preset.includes(v) && !custom.includes(v)) {
      addCustomRoom(state.building, v);
      toastInfo(`部屋 ${v} を追加`);
    }
    state.room = v;
    setLastRoom(v);
    refreshHomeCards();
  }
}

async function manageCustomRooms(building) {
  const custom = (getCustomRooms()[building] || []);
  if (custom.length === 0) { toastInfo("追加した部屋はありません"); return; }
  const v = await pickFromList({
    title: `${building} の追加部屋を削除`,
    options: custom.map(r => ({ value: r, label: r, sublabel: "タップで削除" })),
  });
  if (v) {
    removeCustomRoom(building, v);
    if (state.room === v) { state.room = ""; setLastRoom(""); }
    refreshHomeCards();
    toastInfo(`${v} を削除`);
  }
}

async function pickType() {
  const options = SHOOTING_TYPES.map(t => ({ value: t, label: t }));
  const v = await pickFromList({
    title: "撮影内容を選ぶ",
    options,
    allowInput: true,
    inputPlaceholder: "自由入力する撮影内容…",
    selectedValue: state.type,
  });
  if (v) {
    state.type = v;
    setLastType(v);
    refreshHomeCards();
    const badge = $("#camTypeBadge span");
    if (badge) badge.textContent = v;
  }
}

/* ============================================================ Menu */

function openMenu()  { $("#menu").classList.add("open"); }
function closeMenu() { $("#menu").classList.remove("open"); }

/* ============================================================ Camera flow */

async function goCamera() {
  if (!(state.photographer && state.building && state.room && state.type)) {
    toastError("撮影者・棟・部屋・撮影内容を全て選んでください");
    return;
  }
  // 未送信が上限に達していたら撮影をブロック
  if (await isAtLimit(PENDING_LIMIT)) {
    toastError(`未送信写真が ${PENDING_LIMIT} 枚に達しています。先に送信してください。`);
    openOutbox();
    return;
  }
  showScreen("camera");
  await startCameraFlow();
}

async function startCameraFlow() {
  const video = $("#videoEl");
  const info  = $("#camInfo");
  info.textContent = "カメラ起動中…";
  $("#camLocationBadge span").textContent = `${state.building}-${state.room}`;
  $("#camTypeBadge span").textContent = state.type;
  $("#camPhotographerBadge span").textContent = state.photographer;

  try {
    await startCamera(video, {
      facingMode: CAMERA_DEFAULTS.facing,
      width:  CAMERA_DEFAULTS.width,
      height: CAMERA_DEFAULTS.height,
    });
    state.cameraOn = true;
    const w = video.videoWidth, h = video.videoHeight;
    const roomKey = makeRoomKey(state.building, state.room);
    const seq = peekSeq(roomKey, todayYmd()) + 1;
    info.textContent = `${w}×${h}  ・  次は #${pad3(seq)}`;
  } catch (e) {
    state.cameraOn = false;
    toastError(e.message);
    showScreen("home");
  }
}

function leaveCamera() {
  stopCamera();
  state.cameraOn = false;
  showScreen("home");
  refreshHomeCards();
  refreshOutboxCard();
}

async function onSwitchCamera() {
  if (!state.cameraOn) return;
  try { await switchCamera($("#videoEl")); }
  catch (e) { toastError(e.message); }
}

async function onShutter() {
  if (!state.cameraOn) return;

  if (await isAtLimit(PENDING_LIMIT)) {
    toastError(`未送信が ${PENDING_LIMIT} 枚に達しました。先に送信してください。`);
    return;
  }

  const video = $("#videoEl");
  try {
    $("#btnShutter").disabled = true;

    const board = {
      building:     state.building,
      room:         state.room,
      type:         state.type,
      photographer: state.photographer,
      date:         todayYmd(),
    };
    const roomKey = makeRoomKey(board.building, board.room);
    board.seq = nextSeq(roomKey, board.date);

    const frame = await grabFrame(video);
    const { blob, dataUrl } = await composePhoto(frame, board, {
      pos: "bottom",
      heightRatio: 0.30,
      jpegQuality: JPEG_QUALITY,
    });

    const fileName = buildFilename(FILENAME_TEMPLATE, board);
    state.lastCaptured = { blob, dataUrl, board, fileName, roomKey };

    $("#previewImg").src = dataUrl;
    $("#previewStatusText").textContent =
      `${board.building}-${board.room}  ・  ${board.type}  ・  #${pad3(board.seq)}`;

    // プレビュー画面のボタン文言を状況に応じて変える
    const btnUpload = $("#btnUpload");
    if (isSignedIn()) {
      btnUpload.textContent = "Drive に保存";
    } else {
      btnUpload.textContent = "端末に保存(後で送信)";
    }

    showScreen("preview");
  } catch (e) {
    toastError("撮影失敗: " + e.message);
    rollbackSeq(makeRoomKey(state.building, state.room), todayYmd());
  } finally {
    $("#btnShutter").disabled = false;
  }
}

/* ============================================================ Preview の保存ボタン */

async function onUploadLastCaptured() {
  if (!state.lastCaptured) return;
  const cap = state.lastCaptured;

  // まず IndexedDB に保存(オフライン耐性確保)
  let photoId = null;
  try {
    photoId = await addPhoto({
      blob: cap.blob,
      board: cap.board,
      fileName: cap.fileName,
      roomKey: cap.roomKey,
    });
  } catch (e) {
    toastError("端末保存失敗: " + e.message);
    return;
  }

  // 状態リセット
  state.lastCaptured = null;

  // ログイン中なら即送信を試みる
  if (isSignedIn()) {
    try {
      await uploadOne(photoId);
      toastSuccess(`Drive に保存しました: ${cap.fileName}`);
    } catch (e) {
      // 送信失敗 = 未送信として残す(エラーメッセージ表示するが続行可能)
      toastError(`Drive 送信失敗(未送信として保存): ${e.message}`);
    }
  } else {
    toastSuccess(`端末に保存しました(後でまとめて送信): ${cap.fileName}`);
  }

  // 次の撮影へ
  showScreen("camera");
  const v = $("#videoEl");
  const next = peekSeq(cap.roomKey, todayYmd()) + 1;
  $("#camInfo").textContent = `${v.videoWidth}×${v.videoHeight}  ・  次は #${pad3(next)}`;
  if (!state.cameraOn) await startCameraFlow();

  // 未送信カウントを更新(別画面に行ったときの表示用)
  refreshOutboxCard();
}

/* ============================================================ Upload one photo from store */

async function uploadOne(photoId) {
  const photo = await getPhoto(photoId);
  if (!photo) throw new Error("写真が見つかりません(ID: " + photoId + ")");
  if (!photo.blob) throw new Error("写真のデータが既に削除されています");

  let token = getCachedToken();
  if (!token) {
    token = await requestAccessToken();
    updateAuthIndicator();
  }

  await markUploading(photoId);

  // 部屋フォルダ確保
  const folderName = photo.roomKey;
  let folderId = getCachedFolderId(folderName);
  if (!folderId) {
    folderId = await createSubfolder({
      name: folderName,
      parentId: DRIVE_PARENT_FOLDER_ID,
      accessToken: token,
    });
    setCachedFolderId(folderName, folderId);
  }

  const description = [
    `工事名: ${PROJECT.name}`,
    `工事番号: ${PROJECT.number}`,
    `工事場所: ${PROJECT.location}`,
    `会社: ${PROJECT.company}`,
    `撮影場所: ${photo.board.building}-${photo.board.room}`,
    `撮影内容: ${photo.board.type}`,
    `撮影者: ${photo.board.photographer}`,
    `撮影年月日: ${photo.board.date}`,
    `No: #${pad3(photo.board.seq)}`,
    `app: 北方カメラ v${APP_VERSION}`,
  ].join("\n");

  const properties = {
    project: PROJECT.number,
    bldg:    photo.board.building,
    room:    photo.board.room,
    type:    photo.board.type,
    photog:  photo.board.photographer,
    date:    photo.board.date,
    seq:     String(photo.board.seq),
    app:     "kitagata-cam",
    localId: photoId,
  };

  try {
    const result = await uploadBlob({
      blob:        photo.blob,
      name:        photo.fileName,
      mimeType:    "image/jpeg",
      parents:     [folderId],
      accessToken: token,
      description,
      properties,
    });
    await markUploaded(photoId, result.id || "");
    return result;
  } catch (e) {
    await markFailed(photoId, e.message || String(e));
    throw e;
  }
}

/* ============================================================ Outbox 画面 */

async function openOutbox() {
  showScreen("outbox");
  await renderOutbox();
}

async function renderOutbox() {
  const list = await getPendingPhotos();
  $("#outboxSummary").textContent = `${list.length} 枚`;

  const empty = $("#outboxEmpty");
  const listEl = $("#outboxList");
  const allBtn = $("#btnUploadAll");

  if (list.length === 0) {
    empty.hidden = false;
    listEl.innerHTML = "";
    allBtn.disabled = true;
    return;
  }
  empty.hidden = true;
  allBtn.disabled = !isSignedIn();
  allBtn.textContent = isSignedIn()
    ? `すべて Drive に送信(${list.length} 枚)`
    : "ログインが必要です(タップでログイン)";

  if (!isSignedIn()) {
    allBtn.disabled = false;  // ログイン操作はできる
  }

  listEl.innerHTML = "";
  for (const p of list) {
    const item = document.createElement("div");
    item.className = "outbox-item";
    item.dataset.id = p.id;

    const url = getObjectUrl(p.id, p.blob);
    const statusLabel = p.status === "failed" ? "失敗" : (p.status === "uploading" ? "送信中" : "未送信");

    item.innerHTML = `
      <div class="oi-thumb">
        ${url ? `<img src="${url}" alt="" />` : ""}
        <span class="oi-status ${escapeHtml(p.status)}">${statusLabel}</span>
        <button class="oi-delete" data-action="delete" data-id="${escapeHtml(p.id)}" aria-label="削除" type="button">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="oi-meta">
        <span class="oi-loc">${escapeHtml(p.board.building)}-${escapeHtml(p.board.room)}</span>
        <span class="oi-type">${escapeHtml(p.board.type)}</span>
        <span class="oi-date">${escapeHtml(p.board.date)} #${pad3(p.board.seq)}</span>
      </div>
    `;
    listEl.appendChild(item);
  }

  // 削除ボタン
  $$("#outboxList [data-action='delete']").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ok = await confirmDialog("この写真を削除しますか?(端末から完全に削除されます)");
      if (!ok) return;
      try {
        await deletePhoto(id);
        await renderOutbox();
        await refreshOutboxCard();
        toastInfo("削除しました");
      } catch (err) {
        toastError("削除失敗: " + err.message);
      }
    });
  });
}

async function uploadAllPending() {
  if (!isSignedIn()) {
    // ログインしてもらう
    try {
      await initAuth();
      await requestAccessToken();
      updateAuthIndicator();
      toastSuccess("ログインしました。送信を開始します。");
    } catch (e) {
      toastError("ログインが必要です: " + e.message);
      return;
    }
  }

  const list = await getPendingPhotos();
  if (list.length === 0) {
    toastInfo("未送信の写真はありません");
    return;
  }

  const progress = $("#outboxProgress");
  const fill = $("#opFill");
  const text = $("#opText");
  progress.hidden = false;
  state.cancelBatch = false;
  $("#btnUploadAll").disabled = true;

  let ok = 0, ng = 0;
  const total = list.length;

  for (let i = 0; i < total; i++) {
    if (state.cancelBatch) break;
    const p = list[i];
    fill.style.width = `${Math.round((i / total) * 100)}%`;
    text.textContent = `送信中 ${i + 1} / ${total}: ${p.board.building}-${p.board.room} #${pad3(p.board.seq)}`;

    try {
      await uploadOne(p.id);
      ok++;
    } catch (e) {
      console.warn("Upload failed for", p.id, e);
      ng++;
      // 401(認証切れ)は即停止して再ログイン
      if (/401/.test(e.message)) {
        text.textContent = "認証切れ。再ログインしてください。";
        try {
          await requestAccessToken({ forcePrompt: true });
          updateAuthIndicator();
          // この1枚も再試行する? いったん次へ進める(失敗カウントだけ計上)
        } catch (e2) {
          toastError("再認証失敗: " + e2.message);
          break;
        }
      }
    }
  }

  fill.style.width = "100%";
  text.textContent = `完了: 成功 ${ok} 件 / 失敗 ${ng} 件`;
  $("#btnUploadAll").disabled = false;

  if (ng === 0) {
    toastSuccess(`${ok} 枚すべて送信しました 🎉`);
  } else {
    toastInfo(`成功 ${ok} 件、失敗 ${ng} 件。失敗は再試行できます。`);
  }

  // 3秒後にプログレスを隠す
  setTimeout(() => { progress.hidden = true; }, 3000);

  await renderOutbox();
  await refreshOutboxCard();
}

/* ============================================================ utilities */

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function pad3(n) { return String(n).padStart(3, "0"); }

function makeRoomKey(building, room) {
  if (!building || !room) return "";
  return `${building}-${room}`;
}

function buildFilename(tpl, board) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const time = `${hh}${mm}${ss}`;
  const dateCompact = (board.date || todayYmd()).replace(/-/g, "");

  let name = (tpl || "{date}_{bldg}-{room}_{type}_{seq}.jpg")
    .replace(/\{date\}/g,         dateCompact)
    .replace(/\{time\}/g,         time)
    .replace(/\{bldg\}/g,         board.building || "")
    .replace(/\{room\}/g,         board.room || "")
    .replace(/\{type\}/g,         board.type || "")
    .replace(/\{photographer\}/g, board.photographer || "")
    .replace(/\{seq\}/g,          pad3(board.seq || 1));

  name = name
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);

  if (!/\.jpe?g$/i.test(name)) name += ".jpg";
  return name;
}

function roomNumberSort(a, b) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (na !== nb) return na - nb;
  }
  return String(a).localeCompare(String(b));
}
