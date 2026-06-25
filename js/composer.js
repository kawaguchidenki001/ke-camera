// js/composer.js
// GenCan風 黒板焼き込み
// 写真の上に、指定された位置・サイズ・各行スケールで黒板を描画する。

/**
 * 黒板の縦横比(width : height = 1 : BOARD_HR)
 * = 0.73 (GenCan と同じ)
 */
export const BOARD_HR = 0.73;

/**
 * 黒板の各行の高さ比(合計 1.0)
 *   a: 工事名     0.15
 *   b: 場所       0.15
 *   c: 撮影内容   0.18
 *   d: 撮影者     0.18
 *   e: 自由       0.18
 *   f: 会社名     0.16
 */
export const BROWH = { a: 0.15, b: 0.15, c: 0.18, d: 0.18, e: 0.18, f: 0.16 };

/**
 * 写真+黒板を生成して JPEG Blob を返す
 *
 * @param {ImageBitmap|HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} source
 * @param {object} options
 *   - boardRect:   {x, y, w}  全部 0..1 の比率(x,y=左上、w=幅比)
 *   - lineScale:   {a,b,c,d,e,f}  各行のフォント倍率(0.5..1.6)
 *   - labels:      {a,b,c,d}  行1〜4のラベル文字(右側に値)
 *   - values:      {a,b,c,d,e,f}  各行の値
 *   - jpegQuality: 0..1
 *   - cropToRatio: true なら 4:3 にセンタークロップ
 *   - alsoNoBoard: true なら黒板なし版も生成して同時に返す
 *
 * @returns {Promise<{withBoard:{blob,dataUrl}, noBoard?:{blob,dataUrl}, width, height}>}
 */
export async function composePhoto(source, options) {
  const opts = options || {};
  const boardRect  = opts.boardRect  || { x: 0, y: 1, w: 0.37 };
  const lineScale  = opts.lineScale  || { a:1, b:1, c:1, d:1, e:1, f:1 };
  const labels     = opts.labels     || { a:"工事名", b:"場所", c:"撮影内容", d:"撮影者" };
  const values     = opts.values     || {};
  const jpegQuality = clamp(opts.jpegQuality ?? 0.92, 0.5, 1.0);
  const cropToRatio = opts.cropToRatio !== false; // デフォルト 4:3 クロップ
  const alsoNoBoard = !!opts.alsoNoBoard;

  // 元画像のサイズ
  const sw = source.width  || source.videoWidth  || source.naturalWidth;
  const sh = source.height || source.videoHeight || source.naturalHeight;
  if (!sw || !sh) throw new Error("元画像のサイズが取得できません");

  // 4:3 にセンタークロップ
  let cw, ch, cx, cy;
  if (cropToRatio) {
    if (sw / sh >= 4/3) {
      ch = sh;
      cw = Math.round(sh * 4 / 3);
    } else {
      cw = sw;
      ch = Math.round(sw * 3 / 4);
    }
    cx = Math.round((sw - cw) / 2);
    cy = Math.round((sh - ch) / 2);
  } else {
    cw = sw; ch = sh; cx = 0; cy = 0;
  }

  // ベースの写真キャンバス(黒板なし版でもある)
  const base = document.createElement("canvas");
  base.width = cw; base.height = ch;
  base.getContext("2d").drawImage(source, cx, cy, cw, ch, 0, 0, cw, ch);

  // 黒板なし版を先に作る(必要なら)
  let noBoard = null;
  if (alsoNoBoard) {
    const blob = await canvasToBlob(base, "image/jpeg", jpegQuality);
    const dataUrl = await blobToDataUrl(blob);
    noBoard = { blob, dataUrl };
  }

  // 黒板を描画
  const withBoardCanvas = copyCanvas(base);
  drawBoard(withBoardCanvas, { boardRect, lineScale, labels, values });

  const wbBlob = await canvasToBlob(withBoardCanvas, "image/jpeg", jpegQuality);
  const wbDataUrl = await blobToDataUrl(wbBlob);

  return {
    withBoard: { blob: wbBlob, dataUrl: wbDataUrl },
    noBoard,
    width: cw,
    height: ch,
  };
}

/* ============================================================ 黒板描画 */

function drawBoard(canvas, { boardRect, lineScale, labels, values }) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // 黒板のサイズ・位置を実ピクセルへ
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
  // 外枠(白2px)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);

  const pad = Math.floor(bw * 0.03);
  const labelW = Math.floor(bw * 0.17);
  ctx.textBaseline = "middle";

  let yy = by;

  // ヘルパー: ラベル+値の行
  function rowLV(label, value, k, hf) {
    const rh = bh * hf;
    // 行下境界線
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    line(ctx, bx + 4, yy + rh, bx + bw - 4, yy + rh);
    // ラベル列の右境界
    line(ctx, bx + labelW, yy + 2, bx + labelW, yy + rh);

    // ラベル(白、センター揃え)
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = Math.max(7, Math.floor(rh * 0.4)) + "px " + jpFont();
    ctx.fillText(label, bx + labelW / 2, yy + rh / 2, labelW - 6);

    // 値(白、左揃え、太字、個別スケール)
    const fs = Math.max(8, Math.floor(rh * 0.6 * (lineScale[k] || 1)));
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "left";
    if (value) {
      ctx.fillText(value, bx + labelW + pad, yy + rh / 2, bw - labelW - pad * 2);
    }
    yy += rh;
  }

  // ヘルパー: 自由(中央揃え)の行
  function rowFree(value, k, hf) {
    const rh = bh * hf;
    // 行下境界線
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    line(ctx, bx + 4, yy + rh, bx + bw - 4, yy + rh);

    const fs = Math.max(8, Math.floor(rh * 0.66 * (lineScale[k] || 1)));
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "center";
    if (value) {
      ctx.fillText(value, bx + bw / 2, yy + rh / 2, bw - pad * 2);
    }
    yy += rh;
  }

  // ヘルパー: 会社名(右寄せ)
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

  // 6 行を順に描画
  rowLV(labels.a || "工事名",   values.a || "", "a", BROWH.a);
  rowLV(labels.b || "場所",     values.b || "", "b", BROWH.b);
  rowLV(labels.c || "撮影内容", values.c || "", "c", BROWH.c);
  rowLV(labels.d || "撮影者",   values.d || "", "d", BROWH.d);
  rowFree(values.e || "", "e", BROWH.e);
  rowCo(values.f || "", "f", BROWH.f);
}

/* ============================================================ utilities */

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function jpFont() {
  // ブラウザ環境で利用可能な日本語フォントスタックを返す
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
