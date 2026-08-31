// js/app.js
// 北方カメラ v1.9.11 - 施工段階3ボタン固定版

import {
  APP_VERSION,
  SHEETS_ID,
  FALLBACK_PROJECT, FALLBACK_BUILDINGS, FALLBACK_FIXTURES,
  FILENAME_TEMPLATE, CAMERA_DEFAULTS, INVALID_FILENAME_CHARS,
  PENDING_LIMIT, PENDING_WARN, AUTO_CLEANUP_DAYS,
  QUALITY_PRESETS, DEFAULT_QUALITY,
  ZUMEN_APP_URL,
} from "./config.js?v=1.9.14";
import {
  getPhotographer, setPhotographer, getKnownPhotographers, removeKnownPhotographer,
  getCustomRooms, addCustomRoom, removeCustomRoom,
  getLastBuilding, setLastBuilding, getLastRoom, setLastRoom,
  getLastFixture, setLastFixture, getLastStage, setLastStage,
  nextSeq, rollbackSeq, peekSeq,
  saveConfigCache, loadConfigCache,
  getQuality, setQuality,
  getSavedLensId, setSavedLensId,
} from "./storage.js?v=1.9.14";
import {
  showScreen, getCurrentScreen, toast, toastSuccess, toastError, toastInfo,
  showLoading, hideLoading, setAuthIndicator, pickFromList, escapeHtml, dom,
  confirmDialog,
} from "./ui.js?v=1.9.14";
import {
  startCamera, startCameraByDeviceId, listVideoInputs, getCurrentDeviceId,
  switchCamera, stopCamera, isTorchSupported, setTorch, getZoomCapabilities, setCameraZoom,
  hasAutoFocus, enableContinuousFocus, focusAtPoint,
} from "./camera.js?v=1.9.14";
import { composePhoto, BOARD_HR, BROWH } from "./composer.js?v=1.9.14";
import { readAllConfig } from "./sheets.js?v=1.9.14";
import { getRoomFixtures, getBuildings } from "./roomFixtures.js?v=1.9.14";
import {
  uploadViaGas, pingGas,
  getGasWebAppUrl, setGasWebAppUrl, getSharedToken, setSharedToken, getGasConfigStatus,
  getDriveParentId, setDriveParentId, parseDriveFolderId, hasDriveParentOverride,
} from "./gas-uploader.js?v=1.9.14";
import {
  addPhoto, getPhoto, getPendingPhotos, countPending,
  markUploading, markUploaded, markFailed, resetStaleUploading, deletePhoto,
  autoCleanupOldUploads, isAtLimit, getObjectUrl, revokeObjectUrl, revokeAllObjectUrls,
} from "./photoStore.js?v=1.9.14";

const { $, $$ } = dom;

/* ============================================================ 固定黒板レイアウト */

const FIXED_BOARD_RECT = Object.freeze({ x: 0, y: 1, w: 0.342 });  // v1.9.11: 黒板を従来(0.38)の90%に縮小
const STAGE_BUTTONS = ["着工前", "施工状況", "完成"];
const ALWAYS_NO_BOARD = true;  // 黒板なし版を常時保存
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
  buildings:     { ...FALLBACK_BUILDINGS, ...getBuildings() },
  fixtures:      [...FALLBACK_FIXTURES],
  stages:        [...STAGE_BUTTONS],
  configSource:  "fallback",
  configCachedAt: null,

  photographer:  getPhotographer(),
  building:      getLastBuilding(),
  room:          getLastRoom(),
  fixture:       getLastFixture(),
  stage:         getLastStage(),

  quality:       resolveQuality(getQuality()),  // 画質プリセットのキー

  cameraOn:      false,
  cameraTrack:   null,
  torchSupported: false,
  torchOn:        false,

  // ズーム(メインレンズ上の値)
  zoomMode:       "digital",
  zoom:           1,
  zoomMin:        1,
  zoomMax:        4,
  zoomStep:       0.1,
  pinchStartDist: 0,
  pinchStartZoom: 1,
  pinchEndAt:     0,      // ピンチ直後のタップでピント合わせが誤作動しないよう記録

  // 横向き撮影モード
  landForced:    false,   // 「横向き」ボタンで入ったか
  landDismissed: false,   // 端末が横のまま「戻る」を押したか

  // レンズ/スライダー
  lens:          "main",   // "main" | "ultra" | "other"(手動選択の背面レンズ)
  hasUltra:      false,    // ラベルで超広角と確定できるレンズがあるか
  ultraDeviceId: "",
  mainDeviceId:  "",
  backCameras:   [],       // 背面カメラ一覧(手動レンズ切替用)
  uiZoom:        1,        // スライダー表示倍率(0.5=超広角, 1.0=標準)
  uiMin:         1,
  uiMax:         4,
  lensSwitching: false,
  lensTimer:     null,

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

  // 図面ビューアからの引き継ぎ (?b=棟&r=号室&f=記号)
  // 設定読み込みの前後で2回適用する（通信が遅くても選択が反映されるようにし、
  // 設定読み込み後は部屋の器具一覧に合わせて記号を解決し直す）
  const urlParams = new URLSearchParams(location.search);
  applyDeepLink(urlParams);

  // 設定読み込み(Sheets)
  await loadAppConfig();
  populateProjectInfo();
  renderStageButtons();
  applyDeepLink(urlParams);
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
  if (urlParams.has("gas")) {
    setTimeout(onSetGasUrl, 500);
  }

  // 撮影者が未設定なら、起動時に1回だけ聞く
  if (!state.photographer) {
    setTimeout(pickPhotographer, 400);
  }
});

/* ============================================================ 図面ビューア連携 */

