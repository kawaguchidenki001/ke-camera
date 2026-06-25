// js/composer.js
// 黒板を写真に焼き込む(北方住宅専用レイアウト)

import { PROJECT } from "./config.js";

/**
 * @param {ImageBitmap|HTMLCanvasElement|HTMLVideoElement} source
 * @param {object} board - { building, room, type, photographer, date, seq }
 * @param {object} opts  - { pos, heightRatio, jpegQuality }
 */
export async function composePhoto(source, board, opts = {}) {
  const pos      = opts.pos || "bottom";
  const heightR  = clamp(opts.heightRatio ?? 0.30, 0.16, 0.45);
  const quality  = clamp(opts.jpegQuality ?? 0.92, 0.5, 1.0);

  const sw = source.width  || source.videoWidth  || source.naturalWidth;
  const sh = source.height || source.videoHeight || source.naturalHeight;
  if (!sw || !sh) throw new Error("元画像のサイズが取得できません");

  const cnv = document.createElement("canvas");
  cnv.width = sw;
  cnv.height = sh;
  const ctx = cnv.getContext("2d");

  ctx.drawImage(source, 0, 0, sw, sh);

  const boardH = Math.round(sh * heightR);
  const boardY = (pos === "top") ? 0 : (sh - boardH);
  drawBoard(ctx, 0, boardY, sw, boardH, board);

  const blob = await new Promise((resolve, reject) => {
    cnv.toBlob((b) => b ? resolve(b) : reject(new Error("画像の生成に失敗")), "image/jpeg", quality);
  });

  const dataUrl = await blobToDataUrl(blob);
  return { blob, dataUrl, width: sw, height: sh };
}

