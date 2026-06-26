// js/app.js
// 北方カメラ v1.6.7 - 直接カメラ画面、固定黒板、チップで選択

import {
  APP_VERSION,
  GAS_WEB_APP_URL,
  SHEETS_ID,
  FALLBACK_PROJECT, FALLBACK_BUILDINGS, FALLBACK_FIXTURES, FALLBACK_STAGES,
  FILENAME_TEMPLATE, JPEG_QUALITY, CAMERA_DEFAULTS, INVALID_FILENAME_CHARS,
  PENDING_LIMIT, PENDING_WARN, AUTO_CLEANUP_DAYS,
} from "./config.js?v=1.6.7";
import {
  getPhotographer, setPhotographer, getKnownPhotographers, removeKnownPhotographer,
  getCustomRooms, addCustomRoom, removeCustomRoom,
  getLastBuilding, setLastBuilding, getLastRoom, setLastRoom,
  getLastFixture, setLastFixture, getLastStage, setLastStage,
  nextSeq, rollbackSeq, peekSeq,
  saveConfigCache, loadConfigCache,
} from "./storage.js?v=1.6.7";
import {
  showScreen, getCurrentScreen, toast, toastSuccess, toastError, toastInfo,
  showLoading, hideLoading, setAuthIndicator, pickFromList, escapeHtml, dom,
  confirmDialog,
} from "./ui.js?v=1.6.7";
import { startCamera, switchCamera, stopCamera } from "./camera.js?v=1.6.7";
import { composePhoto, BOARD_HR, BROWH } from "./composer.js?v=1.6.7";
import { readAllConfig } from "./sheets.js?v=1.6.7";
import {
  uploadViaGas, pingGas,
  getGasWebAppUrl, setGasWebAppUrl, getSharedToken, setSharedToken, getGasConfigStatus,
} from "./gas-uploader.js?v=1.6.7";
import {
  addPhoto, getPhoto, getPendingPhotos, countPending,
  markUploading, markUploaded, markFailed, resetStaleUploading, deletePhoto,
  autoCleanupOldUploads, isAtLimit, getObjectUrl, revokeAllObjectUrls,
} from "./photoStore.js?v=1.6.7";

const { $, $$ } = dom;

/* ============================================================ 固定黒板レイアウト */

const FIXED_BOARD_RECT = Object.freeze({ x: 0, y: 1, w: 0.38 });
const ALWAYS_NO_BOARD = true;  // 黒板なし版を常時保存
const FAST_PHOTO_MAX_LONG_SIDE = 1280;  // v1.6.7: 送信高速化
const BATCH_PAUSE_MS_MOBILE = 900;      // v1.6.7: スマホ連続送信の安定化
const BATCH_PAUSE_MS_PC = 250;

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
  stages:        [...FALLBACK_STAGES],
  configSource:  "fallback",
  configCachedAt: null,

  photographer:  getPhotographer(),
  building:      getLastBuilding(),
  room:          getLastRoom(),
  fixture:       getLastFixture(),
  stage:         getLastStage(),

  cameraOn:      false,
  cameraTrack:   null,

  uploading:     false,
  cancelBatch:   false,
  gasReady:      false,
};

window.addEventListener("DOMContentLoaded", async () => {
  initEvents();

  autoCleanupOldUploads(AUTO_CLEANUP_DAYS).catch(e => console.warn(e));

  // 設定読み込み(Sheets)
  await loadAppConfig();
  populateProjectInfo();
  refreshChips();
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
    if (Array.isArray(cfg.stages)   && cfg.stages.length > 0)   state.stages   = cfg.stages;
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
      state.stages    = cached.cfg.stages    || FALLBACK_STAGES;
      state.configSource = "cache";
      state.configCachedAt = cached.cachedAt;
      if (forceFresh) toastError(`Sheets 失敗(キャッシュを使用): ${e.message}`);
    } else {
      state.configSource = "fallback";
      if (forceFresh) toastError(`Sheets 失敗: ${e.message}`);
    }
  } finally {
    if (forceFresh) hideLoading();
  }
}

async function reloadAppConfig() {
  await loadAppConfig({ forceFresh: true });
  populateProjectInfo();
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
  setChip("Stage",    state.stage);

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
  $("#chipStage").addEventListener("click", pickStage);

  // 撮影
  $("#btnShoot").addEventListener("click", onShoot);
  $("#btnSwitchCamera").addEventListener("click", onSwitchCamera);

  // 未送信
  $("#outboxCard").addEventListener("click", openOutbox);

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
  url.searchParams.set("v", "1.6.7");
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
  if (!state.stages || state.stages.length === 0) { toastError("施工段階が未設定"); return; }
  const v = await pickFromList({
    title: "施工段階を選ぶ",
    options: state.stages.map(s => ({ value: s, label: s })),
    allowInput: true, inputPlaceholder: "自由入力する施工段階…",
    selectedValue: state.stage,
  });
  if (v) {
    state.stage = v;
    setLastStage(v);
    refreshChips();
    renderBoard();
  }
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
    setTimeout(renderBoard, 80);
  } catch (e) {
    state.cameraOn = false;
    state.cameraTrack = null;
    toastError(e.message);
  }
}