// 図面ビューア(kitagata-zumen)から ?b=棟&r=号室&f=記号 で棟・部屋・照明器具を引き継ぐ
let deepLinkNotified = false;
function applyDeepLink(params) {
  const b = (params.get("b") || "").trim();
  const r = (params.get("r") || "").trim();
  const f = (params.get("f") || "").trim();
  if (!b && !r && !f) return;

  const parts = [];
  let changed = false;
  if (b) {
    if (b !== state.building) changed = true;
    state.building = b;
    setLastBuilding(b);
    parts.push(b);
  }
  if (r) {
    if (r !== state.room) changed = true;
    state.room = r;
    setLastRoom(r);
    // 設定に無い部屋なら端末側の追加分として登録しておく
    const preset = (state.buildings && state.buildings[state.building]) || [];
    const custom = (getCustomRooms()[state.building] || []);
    if (state.building && !preset.includes(r) && !custom.includes(r)) {
      addCustomRoom(state.building, r);
    }
    parts.push(r + "号室");
  }
  if (f) {
    // 部屋の器具一覧に合わせて記号を解決（例: b104-2 → 一覧に無ければ b104）
    const list = getRoomFixtures(state.building, state.room) || state.fixtures || [];
    const base = f.replace(/-[0-9a-z]$/i, "");
    const fixture = list.includes(f) ? f : (list.includes(base) ? base : f);
    if (fixture !== state.fixture) changed = true;
    state.fixture = fixture;
    setLastFixture(fixture);
    parts.push(fixture);
  }
  // 前と違う部屋・器具を引き継いだときは施工段階を「着工前」へ戻す
  if (changed) resetStageToBefore();
  refreshChips();
  renderBoard();
  if (parts.length && !deepLinkNotified) {
    deepLinkNotified = true;
    toastInfo(`図面ビューアから引き継ぎ: ${parts.join(" / ")}`);
  }
}

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
    // 部屋の一覧は roomFixtures.js(図面ビューアと同じ589部屋)を正とする。
    // 設定シートの「棟と部屋」は A2:Z までしか読めず1棟25部屋で頭打ちになるため。
    state.buildings = { ...state.buildings, ...getBuildings() };
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
      state.buildings = { ...(cached.cfg.buildings || FALLBACK_BUILDINGS), ...getBuildings() };
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

  updateQualityMenuLabel();
  updateDriveFolderMenuLabel();
}

function updateQualityMenuLabel() {
  const btn = $("#menuQuality");
  if (btn) btn.textContent = `画質を変更(現在: ${activeQuality().label})`;
}

function refreshChips() {
  setChip("Building", state.building);
  setChip("Room",     state.room);
  setChip("Fixture",  state.fixture);
  renderStageButtons();

  // 図面を開くボタン(棟と部屋を選択済みのとき表示)
  const zumenBtn = $("#btnOpenZumen");
  if (zumenBtn) {
    const ready = !!(state.building && state.room);
    zumenBtn.hidden = !ready;
    const val = $("#zumenBtnVal");
    if (val) val.textContent = ready ? `${state.building}-${state.room} の図面` : "図面を開く";
  }

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
    state.stage = "着工前";
    setLastStage(state.stage);
  }
}

function stageToneClass(stage) {
  const s = String(stage || "");
  const i = STAGE_BUTTONS.indexOf(s);
  if (i === 0) return "stage-before";
  if (i === 1) return "stage-during";
  if (i === 2) return "stage-after";
  // 旧名称(施工前/施工中/施工後)で保存済みの写真も同じ色で表示する
  if (s.includes("前")) return "stage-before";
  if (s.includes("中") || s.includes("状況")) return "stage-during";
  if (s.includes("後") || s.includes("完成")) return "stage-after";
  return "stage-other";
}

// 部屋や照明器具を前と違うものに変えたときは、施工段階を「着工前」へ戻す
// (新しい撮影対象は着工前から撮り始めるため、段階の戻し忘れを防ぐ)
function resetStageToBefore() {
  if (state.stage !== "着工前") {
    state.stage = "着工前";
    setLastStage(state.stage);
  }
}