function drawBoard(ctx, x, y, w, h, board) {
  ctx.save();

  // 黒板背景
  ctx.fillStyle = "#1e4d2b";
  ctx.fillRect(x, y, w, h);

  // 上端ハイライト
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y, w, 2);

  // フレーム
  const fInset = Math.max(6, Math.round(w * 0.008));
  const fThick = Math.max(2, Math.round(w * 0.0025));
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = fThick;
  ctx.strokeRect(x + fInset, y + fInset, w - fInset * 2, h - fInset * 2);

  // 内側レイアウト
  const padX = Math.round(w * 0.022);
  const padY = Math.round(h * 0.06);
  const innerX = x + fInset + padX;
  const innerY = y + fInset + padY;
  const innerW = w - (fInset + padX) * 2;
  const innerH = h - (fInset + padY) * 2;

  // 4 行レイアウト(工事情報/場所と会社/撮影内容/フッター)
  const rowH = innerH / 4;

  // 行分割線
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, Math.round(w * 0.0009));
  for (let i = 1; i < 4; i++) {
    const ly = innerY + rowH * i;
    line(ctx, innerX, ly, innerX + innerW, ly);
  }

  // ===== 行 1: 工事名 + 工事番号 =====
  const labelFontPx1 = Math.max(10, Math.round(rowH * 0.26));
  const valueFontPx1 = Math.max(13, Math.round(rowH * 0.36));
  drawSingle(ctx, {
    x: innerX, y: innerY, w: innerW, h: rowH,
    labelW: Math.round(innerW * 0.13),
    label: "工事名",
    value: `${PROJECT.name}(${PROJECT.number})`,
    labelFont: `600 ${labelFontPx1}px ${jpFont()}`,
    valueFont: `bold ${valueFontPx1}px ${jpFont()}`,
  });

  // ===== 行 2: 場所 / 会社(2 列) =====
  const labelFontPx2 = Math.max(11, Math.round(rowH * 0.30));
  const valueFontPx2 = Math.max(14, Math.round(rowH * 0.42));
  const col2RightX = innerX + Math.round(innerW * 0.58);
  // 列分割線
  line(ctx, col2RightX, innerY + rowH, col2RightX, innerY + rowH * 2);

  drawSingle(ctx, {
    x: innerX, y: innerY + rowH, w: col2RightX - innerX, h: rowH,
    labelW: Math.round(innerW * 0.13),
    label: "場所",
    value: `${board.building || ""}-${board.room || ""}`,
    labelFont: `600 ${labelFontPx2}px ${jpFont()}`,
    valueFont: `bold ${valueFontPx2}px ${jpFont()}`,
  });
  drawSingle(ctx, {
    x: col2RightX, y: innerY + rowH, w: innerW - (col2RightX - innerX), h: rowH,
    labelW: Math.round(innerW * 0.10),
    label: "会社",
    value: PROJECT.company,
    labelFont: `600 ${labelFontPx2}px ${jpFont()}`,
    valueFont: `bold ${valueFontPx2}px ${jpFont()}`,
  });

  // ===== 行 3: 撮影内容(大きく) =====
  const labelFontPx3 = Math.max(11, Math.round(rowH * 0.30));
  const valueFontPx3 = Math.max(16, Math.round(rowH * 0.52));
  drawSingle(ctx, {
    x: innerX, y: innerY + rowH * 2, w: innerW, h: rowH,
    labelW: Math.round(innerW * 0.13),
    label: "撮影内容",
    value: board.type || "",
    labelFont: `600 ${labelFontPx3}px ${jpFont()}`,
    valueFont: `bold ${valueFontPx3}px ${jpFont()}`,
  });

  // ===== 行 4: 撮影者 / 日付 / No.(3 列) =====
  const labelFontPx4 = Math.max(11, Math.round(rowH * 0.30));
  const valueFontPx4 = Math.max(14, Math.round(rowH * 0.42));
  const col4X1 = innerX + Math.round(innerW * 0.42);
  const col4X2 = innerX + Math.round(innerW * 0.78);

  line(ctx, col4X1, innerY + rowH * 3, col4X1, innerY + rowH * 4);
  line(ctx, col4X2, innerY + rowH * 3, col4X2, innerY + rowH * 4);

  drawSingle(ctx, {
    x: innerX, y: innerY + rowH * 3, w: col4X1 - innerX, h: rowH,
    labelW: Math.round(innerW * 0.13),
    label: "撮影者",
    value: board.photographer || "",
    labelFont: `600 ${labelFontPx4}px ${jpFont()}`,
    valueFont: `bold ${valueFontPx4}px ${jpFont()}`,
  });
  drawSingle(ctx, {
    x: col4X1, y: innerY + rowH * 3, w: col4X2 - col4X1, h: rowH,
    labelW: Math.round(innerW * 0.10),
    label: "撮影日",
    value: formatDateJp(board.date),
    labelFont: `600 ${labelFontPx4}px ${jpFont()}`,
    valueFont: `bold ${valueFontPx4}px ${jpFont()}`,
  });
  drawSingle(ctx, {
    x: col4X2, y: innerY + rowH * 3, w: innerW - (col4X2 - innerX), h: rowH,
    labelW: Math.round(innerW * 0.06),
    label: "No.",
    value: board.seq ? "#" + pad3(board.seq) : "",
    labelFont: `600 ${labelFontPx4}px ${jpFont()}`,
    valueFont: `bold ${valueFontPx4}px ${jpFont()}`,
  });

  ctx.restore();
}

function drawSingle(ctx, c) {
  // ラベル
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = c.labelFont;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const labelX = c.x + Math.round(c.w * 0.015);
  const labelY = c.y + c.h * 0.5;
  ctx.fillText(c.label, labelX, labelY);

  // 値
  ctx.fillStyle = "#ffffff";
  ctx.font = c.valueFont;
  const valueX = c.x + c.labelW + Math.round(c.w * 0.020);
  const valueY = c.y + c.h * 0.5;
  const maxW = c.x + c.w - valueX - Math.round(c.w * 0.015);
  const value = fitTextToWidth(ctx, c.value || "", maxW, c.valueFont);
  ctx.fillText(value, valueX, valueY);
}

function fitTextToWidth(ctx, text, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length, fit = "";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = text.slice(0, mid) + "…";
    if (ctx.measureText(t).width <= maxW) { fit = t; lo = mid + 1; }
    else hi = mid - 1;
  }
  return fit || "…";
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function jpFont() {
  return `"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo","Noto Sans JP",sans-serif`;
}

function formatDateJp(d) {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function pad3(n) { return String(n).padStart(3, "0"); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("読み込み失敗"));
    r.readAsDataURL(blob);
  });
}
