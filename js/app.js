// js/app.js
// 北方カメラ - メインエントリ

import {
  APP_VERSION, PROJECT,
  DRIVE_PARENT_FOLDER_ID,
  BUILDING_PRESETS, SHOOTING_TYPES,
  FILENAME_TEMPLATE, JPEG_QUALITY, CAMERA_DEFAULTS, INVALID_FILENAME_CHARS,
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
} from "./ui.js";
import { initAuth, requestAccessToken, signOut, isSignedIn, getCachedToken } from "./auth.js";
import { uploadBlob, createSubfolder } from "./drive.js";
import { startCamera, switchCamera, stopCamera, grabFrame } from "./camera.js";
import { composePhoto } from "./composer.js";

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
};

window.addEventListener("DOMContentLoaded", async () => {
  initEvents();
  populateProjectInfo();
  refreshHomeCards();

  // 認証初期化(GIS スクリプト読み込み完了を待ってから)
  try {
    await initAuth();
    updateAuthIndicator();
  } catch (e) {
    toastError(e.message);
  }

  // 既にトークン保持していればホームへ、そうでなければスプラッシュへ
  if (isSignedIn()) {
    showScreen("home");
  } else {
    showScreen("splash");
  }
});

/* ============================================================ Project info の流し込み */

function populateProjectInfo() {
  $("#projName").textContent     = PROJECT.name;
  $("#projNumber").textContent   = PROJECT.number;
  $("#projLocation").textContent = PROJECT.location;
  $("#projCompany").textContent  = PROJECT.company;
  $("#appVersion").textContent   = "v" + APP_VERSION;
}

/* ============================================================ ホームのカード再描画 */

function refreshHomeCards() {
  $("#cardPhotographerVal").textContent = state.photographer || "未設定";
  $("#cardPhotographerVal").classList.toggle("placeholder", !state.photographer);

  $("#cardBuildingVal").textContent = state.building || "未選択";
  $("#cardBuildingVal").classList.toggle("placeholder", !state.building);

  $("#cardRoomVal").textContent = state.room || "未選択";
  $("#cardRoomVal").classList.toggle("placeholder", !state.room);

  $("#cardTypeVal").textContent = state.type || "未選択";
  $("#cardTypeVal").classList.toggle("placeholder", !state.type);

  // 次の連番プレビュー
  const roomKey = makeRoomKey(state.building, state.room);
  if (roomKey) {
    const next = peekSeq(roomKey, todayYmd()) + 1;
    $("#nextSeqHint").textContent = `次の保存番号: ${state.building}-${state.room} の #${pad3(next)}`;
  } else {
    $("#nextSeqHint").textContent = "棟と部屋を選択してください";
  }

  // 撮影開始ボタンの活性化
  const ready = !!(state.photographer && state.building && state.room && state.type);
  $("#btnGoCamera").disabled = !ready;
  $("#btnGoCamera").classList.toggle("ready", ready);
}

/* ============================================================ イベント */

function initEvents() {
  // スプラッシュ画面
  $("#btnLoginSplash").addEventListener("click", onLogin);

  // ホーム画面
  $("#cardPhotographer").addEventListener("click", pickPhotographer);
  $("#cardBuilding").addEventListener("click", pickBuilding);
  $("#cardRoom").addEventListener("click", pickRoom);
  $("#cardType").addEventListener("click", pickType);
  $("#btnGoCamera").addEventListener("click", goCamera);

  // メニュー
  $("#btnMenu").addEventListener("click", openMenu);
  $$("[data-close-menu]").forEach(el => el.addEventListener("click", closeMenu));
  $("#menuSignOut").addEventListener("click", onSignOut);
  $("#menuChangePhoto").addEventListener("click", () => { closeMenu(); pickPhotographer(); });

  // 認証ステータスドット
  $("#authStatusBtn").addEventListener("click", onAuthDotClick);

  // カメラ画面
  $("#btnCameraBack").addEventListener("click", leaveCamera);
  $("#btnShutter").addEventListener("click", onShutter);
  $("#btnSwitchCamera").addEventListener("click", onSwitchCamera);
  $("#camTypeBadge").addEventListener("click", pickTypeFromCamera);

  // プレビュー画面
  $("#btnRetake").addEventListener("click", () => {
    state.lastCaptured = null;
    showScreen("camera");
  });
  $("#btnUpload").addEventListener("click", onUpload);

  // ライフサイクル
  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.cameraOn) stopCamera();
  });
}

/* ============================================================ ログイン */

async function onLogin() {
  try {
    showLoading("Google にログイン中…");
    await initAuth();
    await requestAccessToken();
    updateAuthIndicator();
    toastSuccess("ログインしました");

    // 撮影者未設定なら最初に聞く
    if (!state.photographer) {
      showScreen("home");
      refreshHomeCards();
      setTimeout(pickPhotographer, 200);
    } else {
      showScreen("home");
      refreshHomeCards();
    }
  } catch (e) {
    toastError(e.message);
  } finally {
    hideLoading();
  }
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
    toastInfo("ログイン中");
  } else {
    onLogin();
  }
}

function updateAuthIndicator() {
  setAuthIndicator(isSignedIn());
}

/* ============================================================ 各種ピッカー */

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
    title: "棟を選ぶ",
    options,
    selectedValue: state.building,
  });
  if (v && v !== state.building) {
    state.building = v;
    setLastBuilding(v);
    // 棟が変わったら部屋はリセット
    state.room = "";
    setLastRoom("");
    refreshHomeCards();
  }
}