function selectStage(v) {
  if (!STAGE_BUTTONS.includes(v)) v = "着工前";
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
  const zumenBtn = $("#btnOpenZumen"); if (zumenBtn) zumenBtn.addEventListener("click", openZumen);
  const chipStage = $("#chipStage"); if (chipStage) chipStage.addEventListener("click", pickStage);

  // 撮影
  $("#btnShoot").addEventListener("click", onShoot);
  $("#btnSwitchCamera").addEventListener("click", onSwitchCamera);
  const lightBtn = $("#btnLight"); if (lightBtn) lightBtn.addEventListener("click", onToggleLight);
  const lensBtn = $("#btnLensCycle"); if (lensBtn) lensBtn.addEventListener("click", cycleLens);
  initPinchZoom();
  initZoomSlider();
  initTapToFocus();
  initLandscapeMode();

  // 未送信
  $("#outboxCard").addEventListener("click", () => { leaveLandscapeForNav(); openOutbox(); });

  // 直前写真のやり直し
  const redoBtn = $("#btnRedoShot"); if (redoBtn) redoBtn.addEventListener("click", onRedoShot);

  // メニュー
  $("#btnMenu").addEventListener("click", () => { leaveLandscapeForNav(); openMenu(); });
  const quickMenu = $("#quickOpenMenu"); if (quickMenu) quickMenu.addEventListener("click", openMenu);
  $$("[data-close-menu]").forEach(el => el.addEventListener("click", closeMenu));
  $("#menuPhotographer").addEventListener("click", () => { closeMenu(); pickPhotographer(); });
  const qBtn = $("#menuQuality"); if (qBtn) qBtn.addEventListener("click", async () => { closeMenu(); await pickQuality(); });
  $("#menuReloadConfig").addEventListener("click", async () => { closeMenu(); await reloadAppConfig(); });
  $("#menuTestGas").addEventListener("click", async () => { closeMenu(); await onTestGas(); });
  const folderBtn = $("#menuDriveFolder");
  if (folderBtn) folderBtn.addEventListener("click", async () => { closeMenu(); await pickDriveFolder(); });
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
  // 端末回転時はレイアウト確定を待ってから黒板を再配置する
  window.addEventListener("orientationchange", () => {
    setTimeout(renderBoard, 300);
    setTimeout(renderBoard, 800);
  });
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
  url.searchParams.set("v", "1.9.14");
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
      const ver = r.version ? ` / GAS v${r.version}` : "";
      if (r.parentApplied === false) {
        // 指定した保存先が使えず、GAS側の既定フォルダに保存される状態
        toastError(`保存先「${getDriveParentId().slice(-6)}」が使えません。実際の保存先: ${r.folder}${ver}。フォルダIDと、GASを実行しているアカウントの編集権限を確認してください`, 7000);
      } else if (typeof r.parentApplied === "undefined") {
        // GAS が保存先指定に未対応(v3.3.0以前)
        toastInfo(`接続OK: ${r.folder || "Drive"}${ver} ・ 保存先指定に未対応のGASです(Code.gs を v3.4.0 に更新してください)`, 7000);
      } else {
        toastSuccess(`接続OK: 保存先「${r.folder || "Drive"}」${ver}`);
      }
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
    resetStageToBefore();
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
    const roomChanged = v !== state.room;
    if (!preset.includes(v) && !custom.includes(v)) {
      addCustomRoom(state.building, v);
    }
    state.room = v;
    setLastRoom(v);
    // 部屋ごとの器具一覧がある場合、選択中の記号がその部屋に無ければクリアする
    const roomList = getRoomFixtures(state.building, state.room);
    if (roomList && state.fixture && !roomList.includes(state.fixture)) {
      state.fixture = "";
      setLastFixture("");
    }
    if (roomChanged) resetStageToBefore();
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

async function pickFixture({ showAll = false } = {}) {
  // 部屋を選択済みなら、その部屋で使用する記号だけを表示する
  const roomList = showAll ? null : getRoomFixtures(state.building, state.room);
  const list = roomList || state.fixtures || [];
  if (list.length === 0) { toastError("照明器具が未設定"); return; }
  const v = await pickFromList({
    title: roomList ? `${state.building}-${state.room} の照明器具` : "照明器具を選ぶ",
    options: list.map(f => ({ value: f, label: f })),
    allowInput: true, inputPlaceholder: "自由入力する照明器具…",
    selectedValue: state.fixture,
    footerButton: roomList ? {
      label: "全ての記号から選ぶ",
      onClick: (close) => { close(null); pickFixture({ showAll: true }); },
    } : null,
  });
  if (v) {
    const fixtureChanged = v !== state.fixture;
    state.fixture = v;
    setLastFixture(v);
    if (fixtureChanged) resetStageToBefore();
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

async function pickDriveFolder() {
  const cur = getDriveParentId();
  const options = [];
  if (hasDriveParentOverride()) {
    options.push({
      value: "__clear__",
      label: "既定の保存先に戻す",
      sublabel: "この端末の指定を消して、アプリ既定のフォルダに戻す",
    });
  }
  const v = await pickFromList({
    title: "保存先フォルダ(DriveのURLかIDを貼り付け)",
    options,
    allowInput: true,
    inputPlaceholder: "https://drive.google.com/drive/folders/…",
  });
  if (!v) return;

  if (v === "__clear__") {
    setDriveParentId("");
    updateDriveFolderMenuLabel();
    dbg("保存先フォルダ: 初期設定(GAS側)に戻しました");
    toastInfo("保存先を初期設定に戻しました");
    await onTestGas();
    return;
  }

  const id = parseDriveFolderId(v);
  if (!id) {
    toastError("フォルダのURLまたはIDが読み取れません。Driveでフォルダを開いたときのURLを貼り付けてください");
    return;
  }
  setDriveParentId(id);
  updateDriveFolderMenuLabel();
  dbg(`保存先フォルダを設定: ${id}`);
  toastInfo("保存先フォルダを設定しました。接続を確認します…");
  await onTestGas();
}

function updateDriveFolderMenuLabel() {
  const btn = $("#menuDriveFolder");
  if (!btn) return;
  const cur = getDriveParentId();
  if (hasDriveParentOverride()) {
    btn.textContent = `保存先フォルダを設定(この端末: …${cur.slice(-6)})`;
  } else {
    btn.textContent = cur ? `保存先フォルダを設定(既定: …${cur.slice(-6)})` : "保存先フォルダを設定";
  }
}

async function pickQuality() {
  const cur = state.quality;
  const options = Object.entries(QUALITY_PRESETS).map(([k, p]) => ({
    value: k,
    label: p.label,
    sublabel: `長辺${p.maxLongSide}px / JPEG ${Math.round(p.jpeg * 100)}%${k === cur ? " ・現在" : ""}`,
  }));
  const v = await pickFromList({
    title: "画質を選ぶ(高いほど鮮明・送信は重くなります)",
    options,
    selectedValue: cur,
  });
  if (v && QUALITY_PRESETS[v] && v !== cur) {
    state.quality = v;
    setQuality(v);
    updateQualityMenuLabel();
    toastInfo(`画質を「${QUALITY_PRESETS[v].label}」に設定`);
    // 解像度の要求値を反映するためカメラを再起動
    if (state.cameraOn && getCurrentScreen() === "camera") {
      stopCameraFlow();
      await startCameraFlow();
      renderBoard();
    }
  }
}

/* ============================================================ 図面アプリ連携 */

function openZumen() {
  if (!(state.building && state.room)) {
    toastInfo("先に棟と部屋を選んでください");
    return;
  }
  // 図面アプリ(kitagata-zumen)は起動時に kzLastRoom(同一オリジンのlocalStorage)を
  // 復元してその部屋のビューアを直接開くため、開く前に選択中の棟・部屋を書き込む。
  try {
    localStorage.setItem("kzLastRoom", JSON.stringify({ b: state.building, r: state.room }));
  } catch (e) {}
  // 将来のURLパラメータ対応用に ?b=&r= も付けて開く
  const url = `${ZUMEN_APP_URL}?b=${encodeURIComponent(state.building)}&r=${encodeURIComponent(state.room)}`;
  window.open(url, "_blank", "noopener");
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

/* ============================================================ 画質 */

function resolveQuality(key) {
  return (key && QUALITY_PRESETS[key]) ? key : DEFAULT_QUALITY;
}
function activeQuality() {
  return QUALITY_PRESETS[state.quality] || QUALITY_PRESETS[DEFAULT_QUALITY];
}

/* ============================================================ Camera */

async function startCameraFlow() {
  const video = $("#videoEl");
  const q = activeQuality();
  try {
    const track = await startCamera(video, {
      facingMode: CAMERA_DEFAULTS.facing,
      width:  q.capW,
      height: q.capH,
    });
    state.cameraOn = true;
    state.cameraTrack = track;
    state.lens = "main";
    state.torchOn = false;
    updateLightButton();
    await enableContinuousFocus(track);   // 撮るたびにピントを合わせ直す
    await detectLenses(track);
    await initMainZoom(track);
    updateLensButton();
    await startWide();
    setTimeout(renderBoard, 80);
  } catch (e) {
    state.cameraOn = false;
    state.cameraTrack = null;
    state.torchOn = false;
    updateLightButton();
    updateLensButton();
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
    state.lens = "main";
    state.torchOn = false;
    updateLightButton();
    await enableContinuousFocus(track);   // 撮るたびにピントを合わせ直す
    await detectLenses(track);
    await initMainZoom(track);
    updateLensButton();
    await startWide();
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


/* ============================================================ レンズ検出・ズーム */

function resetZoomState() {
  state.zoomMode = "digital";
  state.zoom = 1;
  state.zoomMin = 1;
  state.zoomMax = 4;
  state.zoomStep = 0.1;
  state.pinchStartDist = 0;
  state.pinchStartZoom = 1;
  state.lens = "main";
  state.uiZoom = 1;
  state.uiMin = 1;
  state.uiMax = 4;
  applyZoomDisplay();
  updateZoomSlider();
  updateLensButton();
}

// 背面カメラの中からメイン/超広角レンズを推定する。
// 注意: iPhone のメインカメラは「背面広角カメラ(Back Wide Camera)」なので、
// 「広角/wide」では判定しない。「超広角/ultra」の明確な一致だけを自動採用する。
async function detectLenses(track) {
  state.hasUltra = false;
  state.ultraDeviceId = "";
  state.backCameras = [];
  state.mainDeviceId = getCurrentDeviceId() || "";
  try {
    const settings = (track && track.getSettings) ? track.getSettings() : {};
    if (!state.mainDeviceId && settings && settings.deviceId) state.mainDeviceId = settings.deviceId;

    const inputs = await listVideoInputs();
    dbg(`カメラ一覧(${inputs.length}): ` + inputs.map(d => d.label || "(名称なし)").join(" / "));
    if (settings && settings.facingMode === "user") return;  // 前面カメラ使用中は対象外
    if (!inputs || inputs.length < 2) return;

    const backs = inputs.filter(isBackCamera);
    state.backCameras = backs;

    const ultra = backs.find(d =>
      d.deviceId && d.deviceId !== state.mainDeviceId &&
      /(超広角|ultra)/i.test(d.label || "") &&
      !/(望遠|tele|depth|マクロ|macro)/i.test(d.label || ""));
    if (ultra) {
      state.hasUltra = true;
      state.ultraDeviceId = ultra.deviceId;
      dbg(`超広角レンズ検出: ${ultra.label}`);
    }
  } catch (e) {
    dbg(`レンズ検出エラー: ${e.message || e}`);
  }
}

function isBackCamera(d) {
  try {
    const caps = d.getCapabilities ? d.getCapabilities() : null;
    if (caps && Array.isArray(caps.facingMode) && caps.facingMode.length > 0) {
      return caps.facingMode.includes("environment");
    }
  } catch (e) {}
  const l = d.label || "";
  return !/(front|前面|フロント|face|user|self|内側)/i.test(l);
}

async function initMainZoom(track) {
  const caps = getZoomCapabilities(track);
  if (caps && caps.max > caps.min) {
    state.zoomMode = "hardware";
    state.zoomMin = caps.min;
    state.zoomMax = Math.min(caps.max, Math.max(caps.min, 8));
    state.zoomStep = caps.step || 0.1;
    state.zoom = caps.min;  // 最初から最広角(ハードウェア最小)で開始
    await setCameraZoom(track, state.zoom);
  } else {
    state.zoomMode = "digital";
    state.zoomMin = 1;
    state.zoomMax = 4;
    state.zoomStep = 0.05;
    state.zoom = 1;
  }
  // スライダー範囲: 超広角があれば 0.5× まで、無ければメインレンズの最小まで
  state.uiMin = state.hasUltra ? Math.min(0.5, state.zoomMin) : state.zoomMin;
  state.uiMax = state.zoomMax;
  state.uiZoom = state.uiMin;  // スライダーも最広角側から
  applyZoomDisplay();
  updateZoomSlider();
}

// 最初から広角:
// 1) 以前手動で選んだレンズがあればそれを復元(次回から自動)
// 2) なければ、超広角レンズを確実に検出できた場合のみ超広角へ切替
// (ハードウェアズームで広角化できる端末は initMainZoom の時点で最広角済み)
async function startWide() {
  const saved = getSavedLensId();
  if (saved && saved !== state.mainDeviceId && (state.backCameras || []).some(d => d.deviceId === saved)) {
    if (state.hasUltra && state.ultraDeviceId === saved) {
      state.uiZoom = state.uiMin;
      await switchLens("ultra");
    } else {
      await activateLensDevice(saved);
    }
    return;
  }
  if (state.hasUltra && state.ultraDeviceId && state.uiMin < 1 - 1e-3) {
    state.uiZoom = state.uiMin;
    await switchLens("ultra");
  }
}

// レンズ切替後のメインズーム再初期化(uiレンジは維持)
function initMainZoomCaps(track) {
  const caps = getZoomCapabilities(track);
  if (caps && caps.max > caps.min) {
    state.zoomMode = "hardware";
    state.zoomMin = caps.min;
    state.zoomMax = Math.min(caps.max, Math.max(caps.min, 8));
    state.zoomStep = caps.step || 0.1;
  } else {
    state.zoomMode = "digital";
    state.zoomMin = 1;
    state.zoomMax = 4;
    state.zoomStep = 0.05;
  }
  state.uiMax = Math.max(state.uiMax, state.zoomMax);
}

/* --- ズームスライダー --- */

function initZoomSlider() {
  const slider = $("#zoomSlider");
  if (!slider) return;
  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    if (Number.isFinite(v)) onZoomSlider(v);
  });
}

function onZoomSlider(v) {
  v = clampNum(v, state.uiMin, state.uiMax);
  state.uiZoom = v;
  // 手動選択レンズの上ではそのレンズのズームを直接操作する
  if (state.lens === "other") {
    setZoom(v);
    return;
  }
  // メインレンズ自身が1×未満まで対応する端末では、レンズ切替せずハードウェアで広角化
  const wantUltra = state.hasUltra && v < Math.min(1, state.zoomMin) - 1e-3;
  if (!wantUltra && state.lens === "main") {
    setZoom(v);
  } else {
    updateZoomBadge();
  }
  scheduleLensReconcile();
}

function scheduleLensReconcile() {
  if (state.lensTimer) clearTimeout(state.lensTimer);
  state.lensTimer = setTimeout(reconcileLens, 200);
}

async function reconcileLens() {
  if (state.lensSwitching || !state.cameraOn) return;
  if (state.lens === "other") return;  // 手動選択中は自動切替しない
  const v = state.uiZoom;
  const wantUltra = state.hasUltra && v < Math.min(1, state.zoomMin) - 1e-3;
  if (wantUltra && state.lens !== "ultra") {
    await switchLens("ultra");
  } else if (!wantUltra && state.lens !== "main") {
    await switchLens("main");
    await setZoom(Math.max(state.zoomMin, v));
  }
}

/* --- 手動レンズ切替(超広角が自動検出できない端末向け) --- */

async function cycleLens() {
  if (!state.cameraOn || state.lensSwitching) return;
  const backs = state.backCameras || [];
  if (backs.length < 2) {
    toastInfo("この端末で切替できる背面レンズが見つかりません");
    return;
  }
  const curId = getCurrentDeviceId() || state.mainDeviceId;
  const idx = backs.findIndex(d => d.deviceId === curId);
  const next = backs[(idx + 1) % backs.length];
  if (!next || next.deviceId === curId) return;
  await activateLensDevice(next.deviceId, { announce: true });
}

async function activateLensDevice(deviceId, { announce = false } = {}) {
  if (state.lensSwitching) return;
  state.lensSwitching = true;
  const video = $("#videoEl");
  const q = activeQuality();
  try {
    if (state.torchOn && state.cameraTrack) { try { await setTorch(state.cameraTrack, false); } catch (e) {} }
    const track = await startCameraByDeviceId(video, deviceId, { width: q.capW, height: q.capH });
    state.cameraTrack = track;
    state.torchOn = false;
    updateLightButton();
    await enableContinuousFocus(track);

    const isMain  = deviceId === state.mainDeviceId;
    const isUltra = state.hasUltra && deviceId === state.ultraDeviceId;
    state.lens = isMain ? "main" : (isUltra ? "ultra" : "other");

    if (state.lens === "ultra") {
      state.zoomMode = "ultra";
      state.zoom = 1;
      state.uiMin = Math.min(0.5, state.zoomMin);
      state.uiZoom = state.uiMin;
    } else {
      initMainZoomCaps(track);
      state.zoom = state.zoomMin;
      if (state.zoomMode === "hardware") await setCameraZoom(track, state.zoom);
      state.uiMin = (state.lens === "main" && state.hasUltra) ? Math.min(0.5, state.zoomMin) : state.zoomMin;
      state.uiMax = state.zoomMax;
      state.uiZoom = clampNum(state.zoom, state.uiMin, state.uiMax);
    }

    // メイン以外を選んだら記憶して次回からそのレンズで起動。メインに戻したら解除。
    setSavedLensId(isMain ? "" : deviceId);
    if (announce) {
      const backs = state.backCameras || [];
      const i = backs.findIndex(d => d.deviceId === deviceId);
      const name = isMain ? "標準カメラ" : (isUltra ? "超広角カメラ" : `レンズ${i >= 0 ? i + 1 : "?"}`);
      toastInfo(isMain ? `${name}(次回から標準で起動)` : `${name}に切替。次回からこのレンズで起動します`);
    }

    applyZoomDisplay();
    updateZoomSlider();
    updateLensButton();
    setTimeout(renderBoard, 80);
    dbg(`手動レンズ切替: ${state.lens} (${deviceId.slice(0, 8)}…)`);
  } catch (e) {
    dbg(`手動レンズ切替失敗: ${e.message || e}`);
    toastError("このレンズには切り替えできませんでした");
    try {
      const track = await startCamera(video, { facingMode: CAMERA_DEFAULTS.facing, width: q.capW, height: q.capH });
      state.cameraTrack = track;
      state.lens = "main";
      initMainZoomCaps(track);
      state.uiZoom = clampNum(state.zoom, state.uiMin, state.uiMax);
      applyZoomDisplay();
      updateZoomSlider();
    } catch (e2) {}
  } finally {
    state.lensSwitching = false;
  }
}

function updateLensButton() {
  const btn = $("#btnLensCycle");
  if (!btn) return;
  btn.hidden = !(state.cameraOn && (state.backCameras || []).length >= 2);
}

async function switchLens(target) {
  if (state.lensSwitching) return;
  const deviceId = target === "ultra" ? state.ultraDeviceId : state.mainDeviceId;
  if (target === "ultra" && !deviceId) return;
  state.lensSwitching = true;
  const video = $("#videoEl");
  const q = activeQuality();
  try {
    if (state.torchOn && state.cameraTrack) { try { await setTorch(state.cameraTrack, false); } catch (e) {} }
    let track;
    if (deviceId) {
      track = await startCameraByDeviceId(video, deviceId, { width: q.capW, height: q.capH });
    } else {
      track = await startCamera(video, { facingMode: CAMERA_DEFAULTS.facing, width: q.capW, height: q.capH });
    }
    state.cameraTrack = track;
    state.lens = target;
    state.torchOn = false;
    updateLightButton();
    await enableContinuousFocus(track);
    if (target === "ultra") {
      state.zoomMode = "ultra";   // 追加ズームなし。超広角の画角をそのまま使う
      state.zoom = 1;
    } else {
      initMainZoomCaps(track);
    }
    applyZoomDisplay();
    updateZoomSlider();
    setTimeout(renderBoard, 80);
    dbg(`レンズ切替: ${target}`);
  } catch (e) {
    dbg(`レンズ切替失敗(${target}): ${e.message || e}`);
    if (target === "ultra") {
      // 超広角が使えないと分かったので以後は無効化し、メインへ戻す
      state.hasUltra = false;
      state.uiMin = state.zoomMin;
      state.uiZoom = Math.max(1, state.uiZoom);
      state.lensSwitching = false;
      try { await switchLens("main"); } catch (e2) {}
      updateZoomSlider();
      toastInfo("この端末では超広角に切り替えできませんでした");
      return;
    }
  } finally {
    state.lensSwitching = false;
  }
}

/* ============================================================ 横向き撮影モード

   「横向き」ボタン、または端末を横に倒したときに、カメラを画面いっぱいに
   広げてシャッターと戻るボタンだけを右中央に出す。
   端末が対応していれば画面を横向きに固定する(Android Chrome など)。
   非対応(iPhone)の場合はレイアウトだけ切り替え、回すよう案内する。
============================================================ */

const LAND_MQ = window.matchMedia("(orientation: landscape) and (max-height: 600px)");

// カメラ画面以外へ移るときは横向きモードを解除する
function leaveLandscapeForNav() {
  if (landscapeModeOn()) exitLandscapeMode();
}

function initLandscapeMode() {
  const btn = $("#btnLandscape");
  if (btn) btn.addEventListener("click", toggleLandscapeMode);
  const back = $("#btnLandExit");
  if (back) back.addEventListener("click", exitLandscapeMode);

  // 端末を回したときの自動切り替え
  const onMq = () => { state.landDismissed = false; syncLandscapeMode(); };
  if (LAND_MQ.addEventListener) LAND_MQ.addEventListener("change", onMq);
  else if (LAND_MQ.addListener) LAND_MQ.addListener(onMq);

  // システム操作で全画面を抜けたら横向きモードも解除する
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && state.landForced) {
      state.landForced = false;
      unlockOrientation();
      syncLandscapeMode();
    }
  });

  syncLandscapeMode();
}

function landscapeModeOn() {
  return state.landForced || (LAND_MQ.matches && !state.landDismissed);
}

function syncLandscapeMode() {
  const on = landscapeModeOn();
  document.body.classList.toggle("cam-land", on);
  const btn = $("#btnLandscape");
  if (btn) {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const back = $("#btnLandExit");
  if (back) back.hidden = !on;
  // レイアウト確定後に黒板を置き直す
  setTimeout(renderBoard, 60);
  setTimeout(renderBoard, 350);
}

function toggleLandscapeMode() {
  if (landscapeModeOn()) exitLandscapeMode();
  else enterLandscapeMode();
}

async function enterLandscapeMode() {
  state.landForced = true;
  state.landDismissed = false;
  syncLandscapeMode();

  // 全画面 → 横向き固定(できる端末だけ)
  let locked = false;
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: "hide" });
    }
  } catch (e) { /* 非対応でもレイアウトは切り替わる */ }
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
      locked = true;
    }
  } catch (e) { /* iPhone など非対応 */ }

  if (!locked && !LAND_MQ.matches) {
    toastInfo("端末を横に回してください（この端末は自動で横向きにできません）");
  }
  syncLandscapeMode();
}

