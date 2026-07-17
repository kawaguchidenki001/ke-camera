// js/app.js
// 北方カメラ v1.7.0 - 施工段階3ボタン固定版

import {
  APP_VERSION,
  SHEETS_ID,
  FALLBACK_PROJECT, FALLBACK_BUILDINGS, FALLBACK_FIXTURES,
  FILENAME_TEMPLATE, JPEG_QUALITY, CAMERA_DEFAULTS, INVALID_FILENAME_CHARS,
  PENDING_LIMIT, PENDING_WARN, AUTO_CLEANUP_DAYS,
} from "./config.js?v=1.7.0";
import {
  getPhotographer, setPhotographer, getKnownPhotographers, removeKnownPhotographer,
  getCustomRooms, addCustomRoom, removeCustomRoom,
  getLastBuilding, setLastBuilding, getLastRoom, setLastRoom,
  getLastFixture, setLastFixture, getLastStage, setLastStage,
  nextSeq, rollbackSeq, peekSeq,
  saveConfigCache, loadConfigCache,
} from "./storage.js?v=1.7.0";
import {
  showScreen, getCurrentScreen, toast, toastSuccess, toastError, toastInfo,
  showLoading, hideLoading, setAuthIndicator, pickFromList, escapeHtml, dom,
  confirmDialog,
} from "./ui.js?v=1.7.0";
import { startCamera, switchCamera, stopCamera, isTorchSupported, setTorch, getZoomCapabilities, setCameraZoom } from "./camera.js?v=1.7.0";
import { composePhoto, BOARD_HR, BROWH } from "./composer.js?v=1.7.0";
import { readAllConfig } from "./sheets.js?v=1.7.0";
import {
  uploadViaGas, pingGas,
  getGasWebAppUrl, setGasWebAppUrl, getSharedToken, setSharedToken, getGasConfigStatus,
} from "./gas-uploader.js?v=1.7.0";
import {
  addPhoto, getPhoto, getPendingPhotos, countPending,
  markUploading, markUploaded, markFailed, resetStaleUploading, deletePhoto,
  autoCleanupOldUploads, isAtLimit, getObjectUrl, revokeObjectUrl, revokeAllObjectUrls,
} from "./photoStore.js?v=1.7.0";

const { $, $$ } = dom;

/* ============================================================ 固定黒板レイアウト */

const FIXED_BOARD_RECT = Object.freeze({ x: 0, y: 1, w: 0.38 });
const STAGE_BUTTONS = ["施工前", "施工中", "施工後"];
const ALWAYS_NO_BOARD = true;  // 黒板なし版を常時保存
const FAST_PHOTO_MAX_LONG_SIDE = 1600;  // v1.7.0: 画質向上
const BATCH_PAUSE_MS_MOBILE = 2500;     // スマホ連続送信の安定化
const BATCH_PAUSE_MS_PC = 300;
const BACKGROUND_UPLOAD_PAUSE_MS_MOBILE = 1800;
const BACKGROUND_UPLOAD_PAUSE_MS_PC = 250;
const MAX_BG_RETRY = 3;  // バックグラウンド送信で失敗写真を自動再試行する上限

/* ============================================================ デバッグログ */

const debugLines = [];
function dbg(msg) {
  const t = new Date().toLocaleTimeString("ja-JP");
  const line = `[${t}] ${msg}`;
  debugLines.push(line);
  if (debugLines.length > 200) debugLines.shift();
  const el = document.getElementById("debugLog");
  if (el) {
    el.textContent = debugLines.join("\n");
    el.scrollTop = el.scrollHeight;
  }
  console.log(line);
}

/* ============================================================ State */

const state = {
  project:       { ...FALLBACK_PROJECT },
  buildings:     { ...FALLBACK_BUILDINGS },
  fixtures:      [...FALLBACK_FIXTURES],
  stages:        [...STAGE_BUTTONS],
  configSource:  "fallback",
  configCachedAt: null,

  photographer:  getPhotographer(),
  building:      getLastBuilding(),
  room:          getLastRoom(),
  fixture:       getLastFixture(),
  stage:         getLastStage(),

  cameraOn:      false,
  cameraTrack:   null,
  torchSupported: false,
  torchOn:        false,
  zoomMode:       "digital",
  zoom:           1,
  zoomMin:        1,
  zoomMax:        4,
  zoomStep:       0.1,
  pinchStartDist: 0,
  pinchStartZoom: 1,

  uploading:     false,   // 送信中(バックグラウンド/未送信一括)
  capturing:     false,   // 撮影画像作成・端末保存中だけ true
  backgroundUploading: false,
  cancelBatch:   false,
  gasReady:      false,

  lastShot:      null,   // 直前に撮った写真(やり直し用) { ids, roomKey, date, seq, fileName }
};

window.addEventListener("DOMContentLoaded", async () => {
  initEvents();

  autoCleanupOldUploads(AUTO_CLEANUP_DAYS).catch(e => console.warn(e));

  // 設定読み込み(Sheets)
  await loadAppConfig();
  populateProjectInfo();
  renderStageButtons();
  refreshChips();
  await resetStaleUploading(30 * 1000);
  await refreshOutboxCard();

  // GAS 疎通確認
  testGasConnection();

  // カメラ画面に即時遷移
  showScreen("camera");
  await startCameraFlow();
  renderBoard();

  // URLで直接GAS設定を開けるようにする（メニューが見えない環境向け）
  const params = new URLSearchParams(location.search);
  if (params.has("gas")) {
    setTimeout(onSetGasUrl, 500);
  }

  // 撮影者が未設定なら、起動時に1回だけ聞く
  if (!state.photographer) {
    setTimeout(pickPhotographer, 400);
  }
});

/* ============================================================ GAS 疎通 */

async function testGasConnection() {
  const st = getGasConfigStatus();
  dbg(`GAS設定: ${st.maskedUrl}${st.hasUrlOverride ? " (端末設定)" : " (config.js)"}`);
  if (st.problem) {
    dbg(`GAS設定エラー: ${st.problem}`);
    state.gasReady = false;
    setAuthIndicator(false);
    return;
  }
  try {
    const r = await pingGas();
    if (r && r.ok) {
      state.gasReady = true;
      setAuthIndicator(true);
    } else {
      state.gasReady = false;
      setAuthIndicator(false);
    }
  } catch (e) {
    state.gasReady = false;
    setAuthIndicator(false);
  }
}

