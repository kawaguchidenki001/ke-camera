// js/app.js
// 北方カメラ v1.5.0 - GAS Web App 経由(ログイン不要)

import {
  APP_VERSION,
  GAS_WEB_APP_URL,
  SHEETS_ID,
  FALLBACK_PROJECT, FALLBACK_BUILDINGS, FALLBACK_FIXTURES, FALLBACK_STAGES,
  FILENAME_TEMPLATE, JPEG_QUALITY, CAMERA_DEFAULTS, INVALID_FILENAME_CHARS,
  PENDING_LIMIT, PENDING_WARN, AUTO_CLEANUP_DAYS,
} from "./config.js";
import {
  getPhotographer, setPhotographer, getKnownPhotographers, removeKnownPhotographer,
  getCustomRooms, addCustomRoom, removeCustomRoom,
  getLastBuilding, setLastBuilding, getLastRoom, setLastRoom,
  getLastFixture, setLastFixture, getLastStage, setLastStage,
  nextSeq, rollbackSeq, peekSeq,
  saveConfigCache, loadConfigCache,
  loadBoardRect, saveBoardRect, loadBoardScale, saveBoardScale,
  loadNoBoardFlag, saveNoBoardFlag,
} from "./storage.js";
import {
  showScreen, toast, toastSuccess, toastError, toastInfo,
  showLoading, hideLoading, setAuthIndicator, pickFromList, escapeHtml, dom,
  confirmDialog,
} from "./ui.js";
import { startCamera, switchCamera, stopCamera } from "./camera.js";
import { composePhoto, BOARD_HR, BROWH } from "./composer.js";
import { readAllConfig } from "./sheets.js";
import { uploadViaGas, pingGas } from "./gas-uploader.js";
import {
  addPhoto, getPhoto, getPendingPhotos, countPending,
  markUploading, markUploaded, markFailed, deletePhoto,
  autoCleanupOldUploads, isAtLimit, getObjectUrl, revokeAllObjectUrls,
} from "./photoStore.js";

const { $, $$ } = dom;

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
  boardRect:     loadBoardRect(),
  boardScale:    loadBoardScale(),
  noBoard:       loadNoBoardFlag(),

  uploading:     false,
  cancelBatch:   false,
  gasReady:      false,
};

window.addEventListener("DOMContentLoaded", async () => {
  initEvents();

  autoCleanupOldUploads(AUTO_CLEANUP_DAYS).catch(e => console.warn(e));

  await loadAppConfig();
  populateProjectInfo();
  refreshHomeCards();
  await refreshOutboxCard();

  initBoardUI();

  // GAS 疎通確認(非同期、結果はインジケータに反映)
  testGasConnection();

  // スプラッシュ画面(初回 or 撮影者未設定時)
  showScreen("splash");
});

/* ============================================================ GAS 疎通 */

async function testGasConnection() {
  if (!GAS_WEB_APP_URL) {
    setAuthIndicator(false);
    console.warn("GAS_WEB_APP_URL が未設定です");
    return;
  }
  try {
    const r = await pingGas();
    if (r && r.ok) {
      state.gasReady = true;
      setAuthIndicator(true);
      console.log("GAS 接続 OK:", r);
    } else {
      state.gasReady = false;
      setAuthIndicator(false);
      console.warn("GAS 応答エラー:", r);
    }
  } catch (e) {
    state.gasReady = false;
    setAuthIndicator(false);
    console.warn("GAS 接続失敗:", e);
  }
}

/* ============================================================ 設定読み込み */

async function loadAppConfig({ forceFresh = false } = {}) {
  if (!SHEETS_ID) {
    console.warn("SHEETS_ID 未設定");
    return;
  }
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
    console.warn("Sheets 読み込み失敗:", e);
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
  refreshHomeCards();
}

/* ============================================================ 表示 */

