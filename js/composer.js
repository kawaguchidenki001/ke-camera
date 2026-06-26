// js/composer.js
// GenCan風 黒板焼き込み(v1.6.0 仕様)
// 行構成:
//   1) 工事名(ラベル+値、下罫線あり)
//   2) 場所(ラベル+値、下罫線あり)
//   3) 照明器具(左寄せ、少し小さく、下罫線なし)
//   4) 施工段階(左寄せ、少し小さく、下罫線なし)
//   5) 会社名(右下角、大きめ、下罫線なし)

export const BOARD_HR = 0.73;

// 各行の高さ比(合計 1.0)
export const BROWH = {
  a: 0.18,  // 工事名
  b: 0.18,  // 場所
  c: 0.22,  // 照明器具
  d: 0.20,  // 施工段階
  e: 0.22,  // 会社名(大きめ)
};

/**
 * 写真+黒板を生成して JPEG Blob を返す
 *
 * @param {object} options
 *   - boardRect: {x,y,w} 比率(固定値が渡される)
 *   - labels: {a,b}
 *   - values: {a,b,c,d,e}
 *   - jpegQuality, cropToRatio, alsoNoBoard, maxLongSide
 *
 * @returns {Promise<{withBoard, noBoard?, width, height}>}
 */
export async function composePhoto(source, options) {
  const opts = options || {};
  const boardRect   = opts.boardRect   || { x: 0, y: 1, w: 0.38 };
  const labels      = opts.labels      || { a: "工事名", b: "場所" };
  const values      = opts.values      || {};
  const jpegQuality = clamp(opts.jpegQuality ?? 0.92, 0.5, 1.0);
  const cropToRatio = opts.cropToRatio !== false;
  const alsoNoBoard = !!opts.alsoNoBoard;
  const maxLongSide = opts.maxLongSide || 0;

  const sw = source.width  || source.videoWidth  || source.naturalWidth;
  const sh = source.height || source.videoHeight || source.naturalHeight;
  if (!sw || !sh) throw new Error("元画像のサイズが取得できません");

  let cw, ch, cx, cy;
  if (cropToRatio) {
    if (sw / sh >= 4 / 3) { ch = sh; cw = Math.round(sh * 4 / 3); }
    else                  { cw = sw; ch = Math.round(sw * 3 / 4); }
    cx = Math.round((sw - cw) / 2);
    cy = Math.round((sh - ch) / 2);
  } else {
    cw = sw; ch = sh; cx = 0; cy = 0;
  }

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
  drawBoard(withBoardCanvas, { boardRect, labels, values });

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

function drawBoard(canvas, { boardRect, labels, values }) {
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

  // 行1,2: ラベル+値、下罫線+左ラベル枠
  function rowLV(label, value, hf) {
    const rh = bh * hf;
    // 下罫線
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    line(ctx, bx + 4, yy + rh, bx + bw - 4, yy + rh);
    // ラベル右枠
    line(ctx, bx + labelW, yy + 2, bx + labelW, yy + rh);

    // ラベル
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = Math.max(8, Math.floor(rh * 0.42)) + "px " + jpFont();
    ctx.fillText(label, bx + labelW / 2, yy + rh / 2, labelW - 6);

    // 値
    const fs = Math.max(10, Math.floor(rh * 0.6));
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "left";
    if (value) {
      ctx.fillText(value, bx + labelW + pad, yy + rh / 2, bw - labelW - pad * 2);
    }
    yy += rh;
  }

  // 行3,4: 左寄せ、少し小さく、下罫線なし
  function rowLeft(value, hf) {
    const rh = bh * hf;
    const fs = Math.max(9, Math.floor(rh * 0.5));  // 少し小さく
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "left";
    if (value) {
      ctx.fillText(value, bx + pad, yy + rh / 2, bw - pad * 2);
    }
    yy += rh;
  }

  // 行5: 会社名(右下、大きめ)
  function rowCompany(value, hf) {
    const rh = bh * hf;
    const fs = Math.max(10, Math.floor(rh * 0.62));  // 大きめ
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + fs + "px " + jpFont();
    ctx.textAlign = "right";
    if (value) {
      // 右下角に近い位置(下に寄せる)
      ctx.fillText(value, bx + bw - pad, yy + rh - rh * 0.3, bw - pad * 2);
    }
    yy += rh;
  }

  // 5 行を描画
  rowLV(labels.a || "工事名", values.a || "", BROWH.a);
  rowLV(labels.b || "場所",   values.b || "", BROWH.b);
  rowLeft(values.c || "", BROWH.c);  // 照明器具(左寄せ)
  rowLeft(values.d || "", BROWH.d);  // 施工段階(左寄せ)
  rowCompany(values.e || "", BROWH.e);  // 会社名(右下大きめ)
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
