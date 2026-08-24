// js/camera.js
// MediaDevices によるカメラ制御 + ライト制御

let currentStream = null;
let currentFacing = "environment";
let currentDeviceId = "";

export async function startCamera(videoEl, { facingMode = "environment", width = 1920, height = 1440 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("このブラウザはカメラに対応していません");
  }
  stopCamera();

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
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e2) {
      throw normalizeError(e2 || e);
    }
  }

  currentFacing = facingMode;
  currentDeviceId = "";
  videoEl.srcObject = currentStream;
  await videoEl.play().catch(() => {});
  await waitForVideoReady(videoEl);

  return currentStream.getVideoTracks()[0];
}

/**
 * deviceId を直接指定してカメラを起動する(超広角レンズなどの切替用)。
 * 失敗時は例外を投げるので、呼び出し側でフォールバックすること。
 */
export async function startCameraByDeviceId(videoEl, deviceId, { width = 2048, height = 1536 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("このブラウザはカメラに対応していません");
  }
  if (!deviceId) throw new Error("deviceId が指定されていません");
  stopCamera();

  const constraints = {
    video: {
      deviceId: { exact: deviceId },
      width:  { ideal: width },
      height: { ideal: height },
    },
    audio: false,
  };

  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  currentFacing = "environment";
  currentDeviceId = deviceId;
  videoEl.srcObject = currentStream;
  await videoEl.play().catch(() => {});
  await waitForVideoReady(videoEl);

  return currentStream.getVideoTracks()[0];
}

/**
 * 利用可能な映像入力(カメラ)一覧を返す。
 * ラベルは getUserMedia で権限が得られた後でないと空になる。
 */
export async function listVideoInputs() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === "videoinput");
  } catch (e) {
    return [];
  }
}

export function getCurrentDeviceId() { return currentDeviceId; }

function waitForVideoReady(videoEl) {
  return new Promise((resolve) => {
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      resolve();
    } else {
      const onMeta = () => { videoEl.removeEventListener("loadedmetadata", onMeta); resolve(); };
      videoEl.addEventListener("loadedmetadata", onMeta);
    }
  });
}

export async function switchCamera(videoEl) {
  const next = currentFacing === "environment" ? "user" : "environment";
  return startCamera(videoEl, { facingMode: next });
}

export function stopCamera() {
  if (currentStream) {
    for (const tr of currentStream.getTracks()) tr.stop();
    currentStream = null;
  }
}

export function isTorchSupported(track) {
  if (!track || typeof track.getCapabilities !== "function") return false;
  try {
    const caps = track.getCapabilities();
    return !!caps && !!caps.torch;
  } catch (e) {
    return false;
  }
}

export async function setTorch(track, on) {
  if (!track) throw new Error("カメラが起動していません");
  if (!isTorchSupported(track)) throw new Error("この端末またはカメラはライトに対応していません");

  try {
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    return true;
  } catch (e) {
    throw new Error("ライトを切り替えできませんでした");
  }
}

export async function grabFrame(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new Error("カメラのフレームを取得できませんでした");

  if (window.createImageBitmap) {
    try { return await createImageBitmap(videoEl); }
    catch (e) {}
  }

  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  cnv.getContext("2d").drawImage(videoEl, 0, 0, w, h);
  if (window.createImageBitmap) return await createImageBitmap(cnv);
  return cnv;
}

function normalizeError(e) {
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return new Error("カメラの使用が許可されていません。ブラウザの権限設定で許可してください。");
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return new Error("カメラが見つかりませんでした。");
  if (name === "NotReadableError" || name === "TrackStartError")
    return new Error("カメラを開始できませんでした。他のアプリで使用中かもしれません。");
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError")
    return new Error("指定のカメラ条件を満たせません。");
  if (name === "SecurityError" || name === "NotSupportedError")
    return new Error("HTTPS でアクセスしていないか、カメラ機能が無効化されています。");
  return new Error("カメラ起動エラー: " + (e?.message || String(e)));
}

/* ============================================================ フォーカス制御 */

// この端末・レンズがピント合わせに対応しているか
// (スマホの超広角レンズはピント固定のことが多く、その場合 false になる)
export function hasAutoFocus(track) {
  if (!track || typeof track.getCapabilities !== "function") return false;
  try {
    const caps = track.getCapabilities();
    return !!(caps && Array.isArray(caps.focusMode) &&
      (caps.focusMode.includes("continuous") || caps.focusMode.includes("single-shot")));
  } catch (e) {
    return false;
  }
}

// 常時オートフォーカス(continuous)を有効にする。撮るたびにピントを合わせ直す。
export async function enableContinuousFocus(track) {
  if (!track || typeof track.getCapabilities !== "function") return false;
  try {
    const caps = track.getCapabilities();
    if (!caps || !Array.isArray(caps.focusMode)) return false;
    const mode = caps.focusMode.includes("continuous") ? "continuous"
               : (caps.focusMode.includes("single-shot") ? "single-shot" : null);
    if (!mode) return false;
    await track.applyConstraints({ advanced: [{ focusMode: mode }] });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 画面上のタップ位置にピントを合わせる。
 * @param {MediaStreamTrack} track
 * @param {number} x 0..1 (映像内の相対位置)
 * @param {number} y 0..1
 */
export async function focusAtPoint(track, x, y) {
  if (!track || typeof track.getCapabilities !== "function") return false;
  try {
    const caps = track.getCapabilities();
    if (!caps) return false;
    const adv = {};
    if (caps.pointsOfInterest) {
      adv.pointsOfInterest = [{
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      }];
    }
    if (Array.isArray(caps.focusMode)) {
      if (caps.focusMode.includes("single-shot")) adv.focusMode = "single-shot";
      else if (caps.focusMode.includes("continuous")) adv.focusMode = "continuous";
    }
    if (Object.keys(adv).length === 0) return false;
    await track.applyConstraints({ advanced: [adv] });
    // 単発フォーカスの端末は、合焦後に常時オートフォーカスへ戻す
    if (adv.focusMode === "single-shot" && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      setTimeout(() => { enableContinuousFocus(track).catch(() => {}); }, 2500);
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function getZoomCapabilities(track) {
  if (!track || typeof track.getCapabilities !== "function") return null;
  try {
    const caps = track.getCapabilities();
    if (!caps || typeof caps.zoom !== "object") return null;
    const z = caps.zoom;
    if (typeof z.min !== "number" || typeof z.max !== "number") return null;
    return {
      min: z.min,
      max: z.max,
      step: typeof z.step === "number" && z.step > 0 ? z.step : 0.1,
    };
  } catch (e) {
    return null;
  }
}

export async function setCameraZoom(track, zoom) {
  const caps = getZoomCapabilities(track);
  if (!track || !caps) return false;
  const z = Math.max(caps.min, Math.min(caps.max, zoom));
  try {
    await track.applyConstraints({ advanced: [{ zoom: z }] });
    return true;
  } catch (e) {
    return false;
  }
}