function populateProjectInfo() {
  $("#projName").textContent     = state.project.name     || "(工事名未設定)";
  $("#projNumber").textContent   = state.project.number   || "";
  $("#projLocation").textContent = state.project.location || "";
  $("#projCompany").textContent  = state.project.company  || "";
  $("#appVersion").textContent   = "v" + APP_VERSION;
  const vm = $("#appVersionMenu"); if (vm) vm.textContent = "v" + APP_VERSION;
  const numEl = $("#projNumberHome"); if (numEl) numEl.textContent = state.project.number || "";
  const srcEl = $("#configSource");
  if (srcEl) {
    const map = { sheets: "Sheets から読み込み済み", cache: "オフライン(前回値)", fallback: "初期値" };
    srcEl.textContent = map[state.configSource] || "";
    srcEl.classList.toggle("warn", state.configSource !== "sheets");
  }
}

function refreshHomeCards() {
  $("#cardBuildingVal").textContent = state.building || "未選択";
  $("#cardBuildingVal").classList.toggle("placeholder", !state.building);
  $("#cardRoomVal").textContent = state.room || "未選択";
  $("#cardRoomVal").classList.toggle("placeholder", !state.room);
  $("#cardFixtureVal").textContent = state.fixture || "未選択";
  $("#cardFixtureVal").classList.toggle("placeholder", !state.fixture);
  $("#cardStageVal").textContent = state.stage || "未選択";
  $("#cardStageVal").classList.toggle("placeholder", !state.stage);

  const roomKey = makeRoomKey(state.building, state.room);
  if (roomKey) {
    const next = peekSeq(roomKey, todayYmd()) + 1;
    $("#nextSeqHint").textContent = `次の保存番号: ${state.building}-${state.room} の #${pad3(next)}`;
  } else {
    $("#nextSeqHint").textContent = "棟と部屋を選択してください";
  }

  const ready = !!(state.building && state.room && state.fixture && state.stage);
  $("#btnGoCamera").disabled = !ready;
}

async function refreshOutboxCard() {
  let count = 0;
  try { count = await countPending(); } catch (e) { console.warn(e); }
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
  $("#btnStart").addEventListener("click", onStart);

  $("#cardBuilding").addEventListener("click", pickBuilding);
  $("#cardRoom").addEventListener("click", pickRoom);
  $("#cardFixture").addEventListener("click", pickFixture);
  $("#cardStage").addEventListener("click", pickStage);
  $("#btnGoCamera").addEventListener("click", goCamera);
  $("#outboxCard").addEventListener("click", openOutbox);

  $("#btnMenu").addEventListener("click", openMenu);
  $$("[data-close-menu]").forEach(el => el.addEventListener("click", closeMenu));
  $("#menuChangePhoto").addEventListener("click", () => { closeMenu(); pickPhotographer(); });
  const reloadBtn = $("#menuReloadConfig");
  if (reloadBtn) reloadBtn.addEventListener("click", async () => { closeMenu(); await reloadAppConfig(); });
  const testBtn = $("#menuTestGas");
  if (testBtn) testBtn.addEventListener("click", async () => { closeMenu(); await onTestGas(); });

  $("#authStatusBtn").addEventListener("click", onAuthDotClick);

  $("#btnCameraBack").addEventListener("click", leaveCamera);
  $("#btnSwitchCamera").addEventListener("click", onSwitchCamera);
  $("#btnShoot").addEventListener("click", () => onShoot(false));
  $("#btnShootHQ").addEventListener("click", () => onShoot(true));

  $("#boardSizeRange").addEventListener("input", onBoardSizeChange);
  $("#boardNoBoard").addEventListener("change", onNoBoardChange);

  ["boardProjName", "boardPlace", "boardFixture", "boardStage", "boardCompany"].forEach(id => {
    $("#" + id).addEventListener("input", renderBoard);
  });

  $$(".bfs[data-step]").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.step;
      const d = parseFloat(btn.dataset.d);
      onLineScaleChange(k, d);
    });
  });

  $("#btnOutboxBack").addEventListener("click", () => { showScreen("home"); refreshOutboxCard(); refreshHomeCards(); });
  $("#btnUploadAll").addEventListener("click", uploadAllPending);
  $("#btnRefreshOutbox").addEventListener("click", () => renderOutbox());

  initBoardDrag();

  window.addEventListener("pagehide", () => { stopCamera(); revokeAllObjectUrls(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.cameraOn) stopCamera();
  });
  window.addEventListener("resize", () => { layoutBoard(); });
}

