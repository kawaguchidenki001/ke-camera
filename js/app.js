// js/app.js
// メインエントリ。各モジュールを統合し、UI イベントを束ねる。

import { APP_VERSION, DEFAULTS, INVALID_FILENAME_CHARS } from "./config.js";
import {
  loadSettings, saveSettings, resetSettings, exportSettings, importSettings,
  saveLastBoard, loadLastBoard, saveLastProject, loadLastProject,
  nextSeq, rollbackSeq, peekSeq,
} from "./storage.js";
import {
  showScreen, getCurrentScreen, toast, toastSuccess, toastError, toastInfo,
  showLoading, hideLoading, openDrawer, closeDrawer, setAuthIndicator, dom,
} from "./ui.js";
import { initAuth, requestAccessToken, signOut, isSignedIn, getCachedToken } from "./auth.js";
import { loadProjects, filterProjects } from "./sheets.js";
import { uploadBlob, checkFolderAccess } from "./drive.js";
import { startCamera, switchCamera, stopCamera, grabFrame } from "./camera.js";
import { composePhoto } from "./composer.js";

const { $, $$ } = dom;

/* ============================================================
   グローバル状態
   ============================================================ */
const state = {
  settings: loadSettings(),
  projects: [],
  selectedProject: null,
  currentBoard: null,
  lastCaptured: null,    // { blob, dataUrl, board, fileName, folderId }
  uploading: false,
  cameraOn: false,
};

window.addEventListener("DOMContentLoaded", () => {
  initUi();
  rehydrateSettingsForm();
  rehydrateBoardForm();
  routeInitial();
});

/* ============================================================
   初期画面振り分け
   ============================================================ */
function routeInitial() {
  const ok = isConfigComplete(state.settings);
  if (!ok) {
    // 未設定のものをチェックリストに表示
    showSetupCheck();
    showScreen("home");
    return;
  }
  // GIS の準備をして、ホームに留まる(ユーザー操作でログイン)
  initAuth(state.settings.clientId).then(() => {
    updateAuthIndicator();
  }).catch((e) => {
    toastError("認証初期化に失敗: " + e.message);
  });
  showScreen("home");
}

function isConfigComplete(s) {
  return !!(s.clientId && s.apiKey && s.sheetId && s.sheetRange);
}

function showSetupCheck() {
  const el = $("#setupCheck");
  if (!el) return;
  el.hidden = false;
  $("#checkClientId").classList.toggle("ok", !!state.settings.clientId);
  $("#checkApiKey").classList.toggle("ok", !!state.settings.apiKey);
  $("#checkSheetId").classList.toggle("ok", !!state.settings.sheetId);
  $("#checkDriveFolder").classList.toggle("ok", !!state.settings.driveFolderId);
  $("#welcomeMsg").textContent = "未設定の項目があります。「設定を開く」から登録してください。";
}

function updateAuthIndicator() {
  setAuthIndicator(isSignedIn());
}

/* ============================================================
   UI バインディング
   ============================================================ */