function exitLandscapeMode() {
  state.landForced = false;
  // 端末を横に持ったままでも戻れるようにする(縦に戻すと自動でまた横向きに入る)
  if (LAND_MQ.matches) state.landDismissed = true;
  unlockOrientation();
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
  } catch (e) { /* noop */ }
  syncLandscapeMode();
}

function unlockOrientation() {
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch (e) { /* noop */ }
}

function initPinchZoom() {
  const wrap = $("#bcamWrap");
  if (!wrap) return;

  wrap.addEventListener("touchstart", (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest("button, input")) return;
    if (ev.touches.length === 2) {
      state.pinchStartDist = touchDistance(ev.touches[0], ev.touches[1]);
      state.pinchStartZoom = state.uiZoom;
    }
  }, { passive: true });

  wrap.addEventListener("touchmove", (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest("button, input")) return;
    if (ev.touches.length === 2 && state.pinchStartDist > 0) {
      ev.preventDefault();
      const d = touchDistance(ev.touches[0], ev.touches[1]);
      const ratio = d / state.pinchStartDist;
      onZoomSlider(state.pinchStartZoom * ratio);
      updateZoomSlider();
    }
  }, { passive: false });

  wrap.addEventListener("touchend", (ev) => {
    if (ev.touches.length < 2) {
      if (state.pinchStartDist > 0) state.pinchEndAt = Date.now();
      state.pinchStartDist = 0;
      state.pinchStartZoom = state.uiZoom;
    }
  }, { passive: true });

  // 2本指の操作中に出るブラウザ既定の拡大を止める
  wrap.addEventListener("gesturestart", (ev) => ev.preventDefault());
  wrap.addEventListener("gesturechange", (ev) => ev.preventDefault());
}