/* ============================================================ スタート */

async function onStart() {
  showScreen("home");
  refreshHomeCards();
  refreshOutboxCard();
  if (!state.photographer) setTimeout(pickPhotographer, 200);
}

async function onAuthDotClick() {
  if (state.gasReady) toastInfo("GAS 接続 OK(緑)");
  else {
    toastInfo("GAS 接続を確認中…");
    await testGasConnection();
  }
}

async function onTestGas() {
  toastInfo("GAS に接続中…");
  try {
    const r = await pingGas();
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
    refreshHomeCards();
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
    refreshHomeCards();
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
    refreshHomeCards();
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
    refreshHomeCards();
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
    refreshHomeCards();
  }
}

/* ============================================================ Menu */

function openMenu()  { $("#menu").classList.add("open"); }
function closeMenu() { $("#menu").classList.remove("open"); }

/* ============================================================ Camera */

async function goCamera() {
  if (!(state.building && state.room && state.fixture && state.stage)) {
    toastError("棟・部屋・照明器具・施工段階を全て選んでください");
    return;
  }
  if (!state.photographer) {
    toastInfo("最初に撮影者を設定してください");
    await pickPhotographer();
    if (!state.photographer) return;
  }
  if (await isAtLimit(PENDING_LIMIT)) {
    toastError(`未送信が ${PENDING_LIMIT} 枚に達しています。`);
    openOutbox();
    return;
  }

  $("#boardProjName").value = state.project.name || "";
  $("#boardPlace").value    = `${state.building}-${state.room}`;
  $("#boardFixture").value  = state.fixture || "";
  $("#boardStage").value    = state.stage || "";
  $("#boardCompany").value  = state.project.company || "";

  $("#boardNoBoard").checked = state.noBoard;
  $("#camSitebarText").textContent = `${state.project.name || ""} ／ ${state.building}-${state.room}`;

  showScreen("camera");
  await startCameraFlow();
  renderBoard();

  const sz = Math.round(state.boardRect.w * 100);
  $("#boardSizeRange").value = sz;
  $("#boardSizeVal").textContent = sz + "%";
}

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
    setTimeout(layoutBoard, 60);
  } catch (e) {
    state.cameraOn = false;
    state.cameraTrack = null;
    toastError(e.message);
    showScreen("home");
  }
}

function leaveCamera() {
  stopCamera();
  state.cameraOn = false;
  state.cameraTrack = null;
  showScreen("home");
  refreshHomeCards();
  refreshOutboxCard();
}

async function onSwitchCamera() {
  if (!state.cameraOn) return;
  try {
    const track = await switchCamera($("#videoEl"));
    state.cameraTrack = track;
    setTimeout(layoutBoard, 60);
  } catch (e) { toastError(e.message); }
}

/* ============================================================ 黒板 UI */

function initBoardUI() {
  const sz = Math.round(state.boardRect.w * 100);
  const range = $("#boardSizeRange");
  if (range) {
    range.value = sz;
    $("#boardSizeVal").textContent = sz + "%";
  }
}

function onBoardSizeChange(e) {
  const v = parseInt(e.target.value, 10);
  state.boardRect.w = v / 100;
  $("#boardSizeVal").textContent = v + "%";
  saveBoardRect(state.boardRect);
  layoutBoard();
}

function onNoBoardChange(e) {
  state.noBoard = e.target.checked;
  saveNoBoardFlag(state.noBoard);
}

function onLineScaleChange(k, d) {
  state.boardScale[k] = Math.max(0.5, Math.min(1.6, (state.boardScale[k] || 1) + d));
  saveBoardScale(state.boardScale);
  layoutBoard();
}