function initUi() {
  // ===== ヘッダー =====
  $("#navMenuBtn").addEventListener("click", openDrawer);
  $("#authStatusBtn").addEventListener("click", onClickAuthStatus);

  // ===== ドロワー =====
  $$("[data-close-drawer]").forEach(el => el.addEventListener("click", closeDrawer));
  $$(".drawer-menu [data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.nav;
      closeDrawer();
      if (target === "projectSelect") return goProjectSelect();
      if (target === "boardEdit")     return goBoardEdit();
      showScreen(target);
    });
  });
  $("#btnSignOut").addEventListener("click", async () => {
    await signOut();
    updateAuthIndicator();
    closeDrawer();
    toastInfo("サインアウトしました");
  });

  // ===== ホーム =====
  $("#btnLoginHome").addEventListener("click", async () => {
    if (!isConfigComplete(state.settings)) {
      toastError("先に設定を完了してください");
      showScreen("settings");
      return;
    }
    try {
      showLoading("Google にログイン中…");
      await initAuth(state.settings.clientId);
      await requestAccessToken();
      updateAuthIndicator();
      toastSuccess("ログインしました");
      goProjectSelect();
    } catch (e) {
      toastError(e.message);
    } finally {
      hideLoading();
    }
  });
  $("#btnSettingsHome").addEventListener("click", () => showScreen("settings"));

  // ===== 工事選択 =====
  $("#btnReloadProjects").addEventListener("click", () => reloadProjects(true));
  $("#projectSearch").addEventListener("input", (e) => renderProjects(e.target.value));
  $("#btnManualEntry").addEventListener("click", () => {
    state.selectedProject = null;
    initBoardFromProject(null);
    showScreen("boardEdit");
  });

  // ===== 黒板編集 =====
  $("#btnBackToProjects").addEventListener("click", () => goProjectSelect());
  $("#btnGoCamera").addEventListener("click", goCamera);

  // ===== カメラ =====
  $("#btnCameraBack").addEventListener("click", leaveCamera);
  $("#btnShutter").addEventListener("click", onShutter);
  $("#btnSwitchCamera").addEventListener("click", onSwitchCamera);

  // ===== プレビュー =====
  $("#btnRetake").addEventListener("click", () => {
    state.lastCaptured = null;
    showScreen("camera");
  });
  $("#btnUpload").addEventListener("click", onUpload);

  // ===== 設定 =====
  $("#btnSettingsBack").addEventListener("click", () => showScreen("home"));
  $("#btnSaveSettings").addEventListener("click", onSaveSettings);
  $("#btnExportSettings").addEventListener("click", onExportSettings);
  $("#btnImportSettings").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", onImportFile);
  $("#btnResetSettings").addEventListener("click", onResetSettings);

  // ===== その他 =====
  // ページ離脱時にカメラを必ず停止
  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.cameraOn) stopCamera();
  });
}

/* ============================================================
   認証ステータスボタン
   ============================================================ */
async function onClickAuthStatus() {
  if (isSignedIn()) {
    toastInfo("ログイン中です(右上は緑)");
    return;
  }
  try {
    if (!isConfigComplete(state.settings)) {
      toastError("先に設定を完了してください");
      showScreen("settings");
      return;
    }
    await initAuth(state.settings.clientId);
    await requestAccessToken();
    updateAuthIndicator();
    toastSuccess("ログインしました");
  } catch (e) {
    toastError(e.message);
  }
}

/* ============================================================
   工事選択
   ============================================================ */
async function goProjectSelect() {
  if (!isConfigComplete(state.settings)) {
    toastError("先に設定を完了してください");
    showScreen("settings");
    return;
  }
  showScreen("projectSelect");
  if (state.projects.length === 0) {
    await reloadProjects(false);
  } else {
    renderProjects($("#projectSearch").value);
  }
}

async function reloadProjects(showToast) {
  const list = $("#projectList");
  list.innerHTML = `<div class="empty-state"><p>工事一覧を取得中…</p></div>`;
  try {
    state.projects = await loadProjects({
      sheetId:    state.settings.sheetId,
      sheetRange: state.settings.sheetRange,
      apiKey:     state.settings.apiKey,
    });
    if (showToast) toastSuccess(`${state.projects.length} 件読み込みました`);
    renderProjects($("#projectSearch").value);
  } catch (e) {
    state.projects = [];
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    toastError("工事一覧の取得に失敗");
  }
}