/* ============================================================ 設定読み込み */

async function loadAppConfig({ forceFresh = false } = {}) {
  if (!SHEETS_ID) return;
  try {
    if (forceFresh) showLoading("設定を再読み込み中…");
    const cfg = await readAllConfig();
    if (cfg.project && cfg.project.name) state.project = { ...FALLBACK_PROJECT, ...cfg.project };
    if (cfg.buildings && Object.keys(cfg.buildings).length > 0) state.buildings = cfg.buildings;
    if (Array.isArray(cfg.fixtures) && cfg.fixtures.length > 0) state.fixtures = cfg.fixtures;
    // 施工段階はボタン固定のためSheetsの説明文などは使わない
    state.stages = [...STAGE_BUTTONS];
    state.configSource = "sheets";
    state.configCachedAt = Date.now();
    saveConfigCache({
      project: state.project,
      buildings: state.buildings,
      fixtures: state.fixtures,
      stages: state.stages,
    });
    if (forceFresh) toastSuccess("Sheets から設定を読み込みました");
  } catch (e) {
    const cached = loadConfigCache();
    if (cached && cached.cfg) {
      state.project   = { ...FALLBACK_PROJECT, ...cached.cfg.project };
      state.buildings = cached.cfg.buildings || FALLBACK_BUILDINGS;
      state.fixtures  = cached.cfg.fixtures  || FALLBACK_FIXTURES;
      state.stages    = [...STAGE_BUTTONS];
      state.configSource = "cache";
      state.configCachedAt = cached.cachedAt;
      if (forceFresh) toastError(`Sheets 失敗(キャッシュを使用): ${e.message}`);
    } else {
      state.configSource = "fallback";
      if (forceFresh) toastError(`Sheets 失敗: ${e.message}`);
    }
  } finally {
    normalizeStage();
    if (forceFresh) hideLoading();
  }
}

async function reloadAppConfig() {
  await loadAppConfig({ forceFresh: true });
  populateProjectInfo();
  renderStageButtons();
  refreshChips();
  renderBoard();
}

/* ============================================================ 表示 */

function populateProjectInfo() {
  // 隠し要素に保持(他から参照用)
  $("#projName").textContent     = state.project.name     || "";
  $("#projNumber").textContent   = state.project.number   || "";
  $("#projLocation").textContent = state.project.location || "";
  $("#projCompany").textContent  = state.project.company  || "";
  $("#appVersion").textContent   = "v" + APP_VERSION;

  const vm = $("#appVersionMenu"); if (vm) vm.textContent = "v" + APP_VERSION;

  const srcEl = $("#configSource");
  if (srcEl) {
    const map = { sheets: "Sheets から読み込み済み", cache: "オフライン(前回値)", fallback: "初期値" };
    srcEl.textContent = map[state.configSource] || "";
    srcEl.classList.toggle("warn", state.configSource !== "sheets");
  }

  const photogShow = $("#menuPhotogShow");
  if (photogShow) photogShow.textContent = state.photographer ? `撮影者: ${state.photographer}` : "撮影者: 未設定";
}

function refreshChips() {
  setChip("Building", state.building);
  setChip("Room",     state.room);
  setChip("Fixture",  state.fixture);
  renderStageButtons();

  // 次の連番ヒント
  const roomKey = makeRoomKey(state.building, state.room);
  if (roomKey) {
    const next = peekSeq(roomKey, todayYmd()) + 1;
    $("#nextSeqHint").textContent = `次の保存番号: ${state.building}-${state.room} の #${pad3(next)}`;
  } else {
    $("#nextSeqHint").textContent = "棟と部屋を選択してください";
  }

  // 撮影ボタンの活性化
  const ready = !!(state.building && state.room && state.fixture && state.stage);
  $("#btnShoot").disabled = !ready;
}

function setChip(key, value) {
  const valEl = $(`#chip${key}Val`);
  const chipEl = $(`#chip${key}`);
  if (!valEl || !chipEl) return;
  if (value) {
    valEl.textContent = value;
    chipEl.classList.remove("empty");
  } else {
    valEl.textContent = "—";
    chipEl.classList.add("empty");
  }
}

function renderStageButtons() {
  const wrap = $("#stageButtons");
  if (!wrap) return;
  normalizeStage();
  const stages = STAGE_BUTTONS;
  wrap.innerHTML = stages.map((stage) => {
    const active = state.stage === stage ? " active" : "";
    return `<button class="stage-btn ${stageToneClass(stage)}${active}" type="button" data-stage="${escAttr(stage)}" aria-pressed="${state.stage === stage ? "true" : "false"}">${esc(stage)}</button>`;
  }).join("");
  wrap.querySelectorAll(".stage-btn").forEach(btn => {
    btn.addEventListener("click", () => selectStage(btn.dataset.stage || ""));
  });
}

function normalizeStage() {
  state.stages = [...STAGE_BUTTONS];
  if (!STAGE_BUTTONS.includes(state.stage)) {
    state.stage = "施工前";
    setLastStage(state.stage);
  }
}

function stageToneClass(stage) {
  const s = String(stage || "");
  if (s.includes("前")) return "stage-before";
  if (s.includes("中")) return "stage-during";
  if (s.includes("後")) return "stage-after";
  return "stage-other";
}

function selectStage(v) {
  if (!STAGE_BUTTONS.includes(v)) v = "施工前";
  state.stage = v;
  setLastStage(v);
  refreshChips();
  renderBoard();
}

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function refreshOutboxCard() {
  let count = 0;
  try { await resetStaleUploading(3 * 60 * 1000); } catch (e) {}
  try { count = await countPending(); } catch (e) {}
  const card = $("#outboxCard");
  const cnt  = $("#outboxCount");
  if (!card || !cnt) return;
  if (count === 0) { card.hidden = true; return; }
  card.hidden = false;
  cnt.textContent = `${count} 枚`;
  card.classList.toggle("warn", count >= PENDING_WARN);
}

