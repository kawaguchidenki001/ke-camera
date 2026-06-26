// js/camera.js
// MediaDevices によるカメラ制御 + ライト制御

let currentStream = null;
let currentFacing = "environment";

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
  videoEl.srcObject = currentStream;
  await videoEl.play().catch(() => {});

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