function touchDistance(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

async function setZoom(rawZoom) {
  const stepped = Math.round(rawZoom / state.zoomStep) * state.zoomStep;
  const z = clampNum(stepped, state.zoomMin, state.zoomMax);
  state.zoom = z;
  if (state.zoomMode === "hardware" && state.cameraTrack) {
    const ok = await setCameraZoom(state.cameraTrack, z);
    if (!ok) {
      state.zoomMode = "digital";
      state.zoomMin = 1;
      state.zoomMax = 4;
      state.zoom = clampNum(z, 1, 4);
    }
  }
  applyZoomDisplay();
}

function applyZoomDisplay() {
  const video = $("#videoEl");
  if (video) {
    if (state.lens === "main" && state.zoomMode === "digital" && state.zoom > 1.001) {
      video.style.transform = `scale(${state.zoom})`;
    } else {
      video.style.transform = "";
    }
  }
  updateZoomBadge();
}

function updateZoomBadge() {
  const badge = $("#zoomBadge");
  if (!badge) return;
  badge.hidden = !state.cameraOn;
  if (state.lens === "other") {
    // 名前の分からないレンズは倍率を偽らず「レンズn」と表示する
    const backs = state.backCameras || [];
    const curId = getCurrentDeviceId();
    const i = backs.findIndex(d => d.deviceId === curId);
    const zoomPart = state.zoom > state.zoomMin + 0.01 ? ` ${formatZoom(state.zoom)}×` : "";
    badge.textContent = `レンズ${i >= 0 ? i + 1 : "?"}${zoomPart}`;
  } else {
    badge.textContent = `${formatZoom(state.uiZoom)}×`;
  }
}

function updateZoomSlider() {
  const slider = $("#zoomSlider");
  if (!slider) return;
  slider.min = String(state.uiMin);
  slider.max = String(state.uiMax);
  slider.step = "0.1";
  slider.value = String(state.uiZoom);
  slider.hidden = !state.cameraOn;
  const wrap = $("#zoomSliderWrap");
  if (wrap) wrap.hidden = !state.cameraOn;
  updateZoomBadge();
}

function formatZoom(v) {
  return (Math.round(v * 10) / 10).toFixed(1);
}

function clampNum(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/* ============================================================ ピント(オートフォーカス・ブレ判定) */

// 映像の鮮鋭度(ピントの合い具合)を数値化する。
// 縮小したグレースケール画像の隣接画素差(ラプラシアン相当)の分散を使う。
// 値が大きいほどくっきり、小さいほどピンボケ・ブレ。
const sharpCanvas = document.createElement("canvas");
const SHARP_W = 240;

function measureSharpness(source) {
  try {
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    if (!sw || !sh) return -1;
    const w = SHARP_W;
    const h = Math.max(1, Math.round(sh * (w / sw)));
    sharpCanvas.width = w;
    sharpCanvas.height = h;
    const ctx = sharpCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    // グレースケール化
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      g[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }
    // ラプラシアン(4近傍)の分散
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const lap = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - w] - g[p + w];
        sum += lap; sum2 += lap * lap; n++;
      }
    }
    if (n === 0) return -1;
    const mean = sum / n;
    return (sum2 / n) - (mean * mean);
  } catch (e) {
    return -1;
  }
}