/* ============================================================ Events */

function initEvents() {
  // チップ
  $("#chipBuilding").addEventListener("click", pickBuilding);
  $("#chipRoom").addEventListener("click", pickRoom);
  $("#chipFixture").addEventListener("click", pickFixture);
  const chipStage = $("#chipStage"); if (chipStage) chipStage.addEventListener("click", pickStage);

  // 撮影
  $("#btnShoot").addEventListener("click", onShoot);
  $("#btnSwitchCamera").addEventListener("click", onSwitchCamera);
  const lightBtn = $("#btnLight"); if (lightBtn) lightBtn.addEventListener("click", onToggleLight);
  initPinchZoom();

  // 未送信
  $("#outboxCard").addEventListener("click", openOutbox);

  // 直前写真のやり直し
  const redoBtn = $("#btnRedoShot"); if (redoBtn) redoBtn.addEventListener("click", onRedoShot);

  // メニュー
  $("#btnMenu").addEventListener("click", openMenu);
  const quickMenu = $("#quickOpenMenu"); if (quickMenu) quickMenu.addEventListener("click", openMenu);
  $$("[data-close-menu]").forEach(el => el.addEventListener("click", closeMenu));
  $("#menuPhotographer").addEventListener("click", () => { closeMenu(); pickPhotographer(); });
  $("#menuReloadConfig").addEventListener("click", async () => { closeMenu(); await reloadAppConfig(); });
  $("#menuTestGas").addEventListener("click", async () => { closeMenu(); await onTestGas(); });
  const gasSetBtn = $("#menuSetGasUrl");
  if (gasSetBtn) gasSetBtn.addEventListener("click", async () => { closeMenu(); await onSetGasUrl(); });
  const quickSetGas = $("#quickSetGas"); if (quickSetGas) quickSetGas.addEventListener("click", async () => { await onSetGasUrl(); });
  const quickTestGas = $("#quickTestGas"); if (quickTestGas) quickTestGas.addEventListener("click", async () => { await onTestGas(); });
  $("#menuOutbox").addEventListener("click", () => { closeMenu(); openOutbox(); });
  const updBtn = $("#menuForceUpdate");
  if (updBtn) updBtn.addEventListener("click", async () => { closeMenu(); await forceAppUpdate(); });
  const dbgBtn = $("#menuDebug");
  if (dbgBtn) dbgBtn.addEventListener("click", () => { closeMenu(); openDebug(); });
  const dbgClose = $("#debugClose"); if (dbgClose) dbgClose.addEventListener("click", closeDebug);
  const dbgClose2 = $("#debugClose2"); if (dbgClose2) dbgClose2.addEventListener("click", closeDebug);
  const dbgClear = $("#debugClear"); if (dbgClear) dbgClear.addEventListener("click", () => {
    debugLines.length = 0;
    const el = $("#debugLog"); if (el) el.textContent = "";
  });

  // 認証ドット
  $("#authStatusBtn").addEventListener("click", onAuthDotClick);

  // Outbox 画面
  $("#btnOutboxBack").addEventListener("click", async () => {
    showScreen("camera");
    refreshChips();
    refreshOutboxCard();
    if (!state.cameraOn) await startCameraFlow();
    renderBoard();
  });
  $("#btnUploadAll").addEventListener("click", uploadAllPending);
  $("#btnRefreshOutbox").addEventListener("click", () => renderOutbox());

  // ライフサイクル
  window.addEventListener("pagehide", () => { stopCameraFlow(); revokeAllObjectUrls(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.cameraOn) {
      stopCameraFlow();
    } else if (document.visibilityState === "visible" && !state.cameraOn && getCurrentScreen() === "camera") {
      startCameraFlow();
    }
  });
  window.addEventListener("resize", () => { renderBoard(); });
}


/* ============================================================ アプリ更新・キャッシュ削除 */

async function forceAppUpdate() {
  toastInfo("アプリのキャッシュを削除しています…");
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.warn("cache clear failed", e);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("v", "1.7.0");
  url.searchParams.delete("reset");
  window.location.replace(url.toString());
}

/* ============================================================ GAS テスト */

async function onSetGasUrl() {
  const current = getGasWebAppUrl();
  const url = window.prompt(
    "GASのウェブアプリURLを貼り付けてください。\n必ず https://script.google.com/macros/s/.../exec の形式です。\nscript.googleusercontent.com や /dev は使えません。",
    current || "https://script.google.com/macros/s/...../exec"
  );
  if (url === null) return;
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    toastError("GAS URL が空です");
    return;
  }

  const token = window.prompt(
    "GAS側の SHARED_TOKEN を入力してください。通常はこのままでOKです。",
    getSharedToken() || "kitagata-photo-2026"
  );
  if (token === null) return;

  setGasWebAppUrl(trimmed);
  setSharedToken(String(token || "").trim());

  const st = getGasConfigStatus();
  dbg(`GAS URLを端末に保存: ${st.maskedUrl}`);
  if (st.problem) {
    toastError(st.problem);
    setAuthIndicator(false);
    return;
  }

  await onTestGas();
}

async function onAuthDotClick() {
  if (state.gasReady) toastInfo("GAS 接続 OK");
  else await testGasConnection();
}

async function onTestGas() {
  const st = getGasConfigStatus();
  dbg(`GAS接続テスト: ${st.maskedUrl}${st.hasUrlOverride ? " (端末設定)" : " (config.js)"}`);
  if (st.problem) {
    state.gasReady = false;
    setAuthIndicator(false);
    dbg(`GAS設定エラー: ${st.problem}`);
    toastError(st.problem);
    return;
  }

  toastInfo("GAS に接続中…");
  try {
    const r = await pingGas();
    dbg(`GAS応答: ${JSON.stringify(r)}`);
    if (r && r.ok) {
      state.gasReady = true;
      setAuthIndicator(true);
      toastSuccess(`接続OK: ${r.folder || "Drive"}`);
    } else {
      state.gasReady = false;
      setAuthIndicator(false);
      toastError(`接続失敗: ${r?.error || "応答エラー"}`);
    }
  } catch (e) {
    state.gasReady = false;
    setAuthIndicator(false);
    dbg(`GAS接続失敗: ${e.message}`);
    toastError("接続失敗: " + e.message);
  }
}