function renderBoard() {
  const ov = $("#boardOverlay");
  if (!ov) return;
  const v = (id) => ($("#" + id) ? $("#" + id).value : "");
  ov.innerHTML =
    `<div class="bov-row" style="height:${pct(BROWH.a)}"><div class="bov-lb"><span class="bv-l" data-k="la">工事名</span></div><div class="bov-vl"><span class="bv-t" data-k="a">${esc(v("boardProjName"))}</span></div></div>` +
    `<div class="bov-row" style="height:${pct(BROWH.b)}"><div class="bov-lb"><span class="bv-l" data-k="lb">場所</span></div><div class="bov-vl"><span class="bv-t" data-k="b">${esc(v("boardPlace"))}</span></div></div>` +
    `<div class="bov-fr"  style="height:${pct(BROWH.c)}"><span class="bv-t" data-k="c">${esc(v("boardFixture"))}</span></div>` +
    `<div class="bov-fr"  style="height:${pct(BROWH.d)}"><span class="bv-t" data-k="d">${esc(v("boardStage"))}</span></div>` +
    `<div class="bov-co"  style="height:${pct(BROWH.e)}"><span class="bv-t" data-k="e">${esc(v("boardCompany"))}</span></div>`;
  ov.style.display = "block";
  layoutBoard();
}