// 撮影直前に、ピントが落ち着くまで少しだけ待つ。
// 鮮鋭度を数回測り、上がり続けている間は待ち、頭打ちになったら撮る。
async function waitForFocus(video, maxWaitMs = 700) {
  const start = Date.now();
  let best = -1;
  let stable = 0;
  while (Date.now() - start < maxWaitMs) {
    const score = measureSharpness(video);
    if (score < 0) break;
    if (score > best * 1.06) {
      best = Math.max(best, score);
      stable = 0;
    } else {
      best = Math.max(best, score);
      stable++;
      if (stable >= 2) break;   // 2回続けて改善しなければ合焦とみなす
    }
    await sleep(80);
  }
  return best;
}

// ピンボケ判定のしきい値(縮小画像のラプラシアン分散)。
// 小さすぎる値のみ警告し、暗所などでの誤警告を避けるため控えめに設定。
const BLUR_WARN_THRESHOLD = 12;

function warnIfBlurry(score) {
  if (score < 0 || score >= BLUR_WARN_THRESHOLD) return false;
  const noAf = !(state.cameraTrack && hasAutoFocus(state.cameraTrack));
  const extra = noAf ? "（このレンズはピント固定です。右上の 0.5× でレンズを切り替えるか、少し離れて撮ってください）" : "（画面をタップするとピントを合わせられます）";
  toastError("ピンボケの可能性があります。やり直しで撮り直せます" + extra, 5000);
  dbg(`ピンボケ警告: 鮮鋭度 ${score.toFixed(1)} < ${BLUR_WARN_THRESHOLD}`);
  return true;
}