/* ============================================================ Pickers */

async function pickPhotographer() {
  const known = getKnownPhotographers();
  const options = known.map(n => ({ value: n, label: n, sublabel: n === state.photographer ? "現在の選択" : "" }));
  const v = await pickFromList({
    title: "撮影者を選ぶ", options,
    allowInput: true, inputPlaceholder: "新しい撮影者名を入力(例: 横田)",
    selectedValue: state.photographer,
    footerButton: known.length > 0 ? {
      label: "候補を整理する",
      onClick: (close) => { close(null); managePhotographers(); },
    } : null,
  });
  if (v) {
    state.photographer = v;
    setPhotographer(v);
    const photogShow = $("#menuPhotogShow");
    if (photogShow) photogShow.textContent = `撮影者: ${v}`;
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
    if (state.photographer === v) { state.photographer = ""; setPhotographer(""); }
    const photogShow = $("#menuPhotogShow");
    if (photogShow) photogShow.textContent = state.photographer ? `撮影者: ${state.photographer}` : "撮影者: 未設定";
  }
}

async function pickBuilding() {
  const buildings = Object.keys(state.buildings);
  if (buildings.length === 0) { toastError("棟が未設定(Sheetsを確認)"); return; }
  const v = await pickFromList({
    title: "棟を選ぶ",
    options: buildings.map(b => ({ value: b, label: b })),
    selectedValue: state.building,
  });
  if (v && v !== state.building) {
    state.building = v;
    setLastBuilding(v);
    state.room = ""; setLastRoom("");
    refreshChips();
    renderBoard();
  }
}

async function pickRoom() {
  if (!state.building) { toastError("先に棟を選んでください"); return; }
  const preset = state.buildings[state.building] || [];
  const custom = (getCustomRooms()[state.building] || []);
  const all = Array.from(new Set([...preset, ...custom])).sort(roomNumberSort);
  const v = await pickFromList({
    title: `${state.building} の部屋を選ぶ`,
    options: all.map(r => ({ value: r, label: r, sublabel: custom.includes(r) ? "(端末で追加)" : "" })),
    allowInput: true,
    inputPlaceholder: "部屋番号を一時的に追加",
    selectedValue: state.room,
    footerButton: custom.length > 0 ? {
      label: "端末で追加した部屋を整理",
      onClick: (close) => { close(null); manageCustomRooms(state.building); },
    } : null,
  });
  if (v) {
    if (!preset.includes(v) && !custom.includes(v)) {
      addCustomRoom(state.building, v);
    }
    state.room = v;
    setLastRoom(v);
    refreshChips();
    renderBoard();
  }
}

async function manageCustomRooms(building) {
  const custom = (getCustomRooms()[building] || []);
  if (custom.length === 0) { toastInfo("端末追加の部屋はありません"); return; }
  const v = await pickFromList({
    title: `${building} で端末追加した部屋を削除`,
    options: custom.map(r => ({ value: r, label: r, sublabel: "タップで削除" })),
  });
  if (v) {
    removeCustomRoom(building, v);
    if (state.room === v) { state.room = ""; setLastRoom(""); }
    refreshChips();
    renderBoard();
  }
}

async function pickFixture() {
  if (!state.fixtures || state.fixtures.length === 0) { toastError("照明器具が未設定"); return; }
  const v = await pickFromList({
    title: "照明器具を選ぶ",
    options: state.fixtures.map(f => ({ value: f, label: f })),
    allowInput: true, inputPlaceholder: "自由入力する照明器具…",
    selectedValue: state.fixture,
  });
  if (v) {
    state.fixture = v;
    setLastFixture(v);
    refreshChips();
    renderBoard();
  }
}

async function pickStage() {
  const v = await pickFromList({
    title: "施工段階を選ぶ",
    options: STAGE_BUTTONS.map(s => ({ value: s, label: s })),
    allowInput: false,
    selectedValue: state.stage,
  });
  if (v) selectStage(v);
}

/* ============================================================ Menu */

function openMenu()  { $("#menu").classList.add("open"); }
function closeMenu() { $("#menu").classList.remove("open"); }

function openDebug() {
  const el = $("#debugLog");
  if (el) { el.textContent = debugLines.join("\n"); el.scrollTop = el.scrollHeight; }
  $("#debugPanel").classList.add("open");
}
function closeDebug() { $("#debugPanel").classList.remove("open"); }

/* ============================================================ Camera */

async function startCameraFlow() {
  const video = $("#videoEl");
  try {
    const track = await startCamera(video, {
      facingMode: CAMERA_DEFAULTS.facing,
      width:  CAMERA_DEFAULTS.width,
      height: CAMERA_DEFAULTS.height,
    });
    state.cameraOn = true;
    state.cameraTrack = track;
    state.torchOn = false;
    updateLightButton();
    await initWideZoom(track);
    setTimeout(renderBoard, 80);
  } catch (e) {
    state.cameraOn = false;
    state.cameraTrack = null;
    state.torchOn = false;
    updateLightButton();
    toastError(e.message);
  }
}

function stopCameraFlow() {
  stopCamera();
  const video = $("#videoEl");
  if (video) video.srcObject = null;
  state.cameraOn = false;
  state.cameraTrack = null;
  state.torchSupported = false;
  state.torchOn = false;
  resetZoomState();
  updateLightButton();
}

async function onSwitchCamera() {
  if (!state.cameraOn) return;
  try {
    if (state.torchOn && state.cameraTrack) {
      try { await setTorch(state.cameraTrack, false); } catch (e) {}
    }
    const track = await switchCamera($("#videoEl"));
    state.cameraTrack = track;
    state.torchOn = false;
    updateLightButton();
    await initWideZoom(track);
    setTimeout(renderBoard, 80);
  } catch (e) { toastError(e.message); }
}

async function onToggleLight() {
  if (!state.cameraTrack) return;
  if (!isTorchSupported(state.cameraTrack)) {
    toastInfo("この端末またはカメラはライトに対応していません");
    updateLightButton();
    return;
  }
  const next = !state.torchOn;
  try {
    await setTorch(state.cameraTrack, next);
    state.torchOn = next;
    updateLightButton();
  } catch (e) {
    state.torchOn = false;
    updateLightButton();
    toastError(e.message);
  }
}