function renderProjects(query) {
  const list = $("#projectList");
  const filtered = filterProjects(state.projects, query);
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>該当する工事がありません。</p></div>`;
    return;
  }
  // 最大 200 件まで描画(極端なケースを保護)
  const slice = filtered.slice(0, 200);
  list.innerHTML = slice.map((p, i) => `
    <button class="project-item" data-idx="${state.projects.indexOf(p)}" type="button">
      <div class="pi-name">${p.kubun ? `<span class="pi-tag">${escapeHtml(p.kubun)}</span>` : ""}${escapeHtml(p.koujiMei)}</div>
      <div class="pi-meta">${escapeHtml([p.koushu, p.shikousha].filter(Boolean).join(" / "))}</div>
    </button>
  `).join("");
  list.querySelectorAll(".project-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const proj = state.projects[idx];
      if (proj) {
        state.selectedProject = proj;
        saveLastProject(proj);
        initBoardFromProject(proj);
        showScreen("boardEdit");
      }
    });
  });
}

/* ============================================================
   黒板編集
   ============================================================ */
function rehydrateBoardForm() {
  // 表示オプションは設定値から復元
  $("#optBoardPos").value    = state.settings.boardPos;
  $("#optBoardHeight").value = String(state.settings.boardHeight);
  $("#optShowSeq").checked   = !!state.settings.showSeq;
}

function initBoardFromProject(proj) {
  $("#fldKoujiMei").value  = proj?.koujiMei || (loadLastBoard()?.koujiMei || "");
  $("#fldKoushu").value    = proj?.koushu   || (loadLastBoard()?.koushu   || "");
  $("#fldShikousha").value = proj?.shikousha
                          || state.settings.defaultShikousha
                          || (loadLastBoard()?.shikousha || "");
  $("#fldNaiyou").value    = "";
  $("#fldDate").value      = todayYmd();
}

function goBoardEdit() {
  if (!$("#fldKoujiMei").value && !state.selectedProject && state.projects.length > 0) {
    return goProjectSelect();
  }
  if (!$("#fldDate").value) $("#fldDate").value = todayYmd();
  showScreen("boardEdit");
}

function readBoardForm() {
  return {
    koujiMei:  $("#fldKoujiMei").value.trim(),
    koushu:    $("#fldKoushu").value.trim(),
    shikousha: $("#fldShikousha").value.trim(),
    naiyou:    $("#fldNaiyou").value.trim(),
    date:      $("#fldDate").value,
  };
}

function readBoardOptions() {
  return {
    pos:         $("#optBoardPos").value,
    heightRatio: parseFloat($("#optBoardHeight").value),
    showSeq:     $("#optShowSeq").checked,
  };
}

/* ============================================================
   カメラ
   ============================================================ */
async function goCamera() {
  const board = readBoardForm();
  if (!board.koujiMei) {
    toastError("工事名を入力してください");
    return;
  }
  if (!board.naiyou) {
    toastError("撮影内容を入力してください");
    return;
  }
  if (!board.date) {
    toastError("撮影年月日を入力してください");
    return;
  }
  state.currentBoard = board;
  saveLastBoard(board);

  // 表示オプションを設定に保存(次回の既定に)
  const opts = readBoardOptions();
  saveSettings({ boardPos: opts.pos, boardHeight: opts.heightRatio, showSeq: opts.showSeq });
  state.settings = loadSettings();

  showScreen("camera");
  await startCameraFlow();
}

async function startCameraFlow() {
  const video = $("#videoEl");
  const info  = $("#cameraInfoText");
  info.textContent = "カメラを起動中…";
  try {
    await startCamera(video, {
      facingMode: state.settings.cameraFacing,
      width:  state.settings.cameraWidth,
      height: state.settings.cameraHeight,
    });
    state.cameraOn = true;
    const w = video.videoWidth, h = video.videoHeight;
    const proj = state.selectedProject?.koujiMei || state.currentBoard.koujiMei;
    info.textContent = `${proj}  ・  ${w}×${h}  ・  #${pad3(peekSeq(proj, state.currentBoard.date) + 1)}`;
  } catch (e) {
    state.cameraOn = false;
    toastError(e.message);
    showScreen("boardEdit");
  }
}

function leaveCamera() {
  stopCamera();
  state.cameraOn = false;
  showScreen("boardEdit");
}

async function onSwitchCamera() {
  if (!state.cameraOn) return;
  try {
    await switchCamera($("#videoEl"));
  } catch (e) { toastError(e.message); }
}