async function pickRoom() {
  if (!state.building) {
    toastError("先に棟を選んでください");
    return;
  }
  const preset = BUILDING_PRESETS[state.building] || [];
  const custom = (getCustomRooms()[state.building] || []);
  const all = Array.from(new Set([...preset, ...custom])).sort(roomNumberSort);
  const options = all.map(r => ({
    value: r,
    label: r,
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
    // 自由入力で新規追加された場合はカスタムに保存
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
    if (state.room === v) {
      state.room = "";
      setLastRoom("");
    }
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
    // カメラ画面でも変更を反映
    const badge = $("#camTypeBadge span");
    if (badge) badge.textContent = v;
  }
}

async function pickTypeFromCamera() {
  // 撮影中の素早い切り替え
  await pickType();
}

/* ============================================================ メニュー */

function openMenu() { $("#menu").classList.add("open"); }
function closeMenu() { $("#menu").classList.remove("open"); }

/* ============================================================ カメラ */

async function goCamera() {
  if (!(state.photographer && state.building && state.room && state.type)) {
    toastError("撮影者・棟・部屋・撮影内容を全て選んでください");
    return;
  }
  // 認証チェック
  if (!isSignedIn()) {
    try {
      await requestAccessToken();
      updateAuthIndicator();
    } catch (e) {
      toastError("ログインが必要です: " + e.message);
      return;
    }
  }

  showScreen("camera");
  await startCameraFlow();
}

async function startCameraFlow() {
  const video = $("#videoEl");
  const info  = $("#camInfo");
  info.textContent = "カメラ起動中…";

  // バッジ更新
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
}

async function onSwitchCamera() {
  if (!state.cameraOn) return;
  try { await switchCamera($("#videoEl")); }
  catch (e) { toastError(e.message); }
}

async function onShutter() {
  if (!state.cameraOn) return;
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
    showScreen("preview");
  } catch (e) {
    toastError("撮影失敗: " + e.message);
    if (state.lastCaptured == null) {
      // 連番ロールバック(撮影自体失敗時)
      rollbackSeq(makeRoomKey(state.building, state.room), todayYmd());
    }
  } finally {
    $("#btnShutter").disabled = false;
  }
}

/* ============================================================ アップロード */

async function onUpload() {
  if (!state.lastCaptured || state.uploading) return;
  const cap = state.lastCaptured;

  state.uploading = true;
  showLoading("Drive へ保存中…");
  try {
    let token = getCachedToken();
    if (!token) {
      token = await requestAccessToken();
      updateAuthIndicator();
    }

    // 部屋フォルダの確保
    const folderName = cap.roomKey;  // "A1-101" 形式
    let folderId = getCachedFolderId(folderName);

    if (!folderId) {
      // 部屋フォルダを Drive 上に作成
      showLoading(`「${folderName}」フォルダ作成中…`);
      folderId = await createSubfolder({
        name: folderName,
        parentId: DRIVE_PARENT_FOLDER_ID,
        accessToken: token,
      });
      setCachedFolderId(folderName, folderId);
    }

    showLoading("Drive へ保存中…");

    const description = [
      `工事名: ${PROJECT.name}`,
      `工事番号: ${PROJECT.number}`,
      `工事場所: ${PROJECT.location}`,
      `会社: ${PROJECT.company}`,
      `撮影場所: ${cap.board.building}-${cap.board.room}`,
      `撮影内容: ${cap.board.type}`,
      `撮影者: ${cap.board.photographer}`,
      `撮影年月日: ${cap.board.date}`,
      `No: #${pad3(cap.board.seq)}`,
      `app: 北方カメラ v${APP_VERSION}`,
    ].join("\n");

    const properties = {
      project: PROJECT.number,
      bldg:    cap.board.building,
      room:    cap.board.room,
      type:    cap.board.type,
      photog:  cap.board.photographer,
      date:    cap.board.date,
      seq:     String(cap.board.seq),
      app:     "kitagata-cam",
    };

    const result = await uploadBlob({
      blob:        cap.blob,
      name:        cap.fileName,
      mimeType:    "image/jpeg",
      parents:     [folderId],
      accessToken: token,
      description,
      properties,
    });

    toastSuccess(`保存完了: ${cap.fileName}`);
    state.lastCaptured = null;

    // カメラに戻って次の撮影へ
    showScreen("camera");
    const v = $("#videoEl");
    const next = peekSeq(cap.roomKey, todayYmd()) + 1;
    $("#camInfo").textContent =
      `${v.videoWidth}×${v.videoHeight}  ・  次は #${pad3(next)}`;
    if (!state.cameraOn) await startCameraFlow();

  } catch (e) {
    rollbackSeq(cap.roomKey, todayYmd());
    if (/401/.test(e.message)) {
      try {
        await requestAccessToken({ forcePrompt: true });
        updateAuthIndicator();
        toastInfo("認証を更新しました。もう一度「Driveに保存」をタップしてください。");
      } catch (e2) {
        toastError(e2.message);
      }
    } else {
      toastError(e.message);
    }
  } finally {
    state.uploading = false;
    hideLoading();
  }
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

// 部屋番号(文字列だが数値的にソートしたい): "101" < "102" < ... < "1010"
function roomNumberSort(a, b) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (na !== nb) return na - nb;
  }
  return String(a).localeCompare(String(b));
}