function updateLightButton() {
  const btn = $("#btnLight");
  if (!btn) return;
  const supported = !!(state.cameraTrack && isTorchSupported(state.cameraTrack));
  state.torchSupported = supported;
  btn.hidden = !supported;
  btn.classList.toggle("active", !!state.torchOn);
  btn.setAttribute("aria-pressed", state.torchOn ? "true" : "false");
  btn.title = state.torchOn ? "ライトON" : "ライトOFF";
}


/* ============================================================ Pinch Zoom */

function resetZoomState() {
  state.zoomMode = "digital";
  state.zoom = 1;
  state.zoomMin = 1;
  state.zoomMax = 4;
  state.zoomStep = 0.1;
  state.pinchStartDist = 0;
  state.pinchStartZoom = 1;
  applyZoomDisplay();
}

async function initWideZoom(track) {
  const caps = getZoomCapabilities(track);
  if (caps && caps.max > caps.min) {
    state.zoomMode = "hardware";
    state.zoomMin = caps.min;
    state.zoomMax = Math.min(caps.max, Math.max(caps.min, 6));
    state.zoomStep = caps.step || 0.1;
    state.zoom = caps.min;
    await setCameraZoom(track, caps.min); // できるだけ広角側で開始
  } else {
    state.zoomMode = "digital";
    state.zoomMin = 1;
    state.zoomMax = 4;
    state.zoomStep = 0.05;
    state.zoom = 1; // デジタルズームなし = 最広角
  }
  applyZoomDisplay();
}

function initPinchZoom() {
  const wrap = $("#bcamWrap");
  if (!wrap) return;

  wrap.addEventListener("touchstart", (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest("button")) return;
    if (ev.touches.length === 2) {
      state.pinchStartDist = touchDistance(ev.touches[0], ev.touches[1]);
      state.pinchStartZoom = state.zoom;
    }
  }, { passive: true });

  wrap.addEventListener("touchmove", (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest("button")) return;
    if (ev.touches.length === 2 && state.pinchStartDist > 0) {
      ev.preventDefault();
      const d = touchDistance(ev.touches[0], ev.touches[1]);
      const ratio = d / state.pinchStartDist;
      setZoom(state.pinchStartZoom * ratio);
    }
  }, { passive: false });

  wrap.addEventListener("touchend", (ev) => {
    if (ev.touches.length < 2) {
      state.pinchStartDist = 0;
      state.pinchStartZoom = state.zoom;
    }
  }, { passive: true });
}