async function onShutter() {
  if (!state.cameraOn) return;
  const video = $("#videoEl");
  try {
    // シャッター抑止用に一時的にボタン無効化
    $("#btnShutter").disabled = true;

    const board = { ...state.currentBoard };
    const opts  = readBoardOptions();

    // 連番採番
    const seq = nextSeq(board.koujiMei, board.date);
    board.seq = seq;

    const frame = await grabFrame(video);
    const { blob, dataUrl } = await composePhoto(frame, board, {
      pos:         opts.pos,
      heightRatio: opts.heightRatio,
      showSeq:     opts.showSeq,
      jpegQuality: state.settings.jpegQuality,
    });

    // ファイル名と保存先を確定
    const fileName = buildFilename(state.settings.filenameTpl, board);
    const folderId = state.selectedProject?.folderId || state.settings.driveFolderId || "";

    state.lastCaptured = { blob, dataUrl, board, fileName, folderId, seq };

    $("#previewImg").src = dataUrl;
    $("#previewStatusText").textContent = `${fileName}  ・  ${folderId ? "保存先 OK" : "※ 保存先フォルダ未指定"}`;
    showScreen("preview");
  } catch (e) {
    toastError("撮影に失敗: " + e.message);
    // 失敗時は連番を戻す
    if (state.currentBoard) rollbackSeq(state.currentBoard.koujiMei, state.currentBoard.date);
  } finally {
    $("#btnShutter").disabled = false;
  }
}

/* ============================================================
   アップロード
   ============================================================ */