// プレビューのタップでその位置にピントを合わせる
function initTapToFocus() {
  const wrap = $("#bcamWrap");
  if (!wrap) return;
  wrap.addEventListener("click", async (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest("button, input")) return;
    if (!state.cameraOn || !state.cameraTrack) return;
    // ピンチで指を離した直後のタップはピント合わせにしない
    if (Date.now() - state.pinchEndAt < 500) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    showFocusRing(ev.clientX - rect.left, ev.clientY - rect.top);
    const ok = await focusAtPoint(state.cameraTrack, x, y);
    if (!ok && !hasAutoFocus(state.cameraTrack)) {
      toastInfo("このレンズはピント固定です（タップでの調整はできません）");
    }
  });
}

let focusRingTimer = null;
function showFocusRing(x, y) {
  const wrap = $("#bcamWrap");
  if (!wrap) return;
  let ring = $("#focusRing");
  if (!ring) {
    ring = document.createElement("div");
    ring.id = "focusRing";
    ring.className = "focus-ring";
    wrap.appendChild(ring);
  }
  ring.style.left = x + "px";
  ring.style.top  = y + "px";
  ring.classList.remove("show");
  void ring.offsetWidth;   // アニメーション再生のためリフロー
  ring.classList.add("show");
  if (focusRingTimer) clearTimeout(focusRingTimer);
  focusRingTimer = setTimeout(() => ring.classList.remove("show"), 900);
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

  ov.innerHTML =
    `<div class="bov-row" style="height:${pct(BROWH.a)}"><div class="bov-lb"><span class="bv-l">工事名</span></div><div class="bov-vl"><span class="bv-t" data-k="a">${esc(projName)}</span></div></div>` +
    `<div class="bov-row" style="height:${pct(BROWH.b)}"><div class="bov-lb"><span class="bv-l">場所</span></div><div class="bov-vl"><span class="bv-t" data-k="b">${esc(place)}</span></div></div>` +
    `<div class="bov-lf"  style="height:${pct(BROWH.c)}"><span class="bv-t" data-k="c">${esc(fixture)}</span></div>` +
    `<div class="bov-stage" style="height:${pct(BROWH.d)}"><span class="bv-t" data-k="d">${esc(stage)}</span></div>` +
    `<div class="bov-co"    style="height:${pct(BROWH.e)}"><span class="bv-t" data-k="e">${esc(company)}</span></div>`;
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
  // プレビュー表示のみの調整: 横向き全画面など画面が低い場合に
  // 黒板が視野を覆いすぎないよう、表示高さを画面の45%までに抑える。
  // (保存されるJPEGの黒板サイズは composer 側で決まるため変わらない)
  if (bh > H * 0.45) {
    bh = H * 0.45;
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
  setRowFont(ov, ".bv-t[data-k='d']", "d", BROWH.d, 0.61, bw); // 施工段階は中央(v1.9.11: 少し小さく)
  setRowFont(ov, ".bv-t[data-k='e']", "e", BROWH.e, 0.42, bw); // 会社名は小さめ

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

    // ピントが落ち着くまで少しだけ待ってから撮る(ピンボケ対策)
    btn.textContent = "ピント合わせ中…";
    const focusScore = await waitForFocus(video);
    btn.textContent = "保存中…";

    const shotDate = todayYmd();
    const labels = { a: "工事名", b: "場所" };
    const values = {
      a: state.project.name || "",
      b: `${state.building}-${state.room}`,
      c: state.fixture || "",
      d: state.stage || "",
      e: state.project.company || "",
    };

    const q = activeQuality();
    const result = await composePhoto(source, {
      boardRect:   FIXED_BOARD_RECT,
      labels, values,
      jpegQuality: q.jpeg,
      cropToRatio: true,
      alsoNoBoard: ALWAYS_NO_BOARD,
      maxLongSide: q.maxLongSide,
      digitalZoom: (state.lens === "main" && state.zoomMode === "digital") ? state.zoom : 1,
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

    dbg(`端末保存完了: ${savedIds.length}枚 ${fileNameMain} 鮮鋭度=${focusScore.toFixed(1)}`);
    toastSuccess(`端末に保存。Drive送信は裏で実行中: ${fileNameMain}`);
    warnIfBlurry(focusScore);

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

let warnedUsedDefault = false;   // 既定フォルダ退避の警告は1回だけ出す

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

  dbg(`保存先フォルダ: ${getDriveParentId() || "(GAS既定)"}`);
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
    if (result.usedDefault) {
      // 指定の保存先に書き込めず、GAS側の既定フォルダに保存された
      dbg("⚠ 指定の保存先に書き込めないため、GAS既定フォルダへ保存しました");
      if (!warnedUsedDefault) {
        warnedUsedDefault = true;
        toastError("指定の保存先に書き込めないため、元のフォルダに保存しています。フォルダの編集権限を確認してください", 7000);
      }
    }
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
    allBtn.textContent = "すべて Drive に送信";   // 枚数表示を残さない
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