function touchDistance(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

async function setZoom(rawZoom) {
  const stepped = Math.round(rawZoom / state.zoomStep) * state.zoomStep;
  const z = Math.max(state.zoomMin, Math.min(state.zoomMax, stepped));
  state.zoom = z;
  if (state.zoomMode === "hardware" && state.cameraTrack) {
    const ok = await setCameraZoom(state.cameraTrack, z);
    if (!ok) {
      state.zoomMode = "digital";
      state.zoomMin = 1;
      state.zoomMax = 4;
      state.zoom = Math.max(1, Math.min(4, z));
    }
  }
  applyZoomDisplay();
}

function applyZoomDisplay() {
  const video = $("#videoEl");
  const badge = $("#zoomBadge");
  if (video) {
    if (state.zoomMode === "digital" && state.zoom > 1.001) {
      video.style.transform = `scale(${state.zoom})`;
    } else {
      video.style.transform = "";
    }
  }
  if (badge) {
    const show = state.cameraOn && state.zoom > state.zoomMin + 0.01;
    badge.hidden = !show;
    badge.textContent = `${state.zoom.toFixed(1)}×`;
  }
}

/* ============================================================ 黒板表示 */

function renderBoard() {
  const ov = $("#boardOverlay");
  if (!ov) return;

  const projName = state.project.name || "";
  const place    = (state.building && state.room) ? `${state.building}-${state.room}` : "";
  const fixture  = state.fixture || "";
  const stage    = state.stage || "";
  const company  = state.project.company || "";
  const dateStr  = todayYmd();

  ov.innerHTML =
    `<div class="bov-row" style="height:${pct(BROWH.a)}"><div class="bov-lb"><span class="bv-l">工事名</span></div><div class="bov-vl"><span class="bv-t" data-k="a">${esc(projName)}</span></div></div>` +
    `<div class="bov-row" style="height:${pct(BROWH.b)}"><div class="bov-lb"><span class="bv-l">場所</span></div><div class="bov-vl"><span class="bv-t" data-k="b">${esc(place)}</span></div></div>` +
    `<div class="bov-lf"  style="height:${pct(BROWH.c)}"><span class="bv-t" data-k="c">${esc(fixture)}</span></div>` +
    `<div class="bov-stage" style="height:${pct(BROWH.d)}"><span class="bv-t" data-k="d">${esc(stage)}</span></div>` +
    `<div class="bov-co"    style="height:${pct(BROWH.e)}"><span class="bov-co-l"><span class="bv-t" data-k="f">${esc(dateStr)}</span></span><span class="bov-co-r"><span class="bv-t" data-k="e">${esc(company)}</span></span></div>`;
  ov.style.display = "block";
  layoutBoard();
}

function layoutBoard() {
  const wrap = $("#bcamWrap");
  const ov   = $("#boardOverlay");
  if (!wrap || !ov) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;

  let bw = W * FIXED_BOARD_RECT.w;
  let bh = bw * BOARD_HR;
  if (bh > H * 0.9) {
    bh = H * 0.9;
    bw = bh / BOARD_HR;
  }
  const x = 0;                 // 左端
  const y = Math.max(0, H - bh);  // 下端

  ov.style.left   = "0px";
  ov.style.top    = y + "px";
  ov.style.width  = bw + "px";
  ov.style.height = bh + "px";

  // 各文字のフォントサイズを行高に合わせる
  setRowFont(ov, ".bv-l", null,  BROWH.a, 0.4);   // ラベル(全部同じ)
  setSharedRowFont(ov, [".bv-t[data-k='a']", ".bv-t[data-k='b']"], BROWH.a, 0.6); // 工事名と場所は同じ縦横比
  setRowFont(ov, ".bv-t[data-k='c']", "c", BROWH.c, 0.48, bw);
  setRowFont(ov, ".bv-t[data-k='d']", "d", BROWH.d, 0.72, bw); // 施工段階は中央で大きく
  setRowFont(ov, ".bv-t[data-k='f']", "f", BROWH.e, 0.42, bw); // 撮影日(左)
  setRowFont(ov, ".bv-t[data-k='e']", "e", BROWH.e, 0.42, bw); // 会社名(右)

  function setSharedRowFont(rootEl, selectors, frac, factor) {
    const items = selectors
      .map(sel => rootEl.querySelector(sel))
      .filter(Boolean);
    if (items.length === 0) return;
    const rh = bh * frac;
    let fs = Math.floor(Math.max(6, rh * factor));
    const minFs = 8;
    for (; fs >= minFs; fs--) {
      let ok = true;
      for (const el of items) {
        el.style.fontSize = fs + "px";
        el.style.transform = "";
        const avail = (el.parentNode ? el.parentNode.clientWidth : bw) - 2;
        if (avail > 0 && el.scrollWidth > avail) { ok = false; break; }
      }
      if (ok) break;
    }
    for (const el of items) {
      el.style.fontSize = Math.max(fs, minFs) + "px";
      el.style.transform = "";
    }
  }

  function setRowFont(rootEl, sel, _k, frac, factor, parentW) {
    const els = rootEl.querySelectorAll(sel);
    if (!els || els.length === 0) return;
    const rh = bh * frac;
    const fs = Math.max(6, rh * factor);
    for (const el of els) {
      el.style.fontSize = Math.floor(fs) + "px";
      el.style.transform = "";
      if (parentW) {
        const avail = (el.parentNode ? el.parentNode.clientWidth : bw) - 2;
        if (avail > 0 && el.scrollWidth > avail) {
          el.style.transform = "scaleX(" + (avail / el.scrollWidth) + ")";
        }
      }
    }
  }
}

function pct(v) { return (v * 100).toFixed(2) + "%"; }

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ============================================================ 撮影 */

async function onShoot() {
  if (!(state.building && state.room && state.fixture && state.stage)) {
    toastError("棟・部屋・照明器具・施工段階を全て選んでください");
    return;
  }
  if (!state.photographer) {
    toastInfo("最初に撮影者を設定してください");
    await pickPhotographer();
    if (!state.photographer) return;
  }
  if (!state.cameraOn) { toastError("カメラが起動していません"); return; }
  if (state.capturing) { toastInfo("写真を端末に保存中です…"); return; }

  // バックグラウンド送信中でも次の撮影は許可する。
  // ただし未送信が上限に達している時は端末容量保護のため止める。
  if (await isAtLimit(PENDING_LIMIT)) {
    toastError(`未送信が ${PENDING_LIMIT} 枚に達しています。`);
    return;
  }

  state.capturing = true;
  const btn = $("#btnShoot");
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "保存中…";
  dbg("=== 撮影開始(端末保存優先) ===");

  let savedIds = [];
  let fileNameMain = "";

  try {
    const video = $("#videoEl");
    const source = video;

    const shotDate = todayYmd();
    const labels = { a: "工事名", b: "場所" };
    const values = {
      a: state.project.name || "",
      b: `${state.building}-${state.room}`,
      c: state.fixture || "",
      d: state.stage || "",
      e: state.project.company || "",
      f: shotDate,   // 撮影日(黒板の最下行 左側に焼き込む)
    };

    const result = await composePhoto(source, {
      boardRect:   FIXED_BOARD_RECT,
      labels, values,
      jpegQuality: JPEG_QUALITY || 0.82,
      cropToRatio: true,
      alsoNoBoard: ALWAYS_NO_BOARD,
      maxLongSide: FAST_PHOTO_MAX_LONG_SIDE,
      digitalZoom: state.zoomMode === "digital" ? state.zoom : 1,
    });

    shutterSound();

    const board = {
      building:     state.building,
      room:         state.room,
      fixture:      state.fixture,
      stage:        state.stage,
      photographer: state.photographer,
      date:         shotDate,
      project:      state.project,
      boardValues:  values,
    };
    const roomKey = makeRoomKey(board.building, board.room);
    board.seq = nextSeq(roomKey, board.date);

    fileNameMain = buildFilename(FILENAME_TEMPLATE, board);
    const fileNameNB = fileNameMain.replace(/\.jpe?g$/i, "_nb.jpg");

    // まず端末内 IndexedDB に保存する。ここまで終われば撮影ボタンを戻せる。
    const photoIdMain = await addPhoto({
      blob: result.withBoard.blob, board, fileName: fileNameMain, roomKey,
    });
    savedIds.push(photoIdMain);

    if (result.noBoard) {
      const photoIdNB = await addPhoto({
        blob: result.noBoard.blob,
        board: { ...board, isNoBoard: true },
        fileName: fileNameNB,
        roomKey,
      });
      savedIds.push(photoIdNB);
    }

    dbg(`端末保存完了: ${savedIds.length}枚 ${fileNameMain}`);
    toastSuccess(`端末に保存。Drive送信は裏で実行中: ${fileNameMain}`);

    // 直前の写真を「やり直し」できるように記録・表示
    showLastShot({
      ids: savedIds.slice(),
      roomKey,
      date: board.date,
      seq: board.seq,
      fileName: fileNameMain,
      previewBlob: result.withBoard.blob,
    });

    // 次の連番ヒントと未送信枚数をすぐ更新
    refreshChips();
    await refreshOutboxCard();

    // 送信は待たずに裏で開始する。撮影ボタンは finally ですぐ復帰する。
    setTimeout(() => startBackgroundUploadQueue(), 0);
  } catch (e) {
    console.error(e);
    toastError("撮影失敗: " + e.message);
  } finally {
    state.capturing = false;
    btn.disabled = false;
    btn.textContent = origText;
  }
}

/* ============================================================ 直前写真のやり直し */

function showLastShot(shot) {
  // 直前の写真が入れ替わるので、前回分のプレビューURLは解放しておく(メモリ節約)
  if (state.lastShot && Array.isArray(state.lastShot.ids)) {
    for (const id of state.lastShot.ids) revokeObjectUrl(id);
  }
  state.lastShot = shot;
  const card = $("#lastShot");
  const img  = $("#lastShotImg");
  const name = $("#lastShotName");
  if (!card || !img) return;
  const url = getObjectUrl(shot.ids[0], shot.previewBlob);
  if (url) img.src = url;
  if (name) name.textContent = shot.fileName || "";
  card.hidden = false;
}

function hideLastShot() {
  const card = $("#lastShot");
  if (card) card.hidden = true;
  const img = $("#lastShotImg");
  if (img) img.removeAttribute("src");
  state.lastShot = null;
}

async function onRedoShot() {
  const shot = state.lastShot;
  if (!shot || !Array.isArray(shot.ids) || shot.ids.length === 0) {
    hideLastShot();
    return;
  }
  const ok = await confirmDialog("直前の写真を削除してやり直しますか?\n(端末から削除します。まだ送信前なら連番も1つ戻します)");
  if (!ok) return;

  let deleted = 0;
  let anyUploaded = false;
  for (const id of shot.ids) {
    try {
      const p = await getPhoto(id);
      if (p && p.status === "uploaded") anyUploaded = true;
    } catch (e) {}
    try {
      await deletePhoto(id);
      revokeObjectUrl(id);
      deleted++;
    } catch (e) {
      dbg(`やり直し削除エラー: ${e.message || e}`);
    }
  }

  // まだ送信していない写真だけ連番を巻き戻す(送信済みは番号の重複を避けるため戻さない)
  if (shot.roomKey && !anyUploaded) rollbackSeq(shot.roomKey, shot.date);

  hideLastShot();
  refreshChips();
  await refreshOutboxCard();
  if (deleted > 0) toastInfo(`直前の写真を削除しました(${deleted}枚)。撮り直せます`);
}

function shutterSound() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!window._shCtx) window._shCtx = new AC();
    const actx = window._shCtx;
    if (actx.state === "suspended") actx.resume();
    const t = actx.currentTime;
    burst(actx, t,        0.022, 4200, 0.7, 1.0);
    burst(actx, t + 0.05, 0.06,  1500, 0.6, 0.85);
  } catch (e) {}
}
function burst(actx, at, dur, freq, q, vol) {
  const n = Math.max(1, Math.floor(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
  const nsrc = actx.createBufferSource(); nsrc.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain(); g.gain.value = vol;
  nsrc.connect(f); f.connect(g); g.connect(actx.destination);
  nsrc.start(at);
}

/* ============================================================ Upload */

async function uploadOne(photoId) {
  const photo = await getPhoto(photoId);
  if (!photo) throw new Error("写真が見つかりません");
  if (photo.status === "uploaded") {
    return { ok: true, fileId: photo.driveFileId || "", fileName: photo.fileName, skipped: true };
  }
  if (!photo.blob) throw new Error("写真データが既に削除されています");

  await markUploading(photoId);

  const folderName = photo.roomKey;
  const proj = photo.board.project || state.project;

  const meta = {
    工事名: proj.name || "",
    工事番号: proj.number || "",
    工事場所: proj.location || "",
    会社名: proj.company || "",
    撮影場所: `${photo.board.building}-${photo.board.room}`,
    照明器具: photo.board.fixture || "",
    施工段階: photo.board.stage || "",
    撮影者:   photo.board.photographer || "",
    撮影年月日: photo.board.date,
    連番: pad3(photo.board.seq),
    種別: photo.board.isNoBoard ? "黒板なし" : "黒板あり",
    app: `北方カメラ v${APP_VERSION}`,
  };

  try {
    const result = await uploadViaGas({
      blob: photo.blob,
      fileName: photo.fileName,
      folderName,
      mimeType: "image/jpeg",
      meta,
      onLog: dbg,
    });
    await markUploaded(photoId, result.fileId || "");
    dbg(`✓ 保存成功: ${result.fileName} (${result.bytes}B) fileId=${result.fileId}`);
    return result;
  } catch (e) {
    await markFailed(photoId, e.message || String(e));
    dbg(`✗ 失敗: ${e.message}`);
    throw e;
  }
}


/* ============================================================ Background Upload */

async function startBackgroundUploadQueue() {
  if (state.uploading) return;
  state.uploading = true;
  state.backgroundUploading = true;
  dbg("バックグラウンド送信開始");

  const pauseMs = isMobileBrowser() ? BACKGROUND_UPLOAD_PAUSE_MS_MOBILE : BACKGROUND_UPLOAD_PAUSE_MS_PC;
  let ok = 0;
  let ng = 0;
  let announcedError = false;

  try {
    while (true) {
      await resetStaleUploading(30 * 1000);
      // 失敗写真も MAX_BG_RETRY 回までは自動で再送する(一時的な通信断からの自動回復)。
      // 上限を超えた失敗は打ち切り、未送信一覧からの手動再送に委ねる。
      const list = (await getPendingPhotos()).filter(
        p => p.status !== "failed" || (p.attempts || 0) < MAX_BG_RETRY
      );
      if (list.length === 0) break;

      const p = list[0];
      try {
        dbg(`BG送信 ${p.board.building}-${p.board.room} #${pad3(p.board.seq)}${p.board.isNoBoard ? " 黒板なし" : " 黒板あり"}`);
        await uploadOne(p.id);
        ok++;
        await refreshOutboxCard();
      } catch (e) {
        ng++;
        dbg(`BG送信エラー: ${e.message || e}`);
        if (!announcedError) {
          toastError(`Drive送信失敗。未送信に残しました: ${e.message || e}`);
          announcedError = true;
        }
      }

      await sleep(pauseMs);
    }
  } finally {
    state.uploading = false;
    state.backgroundUploading = false;
    await refreshOutboxCard();

    // ちょうど送信終了の瞬間に新しい写真が端末保存された場合の取りこぼし対策
    try {
      const remaining = (await getPendingPhotos()).filter(p => p.status !== "failed");
      if (remaining.length > 0) {
        setTimeout(() => startBackgroundUploadQueue(), 250);
      }
    } catch (e) {}

    if (ok > 0 && ng === 0) {
      toastSuccess(`Drive送信完了: ${ok}枚`);
    } else if (ok > 0 && ng > 0) {
      toastInfo(`Drive送信: 成功${ok}枚 / 失敗${ng}枚`);
    }
    dbg(`バックグラウンド送信終了: 成功${ok} 失敗${ng}`);
  }
}

/* ============================================================ Outbox */

async function openOutbox() {
  // v1.6.11: スマホの連続送信中にカメラがメモリを使い続けないよう停止
  stopCameraFlow();
  showScreen("outbox");
  await resetStaleUploading(30 * 1000);
  await renderOutbox();
}

async function renderOutbox() {
  await resetStaleUploading(30 * 1000);
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
  allBtn.disabled = false;
  allBtn.textContent = `すべて Drive に送信(${list.length} 枚)`;

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
        <span class="oi-type">${escapeHtml(p.board.fixture || "")} / ${escapeHtml(p.board.stage || "")}</span>
        <span class="oi-date">${escapeHtml(p.board.date)} #${pad3(p.board.seq)}${p.board.isNoBoard ? " (黒板なし)" : ""}</span>
        ${p.status === "failed" && p.lastError ? `<span class="oi-error">${escapeHtml(String(p.lastError).slice(0, 90))}</span>` : ""}
        ${p.status !== "uploading" ? `<button class="oi-retry" data-action="retry" data-id="${escapeHtml(p.id)}" type="button">再送信</button>` : ""}
      </div>
    `;
    listEl.appendChild(item);
  }

  $$("#outboxList [data-action='delete']").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ok = await confirmDialog("この写真を削除しますか?(端末から完全に削除されます)");
      if (!ok) return;
      try {
        await deletePhoto(id);
        revokeObjectUrl(id);
        await renderOutbox();
        await refreshOutboxCard();
      } catch (err) { toastError("削除失敗: " + err.message); }
    });
  });

  // 写真ごとの再送信(特に失敗した写真の手動リトライ用)
  $$("#outboxList [data-action='retry']").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (state.uploading) { toastInfo("送信中です。少し待ってから再送信してください"); return; }
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = "送信中…";
      state.uploading = true;
      try {
        await uploadOne(id);
        toastSuccess("再送信しました");
      } catch (err) {
        toastError("再送信失敗: " + (err.message || err));
      } finally {
        state.uploading = false;
        await renderOutbox();
        await refreshOutboxCard();
      }
    });
  });
}

async function uploadAllPending() {
  if (state.uploading) { toastInfo("現在、裏で送信中です。少し待ってから開いてください"); return; }

  await resetStaleUploading(30 * 1000);
  const list = await getPendingPhotos();
  if (list.length === 0) { toastInfo("未送信なし"); return; }

  // v1.6.11: スマホではカメラを止めてから送信すると、1枚目以降で止まりにくい
  stopCameraFlow();
  state.uploading = true;

  const progress = $("#outboxProgress");
  const fill = $("#opFill");
  const text = $("#opText");
  const allBtn = $("#btnUploadAll");
  progress.hidden = false;
  state.cancelBatch = false;
  allBtn.disabled = true;

  let wakeLock = null;
  try {
    wakeLock = await requestScreenWakeLock();
  } catch (e) {}

  let ok = 0, ng = 0;
  const total = list.length;
  const pauseMs = isMobileBrowser() ? BATCH_PAUSE_MS_MOBILE : BATCH_PAUSE_MS_PC;

  try {
    for (let i = 0; i < total; i++) {
      if (state.cancelBatch) break;
      const p = list[i];
      fill.style.width = `${Math.round((i / total) * 100)}%`;
      text.textContent = `送信中 ${i + 1} / ${total}: ${p.board.building}-${p.board.room} #${pad3(p.board.seq)}${p.board.isNoBoard ? " 黒板なし" : ""}`;

      try {
        await uploadOne(p.id);
        ok++;
        text.textContent = `保存完了 ${i + 1} / ${total}: 次の写真を準備中…`;
      } catch (e) {
        ng++;
        dbg(`未送信送信エラー: ${e.message || e}`);
      }

      fill.style.width = `${Math.round(((i + 1) / total) * 100)}%`;
      // スマホのブラウザにIndexedDB/DOM/通信の後処理時間を渡す
      if (isMobileBrowser()) await resetStaleUploading(30 * 1000);
      await sleep(pauseMs);
    }

    fill.style.width = "100%";
    text.textContent = `完了: 成功 ${ok} 件 / 失敗 ${ng} 件`;
    if (ng === 0) toastSuccess(`${ok} 枚すべて送信しました 🎉`);
    else          toastInfo(`成功 ${ok} 件、失敗 ${ng} 件`);
  } finally {
    if (wakeLock) {
      try { await wakeLock.release(); } catch (e) {}
    }
    state.uploading = false;
    allBtn.disabled = false;
    setTimeout(() => { progress.hidden = true; }, 3000);
    await renderOutbox();
    await refreshOutboxCard();
  }
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

async function requestScreenWakeLock() {
  if (!("wakeLock" in navigator)) return null;
  try {
    return await navigator.wakeLock.request("screen");
  } catch (e) {
    return null;
  }
}

/* ============================================================ utilities */

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pad3(n) { return String(n).padStart(3, "0"); }

function makeRoomKey(building, room) {
  if (!building || !room) return "";
  return `${building}-${room}`;
}

function buildFilename(tpl, board) {
  const dateCompact = (board.date || todayYmd()).replace(/-/g, "");
  let name = (tpl || "{date}_{bldg}-{room}_{fixture}_{stage}_{seq}.jpg")
    .replace(/\{date\}/g,         dateCompact)
    .replace(/\{bldg\}/g,         board.building || "")
    .replace(/\{room\}/g,         board.room || "")
    .replace(/\{fixture\}/g,      board.fixture || "")
    .replace(/\{stage\}/g,        board.stage || "")
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
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (na !== nb) return na - nb;
  }
  return String(a).localeCompare(String(b));
}