function layoutBoard() {
  const wrap = $("#bcamWrap");
  const ov   = $("#boardOverlay");
  if (!wrap || !ov) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;

  let bw = W * state.boardRect.w;
  let bh = bw * BOARD_HR;
  if (bh > H * 0.9) {
    bh = H * 0.9;
    bw = bh / BOARD_HR;
    state.boardRect.w = bw / W;
  }
  let x = clamp(state.boardRect.x, 0, 1 - bw / W);
  let y = clamp(state.boardRect.y, 0, 1 - bh / H);
  state.boardRect.x = x;
  state.boardRect.y = y;

  ov.style.left   = (x * W) + "px";
  ov.style.top    = (y * H) + "px";
  ov.style.width  = bw + "px";
  ov.style.height = bh + "px";

  setRowFont(ov, ".bv-l[data-k='la']", "la", BROWH.a, 0.4);
  setRowFont(ov, ".bv-l[data-k='lb']", "lb", BROWH.b, 0.4);
  setRowFont(ov, ".bv-t[data-k='a']",  "a",  BROWH.a, 0.6, bw);
  setRowFont(ov, ".bv-t[data-k='b']",  "b",  BROWH.b, 0.6, bw);
  setRowFont(ov, ".bv-t[data-k='c']",  "c",  BROWH.c, 0.55, bw);
  setRowFont(ov, ".bv-t[data-k='d']",  "d",  BROWH.d, 0.55, bw);
  setRowFont(ov, ".bv-t[data-k='e']",  "e",  BROWH.e, 0.45, bw);

  function setRowFont(rootEl, sel, k, frac, factor, parentW) {
    const el = rootEl.querySelector(sel);
    if (!el) return;
    const rh = bh * frac;
    const fs = Math.max(6, rh * factor * (state.boardScale[k] || 1));
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

function pct(v) { return (v * 100).toFixed(2) + "%"; }

function initBoardDrag() {
  document.addEventListener("pointerdown", (e) => {
    const ov = $("#boardOverlay");
    if (!ov) return;
    if (e.target !== ov && !ov.contains(e.target)) return;
    const wrap = $("#bcamWrap");
    if (!wrap) return;
    e.preventDefault();

    const W = wrap.clientWidth, H = wrap.clientHeight;
    const sx = e.clientX, sy = e.clientY;
    const ox = state.boardRect.x, oy = state.boardRect.y;

    function mv(ev) {
      state.boardRect.x = ox + (ev.clientX - sx) / W;
      state.boardRect.y = oy + (ev.clientY - sy) / H;
      layoutBoard();
    }
    function up() {
      document.removeEventListener("pointermove", mv);
      document.removeEventListener("pointerup", up);
      saveBoardRect(state.boardRect);
    }
    document.addEventListener("pointermove", mv);
    document.addEventListener("pointerup", up);
  });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ============================================================ 撮影 */

async function onShoot(hq) {
  if (!state.cameraOn) { toastError("カメラが起動していません"); return; }
  if (state.uploading) { toastInfo("処理中です…"); return; }
  if (await isAtLimit(PENDING_LIMIT)) {
    toastError(`未送信が ${PENDING_LIMIT} 枚に達しています。`);
    return;
  }

  state.uploading = true;
  const btn = hq ? $("#btnShootHQ") : $("#btnShoot");
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "処理中…";

  try {
    const video = $("#videoEl");
    let source;
    if (hq && state.cameraTrack && typeof ImageCapture !== "undefined") {
      try {
        const ic = new ImageCapture(state.cameraTrack);
        try {
          const blob = await ic.takePhoto();
          source = await blobToImage(blob);
        } catch (e1) {
          try { source = await ic.grabFrame(); }
          catch (e2) {
            console.warn("ImageCapture 失敗、通常撮影");
            source = video;
          }
        }
      } catch (e) { source = video; }
    } else {
      source = video;
    }

    const v = (id) => $("#" + id).value;
    const labels = { a: "工事名", b: "場所" };
    const values = {
      a: v("boardProjName"),
      b: v("boardPlace"),
      c: v("boardFixture"),
      d: v("boardStage"),
      e: v("boardCompany"),
    };

    // GAS 経由送信のため、長辺を制限して通信量を抑える
    const result = await composePhoto(source, {
      boardRect:  { ...state.boardRect },
      lineScale:  { ...state.boardScale },
      labels, values,
      jpegQuality: hq ? JPEG_QUALITY : 0.85,
      cropToRatio: true,
      alsoNoBoard: state.noBoard,
      maxLongSide: hq ? 2400 : 1600,
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

    // IndexedDB に保存(オフライン耐性)
    const photoIdMain = await addPhoto({
      blob: result.withBoard.blob,
      board,
      fileName: fileNameMain,
      roomKey,
    });
    let photoIdNB = null;
    if (state.noBoard && result.noBoard) {
      photoIdNB = await addPhoto({
        blob: result.noBoard.blob,
        board: { ...board, isNoBoard: true },
        fileName: fileNameNB,
        roomKey,
      });
    }

    // GAS に送信
    try {
      await uploadOne(photoIdMain);
      if (photoIdNB) await uploadOne(photoIdNB);
      toastSuccess(`Drive に保存${photoIdNB ? " (2枚)" : ""}: ${fileNameMain}`);
    } catch (e) {
      toastError(`送信失敗(未送信として保持): ${e.message}`);
    }
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

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像読み込み失敗")); };
    img.src = url;
  });
}

/* ============================================================ アップロード(GAS 経由) */

async function uploadOne(photoId) {
  const photo = await getPhoto(photoId);
  if (!photo) throw new Error("写真が見つかりません");
  if (!photo.blob) throw new Error("写真データが既に削除されています");

  await markUploading(photoId);

  const folderName = photo.roomKey;  // 例: "A1-101"
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
    });
    // no-cors なので fileId は取れないが、送信成功とみなす
    await markUploaded(photoId, result.fileId || "");
    return result;
  } catch (e) {
    await markFailed(photoId, e.message || String(e));
    throw e;
  }
}

/* ============================================================ Outbox */

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
  const list = await getPendingPhotos();
  if (list.length === 0) { toastInfo("未送信なし"); return; }

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
    try { await uploadOne(p.id); ok++; }
    catch (e) { ng++; }
  }
  fill.style.width = "100%";
  text.textContent = `完了: 成功 ${ok} 件 / 失敗 ${ng} 件`;
  $("#btnUploadAll").disabled = false;
  if (ng === 0) toastSuccess(`${ok} 枚すべて送信しました 🎉`);
  else          toastInfo(`成功 ${ok} 件、失敗 ${ng} 件`);
  setTimeout(() => { progress.hidden = true; }, 3000);
  await renderOutbox();
  await refreshOutboxCard();
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