function stopCameraFlow() {
  stopCamera();
  const video = $("#videoEl");
  if (video) video.srcObject = null;
  state.cameraOn = false;
  state.cameraTrack = null;
}

async function onSwitchCamera() {
  if (!state.cameraOn) return;
  try {
    const track = await switchCamera($("#videoEl"));
    state.cameraTrack = track;
    setTimeout(renderBoard, 80);
  } catch (e) { toastError(e.message); }
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
    `<div class="bov-lf"  style="height:${pct(BROWH.d)}"><span class="bv-t" data-k="d">${esc(stage)}</span></div>` +
    `<div class="bov-co"  style="height:${pct(BROWH.e)}"><span class="bv-t" data-k="e">${esc(company)}</span></div>`;
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
  setRowFont(ov, ".bv-t[data-k='a']", "a", BROWH.a, 0.6, bw);
  setRowFont(ov, ".bv-t[data-k='b']", "b", BROWH.b, 0.6, bw);
  setRowFont(ov, ".bv-t[data-k='c']", "c", BROWH.c, 0.5, bw);  // 少し小さく
  setRowFont(ov, ".bv-t[data-k='d']", "d", BROWH.d, 0.5, bw);
  setRowFont(ov, ".bv-t[data-k='e']", "e", BROWH.e, 0.62, bw); // 大きめ

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
  if (state.uploading) { toastInfo("処理中です…"); return; }

  if (await isAtLimit(PENDING_LIMIT)) {
    toastError(`未送信が ${PENDING_LIMIT} 枚に達しています。`);
    return;
  }

  state.uploading = true;
  const btn = $("#btnShoot");
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "処理中…";
  dbg("=== 撮影開始 ===");

  try {
    const video = $("#videoEl");
    const source = video;

    const labels = { a: "工事名", b: "場所" };
    const values = {
      a: state.project.name || "",
      b: `${state.building}-${state.room}`,
      c: state.fixture || "",
      d: state.stage || "",
      e: state.project.company || "",
    };

    const result = await composePhoto(source, {
      boardRect:   FIXED_BOARD_RECT,
      labels, values,
      jpegQuality: JPEG_QUALITY || 0.76,
      cropToRatio: true,
      alsoNoBoard: ALWAYS_NO_BOARD,
      maxLongSide: FAST_PHOTO_MAX_LONG_SIDE,
    });

    shutterSound();

    const board = {
      building:     state.building,
      room:         state.room,
      fixture:      state.fixture,
      stage:        state.stage,
      photographer: state.photographer,
      date:         todayYmd(),
      project:      state.project,
      boardValues:  values,
    };
    const roomKey = makeRoomKey(board.building, board.room);
    board.seq = nextSeq(roomKey, board.date);

    const fileNameMain = buildFilename(FILENAME_TEMPLATE, board);
    const fileNameNB   = fileNameMain.replace(/\.jpe?g$/i, "_nb.jpg");

    // IndexedDB に2枚保存
    const photoIdMain = await addPhoto({
      blob: result.withBoard.blob, board, fileName: fileNameMain, roomKey,
    });
    let photoIdNB = null;
    if (result.noBoard) {
      photoIdNB = await addPhoto({
        blob: result.noBoard.blob,
        board: { ...board, isNoBoard: true },
        fileName: fileNameNB,
        roomKey,
      });
    }

    // GAS に送信
    try {
      btn.textContent = "送信中… (1/2)";
      await uploadOne(photoIdMain);
      if (photoIdNB) {
        btn.textContent = "送信中… (2/2)";
        await uploadOne(photoIdNB);
      }
      toastSuccess(`Drive に保存 (黒板あり+なし 2枚): ${fileNameMain}`);
    } catch (e) {
      toastError(`送信失敗(未送信として保持): ${e.message}`);
    }

    // 次の連番ヒント更新
    refreshChips();
  } catch (e) {
    console.error(e);
    toastError("撮影失敗: " + e.message);
  } finally {
    state.uploading = false;
    btn.disabled = false;
    btn.textContent = origText;
    refreshOutboxCard();
  }
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

/* ============================================================ Outbox */

async function openOutbox() {
  // v1.6.7: スマホの連続送信中にカメラがメモリを使い続けないよう停止
  stopCameraFlow();
  showScreen("outbox");
  await resetStaleUploading(90 * 1000);
  await renderOutbox();
}

async function renderOutbox() {
  await resetStaleUploading(90 * 1000);
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
        await renderOutbox();
        await refreshOutboxCard();
      } catch (err) { toastError("削除失敗: " + err.message); }
    });
  });
}

async function uploadAllPending() {
  if (state.uploading) { toastInfo("送信処理中です…"); return; }

  await resetStaleUploading(30 * 1000);
  const list = await getPendingPhotos();
  if (list.length === 0) { toastInfo("未送信なし"); return; }

  // v1.6.7: スマホではカメラを止めてから送信すると、1枚目以降で止まりにくい
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
