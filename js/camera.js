// js/camera.js
// MediaDevices(getUserMedia)によるカメラ制御

let currentStream = null;
let currentFacing = "environment";

/**
 * カメラを起動して video 要素に流す
 * @returns {Promise<MediaStreamTrack>}
 */
export async function startCamera(videoEl, { facingMode = "environment", width = 1920, height = 1440 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("このブラウザは getUserMedia に対応していません");
  }

  // 既存ストリームの停止
  stopCamera();

  // モバイルの背面カメラ優先指定
  const constraints = {
    video: {
      facingMode: { ideal: facingMode },
      width:  { ideal: width },
      height: { ideal: height },
    },
    audio: false,
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // facingMode 指定で失敗するブラウザ向けに緩い指定で再試行
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e2) {
      throw normalizeError(e2 || e);
    }
  }

  currentFacing = facingMode;
  videoEl.srcObject = currentStream;

  // iOS Safari でも自動再生されるよう playsinline 必須(HTML 側で設定済み)
  await videoEl.play().catch(() => {});

  // メタデータがロードされるのを待つ(getVideoFrame の前提)
  await new Promise((resolve) => {
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      resolve();
    } else {
      const onMeta = () => { videoEl.removeEventListener("loadedmetadata", onMeta); resolve(); };
      videoEl.addEventListener("loadedmetadata", onMeta);
    }
  });

  return currentStream.getVideoTracks()[0];
}

/** カメラ切替(前/背) */
export async function switchCamera(videoEl) {
  const next = currentFacing === "environment" ? "user" : "environment";
  return startCamera(videoEl, { facingMode: next });
}

/** カメラ停止 */
export function stopCamera() {
  if (currentStream) {
    for (const tr of currentStream.getTracks()) tr.stop();
    currentStream = null;
  }
}

/** 現在のフレームを ImageBitmap として取得 */
export async function grabFrame(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new Error("カメラのフレームを取得できませんでした");

  // createImageBitmap が使える環境ならそれを使う(より安定)
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(videoEl);
    } catch (e) { /* fall through */ }
  }

  // フォールバック: canvas に書き出して ImageBitmap 化
  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);
  if (window.createImageBitmap) {
    return await createImageBitmap(cnv);
  }
  // 最終フォールバック: HTMLCanvasElement をそのまま画像扱いで返す
  return cnv;
}

function normalizeError(e) {
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new Error("カメラの使用が許可されていません。ブラウザの権限設定で許可してください。");
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new Error("カメラが見つかりませんでした。");
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new Error("カメラを開始できませんでした。他のアプリで使用中かもしれません。");
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return new Error("指定のカメラ条件を満たせません。背面 / 解像度の条件を変えてみてください。");
  }
  if (name === "SecurityError" || name === "NotSupportedError") {
    return new Error("HTTPS でアクセスしていないか、カメラ機能が無効化されています。");
  }
  return new Error("カメラ起動エラー: " + (e?.message || String(e)));
}