async function onUpload() {
  if (!state.lastCaptured) return;
  if (state.uploading) return;

  const cap = state.lastCaptured;
  if (!cap.folderId) {
    toastError("保存先フォルダ ID が未指定です(設定 or マスタの D 列)。");
    return;
  }

  state.uploading = true;
  showLoading("Google Drive へ保存中…");
  try {
    // トークン確認
    let tok = getCachedToken();
    if (!tok) {
      tok = await requestAccessToken();
      updateAuthIndicator();
    }

    const description = [
      `工事名: ${cap.board.koujiMei}`,
      `工種: ${cap.board.koushu}`,
      `施工者: ${cap.board.shikousha}`,
      `撮影内容: ${cap.board.naiyou}`,
      `撮影年月日: ${cap.board.date}`,
      `No: #${pad3(cap.seq)}`,
      `app: KE-Camera v${APP_VERSION}`,
    ].join("\n");

    const properties = {
      koujiMei:  cap.board.koujiMei,
      koushu:    cap.board.koushu || "",
      shikousha: cap.board.shikousha || "",
      naiyou:    cap.board.naiyou || "",
      date:      cap.board.date,
      seq:       String(cap.seq),
      app:       "KE-Camera",
    };

    const result = await uploadBlob({
      blob:        cap.blob,
      name:        cap.fileName,
      mimeType:    "image/jpeg",
      parents:     [cap.folderId],
      accessToken: tok,
      description,
      properties,
    });

    toastSuccess(`保存しました(ID: ${result.id?.slice(0, 8)}…)`);
    state.lastCaptured = null;

    // 撮影画面に戻る(連続撮影前提)
    showScreen("camera");
    if (!state.cameraOn) {
      await startCameraFlow();
    } else {
      const v = $("#videoEl");
      $("#cameraInfoText").textContent = `${cap.board.koujiMei}  ・  ${v.videoWidth}×${v.videoHeight}  ・  次は #${pad3(peekSeq(cap.board.koujiMei, cap.board.date) + 1)}`;
    }
  } catch (e) {
    // 失敗時は連番を巻き戻す
    rollbackSeq(cap.board.koujiMei, cap.board.date);
    if (/401/.test(e.message)) {
      // トークン期限切れ → 再認可を促す
      try {
        await requestAccessToken({ forcePrompt: false });
        toastInfo("トークンを更新しました。もう一度「Drive に保存」を押してください。");
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

/* ============================================================
   設定
   ============================================================ */
function rehydrateSettingsForm() {
  $("#setClientId").value         = state.settings.clientId || "";
  $("#setApiKey").value            = state.settings.apiKey || "";
  $("#setSheetId").value           = state.settings.sheetId || "";
  $("#setSheetRange").value        = state.settings.sheetRange || DEFAULTS.sheetRange;
  $("#setDriveFolder").value       = state.settings.driveFolderId || "";
  $("#setFilenameTpl").value       = state.settings.filenameTpl || DEFAULTS.filenameTpl;
  $("#setDefaultShikousha").value  = state.settings.defaultShikousha || "";
}

async function onSaveSettings() {
  const patch = {
    clientId:        $("#setClientId").value.trim(),
    apiKey:          $("#setApiKey").value.trim(),
    sheetId:         extractSheetId($("#setSheetId").value.trim()),
    sheetRange:      $("#setSheetRange").value.trim() || DEFAULTS.sheetRange,
    driveFolderId:   extractFolderId($("#setDriveFolder").value.trim()),
    filenameTpl:     $("#setFilenameTpl").value.trim() || DEFAULTS.filenameTpl,
    defaultShikousha:$("#setDefaultShikousha").value.trim(),
  };
  // 取得した値で再描画(URL からの抽出など)
  state.settings = saveSettings(patch);
  rehydrateSettingsForm();

  toastSuccess("設定を保存しました");

  // 認証クライアントを作り直す
  if (state.settings.clientId) {
    try {
      await initAuth(state.settings.clientId);
      updateAuthIndicator();
    } catch (e) {
      toastError("認証初期化に失敗: " + e.message);
    }
  }
}

function onExportSettings() {
  try {
    const json = exportSettings();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ke-camera-settings-${todayYmd()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toastSuccess("設定を書き出しました");
  } catch (e) {
    toastError(e.message);
  }
}

async function onImportFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    state.settings = importSettings(text);
    rehydrateSettingsForm();
    toastSuccess("設定を読み込みました");
  } catch (err) {
    toastError(err.message);
  } finally {
    e.target.value = ""; // 同じファイルを再選択できるように
  }
}

function onResetSettings() {
  if (!confirm("設定を初期化します。よろしいですか?")) return;
  state.settings = resetSettings();
  rehydrateSettingsForm();
  toastInfo("設定を初期化しました");
}

/* ============================================================
   ユーティリティ
   ============================================================ */
function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function pad3(n) { return String(n).padStart(3, "0"); }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** ファイル名テンプレートを展開し、危険文字を除去 */
function buildFilename(tpl, board) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const time = `${hh}${mm}${ss}`;
  const dateCompact = (board.date || todayYmd()).replace(/-/g, "");

  let name = (tpl || DEFAULTS.filenameTpl)
    .replace(/\{date\}/g,   dateCompact)
    .replace(/\{kouji\}/g,  board.koujiMei || "kouji")
    .replace(/\{koushu\}/g, board.koushu || "")
    .replace(/\{naiyou\}/g, board.naiyou || "")
    .replace(/\{seq\}/g,    pad3(board.seq || 1))
    .replace(/\{time\}/g,   time);

  // 連続するアンダースコアやスペースを整理
  name = name
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);

  if (!/\.jpe?g$/i.test(name)) name += ".jpg";
  return name;
}

/** Sheets の URL からシート ID を抽出(生 ID もそのまま通す) */
function extractSheetId(input) {
  if (!input) return "";
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(input);
  return m ? m[1] : input;
}

/** Drive の URL からフォルダ ID を抽出(生 ID もそのまま通す) */
function extractFolderId(input) {
  if (!input) return "";
  const m1 = /\/folders\/([a-zA-Z0-9-_]+)/.exec(input);
  if (m1) return m1[1];
  const m2 = /[?&]id=([a-zA-Z0-9-_]+)/.exec(input);
  if (m2) return m2[1];
  return input;
}
