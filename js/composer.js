// js/composer.js
// GenCan風 黒板焼き込み(5行構成・撮影者なし)
// 行構成: 工事名 / 場所 / 照明器具 / 施工段階 / 会社名(右寄せ)

export const BOARD_HR = 0.73;

// 各行の高さ比(合計1.0)
// 工事名15% / 場所15% / 照明器具27% / 施工段階27% / 会社16%
export const BROWH = { a: 0.15, b: 0.15, c: 0.27, d: 0.27, e: 0.16 };

/**
 * 写真+黒板を生成して JPEG Blob を返す
 *
 * @param {ImageBitmap|HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} source
 * @param {object} options
 *   - boardRect, lineScale, labels, values: 黒板
 *   - jpegQuality: 0..1
 *   - cropToRatio: true なら 4:3 にセンタークロップ
 *   - alsoNoBoard: true なら黒板なし版も生成
 *   - maxLongSide: 長辺の最大ピクセル数(指定すると縮小、未指定=元サイズのまま)
 *
 * @returns {Promise<{withBoard:{blob,dataUrl}, noBoard?, width, height}>}
 */
export async function composePhoto(source, options) {
  const opts = options || {};
  const boardRect   = opts.boardRect   || { x: 0, y: 1, w: 0.37 };
  const lineScale   = opts.lineScale   || { a:1, b:1, c:1, d:1, e:1 };
  const labels      = opts.labels      || { a:"工事名", b:"場所" };
  const values      = opts.values      || {};
  const jpegQuality = clamp(opts.jpegQuality ?? 0.92, 0.5, 1.0);
  const cropToRatio = opts.cropToRatio !== false;
  const alsoNoBoard = !!opts.alsoNoBoard;
  const maxLongSide = opts.maxLongSide || 0;

  const sw = source.width  || source.videoWidth  || source.naturalWidth;
  const sh = source.height || source.videoHeight || source.naturalHeight;
  if (!sw || !sh) throw new Error("元画像のサイズが取得できません");

  // 4:3 センタークロップ
  let cw, ch, cx, cy;
  if (cropToRatio) {
    if (sw / sh >= 4 / 3) { ch = sh; cw = Math.round(sh * 4 / 3); }
    else                  { cw = sw; ch = Math.round(sw * 3 / 4); }
    cx = Math.round((sw - cw) / 2);
    cy = Math.round((sh - ch) / 2);
  } else {
    cw = sw; ch = sh; cx = 0; cy = 0;
  }

  // 長辺リサイズ
  let outW = cw, outH = ch;
  if (maxLongSide > 0) {
    const long = Math.max(cw, ch);
    if (long > maxLongSide) {
      const r = maxLongSide / long;
      outW = Math.round(cw * r);
      outH = Math.round(ch * r);
    }
  }

  const base = document.createElement("canvas");
  base.width = outW; base.height = outH;
  base.getContext("2d").drawImage(source, cx, cy, cw, ch, 0, 0, outW, outH);

  let noBoard = null;
  if (alsoNoBoard) {
    const blob = await canvasToBlob(base, "image/jpeg", jpegQuality);
    const dataUrl = await blobToDataUrl(blob);
    noBoard = { blob, dataUrl };
  }

  const withBoardCanvas = copyCanvas(base);
  drawBoard(withBoardCanvas, { boardRect, lineScale, labels, values });

  const wbBlob = await canvasToBlob(withBoardCanvas, "image/jpeg", jpegQuality);
  const wbDataUrl = await blobToDataUrl(wbBlob);

  return {
    withBoard: { blob: wbBlob, dataUrl: wbDataUrl },
    noBoard,
    width: outW,
    height: outH,
  };
}

/* ============================================================ 黒板描画 */

function drawBoard(canvas, { boardRect, lineScale, labels, values }) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  let bw = Math.floor(W * boardRect.w);
  let bh = Math.floor(bw * BOARD_HR);
  if (bh > H * 0.9) {
    bh = Math.floor(H * 0.9);
    bw = Math.floor(bh / BOARD_HR);
  }
  let bx = Math.floor(W * boardRect.x);
  let by = Math.floor(H * boardRect.y);
  if (bx + bw > W) bx = W - bw;
  if (by + bh > H) by = H - bh;
  if (bx < 0) bx = 0;
  if (by < 0) by = 0;

  // 背景
  ctx.fillStyle = "#1a8c78";
  ctx.fillRect(bx, by, bw, bh);
  // 外枠
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);

  const pad = Math.floor(bw * 0.03);
  const labelW = Math.floor(bw * 0.17);
  ctx.textBaseline = "middle";

  let yy = by;

  // ラベル+値の行
  function rowLV(label, value, k, hf) {
    const rh = bh * hf;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    line(ctx, bx + 4, yy + rh, bx + bw - 4, yy + rh);
    line(ctx, bx + labelW, yy + 2, bx + labelW, yy + rh);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = Math.max(7, Math.floor(rh * 0.4)) + "px " + jpFont();
    ctx.fillText(label, bx + labelW / 2, yy + rh / 2, labelW - 6);

    const fs = Math.max(8, Math.floor(rh * 0.6 * (lineScale[k] || 1)));
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "left";
    if (value) {
      ctx.fillText(value, bx + labelW + pad, yy + rh / 2, bw - labelW - pad * 2);
    }
    yy += rh;
  }

  // 中央揃え行(ラベルなし、大文字)
  function rowFree(value, k, hf) {
    const rh = bh * hf;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    line(ctx, bx + 4, yy + rh, bx + bw - 4, yy + rh);

    const fs = Math.max(8, Math.floor(rh * 0.55 * (lineScale[k] || 1)));
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "center";
    if (value) {
      ctx.fillText(value, bx + bw / 2, yy + rh / 2, bw - pad * 2);
    }
    yy += rh;
  }

  // 会社名(右寄せ・小)
  function rowCo(value, k, hf) {
    const rh = bh * hf;
    const fs = Math.max(7, Math.floor(rh * 0.45 * (lineScale[k] || 1)));
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "right";
    if (value) {
      ctx.fillText(value, bx + bw - pad, yy + rh / 2, bw - pad * 2);
    }
    yy += rh;
  }

  // 5 行描画
  rowLV(labels.a || "工事名", values.a || "", "a", BROWH.a);
  rowLV(labels.b || "場所",   values.b || "", "b", BROWH.b);
  rowFree(values.c || "", "c", BROWH.c);  // 照明器具
  rowFree(values.d || "", "d", BROWH.d);  // 施工段階
  rowCo(values.e || "", "e", BROWH.e);    // 会社名
}

/* ============================================================ utilities */

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function jpFont() {
  return `"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo","Noto Sans JP",sans-serif`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function copyCanvas(src) {
  const dst = document.createElement("canvas");
  dst.width  = src.width;
  dst.height = src.height;
  dst.getContext("2d").drawImage(src, 0, 0);
  return dst;
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Blob 生成失敗")),
      mimeType,
      quality
    );
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("読み込み失敗"));
    r.readAsDataURL(blob);
  });
}
